import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkboxShortcutKind } from "./inlineCheckbox.ts";

const editorSource = readFileSync(new URL("./NoteEditor.tsx", import.meta.url), "utf8");
const draggableTaskItemSource = readFileSync(
  new URL("./draggableTaskItem.tsx", import.meta.url),
  "utf8"
);
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../appMenus.ts", import.meta.url), "utf8");

describe("checkboxShortcutKind", () => {
  it("recognizes unchecked and checked tokens", () => {
    assert.equal(checkboxShortcutKind("[]"), "unchecked");
    assert.equal(checkboxShortcutKind("[ ]"), "unchecked");
    assert.equal(checkboxShortcutKind("[x]"), "checked");
    assert.equal(checkboxShortcutKind("[X]"), "checked");
    assert.equal(checkboxShortcutKind("[yes]"), null);
  });
});

describe("note list and checkbox commands", () => {
  it("keeps checklist and checkbox next to bullets and numbers in the toolbar", () => {
    const bullets = editorSource.indexOf('"Bulleted list"');
    const numbers = editorSource.indexOf('"Numbered list"');
    const checklist = editorSource.indexOf('"Checklist"');
    const checkbox = editorSource.indexOf('"Checkbox"');
    assert.ok(bullets > 0);
    assert.ok(numbers > bullets);
    assert.ok(checklist > numbers);
    assert.ok(checkbox > checklist);
    assert.match(editorSource, /toggleTaskList/);
    assert.match(editorSource, /insertInlineCheckbox/);
    assert.match(editorSource, /InlineCheckbox/);
    assert.match(editorSource, /toolbar-overflow/);
    assert.match(editorSource, /setFontFamily/);
    assert.match(editorSource, /Open link/);
  });

  it("exposes checklist, insert checkbox, quote, code, and justify in Format", () => {
    assert.match(menuSource, /label: "Checklist"/);
    assert.match(menuSource, /label: "Insert Checkbox"/);
    assert.match(menuSource, /label: "Quote"/);
    assert.match(menuSource, /label: "Code Block"/);
    assert.match(menuSource, /label: "Inline Code"/);
    assert.match(menuSource, /label: "Justify"/);
    assert.match(menuSource, /label: "Superscript"/);
    assert.match(menuSource, /label: "Callout"/);
    assert.equal(appSource.includes("Checkbox List"), false);
  });

  it("renders checklist items with an explicit pointer drag handle", () => {
    assert.match(editorSource, /DraggableTaskItem\.configure\(\{ nested: true \}\)/);
    assert.match(draggableTaskItemSource, /onPointerDown=\{startDrag\}/);
    assert.match(draggableTaskItemSource, /reorderTaskItem/);
    assert.match(draggableTaskItemSource, /is-task-drop-before/);
    assert.match(draggableTaskItemSource, /data-drag-handle/);
    assert.match(draggableTaskItemSource, /Drag to reorder/);
    assert.match(draggableTaskItemSource, /Alt\+↑\/↓/);
    assert.match(draggableTaskItemSource, /task-item-content/);
  });

  it("keeps checklist text aligned after Backspace joins or removes an item", () => {
    assert.match(
      stylesSource,
      /\.task-item-content\[data-node-view-content\] > p/
    );
    assert.doesNotMatch(stylesSource, /data-node-view-content-react/);
  });

  it("reserves the formatting toolbar height while gently revealing its controls", () => {
    assert.match(editorSource, /editor-toolbar.*is-visible.*is-concealed/);
    assert.match(stylesSource, /\.editor-toolbar\.is-concealed/);
    assert.match(stylesSource, /flex: 0 0 44px/);
    assert.match(stylesSource, /transition: opacity 160ms ease/);
  });
});
