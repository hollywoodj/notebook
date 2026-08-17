import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("./appMenus.ts", import.meta.url), "utf8");
const navSource = readFileSync(
  new URL("./components/NotebookNavItem.tsx", import.meta.url),
  "utf8"
);

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
    assert.match(menuSource, /Hide Attachments/);
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
    assert.match(menuSource, /label: "Import Notes…"/);
    assert.match(menuSource, /label: "Import from Evernote…"/);
    assert.equal(appSource.includes("Evernote (.enex)"), false);
    assert.equal(appSource.includes("prefs.show_import"), false);
  });

  it("pops out shortcuts, notebooks, and tags with their contents", () => {
    assert.match(appSource, /sidebarFlyout === "shortcuts"/);
    assert.match(appSource, /sidebarFlyout === "notebooks"/);
    assert.match(appSource, /sidebarFlyout === "tags"/);
    assert.match(appSource, /className="sidebar-flyout"/);
    assert.match(appSource, /shortcutNotes\.map/);
    assert.match(appSource, /visibleTags\.map/);
    assert.match(appSource, /Star a note to add it to Shortcuts/);
    assert.match(appSource, /openSidebarFlyout\("tags"\)/);
    assert.match(appSource, /openSidebarFlyout\("notebooks"\)/);
    assert.match(appSource, /openSidebarFlyout\("shortcuts"\)/);
  });

  it("keeps tags out of the nav list now that they have their own panel", () => {
    assert.equal(appSource.includes("tagsOpen"), false);
    assert.equal(appSource.includes("nav-section"), false);
  });

  it("holds the icon rail at its width instead of popping the sidebar open", () => {
    assert.match(appSource, /const sidebarRail = isSidebarRail\(paneLayout\)/);
    assert.match(appSource, /sidebarRail \? " sidebar-rail" : ""/);
    assert.match(appSource, /className="sidebar"/);
    assert.equal(appSource.includes("rail-open"), false);
    assert.equal(appSource.includes("sidebarHovered"), false);
    assert.equal(appSource.includes("sidebarFocused"), false);

    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(styles, /\.app-shell\.sidebar-rail \{/);
    assert.match(styles, /\.app-shell\.sidebar-rail \.sidebar-nav \.nav-label/);
    assert.equal(styles.includes("rail-open"), false);
  });

  it("labels every rail icon so hover reveals the same nav text", () => {
    for (const label of ["Notes", "Shortcuts", "Reminders", "Notebooks", "Tags", "Templates", "Trash"]) {
      assert.match(appSource, new RegExp(`<span className="nav-label">${label}</span>`));
    }
    assert.match(appSource, /title=\{sidebarRail \? "Pin sidebar open" : "Collapse sidebar to icons"\}/);
    assert.match(menuSource, /sidebarRail \? "Pin Sidebar Open" : "Collapse Sidebar to Icons"/);
  });

  it("counts the current view rather than repeating the all-notes total", () => {
    assert.match(appSource, /title="Notes in this view"/);
    assert.match(appSource, /\{notes\.length\}/);
    assert.match(appSource, /\{shortcutNotes\.length\}/);
    assert.match(appSource, /\{notebooks\.length\}/);
    assert.match(navSource, /notebook\.note_count \?\? 0/);
  });
});
