import { test } from "node:test";
import assert from "node:assert/strict";
import { findManagedBlock, upsertManagedBlock, renderEntryParagraph } from "../managedBlockHtml.mjs";

test("inserting into a note with no existing block appends it, leaving the rest untouched", () => {
  const original = "<p>My original note content.</p>";
  const inner = renderEntryParagraph("omniclone://project/p1", "omniclone project: Website");
  const next = upsertManagedBlock(original, inner);
  assert.ok(next.startsWith(original), "original content must be untouched and come first");
  assert.match(next, /notebook-links:begin/);
  assert.match(next, /notebook-links:end/);
  assert.match(next, /omniclone:\/\/project\/p1/);
});

test("updating an existing block replaces only the block, leaving surrounding content byte-identical", () => {
  const before = "<p>Before text.</p>";
  const after = "<p>After text.</p>";
  const firstInner = renderEntryParagraph("omniclone://project/p1", "omniclone project: Website");
  // Insert always appends at the very end, so to get a block genuinely
  // sandwiched between untouched content (the realistic case: the user
  // types more into the note, in the app, after this tool last inserted the
  // block), build that shape by hand rather than via a second insert.
  const initialWithBlockAtEnd = upsertManagedBlock(before, firstInner);
  const initial = initialWithBlockAtEnd + after;

  const secondInner = renderEntryParagraph("omniclone://project/p2", "omniclone project: Garden");
  const updated = upsertManagedBlock(initial, secondInner);
  assert.ok(updated.startsWith(before), "content before the block must survive an update");
  assert.ok(updated.endsWith(after), "content after the block must survive an update");
  assert.doesNotMatch(updated, /p1/);
  assert.match(updated, /omniclone:\/\/project\/p2/);
});

test("removing the block (falsy inner content) deletes exactly the block span", () => {
  const before = "<p>Keep before.</p>";
  const after = "<p>Keep after.</p>";
  const inner = renderEntryParagraph("omniclone://project/p1", "omniclone project: Website");
  const withBlock = upsertManagedBlock(before + after, inner);
  const removed = upsertManagedBlock(withBlock, null);
  assert.equal(removed, before + after, "removing the block must restore exactly the surrounding content");
});

test("removing a block that isn't present is a no-op returning the exact same string", () => {
  const html = "<p>Nothing to see here.</p>";
  assert.equal(upsertManagedBlock(html, null), html);
});

test("re-running upsert with unchanged inner content is byte-identical (idempotent sync)", () => {
  const html = "<p>Some note.</p>";
  const inner = renderEntryParagraph("omniclone://project/p1", "omniclone project: Website");
  const once = upsertManagedBlock(html, inner);
  const twice = upsertManagedBlock(once, inner);
  assert.equal(twice, once, "a repeat sync with the same content must produce a byte-identical result");
});

test("findManagedBlock locates the block and reports its exact span", () => {
  const before = "<p>A</p>";
  const after = "<p>B</p>";
  const inner = renderEntryParagraph("omniclone://project/p1", "omniclone project: Website");
  // Insert appends at the very end, so the block trails everything else here.
  const html = upsertManagedBlock(before + after, inner);
  const found = findManagedBlock(html);
  assert.ok(found);
  assert.equal(html.slice(0, found.start), before + after);
  assert.equal(html.slice(found.end), "");
});

test("findManagedBlock returns null when there is no block", () => {
  assert.equal(findManagedBlock("<p>plain note</p>"), null);
});
