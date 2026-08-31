import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clampPaneWidth, defaultPaneLayout, isNoteExpanded, parsePaneLayout, resizeSidebarTo, revealNoteBrowser, toggleNoteExpanded, toggleNoteListHidden, visibleToolbarCount } from "./panes.ts";

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

describe("empty editor layout", () => {
  it("reveals the browser panes when no note is available", () => {
    const expanded = { ...defaultPaneLayout(), sidebarCollapsed: true, listCollapsed: true };
    assert.deepEqual(revealNoteBrowser(expanded), {
      ...expanded,
      sidebarCollapsed: false,
      listCollapsed: false,
    });

    const listOnly = { ...defaultPaneLayout(), listCollapsed: true };
    assert.equal(revealNoteBrowser(listOnly).sidebarCollapsed, false);
    assert.equal(revealNoteBrowser(listOnly).listCollapsed, false);
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

describe("visibleToolbarCount", () => {
  it("keeps every item when they fit, otherwise hides from the end behind overflow", () => {
    assert.equal(visibleToolbarCount(400, [40, 40, 40, 40]), 4);
    assert.equal(visibleToolbarCount(120, [40, 40, 40, 40], 30), 2);
    assert.equal(visibleToolbarCount(20, [40, 40], 30), 0);
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
