// Notebook adapter: transport-resolving, same pattern as
// tools/notebook-mcp/server.mjs - try the REST API first, fall back to a
// read-only node:sqlite connection when the app is closed.
//
// Unlike notebook-mcp this adapter never writes, so it doesn't need the
// down-vs-busy health retry dance notebook-mcp uses for safe offline writes:
// a single short health check is enough to pick a transport for a read.

import { DatabaseSync } from "node:sqlite";
import process from "node:process";
import { candidateDbPaths, resolveDbPath } from "../../notebook-mcp/sqlite.mjs";
import { formatRef } from "../refs.mjs";
import { openUrl } from "./openUrl.mjs";

const HEALTH_TIMEOUT_MS = 800;
const REQUEST_TIMEOUT_MS = 10_000;

// A function, not a module-level constant: NOTEBOOK_API must be read fresh
// on every call, not frozen at import time, or tests (and any other code
// that sets it after this module first loads) silently keep talking to the
// default http://127.0.0.1:8799 - which, on a dev machine, is very likely a
// real, running Notebook instance.
function apiBase() {
  return (process.env.NOTEBOOK_API || "http://127.0.0.1:8799").replace(/\/$/, "");
}

function noteRef(id) {
  return { app: "notebook", kind: "note", id };
}

function snippetOf(text, max = 140) {
  if (!text) return "";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function noteUrl(id) {
  return `notebook://note/${id}`;
}

async function checkHealth() {
  try {
    const res = await fetch(`${apiBase()}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiFetch(pathAndQuery) {
  const res = await fetch(`${apiBase()}${pathAndQuery}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (res.status === 404) return { status: 404, body: null };
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Notebook API GET ${pathAndQuery} -> ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`);
  }
  return { status: res.status, body: await res.json() };
}

// ---------------------------------------------------------------------------
// FTS query building (subset of notebook-mcp/sqlite.mjs's store.search,
// duplicated rather than shared because this adapter's query is deliberately
// unscoped - no notebook_id filter - unlike notebook-mcp's).
// ---------------------------------------------------------------------------

function buildFtsQuery(query) {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replace(/"/g, '""')}"*`)
    .join(" AND ");
}

function sqliteDbPath() {
  return resolveDbPath({ envDb: process.env.NOTEBOOK_DB });
}

function openReadOnlyDb() {
  const dbPath = sqliteDbPath();
  if (!dbPath) return null;
  return { db: new DatabaseSync(dbPath, { readOnly: true }), dbPath };
}

function sqliteResolveNote(id) {
  const opened = openReadOnlyDb();
  if (!opened) return { transportFailed: true };
  const { db } = opened;
  try {
    const row = db
      .prepare("SELECT id, title, content_plain FROM notes WHERE id = ? AND deleted_at IS NULL")
      .get(id);
    return { row };
  } finally {
    db.close();
  }
}

function sqliteListNotes({ query, limit }) {
  const opened = openReadOnlyDb();
  if (!opened) return { transportFailed: true };
  const { db } = opened;
  try {
    if (query && query.trim()) {
      const ftsQuery = buildFtsQuery(query);
      if (!ftsQuery) return { rows: [] };
      const rows = db
        .prepare(
          "SELECT n.id, n.title, n.content_plain FROM notes n " +
            "WHERE n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0 " +
            "AND n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?) " +
            "ORDER BY n.updated_at DESC LIMIT ?"
        )
        .all(ftsQuery, limit ?? 20);
      return { rows };
    }
    const rows = db
      .prepare(
        "SELECT id, title, content_plain FROM notes " +
          "WHERE deleted_at IS NULL AND COALESCE(is_template, 0) = 0 " +
          "ORDER BY updated_at DESC LIMIT ?"
      )
      .all(limit ?? 20);
    return { rows };
  } finally {
    db.close();
  }
}

/** @type {import("./index.mjs").Adapter} */
export const notebookAdapter = {
  app: "notebook",
  kinds: ["note"],

  async resolve(ref) {
    if (ref.kind !== "note") {
      throw new Error(`notebook adapter does not know kind "${ref.kind}" (known: note).`);
    }
    const httpUp = await checkHealth();
    if (httpUp) {
      const { status, body } = await apiFetch(`/api/v1/notes/${encodeURIComponent(ref.id)}`);
      if (status === 404 || !body) return { ref: formatRef(ref), title: null, subtitle: null, url: noteUrl(ref.id), exists: false };
      return {
        ref: formatRef(ref),
        title: body.title ?? null,
        subtitle: snippetOf(body.content_plain),
        url: noteUrl(ref.id),
        exists: true,
      };
    }
    const { row, transportFailed } = sqliteResolveNote(ref.id);
    if (transportFailed) {
      return { ref: formatRef(ref), title: null, subtitle: null, url: noteUrl(ref.id), exists: false };
    }
    if (!row) return { ref: formatRef(ref), title: null, subtitle: null, url: noteUrl(ref.id), exists: false };
    return {
      ref: formatRef(ref),
      title: row.title,
      subtitle: snippetOf(row.content_plain),
      url: noteUrl(ref.id),
      exists: true,
    };
  },

  async list(kind, { query, limit = 20 } = {}) {
    if (kind !== "note") {
      throw new Error(`notebook adapter does not know kind "${kind}" (known: note).`);
    }
    const httpUp = await checkHealth();
    if (httpUp) {
      if (query && query.trim()) {
        const { body } = await apiFetch(
          `/api/v1/search?q=${encodeURIComponent(query)}&limit=${encodeURIComponent(limit)}`
        );
        const notes = body?.notes ?? [];
        return notes.slice(0, limit).map((n) => ({
          ref: formatRef(noteRef(n.id)),
          title: n.title,
          subtitle: snippetOf(n.snippet),
          url: noteUrl(n.id),
          exists: true,
        }));
      }
      const { body } = await apiFetch("/api/v1/notes?trash=false");
      const notes = (body ?? []).slice(0, limit);
      return notes.map((n) => ({
        ref: formatRef(noteRef(n.id)),
        title: n.title,
        subtitle: snippetOf(n.snippet),
        url: noteUrl(n.id),
        exists: true,
      }));
    }
    const { rows, transportFailed } = sqliteListNotes({ query, limit });
    if (transportFailed) return [];
    return rows.map((row) => ({
      ref: formatRef(noteRef(row.id)),
      title: row.title,
      subtitle: snippetOf(row.content_plain),
      url: noteUrl(row.id),
      exists: true,
    }));
  },

  async open(ref) {
    openUrl(noteUrl(ref.id));
  },

  async health() {
    const httpUp = await checkHealth();
    if (httpUp) {
      return { ok: true, transport: "http", detail: apiBase() };
    }
    const dbPath = sqliteDbPath();
    if (dbPath) {
      return { ok: true, transport: "sqlite", detail: dbPath };
    }
    const tried = candidateDbPaths({ envDb: process.env.NOTEBOOK_DB });
    return {
      ok: false,
      transport: "none",
      detail: `Notebook API unreachable at ${apiBase()} and no local database found. Tried: ${tried.join(", ")}`,
    };
  },
};
