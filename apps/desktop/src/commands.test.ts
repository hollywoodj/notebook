import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  COMMANDS,
  PALETTE_ORDER,
  commandById,
  formatBinding,
  matchCommand,
  paletteActions,
  runCommandById,
  type CommandContext,
  type KeyBinding,
} from "./commands.ts";
import { defaultEditorChrome } from "./ui/editorChrome.ts";
import { defaultPaneLayout } from "./ui/panes.ts";

const noop = () => {};
const asyncNoop = async () => {};

function stubContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    filter: { type: "all" },
    selectedNoteIds: new Set(),
    selectedNotes: [],
    shortcutIds: new Set(),
    stacks: [],
    notes: [],
    activeNote: null,
    activeTabId: "tab-1",
    paneLayout: defaultPaneLayout(),
    editorChrome: defaultEditorChrome(),
    prefs: {
      theme: "light",
      confirm_delete: true,
    } as CommandContext["prefs"],
    showInfo: false,
    focusMode: false,
    isShortcut: false,
    allSelectedPinned: false,
    allSelectedArchived: false,
    allSelectedShortcuts: false,
    targetNoteIds: () => [],
    createNote: noop,
    createBlankNote: noop,
    openNewStack: noop,
    openRename: noop,
    openSettings: noop,
    openNewTab: noop,
    openInNewTab: noop,
    closeTab: noop,
    loadNote: noop,
    setNewNotebookStackId: noop,
    setNewName: noop,
    setShowNewNotebook: noop,
    setShowNewTag: noop,
    setShowGallery: noop,
    setNotebookPicker: noop,
    setShowInfo: noop,
    setShowJump: noop,
    runEditorCommand: noop,
    openFind: noop,
    openReplace: noop,
    setFocusMode: noop,
    setFilter: noop,
    setSelectedNoteIds: noop,
    setShowReminderMenu: noop,
    setPrefs: noop,
    setActiveNote: noop,
    persistPaneLayout: noop,
    persistEditorChrome: noop,
    revealSidebarFlyout: noop,
    closeSidebarFlyout: noop,
    restoreSelectedNotes: noop,
    deleteSelectedNotes: noop,
    shortcutSelectedNotes: noop,
    pinSelectedNotes: noop,
    duplicateSelectedNotes: noop,
    mergeSelectedNotes: noop,
    exportSelectedNotes: noop,
    archiveSelectedNotes: noop,
    updateNoteById: asyncNoop,
    refreshMeta: asyncNoop,
    refreshNotes: asyncNoop,
    confirm: async () => true,
    printActiveNote: noop,
    copyActiveNoteLink: noop,
    copyActiveNoteAs: noop,
    exportNotebook: noop,
    snoozeReminder: noop,
    searchInNotebook: noop,
    setListView: noop,
    importNotes: noop,
    setNotebookDefault: noop,
    setNotebookStack: noop,
    deleteNotebook: noop,
    deleteStack: noop,
    deleteTag: noop,
    restoreTemplates: noop,
    toggleTheme: noop,
    collapsedStacks: [],
    toggleStackCollapsed: noop,
    collapseAllStacks: noop,
    expandAllStacks: noop,
    canGoBack: false,
    canGoForward: false,
    goBack: noop,
    goForward: noop,
    emailActiveNote: noop,
    toggleReminderDone: noop,
    openCommandPalette: noop,
    isReminderCompleted: () => false,
    openGlobalSearch: noop,
    ...overrides,
  };
}

function fakeEvent(
  key: string,
  mods: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; altKey?: boolean } = {}
) {
  return {
    key,
    ctrlKey: !!mods.ctrlKey,
    metaKey: !!mods.metaKey,
    shiftKey: !!mods.shiftKey,
    altKey: !!mods.altKey,
  };
}

describe("command registry", () => {
  it("has unique ids", () => {
    const ids = COMMANDS.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("has no two commands sharing an identical binding", () => {
    const seen = new Set<string>();
    for (const cmd of COMMANDS) {
      for (const b of cmd.keys ?? []) {
        const key = `${b.key.toLowerCase()}|${!!b.mod}|${!!b.shift}|${!!b.alt}`;
        assert.equal(seen.has(key), false, `duplicate binding ${key} (${cmd.id})`);
        seen.add(key);
      }
    }
  });

  it("formatBinding reproduces every existing shortcut string byte-for-byte", () => {
    const cases: [KeyBinding, string][] = [
      [{ key: "n", mod: true }, "Ctrl/⌘ N"],
      [{ key: "n", mod: true, shift: true }, "Ctrl/⌘ ⇧ N"],
      [{ key: "t", mod: true, shift: true }, "Ctrl/⌘ ⇧ T"],
      [{ key: "o", mod: true, alt: true }, "Ctrl/⌘ Alt O"],
      [{ key: "w", mod: true }, "Ctrl/⌘ W"],
      [{ key: "p", mod: true }, "Ctrl/⌘ P"],
      [{ key: ",", mod: true }, "Ctrl/⌘ ,"],
      [{ key: "f", mod: true }, "Ctrl/⌘ F"],
      [{ key: "h", mod: true }, "Ctrl/⌘ H"],
      [{ key: "[", mod: true }, "Ctrl/⌘ ["],
      [{ key: "]", mod: true }, "Ctrl/⌘ ]"],
      [{ key: "ArrowLeft", mod: true, alt: true }, "Ctrl/⌘ Alt ←"],
      [{ key: "ArrowRight", mod: true, alt: true }, "Ctrl/⌘ Alt →"],
      [{ key: "i", mod: true, shift: true }, "Ctrl/⌘ ⇧ I"],
      [{ key: "F11" }, "F11"],
      [{ key: "j", mod: true }, "Ctrl/⌘ J"],
      [{ key: "p", mod: true, shift: true }, "Ctrl/⌘ ⇧ P"],
      [{ key: "+", mod: true }, "Ctrl/⌘ +"],
      [{ key: "-", mod: true }, "Ctrl/⌘ -"],
      [{ key: "0", mod: true }, "Ctrl/⌘ 0"],
      [{ key: "l", mod: true, shift: true }, "Ctrl/⌘ ⇧ L"],
      [{ key: "o", mod: true, shift: true }, "Ctrl/⌘ ⇧ O"],
      [{ key: "c", mod: true, shift: true }, "Ctrl/⌘ ⇧ C"],
      [{ key: "/", mod: true }, "Ctrl/⌘ /"],
      [{ key: "k", mod: true }, "Ctrl/⌘ K"],
    ];
    for (const [binding, expected] of cases) {
      assert.equal(formatBinding(binding), expected, JSON.stringify(binding));
    }
  });

  it("matches keys case-insensitively (regression: Ctrl+Shift+N/T/I/F used to be dead)", () => {
    const ctxWithNote = stubContext({ activeNote: { id: "n1" } as CommandContext["activeNote"] });

    assert.equal(
      matchCommand(fakeEvent("N", { ctrlKey: true, shiftKey: true }), stubContext())?.id,
      "note.newFromTemplate"
    );
    assert.equal(
      matchCommand(fakeEvent("T", { ctrlKey: true, shiftKey: true }), stubContext())?.id,
      "tab.new"
    );
    assert.equal(
      matchCommand(fakeEvent("I", { ctrlKey: true, shiftKey: true }), ctxWithNote)?.id,
      "view.noteInfo"
    );
    assert.equal(
      matchCommand(fakeEvent("F", { ctrlKey: true, shiftKey: true }), stubContext())?.id,
      "search.global"
    );
  });

  it("uses exact modifier matching so mod+shift+p isn't swallowed by mod+p", () => {
    const ctxWithNote = stubContext({ activeNote: { id: "n1" } as CommandContext["activeNote"] });
    assert.equal(
      matchCommand(fakeEvent("p", { ctrlKey: true, shiftKey: true }), ctxWithNote)?.id,
      "palette.open"
    );
    assert.equal(
      matchCommand(fakeEvent("p", { ctrlKey: true }), ctxWithNote)?.id,
      "note.print"
    );
  });

  it("skips a matched command whose enabled() is false", () => {
    // find.replace requires an active note; with none, mod+h should not match it.
    assert.equal(matchCommand(fakeEvent("h", { ctrlKey: true }), stubContext()), null);
  });

  it("keeps mod+f live with no note so it can fall back to global search", () => {
    // Regression: find.inNote must NOT carry an `enabled` gate, or the keyboard
    // shortcut goes dead instead of opening global search. The menu item is
    // greyed out via an explicit `disabled` override instead.
    assert.equal(
      matchCommand(fakeEvent("f", { ctrlKey: true }), stubContext())?.id,
      "find.inNote"
    );
    let openedFind = 0;
    let openedGlobal = 0;
    runCommandById(
      "find.inNote",
      stubContext({ openFind: () => (openedFind += 1), openGlobalSearch: () => (openedGlobal += 1) })
    );
    assert.equal(openedFind, 0);
    assert.equal(openedGlobal, 1);
  });

  it("keeps every palette id pointed at a real command", () => {
    for (const id of PALETTE_ORDER) {
      assert.ok(commandById(id), `missing command for palette id "${id}"`);
    }
  });

  it("builds the palette in the documented order and count", () => {
    const actions = paletteActions(stubContext());
    assert.equal(actions.length, 19);
    assert.deepEqual(
      actions.map((a) => a.id),
      PALETTE_ORDER
    );
  });

  it("runs every command against a stub context without throwing", () => {
    const ctx = stubContext({ activeNote: { id: "n1" } as CommandContext["activeNote"] });
    for (const cmd of COMMANDS) {
      assert.doesNotThrow(() => cmd.run(ctx), `command "${cmd.id}" threw`);
    }
  });
});
