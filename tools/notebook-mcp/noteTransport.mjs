// Shared transport resolution for talking to Notebook notes: REST when the
// app / API is reachable, direct read-write `node:sqlite` when it isn't.
// Extracted out of server.mjs so tools/notebook-links can reuse the exact
// same write path (get/update note content) instead of hand-rolling a
// second copy that could drift from the invariants notebook-core's SQLite
// schema depends on (FTS triggers, revision history) - see sqlite.mjs's
// header comment for what those invariants are.
//
// This module owns transport selection and the HTTP store; sqlite.mjs still
// owns the actual offline read/write logic (createSqliteStore).

import { createSqliteStore, candidateDbPaths, resolveDbPath } from "./sqlite.mjs";

/** Notebook API unreachable, timed out, or returned a non-2xx status. */
export class ApiError extends Error {}

/** Offline (SQLite) transport failed - no DB found, or the query itself failed. */
export class SqliteError extends Error {}

/** Connection-level failures that mean nothing is listening on the port. */
const DOWN_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EHOSTUNREACH", "EADDRNOTAVAIL"]);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function apiFetchJson(apiBase, pathAndQuery, options = {}, requestTimeoutMs = 10_000) {
  const url = `${apiBase}${pathAndQuery}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(requestTimeoutMs),
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError(`Notebook API request to ${pathAndQuery} timed out after ${requestTimeoutMs / 1000}s.`);
    }
    throw new ApiError(`Could not reach the Notebook API at ${apiBase}. (${err.message})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new ApiError(
      `Notebook API ${options.method || "GET"} ${pathAndQuery} -> ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
    );
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

/**
 * Classifies the API as one of:
 *   ok    - answered 200; use HTTP.
 *   down  - the connection was refused, so the app really is not running;
 *           writing to SQLite directly is safe.
 *   busy  - a timeout or an error response: something IS there, it just did
 *           not answer in time. Writing to SQLite here would go behind the
 *           back of a live app that has the note in memory.
 * Telling `down` from `busy` is the whole point; they used to be one `null`.
 */
export async function checkHealth(apiBase, healthTimeoutMs = 5_000) {
  try {
    const res = await fetch(`${apiBase}/health`, { signal: AbortSignal.timeout(healthTimeoutMs) });
    if (!res.ok) return { status: "busy" };
    return { status: "ok", health: await res.json() };
  } catch (err) {
    const code = err && (err.code || (err.cause && err.cause.code));
    if (DOWN_CODES.has(code)) return { status: "down" };
    return { status: "busy" };
  }
}

/**
 * REST-backed note store. `notebookId` is scalar | array | null - only
 * `listNotes`, `createNote`, and `search` scope to it; `getNote`/
 * `updateNote`/`softDeleteNote` operate on a note id directly and work with
 * `notebookId` left unset (that's what tools/notebook-links relies on: it
 * updates a specific note's content without being scoped to one notebook).
 *
 * Normalized internally to:
 *   - `readIds`: null when unset (unscoped), else a deduped array of truthy
 *     ids from `[].concat(notebookId)`. `listNotes`/`search` cover all of
 *     `readIds`.
 *   - `writeId`: `readIds ? readIds[0] : null` - the default create target.
 */
export function httpNoteStore(apiBase, notebookId, requestTimeoutMs = 10_000) {
  const readIds = notebookId == null ? null : [...new Set([].concat(notebookId).filter(Boolean))];
  const writeId = readIds ? readIds[0] : null;

  const store = { offline: false, wrote: false };
  const fetchJson = (pathAndQuery, options) => apiFetchJson(apiBase, pathAndQuery, options, requestTimeoutMs);

  store.listNotes = async () => {
    if (!readIds) return fetchJson("/api/v1/notes");
    if (readIds.length === 1) return fetchJson(`/api/v1/notes?notebook_id=${readIds[0]}`);
    // Multiple notebooks: fetch each separately rather than an unfiltered
    // list + client-side filter - the Dev DB is large (~880MB) and some
    // notebooks (e.g. "My Notes") hold dozens of notes we'd otherwise pull
    // across the wire for nothing.
    const results = await Promise.all(readIds.map((id) => fetchJson(`/api/v1/notes?notebook_id=${id}`)));
    return results.flat();
  };

  store.getNote = async (id) => {
    try {
      return await fetchJson(`/api/v1/notes/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  };

  store.findByExactTitle = async (title, targetNotebookId) => {
    const notes = await store.listNotes();
    const found = notes.find((n) => n.title === title && (!targetNotebookId || n.notebook_id === targetNotebookId));
    return found ? { id: found.id, title: found.title, notebook_id: found.notebook_id } : null;
  };

  store.createNote = async (title, contentHtml, targetNotebookId) => {
    let destNotebookId;
    if (targetNotebookId) {
      if (!readIds || !readIds.includes(targetNotebookId)) {
        throw new Error(`httpNoteStore.createNote: notebook ${targetNotebookId} is not one of the scoped notebooks.`);
      }
      destNotebookId = targetNotebookId;
    } else {
      destNotebookId = writeId;
    }
    if (!destNotebookId) throw new Error("httpNoteStore.createNote requires a notebookId.");
    const created = await fetchJson("/api/v1/notes", {
      method: "POST",
      body: JSON.stringify({ notebook_id: destNotebookId, title, content: contentHtml }),
    });
    store.wrote = true;
    return created;
  };

  store.updateNote = async (id, contentHtml) => {
    const updated = await fetchJson(`/api/v1/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ content: contentHtml }),
    });
    store.wrote = true;
    return updated;
  };

  store.renameNote = async (id, title) => {
    const updated = await fetchJson(`/api/v1/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ title }),
    });
    store.wrote = true;
    return updated;
  };

  store.softDeleteNote = async (id) => {
    await fetchJson(`/api/v1/notes/${id}`, { method: "DELETE" });
    store.wrote = true;
  };

  store.search = async (query, limit) => {
    if (!readIds) {
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      return fetchJson(`/api/v1/search?${params.toString()}`);
    }
    if (readIds.length === 1) {
      const params = new URLSearchParams({ q: query, limit: String(limit), notebook_id: readIds[0] });
      return fetchJson(`/api/v1/search?${params.toString()}`);
    }
    // Multiple notebooks: run the search once per notebook (same limit) and
    // concatenate + slice. Cross-notebook relevance ranking is only
    // approximate this way, since the API ranks results per-query rather
    // than across a combined result set.
    const results = await Promise.all(
      readIds.map((id) => {
        const params = new URLSearchParams({ q: query, limit: String(limit), notebook_id: id });
        return fetchJson(`/api/v1/search?${params.toString()}`);
      })
    );
    const notes = results.flatMap((r) => r.notes).slice(0, limit);
    return { notes };
  };

  store.close = () => {};

  return store;
}

/** Thin re-export so callers only need one import for both transports. */
export function sqliteNoteStore(dbPath, notebookId) {
  return createSqliteStore(dbPath, notebookId);
}

function buildSqliteNoteStore({ envDb, cachedDbPath, notebookId }) {
  const opts = { envDb, cachedDbPath };
  const dbPath = resolveDbPath(opts);
  if (!dbPath) {
    const tried = candidateDbPaths(opts);
    throw new SqliteError(
      "Notebook app isn't running and no SQLite database could be found offline. Tried:\n" +
        tried.map((p) => `  - ${p}`).join("\n") +
        "\nStart the Notebook app, or point this tool at the database file explicitly."
    );
  }
  try {
    return sqliteNoteStore(dbPath, notebookId);
  } catch (err) {
    throw new SqliteError(`Could not open the offline database at ${dbPath}: ${err.message}`);
  }
}

/**
 * Resolves a note store: HTTP when `GET {apiBase}/health` answers within
 * `healthTimeoutMs` (retried per `retryDelaysMs` while the API is merely
 * busy, never while it's confirmed down), direct SQLite otherwise. Throws
 * `ApiError` if the API is busy for the entire retry budget (refusing to
 * write behind a live app's back) or `SqliteError` if SQLite mode can't find
 * a database.
 *
 * `notebookId` is scalar | array | null (see {@link httpNoteStore}); pass
 * `null` for tools that only read/update notes by id. When an array is
 * given, the FIRST element is the default write target (used by
 * `createNote` when no explicit target notebook is passed).
 */
export async function resolveNoteTransport({
  apiBase,
  notebookId = null,
  envDb,
  cachedDbPath,
  forceSqlite = false,
  healthTimeoutMs = 5_000,
  retryDelaysMs = [1_000, 2_000, 4_000],
  requestTimeoutMs = 10_000,
  onHealthOk,
  log = () => {},
}) {
  if (forceSqlite) return buildSqliteNoteStore({ envDb, cachedDbPath, notebookId });

  let result = await checkHealth(apiBase, healthTimeoutMs);
  for (const delay of retryDelaysMs) {
    if (result.status !== "busy") break;
    log(`API at ${apiBase} did not answer /health in ${healthTimeoutMs}ms; retrying in ${delay}ms`);
    await sleep(delay);
    result = await checkHealth(apiBase, healthTimeoutMs);
  }

  if (result.status === "ok") {
    onHealthOk?.(result.health);
    return httpNoteStore(apiBase, notebookId, requestTimeoutMs);
  }
  if (result.status === "down") {
    return buildSqliteNoteStore({ envDb, cachedDbPath, notebookId });
  }

  const waited = ((healthTimeoutMs * (retryDelaysMs.length + 1) + retryDelaysMs.reduce((a, b) => a + b, 0)) / 1000).toFixed(0);
  throw new ApiError(
    `The Notebook API at ${apiBase} is running but did not answer /health within ~${waited}s. ` +
      "Refusing this operation rather than writing directly to the database behind the running app, " +
      "which would produce a note the app cannot see and may overwrite. " +
      "Wait for the app to finish what it is doing and retry, or force SQLite mode to override deliberately."
  );
}
