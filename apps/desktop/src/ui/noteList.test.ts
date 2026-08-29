import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentNoteId,
  attachmentCountLabel,
  decodeNoteDrag,
  emptyStateCopy,
  encodeNoteDrag,
  groupNotesByNotebook,
  groupNotesForList,
  resolveListView,
} from "./noteList.ts";

describe("adjacentNoteId", () => {
  const notes = ["a", "b", "c"].map((id) => ({ id }));

  it("moves to the next or previous note without wrapping", () => {
    assert.equal(adjacentNoteId(notes, "b", 1), "c");
    assert.equal(adjacentNoteId(notes, "c", 1), "c");
    assert.equal(adjacentNoteId(notes, "a", -1), "a");
    assert.equal(adjacentNoteId(notes, null, 1), "a");
  });
});

describe("note drag payload", () => {
  it("encodes and decodes note ids", () => {
    assert.deepEqual(decodeNoteDrag(encodeNoteDrag(["a", "b"])), ["a", "b"]);
    assert.deepEqual(decodeNoteDrag("nope"), []);
  });
});

describe("groupNotesForList", () => {
  it("puts pinned notes first and buckets the rest by day", () => {
    const now = new Date("2026-08-17T15:00:00");
    const notes = [
      { id: "p", is_pinned: true, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
      { id: "t", is_pinned: false, created_at: "2026-08-17T10:00:00", updated_at: "2026-08-17T10:00:00" },
      { id: "y", is_pinned: false, created_at: "2026-08-16T10:00:00", updated_at: "2026-08-16T10:00:00" },
      { id: "e", is_pinned: false, created_at: "2026-01-02T00:00:00Z", updated_at: "2026-01-02T00:00:00Z" },
    ];
    const groups = groupNotesForList(notes, "updated", now);
    assert.deepEqual(
      groups.map((group) => [group.label, group.notes.map((note) => note.id)]),
      [
        ["Pinned", ["p"]],
        ["Today", ["t"]],
        ["Yesterday", ["y"]],
        ["Earlier", ["e"]],
      ]
    );
  });
});

describe("resolveListView", () => {
  it("prefers an explicit list view and falls back to snippets", () => {
    assert.equal(resolveListView({ list_view: "cards", show_snippets: false }), "cards");
    assert.equal(resolveListView({ show_snippets: false }), "titles");
    assert.equal(resolveListView({}), "snippets");
  });
});

describe("emptyStateCopy", () => {
  it("returns Evernote-style copy per view", () => {
    assert.equal(emptyStateCopy("all").title, "Create your first note");
    assert.match(emptyStateCopy("notebook", "Work").body, /Work/);
    assert.equal(emptyStateCopy("trash").title, "Trash is empty");
    assert.match(emptyStateCopy("search", "invoice").body, /invoice/);
    assert.equal(emptyStateCopy("shortcuts").title, "No shortcuts yet");
  });
});

describe("attachmentCountLabel", () => {
  it("formats attachment counts", () => {
    assert.equal(attachmentCountLabel(0), null);
    assert.equal(attachmentCountLabel(1), "1 attachment");
    assert.equal(attachmentCountLabel(3), "3 attachments");
  });
});

describe("groupNotesByNotebook", () => {
  it("groups notes by notebook name", () => {
    const groups = groupNotesByNotebook([
      { notebook_name: "Work", id: "a" },
      { notebook_name: "Home", id: "b" },
      { notebook_name: "Work", id: "c" },
    ]);
    assert.deepEqual(
      groups.map((group) => [group.label, group.notes.map((note) => note.id)]),
      [
        ["Work", ["a", "c"]],
        ["Home", ["b"]],
      ]
    );
  });
});
