import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  batchConfirmMessage,
  noteIdsInRange,
  pruneNoteIds,
  toggleNoteId,
} from "./noteSelection.ts";

const notes = ["a", "b", "c", "d", "e"].map((id) => ({ id }));

describe("noteIdsInRange", () => {
  it("selects a contiguous range from the anchor to the clicked note", () => {
    assert.deepEqual(noteIdsInRange(notes, "b", "d"), ["b", "c", "d"]);
    assert.deepEqual(noteIdsInRange(notes, "d", "b"), ["b", "c", "d"]);
  });

  it("falls back to the clicked note when there is no usable anchor", () => {
    assert.deepEqual(noteIdsInRange(notes, null, "c"), ["c"]);
    assert.deepEqual(noteIdsInRange(notes, "missing", "c"), ["c"]);
  });
});

describe("toggleNoteId", () => {
  it("adds and removes individual notes", () => {
    const added = toggleNoteId(new Set(["a"]), "c");
    assert.deepEqual([...added].sort(), ["a", "c"]);
    const removed = toggleNoteId(added, "a");
    assert.deepEqual([...removed], ["c"]);
  });
});

describe("pruneNoteIds", () => {
  it("drops ids that are no longer visible", () => {
    const pruned = pruneNoteIds(new Set(["a", "gone"]), ["a", "b"]);
    assert.deepEqual([...pruned], ["a"]);
  });

  it("reuses the same set when nothing changed", () => {
    const selected = new Set(["a"]);
    assert.equal(pruneNoteIds(selected, ["a", "b"]), selected);
  });
});

describe("batchConfirmMessage", () => {
  it("uses singular copy for one note and a count for many", () => {
    assert.equal(batchConfirmMessage("trash", 1, "Hello"), "Move “Hello” to Trash?");
    assert.equal(batchConfirmMessage("trash", 3, "Hello"), "Move 3 notes to Trash?");
    assert.equal(
      batchConfirmMessage("permanent", 1, "Hello"),
      "Delete “Hello” forever?"
    );
    assert.equal(
      batchConfirmMessage("permanent", 4, "Hello"),
      "Delete 4 notes forever?"
    );
  });
});
