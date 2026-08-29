import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attachmentsLabel,
  formattingToolbarVisible,
  nextZoom,
  parseEditorChrome,
  windowTitleForNote,
} from "./editorChrome.ts";

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
