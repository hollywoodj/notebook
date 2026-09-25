import { LogoMark } from "./components/LogoMark";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Account,
  api,
  attachmentUrl,
  defaultPreferences,
  normalizePreferences,
  noteThumbnailUrl,
  Note,
  NoteSummary,
  Notebook,
  Preferences,
  TemplateCatalogItem,
  ViewFilter,
} from "./api";
import { NoteEditor } from "./components/NoteEditor";
import { editorCommands, type EditorHandle } from "./editorHandle";
import {
  SettingsModal,
  SettingsSection,
} from "./components/SettingsModal";
import { TemplateGallery } from "./components/TemplateGallery";
import { Icon } from "./components/Icons";
import { ContextMenu } from "./components/ContextMenu";
import { MenuBar } from "./components/MenuBar";
import { EmptyListState } from "./components/EmptyListState";
import { NotebookNavItem } from "./components/NotebookNavItem";
import { PromptModal } from "./components/PromptModal";
import { NoteInfoPanel } from "./components/NoteInfoPanel";
import { NoteTagBar } from "./components/NoteTagBar";
import { NoteTabBar } from "./components/NoteTabBar";
import { PaneSplitter } from "./components/PaneSplitter";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { JumpToDialog } from "./components/JumpToDialog";
import { SearchDialog } from "./components/SearchDialog";
import { CommandPalette } from "./components/CommandPalette";
import { NotebookPickerDialog } from "./components/NotebookPickerDialog";
import { FilesView } from "./components/FilesView";
import { ShortcutOverlay } from "./components/ShortcutOverlay";
import { ReminderCalendar } from "./components/ReminderCalendar";
import { noteIdsInRange } from "./noteSelection";
import {
  OmniCloneSchemePref,
  parseNotebookUrl,
  sendUrlsForChecklists,
  sendUrlsForNote,
} from "./omniFocus";
import {
  formatDate,
  isBlankNote,
  isTextInputFocused,
  makeNoteTab,
  type NoteTab,
  type ContextTarget,
  type PendingConfirm,
  type RenameTarget,
} from "./appTypes";
import { createNoteActions } from "./noteActions";
import { noteStore } from "./noteStore";
import { useNoteStore } from "./useNoteStore";
import { noteSession } from "./noteSession";
import { useNoteSession } from "./useNoteSession";
import { sidebarFlyout as sidebarFlyoutStore } from "./sidebarFlyout";
import { useSidebarFlyout } from "./useSidebarFlyout";
import { buildContextMenu, buildMenuBar, type AppMenuContext } from "./appMenus";
import { matchCommand, paletteActions, runCommandById } from "./commands";
import { isPdfFile, titleFromFilename } from "./components/fileAttachment";
import { EDITOR_CHROME_KEY, parseEditorChrome, saveStateLabel, windowTitleForNote } from "./ui/editorChrome";
import { LAST_SESSION_KEY, RECENT_NOTES_KEY, parseLastSession, parseRecentNotes, rememberRecentNote, viewTitleForFilter } from "./ui/navigation";
import { LOCKED_NOTES_KEY, NOTE_COLORS, NOTE_COLORS_KEY, countCharacters, countWords, htmlToMarkdown, htmlToPlainText, parseIdList, parseNoteColorMap, readingTimeLabel, resolveThumbnailUrl, setNoteColor as applyNoteColor } from "./ui/noteContent";
import { NOTE_DRAG_TYPE, adjacentNoteId, attachmentCountLabel, decodeNoteDrag, displayedListCount, encodeNoteDrag, formatRelativeTime, groupNotesByNotebook, groupNotesForList, hasActiveListFilters, knownViewNoteCount, listFilterCount, navCountLabel, resolveListView, stickyNavCount, trashToastCopy, type ListView } from "./ui/noteList";
import { noteFontStyleVars, parseNoteFontStyles } from "./ui/noteFonts.ts";
import { LIST_MAX, LIST_MIN, PANE_LAYOUT_KEY, SIDEBAR_RAIL_WIDTH, clampPaneWidth, isNoteExpanded, parsePaneLayout, revealNoteBrowser, toggleNoteExpanded, toggleNoteListHidden, toggleSidebarHidden } from "./ui/panes";
import { COMPLETED_REMINDERS_KEY, formatReminderLabel, fromDatetimeLocalValue, groupRemindersForList, isReminderDone, isReminderOverdue, isoDayKey, parseCompletedReminders, reminderFallsOnDay, reminderFromPreset, reminderFromSnooze, toDatetimeLocalValue, toggleCompletedReminder, type ReminderPreset, type SnoozePreset } from "./ui/reminders";
import { RECENT_SEARCHES_KEY, SAVED_SEARCHES_KEY, deleteSavedSearch, noteMatchesDateRange, noteMatchesFacets, parseRecentSearches, parseSavedSearches, rememberSearch, renameSavedSearch, snippetParts, toggleListFacet, type DateRangeFacet, type NoteListFacet, upsertSavedSearch } from "./ui/search";
import { copyTextToClipboard, downloadTextFile, noteAppLink, noteMailtoHref, notesToEnex, safeFilename } from "./ui/share";
import { filterTopLevelEnexFiles } from "./ui/enexFolderImport";
import { COLLAPSED_STACKS_KEY, SIDEBAR_NAV_ICON_SIZE, SIDEBAR_SECTIONS_KEY, SidebarSectionId, collapseAllIds, hasVisibleSidebarNotebooks, matchesSidebarFilter, navIconTitle, notebooksMatchingFilter, parseCollapsedStacks, parseSidebarSections, partitionSidebarSections, sidebarFilterLabel, sidebarFlyoutTitle, toggleCollapsedId, type SidebarFlyoutKind } from "./ui/sidebar";
import { closeAllUnpinnedTabIds, closeOtherTabIds, closeTabsToTheRight, noteTabLabel, pinTabById, popClosedTab, rememberClosedTab } from "./ui/tabs";



export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState("0.1.1");
  const notebooksStore = useNoteStore(noteStore, "notebooks");
  const notebooks = notebooksStore.data;
  const stacksStore = useNoteStore(noteStore, "stacks");
  const stacks = stacksStore.data;
  const tagsStore = useNoteStore(noteStore, "tags");
  const tags = tagsStore.data;
  const notesStore = useNoteStore(noteStore, "notes");
  const notes = notesStore.data;
  const notesLoaded = notesStore.loaded;
  const templatesStore = useNoteStore(noteStore, "templates");
  const templates = templatesStore.data;
  const [catalog, setCatalog] = useState<TemplateCatalogItem[]>([]);
  const { tabs, activeTabId, activeNote, selectedNoteIds, filter, navPast, navFuture } =
    useNoteSession(noteSession);
  const [searchInput, setSearchInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() =>
    parseRecentSearches(
      typeof localStorage === "undefined" ? null : localStorage.getItem(RECENT_SEARCHES_KEY)
    )
  );
  const [savedSearches, setSavedSearches] = useState(() =>
    parseSavedSearches(
      typeof localStorage === "undefined" ? null : localStorage.getItem(SAVED_SEARCHES_KEY)
    )
  );
  const [closedTabs, setClosedTabs] = useState<NoteTab[]>([]);
  const [jumpMode, setJumpMode] = useState<"all" | "notebook" | "tag">("all");
  const [trashToast, setTrashToast] = useState<{ ids: string[]; message: string } | null>(null);
  const [collapsedListGroups, setCollapsedListGroups] = useState(() =>
    parseCollapsedStacks(
      typeof localStorage === "undefined" ? null : localStorage.getItem("notebook.collapsedListGroups")
    )
  );
  const [recentNotes, setRecentNotes] = useState(() =>
    parseRecentNotes(
      typeof localStorage === "undefined" ? null : localStorage.getItem(RECENT_NOTES_KEY)
    )
  );
  const [sidebarSections, setSidebarSections] = useState<SidebarSectionId[]>(() =>
    parseSidebarSections(
      typeof localStorage === "undefined" ? null : localStorage.getItem(SIDEBAR_SECTIONS_KEY)
    )
  );
  const [lockedNoteIds, setLockedNoteIds] = useState(() =>
    parseIdList(typeof localStorage === "undefined" ? null : localStorage.getItem(LOCKED_NOTES_KEY))
  );
  const [noteColors, setNoteColors] = useState(() =>
    parseNoteColorMap(
      typeof localStorage === "undefined" ? null : localStorage.getItem(NOTE_COLORS_KEY)
    )
  );
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [calendarDay, setCalendarDay] = useState<string | null>(null);
  const [selectionWords, setSelectionWords] = useState(0);
  const [completedReminders, setCompletedReminders] = useState(() =>
    parseCompletedReminders(
      typeof localStorage === "undefined" ? null : localStorage.getItem(COMPLETED_REMINDERS_KEY)
    )
  );
  const [showPalette, setShowPalette] = useState(false);
  const [hoverPreview, setHoverPreview] = useState<{
    note: NoteSummary;
    x: number;
    y: number;
  } | null>(null);
  const [listFacets, setListFacets] = useState<NoteListFacet[]>([]);
  const [listDateRange, setListDateRange] = useState<DateRangeFacet>("any");
  const [searchScope, setSearchScope] = useState<{ id: string; name: string } | null>(null);
  const [collapsedStacks, setCollapsedStacks] = useState(() =>
    parseCollapsedStacks(
      typeof localStorage === "undefined" ? null : localStorage.getItem(COLLAPSED_STACKS_KEY)
    )
  );
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [showNewNotebook, setShowNewNotebook] = useState(false);
  const [showNewStack, setShowNewStack] = useState(false);
  const [showNewTag, setShowNewTag] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const [jumpNotes, setJumpNotes] = useState<NoteSummary[]>([]);
  const [jumpTrashNotes, setJumpTrashNotes] = useState<NoteSummary[]>([]);
  const [listFiltersOpen, setListFiltersOpen] = useState(false);
  const [notebookPicker, setNotebookPicker] = useState<"move" | "copy" | null>(null);
  const [showReminderMenu, setShowReminderMenu] = useState(false);
  const [showNoteColorMenu, setShowNoteColorMenu] = useState(false);
  const [showTagMenu, setShowTagMenu] = useState(false);
  const [showNotebookCrumbMenu, setShowNotebookCrumbMenu] = useState(false);
  const [editorChrome, setEditorChrome] = useState(() =>
    parseEditorChrome(
      typeof localStorage === "undefined" ? null : localStorage.getItem(EDITOR_CHROME_KEY)
    )
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [newName, setNewName] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [alwaysOnTop, setAlwaysOnTop] = useState(
    () =>
      typeof localStorage !== "undefined" &&
      localStorage.getItem("notebook.alwaysOnTop") === "1"
  );
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("application");
  const [showGallery, setShowGallery] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showNoteMenu, setShowNoteMenu] = useState(false);
  const [showListSortMenu, setShowListSortMenu] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextTarget | null>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null);
  const [newNotebookStackId, setNewNotebookStackId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [account, setAccount] = useState<Account | null>(null);
  const [storage, setStorage] = useState({ database: "", attachments: "" });
  const shortcutsStore = useNoteStore(noteStore, "shortcuts");
  const shortcutNotes = shortcutsStore.data;
  const shortcutIds = useMemo(
    () => new Set(shortcutNotes.map((n) => n.id)),
    [shortcutNotes]
  );
  const {
    flyout: sidebarFlyout,
    pinned: sidebarFlyoutPinned,
    filter: sidebarFilter,
    filterOpen: sidebarFilterOpen,
  } = useSidebarFlyout(sidebarFlyoutStore);
  const [showInfo, setShowInfo] = useState(false);
  const editorHandleRef = useRef<EditorHandle | null>(null);
  const { runEditorCommand, openFind, openReplace } = useMemo(
    () => editorCommands(editorHandleRef),
    []
  );
  const [paneLayout, setPaneLayout] = useState(() => {
    const layout = parsePaneLayout(
      typeof localStorage === "undefined" ? null : localStorage.getItem(PANE_LAYOUT_KEY)
    );
    const session = parseLastSession(
      typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_SESSION_KEY)
    );
    return session?.noteId ? layout : revealNoteBrowser(layout);
  });
  const countsStore = useNoteStore(noteStore, "counts");
  const counts = countsStore.data;
  const filesStore = useNoteStore(noteStore, "files");
  const files = filesStore.data;
  const filesLoaded = filesStore.loaded;
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const importFolderRef = useRef<HTMLInputElement>(null);
  const sidebarFilterRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const noteListRef = useRef<HTMLDivElement>(null);
  const dragSelectRef = useRef<{
    anchorId: string | null;
    dragging: boolean;
  }>({ anchorId: null, dragging: false });
  const skipNoteClickRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);
  const lastListCountRef = useRef("");
  const lastNotebooksCountRef = useRef<number | null>(null);
  const lastTagsCountRef = useRef<number | null>(null);
  const lastShortcutsCountRef = useRef<number | null>(null);

  const openSettings = (section: SettingsSection = "application") => {
    setSettingsSection(section);
    setShowSettings(true);
  };

  const defaultNotebook = useMemo(() => {
    if (prefs.default_notebook_id) {
      const match = notebooks.find((n) => n.id === prefs.default_notebook_id);
      if (match) return match;
    }
    return notebooks.find((n) => n.is_default) || notebooks[0];
  }, [notebooks, prefs.default_notebook_id]);

  // One-line wrappers over the note store so the ~40 existing call sites
  // keep working unchanged. See noteStore.ts for the actual fetch/cache
  // logic and the afterX() verbs that replace "did I remember to call
  // refreshMeta()?" for specific mutations.
  const refreshMeta = useCallback(() => noteStore.invalidate("meta"), []);
  const refreshNotes = useCallback(() => noteStore.invalidate("notes"), []);

  const importEnexFiles = async (
    files: File[],
    options?: { source?: "files" | "folder" }
  ) => {
    try {
      setImportStatus("Importing…");
      let totalImported = 0;
      let totalSkipped = 0;
      let totalDuplicates = 0;
      let lastNotebookId: string | undefined;
      let lastNotebookName: string | undefined;
      let notebookCount = 0;
      const importErrors: { title?: string; message: string }[] = [];
      for (const file of files) {
        const result = await api.importEnex(file, {
          notebookName: file.name.replace(/\.enex$/i, ""),
        });
        totalImported += result.imported;
        totalSkipped += result.skipped;
        totalDuplicates += result.duplicates ?? 0;
        lastNotebookId = result.notebook_id;
        lastNotebookName = result.notebook_name;
        notebookCount = Math.max(notebookCount, result.notebook_count ?? 1);
        importErrors.push(...(result.errors ?? []));
      }
      const singleNotebookTarget =
        files.length === 1 && notebookCount <= 1 && lastNotebookId && lastNotebookName
          ? { id: lastNotebookId, name: lastNotebookName }
          : null;
      const firstError = importErrors[0];
      const errorHint = firstError
        ? ` — ${firstError.title ? `${firstError.title}: ` : ""}${firstError.message}` +
          (importErrors.length > 1 ? ` (+${importErrors.length - 1} more)` : "")
        : "";
      const summary =
        options?.source === "folder"
          ? `Imported ${totalImported} note${totalImported === 1 ? "" : "s"} from ${
              files.length
            } file${files.length === 1 ? "" : "s"}`
          : `Imported ${totalImported} note${totalImported === 1 ? "" : "s"}${
              singleNotebookTarget ? ` into “${singleNotebookTarget.name}”` : ""
            }`;
      setImportStatus(
        summary +
          (totalSkipped ? ` (${totalSkipped} skipped)` : "") +
          (totalDuplicates ? ` (${totalDuplicates} already imported)` : "") +
          errorHint
      );
      await refreshMeta();
      await refreshNotes();
      if (singleNotebookTarget) {
        noteSession.setFilter({
          type: "notebook",
          id: singleNotebookTarget.id,
          name: singleNotebookTarget.name,
        });
      } else {
        noteSession.setFilter({ type: "all" });
      }
    } catch (err) {
      setImportStatus(err instanceof Error ? err.message : "Import failed");
    }
  };

  // Keep the store's notes fetcher pointed at the current view. A no-op when
  // nothing actually changed, so calling it every render is cheap.
  noteStore.setContext({ filter, sortBy: prefs.sort_by, searchScope });

  const persistPaneLayout = (next: typeof paneLayout) => {
    setPaneLayout(next);
    localStorage.setItem(PANE_LAYOUT_KEY, JSON.stringify(next));
  };

  const persistEditorChrome = (next: typeof editorChrome) => {
    setEditorChrome(next);
    localStorage.setItem(EDITOR_CHROME_KEY, JSON.stringify(next));
  };

  const toggleSpellCheck = () => {
    const spell_check = !prefs.spell_check;
    setPrefs((current) => ({ ...current, spell_check }));
    api.updateSettings({ spell_check }).catch(console.error);
  };

  const windowMinimize = () => {
    void window.notebookDesktop?.windowControl?.("minimize");
  };

  const windowMaximize = () => {
    void window.notebookDesktop?.windowControl?.("maximize");
  };

  const persistAlwaysOnTop = (next: boolean) => {
    setAlwaysOnTop(next);
    localStorage.setItem("notebook.alwaysOnTop", next ? "1" : "0");
    void window.notebookDesktop?.windowControl?.(
      next ? "setAlwaysOnTop" : "clearAlwaysOnTop"
    );
  };

  const toggleAlwaysOnTop = () => persistAlwaysOnTop(!alwaysOnTop);

  useEffect(() => {
    if (!window.notebookDesktop?.windowControl) return;
    void window.notebookDesktop.windowControl(
      localStorage.getItem("notebook.alwaysOnTop") === "1"
        ? "setAlwaysOnTop"
        : "clearAlwaysOnTop"
    );
  }, []);

  const persistRecentSearches = (history: string[]) => {
    setRecentSearches(history);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(history));
  };

  const persistSavedSearches = (list: typeof savedSearches) => {
    setSavedSearches(list);
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(list));
  };

  const persistCompletedReminders = (ids: string[]) => {
    setCompletedReminders(ids);
    localStorage.setItem(COMPLETED_REMINDERS_KEY, JSON.stringify(ids));
  };

  const persistCollapsedStacks = (ids: string[]) => {
    setCollapsedStacks(ids);
    localStorage.setItem(COLLAPSED_STACKS_KEY, JSON.stringify(ids));
  };

  const runSearch = (query: string) => {
    const cleaned = query.trim();
    if (!cleaned) return;
    persistRecentSearches(rememberSearch(recentSearches, cleaned));
    setSearchInput(cleaned);
    noteSession.setFilter({ type: "search", query: cleaned });
    setSearchOpen(false);
  };

  const saveCurrentSearch = (query: string) => {
    persistSavedSearches(upsertSavedSearch(savedSearches, query));
  };

  const closeSearch = () => {
    setSearchOpen(false);
  };

  const revealNoteList = () => {
    if (paneLayout.listCollapsed) {
      persistPaneLayout({ ...paneLayout, listCollapsed: false });
    }
  };

  const searchInNotebook = (notebook: { id: string; name: string }) => {
    setSearchScope(notebook);
    setSearchOpen(true);
    revealNoteList();
  };

  const openGlobalSearch = () => {
    setSearchOpen(true);
    if (filter.type === "notebook") {
      setSearchScope({ id: filter.id, name: filter.name });
    } else if (filter.type !== "search") {
      setSearchScope(null);
    }
    if (filter.type === "search") {
      setSearchInput(filter.query);
    }
    revealNoteList();
  };

  const showAllNotes = () => {
    closeSidebarFlyout();
    setSearchScope(null);
    noteSession.setFilter({ type: "all" });
    revealNoteList();
  };

  const showListFilter = (next: ViewFilter) => {
    closeSidebarFlyout();
    noteSession.setFilter(next);
    revealNoteList();
  };

  /* The flyout state machine itself lives in `sidebarFlyout.ts`, where it is
   * unit-tested against a fake clock. These wrappers exist only to pair a
   * transition with the DOM work the store deliberately does not own. */

  /** A hidden sidebar has nowhere to hang the panel, so bring it back first. */
  const revealSidebarFlyout = (kind: SidebarFlyoutKind) => {
    if (paneLayout.sidebarCollapsed) {
      persistPaneLayout({ ...paneLayout, sidebarCollapsed: false });
    }
    sidebarFlyoutStore.reveal(kind);
  };

  const cancelSidebarFlyoutClose = () => sidebarFlyoutStore.cancelClose();

  const closeSidebarFlyout = () => sidebarFlyoutStore.close();

  /** Hover previews a section; a click pins it until navigation, Escape, or another click. */
  const previewSidebarFlyout = (kind: SidebarFlyoutKind) =>
    sidebarFlyoutStore.preview(kind);

  const scheduleSidebarFlyoutClose = () => sidebarFlyoutStore.scheduleClose();

  /** Opening a different section starts it unfiltered, so the panel matches its label. */
  const openSidebarFlyout = (kind: SidebarFlyoutKind) => sidebarFlyoutStore.open(kind);

  const focusSidebarFilter = () => {
    window.setTimeout(() => sidebarFilterRef.current?.focus(), 0);
  };

  const openSidebarFilter = (kind: "notebooks" | "tags" = "notebooks") => {
    if (paneLayout.sidebarCollapsed) {
      persistPaneLayout({ ...paneLayout, sidebarCollapsed: false });
    }
    sidebarFlyoutStore.openFilter(kind);
    focusSidebarFilter();
  };

  useEffect(() => () => sidebarFlyoutStore.dispose(), []);

  const loadNote = useCallback(async (id: string, tabId?: string) => {
    await noteSession.loadNoteInto(id, tabId);
    const note = noteSession.get().activeNote;
    if (!note) return;
    setRecentNotes((current) => {
      const next = rememberRecentNote(current, { id: note.id, title: note.title || "Untitled" });
      localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const goBack = () => {
    const location = noteSession.goBack();
    if (location?.filter.type === "search") setSearchInput(location.filter.query ?? "");
  };

  const goForward = () => {
    const location = noteSession.goForward();
    if (location?.filter.type === "search") setSearchInput(location.filter.query ?? "");
  };


  // noteSession owns the tab verbs (candidate 1). main added a closed-tab
  // stack on top, so closeTab is wrapped rather than reimplemented.
  const closeTab = useCallback((tabId: string) => {
    const closing = noteSession.get().tabs.find((tab) => tab.id === tabId);
    if (closing?.noteId) setClosedTabs((stack) => rememberClosedTab(stack, closing));
    noteSession.closeTab(tabId);
  }, []);
  const openInNewTab = useCallback(
    async (noteId: string) => {
      const summary = notes.find((note) => note.id === noteId);
      await noteSession.openInNewTab(noteId, summary?.title || activeNote?.title);
    },
    [notes, activeNote]
  );

  const handleNoteClick = useCallback(
    (noteId: string, event: MouseEvent) => {
      if (skipNoteClickRef.current) {
        skipNoteClickRef.current = false;
        event.preventDefault();
        return;
      }
      noteSession.clickNote(
        noteId,
        { shift: event.shiftKey, meta: event.metaKey || event.ctrlKey },
        notes
      );
    },
    [notes]
  );

  const endNoteDragSelect = useCallback(() => {
    if (dragSelectRef.current.dragging) skipNoteClickRef.current = true;
    dragSelectRef.current = { anchorId: null, dragging: false };
    noteListRef.current?.classList.remove("is-drag-selecting");
  }, []);

  const handleNotePointerDown = useCallback(
    (noteId: string, event: ReactPointerEvent) => {
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey) return;
      dragSelectRef.current = { anchorId: noteId, dragging: false };
    },
    []
  );

  const handleNotePointerEnter = useCallback(
    (noteId: string, event: ReactPointerEvent) => {
      const drag = dragSelectRef.current;
      if (!drag.anchorId || (event.buttons & 1) === 0) return;
      if (noteId === drag.anchorId && !drag.dragging) return;
      drag.dragging = true;
      noteListRef.current?.classList.add("is-drag-selecting");
      noteSession.dragSelectTo(drag.anchorId, noteId, notes);
    },
    [notes]
  );

  useEffect(() => {
    const onUp = () => endNoteDragSelect();
    const onMove = (event: PointerEvent) => {
      const drag = dragSelectRef.current;
      const list = noteListRef.current;
      if (!drag.anchorId || (event.buttons & 1) === 0 || !list) return;
      const rect = list.getBoundingClientRect();
      if (event.clientY < rect.top + 36) list.scrollTop -= 18;
      else if (event.clientY > rect.bottom - 36) list.scrollTop += 18;
    };
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove);
    return () => {
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove);
    };
  }, [endNoteDragSelect]);

  useEffect(() => {
    if (!showJump && !searchOpen) return;
    let cancelled = false;
    const live = api.listNotes({ templates: false });
    const trash = showJump
      ? api.listNotes({ trash: true, templates: false })
      : Promise.resolve([] as NoteSummary[]);
    Promise.all([live, trash])
      .then(([list, trashed]) => {
        if (cancelled) return;
        setJumpNotes(list);
        if (showJump) setJumpTrashNotes(trashed);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [notes, showJump, searchOpen]);

  useEffect(() => {
    (async () => {
      for (let i = 0; i < 30; i++) {
        try {
          const health = await api.health();
          setVersion(health.version);
          const [loadedPrefs, loadedAccount, loadedStorage, loadedCatalog] = await Promise.all([
            api.getSettings(),
            api.getAccount(),
            api.storageInfo(),
            api.templateCatalog(),
          ]);
          const mergedPrefs = normalizePreferences(loadedPrefs);
          setPrefs(mergedPrefs);
          setAccount(loadedAccount);
          setStorage(loadedStorage);
          setCatalog(loadedCatalog);
          if (loadedPrefs.startup_view === "shortcuts") {
            noteSession.setFilter({ type: "shortcuts" });
          } else {
            const lastSession = parseLastSession(
              typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_SESSION_KEY)
            );
            if (lastSession) {
              const location = noteSession.applyNavLocation(lastSession);
              if (location.filter.type === "search") setSearchInput(location.filter.query ?? "");
            }
          }
          await refreshMeta();
          sessionReadyRef.current = true;
          setReady(true);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      setError("Could not connect to Notebook API on http://127.0.0.1:8799");
    })();
  }, [refreshMeta]);

  // The single driver for reloading the notes list: any change to the view
  // the store's notes fetcher reads from (filter, sort, search scope) lands
  // in setContext during render, and this refetches once afterwards.
  useEffect(() => {
    if (ready) refreshNotes().catch(console.error);
  }, [ready, filter, prefs.sort_by, searchScope, refreshNotes]);

  /**
   * The Files view spans every notebook, so it loads its own list on entry.
   * The store's per-key generation guard replaces the hand-rolled
   * `cancelled` flag this effect used to need.
   */
  useEffect(() => {
    if (!ready || filter.type !== "files") return;
    void noteStore.invalidate("files");
  }, [ready, filter, counts.files]);

  useEffect(() => {
    noteSession.pruneSelection(notes.map((n) => n.id));
  }, [notes]);

  useEffect(() => {
    if (!ready) return;
    noteSession.dropMissingTabs(notes.map((note) => note.id));
  }, [notes, ready]);

  useEffect(() => {
    noteSession.syncActiveTabTitle();
  }, [activeNote?.id, activeNote?.title]);

  // The note-open invariant used to be written longhand at every call site
  // that could change the active note (loadNote, tab switch, close tab, nav);
  // now that they all funnel through noteSession, this one effect covers all
  // of them.
  useEffect(() => {
    setShowNoteMenu(false);
  }, [activeNote?.id]);

  useEffect(() => {
    if (!activeNote) setShowInfo(false);
  }, [activeNote]);

const saveNote = useCallback(
    async (patch: Partial<Note>) => {
      if (!activeNote) return;
      setSaveState("saving");
      try {
        const updated = await api.updateNote(activeNote.id, {
          title: patch.title,
          content: patch.content,
          notebook_id: patch.notebook_id,
          is_pinned: patch.is_pinned,
          is_archived: patch.is_archived,
          is_template: patch.is_template,
          template_category: patch.template_category,
          tag_ids: patch.tag_ids,
          reminder_at: patch.reminder_at,
          source_url: patch.source_url,
        });
        noteSession.setActiveNote(updated);
        setSaveState("saved");
        await refreshNotes();
        if (updated.is_template) await refreshMeta();
      } catch {
        setSaveState("error");
      }
    },
    [activeNote, refreshNotes, refreshMeta]
  );

  const updateNoteById = async (id: string, patch: Partial<Note>) => {
    const updated = await api.updateNote(id, {
      title: patch.title,
      content: patch.content,
      notebook_id: patch.notebook_id,
      is_pinned: patch.is_pinned,
      is_archived: patch.is_archived,
      is_template: patch.is_template,
      template_category: patch.template_category,
      tag_ids: patch.tag_ids,
      reminder_at: patch.reminder_at,
      source_url: patch.source_url,
    });
    if (activeNote?.id === id) noteSession.setActiveNote(updated);
    await refreshNotes();
    return updated;
  };

  useEffect(() => {
    if (!activeNote) return;
    if (noteSession.consumeSkipNextSave()) return;
    const timer = setTimeout(() => {
      saveNote({
        title: activeNote.title,
        content: activeNote.content,
      });
    }, prefs.auto_save_ms || 600);
    return () => clearTimeout(timer);
  }, [activeNote?.title, activeNote?.content, prefs.auto_save_ms]);

  const selectedNotes = useMemo(
    () => notes.filter((note) => selectedNoteIds.has(note.id)),
    [notes, selectedNoteIds]
  );

  const {
    confirm,
    targetNoteIds,
    applyToNotes,
    createBlankNote,
    createNote,
    useTemplate,
    deleteSelectedNotes,
    restoreSelectedNotes,
    moveSelectedNotes,
    pinSelectedNotes,
    archiveSelectedNotes,
    shortcutSelectedNotes,
    duplicateSelectedNotes,
    copySelectedNotes,
    mergeSelectedNotes,
    exportSelectedNotes,
  } = createNoteActions({
    api,
    notes,
    selectedNoteIds,
    activeNote,
    filter,
    prefs,
    defaultNotebookId: defaultNotebook?.id,
    lastClickedNoteId: noteSession.lastClickedNoteIdRef,
    setActiveNote: noteSession.setActiveNote,
    setSelectedNoteIds: noteSession.setSelectedNoteIds,
    setPendingConfirm,
    setNotebookPicker,
    setShowGallery,
    setShowNewMenu,
    // Note-changing actions (delete, restore, pin, archive, shortcut,
    // create, duplicate, ...) always need notes + counts + shortcuts +
    // templates refreshed together; afterNoteChange() is the single verb
    // for that, so noteActions.ts's callers can't forget the counts half.
    refreshNotes: () => noteStore.afterNoteChange(),
    refreshMeta,
    loadNote,
    focusTitle: () => {
      // The editor mounts in the same commit that loadNote resolves, so wait a
      // frame for the input to exist before reaching for it.
      requestAnimationFrame(() => titleRef.current?.focus());
    },
  });

  const deleteSelectedNotesWithUndo = async () => {
    const ids = await deleteSelectedNotes();
    if (!ids?.length) return;
    const first = notes.find((note) => note.id === ids[0]);
    setTrashToast({ ids, message: trashToastCopy(ids.length, first?.title || "Untitled") });
    window.setTimeout(() => {
      setTrashToast((current) => (current && current.ids[0] === ids[0] ? null : current));
    }, 6000);
  };

  const setReminderPreset = async (kind: ReminderPreset | "clear") => {
    if (!activeNote) return;
    setShowReminderMenu(false);
    await saveNote({
      reminder_at: kind === "clear" ? null : reminderFromPreset(kind),
    });
  };

  const snoozeReminder = async (kind: SnoozePreset) => {
    const at = reminderFromSnooze(kind);
    setShowReminderMenu(false);
    const ids = targetNoteIds();
    if (ids.length && !(activeNote && ids.length === 1 && ids[0] === activeNote.id)) {
      await applyToNotes(ids, async (id) => {
        const updated = await api.updateNote(id, { reminder_at: at });
        if (activeNote?.id === id) noteSession.setActiveNote(updated);
      });
      return;
    }
    if (!activeNote) return;
    await saveNote({ reminder_at: at });
  };

  const copyActiveNoteAs = async (format: "rich" | "plain" | "markdown") => {
    const id = activeNote?.id || [...selectedNoteIds][0];
    if (!id) return;
    const note = activeNote?.id === id ? activeNote : await api.getNote(id);
    const html = note.content || "";
    const plain = note.content_plain || htmlToPlainText(html);
    if (format === "markdown") {
      await copyTextToClipboard(htmlToMarkdown(html));
      return;
    }
    if (format === "plain") {
      await copyTextToClipboard(plain);
      return;
    }
    await copyTextToClipboard(plain, html);
  };

  const exportNotebook = async (notebookId: string, name: string) => {
    const list = await api.listNotes({ notebookId, templates: false });
    if (!list.length) return;
    const full: Note[] = [];
    for (const item of list) {
      full.push(await api.getNote(item.id));
    }
    downloadTextFile(
      `${safeFilename(name)}.enex`,
      notesToEnex(
        full.map((note) => ({
          title: note.title,
          content: note.content,
          created_at: note.created_at,
          updated_at: note.updated_at,
          tag_names: note.tag_names,
        }))
      ),
      "application/xml"
    );
  };

  const setListView = (list_view: ListView) => {
    const show_snippets = list_view !== "titles";
    setPrefs((current) => ({ ...current, list_view, show_snippets }));
    void api.updateSettings({ list_view, show_snippets });
  };

  const printActiveNote = () => window.print();

  const emailActiveNote = async (id?: string) => {
    const targetId = id || activeNote?.id;
    if (!targetId) return;
    const note =
      activeNote?.id === targetId
        ? activeNote
        : await api.getNote(targetId).catch(() => null);
    if (!note) return;
    window.location.href = noteMailtoHref(
      note.title,
      note.content_plain || htmlToPlainText(note.content)
    );
  };

  const toggleReminderDone = (id?: string) => {
    const target = id || activeNote?.id;
    if (!target) return;
    persistCompletedReminders(toggleCompletedReminder(completedReminders, target));
    setShowReminderMenu(false);
  };

  const scheduleHoverPreview = (note: NoteSummary, event: MouseEvent<HTMLElement>) => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    const rect = event.currentTarget.getBoundingClientRect();
    hoverTimerRef.current = window.setTimeout(() => {
      const top = Math.min(rect.top, Math.max(12, window.innerHeight - 200));
      setHoverPreview({ note, x: rect.right + 12, y: Math.max(12, top) });
    }, 450);
  };

  const hideHoverPreview = () => {
    if (hoverTimerRef.current) window.clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    setHoverPreview(null);
  };

  const copyActiveNoteLink = async () => {
    if (!activeNote) return;
    await navigator.clipboard.writeText(noteAppLink(activeNote.id));
  };

  const openAppUrl = async (url: string): Promise<boolean> => {
    try {
      if (window.notebookDesktop?.openExternal) {
        await window.notebookDesktop.openExternal(url);
        return true;
      }
    } catch {
      /* fall through to clipboard */
    }
    await copyTextToClipboard(url);
    return false;
  };

  const sendToOmniClone = async (mode: "note" | "checklists" = "note") => {
    if (prefs.omniclone_enabled === false) {
      openSettings("integrations");
      return;
    }
    const ids = targetNoteIds();
    if (!ids.length) return;
    const urls: string[] = [];
    for (const id of ids) {
      const note =
        activeNote?.id === id
          ? activeNote
          : await api.getNote(id).catch(() => null);
      if (!note) continue;
      const schemePref = (prefs.omniclone_scheme || "omniclone") as OmniCloneSchemePref;
      if (mode === "checklists") {
        urls.push(
          ...sendUrlsForChecklists({
            title: note.title,
            noteId: note.id,
            html: note.content,
            schemePref,
          })
        );
      } else {
        urls.push(
          ...sendUrlsForNote({
            title: note.title,
            noteId: note.id,
            snippet: note.content_plain || htmlToPlainText(note.content),
            reminderAt: note.reminder_at,
            schemePref,
            sendDue: prefs.omniclone_send_due !== false,
          })
        );
      }
    }
    if (!urls.length) return;
    let opened = 0;
    for (const url of urls) {
      const ok = await openAppUrl(url);
      if (ok) opened += 1;
      else break;
    }
    setImportStatus(
      opened === 0
        ? "Copied OmniClone add link. Open OmniClone, or paste it into OmniFocus."
        : mode === "checklists"
          ? "Sent checkboxes to OmniClone."
          : ids.length > 1
            ? `Sent ${ids.length} notes to OmniClone.`
            : "Sent note to OmniClone."
    );
    window.setTimeout(() => setImportStatus(null), 4500);
  };

  const dropNoteIds = (event: DragEvent) => {
    event.preventDefault();
    setDropTarget(null);
    return decodeNoteDrag(event.dataTransfer.getData(NOTE_DRAG_TYPE));
  };

  const moveDroppedNotes = async (notebookId: string, event: DragEvent) => {
    const ids = dropNoteIds(event);
    if (!ids.length) return;
    await applyToNotes(ids, async (id) => {
      const updated = await api.updateNote(id, { notebook_id: notebookId });
      if (activeNote?.id === id) noteSession.setActiveNote(updated);
    });
  };

  const tagDroppedNotes = async (tagId: string, event: DragEvent) => {
    const ids = dropNoteIds(event);
    if (!ids.length) return;
    await applyToNotes(ids, async (id) => {
      const summary = notes.find((note) => note.id === id);
      const current = summary?.tag_ids || (activeNote?.id === id ? activeNote.tag_ids : []);
      if (current.includes(tagId)) return;
      const updated = await api.updateNote(id, { tag_ids: [...current, tagId] });
      if (activeNote?.id === id) noteSession.setActiveNote(updated);
    });
  };

  const allowNoteDrop = (event: DragEvent, key: string) => {
    if (![...event.dataTransfer.types].includes(NOTE_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTarget(key);
  };

  const notebooksByStack = useMemo(() => {
    const grouped: Record<string, Notebook[]> = { uncategorized: [] };
    stacks.forEach((s) => (grouped[s.id] = []));
    notebooks.forEach((nb) => {
      if (nb.stack_id && grouped[nb.stack_id]) {
        grouped[nb.stack_id].push(nb);
      } else {
        grouped.uncategorized.push(nb);
      }
    });
    return grouped;
  }, [notebooks, stacks]);

  const visibleNotes = useMemo(
    () =>
      notes.filter((note) => {
        if (!noteMatchesFacets(note, listFacets)) return false;
        if (!noteMatchesDateRange(note.updated_at, listDateRange)) return false;
        if (
          filter.type === "reminders" &&
          prefs.show_completed_reminders === false &&
          isReminderDone(completedReminders, note.id)
        ) {
          return false;
        }
        if (filter.type === "reminders" && calendarDay && !reminderFallsOnDay(note.reminder_at, calendarDay)) {
          return false;
        }
        return true;
      }),
    [
      notes,
      listFacets,
      listDateRange,
      filter.type,
      prefs.show_completed_reminders,
      completedReminders,
      calendarDay,
    ]
  );

  const groupedNotes = useMemo(() => {
    if (filter.type === "reminders") {
      return groupRemindersForList(visibleNotes, completedReminders);
    }
    if (filter.type === "search") {
      return groupNotesByNotebook(visibleNotes);
    }
    return groupNotesForList(visibleNotes, filter.type === "notebook");
  }, [visibleNotes, filter.type, completedReminders]);

  const visibleTags = useMemo(
    () => tags.filter((tag) => matchesSidebarFilter(tag.name, sidebarFilter)),
    [tags, sidebarFilter]
  );

  useEffect(() => {
    if (!ready || !sessionReadyRef.current) return;
    localStorage.setItem(
      LAST_SESSION_KEY,
      JSON.stringify({
        filter,
        noteId: activeNote?.id ?? null,
      })
    );
  }, [ready, filter, activeNote?.id]);

  // The listener is registered once; the handler body is swapped through a ref
  // each render so it always sees the latest closures. (The previous version had
  // no dependency array and re-added its listener on every render.) The ref hooks
  // must stay above the boot-screen early returns; only the assignment below can
  // live next to menuCtx.
  const onKeyRef = useRef<(e: KeyboardEvent) => void>(() => {});

  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyRef.current(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    document.title = windowTitleForNote(activeNote ? activeNote.title : null);
  }, [activeNote]);

  useEffect(() => {
    if (!ready) return;
    noteSession.recordLocation();
  }, [ready, filter, activeNote?.id]);

  useEffect(() => {
    if (!ready) return;
    const openLinkedNote = (raw: string) => {
      const parsed = parseNotebookUrl(raw);
      if (parsed?.kind === "note") void loadNote(parsed.id);
    };
    openLinkedNote(window.location.href);
    openLinkedNote(window.location.hash);
    const unsub = window.notebookDesktop?.onOpenUrl?.(openLinkedNote);
    return () => unsub?.();
  }, [ready, loadNote]);

  if (error) {
    return (
      <div className="boot-screen">
        <h1>Notebook</h1>
        <p className="error">{error}</p>
        {!window.notebookDesktop?.isElectron && (
          <p>
            Start the API with: <code>cargo run -p notebook-api</code>
          </p>
        )}
      </div>
    );
  }

  if (!ready || !account) {
    return (
      <div className="boot-screen">
        <LogoMark />
        <p>Starting Notebook…</p>
      </div>
    );
  }

  const viewTitle = viewTitleForFilter(filter);
  const listLoaded = notesLoaded;
  const knownCount = knownViewNoteCount(
    filter,
    notebooks,
    tags,
    counts,
    shortcutNotes.length
  );
  const listCount = displayedListCount({
    loaded: listLoaded,
    visible: visibleNotes.length,
    total: notes.length,
    known: knownCount,
    lastLabel: lastListCountRef.current,
  });
  if (listLoaded && !(notes.length === 0 && (knownCount ?? 0) > 0)) {
    lastListCountRef.current = listCount;
  }
  if (notebooks.length > 0) lastNotebooksCountRef.current = notebooks.length;
  if (tags.length > 0) lastTagsCountRef.current = tags.length;
  if (shortcutNotes.length > 0) lastShortcutsCountRef.current = shortcutNotes.length;

  const isShortcut = activeNote ? shortcutIds.has(activeNote.id) : false;
  const allSelectedPinned =
    selectedNotes.length > 0 && selectedNotes.every((note) => note.is_pinned);
  const allSelectedArchived =
    selectedNotes.length > 0 && selectedNotes.every((note) => note.is_archived);
  const allSelectedShortcuts =
    selectedNotes.length > 0 &&
    selectedNotes.every((note) => shortcutIds.has(note.id));
  const searchQuery = filter.type === "search" ? filter.query : "";
  const listView = resolveListView(prefs);

  const openNewStack = () => {
    setNewName("");
    setShowNewStack(true);
  };

  const openRename = (target: RenameTarget) => {
    setRenameTarget(target);
    setNewName(target.name);
  };


  // Ported from main. runPaletteAction stayed behind: commands.ts owns
  // dispatch, so these are the handlers its context calls.
  const copyNoteTitle = (title?: string) => {
    void copyTextToClipboard((title || "").trim() || "Untitled");
  };

  const addTagToSelected = async (tagId: string) => {
    for (const id of targetNoteIds()) {
      const note = notes.find((item) => item.id === id);
      const current = note?.tag_ids || (activeNote?.id === id ? activeNote.tag_ids : []);
      if (current.includes(tagId)) continue;
      await api.updateNote(id, { tag_ids: [...current, tagId] });
    }
    await refreshNotes();
    if (activeNote) await loadNote(activeNote.id);
  };

  const reopenClosedTab = () => {
    const popped = popClosedTab(closedTabs);
    if (!popped) return;
    setClosedTabs(popped.remaining);
    const tab = { ...popped.item, id: popped.item.id || makeNoteTab().id };
    noteSession.setTabs((current) => [...current, tab]);
    noteSession.setActiveTabId(tab.id);
    noteSession.setFilter(tab.filter);
    if (tab.noteId) {
      void loadNote(tab.noteId, tab.id);
      return;
    }
    noteSession.markSkipNextSave();
    noteSession.setActiveNote(null);
  };

  const persistCollapsedListGroups = (ids: string[]) => {
    setCollapsedListGroups(ids);
    localStorage.setItem("notebook.collapsedListGroups", JSON.stringify(ids));
  };

  const menuCtx: AppMenuContext = {
    filter,
    selectedNoteIds,
    selectedNotes,
    shortcutIds,
    stacks,
    notes,
    activeNote,
    activeTabId,
    paneLayout,
    editorChrome,
    prefs,
    showInfo,
    focusMode,
    isShortcut,
    allSelectedPinned,
    allSelectedArchived,
    allSelectedShortcuts,
    targetNoteIds,
    createNote,
    createBlankNote,
    openNewStack,
    openRename,
    openSettings,
    openNewTab: noteSession.openNewTab,
    openInNewTab,
    closeTab: noteSession.closeTab,
    loadNote,
    setNewNotebookStackId,
    setNewName,
    setShowNewNotebook,
    setShowNewTag,
    setShowGallery,
    setNotebookPicker,
    setShowInfo,
    setShowJump,
    runEditorCommand,
    openFind,
    openReplace,
    setFocusMode,
    setFilter: noteSession.setFilter,
    setSelectedNoteIds: noteSession.setSelectedNoteIds,
    setShowReminderMenu,
    setPrefs,
    setActiveNote: noteSession.setActiveNote,
    persistPaneLayout,
    persistEditorChrome,
    alwaysOnTop,
    toggleAlwaysOnTop,
    windowMinimize,
    windowMaximize,
    toggleSpellCheck,
    revealSidebarFlyout,
    closeSidebarFlyout,
    revealNoteList,
    restoreSelectedNotes,
    deleteSelectedNotes: () => void deleteSelectedNotesWithUndo(),
    shortcutSelectedNotes,
    pinSelectedNotes,
    duplicateSelectedNotes,
    mergeSelectedNotes,
    exportSelectedNotes,
    archiveSelectedNotes,
    updateNoteById,
    refreshMeta,
    refreshNotes,
    confirm,
    printActiveNote,
    copyActiveNoteLink,
    sendToOmniClone,
    copyActiveNoteAs,
    copyNoteTitle,
    exportNotebook,
    snoozeReminder,
    searchInNotebook,
    setListView,
    importNotes: () => importRef.current?.click(),
    importNotesFolder: () => importFolderRef.current?.click(),
    setNotebookDefault: async (notebook) => {
      await api.updateNotebook(notebook.id, { is_default: true });
      const next = await api.updateSettings({
        default_notebook_id: notebook.id,
      });
      setPrefs(normalizePreferences(next));
      await refreshMeta();
    },
    setNotebookStack: async (notebookId, stackId) => {
      await api.updateNotebook(notebookId, { stack_id: stackId });
      await refreshMeta();
    },
    deleteNotebook: async (notebook) => {
      if (
        !(await confirm(
          `Delete “${notebook.name}”? Notes in this notebook will move to Trash.`,
          { confirmLabel: "Delete", danger: true }
        ))
      ) {
        return;
      }
      await api.deleteNotebook(notebook.id);
      if (filter.type === "notebook" && filter.id === notebook.id) {
        noteSession.setFilter({ type: "all" });
      }
      noteSession.setActiveNote(null);
      await refreshMeta();
      await refreshNotes();
    },
    deleteStack: async (stack) => {
      if (
        !(await confirm(
          `Delete “${stack.name}”? Its notebooks and notes will be kept.`,
          { confirmLabel: "Delete", danger: true }
        ))
      ) {
        return;
      }
      await api.deleteStack(stack.id);
      await refreshMeta();
    },
    deleteTag: async (tag) => {
      if (
        !(await confirm(`Delete the tag “${tag.name}”?`, {
          confirmLabel: "Delete",
          danger: true,
        }))
      ) {
        return;
      }
      await api.deleteTag(tag.id);
      if (filter.type === "tag" && filter.id === tag.id) {
        noteSession.setFilter({ type: "all" });
      }
      await refreshMeta();
      await refreshNotes();
    },
    restoreTemplates: () => void api.restoreTemplates().then(refreshMeta),
    collapsedStacks,
    toggleStackCollapsed: (id: string) =>
      persistCollapsedStacks(toggleCollapsedId(collapsedStacks, id)),
    collapseAllStacks: () => persistCollapsedStacks(collapseAllIds(stacks.map((stack) => stack.id))),
    expandAllStacks: () => persistCollapsedStacks([]),
    canGoBack: navPast.length > 0,
    canGoForward: navFuture.length > 0,
    goBack,
    goForward,
    emailActiveNote: (id) => void emailActiveNote(id),
    toggleReminderDone,
    openCommandPalette: () => setShowPalette(true),
    isReminderCompleted: (id) => isReminderDone(completedReminders, id),
    openGlobalSearch,
    focusTagInput: () => {
      setShowTagMenu(true);
      requestAnimationFrame(() => tagInputRef.current?.focus());
    },
    tags,
    addTagToSelected: (tagId) => void addTagToSelected(tagId),
    openJump: (mode = "all") => {
      setJumpMode(mode);
      setShowJump(true);
    },
    reopenClosedTab,
    canReopenClosedTab: closedTabs.length > 0,
    recentNotes,
    closeAllTabs: () => {
      const ids = closeAllUnpinnedTabIds(noteSession.get().tabs);
      if (!ids.length) return;
      ids.forEach((id) => closeTab(id));
    },
    pinActiveTab: () => {
      noteSession.setTabs((current) => {
        const next = pinTabById(current, noteSession.get().activeTabId);
                return next;
      });
    },
    isActiveTabPinned: Boolean(tabs.find((tab) => tab.id === activeTabId)?.pinned),
    openSelectedInTabs: () => {
      targetNoteIds().forEach((id) => void openInNewTab(id));
    },
    toggleNoteLocked: () => {
      if (!activeNote) return;
      const next = toggleCollapsedId(lockedNoteIds, activeNote.id);
      setLockedNoteIds(next);
      localStorage.setItem(LOCKED_NOTES_KEY, JSON.stringify(next));
    },
    isNoteLocked: Boolean(activeNote && lockedNoteIds.includes(activeNote.id)),
    setNoteColor: (color: string) => {
      if (!activeNote) return;
      const next = applyNoteColor(noteColors, activeNote.id, color);
      setNoteColors(next);
      localStorage.setItem(NOTE_COLORS_KEY, JSON.stringify(next));
    },
    noteColor: activeNote ? noteColors[activeNote.id] || "" : "",
    openShortcutsOverlay: () => setShowShortcuts(true),
    collapseAllListGroups: () =>
      persistCollapsedListGroups(collapseAllIds(groupedNotes.map((group) => group.key))),
    expandAllListGroups: () => persistCollapsedListGroups([]),
    canCollapseListGroups: groupedNotes.some((group) => group.label),
  };

  onKeyRef.current = (e: KeyboardEvent) => {
    const command = matchCommand(e, menuCtx);
    if (command) {
      e.preventDefault();
      command.run(menuCtx);
      return;
    }
    const meta = e.metaKey || e.ctrlKey;
    if (e.key === "Escape" && focusMode) {
      e.preventDefault();
      setFocusMode(false);
    } else if (e.key === "Escape" && sidebarFlyout) {
      e.preventDefault();
      closeSidebarFlyout();
    } else if (e.key === "Escape" && showPalette) {
      e.preventDefault();
      setShowPalette(false);
    } else if (e.key === "Escape" && searchOpen) {
      e.preventDefault();
      closeSearch();
    } else if (e.key === "Escape" && hoverPreview) {
      e.preventDefault();
      hideHoverPreview();
    } else if (
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      !isTextInputFocused() &&
      visibleNotes.length > 0
    ) {
      e.preventDefault();
      const current =
        noteSession.lastClickedNoteIdRef.current ||
        (selectedNoteIds.size === 1 ? [...selectedNoteIds][0] : null);
      const nextId = adjacentNoteId(
        visibleNotes,
        current,
        e.key === "ArrowDown" ? 1 : -1
      );
      if (nextId) {
        noteSession.lastClickedNoteIdRef.current = nextId;
        if (e.shiftKey && current) {
          noteSession.setSelectedNoteIds(new Set(noteIdsInRange(notes, current, nextId)));
        } else {
          void loadNote(nextId);
        }
      }
    } else if (
      (e.key === "j" || e.key === "k" || e.key === "J" || e.key === "K") &&
      !meta &&
      !e.altKey &&
      !isTextInputFocused() &&
      visibleNotes.length > 0
    ) {
      e.preventDefault();
      const current =
        noteSession.lastClickedNoteIdRef.current ||
        (selectedNoteIds.size === 1 ? [...selectedNoteIds][0] : null);
      const nextId = adjacentNoteId(visibleNotes, current, e.key === "j" || e.key === "J" ? 1 : -1);
      if (nextId) {
        noteSession.lastClickedNoteIdRef.current = nextId;
        void loadNote(nextId);
      }
    } else if (meta && e.key === "Tab") {
      e.preventDefault();
      const ids = noteSession.get().tabs.map((tab) => tab.id);
      const index = ids.indexOf(noteSession.get().activeTabId);
      if (index < 0 || ids.length < 2) return;
      const nextIndex = e.shiftKey
        ? (index - 1 + ids.length) % ids.length
        : (index + 1) % ids.length;
      void noteSession.switchToTab(ids[nextIndex]);
    } else if (meta && e.key === "a" && !isTextInputFocused()) {
      e.preventDefault();
      noteSession.selectAll(notes.map((n) => n.id));
    } else if (e.key === "Escape" && selectedNoteIds.size > 1) {
      noteSession.selectActiveOnly();
    } else if (
      (e.key === "Delete" || e.key === "Backspace") &&
      !isTextInputFocused() &&
      !meta &&
      targetNoteIds().length > 0
    ) {
      e.preventDefault();
      void deleteSelectedNotes();
    }
  };

  const contextMenuItems = (target: ContextTarget) => buildContextMenu(target, menuCtx);
  const menuGroups = buildMenuBar(menuCtx);

  const renderSidebarSection = (section: SidebarSectionId) => {
    if (section === "notes") {
      return (
        <button
          key="notes"
          className={filter.type === "all" ? "nav-item active" : "nav-item"}
          title={navIconTitle("Notes", counts?.notes)}
          onClick={() => showAllNotes()}
        >
          <Icon.Notes size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Notes</span>
          <span className="nav-count">{navCountLabel(counts?.notes)}</span>
        </button>
      );
    }
    if (section === "shortcuts") {
      return prefs.show_shortcuts ? (
        <button
          key="shortcuts"
          className={
            filter.type === "shortcuts" || sidebarFlyout === "shortcuts"
              ? "nav-item active"
              : "nav-item"
          }
          aria-label={navIconTitle("Shortcuts", shortcutNotes.length)}
          aria-haspopup="dialog"
          aria-expanded={sidebarFlyout === "shortcuts"}
          onMouseEnter={() => previewSidebarFlyout("shortcuts")}
          onMouseLeave={scheduleSidebarFlyoutClose}
          onFocus={() => previewSidebarFlyout("shortcuts")}
          onBlur={scheduleSidebarFlyoutClose}
          onClick={() => {
            openSidebarFlyout("shortcuts");
            noteSession.setFilter({ type: "shortcuts" });
            revealNoteList();
          }}
        >
          <Icon.Shortcuts size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Shortcuts</span>
          <span className="nav-count">
            {navCountLabel(stickyNavCount(shortcutNotes.length, lastShortcutsCountRef.current))}
          </span>
        </button>
      ) : null;
    }
    if (section === "reminders") {
      return prefs.show_reminders ? (
        <button
          key="reminders"
          className={filter.type === "reminders" ? "nav-item active" : "nav-item"}
          title={navIconTitle("Reminders", counts?.reminders)}
          onClick={() => showListFilter({ type: "reminders" })}
        >
          <Icon.Reminder size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Reminders</span>
          <span className="nav-count">{navCountLabel(counts?.reminders)}</span>
        </button>
      ) : null;
    }
    if (section === "notebooks") {
      return prefs.show_notebooks ? (
        <button
          key="notebooks"
          className={
            filter.type === "notebook" || sidebarFlyout === "notebooks"
              ? "nav-item active"
              : "nav-item"
          }
          aria-label={navIconTitle("Notebooks", notebooks.length)}
          aria-haspopup="dialog"
          aria-expanded={sidebarFlyout === "notebooks"}
          onMouseEnter={() => previewSidebarFlyout("notebooks")}
          onMouseLeave={scheduleSidebarFlyoutClose}
          onFocus={() => previewSidebarFlyout("notebooks")}
          onBlur={scheduleSidebarFlyoutClose}
          onClick={() => openSidebarFlyout("notebooks")}
        >
          <Icon.Notebooks size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Notebooks</span>
          <span className="nav-count">
            {navCountLabel(stickyNavCount(notebooks.length, lastNotebooksCountRef.current))}
          </span>
        </button>
      ) : null;
    }
    if (section === "tags") {
      return prefs.show_tags ? (
        <button
          key="tags"
          className={
            filter.type === "tag" || sidebarFlyout === "tags"
              ? "nav-item active"
              : "nav-item"
          }
          aria-label={navIconTitle("Tags", tags.length)}
          aria-haspopup="dialog"
          aria-expanded={sidebarFlyout === "tags"}
          onMouseEnter={() => previewSidebarFlyout("tags")}
          onMouseLeave={scheduleSidebarFlyoutClose}
          onFocus={() => previewSidebarFlyout("tags")}
          onBlur={scheduleSidebarFlyoutClose}
          onClick={() => openSidebarFlyout("tags")}
        >
          <Icon.Tags size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Tags</span>
          <span className="nav-count">
            {navCountLabel(stickyNavCount(tags.length, lastTagsCountRef.current))}
          </span>
        </button>
      ) : null;
    }
    if (section === "templates") {
      return prefs.show_templates ? (
        <button
          key="templates"
          className={filter.type === "templates" ? "nav-item active" : "nav-item"}
          title={navIconTitle("Templates", counts?.templates)}
          onClick={() => showListFilter({ type: "templates" })}
        >
          <Icon.Templates size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Templates</span>
          <span className="nav-count">{navCountLabel(counts?.templates)}</span>
        </button>
      ) : null;
    }
    if (section === "files") {
      return prefs.show_files ? (
        <button
          key="files"
          className={filter.type === "files" ? "nav-item active" : "nav-item"}
          title={navIconTitle("Files", counts?.files)}
          onClick={() => showListFilter({ type: "files" })}
        >
          <Icon.Files size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Files</span>
          <span className="nav-count">{navCountLabel(counts?.files)}</span>
        </button>
      ) : null;
    }
    if (section === "archived") {
      return (
        <button
          key="archived"
          className={filter.type === "archived" ? "nav-item active" : "nav-item"}
          title="Archived"
          onClick={() => showListFilter({ type: "archived" })}
        >
          <Icon.Archive size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Archived</span>
        </button>
      );
    }
    if (section === "saved") {
      return savedSearches.length > 0 ? (
        <div key="saved" className="saved-search-nav" aria-label="Saved searches">
          {savedSearches.slice(0, 8).map((search) => (
            <button
              key={search.id}
              className={
                filter.type === "search" && filter.query === search.query
                  ? "nav-item active"
                  : "nav-item"
              }
              title={search.name}
              onClick={() => {
                closeSidebarFlyout();
                setSearchInput(search.query);
                noteSession.setFilter({ type: "search", query: search.query });
                setSearchOpen(true);
                revealNoteList();
              }}
            >
              <Icon.Search size={SIDEBAR_NAV_ICON_SIZE} />
              <span className="nav-label">{search.name}</span>
            </button>
          ))}
        </div>
      ) : null;
    }
    if (section === "trash") {
      return prefs.show_trash ? (
        <button
          key="trash"
          className={filter.type === "trash" ? "nav-item active" : "nav-item"}
          title={navIconTitle("Trash", counts?.trash)}
          onClick={() => showListFilter({ type: "trash" })}
        >
          <Icon.Trash size={SIDEBAR_NAV_ICON_SIZE} />
          <span className="nav-label">Trash</span>
          <span className="nav-count">{navCountLabel(counts?.trash)}</span>
        </button>
      ) : null;
    }
    return null;
  };
  const { top: topSidebarSections, bottom: bottomSidebarSections } =
    partitionSidebarSections(sidebarSections);

  return (
    <div
      className={
        "app-shell sidebar-rail" +
        (paneLayout.sidebarCollapsed ? " sidebar-collapsed" : "") +
        (paneLayout.listCollapsed ? " list-collapsed" : "") +
        (filter.type === "files" ? " files-mode" : "") +
        (focusMode ? " focus-mode" : "") +
        (showInfo && activeNote ? " info-open" : "")
      }
      style={
        {
          "--sidebar-width": paneLayout.sidebarCollapsed
            ? "0px"
            : `${SIDEBAR_RAIL_WIDTH}px`,
          "--sidebar-rail-width": `${SIDEBAR_RAIL_WIDTH}px`,
          "--list-width": `${paneLayout.listWidth}px`,
        } as CSSProperties
      }
      onMouseDown={(event) => {
        setShowNewMenu(false);
        setShowNoteMenu(false);
        setShowReminderMenu(false);
        setShowNoteColorMenu(false);
        setShowTagMenu(false);
        setShowNotebookCrumbMenu(false);
        setShowListSortMenu(false);
        hideHoverPreview();
        setContextMenu(null);
        if (!(event.target as HTMLElement).closest(".sidebar")) {
          closeSidebarFlyout();
        }
      }}
    >
      <MenuBar groups={menuGroups} />
      <NoteTabBar
        tabs={tabs.map((tab) => ({
          id: tab.id,
          title: tab.title,
          pinned: tab.pinned,
          dirty: tab.id === activeTabId && saveState !== "saved",
        }))}
        activeTabId={activeTabId}
        canGoBack={navPast.length > 0}
        canGoForward={navFuture.length > 0}
        canReopenClosedTab={closedTabs.length > 0}
        onBack={goBack}
        onForward={goForward}
        onSelect={(id) => void noteSession.switchToTab(id)}
        onClose={closeTab}
        onCloseOthers={(id) => {
          closeOtherTabIds(noteSession.get().tabs.map((tab) => tab.id), id).forEach(closeTab);
        }}
        onCloseToTheRight={(id) => {
          closeTabsToTheRight(noteSession.get().tabs.map((tab) => tab.id), id).forEach(closeTab);
        }}
        onCloseAll={() => closeAllUnpinnedTabIds(noteSession.get().tabs).forEach(closeTab)}
        onPin={(id) => noteSession.setTabs((current) => pinTabById(current, id))}
        onReopenClosed={reopenClosedTab}
        onNewTab={noteSession.openNewTab}
        onReorder={(fromId, toId) => noteSession.reorderTabs(fromId, toId)}
      />
      <aside
        className="sidebar"
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({
            kind: "sidebar",
            x: event.clientX,
            y: event.clientY,
          });
        }}
      >
        <div className="sidebar-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          <button
            type="button"
            className={searchOpen || filter.type === "search" ? "icon-btn active" : "icon-btn"}
            title="Search"
            onClick={() => openGlobalSearch()}
          >
            <Icon.Search size={SIDEBAR_NAV_ICON_SIZE} />
          </button>
          <button
            type="button"
            className="sidebar-new-note"
            title="New note"
            onClick={() => void createNote()}
          >
            <Icon.Plus size={SIDEBAR_NAV_ICON_SIZE} />
          </button>
          <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
            <button
              type="button"
              className={showNewMenu ? "icon-btn active" : "icon-btn"}
              title="More actions"
              onClick={() => setShowNewMenu((v) => !v)}
            >
              <Icon.More size={SIDEBAR_NAV_ICON_SIZE} />
            </button>
            {showNewMenu && (
              <div className="menu-popover sidebar-more-menu" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    void createBlankNote();
                  }}
                >
                  Blank note
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowGallery(true);
                  }}
                >
                  From template
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    setNewNotebookStackId(null);
                    setShowNewNotebook(true);
                  }}
                >
                  New notebook
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    openNewStack();
                  }}
                >
                  New stack
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowNewTag(true);
                  }}
                >
                  New tag
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    openSidebarFilter("notebooks");
                  }}
                >
                  Filter notebooks
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    openSidebarFilter("tags");
                  }}
                >
                  Filter tags
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setShowNewMenu(false);
                    closeSidebarFlyout();
                    persistPaneLayout(toggleSidebarHidden(paneLayout));
                  }}
                >
                  {paneLayout.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
                </button>
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav scroll-pane">
          <div className="sidebar-nav-group">
            {topSidebarSections.map(renderSidebarSection)}
          </div>
          <div className="sidebar-nav-group sidebar-nav-bottom">
            {bottomSidebarSections.map(renderSidebarSection)}
          </div>
        </nav>
        {sidebarFlyout && (
          <div
            className={`sidebar-flyout ${sidebarFlyoutPinned ? "is-pinned" : "is-preview"}`}
            role="dialog"
            aria-label={`${sidebarFlyoutTitle(sidebarFlyout)} navigation`}
            onMouseEnter={cancelSidebarFlyoutClose}
            onMouseLeave={scheduleSidebarFlyoutClose}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="sidebar-flyout-header">
              <h3>{sidebarFlyoutTitle(sidebarFlyout)}</h3>
              {sidebarFlyout !== "shortcuts" && (
                <div className="sidebar-flyout-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title={sidebarFilterLabel(sidebarFlyout)}
                    onClick={() => {
                      if (sidebarFlyoutStore.toggleFilter()) focusSidebarFilter();
                    }}
                  >
                    <Icon.Search size={14} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title={sidebarFlyout === "tags" ? "New tag" : "New notebook"}
                    onClick={() => {
                      if (sidebarFlyout === "tags") {
                        setShowNewTag(true);
                        return;
                      }
                      setNewNotebookStackId(null);
                      setShowNewNotebook(true);
                    }}
                  >
                    <Icon.Plus size={14} />
                  </button>
                </div>
              )}
              <button
                type="button"
                className="icon-btn"
                title="Close"
                onClick={closeSidebarFlyout}
              >
                <Icon.Close size={14} />
              </button>
            </div>
            {sidebarFlyout !== "shortcuts" &&
              (sidebarFilterOpen || Boolean(sidebarFilter.trim())) && (
                <div className="sidebar-search sidebar-filter">
                  {sidebarFlyout === "tags" ? (
                    <Icon.Tags size={15} />
                  ) : (
                    <Icon.Notebooks size={15} />
                  )}
                  <input
                    ref={sidebarFilterRef}
                    value={sidebarFilter}
                    onChange={(e) => sidebarFlyoutStore.setFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") sidebarFlyoutStore.closeFilter();
                    }}
                    placeholder={sidebarFilterLabel(sidebarFlyout)}
                    aria-label={sidebarFilterLabel(sidebarFlyout)}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title="Close filter"
                    onClick={() => sidebarFlyoutStore.closeFilter()}
                  >
                    <Icon.Close size={14} />
                  </button>
                </div>
              )}
            <div className="sidebar-flyout-body scroll-pane">
              {sidebarFlyout === "shortcuts" &&
                (shortcutNotes.length === 0 ? (
                  <div className="empty-state compact">
                    Star a note to add it to Shortcuts.
                  </div>
                ) : (
                  shortcutNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className={
                        activeNote?.id === note.id
                          ? "flyout-item active"
                          : "flyout-item"
                      }
                      onClick={() => {
                        closeSidebarFlyout();
                        noteSession.setFilter({ type: "shortcuts" });
                        void loadNote(note.id);
                      }}
                    >
                      <span className="flyout-item-title">
                        {note.title || "Untitled"}
                      </span>
                      <span className="flyout-item-meta">
                        {note.notebook_name}
                      </span>
                    </button>
                  ))
                ))}
              {sidebarFlyout === "notebooks" && (
                <>
                  {stacks.map((stack) => {
                    const stacked = notebooksMatchingFilter(
                      notebooksByStack[stack.id] || [],
                      stack.name,
                      sidebarFilter
                    );
                    if (!stacked.length) return null;
                    return (
                      <div key={stack.id} className={collapsedStacks.includes(stack.id) ? "stack-group collapsed" : "stack-group"}>
                        <button
                          className="stack-name"
                          aria-expanded={!collapsedStacks.includes(stack.id)}
                          onClick={() =>
                            persistCollapsedStacks(toggleCollapsedId(collapsedStacks, stack.id))
                          }
                          onContextMenu={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setContextMenu({
                              kind: "stack",
                              x: event.clientX,
                              y: event.clientY,
                              stack,
                            });
                          }}
                        >
                          <Icon.Chevron size={16} />
                          {stack.name}
                        </button>
                        {!collapsedStacks.includes(stack.id) && stacked.map((nb) => (
                          <NotebookNavItem
                            key={nb.id}
                            notebook={nb}
                            active={filter.type === "notebook" && filter.id === nb.id}
                            isDropTarget={dropTarget === `notebook:${nb.id}`}
                            onSelect={() => {
                              closeSidebarFlyout();
                              noteSession.setFilter({
                                type: "notebook",
                                id: nb.id,
                                name: nb.name,
                              });
                              revealNoteList();
                            }}
                            onDragOver={(event) =>
                              allowNoteDrop(event, `notebook:${nb.id}`)
                            }
                            onDragLeave={() => setDropTarget(null)}
                            onDrop={(event) => void moveDroppedNotes(nb.id, event)}
                            onContextMenu={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setContextMenu({
                                kind: "notebook",
                                x: event.clientX,
                                y: event.clientY,
                                notebook: nb,
                              });
                            }}
                          />
                        ))}
                      </div>
                    );
                  })}
                  {notebooksMatchingFilter(
                    notebooksByStack.uncategorized,
                    null,
                    sidebarFilter
                  ).map((nb) => (
                    <NotebookNavItem
                      key={nb.id}
                      notebook={nb}
                      active={filter.type === "notebook" && filter.id === nb.id}
                      isDropTarget={dropTarget === `notebook:${nb.id}`}
                      onSelect={() => {
                        closeSidebarFlyout();
                        noteSession.setFilter({ type: "notebook", id: nb.id, name: nb.name });
                        noteSession.setFilter({ type: "notebook", id: nb.id, name: nb.name });
                        revealNoteList();
                      }}
                      onDragOver={(event) =>
                        allowNoteDrop(event, `notebook:${nb.id}`)
                      }
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={(event) => void moveDroppedNotes(nb.id, event)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({
                          kind: "notebook",
                          x: event.clientX,
                          y: event.clientY,
                          notebook: nb,
                        });
                      }}
                    />
                  ))}
                  {sidebarFilter.trim() &&
                    !hasVisibleSidebarNotebooks(notebooks, stacks, sidebarFilter) && (
                      <div className="empty-state compact">No matching notebooks</div>
                    )}
                </>
              )}
              {sidebarFlyout === "tags" &&
                (visibleTags.length === 0 ? (
                  <div className="empty-state compact">
                    {sidebarFilter.trim()
                      ? "No matching tags"
                      : "Add a tag to a note and it will appear here."}
                  </div>
                ) : (
                  visibleTags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      className={
                        (filter.type === "tag" && filter.id === tag.id
                          ? "nav-item active"
                          : "nav-item") +
                        (dropTarget === `tag:${tag.id}` ? " drop-target" : "")
                      }
                      onClick={() => {
                        closeSidebarFlyout();
                        noteSession.setFilter({ type: "tag", id: tag.id, name: tag.name });
                        revealNoteList();
                      }}
                      onDragOver={(event) => allowNoteDrop(event, `tag:${tag.id}`)}
                      onDragLeave={() => setDropTarget(null)}
                      onDrop={(event) => void tagDroppedNotes(tag.id, event)}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        setContextMenu({
                          kind: "tag",
                          x: event.clientX,
                          y: event.clientY,
                          tag,
                        });
                      }}
                    >
                      <span className="nav-label">#{tag.name}</span>
                      <span className="nav-count">{navCountLabel(tag.note_count)}</span>
                    </button>
                  ))
                ))}
            </div>
          </div>
        )}
        <input
          ref={importRef}
          type="file"
          accept=".enex,application/xml,text/xml"
          multiple
          hidden
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!files.length) return;
            await importEnexFiles(files);
          }}
        />
        <input
          ref={importFolderRef}
          type="file"
          hidden
          {...({ webkitdirectory: "true", directory: "true" } as Record<string, string>)}
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (!files.length) return;
            const enexFiles = filterTopLevelEnexFiles(
              files.map((file) => ({
                file,
                name: file.name,
                webkitRelativePath: (file as File & { webkitRelativePath: string })
                  .webkitRelativePath,
              }))
            ).map((entry) => entry.file);
            if (!enexFiles.length) {
              setImportStatus("No .enex files found in that folder");
              return;
            }
            await importEnexFiles(enexFiles, { source: "folder" });
          }}
        />
      </aside>
      <div className="sidebar-divider" aria-hidden="true" />

      <section className="note-list-panel">
        <div className="panel-header">
          <div className="panel-header-title">
            <h2>{viewTitle}</h2>
            <span className="count" title="Notes in this view">
              {listCount}
            </span>
          </div>
          <div className="panel-header-tools">
            {filter.type === "notebook" && (
              <button
                type="button"
                className="ghost-btn small"
                title="Search in this notebook"
                onClick={() =>
                  searchInNotebook({ id: filter.id, name: filter.name })
                }
              >
                Search in this notebook
              </button>
            )}
            {filter.type === "templates" && (
              <button className="ghost-btn small" onClick={() => setShowGallery(true)}>
                Gallery
              </button>
            )}
            {filter.type === "trash" && notes.length > 0 && (
              <button
                className="ghost-btn small"
                onClick={async () => {
                  if (
                    !(await confirm("Permanently delete all notes in Trash?", {
                      confirmLabel: "Empty Trash",
                      danger: true,
                    }))
                  ) {
                    return;
                  }
                  await api.emptyTrash();
                  noteSession.setActiveNote(null);
                  await noteStore.afterNoteChange();
                }}
              >
                Empty
              </button>
            )}
            <div className="panel-header-icons">
              {filter.type !== "trash" && (
                <button
                  type="button"
                  className={
                    "list-tool-btn" +
                    (listFiltersOpen || hasActiveListFilters(listFacets, listDateRange)
                      ? " active"
                      : "")
                  }
                  aria-expanded={listFiltersOpen}
                  aria-label="Filter notes"
                  title="Filter notes"
                  onClick={() => setListFiltersOpen((open) => !open)}
                >
                  <Icon.Filter size={14} />
                  {listFilterCount(listFacets, listDateRange) > 0 && (
                    <span className="list-filter-count">
                      {listFilterCount(listFacets, listDateRange)}
                    </span>
                  )}
                </button>
              )}
              <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className={showListSortMenu ? "list-tool-btn active" : "list-tool-btn"}
                  aria-expanded={showListSortMenu}
                  aria-label="Sort notes"
                  title="Sort notes"
                  onClick={() => setShowListSortMenu((v) => !v)}
                >
                  <Icon.Sort size={14} />
                </button>
                {showListSortMenu && (
                  <div className="menu-popover list-sort-popover">
                    {(
                      [
                        { key: "updated", label: "Updated" },
                        { key: "created", label: "Created" },
                        { key: "title", label: "Title" },
                        { key: "reminder", label: "Reminder" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={option.key}
                        type="button"
                        className={
                          prefs.sort_by === option.key ? "menu-check-item is-active" : "menu-check-item"
                        }
                        onClick={() => {
                          const sort_by = option.key as Preferences["sort_by"];
                          setPrefs((p) => ({ ...p, sort_by }));
                          api.updateSettings({ sort_by }).catch(console.error);
                          setShowListSortMenu(false);
                        }}
                      >
                        {option.label}
                        {prefs.sort_by === option.key && <Icon.Check size={14} />}
                      </button>
                    ))}
                    <div className="menu-popover-separator" role="separator" />
                    <button
                      type="button"
                      className={prefs.sort_descending ? "menu-check-item is-active" : "menu-check-item"}
                      onClick={() => {
                        const sort_descending = !prefs.sort_descending;
                        setPrefs((p) => ({ ...p, sort_descending }));
                        api.updateSettings({ sort_descending }).catch(console.error);
                        setShowListSortMenu(false);
                      }}
                    >
                      Newest first
                      {prefs.sort_descending && <Icon.Check size={14} />}
                    </button>
                  </div>
                )}
              </div>
              <div className="view-toggle" role="group" aria-label="Note list view">
                <button
                  type="button"
                  className={listView === "titles" ? "active" : ""}
                  title="Titles"
                  onClick={() => setListView("titles")}
                >
                  <Icon.Titles size={14} />
                </button>
                <button
                  type="button"
                  className={listView === "snippets" ? "active" : ""}
                  title="Snippets"
                  onClick={() => setListView("snippets")}
                >
                  <Icon.Snippets size={14} />
                </button>
                <button
                  type="button"
                  className={listView === "cards" ? "active" : ""}
                  title="Cards"
                  onClick={() => setListView("cards")}
                >
                  <Icon.Cards size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
        {filter.type !== "trash" && listFiltersOpen && (
          <div className="list-facets" role="group" aria-label="Filter notes">
            <button
              type="button"
              className={listFacets.includes("reminder") ? "active" : ""}
              onClick={() => setListFacets(toggleListFacet(listFacets, "reminder"))}
            >
              Has reminder
            </button>
            <button
              type="button"
              className={listFacets.includes("attachment") ? "active" : ""}
              onClick={() => setListFacets(toggleListFacet(listFacets, "attachment"))}
            >
              Has attachment
            </button>
            <button
              type="button"
              className={listFacets.includes("untagged") ? "active" : ""}
              onClick={() => setListFacets(toggleListFacet(listFacets, "untagged"))}
            >
              Untagged
            </button>
            <button
              type="button"
              className={listFacets.includes("image") ? "active" : ""}
              onClick={() => setListFacets(toggleListFacet(listFacets, "image"))}
            >
              Has image
            </button>
            <button
              type="button"
              className={listFacets.includes("url") ? "active" : ""}
              onClick={() => setListFacets(toggleListFacet(listFacets, "url"))}
            >
              Has URL
            </button>
            <button
              type="button"
              className={listFacets.includes("checklist") ? "active" : ""}
              onClick={() => setListFacets(toggleListFacet(listFacets, "checklist"))}
            >
              Has checklist
            </button>
            <button
              type="button"
              className={listDateRange === "today" ? "active" : ""}
              onClick={() => setListDateRange(listDateRange === "today" ? "any" : "today")}
            >
              Today
            </button>
            <button
              type="button"
              className={listDateRange === "week" ? "active" : ""}
              onClick={() => setListDateRange(listDateRange === "week" ? "any" : "week")}
            >
              This week
            </button>
            <button
              type="button"
              className={listDateRange === "month" ? "active" : ""}
              onClick={() => setListDateRange(listDateRange === "month" ? "any" : "month")}
            >
              This month
            </button>
            {hasActiveListFilters(listFacets, listDateRange) && (
              <button
                type="button"
                onClick={() => {
                  setListFacets([]);
                  setListDateRange("any");
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {filter.type === "reminders" && (
          <>
            <ReminderCalendar
              year={calendarMonth.year}
              month={calendarMonth.month}
              weekStartsOn={prefs.week_starts_on}
              selectedDay={calendarDay}
              markedDays={notes
                .filter((note) => note.reminder_at)
                .map((note) => isoDayKey(new Date(note.reminder_at as string)))}
              onChangeMonth={(year, month) => setCalendarMonth({ year, month })}
              onSelectDay={setCalendarDay}
            />
            <div className="list-facets" role="group" aria-label="Reminder options">
              <button
                type="button"
                className={prefs.show_completed_reminders === false ? "active" : ""}
                onClick={() => {
                  const show_completed_reminders = prefs.show_completed_reminders === false;
                  setPrefs((p) => ({ ...p, show_completed_reminders }));
                  api.updateSettings({ show_completed_reminders }).catch(console.error);
                }}
              >
                Hide completed
              </button>
            </div>
          </>
        )}
        {importStatus && <div className="import-status">{importStatus}</div>}
        {selectedNoteIds.size > 1 && (
          <div className="bulk-bar">
            <span className="selection-count">{selectedNoteIds.size} selected</span>
            <div className="bulk-actions">
              {filter.type === "trash" ? (
                <>
                  <button className="ghost-btn small" onClick={() => void restoreSelectedNotes()}>
                    Restore
                  </button>
                  <button
                    className="ghost-btn small danger-text"
                    onClick={() => void deleteSelectedNotesWithUndo()}
                  >
                    Delete forever
                  </button>
                </>
              ) : (
                <>
                  <button
                    className="ghost-btn small"
                    onClick={() => setNotebookPicker("move")}
                  >
                    Move to…
                  </button>
                  <button
                    className="ghost-btn small"
                    onClick={() => void pinSelectedNotes(!allSelectedPinned)}
                  >
                    {allSelectedPinned ? "Unpin" : "Pin"}
                  </button>
                  <button
                    className="ghost-btn small"
                    onClick={() => void mergeSelectedNotes()}
                  >
                    Merge
                  </button>
                  <button
                    className="ghost-btn small danger-text"
                    onClick={() => void deleteSelectedNotesWithUndo()}
                  >
                    Move to Trash
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        <div
          className={
            "note-list scroll-pane" +
            (listView === "cards" ? " cards" : "") +
            (listView === "titles" ? " titles" : "")
          }
          ref={noteListRef}
          onScroll={hideHoverPreview}
        >
          {groupedNotes.map((group) => (
            <div className="note-list-group" key={group.key}>
              {group.label ? (
                <button
                  type="button"
                  className="list-group-label"
                  onClick={() =>
                    persistCollapsedListGroups(toggleCollapsedId(collapsedListGroups, group.key))
                  }
                >
                  <span className={collapsedListGroups.includes(group.key) ? "group-chevron is-collapsed" : "group-chevron"}>
                    ▾
                  </span>
                  {group.label}
                  <span className="count">{group.notes.length}</span>
                </button>
              ) : null}
              {collapsedListGroups.includes(group.key)
                ? null
                : group.notes.map((note) => (
            <button
              key={note.id}
              className={
                (selectedNoteIds.has(note.id) ? "note-card selected" : "note-card") +
                (prefs.list_density === "compact" || listView === "titles" ? " compact" : "") +
                (listView === "cards" ? " card-view" : "") +
                (note.reminder_at && isReminderOverdue(note.reminder_at)
                  ? " reminder-overdue"
                  : "") +
                (isReminderDone(completedReminders, note.id) ? " reminder-done" : "")
              }
              aria-pressed={selectedNoteIds.has(note.id)}
              draggable={filter.type !== "trash"}
              onMouseEnter={(event) => scheduleHoverPreview(note, event)}
              onMouseLeave={hideHoverPreview}
              onDragStart={(event) => {
                const ids =
                  selectedNoteIds.has(note.id) && selectedNoteIds.size > 1
                    ? [...selectedNoteIds]
                    : [note.id];
                event.dataTransfer.setData(NOTE_DRAG_TYPE, encodeNoteDrag(ids));
                event.dataTransfer.effectAllowed = "move";
              }}
              onClick={(event) => handleNoteClick(note.id, event)}
              onPointerDown={(event) => handleNotePointerDown(note.id, event)}
              onPointerEnter={(event) => handleNotePointerEnter(note.id, event)}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (!selectedNoteIds.has(note.id)) {
                  noteSession.setSelectedNoteIds(new Set([note.id]));
                  noteSession.lastClickedNoteIdRef.current = note.id;
                }
                setContextMenu({
                  kind: "note",
                  x: event.clientX,
                  y: event.clientY,
                  note,
                });
              }}
            >
              <div className="note-card-title">
                <span className="note-card-title-text">
                  {note.is_pinned && <Icon.Pin size={17} className="note-card-pin" />}
                  {note.is_template && <Icon.Templates size={13} />}
                  {note.title || "Untitled"}
                </span>
              </div>
              {(note.reminder_at || note.attachment_count > 0) && (
                <div className="note-card-extras">
                  {note.reminder_at && (
                    <span
                      className={
                        isReminderDone(completedReminders, note.id)
                          ? "meta-chip reminder done"
                          : isReminderOverdue(note.reminder_at)
                            ? "meta-chip reminder overdue"
                            : "meta-chip reminder"
                      }
                    >
                      <Icon.Reminder size={12} />
                      {formatReminderLabel(note.reminder_at, prefs.date_format)}
                    </span>
                  )}
                  {attachmentCountLabel(note.attachment_count) && (
                    <span className="meta-chip">
                      <Icon.Attach size={12} />
                      {attachmentCountLabel(note.attachment_count)}
                    </span>
                  )}
                </div>
              )}
              {listView === "cards" &&
                resolveThumbnailUrl(note.thumbnail_url, attachmentUrl, noteThumbnailUrl) && (
                  <div
                    className="note-card-thumb"
                    style={{
                      backgroundImage: `url("${resolveThumbnailUrl(note.thumbnail_url, attachmentUrl, noteThumbnailUrl)}")`,
                    }}
                    aria-hidden="true"
                  />
                )}
              {listView !== "titles" && listView !== "cards" && prefs.show_snippets && (
                <div className="note-card-snippet">
                  {searchQuery
                    ? snippetParts(note.snippet, searchQuery).map((part, index) =>
                        part.hit ? (
                          <mark className="snippet-hit" key={index}>
                            {part.text}
                          </mark>
                        ) : (
                          <span key={index}>{part.text}</span>
                        )
                      )
                    : note.snippet}
                </div>
              )}
              <div className="note-card-footer">
                <span
                  className="note-card-date"
                  title={formatDate(note.updated_at, prefs.date_format)}
                >
                  {formatRelativeTime(note.updated_at)}
                </span>
                {listView !== "titles" && note.tag_names.length > 0 && (
                  <div className="note-card-tags">
                    {note.tag_names.map((tag) => (
                      <span key={tag} title={tag}>{tag}</span>
                    ))}
                  </div>
                )}
              </div>
            </button>
              ))}
            </div>
          ))}
          {listLoaded && notes.length === 0 && !(knownCount && knownCount > 0) && (
            <EmptyListState
              filter={filter}
              onCreate={() => void createNote()}
              onBrowseTemplates={() => setShowGallery(true)}
            />
          )}
          {listLoaded && notes.length > 0 && visibleNotes.length === 0 && (
            <div className="empty-state compact">No notes match these filters.</div>
          )}
        </div>
        {hoverPreview && (
          <div
            className="note-hover-preview"
            style={{ left: hoverPreview.x, top: hoverPreview.y }}
            role="tooltip"
          >
            <div className="note-hover-title">{hoverPreview.note.title || "Untitled"}</div>
            <div className="note-hover-meta">
              {hoverPreview.note.notebook_name}
              {hoverPreview.note.updated_at
                ? ` · ${formatDate(hoverPreview.note.updated_at, prefs.date_format)}`
                : ""}
            </div>
            {hoverPreview.note.snippet ? (
              <div className="note-hover-snippet">{hoverPreview.note.snippet}</div>
            ) : null}
          </div>
        )}
      </section>
      <PaneSplitter
        className="list-splitter"
        label="Resize note list"
        onDrag={(delta) =>
          persistPaneLayout({
            ...paneLayout,
            listWidth: clampPaneWidth(paneLayout.listWidth + delta, LIST_MIN, LIST_MAX),
          })
        }
      />

      <main className="editor-panel">
        <div className="note-chrome">
          <div className="note-chrome-panes">
            <button
              type="button"
              className={paneLayout.sidebarCollapsed ? "icon-btn active" : "icon-btn"}
              title={paneLayout.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar"}
              onClick={() => {
                closeSidebarFlyout();
                persistPaneLayout(toggleSidebarHidden(paneLayout));
              }}
            >
              <Icon.Sidebar size={16} />
            </button>
            <button
              type="button"
              className={paneLayout.listCollapsed ? "icon-btn active" : "icon-btn"}
              title={paneLayout.listCollapsed ? "Show note list" : "Hide note list"}
              onClick={() => persistPaneLayout(toggleNoteListHidden(paneLayout))}
            >
              <Icon.HideList size={16} />
            </button>
            <button
              type="button"
              className={isNoteExpanded(paneLayout) ? "icon-btn active" : "icon-btn"}
              title={isNoteExpanded(paneLayout) ? "Restore panes" : "Expand note"}
              onClick={() => persistPaneLayout(toggleNoteExpanded(paneLayout))}
            >
              <Icon.ExpandNote size={16} />
            </button>
          </div>
          {activeNote && (
            <>
              <nav className="note-breadcrumb">
                <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="note-breadcrumb-notebook"
                    onClick={() => setShowNotebookCrumbMenu((v) => !v)}
                  >
                    {notebooks.find((nb) => nb.id === activeNote.notebook_id)?.name || "Notebook"}
                  </button>
                  {showNotebookCrumbMenu && (
                    <div className="menu-popover">
                      <button
                        type="button"
                        onClick={() => {
                          const notebook = notebooks.find((item) => item.id === activeNote.notebook_id);
                          setShowNotebookCrumbMenu(false);
                          if (!notebook) return;
                          closeSidebarFlyout();
                          noteSession.setFilter({ type: "notebook", id: notebook.id, name: notebook.name });
                        }}
                      >
                        Show notes in this notebook
                      </button>
                      <div className="menu-popover-separator" role="separator" />
                      {notebooks.map((nb) => (
                        <button
                          key={nb.id}
                          type="button"
                          className={
                            nb.id === activeNote.notebook_id ? "menu-check-item is-active" : "menu-check-item"
                          }
                          onClick={() => {
                            saveNote({ ...activeNote, notebook_id: nb.id });
                            setShowNotebookCrumbMenu(false);
                          }}
                        >
                          {nb.name}
                          {nb.id === activeNote.notebook_id && <Icon.Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <span className="note-breadcrumb-sep">›</span>
                <span className="note-breadcrumb-title">{activeNote.title || "Untitled"}</span>
              </nav>
              <div className="note-chrome-actions">
                <button
                  type="button"
                  className={isShortcut ? "icon-btn active" : "icon-btn"}
                  title={isShortcut ? "Remove from shortcuts" : "Add to shortcuts"}
                  onClick={async () => {
                    if (isShortcut) await api.removeShortcut(activeNote.id);
                    else await api.addShortcut(activeNote.id);
                    await refreshMeta();
                  }}
                >
                  <Icon.Shortcuts size={16} />
                </button>
                <button
                  type="button"
                  className={activeNote.is_pinned ? "icon-btn active" : "icon-btn"}
                  title={activeNote.is_pinned ? "Unpin" : "Pin to top"}
                  onClick={() =>
                    saveNote({ ...activeNote, is_pinned: !activeNote.is_pinned })
                  }
                >
                  <Icon.Pin size={16} />
                </button>
                <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={activeNote.tag_ids.length > 0 ? "icon-btn active" : "icon-btn"}
                    title="Tags"
                    onClick={() => setShowTagMenu((v) => !v)}
                  >
                    <Icon.Tags size={16} />
                  </button>
                  {showTagMenu && (
                    <div className="menu-popover note-tag-popover" role="group" aria-label="Tags">
                      <NoteTagBar
                        tags={tags}
                        selectedIds={activeNote.tag_ids}
                        inputRef={tagInputRef}
                        onChange={(tagIds) => void saveNote({ tag_ids: tagIds })}
                        onCreateTag={async (name) => {
                          const tag = await api.createTag(name);
                          await refreshMeta();
                          await saveNote({ tag_ids: [...activeNote.tag_ids, tag.id] });
                        }}
                      />
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={lockedNoteIds.includes(activeNote.id) ? "icon-btn active" : "icon-btn"}
                  title={lockedNoteIds.includes(activeNote.id) ? "Unlock note" : "Lock note"}
                  onClick={() => {
                    const next = toggleCollapsedId(lockedNoteIds, activeNote.id);
                    setLockedNoteIds(next);
                    localStorage.setItem(LOCKED_NOTES_KEY, JSON.stringify(next));
                  }}
                >
                  <Icon.Lock size={16} />
                </button>
                <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="note-color-trigger"
                    title="Note colour"
                    onClick={() => setShowNoteColorMenu((v) => !v)}
                  >
                    <span
                      className="note-color-trigger-swatch"
                      style={{
                        background:
                          NOTE_COLORS.find(
                            (color) => color.id === (noteColors[activeNote.id] || "")
                          )?.swatch || "transparent",
                      }}
                    />
                  </button>
                  {showNoteColorMenu && (
                    <div className="menu-popover note-color-popover" role="group" aria-label="Note color">
                      {NOTE_COLORS.map((color) => (
                        <button
                          key={color.id || "none"}
                          type="button"
                          className={
                            (noteColors[activeNote.id] || "") === color.id
                              ? "note-color-dot is-active"
                              : "note-color-dot"
                          }
                          style={{ background: color.swatch }}
                          title={color.label}
                          onClick={() => {
                            const next = applyNoteColor(noteColors, activeNote.id, color.id);
                            setNoteColors(next);
                            localStorage.setItem(NOTE_COLORS_KEY, JSON.stringify(next));
                            setShowNoteColorMenu(false);
                          }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className={activeNote.reminder_at ? "icon-btn active" : "icon-btn"}
                    onClick={() => setShowReminderMenu((open) => !open)}
                    title="Remind me"
                  >
                    <Icon.Reminder size={16} />
                  </button>
                  {showReminderMenu && (
                    <div className="menu-popover right reminder-popover">
                      {activeNote.reminder_at && (
                        <>
                          <button onClick={() => void snoozeReminder("laterToday")}>
                            Later today
                          </button>
                          <button onClick={() => void snoozeReminder("tomorrowMorning")}>
                            Tomorrow morning
                          </button>
                          <button onClick={() => toggleReminderDone(activeNote.id)}>
                            {isReminderDone(completedReminders, activeNote.id)
                              ? "Restore reminder"
                              : "Mark reminder done"}
                          </button>
                        </>
                      )}
                      <button onClick={() => void setReminderPreset("tonight")}>Tonight</button>
                      <button onClick={() => void setReminderPreset("tomorrow")}>Tomorrow</button>
                      <button onClick={() => void setReminderPreset("nextWeek")}>Next week</button>
                      <label className="reminder-custom">
                        Pick date & time
                        <input
                          type="datetime-local"
                          value={toDatetimeLocalValue(activeNote.reminder_at)}
                          onChange={(event) => {
                            saveNote({
                              reminder_at: fromDatetimeLocalValue(event.target.value),
                            });
                            setShowReminderMenu(false);
                          }}
                        />
                      </label>
                      {activeNote.reminder_at && (
                        <button onClick={() => void setReminderPreset("clear")}>
                          Clear reminder
                        </button>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className={showInfo ? "icon-btn active" : "icon-btn"}
                  onClick={() => setShowInfo((open) => !open)}
                  title="Note info"
                >
                  <Icon.Info size={16} />
                </button>
                <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setShowNoteMenu((v) => !v)}
                    title="More"
                  >
                    <Icon.More size={16} />
                  </button>
                  {showNoteMenu && (
                    <div className="menu-popover right">
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          printActiveNote();
                        }}
                      >
                        Print…
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          setShowInfo(true);
                        }}
                      >
                        Note history
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void openInNewTab(activeNote.id);
                        }}
                      >
                        Open in New Tab
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void emailActiveNote(activeNote.id);
                        }}
                      >
                        Email note…
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void sendToOmniClone("note");
                        }}
                      >
                        Send to OmniClone
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void sendToOmniClone("checklists");
                        }}
                      >
                        Send Checkboxes to OmniClone
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void copyActiveNoteLink();
                        }}
                      >
                        Copy note link
                      </button>
                      {!activeNote.is_template && (
                        <button
                          onClick={() => {
                            setShowNoteMenu(false);
                            saveNote({
                              ...activeNote,
                              is_template: true,
                              template_category: "My templates",
                            });
                            noteSession.setFilter({ type: "templates" });
                          }}
                        >
                          Save as template
                        </button>
                      )}
                      {activeNote.is_template && (
                        <button
                          onClick={() => {
                            setShowNoteMenu(false);
                            saveNote({ ...activeNote, is_template: false });
                          }}
                        >
                          Convert to note
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          saveNote({
                            ...activeNote,
                            is_archived: !activeNote.is_archived,
                          });
                        }}
                      >
                        {activeNote.is_archived ? "Unarchive" : "Archive"}
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          setNotebookPicker("move");
                        }}
                      >
                        Move to notebook…
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          setNotebookPicker("copy");
                        }}
                      >
                        Copy to notebook…
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void copyActiveNoteAs("rich");
                        }}
                      >
                        Copy as rich text
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void copyActiveNoteAs("plain");
                        }}
                      >
                        Copy as plain text
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void copyActiveNoteAs("markdown");
                        }}
                      >
                        Copy as Markdown
                      </button>
                      <button
                        onClick={() => {
                          setShowNoteMenu(false);
                          void exportSelectedNotes("markdown");
                        }}
                      >
                        Export as Markdown…
                      </button>
                      {activeNote.reminder_at && (
                        <>
                          <button
                            onClick={() => {
                              setShowNoteMenu(false);
                              void snoozeReminder("laterToday");
                            }}
                          >
                            Snooze until later today
                          </button>
                          <button
                            onClick={() => {
                              setShowNoteMenu(false);
                              void snoozeReminder("tomorrowMorning");
                            }}
                          >
                            Snooze until tomorrow morning
                          </button>
                        </>
                      )}
                      {filter.type === "trash" ? (
                        <>
                          <button
                            onClick={async () => {
                              await api.restoreNote(activeNote.id);
                              noteSession.setActiveNote(null);
                              await noteStore.afterNoteChange();
                            }}
                          >
                            Restore
                          </button>
                          <button
                            className="danger-text"
                            onClick={async () => {
                              if (
                                !(await confirm("Delete this note forever?", {
                                  confirmLabel: "Delete",
                                  danger: true,
                                }))
                              ) {
                                return;
                              }
                              await api.permanentlyDeleteNote(activeNote.id);
                              noteSession.setActiveNote(null);
                              await noteStore.afterNoteChange();
                            }}
                          >
                            Delete forever
                          </button>
                        </>
                      ) : (
                        <button
                          className="danger-text"
                          onClick={async () => {
                            if (
                              !(await confirm("Move this note to Trash?", {
                                confirmLabel: "Move to Trash",
                                danger: true,
                              }))
                            ) {
                              return;
                            }
                            await api.deleteNote(activeNote.id);
                            noteSession.setActiveNote(null);
                            await noteStore.afterNoteChange();
                          }}
                        >
                          Move to trash
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
        {activeNote ? (
          <div
            className={
              "editor-body" +
              (noteColors[activeNote.id] ? ` note-color-${noteColors[activeNote.id]}` : "")
            }
          >
          <div
            className={"editor-main" + (prefs.note_width === "readable" ? " note-width-readable" : "")}
            style={noteFontStyleVars(parseNoteFontStyles(prefs.font_styles)) as CSSProperties}
          >
            {activeNote.is_template && (
              <div className="template-banner">
                <div>
                  <Icon.Templates size={16} />
                  <strong>You’re editing a template.</strong>
                  <span>Changes save back to this template.</span>
                </div>
                <button
                  className="primary-btn"
                  onClick={() => useTemplate(activeNote.id)}
                >
                  Use this template
                </button>
              </div>
            )}
            <div className="editor-header">
              {activeNote.reminder_at && (
                <div className="editor-header-meta">
                  <span
                    className={
                      isReminderDone(completedReminders, activeNote.id)
                        ? "reminder-chip done"
                        : isReminderOverdue(activeNote.reminder_at)
                          ? "reminder-chip overdue"
                          : "reminder-chip"
                    }
                  >
                    <Icon.Reminder size={12} />
                    {isReminderDone(completedReminders, activeNote.id)
                      ? "Done"
                      : formatReminderLabel(activeNote.reminder_at, prefs.date_format)}
                  </span>
                </div>
              )}
              <input
                ref={titleRef}
                className="title-input"
                value={activeNote.title}
                onChange={(e) =>
                  noteSession.setActiveNote({ ...activeNote, title: e.target.value })
                }
                placeholder="Title"
              />
              <div
                className="note-updated"
                title={formatDate(activeNote.updated_at, prefs.date_format)}
              >
                Updated {formatRelativeTime(activeNote.updated_at)}
              </div>
            </div>
            {isBlankNote(activeNote) && !activeNote.is_template && (
              <div className="template-hint">
                <button className="chip" onClick={() => setShowGallery(true)}>
                  <Icon.Templates size={14} />
                  My templates
                </button>
                <span>or just start writing</span>
              </div>
            )}
            <NoteEditor
              key={activeNote.id}
              noteId={activeNote.id}
              content={activeNote.content}
              spellCheck={prefs.spell_check}
              spellLanguage={prefs.spell_language || "en-US"}
              fontStyles={prefs.font_styles}
              fontFamily={prefs.font_family}
              fontSize={prefs.font_size}
              noteWidth={prefs.note_width}
              lineHeight={editorChrome.lineHeight}
              readOnly={lockedNoteIds.includes(activeNote.id)}
              pdfView={prefs.pdf_view || "expanded"}
              editorRef={editorHandleRef}
              toolbarHidden={editorChrome.toolbarHidden}
              attachmentsExpanded={editorChrome.attachmentsExpanded}
              onAttachmentsExpandedChange={(expanded) =>
                persistEditorChrome({
                  ...editorChrome,
                  attachmentsExpanded: expanded,
                })
              }
              zoom={editorChrome.zoom}
              outlineOpen={editorChrome.outlineOpen}
              onOpenNoteLink={(id) => void loadNote(id)}
              onSelectionWords={setSelectionWords}
              onChange={(html) =>
                noteSession.setActiveNote({ ...activeNote, content: html })
              }
              onUseAsTitle={(title) =>
                noteSession.setActiveNote({ ...activeNote, title })
              }
              onAttach={async (file) => {
                const attachment = await api.uploadAttachment(activeNote.id, file);
                await refreshNotes();
                if (
                  isPdfFile(attachment.mime_type, attachment.filename) &&
                  (!activeNote.title || activeNote.title === "Untitled")
                ) {
                  noteSession.setActiveNote((current) =>
                    current && current.id === activeNote.id
                      ? { ...current, title: titleFromFilename(attachment.filename) }
                      : current
                  );
                }
                return attachment;
              }}
            />
            {!editorChrome.statusBarHidden && (
            <div className="editor-status">
              <span>
                {countWords(activeNote.content_plain)} word
                {countWords(activeNote.content_plain) === 1 ? "" : "s"}
              </span>
              {selectionWords > 0 && (
                <span>{selectionWords} selected</span>
              )}
              {readingTimeLabel(countWords(activeNote.content_plain)) && (
                <span>{readingTimeLabel(countWords(activeNote.content_plain))}</span>
              )}
              <span>{countCharacters(activeNote.content_plain)} characters</span>
              <span>{editorChrome.zoom}%</span>
              {activeNote.reminder_at && (
                <span
                  className={
                    isReminderDone(completedReminders, activeNote.id)
                      ? "reminder-done-text"
                      : isReminderOverdue(activeNote.reminder_at)
                        ? "reminder-overdue-text"
                        : ""
                  }
                >
                  {isReminderDone(completedReminders, activeNote.id) ? "Done · " : ""}
                  Reminder {formatReminderLabel(activeNote.reminder_at, prefs.date_format)}
                </span>
              )}
              <span className="save-state">{saveStateLabel(saveState)}</span>
            </div>
            )}
          </div>
          {showInfo && (
            <NoteInfoPanel
              note={activeNote}
              dateFormat={prefs.date_format}
              onClose={() => setShowInfo(false)}
              onPatch={(patch) => void saveNote(patch)}
              onRestored={async (restored) => {
                noteSession.markSkipNextSave();
                noteSession.setActiveNote(restored);
                await refreshNotes();
                await refreshMeta();
              }}
            />
          )}
          </div>
        ) : (
          <div className="empty-editor">
            <LogoMark large />
            <h2>{paneLayout.listCollapsed ? "Your notes are one click away" : "Select a note"}</h2>
            <p>
              {paneLayout.listCollapsed
                ? "Bring back the note list to continue browsing."
                : "Choose a note from the list or start a fresh one."}
            </p>
            <div className="empty-actions">
              {paneLayout.listCollapsed && (
                <button
                  className="primary-btn large"
                  onClick={() => persistPaneLayout(revealNoteBrowser(paneLayout))}
                >
                  Show notes
                </button>
              )}
              <button className="primary-btn large" onClick={createNote}>
                New note
              </button>
              <button className="ghost-btn large" onClick={() => setShowGallery(true)}>
                Browse templates
              </button>
            </div>
          </div>
        )}
      </main>

      {filter.type === "files" && (
        <FilesView
          files={files}
          loaded={filesLoaded}
          dateFormat={prefs.date_format}
          onOpenNote={(file) => {
            closeSidebarFlyout();
            noteSession.setFilter({ type: "notebook", id: file.notebook_id, name: file.notebook_name });
            void loadNote(file.note_id);
          }}
        />
      )}

      {showNewNotebook && (
        <PromptModal
          title="New notebook"
          value={newName}
          onChange={setNewName}
          onCancel={() => {
            setShowNewNotebook(false);
            setNewNotebookStackId(null);
            setNewName("");
          }}
          onSubmit={async () => {
            await api.createNotebook(
              newName.trim(),
              newNotebookStackId || undefined
            );
            await refreshMeta();
            setShowNewNotebook(false);
            setNewNotebookStackId(null);
            setNewName("");
          }}
        />
      )}

      {showNewStack && (
        <PromptModal
          title="New stack"
          value={newName}
          onChange={setNewName}
          onCancel={() => {
            setShowNewStack(false);
            setNewName("");
          }}
          onSubmit={async () => {
            await api.createStack(newName.trim());
            await refreshMeta();
            setShowNewStack(false);
            setNewName("");
          }}
        />
      )}

      {showNewTag && (
        <PromptModal
          title="New tag"
          value={newName}
          onChange={setNewName}
          onCancel={() => {
            setShowNewTag(false);
            setNewName("");
          }}
          onSubmit={async () => {
            await api.createTag(newName);
            await refreshMeta();
            setShowNewTag(false);
            setNewName("");
          }}
        />
      )}

      {renameTarget && (
        <PromptModal
          title={`Rename ${renameTarget.kind}`}
          submitLabel="Save"
          value={newName}
          onChange={setNewName}
          onCancel={() => {
            setRenameTarget(null);
            setNewName("");
          }}
          onSubmit={async () => {
            const name = newName.trim();
            if (renameTarget.kind === "notebook") {
              await api.updateNotebook(renameTarget.id, { name });
              noteSession.renameFilterTarget("notebook", renameTarget.id, name);
            } else if (renameTarget.kind === "stack") {
              await api.updateStack(renameTarget.id, { name });
            } else if (renameTarget.kind === "note") {
              await api.updateNote(renameTarget.id, { title: name });
              if (activeNote?.id === renameTarget.id) {
                noteSession.setActiveNote({ ...activeNote, title: name });
              }
              noteSession.setTabs((current) =>
                current.map((tab) =>
                  tab.noteId === renameTarget.id
                    ? { ...tab, title: noteTabLabel(name, true) }
                    : tab
                )
              );
            } else {
              await api.updateTag(renameTarget.id, { name });
              noteSession.renameFilterTarget("tag", renameTarget.id, name);
            }
            await refreshMeta();
            setRenameTarget(null);
            setNewName("");
          }}
        />
      )}

      {showGallery && (
        <TemplateGallery
          templates={templates}
          catalog={catalog}
          notebooks={notebooks}
          defaultNotebookId={
            filter.type === "notebook" ? filter.id : defaultNotebook?.id || ""
          }
          onClose={() => setShowGallery(false)}
          onUse={useTemplate}
          onCreateBlank={() => {
            setShowGallery(false);
            createBlankNote();
          }}
        />
      )}

      {showSettings && (
        <SettingsModal
          key={settingsSection}
          prefs={prefs}
          account={account}
          notebooks={notebooks}
          version={version}
          storage={storage}
          initialSection={settingsSection}
          onClose={() => setShowSettings(false)}
          onSavePrefs={async (patch) => {
            const next = await api.updateSettings(patch);
            setPrefs(normalizePreferences(next));
            if (patch.default_notebook_id) {
              await api.updateNotebook(patch.default_notebook_id, {
                is_default: true,
              });
              await refreshMeta();
            }
          }}
          onSaveAccount={async (patch) => {
            const next = await api.updateAccount(patch);
            setAccount(next);
          }}
          onResetPrefs={async () => {
            const next = await api.resetSettings();
            setPrefs(normalizePreferences(next));
          }}
          onRestoreTemplates={async () => {
            await api.restoreTemplates();
            await refreshMeta();
            await refreshNotes();
          }}
          onImport={() => {
            setShowSettings(false);
            importRef.current?.click();
          }}
          onImportFolder={() => {
            setShowSettings(false);
            importFolderRef.current?.click();
          }}
          onEmptyTrash={async () => {
            if (
              !(await confirm("Permanently delete all notes in Trash?", {
                confirmLabel: "Empty Trash",
                danger: true,
              }))
            ) {
              return;
            }
            await api.emptyTrash();
            noteSession.setActiveNote(null);
            await noteStore.afterNoteChange();
          }}
          sidebarSections={sidebarSections}
          onMoveSidebarSection={(sections) => {
            setSidebarSections(sections);
            localStorage.setItem(SIDEBAR_SECTIONS_KEY, JSON.stringify(sections));
          }}
        />
      )}

      {notebookPicker && (
        <NotebookPickerDialog
          title={
            notebookPicker === "move"
              ? selectedNoteIds.size > 1
                ? `Move ${selectedNoteIds.size} notes to notebook`
                : "Move note to notebook"
              : selectedNoteIds.size > 1
                ? `Copy ${selectedNoteIds.size} notes to notebook`
                : "Copy note to notebook"
          }
          notebooks={notebooks}
          currentId={
            selectedNotes.length === 1
              ? selectedNotes[0].notebook_id
              : activeNote?.notebook_id
          }
          confirmLabel={notebookPicker === "move" ? "Move" : "Copy"}
          onCancel={() => setNotebookPicker(null)}
          onPick={(notebookId) =>
            notebookPicker === "move"
              ? void moveSelectedNotes(notebookId)
              : void copySelectedNotes(notebookId)
          }
        />
      )}

      {showJump && (
        <JumpToDialog
          notes={jumpNotes.length ? jumpNotes : notes}
          notebooks={notebooks}
          tags={tags}
          templates={templates}
          trashed={jumpTrashNotes}
          mode={jumpMode}
          onClose={() => setShowJump(false)}
          onSelect={(target) => {
            setShowJump(false);
            if (target.kind === "notebook") {
              const notebook = notebooks.find((item) => item.id === target.id);
              if (notebook) noteSession.setFilter({ type: "notebook", id: notebook.id, name: notebook.name });
            } else if (target.kind === "tag") {
              const tag = tags.find((item) => item.id === target.id);
              if (tag) noteSession.setFilter({ type: "tag", id: tag.id, name: tag.name });
            } else if (target.kind === "template") {
              noteSession.setFilter({ type: "templates" });
              void loadNote(target.id);
            } else if (target.kind === "trash") {
              noteSession.setFilter({ type: "trash" });
              void loadNote(target.id);
            } else {
              void loadNote(target.id);
            }
          }}
        />
      )}

      {searchOpen && (
        <SearchDialog
          query={searchInput}
          recentSearches={recentSearches}
          savedSearches={savedSearches}
          scope={searchScope}
          notes={jumpNotes.length ? jumpNotes : notes}
          notebooks={notebooks}
          tags={tags}
          templates={templates}
          onQueryChange={setSearchInput}
          onClearRecent={() => persistRecentSearches([])}
          onClearScope={() => setSearchScope(null)}
          onSaveSearch={saveCurrentSearch}
          onDeleteSearch={(id) => persistSavedSearches(deleteSavedSearch(savedSearches, id))}
          onRenameSearch={(id, name) =>
            persistSavedSearches(renameSavedSearch(savedSearches, id, name))
          }
          onClose={closeSearch}
          onSearch={runSearch}
          onSelect={(target) => {
            setSearchOpen(false);
            if (target.kind === "notebook") {
              const notebook = notebooks.find((item) => item.id === target.id);
              if (notebook) noteSession.setFilter({ type: "notebook", id: notebook.id, name: notebook.name });
            } else if (target.kind === "tag") {
              const tag = tags.find((item) => item.id === target.id);
              if (tag) noteSession.setFilter({ type: "tag", id: tag.id, name: tag.name });
            } else if (target.kind === "template") {
              noteSession.setFilter({ type: "templates" });
              void loadNote(target.id);
            } else if (target.kind === "trash") {
              noteSession.setFilter({ type: "trash" });
              void loadNote(target.id);
            } else {
              void loadNote(target.id);
            }
          }}
        />
      )}

      <CommandPalette
        open={showPalette}
        actions={paletteActions(menuCtx)}
        onRun={(id) => runCommandById(id, menuCtx)}
        onClose={() => setShowPalette(false)}
      />

      {pendingConfirm && (
        <ConfirmDialog
          message={pendingConfirm.message}
          confirmLabel={pendingConfirm.confirmLabel}
          danger={pendingConfirm.danger}
          onCancel={() => {
            pendingConfirm.resolve(false);
            setPendingConfirm(null);
          }}
          onConfirm={() => {
            pendingConfirm.resolve(true);
            setPendingConfirm(null);
          }}
        />
      )}

      {trashToast && (
        <div className="trash-toast" role="status">
          <span>{trashToast.message}</span>
          <button
            type="button"
            className="ghost-btn small"
            onClick={async () => {
              for (const id of trashToast.ids) {
                await api.restoreNote(id);
              }
              setTrashToast(null);
              await refreshNotes();
            }}
          >
            Undo
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Dismiss"
            onClick={() => setTrashToast(null)}
          >
            <Icon.Close size={14} />
          </button>
        </div>
      )}

      {showShortcuts && (
        <ShortcutOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems(contextMenu)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
