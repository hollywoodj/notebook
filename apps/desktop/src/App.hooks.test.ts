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

  it("declares note tab state before the boot-screen return", () => {
    const tabsState = appSource.indexOf("const [tabs, setTabs]");
    const bootReturn = appSource.indexOf("if (error) {");
    assert.ok(tabsState > 0);
    assert.ok(tabsState < bootReturn);
    assert.match(appSource, /Open in New Tab/);
    assert.match(appSource, /<NoteTabBar/);
  });
});
