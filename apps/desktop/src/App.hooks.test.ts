import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

describe("App hook order", () => {
  it("does not call hooks after the boot-screen early return", () => {
    const bootReturn = appSource.indexOf("if (error) {");
    assert.ok(bootReturn > 0, "expected the boot-screen error return");
    const afterBootReturn = appSource.slice(bootReturn);
    const hookAfterReturn = afterBootReturn.match(
      /\buse(?:Memo|Effect|Callback|State|Ref|LayoutEffect)\s*\(/
    );
    assert.equal(
      hookAfterReturn,
      null,
      `hooks after the boot-screen return crash React to a white screen on startup; found ${hookAfterReturn?.[0]}`
    );
  });

  it("keeps groupedNotes memoized before the boot-screen return", () => {
    const groupedNotes = appSource.indexOf("const groupedNotes = useMemo(");
    const bootReturn = appSource.indexOf("if (error) {");
    assert.ok(groupedNotes > 0);
    assert.ok(groupedNotes < bootReturn);
  });

  it("wires Evernote-style toolbar focus and attachment collapse", () => {
    assert.match(appSource, /attachmentsExpanded=\{editorChrome\.attachmentsExpanded\}/);
    assert.match(appSource, /Hide Attachments/);
    const editorSource = readFileSync(new URL("./components/NoteEditor.tsx", import.meta.url), "utf8");
    assert.match(editorSource, /formattingToolbarVisible\(toolbarHidden, editorFocused\)/);
    assert.match(editorSource, /note-attachments-toggle/);
  });
});
