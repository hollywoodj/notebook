// Link storage via Node's built-in `node:sqlite` (zero new dependencies),
// mirroring how tools/notebook-mcp/sqlite.mjs talks to SQLite directly.
//
// A "link" is an edge between two refs (see refs.mjs), stored once
// regardless of which order the caller named the endpoints in, for
// relations that are symmetric (v1 has exactly one: `related`). Every read
// returns edges as a union of both `src_*` and `dst_*` columns, normalized
// so callers never need to know which column a given ref landed in.

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";
import { randomUUID } from "node:crypto";
import { formatRef, parseRef } from "./refs.mjs";

// ---------------------------------------------------------------------------
// Relation registry - v1 has one relation, symmetric. Adding an asymmetric
// relation later (e.g. `blocks`) is a one-line addition here; addLink/
// removeLink/listLinks already branch on `.symmetric` rather than assuming it.
// ---------------------------------------------------------------------------

export const RELATIONS = {
  related: { symmetric: true },
};

export function isKnownRelation(rel) {
  return Object.prototype.hasOwnProperty.call(RELATIONS, rel);
}

export function knownRelations() {
  return Object.keys(RELATIONS);
}

// ---------------------------------------------------------------------------
// DB path resolution: LINKS_DB env var, else <appdata>/notebook-links/links.db.
// Same platform app-data logic as notebook-mcp/sqlite.mjs's appDataDir().
// ---------------------------------------------------------------------------

function appDataDir() {
  if (process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support");
  return path.join(os.homedir(), ".local", "share");
}

export function defaultDbPath() {
  return path.join(appDataDir(), "notebook-links", "links.db");
}

export function resolveStoreDbPath(envDb = process.env.LINKS_DB) {
  return envDb && envDb.trim() ? envDb : defaultDbPath();
}

function nowIso() {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Schema + migrations. v1 has nothing to migrate *from*, but the hook exists
// so a v2 (e.g. an asymmetric relation needing a new column) has somewhere
// to go without reworking callers.
// ---------------------------------------------------------------------------

const MIGRATIONS = [
  {
    version: "1",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS links (
          id TEXT PRIMARY KEY,
          src_app TEXT NOT NULL, src_kind TEXT NOT NULL, src_id TEXT NOT NULL,
          dst_app TEXT NOT NULL, dst_kind TEXT NOT NULL, dst_id TEXT NOT NULL,
          rel TEXT NOT NULL DEFAULT 'related',
          note TEXT,
          created_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_links_edge
          ON links(src_app,src_kind,src_id,dst_app,dst_kind,dst_id,rel);
        CREATE INDEX IF NOT EXISTS idx_links_src ON links(src_app,src_kind,src_id);
        CREATE INDEX IF NOT EXISTS idx_links_dst ON links(dst_app,dst_kind,dst_id);
      `);
    },
  },
];

function currentSchemaVersion(db) {
  const row = db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
  return row ? row.value : "0";
}

function setSchemaVersion(db, version) {
  db.prepare(
    "INSERT INTO schema_meta (key, value) VALUES ('schema_version', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(version);
}

function migrate(db) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let current = currentSchemaVersion(db);
  for (const migration of MIGRATIONS) {
    // Version strings are single digits for the foreseeable future; string
    // compare is fine and avoids parseInt edge cases.
    if (migration.version <= current) continue;
    migration.up(db);
    setSchemaVersion(db, migration.version);
    current = migration.version;
  }
}

// ---------------------------------------------------------------------------
// Ordering: for a symmetric relation, sort the two endpoints by their
// canonical ref string so `add A B` and `add B A` land in the same row.
// ---------------------------------------------------------------------------

function orderEndpoints(a, b, relDef) {
  if (relDef.symmetric && formatRef(b) < formatRef(a)) return [b, a];
  return [a, b];
}

function rowOther(row, ref) {
  const isSrc = row.src_app === ref.app && row.src_kind === ref.kind && row.src_id === ref.id;
  const other = isSrc
    ? { app: row.dst_app, kind: row.dst_kind, id: row.dst_id }
    : { app: row.src_app, kind: row.src_kind, id: row.src_id };
  return { other, direction: isSrc ? "outgoing" : "incoming" };
}

function normalizeRow(row, ref) {
  const { other, direction } = rowOther(row, ref);
  return {
    other: formatRef(other),
    rel: row.rel,
    note: row.note,
    createdAt: row.created_at,
    direction,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * Opens (creating parent dirs and running migrations as needed) the link
 * store at `dbPath`.
 */
export function openStore(dbPath = resolveStoreDbPath()) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  migrate(db);

  /** Adds (or no-ops idempotently on) an edge between two refs. */
  function add(refARaw, refBRaw, { rel = "related", note } = {}) {
    if (!isKnownRelation(rel)) {
      throw new Error(`Unknown relation "${rel}". Known relations: ${knownRelations().join(", ")}.`);
    }
    const a = parseRef(refARaw);
    const b = parseRef(refBRaw);
    if (formatRef(a) === formatRef(b)) {
      throw new Error(`Cannot link ${formatRef(a)} to itself.`);
    }
    const relDef = RELATIONS[rel];
    const [src, dst] = orderEndpoints(a, b, relDef);
    const existing = db
      .prepare(
        "SELECT id FROM links WHERE src_app=? AND src_kind=? AND src_id=? " +
          "AND dst_app=? AND dst_kind=? AND dst_id=? AND rel=?"
      )
      .get(src.app, src.kind, src.id, dst.app, dst.kind, dst.id, rel);
    if (existing) {
      return { created: false, id: existing.id, message: "already linked" };
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO links (id, src_app, src_kind, src_id, dst_app, dst_kind, dst_id, rel, note, created_at) " +
        "VALUES (?,?,?,?,?,?,?,?,?,?)"
    ).run(id, src.app, src.kind, src.id, dst.app, dst.kind, dst.id, rel, note ?? null, nowIso());
    return { created: true, id, message: "linked" };
  }

  /**
   * Removes edge(s). With both refs, removes the (at most one) edge between
   * them (filtered to `rel` if given). With only `refARaw`, removes every
   * edge touching it (filtered to `rel` if given).
   */
  function remove(refARaw, refBRaw, { rel } = {}) {
    const a = parseRef(refARaw);
    if (!refBRaw) {
      const params = [a.app, a.kind, a.id, a.app, a.kind, a.id];
      let sql =
        "DELETE FROM links WHERE ((src_app=? AND src_kind=? AND src_id=?) OR (dst_app=? AND dst_kind=? AND dst_id=?))";
      if (rel) {
        sql += " AND rel=?";
        params.push(rel);
      }
      const info = db.prepare(sql).run(...params);
      return { removed: info.changes };
    }
    const b = parseRef(refBRaw);
    const params = [
      a.app, a.kind, a.id, b.app, b.kind, b.id,
      b.app, b.kind, b.id, a.app, a.kind, a.id,
    ];
    let sql =
      "DELETE FROM links WHERE " +
      "((src_app=? AND src_kind=? AND src_id=? AND dst_app=? AND dst_kind=? AND dst_id=?) OR " +
      "(src_app=? AND src_kind=? AND src_id=? AND dst_app=? AND dst_kind=? AND dst_id=?))";
    if (rel) {
      sql += " AND rel=?";
      params.push(rel);
    }
    const info = db.prepare(sql).run(...params);
    return { removed: info.changes };
  }

  /** Lists edges touching `refRaw`, normalized to `{ other, rel, note, createdAt, direction }`. */
  function list(refRaw, { rel, limit } = {}) {
    const ref = parseRef(refRaw);
    const params = [ref.app, ref.kind, ref.id, ref.app, ref.kind, ref.id];
    let sql =
      "SELECT * FROM links WHERE ((src_app=? AND src_kind=? AND src_id=?) OR (dst_app=? AND dst_kind=? AND dst_id=?))";
    if (rel) {
      sql += " AND rel=?";
      params.push(rel);
    }
    sql += " ORDER BY created_at DESC";
    if (limit) {
      sql += " LIMIT ?";
      params.push(limit);
    }
    const rows = db.prepare(sql).all(...params);
    return rows.map((row) => normalizeRow(row, ref));
  }

  /** Every stored edge, for `doctor` to walk when checking for dangling links. */
  function all() {
    const rows = db.prepare("SELECT * FROM links ORDER BY created_at DESC").all();
    return rows.map((row) => ({
      src: formatRef({ app: row.src_app, kind: row.src_kind, id: row.src_id }),
      dst: formatRef({ app: row.dst_app, kind: row.dst_kind, id: row.dst_id }),
      rel: row.rel,
      note: row.note,
      createdAt: row.created_at,
    }));
  }

  function count() {
    return db.prepare("SELECT COUNT(*) AS n FROM links").get().n;
  }

  function schemaVersion() {
    return db.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get()?.value ?? null;
  }

  return { path: dbPath, add, remove, list, all, count, schemaVersion, close: () => db.close() };
}
