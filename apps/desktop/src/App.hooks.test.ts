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

  it("uses an Evernote-style icon-only sidebar rail", () => {
    assert.match(appSource, /className=\{\s*"app-shell sidebar-rail"/);
    assert.match(appSource, /SIDEBAR_RAIL_WIDTH/);
    assert.equal(appSource.includes("toggleSidebarRail"), false);
    assert.equal(appSource.includes("sidebarHovered"), false);
    assert.equal(appSource.includes("sidebarFocused"), false);
    assert.equal(appSource.includes("Pin sidebar open"), false);
    assert.equal(appSource.includes("Collapse sidebar to icons"), false);
    assert.equal(menuSource.includes("Pin Sidebar Open"), false);
    assert.equal(menuSource.includes("Collapse Sidebar to Icons"), false);

    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    assert.match(styles, /\.app-shell\.sidebar-rail \.sidebar-nav \.nav-label/);
    assert.match(styles, /display: none/);
    assert.equal(styles.includes("rail-open"), false);
  });

  it("keeps section names for tooltips and flyouts, without pinning a labeled pane", () => {
    for (const label of ["Notes", "Shortcuts", "Reminders", "Notebooks", "Tags", "Templates", "Trash"]) {
      assert.match(appSource, new RegExp(`<span className="nav-label">${label}</span>`));
    }
    assert.match(appSource, /navIconTitle\("Notes"/);
    assert.match(appSource, /navIconTitle\("Notebooks"/);
  });

  it("counts the current view rather than repeating the all-notes total", () => {
    assert.match(appSource, /title="Notes in this view"/);
    assert.match(appSource, /displayedListCount\(/);
    assert.match(appSource, /knownViewNoteCount\(/);
    assert.match(appSource, /stickyNavCount\(notebooks\.length/);
    assert.match(navSource, /navCountLabel\(notebook\.note_count\)/);
  });

  it("does not flash a zero notes count before the current view has loaded", () => {
    const start = appSource.indexOf("const health = await api.health()");
    const end = appSource.indexOf('setError("Could not connect');
    assert.ok(start > 0 && end > start);
    const boot = appSource.slice(start, end);
    const readyAt = boot.indexOf("setReady(true)");
    assert.ok(readyAt > 0);
    assert.ok(boot.lastIndexOf("await refreshMeta()", readyAt) >= 0);
    assert.ok(boot.lastIndexOf("setNotes(", readyAt) >= 0);
    assert.ok(boot.lastIndexOf("setNotesFilterKey(", readyAt) >= 0);
    assert.match(appSource, /notesFilterKey === viewFilterKey\(filter, searchScope\?\.id\)/);
    assert.match(appSource, /lastListCountRef\.current/);
    assert.match(appSource, /navCountLabel\(counts\?\.notes\)/);
    assert.match(appSource, /knownViewNoteCount\(/);
    assert.match(appSource, /displayedListCount\(/);
  });
});

describe("Evernote list and account chrome", () => {
  it("shows recent searches, filter chips, and stack collapse", () => {
    assert.match(appSource, /Has reminder/);
    assert.match(appSource, /Has attachment/);
    assert.match(appSource, /note-card-thumb/);
    assert.match(appSource, /meta-chip/);
    assert.match(appSource, /persistCollapsedStacks/);
    assert.match(appSource, /account-popover/);
    assert.match(appSource, /e\.key === "j" \|\| e\.key === "k"/);
    assert.match(appSource, /This week/);
    assert.match(appSource, /Later today/);
    assert.match(appSource, /outlineOpen=\{editorChrome\.outlineOpen\}/);
    const searchSource = readFileSync(new URL("./components/SearchDialog.tsx", import.meta.url), "utf8");
    assert.match(searchSource, /Recent searches/);
    assert.match(searchSource, /notebook: tag: created: resource:/);
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
    assert.match(menuSource, /Export as PDF/);
    assert.match(menuSource, /Paste and Match Style/);
    assert.match(menuSource, /Go to Notebook/);
    assert.match(menuSource, /Find Next/);
    assert.match(menuSource, /Insert Table of Contents/);
    assert.match(appSource, /type: "archived"/);
    assert.match(appSource, /Untagged/);
    assert.match(appSource, /Clear filters/);
    assert.match(appSource, /trash-toast/);
    assert.match(appSource, /formatRelativeTime/);
    assert.match(appSource, /canReopenClosedTab/);
    const editorSource = readFileSync(new URL("./components/NoteEditor.tsx", import.meta.url), "utf8");
    assert.match(editorSource, /CODE_LANGUAGES/);
    assert.match(editorSource, /aria-label="Code language"/);
    assert.match(editorSource, /findCaseSensitive/);
    assert.match(editorSource, /code-copy-btn/);
    assert.match(editorSource, /CaptionImage/);
    assert.match(editorSource, /IMAGE_SIZE_PRESETS/);
  });
});

describe("menu bar, sidebar icons, and OmniClone", () => {
  it("keeps Settings in File and the account menu, not on the sidebar", () => {
    assert.equal(appSource.includes('title="Settings"'), false);
    assert.equal(appSource.includes("Icon.Gear"), false);
    assert.match(menuSource, /label: "Settings…"/);
    assert.match(appSource, /account-popover/);
  });

  it("uses 20px sidebar nav icons and a 22px application menu bar", () => {
    const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
    const chrome = readFileSync(new URL("./uiChrome.ts", import.meta.url), "utf8");
    assert.match(chrome, /export const SIDEBAR_NAV_ICON_SIZE = 20/);
    assert.match(chrome, /export const SIDEBAR_RAIL_WIDTH = 56/);
    assert.match(appSource, /Icon\.Notes size=\{SIDEBAR_NAV_ICON_SIZE\}/);
    assert.match(styles, /\.app-menu-bar \{[\s\S]*height: 22px/);
    assert.match(styles, /\.app-menu-trigger \{[\s\S]*height: 22px/);
    assert.match(styles, /\.nav-item > svg \{[\s\S]*width: 20px/);
  });

  it("sends notes to OmniClone the way Evernote shares into OmniFocus", () => {
    assert.match(menuSource, /Send to OmniClone/);
    assert.match(menuSource, /Send Checkboxes to OmniClone/);
    assert.match(menuSource, /OmniClone Integration/);
    assert.match(appSource, /sendUrlsForNote/);
    assert.match(appSource, /parseNotebookUrl/);
    const settings = readFileSync(new URL("./components/SettingsModal.tsx", import.meta.url), "utf8");
    assert.match(settings, /id: "integrations"/);
  });
});
