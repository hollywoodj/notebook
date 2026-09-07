import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { writeFileSync } from "node:fs";
import { omnicloneAdapter, readSnapshot } from "../adapters/omniclone.mjs";
import { makeTempDir, cleanupTempDir } from "./helpers.mjs";

// Must be `async` and `await fn(file)` itself: `fn` typically contains more
// than one `await`, and even an already-resolved promise defers its
// continuation to a microtask. A non-async `return fn(file)` here would let
// this function's own `finally` (env var restore + temp dir deletion) run
// before `fn`'s second and later `await`s resume - which is exactly the bug
// this comment is here to stop someone from reintroducing.
async function withSnapshot(snapshot, fn) {
  const dir = makeTempDir("notebook-links-snapshot-");
  const file = path.join(dir, "snapshot.json");
  if (snapshot !== undefined) writeFileSync(file, JSON.stringify(snapshot), "utf8");
  const prevEnv = process.env.LINKS_OMNICLONE_SNAPSHOT;
  process.env.LINKS_OMNICLONE_SNAPSHOT = file;
  try {
    return await fn(file);
  } finally {
    if (prevEnv === undefined) delete process.env.LINKS_OMNICLONE_SNAPSHOT;
    else process.env.LINKS_OMNICLONE_SNAPSHOT = prevEnv;
    cleanupTempDir(dir);
  }
}

const SNAPSHOT = {
  schema: 1,
  app: "omniclone",
  exportedAt: "2026-09-04T12:00:00.000Z",
  projects: [
    { id: "p1", name: "Website Redesign", folder: "Work", status: "active" },
    { id: "p2", name: "Garden", folder: null, status: "onHold" },
  ],
  counts: { projects: 2, tasks: 10 },
};

test("resolve finds a project present in the snapshot", async () => {
  await withSnapshot(SNAPSHOT, async () => {
    const entity = await omnicloneAdapter.resolve({ app: "omniclone", kind: "project", id: "p1" });
    assert.equal(entity.exists, true);
    assert.equal(entity.title, "Website Redesign");
    assert.equal(entity.url, "omniclone://project/p1");
    assert.match(entity.subtitle, /Work/);
  });
});

test("resolve returns exists:false for an id absent from a present snapshot", async () => {
  await withSnapshot(SNAPSHOT, async () => {
    const entity = await omnicloneAdapter.resolve({ app: "omniclone", kind: "project", id: "missing" });
    assert.equal(entity.exists, false);
  });
});

test("resolve returns exists:null (unknown, not false) when the snapshot file is missing", async () => {
  await withSnapshot(undefined, async () => {
    const entity = await omnicloneAdapter.resolve({ app: "omniclone", kind: "project", id: "p1" });
    assert.equal(entity.exists, null);
    assert.notEqual(entity.exists, false);
  });
});

test("resolve treats an unparseable snapshot the same as a missing one", async () => {
  const dir = makeTempDir("notebook-links-snapshot-bad-");
  const file = path.join(dir, "snapshot.json");
  writeFileSync(file, "{ not valid json", "utf8");
  const prevEnv = process.env.LINKS_OMNICLONE_SNAPSHOT;
  process.env.LINKS_OMNICLONE_SNAPSHOT = file;
  try {
    const entity = await omnicloneAdapter.resolve({ app: "omniclone", kind: "project", id: "p1" });
    assert.equal(entity.exists, null);
    assert.equal(readSnapshot(), null);
  } finally {
    if (prevEnv === undefined) delete process.env.LINKS_OMNICLONE_SNAPSHOT;
    else process.env.LINKS_OMNICLONE_SNAPSHOT = prevEnv;
    cleanupTempDir(dir);
  }
});

test("list filters by query (case-insensitive substring) and respects limit", async () => {
  await withSnapshot(SNAPSHOT, async () => {
    const all = await omnicloneAdapter.list("project", {});
    assert.equal(all.length, 2);
    const filtered = await omnicloneAdapter.list("project", { query: "web" });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].ref, "omniclone://project/p1");
    const limited = await omnicloneAdapter.list("project", { limit: 1 });
    assert.equal(limited.length, 1);
  });
});

test("list returns [] when there is no snapshot", async () => {
  await withSnapshot(undefined, async () => {
    const all = await omnicloneAdapter.list("project", {});
    assert.deepEqual(all, []);
  });
});

test("health reports not-ok with a clear detail when there is no snapshot", async () => {
  await withSnapshot(undefined, async () => {
    const health = await omnicloneAdapter.health();
    assert.equal(health.ok, false);
    assert.match(health.detail, /open OmniClone once/);
    assert.equal(health.exportedAt, null);
  });
});

test("health surfaces exportedAt when a snapshot is present", async () => {
  await withSnapshot(SNAPSHOT, async () => {
    const health = await omnicloneAdapter.health();
    assert.equal(health.ok, true);
    assert.equal(health.exportedAt, SNAPSHOT.exportedAt);
  });
});
