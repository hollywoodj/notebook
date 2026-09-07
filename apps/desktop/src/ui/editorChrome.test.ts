import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { attachmentsLabel, formattingToolbarVisible, HIGHLIGHT_COLORS, insertDateStamp, insertTimeStamp, nextFontSize, nextLineHeight, nextZoom, parseEditorChrome, parseLineHeight, saveStateLabel, windowTitleForNote } from "./editorChrome.ts";
import { parseRecentNotes, rememberRecentNote } from "./navigation.ts";
import { parsePaneLayout } from "./panes.ts";

describe("editor chrome", () => {
  it("clamps zoom to Evernote-like 50–200% steps", () => {
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

describe("windowTitleForNote", () => {
  it("uses the note title like Evernote's window chrome", () => {
    assert.equal(windowTitleForNote(null), "Notebook");
    assert.equal(windowTitleForNote(""), "Untitled – Notebook");
    assert.equal(windowTitleForNote(" Meeting notes "), "Meeting notes – Notebook");
  });
});

describe("parsePaneLayout", () => {
  it("steps font sizes and stamps date/time", () => {
    assert.equal(nextFontSize("16px", 1), "18px");
    assert.equal(nextFontSize("16px", -1), "14px");
    assert.equal(nextFontSize(undefined, 1), "18px");
    assert.match(insertDateStamp(new Date("2026-08-19T15:04:00")), /2026/);
    assert.match(insertTimeStamp(new Date("2026-08-19T15:04:00")), /4/);
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

  it("exposes Evernote's seven highlight swatches", () => {
    assert.deepEqual(
      HIGHLIGHT_COLORS.map((swatch) => swatch.id),
      ["yellow", "green", "pink", "blue", "orange", "purple", "gray"]
    );
  });

  it("labels save state the way Evernote does", () => {
    assert.equal(saveStateLabel("saved"), "All changes saved");
    assert.equal(saveStateLabel("saving"), "Saving…");
    assert.equal(saveStateLabel("error"), "Couldn't save");
  });
});
