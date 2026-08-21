import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkboxShortcutKind } from "./inlineCheckbox.ts";

const editorSource = readFileSync(new URL("./NoteEditor.tsx", import.meta.url), "utf8");
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
  it("groups bullets, numbers, and checklist together and omits the extra checkbox control", () => {
    const bullets = editorSource.indexOf('"Bulleted list"');
    const numbers = editorSource.indexOf('"Numbered list"');
    const checklist = editorSource.indexOf('"Checklist"');
    const checkbox = editorSource.indexOf('"Checkbox"');
    const align = editorSource.indexOf('"Align left"');
    const quote = editorSource.indexOf('"Quote"');
    assert.ok(bullets > 0);
    assert.ok(numbers > bullets);
    assert.ok(checklist > numbers);
    assert.equal(checkbox, -1);
    assert.ok(align > checklist);
    assert.ok(quote > align);
    assert.match(editorSource, /toolbar-list-group/);
    assert.match(editorSource, /toggleTaskList/);
    assert.match(editorSource, /InlineCheckbox/);
    assert.match(editorSource, /toolbar-overflow/);
    assert.match(editorSource, /setFontFamily/);
    assert.match(editorSource, /Open link/);
  });

  it("exposes checklist, quote, code, and justify in Format without a redundant checkbox item", () => {
    assert.match(menuSource, /label: "Checklist"/);
    assert.equal(menuSource.includes('label: "Insert Checkbox"'), false);
    assert.match(menuSource, /label: "Quote"/);
    assert.match(menuSource, /label: "Code Block"/);
    assert.match(menuSource, /label: "Inline Code"/);
    assert.match(menuSource, /label: "Justify"/);
    assert.match(menuSource, /label: "Superscript"/);
    assert.match(menuSource, /label: "Callout"/);
    assert.equal(appSource.includes("Checkbox List"), false);
  });
});
