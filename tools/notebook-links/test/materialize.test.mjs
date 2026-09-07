import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../store.mjs";
import { materializeRef, materializeEdge } from "../materialize.mjs";
import { inboxDir, resolveBridgeDir } from "../omnicloneQueue.mjs";
import { makeTempDir, cleanupTempDir, createFixtureNotebookDb } from "./helpers.mjs";

function withEnv(vars, fn) {
  const prev = {};
  for (const key of Object.keys(vars)) prev[key] = process.env[key];
  Object.assign(process.env, vars);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const key of Object.keys(vars)) {
        if (prev[key] === undefined) delete process.env[key];
        else process.env[key] = prev[key];
      }
    });
}

function readNoteRow(dbPath, id) {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT content, updated_at FROM notes WHERE id = ?").get(id);
  db.close();
  return row;
}

function countRevisions(dbPath, noteId) {
  const db = new DatabaseSync(dbPath);
  const row = db.prepare("SELECT COUNT(*) AS n FROM note_revisions WHERE note_id = ?").get(noteId);
  db.close();
  return row.n;
}

test("materializing a notebook note writes a visible block linking to the other side", async () => {
  const dir = makeTempDir("notebook-links-materialize-");
  const dbPath = path.join(dir, "notebook.db");
  createFixtureNotebookDb(dbPath, [{ id: "n1", title: "My Note", content: "<p>Body.</p>" }]);
  const storeDir = makeTempDir("notebook-links-materialize-store-");
  const store = openStore(path.join(storeDir, "links.db"));
  const snapshotDir = makeTempDir("notebook-links-materialize-snap-");
  const snapshotPath = path.join(snapshotDir, "snapshot.json");
  writeFileSync(
    snapshotPath,
    JSON.stringify({
      schema: 1,
      app: "omniclone",
      exportedAt: new Date().toISOString(),
      projects: [{ id: "p1", name: "Website Redesign", folder: null, status: "active" }],
      counts: { projects: 1, tasks: 0 },
    })
  );

  try {
    await withEnv(
      {
        NOTEBOOK_API: "http://127.0.0.1:39217",
        NOTEBOOK_DB: dbPath,
        LINKS_OMNICLONE_SNAPSHOT: snapshotPath,
      },
      async () => {
        store.add("notebook://note/n1", "omniclone://project/p1");

        const outcome = await materializeRef(store, "notebook://note/n1");
        assert.equal(outcome.changed, true);
        const row = readNoteRow(dbPath, "n1");
        assert.match(row.content, /notebook-links:begin/);
        assert.match(row.content, /omniclone:\/\/project\/p1/);
        assert.match(row.content, /Website Redesign/);
        assert.ok(row.content.startsWith("<p>Body.</p>"), "original note body must be untouched");
        // The fixture db seeds the note directly with no initial revision
        // (unlike a real note create, which does write one) - so the single
        // materializing write above is expected to be the note's only
        // revision so far.
        assert.equal(countRevisions(dbPath, "n1"), 1, "the materializing write must land as a normal revision");

        // Repeat sync with nothing changed must be byte-identical - no write,
        // no new revision (mirrors overview.test.mjs's "BYTE-IDENTICAL" test).
        const before = readNoteRow(dbPath, "n1");
        const second = await materializeRef(store, "notebook://note/n1");
        assert.equal(second.changed, false);
        const after = readNoteRow(dbPath, "n1");
        assert.equal(after.content, before.content, "repeat sync must be byte-identical");
        assert.equal(countRevisions(dbPath, "n1"), 1, "a no-op sync must not create a new revision");
      }
    );
  } finally {
    store.close();
    cleanupTempDir(dir);
    cleanupTempDir(storeDir);
    cleanupTempDir(snapshotDir);
  }
});

test("removing the only link deletes the block entirely, restoring the original content", async () => {
  const dir = makeTempDir("notebook-links-materialize-rm-");
  const dbPath = path.join(dir, "notebook.db");
  const originalContent = "<p>Body.</p>";
  createFixtureNotebookDb(dbPath, [{ id: "n1", title: "My Note", content: originalContent }]);
  const storeDir = makeTempDir("notebook-links-materialize-rm-store-");
  const store = openStore(path.join(storeDir, "links.db"));

  try {
    await withEnv(
      { NOTEBOOK_API: "http://127.0.0.1:39217", NOTEBOOK_DB: dbPath, LINKS_OMNICLONE_SNAPSHOT: path.join(dir, "no-snapshot.json") },
      async () => {
        store.add("notebook://note/n1", "omniclone://project/p1");
        await materializeRef(store, "notebook://note/n1");
        assert.match(readNoteRow(dbPath, "n1").content, /notebook-links:begin/);

        store.remove("notebook://note/n1", "omniclone://project/p1");
        const outcome = await materializeRef(store, "notebook://note/n1");
        assert.equal(outcome.changed, true);
        assert.equal(readNoteRow(dbPath, "n1").content, originalContent);
      }
    );
  } finally {
    store.close();
    cleanupTempDir(dir);
    cleanupTempDir(storeDir);
  }
});

test("materializing the OmniClone side enqueues a command and reports 'queued' when the app isn't running", async () => {
  const storeDir = makeTempDir("notebook-links-materialize-oc-store-");
  const store = openStore(path.join(storeDir, "links.db"));
  const bridgeDir = makeTempDir("notebook-links-materialize-oc-bridge-");

  try {
    await withEnv({ LINKS_OMNICLONE_BRIDGE_DIR: bridgeDir }, async () => {
      store.add("notebook://note/n1", "omniclone://project/p1");
      const outcome = await materializeRef(store, "omniclone://project/p1", { waitMs: 100 });
      assert.equal(outcome.queue.status, "queued");

      const files = readdirSync(inboxDir(resolveBridgeDir()));
      assert.equal(files.length, 1);
      const envelope = JSON.parse(readFileSync(path.join(inboxDir(resolveBridgeDir()), files[0]), "utf8"));
      assert.equal(envelope.command, "setProjectLinkBlock");
      assert.equal(envelope.params.projectId, "p1");
      assert.match(envelope.params.block, /notebook:\/\/note\/n1/);
    });
  } finally {
    store.close();
    cleanupTempDir(storeDir);
    cleanupTempDir(bridgeDir);
  }
});

test("materializeEdge materializes both endpoints and reports per-side outcomes", async () => {
  const dir = makeTempDir("notebook-links-materialize-edge-");
  const dbPath = path.join(dir, "notebook.db");
  createFixtureNotebookDb(dbPath, [{ id: "n1", title: "My Note", content: "<p>Body.</p>" }]);
  const storeDir = makeTempDir("notebook-links-materialize-edge-store-");
  const store = openStore(path.join(storeDir, "links.db"));
  const bridgeDir = makeTempDir("notebook-links-materialize-edge-bridge-");

  try {
    await withEnv(
      {
        NOTEBOOK_API: "http://127.0.0.1:39217",
        NOTEBOOK_DB: dbPath,
        LINKS_OMNICLONE_SNAPSHOT: path.join(dir, "no-snapshot.json"),
        LINKS_OMNICLONE_BRIDGE_DIR: bridgeDir,
      },
      async () => {
        store.add("notebook://note/n1", "omniclone://project/p1");
        const results = await materializeEdge(store, "notebook://note/n1", "omniclone://project/p1", { waitMs: 100 });
        assert.equal(results.length, 2);
        const notebookResult = results.find((r) => r.ref === "notebook://note/n1");
        const omniResult = results.find((r) => r.ref === "omniclone://project/p1");
        assert.equal(notebookResult.changed, true);
        assert.equal(omniResult.queue.status, "queued");
      }
    );
  } finally {
    store.close();
    cleanupTempDir(dir);
    cleanupTempDir(storeDir);
    cleanupTempDir(bridgeDir);
  }
});
