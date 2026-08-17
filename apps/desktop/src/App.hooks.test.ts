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

  it("declares note tab state before the boot-screen return", () => {
    const tabsState = appSource.indexOf("const [tabs, setTabs]");
    const bootReturn = appSource.indexOf("if (error) {");
    assert.ok(tabsState > 0);
    assert.ok(tabsState < bootReturn);
    assert.match(appSource, /Open in New Tab/);
    assert.match(appSource, /<NoteTabBar/);
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

  it("shows an icon rail that opens over the note list on hover", () => {
    assert.match(appSource, /const sidebarRail = isSidebarRail\(paneLayout\)/);
    assert.match(appSource, /sidebarHovered \|\| sidebarFocused/);
    assert.match(appSource, /onMouseEnter=\{\(\) => setSidebarHovered\(true\)\}/);
    assert.match(appSource, /onMouseLeave=\{\(\) => setSidebarHovered\(false\)\}/);
    assert.match(appSource, /sidebarRailOpen \? " rail-open" : ""/);
    assert.match(appSource, /sidebarRail \? " sidebar-rail" : ""/);

    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(styles, /\.app-shell\.sidebar-rail \{/);
    assert.match(styles, /\.app-shell\.sidebar-rail \.sidebar\.rail-open \{/);
    assert.match(styles, /\.app-shell\.sidebar-rail \.sidebar:not\(\.rail-open\) \.nav-label/);
  });

  it("labels every rail icon so hover reveals the same nav text", () => {
    for (const label of ["Notes", "Shortcuts", "Reminders", "Notebooks", "Tags", "Templates", "Trash"]) {
      assert.match(appSource, new RegExp(`<span className="nav-label">${label}</span>`));
    }
    assert.match(appSource, /title=\{sidebarRail \? "Pin sidebar open" : "Collapse sidebar to icons"\}/);
    assert.match(appSource, /label: paneLayout\.sidebarRail \? "Pin Sidebar Open" : "Collapse Sidebar to Icons"/);
  });

  it("counts the current view rather than repeating the all-notes total", () => {
    assert.match(appSource, /title="Notes in this view"/);
    assert.match(appSource, /\{notes\.length\}/);
    assert.match(appSource, /\{shortcutNotes\.length\}/);
    assert.match(appSource, /\{notebooks\.length\}/);
    assert.match(appSource, /notebook\.note_count \?\? 0/);
  });
});
