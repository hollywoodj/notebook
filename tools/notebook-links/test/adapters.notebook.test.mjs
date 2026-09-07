import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { notebookAdapter } from "../adapters/notebook.mjs";
import { makeTempDir, cleanupTempDir, createFixtureNotebookDb } from "./helpers.mjs";

// Force the SQLite fallback path deterministically: point NOTEBOOK_API at a
// port nothing listens on (fast ECONNREFUSED, no timeout wait) so the
// adapter's health check fails and it falls back to node:sqlite.
function withOfflineNotebookDb(notes, fn) {
  const dir = makeTempDir("notebook-links-notebook-db-");
  const dbPath = path.join(dir, "notebook.db");
  createFixtureNotebookDb(dbPath, notes);
  const prevApi = process.env.NOTEBOOK_API;
  const prevDb = process.env.NOTEBOOK_DB;
  process.env.NOTEBOOK_API = "http://127.0.0.1:39217"; // nothing listens here
  process.env.NOTEBOOK_DB = dbPath;
  const restore = () => {
    if (prevApi === undefined) delete process.env.NOTEBOOK_API;
    else process.env.NOTEBOOK_API = prevApi;
    if (prevDb === undefined) delete process.env.NOTEBOOK_DB;
    else process.env.NOTEBOOK_DB = prevDb;
    cleanupTempDir(dir);
  };
  return Promise.resolve(fn(dbPath)).finally(restore);
}

test("resolve reads an existing note through the SQLite fallback", async () => {
  await withOfflineNotebookDb(
    [{ id: "n1", title: "Grocery list", content: "<p>Milk, eggs</p>" }],
    async () => {
      const entity = await notebookAdapter.resolve({ app: "notebook", kind: "note", id: "n1" });
      assert.equal(entity.exists, true);
      assert.equal(entity.title, "Grocery list");
      assert.equal(entity.url, "notebook://note/n1");
      assert.match(entity.subtitle, /Milk, eggs/);
    }
  );
});

test("resolve returns exists:false for a note id that isn't in the database", async () => {
  await withOfflineNotebookDb([{ id: "n1", title: "A", content: "<p>a</p>" }], async () => {
    const entity = await notebookAdapter.resolve({ app: "notebook", kind: "note", id: "missing" });
    assert.equal(entity.exists, false);
  });
});

test("resolve treats a soft-deleted note as not existing", async () => {
  await withOfflineNotebookDb(
    [{ id: "n1", title: "Gone", content: "<p>x</p>", deletedAt: new Date().toISOString() }],
    async () => {
      const entity = await notebookAdapter.resolve({ app: "notebook", kind: "note", id: "n1" });
      assert.equal(entity.exists, false);
    }
  );
});

test("list returns notes ordered most-recently-updated first, respecting limit", async () => {
  await withOfflineNotebookDb(
    [
      { id: "n1", title: "First", content: "<p>1</p>", updatedAt: "2026-01-01T00:00:00.000Z" },
      { id: "n2", title: "Second", content: "<p>2</p>", updatedAt: "2026-02-01T00:00:00.000Z" },
    ],
    async () => {
      const entities = await notebookAdapter.list("note", { limit: 1 });
      assert.equal(entities.length, 1);
      assert.equal(entities[0].ref, "notebook://note/n2");
    }
  );
});

test("list with a query uses the FTS index", async () => {
  await withOfflineNotebookDb(
    [
      { id: "n1", title: "Grocery list", content: "<p>Milk and eggs</p>" },
      { id: "n2", title: "Trip plan", content: "<p>Flights and hotels</p>" },
    ],
    async () => {
      const entities = await notebookAdapter.list("note", { query: "milk" });
      assert.equal(entities.length, 1);
      assert.equal(entities[0].ref, "notebook://note/n1");
    }
  );
});

test("health reports the sqlite transport with the resolved db path", async () => {
  await withOfflineNotebookDb([], async (dbPath) => {
    const health = await notebookAdapter.health();
    assert.equal(health.ok, true);
    assert.equal(health.transport, "sqlite");
    assert.equal(health.detail, dbPath);
  });
});

test("health reports not-ok when neither the API nor a local db is reachable", async () => {
  const prevApi = process.env.NOTEBOOK_API;
  const prevDb = process.env.NOTEBOOK_DB;
  const prevAppData = process.env.APPDATA;
  process.env.NOTEBOOK_API = "http://127.0.0.1:39217";
  process.env.NOTEBOOK_DB = path.join(makeTempDir("notebook-links-nodb-"), "does-not-exist.db");
  // candidateDbPaths always also tries %APPDATA%\{notebook-desktop,notebook}\
  // notebook.db as a fallback - on a machine with the real app installed,
  // that path genuinely exists, so this test must redirect APPDATA to an
  // empty temp dir to be a true "nothing reachable" case rather than an
  // accidental read of this machine's real database.
  process.env.APPDATA = makeTempDir("notebook-links-empty-appdata-");
  try {
    const health = await notebookAdapter.health();
    assert.equal(health.ok, false);
    assert.equal(health.transport, "none");
  } finally {
    if (prevApi === undefined) delete process.env.NOTEBOOK_API;
    else process.env.NOTEBOOK_API = prevApi;
    if (prevDb === undefined) delete process.env.NOTEBOOK_DB;
    else process.env.NOTEBOOK_DB = prevDb;
    if (prevAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = prevAppData;
  }
});
