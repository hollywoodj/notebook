import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentNoteId,
  clampPaneWidth,
  clampZoom,
  countWords,
  decodeNoteDrag,
  emptyStateCopy,
  encodeNoteDrag,
  findMatchOffsets,
  fromDatetimeLocalValue,
  groupNotesForList,
  isReminderOverdue,
  jumpToMatches,
  hasVisibleSidebarNotebooks,
  matchesSidebarFilter,
  mergeNoteBodies,
  nextMatchIndex,
  nextZoom,
  noteAppLink,
  notebooksMatchingFilter,
  notesToEnex,
  parseEditorChrome,
  parsePaneLayout,
  reminderFromPreset,
  resolveListView,
  snippetParts,
  suggestedTags,
  toDatetimeLocalValue,
  toEnexTimestamp,
  windowTitleForNote,
  createNoteTab,
  noteTabLabel,
  nextActiveTabId,
  reorderById,
} from "./uiChrome.ts";

describe("clampPaneWidth", () => {
  it("keeps widths inside Evernote-like pane bounds", () => {
    assert.equal(clampPaneWidth(100, 180, 420), 180);
    assert.equal(clampPaneWidth(900, 220, 560), 560);
    assert.equal(clampPaneWidth(300.6, 180, 420), 301);
  });
});

describe("parsePaneLayout", () => {
  it("falls back when storage is empty or corrupt", () => {
    assert.equal(parsePaneLayout(null).sidebarWidth, 248);
    assert.equal(parsePaneLayout("{").listWidth, 320);
  });

  it("reads a saved layout", () => {
    const layout = parsePaneLayout(
      JSON.stringify({ sidebarWidth: 200, listWidth: 400, sidebarCollapsed: true, listCollapsed: true })
    );
    assert.equal(layout.sidebarWidth, 200);
    assert.equal(layout.listWidth, 400);
    assert.equal(layout.sidebarCollapsed, true);
    assert.equal(layout.listCollapsed, true);
  });
});

describe("countWords", () => {
  it("ignores extra whitespace", () => {
    assert.equal(countWords(""), 0);
    assert.equal(countWords("  hello   world\n\nagain "), 3);
  });
});

describe("findMatchOffsets", () => {
  it("finds non-overlapping case-insensitive matches", () => {
    assert.deepEqual(findMatchOffsets("Note note NOTE", "note"), [0, 5, 10]);
    assert.deepEqual(findMatchOffsets("aaaa", "aa"), [0, 2]);
    assert.deepEqual(findMatchOffsets("hello", "z"), []);
  });
});

describe("nextMatchIndex", () => {
  it("wraps around the match list", () => {
    assert.equal(nextMatchIndex(3, 2, 1), 0);
    assert.equal(nextMatchIndex(3, 0, -1), 2);
    assert.equal(nextMatchIndex(0, 0, 1), 0);
  });
});

describe("adjacentNoteId", () => {
  const notes = ["a", "b", "c"].map((id) => ({ id }));

  it("moves to the next or previous note without wrapping", () => {
    assert.equal(adjacentNoteId(notes, "b", 1), "c");
    assert.equal(adjacentNoteId(notes, "c", 1), "c");
    assert.equal(adjacentNoteId(notes, "a", -1), "a");
    assert.equal(adjacentNoteId(notes, null, 1), "a");
  });
});

describe("reminder datetime helpers", () => {
  it("round-trips a local datetime value", () => {
    const iso = fromDatetimeLocalValue("2026-08-17T09:30");
    assert.ok(iso);
    assert.equal(toDatetimeLocalValue(iso), "2026-08-17T09:30");
  });

  it("marks past reminders as overdue", () => {
    assert.equal(isReminderOverdue("2020-01-01T00:00:00Z", new Date("2026-01-01")), true);
    assert.equal(isReminderOverdue(null), false);
  });
});

describe("note drag payload", () => {
  it("encodes and decodes note ids", () => {
    assert.deepEqual(decodeNoteDrag(encodeNoteDrag(["a", "b"])), ["a", "b"]);
    assert.deepEqual(decodeNoteDrag("nope"), []);
  });
});

describe("noteAppLink", () => {
  it("uses an Evernote-style app URL", () => {
    assert.equal(noteAppLink("abc"), "notebook://note/abc");
  });
});

describe("suggestedTags", () => {
  it("filters already-applied tags and matches the query", () => {
    const tags = [
      { id: "1", name: "work" },
      { id: "2", name: "travel" },
      { id: "3", name: "recipes" },
    ];
    assert.deepEqual(
      suggestedTags(tags, "e", ["1"]).map((tag) => tag.name),
      ["travel", "recipes"]
    );
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

describe("snippetParts", () => {
  it("marks query hits inside a snippet", () => {
    assert.deepEqual(snippetParts("Buy milk and eggs", "milk"), [
      { text: "Buy ", hit: false },
      { text: "milk", hit: true },
      { text: " and eggs", hit: false },
    ]);
  });
});

describe("mergeNoteBodies", () => {
  it("keeps the first body and appends later titles as headings", () => {
    const html = mergeNoteBodies([
      { title: "A", content: "<p>one</p>" },
      { title: "B & C", content: "<p>two</p>" },
    ]);
    assert.equal(html, "<p>one</p><h1>B &amp; C</h1><p>two</p>");
  });
});

describe("notesToEnex", () => {
  it("wraps notes in Evernote export XML", () => {
    const enex = notesToEnex([
      {
        title: "Hello",
        content: "<p>Hi</p>",
        created_at: "2026-08-17T12:00:00.000Z",
        updated_at: "2026-08-17T12:00:00.000Z",
        tag_names: ["work"],
      },
    ]);
    assert.match(enex, /<en-export>/);
    assert.match(enex, /<title>Hello<\/title>/);
    assert.match(enex, /<tag>work<\/tag>/);
    assert.equal(toEnexTimestamp("2026-08-17T12:00:00.000Z"), "20260817T120000Z");
  });
});

describe("resolveListView", () => {
  it("prefers an explicit list view and falls back to snippets", () => {
    assert.equal(resolveListView({ list_view: "cards", show_snippets: false }), "cards");
    assert.equal(resolveListView({ show_snippets: false }), "titles");
    assert.equal(resolveListView({}), "snippets");
  });
});

describe("reminderFromPreset", () => {
  it("sets tonight, tomorrow morning, and next week", () => {
    const now = new Date("2026-08-17T10:00:00");
    const tonight = new Date(reminderFromPreset("tonight", now));
    const tomorrow = new Date(reminderFromPreset("tomorrow", now));
    const nextWeek = new Date(reminderFromPreset("nextWeek", now));
    assert.equal(tonight.getHours(), 18);
    assert.equal(tonight.getDate(), 17);
    assert.equal(tomorrow.getHours(), 9);
    assert.equal(tomorrow.getDate(), 18);
    assert.equal(nextWeek.getDate(), 24);
  });
});

describe("jumpToMatches", () => {
  it("finds notebooks, tags, and notes by query", () => {
    const results = jumpToMatches(
      "work",
      [{ id: "n1", title: "Standup", notebook_name: "Work" }],
      [{ id: "nb1", name: "Work" }],
      [{ id: "t1", name: "workflow" }]
    );
    assert.deepEqual(
      results.map((item) => [item.kind, item.title]),
      [
        ["notebook", "Work"],
        ["tag", "#workflow"],
        ["note", "Standup"],
      ]
    );
  });
});

describe("editor chrome", () => {
  it("clamps zoom to Evernote-like 50–200% steps", () => {
    assert.equal(clampZoom(47), 50);
    assert.equal(clampZoom(204), 200);
    assert.equal(clampZoom(116), 120);
    assert.equal(nextZoom(100, 1), 110);
    assert.equal(nextZoom(100, -1), 90);
    assert.equal(nextZoom(50, -1), 50);
    assert.equal(nextZoom(175, 0), 100);
  });

  it("parses saved toolbar and zoom chrome", () => {
    const chrome = parseEditorChrome(JSON.stringify({ toolbarHidden: true, zoom: 125 }));
    assert.equal(chrome.toolbarHidden, true);
    assert.equal(chrome.zoom, 130);
    assert.equal(parseEditorChrome("{").zoom, 100);
  });
});

describe("note tabs", () => {
  it("labels empty tabs as Notes and filled tabs as Untitled when needed", () => {
    assert.equal(noteTabLabel("", false), "Notes");
    assert.equal(noteTabLabel("  ", true), "Untitled");
    assert.equal(noteTabLabel(" Meeting ", true), "Meeting");
  });

  it("creates a tab with a stable identity", () => {
    const tab = createNoteTab({ title: "Invoice" });
    assert.equal(tab.noteId, null);
    assert.equal(tab.title, "Notes");
    const noteTab = createNoteTab({ noteId: "n1", title: "Invoice" });
    assert.equal(noteTab.noteId, "n1");
    assert.equal(noteTab.title, "Invoice");
    assert.notEqual(tab.id, noteTab.id);
  });

  it("selects a neighbor after closing the active tab", () => {
    assert.equal(nextActiveTabId(["a", "b", "c"], "b", "b"), "c");
    assert.equal(nextActiveTabId(["a", "b", "c"], "c", "c"), "b");
    assert.equal(nextActiveTabId(["a", "b", "c"], "a", "c"), "c");
    assert.equal(nextActiveTabId(["a"], "a", "a"), "a");
  });

  it("reorders tabs by dragging", () => {
    const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
    assert.deepEqual(
      reorderById(tabs, "a", "c").map((tab) => tab.id),
      ["b", "c", "a"]
    );
    assert.equal(reorderById(tabs, "a", "a"), tabs);
  });
});

describe("windowTitleForNote", () => {
  it("uses the note title like Evernote's window chrome", () => {
    assert.equal(windowTitleForNote(null), "Notebook");
    assert.equal(windowTitleForNote(""), "Untitled – Notebook");
    assert.equal(windowTitleForNote(" Meeting notes "), "Meeting notes – Notebook");
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

describe("sidebar filter", () => {
  it("narrows notebooks unless the stack name matches", () => {
    const notebooks = [{ name: "Work" }, { name: "Recipes" }];
    assert.deepEqual(
      notebooksMatchingFilter(notebooks, "Personal", "rec").map((item) => item.name),
      ["Recipes"]
    );
    assert.deepEqual(
      notebooksMatchingFilter(notebooks, "Personal", "per").map((item) => item.name),
      ["Work", "Recipes"]
    );
    assert.equal(matchesSidebarFilter("travel", "TRA"), true);
    assert.equal(matchesSidebarFilter("travel", "home"), false);
    assert.equal(
      hasVisibleSidebarNotebooks([{ name: "Work" }], [{ name: "Personal" }], "per"),
      true
    );
    assert.equal(
      hasVisibleSidebarNotebooks([{ name: "Work" }], [{ name: "Personal" }], "zzz"),
      false
    );
  });
});
