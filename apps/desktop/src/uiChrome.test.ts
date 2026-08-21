import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adjacentNoteId,
  clampPaneWidth,
  clampZoom,
  countWords,
  decodeNoteDrag,
  defaultPaneLayout,
  emptyStateCopy,
  encodeNoteDrag,
  findMatchOffsets,
  fromDatetimeLocalValue,
  groupNotesForList,
  isReminderOverdue,
  jumpToMatches,
  hasVisibleSidebarNotebooks,
  isNoteExpanded,
  matchesSidebarFilter,
  mergeNoteBodies,
  nextMatchIndex,
  nextZoom,
  noteAppLink,
  notebooksMatchingFilter,
  notesToEnex,
  parseEditorChrome,
  parsePaneLayout,
  parseRecentSearches,
  parseCollapsedStacks,
  parseSearchQuery,
  formattingToolbarVisible,
  attachmentsLabel,
  attachmentCountLabel,
  avatarColor,
  checklistProgressLabel,
  collapseAllIds,
  headingsFromHtml,
  htmlToMarkdown,
  htmlToPlainText,
  decodeXmlEntities,
  repairImportedHtml,
  noteMatchesDateRange,
  noteMatchesFacets,
  noteMatchesSearchOperators,
  rememberSearch,
  reminderFromPreset,
  reminderFromSnooze,
  resizeSidebarTo,
  resolveListView,
  resolveThumbnailUrl,
  snippetParts,
  suggestedTags,
  toDatetimeLocalValue,
  toEnexTimestamp,
  toggleCollapsedId,
  toggleListFacet,
  toggleNoteExpanded,
  toggleNoteListHidden,
  visibleToolbarCount,
  windowTitleForNote,
  createNoteTab,
  noteTabLabel,
  nextActiveTabId,
  nextSidebarFlyout,
  reorderById,
  sidebarFilterLabel,
  sidebarFlyoutTitle,
  sameNavLocation,
  pushNavHistory,
  stepNavBack,
  stepNavForward,
  groupNotesByNotebook,
  groupRemindersForList,
  parseCompletedReminders,
  toggleCompletedReminder,
  parseSavedSearches,
  upsertSavedSearch,
  deleteSavedSearch,
  parseLastSession,
  noteMailtoHref,
  paletteMatches,
  countCharacters,
  readingTimeLabel,
  insertDateStamp,
  insertTimeStamp,
  nextFontSize,
  outlineToHtml,
  formatRelativeTime,
  trashToastCopy,
  rememberClosedTab,
  popClosedTab,
  closeOtherTabIds,
  closeTabsToTheRight,
  viewTitleForFilter,
  hasActiveListFilters,
  groupNotesByReminder,
  noteIdByOffset,
  listCountLabel,
  navCountLabel,
  navIconTitle,
  knownViewNoteCount,
  displayedListCount,
  stickyNavCount,
  viewFilterKey,
  sortNotes,
  nextLineHeight,
  parseLineHeight,
  rememberRecentNote,
  parseRecentNotes,
  parseSidebarSections,
  moveSidebarSection,
  sidebarSectionLabel,
  monthGrid,
  isoDayKey,
  reminderFallsOnDay,
  shiftMonth,
  pinTabById,
  closeAllUnpinnedTabIds,
  renameSavedSearch,
  setNoteColor,
  parseNoteColorMap,
  clampImageWidth,
  noteHasUrl,
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

describe("sidebar resize", () => {
  it("clamps the dragged edge and brings a hidden sidebar back", () => {
    const layout = defaultPaneLayout();
    assert.equal(resizeSidebarTo(layout, 300).sidebarWidth, 300);
    assert.equal(resizeSidebarTo(layout, 160).sidebarWidth, 180);
    assert.equal(resizeSidebarTo(layout, 900).sidebarWidth, 420);
    const hidden = { ...defaultPaneLayout(), sidebarCollapsed: true };
    const shown = resizeSidebarTo(hidden, 260);
    assert.equal(shown.sidebarCollapsed, false);
    assert.equal(shown.sidebarWidth, 260);
  });
});

describe("sidebar flyouts", () => {
  it("opens shortcuts, notebooks, and tags the same way", () => {
    assert.equal(nextSidebarFlyout(null, "tags"), "tags");
    assert.equal(nextSidebarFlyout("notebooks", "tags"), "tags");
    assert.equal(nextSidebarFlyout("shortcuts", "notebooks"), "notebooks");
  });

  it("closes the panel when its own section is clicked again", () => {
    assert.equal(nextSidebarFlyout("tags", "tags"), null);
    assert.equal(nextSidebarFlyout("notebooks", "notebooks"), null);
    assert.equal(nextSidebarFlyout("shortcuts", "shortcuts"), null);
  });

  it("titles and filters each panel after its own section", () => {
    assert.equal(sidebarFlyoutTitle("shortcuts"), "Shortcuts");
    assert.equal(sidebarFlyoutTitle("notebooks"), "Notebooks");
    assert.equal(sidebarFlyoutTitle("tags"), "Tags");
    assert.equal(sidebarFilterLabel("notebooks"), "Filter notebooks");
    assert.equal(sidebarFilterLabel("tags"), "Filter tags");
  });
});

describe("note chrome layout", () => {
  it("hides the note list without collapsing the sidebar", () => {
    const next = toggleNoteListHidden(defaultPaneLayout());
    assert.equal(next.listCollapsed, true);
    assert.equal(next.sidebarCollapsed, false);
    assert.equal(toggleNoteListHidden(next).listCollapsed, false);
  });

  it("expands the note by hiding sidebar and list, then restores both", () => {
    const expanded = toggleNoteExpanded(defaultPaneLayout());
    assert.equal(isNoteExpanded(expanded), true);
    const restored = toggleNoteExpanded(expanded);
    assert.equal(restored.sidebarCollapsed, false);
    assert.equal(restored.listCollapsed, false);
  });

  it("restores the three-pane layout from expand via show note list", () => {
    const expanded = toggleNoteExpanded(defaultPaneLayout());
    const shown = toggleNoteListHidden(expanded);
    assert.equal(shown.sidebarCollapsed, false);
    assert.equal(shown.listCollapsed, false);
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

  it("honors match case and whole word", () => {
    assert.deepEqual(findMatchOffsets("Note note NOTE", "Note", { caseSensitive: true }), [0]);
    assert.deepEqual(findMatchOffsets("notebook note noted", "note", { wholeWord: true }), [9]);
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

  it("parses saved toolbar, zoom, and attachments chrome", () => {
    const chrome = parseEditorChrome(
      JSON.stringify({ toolbarHidden: true, zoom: 125, attachmentsExpanded: true })
    );
    assert.equal(chrome.toolbarHidden, true);
    assert.equal(chrome.attachmentsExpanded, true);
    assert.equal(chrome.zoom, 130);
    assert.equal(parseEditorChrome("{}").attachmentsExpanded, false);
    assert.equal(parseEditorChrome("{").zoom, 100);
    assert.equal(parseEditorChrome("{}").outlineOpen, false);
    assert.equal(
      parseEditorChrome(JSON.stringify({ outlineOpen: true })).outlineOpen,
      true
    );
    assert.equal(parseEditorChrome("{}").statusBarHidden, false);
    assert.equal(parseEditorChrome(JSON.stringify({ statusBarHidden: true, lineHeight: 2 })).lineHeight, 2);
  });

  it("hides the formatting toolbar until the note body is focused", () => {
    assert.equal(formattingToolbarVisible(false, false), false);
    assert.equal(formattingToolbarVisible(false, true), true);
    assert.equal(formattingToolbarVisible(true, true), false);
  });

  it("labels the attachments disclosure like Evernote", () => {
    assert.equal(attachmentsLabel(0), "0 attachments");
    assert.equal(attachmentsLabel(1), "1 attachment");
    assert.equal(attachmentsLabel(4), "4 attachments");
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

describe("visibleToolbarCount", () => {
  it("keeps every item when they fit, otherwise hides from the end behind overflow", () => {
    assert.equal(visibleToolbarCount(400, [40, 40, 40, 40]), 4);
    assert.equal(visibleToolbarCount(120, [40, 40, 40, 40], 30), 2);
    assert.equal(visibleToolbarCount(20, [40, 40], 30), 0);
  });
});

describe("recent searches", () => {
  it("moves a repeated query to the front and caps the list", () => {
    assert.deepEqual(rememberSearch(["alpha", "beta"], "Beta"), ["Beta", "alpha"]);
    assert.deepEqual(rememberSearch(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
    assert.deepEqual(parseRecentSearches(JSON.stringify([" invoice ", ""])), ["invoice"]);
    assert.deepEqual(parseRecentSearches("{"), []);
  });
});

describe("note list facets", () => {
  it("filters notes that have a reminder or attachment", () => {
    const notes = [
      { reminder_at: "2026-08-18T09:00:00Z", attachment_count: 0 },
      { reminder_at: null, attachment_count: 2 },
      { reminder_at: "2026-08-18T09:00:00Z", attachment_count: 1 },
    ];
    assert.deepEqual(toggleListFacet(["reminder"], "attachment"), ["reminder", "attachment"]);
    assert.deepEqual(toggleListFacet(["reminder"], "reminder"), []);
    assert.equal(noteMatchesFacets(notes[0], ["reminder"]), true);
    assert.equal(noteMatchesFacets(notes[0], ["attachment"]), false);
    assert.equal(noteMatchesFacets(notes[2], ["reminder", "attachment"]), true);
    assert.equal(
      noteMatchesFacets(
        { reminder_at: null, attachment_count: 0, thumbnail_url: "x", checklist_total: 2 },
        ["image", "checklist"]
      ),
      true
    );
    assert.equal(noteHasUrl({ snippet: "see https://example.com" }), true);
    assert.equal(noteMatchesFacets({ reminder_at: null, attachment_count: 0, snippet: "hi" }, ["url"]), false);
  });
});

describe("list metadata labels", () => {
  it("formats attachment counts and checklist progress", () => {
    assert.equal(attachmentCountLabel(0), null);
    assert.equal(attachmentCountLabel(1), "1 attachment");
    assert.equal(attachmentCountLabel(3), "3 attachments");
    assert.equal(checklistProgressLabel(1, 4), "1/4");
    assert.equal(checklistProgressLabel(0, 0), null);
  });
});

describe("avatarColor", () => {
  it("picks a stable color from the display name", () => {
    assert.equal(avatarColor("Ada"), avatarColor("Ada"));
    assert.notEqual(avatarColor("Ada"), avatarColor("Grace"));
  });
});

describe("collapsed stacks", () => {
  it("toggles one stack and can collapse every stack", () => {
    assert.deepEqual(toggleCollapsedId(["a"], "b"), ["a", "b"]);
    assert.deepEqual(toggleCollapsedId(["a", "b"], "a"), ["b"]);
    assert.deepEqual(collapseAllIds(["s1", "s2", "s1"]), ["s1", "s2"]);
    assert.deepEqual(parseCollapsedStacks(JSON.stringify(["s1"])), ["s1"]);
    assert.deepEqual(parseCollapsedStacks("nope"), []);
  });
});

describe("resolveThumbnailUrl", () => {
  const toUrl = (id: string) => `http://api/attachments/${id}`;

  it("turns attachment ids into download URLs and leaves remote images alone", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal(resolveThumbnailUrl(id, toUrl), `http://api/attachments/${id}`);
    assert.equal(
      resolveThumbnailUrl(`notebook-attachment://${id}`, toUrl),
      `http://api/attachments/${id}`
    );
    assert.equal(resolveThumbnailUrl("https://cdn.example/pic.png", toUrl), "https://cdn.example/pic.png");
    assert.equal(resolveThumbnailUrl(null, toUrl), null);
  });
});

describe("search operators", () => {
  it("parses Evernote-style operators and leaves free text", () => {
    const parsed = parseSearchQuery('invoice notebook:"Work" tag:urgent intitle:Q3 reminder:true');
    assert.equal(parsed.text, "invoice");
    assert.equal(parsed.notebook, "Work");
    assert.equal(parsed.tag, "urgent");
    assert.equal(parsed.intitle, "Q3");
    assert.equal(parsed.reminder, true);
  });

  it("filters notes by those operators", () => {
    const note = {
      title: "Q3 invoice",
      notebook_name: "Work",
      tag_names: ["urgent"],
      reminder_at: "2026-08-18T09:00:00Z",
      checklist_total: 2,
    };
    assert.equal(
      noteMatchesSearchOperators(note, parseSearchQuery("notebook:Work todo:true")),
      true
    );
    assert.equal(noteMatchesSearchOperators(note, parseSearchQuery("tag:home")), false);
    assert.equal(noteMatchesSearchOperators(note, parseSearchQuery("intitle:missing")), false);
    const extra = parseSearchQuery("invoice -home untagged:true created:today resource:image");
    assert.deepEqual(extra.minus, ["home"]);
    assert.equal(extra.untagged, true);
    assert.equal(extra.created, "today");
    assert.equal(extra.resource, "image");
    assert.equal(
      noteMatchesSearchOperators(
        { ...note, tag_names: [], created_at: "2026-08-19T10:00:00Z", thumbnail_url: "x" },
        parseSearchQuery("untagged:true resource:image"),
        new Date("2026-08-19T12:00:00")
      ),
      true
    );
    assert.equal(
      noteMatchesSearchOperators(note, parseSearchQuery("invoice -urgent")),
      false
    );
  });
});

describe("date range facet", () => {
  it("keeps notes inside today / 7 days / 30 days", () => {
    const now = new Date("2026-08-18T15:00:00");
    assert.equal(noteMatchesDateRange("2026-08-18T10:00:00", "today", now), true);
    assert.equal(noteMatchesDateRange("2026-08-17T10:00:00", "today", now), false);
    assert.equal(noteMatchesDateRange("2026-08-12T10:00:00", "week", now), true);
    assert.equal(noteMatchesDateRange("2026-07-01T10:00:00", "week", now), false);
    assert.equal(noteMatchesDateRange("2026-07-20T10:00:00", "month", now), true);
  });
});

describe("html export helpers", () => {
  it("turns simple HTML into markdown and plain text", () => {
    const html = "<h1>Hello</h1><p>See <strong>this</strong> <a href=\"https://x\">link</a></p>";
    assert.match(htmlToMarkdown(html), /^# Hello/m);
    assert.match(htmlToMarkdown(html), /\*\*this\*\*/);
    assert.match(htmlToMarkdown(html), /\[link\]\(https:\/\/x\)/);
    assert.equal(htmlToPlainText(html).includes("Hello"), true);
    assert.equal(htmlToPlainText(html).includes("<"), false);
  });

  it("decodes XML apostrophe entities so imported notes show ' not &apos;", () => {
    assert.equal(decodeXmlEntities("John&apos;s note"), "John's note");
    assert.equal(decodeXmlEntities("It&amp;apos;s"), "It's");
    assert.equal(htmlToPlainText("<p>Don&apos;t forget</p>"), "Don't forget");
    assert.equal(htmlToPlainText("<p>It&amp;apos;s fine</p>"), "It's fine");
    assert.equal(repairImportedHtml("<p>It&amp;apos;s Tom&amp;apos;s</p>"), "<p>It's Tom's</p>");
  });

  it("reads heading outline entries", () => {
    assert.deepEqual(
      headingsFromHtml("<h1>One</h1><p>x</p><h2>Two</h2>").map((item) => [item.level, item.text]),
      [
        [1, "One"],
        [2, "Two"],
      ]
    );
  });
});

describe("reminder snooze", () => {
  it("pushes later today by three hours and tomorrow morning to 9am", () => {
    const now = new Date("2026-08-18T10:00:00");
    const later = new Date(reminderFromSnooze("laterToday", now));
    const morning = new Date(reminderFromSnooze("tomorrowMorning", now));
    assert.equal(later.getHours(), 13);
    assert.equal(morning.getDate(), 19);
    assert.equal(morning.getHours(), 9);
  });
});

describe("navigation history", () => {
  it("pushes a new location and can step back and forward", () => {
    const notes = { filter: { type: "all" }, noteId: null };
    const invoice = { filter: { type: "all" }, noteId: "n1" };
    const work = { filter: { type: "notebook", id: "nb" }, noteId: "n1" };
    assert.equal(sameNavLocation(notes, { filter: { type: "all" }, noteId: null }), true);
    assert.equal(sameNavLocation(notes, invoice), false);
    const pushed = pushNavHistory([], notes, invoice);
    assert.ok(pushed);
    assert.equal(pushNavHistory(pushed.past, invoice, invoice), null);
    const back = stepNavBack(pushed.past, invoice, []);
    assert.ok(back);
    assert.equal(back.current.noteId, null);
    const forward = stepNavForward(back.past, back.current, back.future);
    assert.ok(forward);
    assert.equal(forward.current.noteId, "n1");
    const notebook = pushNavHistory(forward.past, forward.current, work);
    assert.ok(notebook);
    assert.equal(notebook.future.length, 0);
  });
});

describe("search grouping and saved searches", () => {
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

  it("saves a named search and can remove it", () => {
    const saved = upsertSavedSearch([], "tag:work", "Work");
    assert.equal(saved[0].name, "Work");
    assert.equal(saved[0].query, "tag:work");
    assert.deepEqual(deleteSavedSearch(saved, saved[0].id), []);
    assert.deepEqual(parseSavedSearches("["), []);
  });
});

describe("reminder agenda", () => {
  it("buckets overdue, today, tomorrow, later, and completed", () => {
    const now = new Date("2026-08-18T12:00:00");
    const groups = groupRemindersForList(
      [
        { id: "a", reminder_at: "2026-08-17T09:00:00" },
        { id: "b", reminder_at: "2026-08-18T18:00:00" },
        { id: "c", reminder_at: "2026-08-19T09:00:00" },
        { id: "d", reminder_at: "2026-08-25T09:00:00" },
        { id: "e", reminder_at: "2026-08-18T08:00:00" },
      ],
      ["e"],
      now
    );
    assert.deepEqual(
      groups.map((group) => [group.key, group.notes.map((note) => note.id)]),
      [
        ["overdue", ["a"]],
        ["today", ["b"]],
        ["tomorrow", ["c"]],
        ["later", ["d"]],
        ["completed", ["e"]],
      ]
    );
    assert.deepEqual(toggleCompletedReminder(["e"], "e"), []);
    assert.deepEqual(parseCompletedReminders(JSON.stringify(["x"])), ["x"]);
  });
});

describe("session restore, email, and command palette", () => {
  it("parses the last session and builds a mailto link", () => {
    const session = parseLastSession(
      JSON.stringify({ filter: { type: "notebook", id: "nb", name: "Work" }, noteId: "n1" })
    );
    assert.equal(session?.filter.type, "notebook");
    assert.equal(session?.noteId, "n1");
    assert.equal(parseLastSession("{"), null);
    assert.match(noteMailtoHref("Hello", "Body text"), /^mailto:\?subject=Hello&body=Body%20text$/);
  });

  it("filters palette actions by label", () => {
    const actions = [
      { id: "new", label: "New note", hint: "Ctrl/⌘ N" },
      { id: "search", label: "Search notes" },
    ];
    assert.equal(paletteMatches("sear", actions)[0].id, "search");
    assert.equal(paletteMatches("", actions).length, 2);
  });
});

describe("pass 11 chrome helpers", () => {
  it("counts characters and reading time", () => {
    assert.equal(countCharacters("hello world"), 11);
    assert.equal(readingTimeLabel(0), null);
    assert.equal(readingTimeLabel(50), "1 min read");
    assert.equal(readingTimeLabel(400), "2 min read");
  });

  it("steps font sizes and stamps date/time", () => {
    assert.equal(nextFontSize("16px", 1), "18px");
    assert.equal(nextFontSize("16px", -1), "14px");
    assert.equal(nextFontSize(undefined, 1), "18px");
    assert.match(insertDateStamp(new Date("2026-08-19T15:04:00")), /2026/);
    assert.match(insertTimeStamp(new Date("2026-08-19T15:04:00")), /4/);
  });

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

  it("tracks closed tabs and trash copy", () => {
    const stacked = rememberClosedTab(["a"], "b");
    assert.deepEqual(stacked, ["b", "a"]);
    assert.deepEqual(popClosedTab(stacked), { item: "b", remaining: ["a"] });
    assert.deepEqual(closeOtherTabIds(["a", "b", "c"], "b"), ["a", "c"]);
    assert.deepEqual(closeTabsToTheRight(["a", "b", "c"], "a"), ["b", "c"]);
    assert.equal(trashToastCopy(1, "Hello"), "“Hello” moved to Trash");
    assert.equal(trashToastCopy(3, "Hello"), "3 notes moved to Trash");
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
});

describe("pass 12 chrome helpers", () => {
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

  it("steps line height and remembers recent notes", () => {
    assert.equal(parseLineHeight(1.15), 1.15);
    assert.equal(parseLineHeight(9), 1.5);
    assert.equal(nextLineHeight(1.5, 1), 2);
    assert.equal(nextLineHeight(1, -1), 1);
    const recent = rememberRecentNote([{ id: "a", title: "A" }], { id: "b", title: "B" });
    assert.deepEqual(recent.map((item) => item.id), ["b", "a"]);
    assert.equal(parseRecentNotes(JSON.stringify(recent))[0].id, "b");
  });

  it("reorders sidebar sections and builds a reminder month grid", () => {
    const sections = parseSidebarSections(JSON.stringify(["trash", "notes"]));
    assert.equal(sections[0], "trash");
    assert.equal(sections.includes("tags"), true);
    assert.equal(sidebarSectionLabel("saved"), "Saved searches");
    assert.deepEqual(moveSidebarSection(["notes", "tags", "trash"], "tags", -1), [
      "tags",
      "notes",
      "trash",
    ]);
    const days = monthGrid(2026, 7, "sunday", new Date("2026-08-19T12:00:00"));
    assert.equal(days.length, 42);
    assert.equal(days.filter((day) => day.inMonth).length, 31);
    assert.equal(days.find((day) => day.isToday)?.day, 19);
    assert.equal(isoDayKey(new Date(2026, 7, 19)), "2026-08-19");
    assert.equal(reminderFallsOnDay("2026-08-19T09:00:00", "2026-08-19"), true);
    assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  });

  it("pins tabs, closes unpinned tabs, and renames saved searches", () => {
    const tabs = [
      { id: "a", pinned: true },
      { id: "b", pinned: false },
      { id: "c" },
    ];
    assert.equal(pinTabById(tabs, "b").find((tab) => tab.id === "b")?.pinned, true);
    assert.deepEqual(closeAllUnpinnedTabIds(tabs), ["b", "c"]);
    const renamed = renameSavedSearch(
      [{ id: "s1", name: "Old", query: "tag:work" }],
      "s1",
      "Work"
    );
    assert.equal(renamed[0].name, "Work");
    assert.deepEqual(setNoteColor({}, "n1", "green"), { n1: "green" });
    assert.deepEqual(parseNoteColorMap(JSON.stringify({ n1: "green", n2: "nope" })), {
      n1: "green",
    });
    assert.equal(clampImageWidth(40), 80);
    assert.equal(clampImageWidth(4000), 1200);
  });
});
