import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { checkboxShortcutKind } from "./inlineCheckbox.ts";

const editorSource = readFileSync(new URL("./NoteEditor.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

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
  });

  it("exposes checklist, insert checkbox, quote, code, and justify in Format", () => {
    assert.match(appSource, /label: "Checklist"/);
    assert.match(appSource, /label: "Insert Checkbox"/);
    assert.match(appSource, /label: "Quote"/);
    assert.match(appSource, /label: "Code Block"/);
    assert.match(appSource, /label: "Inline Code"/);
    assert.match(appSource, /label: "Justify"/);
    assert.equal(appSource.includes("Checkbox List"), false);
  });
});
