import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { openStore } from "../store.mjs";
import { makeTempDir, cleanupTempDir } from "./helpers.mjs";

function withStore(fn) {
  const dir = makeTempDir("notebook-links-store-");
  const store = openStore(path.join(dir, "links.db"));
  try {
    return fn(store);
  } finally {
    store.close();
    cleanupTempDir(dir);
  }
}

test("add is idempotent and reports already-linked on repeat", () => {
  withStore((store) => {
    const first = store.add("notebook://note/a", "omniclone://project/b");
    assert.equal(first.created, true);
    assert.equal(store.count(), 1);

    const second = store.add("notebook://note/a", "omniclone://project/b");
    assert.equal(second.created, false);
    assert.equal(second.message, "already linked");
    assert.equal(store.count(), 1);
  });
});

test("add A B then add B A collapses to one row (reverse-order dedupe)", () => {
  withStore((store) => {
    store.add("notebook://note/a", "omniclone://project/b");
    const reverse = store.add("omniclone://project/b", "notebook://note/a");
    assert.equal(reverse.created, false);
    assert.equal(store.count(), 1);
  });
});

test("list returns edges as a union of both endpoint columns, normalized", () => {
  withStore((store) => {
    store.add("notebook://note/a", "omniclone://project/b");
    const fromA = store.list("notebook://note/a");
    assert.equal(fromA.length, 1);
    assert.equal(fromA[0].other, "omniclone://project/b");
    assert.equal(fromA[0].rel, "related");

    const fromB = store.list("omniclone://project/b");
    assert.equal(fromB.length, 1);
    assert.equal(fromB[0].other, "notebook://note/a");
  });
});

test("list works the same regardless of which order the link was added in", () => {
  withStore((store) => {
    store.add("omniclone://project/b", "notebook://note/a");
    const fromA = store.list("notebook://note/a");
    assert.equal(fromA.length, 1);
    assert.equal(fromA[0].other, "omniclone://project/b");
  });
});

test("rm with both refs removes exactly that edge, from either direction", () => {
  withStore((store) => {
    store.add("notebook://note/a", "omniclone://project/b");
    const removed = store.remove("omniclone://project/b", "notebook://note/a");
    assert.equal(removed.removed, 1);
    assert.equal(store.count(), 0);
  });
});

test("rm with only refA removes every edge touching it", () => {
  withStore((store) => {
    store.add("notebook://note/a", "omniclone://project/b");
    store.add("notebook://note/a", "omniclone://project/c");
    store.add("omniclone://project/d", "notebook://note/a");
    assert.equal(store.count(), 3);
    const removed = store.remove("notebook://note/a");
    assert.equal(removed.removed, 3);
    assert.equal(store.count(), 0);
  });
});

test("rm removing a non-existent edge is a no-op reporting zero removed", () => {
  withStore((store) => {
    const removed = store.remove("notebook://note/a", "omniclone://project/b");
    assert.equal(removed.removed, 0);
  });
});

test("cannot link a ref to itself", () => {
  withStore((store) => {
    assert.throws(() => store.add("notebook://note/a", "notebook://note/a"), /itself/);
  });
});

test("unknown relation is rejected with known relations named", () => {
  withStore((store) => {
    assert.throws(() => store.add("notebook://note/a", "omniclone://project/b", { rel: "blocks" }), /Unknown relation "blocks"/);
  });
});

test("schema_meta records a schema version", () => {
  withStore((store) => {
    assert.equal(store.schemaVersion(), "1");
  });
});

test("note is stored and returned on list", () => {
  withStore((store) => {
    store.add("notebook://note/a", "omniclone://project/b", { note: "context" });
    const edges = store.list("notebook://note/a");
    assert.equal(edges[0].note, "context");
  });
});
