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

  it("declares the note session before the boot-screen return", () => {
    const sessionHook = appSource.indexOf("useNoteSession(noteSession)");
    const bootReturn = appSource.indexOf("if (error) {");
    assert.ok(sessionHook > 0);
    assert.ok(sessionHook < bootReturn);
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
    assert.match(appSource, /className="menu-popover sidebar-more-menu" role="menu"/);
    assert.match(appSource, /searchOpen \|\| filter\.type === "search"/);
    assert.match(appSource, /sidebarFilterOpen \|\| Boolean\(sidebarFilter\.trim\(\)\)/);
    assert.equal(appSource.includes('placeholder="Search"'), false);
    assert.match(appSource, /<SearchDialog/);
    assert.match(appSource, /onBack=\{goBack\}/);
    assert.match(appSource, /canGoBack=\{navPast\.length > 0\}/);
    const tabBar = readFileSync(new URL("./components/NoteTabBar.tsx", import.meta.url), "utf8");
    assert.match(tabBar, /className="note-history"/);
    assert.match(tabBar, /className="note-tab-new"/);
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(styles, /border-radius: 999px/);
    assert.match(styles, /\.note-tab-new \{[\s\S]*border-radius: 50%/);
    assert.match(styles, /\.search-dialog \{/);
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

  it("previews shortcuts, notebooks, and tags on hover and pins them on click", () => {
    assert.match(appSource, /sidebarFlyout === "shortcuts"/);
    assert.match(appSource, /sidebarFlyout === "notebooks"/);
    assert.match(appSource, /sidebarFlyout === "tags"/);
    assert.match(appSource, /sidebar-flyout \$\{sidebarFlyoutPinned/);
    assert.match(appSource, /shortcutNotes\.map/);
    assert.match(appSource, /visibleTags\.map/);
    assert.match(appSource, /Star a note to add it to Shortcuts/);
    assert.match(appSource, /previewSidebarFlyout\("tags"\)/);
    assert.match(appSource, /previewSidebarFlyout\("notebooks"\)/);
    assert.match(appSource, /previewSidebarFlyout\("shortcuts"\)/);
    assert.match(appSource, /onMouseLeave=\{scheduleSidebarFlyoutClose\}/);
    assert.match(appSource, /aria-haspopup="dialog"/);
    assert.match(appSource, /openSidebarFlyout\("tags"\)/);
    assert.match(appSource, /openSidebarFlyout\("notebooks"\)/);
    assert.match(appSource, /openSidebarFlyout\("shortcuts"\)/);
    assert.match(appSource, /closeSidebarFlyout\(\);/);
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
    assert.equal(appSource.includes("sidebar-rail-toggle"), false);
    assert.equal(appSource.includes('label="Resize sidebar"'), false);
    assert.match(appSource, /className="sidebar-divider"/);

    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(styles, /\.app-shell\.sidebar-rail \{/);
    assert.match(styles, /\.app-shell\.sidebar-rail \.sidebar-nav \.nav-label/);
    assert.equal(styles.includes("rail-open"), false);
  });

  it("labels every rail icon without an account or expansion control", () => {
    for (const label of ["Notes", "Shortcuts", "Reminders", "Notebooks", "Tags", "Templates", "Trash"]) {
      assert.match(appSource, new RegExp(`<span className="nav-label">${label}</span>`));
    }
    assert.equal(appSource.includes('title="Account"'), false);
    assert.equal(appSource.includes("account-popover"), false);
    assert.equal(menuSource.includes("Expand Sidebar"), false);
    assert.equal(menuSource.includes("Pin Sidebar Open"), false);
    const settingsSource = readFileSync(
      new URL("./components/SettingsModal.tsx", import.meta.url),
      "utf8"
    );
    assert.equal(settingsSource.includes("Collapse / expand sidebar"), false);
  });

  it("counts the current view rather than repeating the all-notes total", () => {
    assert.match(appSource, /title="Notes in this view"/);
    assert.match(appSource, /\{visibleNotes\.length\}/);
    assert.match(appSource, /\{shortcutNotes\.length\}/);
    assert.match(appSource, /\{notebooks\.length\}/);
    assert.match(navSource, /notebook\.note_count \?\? 0/);
  });
});

describe("Evernote list chrome", () => {
  it("shows recent searches, filter chips, and stack collapse", () => {
    assert.match(appSource, /Has reminder/);
    assert.match(appSource, /Has attachment/);
    assert.match(appSource, /note-card-thumb/);
    assert.match(appSource, /meta-chip/);
    assert.match(appSource, /persistCollapsedStacks/);
    assert.equal(appSource.includes("account-popover"), false);
    assert.match(appSource, /e\.key === "j" \|\| e\.key === "k"/);
    assert.match(appSource, /This week/);
    assert.match(appSource, /Later today/);
    assert.match(appSource, /outlineOpen=\{editorChrome\.outlineOpen\}/);
    const searchSource = readFileSync(new URL("./components/SearchDialog.tsx", import.meta.url), "utf8");
    assert.match(searchSource, /Recent searches/);
    assert.match(searchSource, /notebook: tag: intitle:/);
    assert.match(menuSource, /Collapse stack/);
    assert.match(menuSource, /label: "Align"/);
    assert.match(menuSource, /label: "Table"/);
    assert.match(menuSource, /label: "Font"/);
    assert.match(menuSource, /Show Note Outline/);
    assert.match(menuSource, /Export as Markdown/);
    assert.match(menuSource, /Export notebook as Evernote XML/);
    assert.match(appSource, /LAST_SESSION_KEY/);
    assert.match(appSource, /<CommandPalette/);
    assert.match(appSource, /groupRemindersForList/);
    assert.match(appSource, /groupNotesByNotebook/);
    assert.match(appSource, /noteMailtoHref/);
    assert.match(appSource, /hoverPreview/);
    assert.match(appSource, /onCreateTag/);
    assert.match(searchSource, /Saved searches/);
    assert.match(searchSource, /Save this search/);
    assert.match(menuSource, /Email Note/);
    assert.match(menuSource, /Command Palette/);
    assert.match(menuSource, /Mark reminder done/);
    const editorSource = readFileSync(new URL("./components/NoteEditor.tsx", import.meta.url), "utf8");
    assert.match(editorSource, /CODE_LANGUAGES/);
    assert.match(editorSource, /aria-label="Code language"/);
  });
});
