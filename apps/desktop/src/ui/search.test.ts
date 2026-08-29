import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  deleteSavedSearch,
  findMatchOffsets,
  jumpToMatches,
  nextMatchIndex,
  noteMatchesDateRange,
  noteMatchesFacets,
  noteMatchesSearchOperators,
  paletteMatches,
  parseRecentSearches,
  parseSavedSearches,
  parseSearchQuery,
  rememberSearch,
  snippetParts,
  toggleListFacet,
  upsertSavedSearch,
} from "./search.ts";

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

describe("snippetParts", () => {
  it("marks query hits inside a snippet", () => {
    assert.deepEqual(snippetParts("Buy milk and eggs", "milk"), [
      { text: "Buy ", hit: false },
      { text: "milk", hit: true },
      { text: " and eggs", hit: false },
    ]);
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

describe("saved searches", () => {
  it("saves a named search and can remove it", () => {
    const saved = upsertSavedSearch([], "tag:work", "Work");
    assert.equal(saved[0].name, "Work");
    assert.equal(saved[0].query, "tag:work");
    assert.deepEqual(deleteSavedSearch(saved, saved[0].id), []);
    assert.deepEqual(parseSavedSearches("["), []);
  });
});

describe("paletteMatches", () => {
  it("filters palette actions by label", () => {
    const actions = [
      { id: "new", label: "New note", hint: "Ctrl/⌘ N" },
      { id: "search", label: "Search notes" },
    ];
    assert.equal(paletteMatches("sear", actions)[0].id, "search");
    assert.equal(paletteMatches("", actions).length, 2);
  });
});
