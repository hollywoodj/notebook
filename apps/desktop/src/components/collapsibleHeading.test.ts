import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { hiddenBlockIndexes, hidesAnything, type BlockOutline } from "./collapsibleHeading.ts";

const collapsibleHeadingSource = readFileSync(
  new URL("./collapsibleHeading.ts", import.meta.url),
  "utf8"
);
const editorSource = readFileSync(new URL("./NoteEditor.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function heading(level: number, collapsed = false): BlockOutline {
  return { isHeading: true, level, collapsed };
}

function block(): BlockOutline {
  return { isHeading: false, level: 0, collapsed: false };
}

describe("hiddenBlockIndexes", () => {
  it("hides following paragraphs under a collapsed h1 until the next h1", () => {
    const blocks = [heading(1, true), block(), block(), heading(1), block()];
    assert.deepEqual([...hiddenBlockIndexes(blocks)].sort(), [1, 2]);
  });

  it("a collapsed h1 also hides a nested h2 and that h2's content", () => {
    const blocks = [heading(1, true), heading(2), block(), heading(1), block()];
    assert.deepEqual([...hiddenBlockIndexes(blocks)].sort(), [1, 2]);
  });

  it("an h2 collapsed under an expanded h1 hides only up to the next h2-or-higher", () => {
    const blocks = [heading(1), heading(2, true), block(), heading(2), block(), heading(1)];
    assert.deepEqual([...hiddenBlockIndexes(blocks)].sort(), [2]);
  });

  it("nothing collapsed hides nothing", () => {
    const blocks = [heading(1), block(), heading(2), block()];
    assert.deepEqual([...hiddenBlockIndexes(blocks)], []);
  });

  it("a collapsed heading at the end of the doc hides nothing", () => {
    const blocks = [block(), heading(1, true)];
    assert.deepEqual([...hiddenBlockIndexes(blocks)], []);
  });

  it("nested headings inside a hidden range stay hidden regardless of their own collapsed flag", () => {
    const blocks = [heading(1, true), heading(2, false), block(), heading(1)];
    assert.deepEqual([...hiddenBlockIndexes(blocks)].sort(), [1, 2]);
  });

  it("a collapsed heading is never hidden by itself, only by an ancestor", () => {
    const blocks = [heading(1, true), block()];
    const hidden = hiddenBlockIndexes(blocks);
    assert.equal(hidden.has(0), false);
  });
});

describe("hidesAnything", () => {
  it("is false for a heading immediately followed by a same-or-higher-level heading", () => {
    const blocks = [heading(2), heading(1), block()];
    assert.equal(hidesAnything(blocks, 0), false);
  });

  it("is false for a heading immediately followed by end of document", () => {
    const blocks = [block(), heading(1)];
    assert.equal(hidesAnything(blocks, 1), false);
  });

  it("is true when the heading has at least one following block it would hide", () => {
    const blocks = [heading(1), block(), heading(2)];
    assert.equal(hidesAnything(blocks, 0), true);
  });
});

describe("collapsibleHeading wiring", () => {
  it("is registered as an extension in NoteEditor.tsx", () => {
    assert.match(editorSource, /import \{ CollapsibleHeading \} from "\.\/collapsibleHeading"/);
    assert.match(editorSource, /extensions:\s*\[[\s\S]*CollapsibleHeading,[\s\S]*\]/);
  });

  it("parses the legacy --en-isCollapsed marker for unopened Evernote imports", () => {
    assert.match(collapsibleHeadingSource, /--en-iscollapsed:\\s\*true/i);
  });

  it("styles.css hides collapsed blocks and reveals the toggle when collapsed", () => {
    assert.match(stylesSource, /\.collapsed-hidden[^{]*\{\s*display:\s*none;/);
    assert.match(stylesSource, /\.heading-collapsible\.is-collapsed \.heading-collapse-toggle/);
  });
});
