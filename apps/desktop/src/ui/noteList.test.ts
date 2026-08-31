import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { viewFilterKey, viewTitleForFilter } from "./navigation.ts";
import { outlineToHtml } from "./noteContent.ts";
import { adjacentNoteId, attachmentCountLabel, decodeNoteDrag, displayedListCount, emptyStateCopy, encodeNoteDrag, formatRelativeTime, groupNotesByNotebook, groupNotesForList, hasActiveListFilters, knownViewNoteCount, listCountLabel, navCountLabel, noteIdByOffset, resolveListView, sortNotes, stickyNavCount } from "./noteList.ts";
import { parsePaneLayout } from "./panes.ts";
import { groupNotesByReminder } from "./reminders.ts";
import { navIconTitle } from "./sidebar.ts";

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

describe("parsePaneLayout", () => {
  it("builds a table of contents and relative times", () => {
    assert.match(
      outlineToHtml([
        { level: 1, text: "Intro" },
        { level: 2, text: "Details" },
      ]),
      /Table of Contents/
    );
    assert.equal(formatRelativeTime(new Date().toISOString()), "Just now");
    assert.equal(
      formatRelativeTime(new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()),
      "3 hours ago"
    );
  });

  it("titles views, groups by reminder, and detects active filters", () => {
    assert.equal(viewTitleForFilter({ type: "archived" }), "Archived");
    assert.equal(viewTitleForFilter({ type: "tag", name: "work" }), "#work");
    assert.equal(hasActiveListFilters(["untagged"], "any"), true);
    assert.equal(hasActiveListFilters([], "any"), false);
    const grouped = groupNotesByReminder(
      [
        { reminder_at: "2026-08-18T09:00:00Z" },
        { reminder_at: "2026-08-19T09:00:00Z" },
        { reminder_at: null },
      ],
      new Date("2026-08-19T12:00:00")
    );
    assert.deepEqual(
      grouped.map((group) => [group.key, group.notes.length]),
      [
        ["overdue", 1],
        ["today", 1],
        ["none", 1],
      ]
    );
  });

  it("pages through the note list and labels visible counts", () => {
    const notes = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
    assert.equal(noteIdByOffset(notes, "a", 3), "d");
    assert.equal(noteIdByOffset(notes, "b", -8), "a");
    assert.equal(noteIdByOffset(notes, null, -1), "d");
    assert.equal(listCountLabel(1, 1), "1 note");
    assert.equal(listCountLabel(5, 12), "5 notes of 12");
    assert.equal(listCountLabel(0, 0), "0 notes");
    assert.equal(listCountLabel(0, 0, false), "");
    assert.equal(listCountLabel(3, 3, false), "");
    assert.equal(navCountLabel(undefined), "");
    assert.equal(navCountLabel(null), "");
    assert.equal(navCountLabel(0), "0");
    assert.equal(navCountLabel(12), "12");
    assert.equal(navIconTitle("Notes"), "Notes");
    assert.equal(navIconTitle("Notes", 12), "Notes (12)");
    assert.equal(navIconTitle("Notebooks", 0), "Notebooks (0)");
    assert.equal(viewFilterKey({ type: "all" }), "all");
    assert.equal(viewFilterKey({ type: "notebook", id: "nb1" }, "scope"), "notebook:nb1@scope");
    assert.equal(viewFilterKey({ type: "search", query: "hello" }), "search:hello");
    assert.equal(
      knownViewNoteCount(
        { type: "notebook", id: "work" },
        [{ id: "work", note_count: 12 }],
        [],
        null
      ),
      12
    );
    assert.equal(
      displayedListCount({
        loaded: false,
        visible: 0,
        total: 0,
        known: 12,
        lastLabel: "0 notes",
      }),
      "12 notes"
    );
    assert.equal(
      displayedListCount({
        loaded: true,
        visible: 0,
        total: 0,
        known: 12,
        lastLabel: "0 notes",
      }),
      "12 notes"
    );
    assert.equal(
      displayedListCount({
        loaded: true,
        visible: 0,
        total: 0,
        known: 0,
      }),
      "0 notes"
    );
    assert.equal(
      displayedListCount({
        loaded: false,
        visible: 0,
        total: 0,
        lastLabel: "0 notes",
      }),
      ""
    );
    assert.equal(stickyNavCount(0, 4), 4);
    assert.equal(stickyNavCount(6, 4), 6);
    assert.equal(stickyNavCount(0, null), undefined);
  });

  it("keeps pinned notes first when reversing sort", () => {
    const notes = [
      { is_pinned: true, title: "Z", created_at: "2026-01-01", updated_at: "2026-08-01" },
      { is_pinned: false, title: "A", created_at: "2026-01-02", updated_at: "2026-08-03" },
      { is_pinned: false, title: "B", created_at: "2026-01-03", updated_at: "2026-08-02" },
    ];
    const newest = sortNotes(notes, "updated", false);
    assert.equal(newest[0].title, "Z");
    assert.equal(newest[1].title, "A");
    const oldest = sortNotes(notes, "updated", true);
    assert.equal(oldest[0].title, "Z");
    assert.equal(oldest[1].title, "B");
  });
});
