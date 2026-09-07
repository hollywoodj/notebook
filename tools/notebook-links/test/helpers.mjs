// Shared test fixtures: a minimal, throwaway notebook.db (subset of
// crates/notebook-core/migrations/001_initial.sql - just enough for the
// notes/notes_fts tables sqlite.mjs and noteTransport.mjs touch) and a
// scratch temp-dir helper. Every test using these writes only to `os.tmpdir()`
// subdirectories - never anything under a real app's appdata.

import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function makeTempDir(prefix) {
  return mkdtempSync(path.join(tmpdir(), prefix));
}

export function cleanupTempDir(dir) {
  rmSync(dir, { recursive: true, force: true });
}

/** Creates a fresh SQLite file at `dbPath` with the columns/FTS setup
 * sqlite.mjs's createSqliteStore and noteTransport.mjs's httpNoteStore
 * counterpart both expect, and seeds it with `notes` (array of partial note
 * fields; id/title/content required). */
export function createFixtureNotebookDb(dbPath, notes = []) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE notebooks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      notebook_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      content_plain TEXT NOT NULL DEFAULT '',
      is_pinned INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      reminder_at TEXT,
      source_url TEXT,
      latitude REAL,
      longitude REAL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      is_template INTEGER NOT NULL DEFAULT 0,
      template_category TEXT,
      template_key TEXT
    );
    CREATE TABLE note_revisions (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      note_id UNINDEXED,
      title,
      content_plain,
      tokenize = 'porter unicode61'
    );
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(note_id, title, content_plain) VALUES (new.id, new.title, new.content_plain);
    END;
    CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
      DELETE FROM notes_fts WHERE note_id = old.id;
    END;
    CREATE TRIGGER notes_au AFTER UPDATE OF title, content_plain ON notes BEGIN
      DELETE FROM notes_fts WHERE note_id = old.id;
      INSERT INTO notes_fts(note_id, title, content_plain) VALUES (new.id, new.title, new.content_plain);
    END;
  `);
  db.prepare("INSERT INTO users (id) VALUES ('user-1')").run();
  db.prepare("INSERT INTO notebooks (id, user_id) VALUES ('notebook-1', 'user-1')").run();
  const insert = db.prepare(
    "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, created_at, updated_at, deleted_at) " +
      "VALUES (?, 'user-1', 'notebook-1', ?, ?, ?, ?, ?, ?)"
  );
  const now = new Date().toISOString();
  for (const note of notes) {
    insert.run(
      note.id,
      note.title ?? "",
      note.content ?? "",
      note.contentPlain ?? (note.content ?? "").replace(/<[^>]+>/g, ""),
      note.createdAt ?? now,
      note.updatedAt ?? now,
      note.deletedAt ?? null
    );
  }
  db.close();
}
