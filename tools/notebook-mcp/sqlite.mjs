// Offline transport: talks directly to the Notebook SQLite database via
// Node's built-in `node:sqlite` (zero new dependencies) when the app / API
// isn't running. Mirrors the subset of `crates/notebook-core/src/service.rs`
// (create_note, update_note, save_revision, delete_note) and
// `crates/notebook-core/src/content/plain.rs` (strip_html) that this server
// needs, plus the FTS query shape from `crates/notebook-core/src/search.rs`.
//
// Schema knowledge here reflects every migration in
// `crates/notebook-core/migrations/` PLUS the programmatic column-add step in
// `crates/notebook-core/src/db.rs` (`migrate_template_columns`: is_template,
// template_category, template_key added via ALTER TABLE, not a .sql file).
//
// FTS needs no manual maintenance: the notes_ai/notes_ad/notes_au triggers
// from migrations/001_initial.sql keep notes_fts in sync on every INSERT/
// UPDATE/DELETE against `notes`, regardless of which process issues them
// (db.rs:246 in the Rust source explains why). This module never touches
// notes_fts directly.

import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import process from "node:process";

// ---------------------------------------------------------------------------
// DB path resolution
// ---------------------------------------------------------------------------

function appDataDir() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return path.join(os.homedir(), ".local", "share");
}

/** Candidate DB paths, in resolution order. Exported so callers can report
 * every path that was tried when none exist. */
export function candidateDbPaths({ envDb, cachedDbPath } = {}) {
  const dir = appDataDir();
  const candidates = [];
  if (envDb) candidates.push(envDb);
  if (cachedDbPath && cachedDbPath !== envDb) candidates.push(cachedDbPath);
  candidates.push(path.join(dir, "notebook-desktop", "notebook.db"));
  candidates.push(path.join(dir, "notebook", "notebook.db"));
  // De-dupe while preserving order (envDb / cachedDbPath may coincide with a default).
  return [...new Set(candidates.filter(Boolean))];
}

/** First candidate that exists on disk, or null if none do. */
export function resolveDbPath(opts) {
  for (const p of candidateDbPaths(opts)) {
    if (existsSync(p)) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// strip_html mirror (crates/notebook-core/src/content/plain.rs)
// ---------------------------------------------------------------------------

const STRIP_HTML_BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "br", "div", "figcaption", "figure",
  "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "li", "main", "nav", "ol",
  "p", "pre", "section", "table", "td", "th", "tr", "ul",
]);

function entityToChar(body) {
  switch (body) {
    case "amp": return "&";
    case "lt": return "<";
    case "gt": return ">";
    case "quot": return '"';
    case "apos": return "'";
    case "nbsp": return " ";
    default: {
      if (!body.startsWith("#")) return null;
      const digits = body.slice(1);
      let code;
      if (digits[0] === "x" || digits[0] === "X") {
        const hex = digits.slice(1);
        if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
        code = parseInt(hex, 16);
      } else {
        if (!/^[0-9]+$/.test(digits)) return null;
        code = parseInt(digits, 10);
      }
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return null;
      try {
        return String.fromCodePoint(code);
      } catch {
        return null;
      }
    }
  }
}

function decodeXmlEntitiesOnce(input) {
  let out = "";
  let rest = input;
  for (;;) {
    const start = rest.indexOf("&");
    if (start === -1) {
      out += rest;
      break;
    }
    out += rest.slice(0, start);
    rest = rest.slice(start);
    const end = rest.indexOf(";");
    if (end === -1) {
      out += rest;
      break;
    }
    const body = rest.slice(1, end);
    const decoded = entityToChar(body);
    if (decoded !== null) {
      out += decoded;
      rest = rest.slice(end + 1);
    } else {
      out += "&";
      rest = rest.slice(1);
    }
  }
  return out;
}

/** Mirrors `decode_xml_entities` (entities.rs): decode, and if the result
 * still contains `&`, decode once more (handles double-encoded entities). */
export function decodeXmlEntities(input) {
  const once = decodeXmlEntitiesOnce(input);
  return once.includes("&") ? decodeXmlEntitiesOnce(once) : once;
}

/** Mirrors `strip_html` (plain.rs) exactly: inserts a space before certain
 * block-level tags (unless output already ends in whitespace), decodes
 * entities from the tag-stripped text, then collapses whitespace runs. */
export function stripHtml(html) {
  let out = "";
  let inTag = false;
  let tag = "";
  for (const ch of html) {
    if (ch === "<") {
      inTag = true;
      tag = "";
      continue;
    }
    if (ch === ">" && inTag) {
      inTag = false;
      const name = tag.replace(/^\//, "").split(/[\s/]/)[0].toLowerCase();
      const last = out.length ? out[out.length - 1] : null;
      if (STRIP_HTML_BLOCK_TAGS.has(name) && last !== null && !/\s/.test(last)) {
        out += " ";
      }
      continue;
    }
    if (inTag) {
      tag += ch;
      continue;
    }
    out += ch;
  }
  const decoded = decodeXmlEntities(out);
  return decoded.split(/\s+/).filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Timestamps: RFC3339 UTC, matching the shape service.rs's `now()` writes
// (Utc::now().to_rfc3339(): "+00:00" offset, not "Z").
// ---------------------------------------------------------------------------

export function nowRfc3339() {
  return new Date().toISOString().replace("Z", "+00:00");
}

// ---------------------------------------------------------------------------
// Store: same interface server.mjs's HTTP store exposes, backed directly by
// SQLite. One instance per tool call; server.mjs calls close() when done.
// ---------------------------------------------------------------------------

const NOTE_COLUMNS =
  "id, user_id, notebook_id, title, content, content_plain, is_pinned, is_archived, " +
  "reminder_at, source_url, latitude, longitude, created_at, updated_at, deleted_at, " +
  "is_template, template_category, template_key";

function rowToNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    notebook_id: row.notebook_id,
    title: row.title,
    content: row.content,
    content_plain: row.content_plain,
    is_pinned: !!row.is_pinned,
    is_archived: !!row.is_archived,
    reminder_at: row.reminder_at,
    source_url: row.source_url,
    latitude: row.latitude,
    longitude: row.longitude,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
    is_template: !!row.is_template,
    template_category: row.template_category,
    template_key: row.template_key,
  };
}

/**
 * Opens `dbPath` and returns a store object shaped like server.mjs's HTTP
 * store: listNotes/getNote/findByExactTitle/createNote/updateNote/
 * renameNote/softDeleteNote/search, plus `offline: true`, a `wrote` flag the
 * caller can inspect after the call, and `close()`.
 *
 * `notebookId` is scalar | array | null. Normalized to:
 *   - `readIds`: null when the arg is null/undefined (unscoped - every
 *     notebook is visible), else a deduped array of truthy ids from
 *     `[].concat(arg)`. Read/list/search operate across all of `readIds`.
 *   - `writeId`: `readIds ? readIds[0] : null` - the default create target
 *     when no explicit target is given to createNote.
 */
export function createSqliteStore(dbPath, notebookId) {
  const readIds = notebookId == null ? null : [...new Set([].concat(notebookId).filter(Boolean))];
  const writeId = readIds ? readIds[0] : null;

  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000"); // only pragma we touch - the Rust side owns the rest.

  function notebookUserId() {
    const row = db.prepare("SELECT user_id FROM notebooks WHERE id = ?").get(writeId);
    if (!row) {
      throw new Error(`Notebook ${writeId} was not found in ${dbPath}.`);
    }
    return row.user_id;
  }

  function getNoteRow(id) {
    return db.prepare(`SELECT ${NOTE_COLUMNS} FROM notes WHERE id = ?`).get(id);
  }

  function insertRevision(noteId, title, content, now) {
    db.prepare(
      "INSERT INTO note_revisions (id, note_id, title, content, created_at) VALUES (?, ?, ?, ?, ?)"
    ).run(randomUUID(), noteId, title, content, now);
  }

  const store = { offline: true, wrote: false };

  store.listNotes = async () => {
    let where = "deleted_at IS NULL AND COALESCE(is_template, 0) = 0";
    const params = [];
    if (readIds) {
      where += ` AND notebook_id IN (${readIds.map(() => "?").join(", ")})`;
      params.push(...readIds);
    }
    const rows = db
      .prepare(
        `SELECT id, title, notebook_id, updated_at FROM notes WHERE ${where} ` +
          "ORDER BY is_pinned DESC, updated_at DESC"
      )
      .all(...params);
    return rows.map((r) => ({ id: r.id, title: r.title, notebook_id: r.notebook_id, updated_at: r.updated_at }));
  };

  store.getNote = async (id) => rowToNote(getNoteRow(id));

  store.findByExactTitle = async (title, targetNotebookId) => {
    let where = "title = ? AND deleted_at IS NULL";
    const params = [title];
    if (targetNotebookId) {
      where += " AND notebook_id = ?";
      params.push(targetNotebookId);
    } else if (readIds) {
      where += ` AND notebook_id IN (${readIds.map(() => "?").join(", ")})`;
      params.push(...readIds);
    }
    const row = db.prepare(`SELECT id, title, notebook_id FROM notes WHERE ${where} LIMIT 1`).get(...params);
    return row ? { id: row.id, title: row.title, notebook_id: row.notebook_id } : null;
  };

  store.createNote = async (title, contentHtml, targetNotebookId) => {
    let destNotebookId;
    if (targetNotebookId) {
      if (!readIds || !readIds.includes(targetNotebookId)) {
        throw new Error(`createNote: notebook ${targetNotebookId} is not one of the scoped notebooks.`);
      }
      destNotebookId = targetNotebookId;
    } else {
      destNotebookId = writeId;
    }
    const id = randomUUID();
    const now = nowRfc3339();
    const userId = notebookUserId();
    const contentPlain = stripHtml(contentHtml);
    db.exec("BEGIN");
    try {
      db.prepare(
        "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, is_pinned, " +
          "reminder_at, source_url, is_template, template_category, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, 0, NULL, ?, ?)"
      ).run(id, userId, destNotebookId, title, contentHtml, contentPlain, now, now);
      insertRevision(id, title, contentHtml, now);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    store.wrote = true;
    return rowToNote(getNoteRow(id));
  };

  store.updateNote = async (id, contentHtml) => {
    const existing = db.prepare("SELECT title FROM notes WHERE id = ?").get(id);
    if (!existing) throw new Error(`Note ${id} not found in ${dbPath}.`);
    const now = nowRfc3339();
    const contentPlain = stripHtml(contentHtml);
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE notes SET content = ?, content_plain = ?, updated_at = ? WHERE id = ?").run(
        contentHtml,
        contentPlain,
        now,
        id
      );
      insertRevision(id, existing.title, contentHtml, now);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    store.wrote = true;
    return rowToNote(getNoteRow(id));
  };

  store.renameNote = async (id, title) => {
    const existing = db.prepare("SELECT title, content FROM notes WHERE id = ?").get(id);
    if (!existing) throw new Error(`Note ${id} not found in ${dbPath}.`);
    const now = nowRfc3339();
    db.exec("BEGIN");
    try {
      db.prepare("UPDATE notes SET title = ?, updated_at = ? WHERE id = ?").run(title, now, id);
      insertRevision(id, title, existing.content, now);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    store.wrote = true;
    return rowToNote(getNoteRow(id));
  };

  store.softDeleteNote = async (id) => {
    const now = nowRfc3339();
    db.prepare("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(
      now,
      now,
      id
    );
    store.wrote = true;
  };

  store.search = async (query, limit) => {
    const terms = query
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replace(/"/g, '""')}"*`);
    const ftsQuery = terms.join(" AND ");
    if (!ftsQuery) return { notes: [] };
    let where = "n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0 AND n.id IN (SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?)";
    const params = [ftsQuery];
    if (readIds) {
      where += ` AND n.notebook_id IN (${readIds.map(() => "?").join(", ")})`;
      params.push(...readIds);
    }
    const rows = db
      .prepare(`SELECT n.id, n.title, n.notebook_id, n.content_plain FROM notes n WHERE ${where} ORDER BY n.updated_at DESC LIMIT ?`)
      .all(...params, limit);
    return {
      notes: rows.map((r) => ({ id: r.id, title: r.title, notebook_id: r.notebook_id, snippet: r.content_plain.slice(0, 200) })),
    };
  };

  store.close = () => db.close();

  return store;
}
