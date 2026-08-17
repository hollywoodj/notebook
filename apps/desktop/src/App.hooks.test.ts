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
});

describe("Evernote sidebar chrome", () => {
  it("uses icon actions for search, new note, and more, without a standing search bar", () => {
    assert.match(appSource, /className="sidebar-toolbar"/);
    assert.match(appSource, /title="Search"/);
    assert.match(appSource, /title="New note"/);
    assert.match(appSource, /title="More actions"/);
    assert.match(appSource, /searchOpen \|\| filter\.type === "search"/);
    assert.match(appSource, /sidebarFilterOpen \|\| Boolean\(sidebarFilter\.trim\(\)\)/);
    assert.equal(appSource.includes('placeholder="Search"'), false);
    assert.match(appSource, /placeholder="Search notes"/);
  });

  it("exposes hide note list and expand note as a pair", () => {
    assert.match(appSource, /title=\{paneLayout\.listCollapsed \? "Show note list" : "Hide note list"\}/);
    assert.match(appSource, /title=\{isNoteExpanded\(paneLayout\) \? "Restore panes" : "Expand note"\}/);
    assert.match(appSource, /toggleNoteListHidden/);
    assert.match(appSource, /toggleNoteExpanded/);
    assert.match(appSource, /className="note-chrome"/);
  });

  it("keeps import in the menu bar instead of the sidebar", () => {
    assert.match(appSource, /label: "Import Notes…"/);
    assert.match(appSource, /label: "Import from Evernote…"/);
    assert.equal(appSource.includes("Evernote (.enex)"), false);
    assert.equal(appSource.includes("prefs.show_import"), false);
  });

  it("pops out shortcuts and notebooks with their contents", () => {
    assert.match(appSource, /sidebarFlyout === "shortcuts"/);
    assert.match(appSource, /sidebarFlyout === "notebooks"/);
    assert.match(appSource, /className="sidebar-flyout"/);
    assert.match(appSource, /shortcutNotes\.map/);
    assert.match(appSource, /Star a note to add it to Shortcuts/);
  });

  it("counts the current view rather than repeating the all-notes total", () => {
    assert.match(appSource, /title="Notes in this view"/);
    assert.match(appSource, /\{notes\.length\}/);
    assert.match(appSource, /\{shortcutNotes\.length\}/);
    assert.match(appSource, /\{notebooks\.length\}/);
    assert.match(appSource, /notebook\.note_count \?\? 0/);
  });
});
