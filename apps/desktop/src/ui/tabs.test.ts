import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampImageWidth } from "./editorChrome.ts";
import { parseNoteColorMap, setNoteColor } from "./noteContent.ts";
import { trashToastCopy } from "./noteList.ts";
import { parsePaneLayout } from "./panes.ts";
import { renameSavedSearch } from "./search.ts";
import { closeAllUnpinnedTabIds, closeOtherTabIds, closeTabsToTheRight, createNoteTab, nextActiveTabId, noteTabLabel, pinTabById, popClosedTab, rememberClosedTab, reorderById } from "./tabs.ts";

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

describe("parsePaneLayout", () => {
  it("tracks closed tabs and trash copy", () => {
    const stacked = rememberClosedTab(["a"], "b");
    assert.deepEqual(stacked, ["b", "a"]);
    assert.deepEqual(popClosedTab(stacked), { item: "b", remaining: ["a"] });
    assert.deepEqual(closeOtherTabIds(["a", "b", "c"], "b"), ["a", "c"]);
    assert.deepEqual(closeTabsToTheRight(["a", "b", "c"], "a"), ["b", "c"]);
    assert.equal(trashToastCopy(1, "Hello"), "“Hello” moved to Trash");
    assert.equal(trashToastCopy(3, "Hello"), "3 notes moved to Trash");
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
