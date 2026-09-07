import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRef, formatRef, normalizeRef, isRef, listKnownApps, listKnownKinds } from "../refs.mjs";

test("parses canonical two-slash refs", () => {
  assert.deepEqual(parseRef("notebook://note/abc-123"), { app: "notebook", kind: "note", id: "abc-123" });
  assert.deepEqual(parseRef("omniclone://project/p1"), { app: "omniclone", kind: "project", id: "p1" });
});

test("accepts and normalizes the three-slash form to two slashes", () => {
  assert.deepEqual(parseRef("notebook:///note/abc-123"), { app: "notebook", kind: "note", id: "abc-123" });
  assert.equal(normalizeRef("omniclone:///project/p1"), "omniclone://project/p1");
  assert.equal(normalizeRef("notebook://note/abc-123"), "notebook://note/abc-123");
});

test("round-trips parse -> format -> parse", () => {
  const raw = "notebook://note/abc-123";
  const ref = parseRef(raw);
  const formatted = formatRef(ref);
  assert.equal(formatted, raw);
  assert.deepEqual(parseRef(formatted), ref);
});

test("rejects unknown apps, naming the known ones", () => {
  assert.throws(() => parseRef("todoist://task/1"), /Unknown app "todoist".*notebook.*omniclone|Unknown app "todoist".*omniclone.*notebook/s);
});

test("rejects unknown kinds for a known app, naming the known kinds", () => {
  assert.throws(() => parseRef("notebook://task/1"), /Unknown kind "task" for app "notebook".*note/);
});

test("rejects malformed refs with a message naming the known apps", () => {
  assert.throws(() => parseRef("not-a-ref"), /is not a ref of the form/);
  assert.throws(() => parseRef(""), /is not a ref of the form/);
});

test("isRef is a non-throwing predicate", () => {
  assert.equal(isRef("notebook://note/x"), true);
  assert.equal(isRef("bogus://x/y"), false);
  assert.equal(isRef(""), false);
});

test("decodes percent-encoded ids and re-encodes on format", () => {
  const ref = parseRef("notebook://note/a%20b");
  assert.equal(ref.id, "a b");
  assert.equal(formatRef(ref), "notebook://note/a%20b");
});

test("registry helpers list known apps/kinds", () => {
  assert.deepEqual(listKnownApps(), ["notebook", "omniclone"]);
  assert.deepEqual(listKnownKinds("notebook"), ["note"]);
  assert.deepEqual(listKnownKinds("omniclone"), ["project"]);
});
