import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNoteTab, noteTabLabel, nextActiveTabId, reorderById } from "./tabs.ts";

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
