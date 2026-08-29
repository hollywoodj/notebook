import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Account,
  api,
  attachmentUrl,
  defaultPreferences,
  Note,
  NoteSummary,
  Notebook,
  Preferences,
  TemplateCatalogItem,
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
import { noteIdsInRange } from "./noteSelection";
import {
  applyTheme,
  formatDate,
  isBlankNote,
  isTextInputFocused,
  type ContextTarget,
  type PendingConfirm,
  type RenameTarget,
} from "./appTypes";
import { createNoteActions } from "./noteActions";
import { noteStore } from "./noteStore";
import { useNoteStore } from "./useNoteStore";
import { noteSession } from "./noteSession";
import { useNoteSession } from "./useNoteSession";
import { buildContextMenu, buildMenuBar, type AppMenuContext } from "./appMenus";
import { matchCommand, paletteActions, runCommandById } from "./commands";
import { isPdfFile, titleFromFilename } from "./components/fileAttachment";
import {
  EDITOR_CHROME_KEY,
  parseEditorChrome,
  windowTitleForNote,
} from "./ui/editorChrome";
import {
  LIST_MAX,
  LIST_MIN,
  PANE_LAYOUT_KEY,
  SIDEBAR_RAIL_WIDTH,
  clampPaneWidth,
  isNoteExpanded,
  isSidebarRail,
  parsePaneLayout,
  revealNoteBrowser,
  toggleNoteExpanded,
  toggleNoteListHidden,
} from "./ui/panes";
import {
  NOTE_DRAG_TYPE,
  adjacentNoteId,
  attachmentCountLabel,
  decodeNoteDrag,
  encodeNoteDrag,
  groupNotesByNotebook,
  groupNotesForList,
  resolveListView,
  type ListView,
} from "./ui/noteList";
import {
  RECENT_SEARCHES_KEY,
  SAVED_SEARCHES_KEY,
  noteMatchesDateRange,
  noteMatchesFacets,
  parseRecentSearches,
  parseSavedSearches,
  rememberSearch,
  snippetParts,
  toggleListFacet,
  deleteSavedSearch,
  upsertSavedSearch,
  type DateRangeFacet,
  type NoteListFacet,
} from "./ui/search";
import {
  COLLAPSED_STACKS_KEY,
  collapseAllIds,
  hasVisibleSidebarNotebooks,
  matchesSidebarFilter,
  sidebarFlyoutAfterClick,
  sidebarFlyoutAfterHover,
  notebooksMatchingFilter,
  parseCollapsedStacks,
  sidebarFilterLabel,
  sidebarFlyoutTitle,
  toggleCollapsedId,
  type SidebarFlyout,
  type SidebarFlyoutKind,
} from "./ui/sidebar";
import {
  COMPLETED_REMINDERS_KEY,
  formatReminderLabel,
  fromDatetimeLocalValue,
  groupRemindersForList,
  isReminderDone,
  isReminderOverdue,
  parseCompletedReminders,
  reminderFromPreset,
  reminderFromSnooze,
  toDatetimeLocalValue,
  toggleCompletedReminder,
  type ReminderPreset,
  type SnoozePreset,
} from "./ui/reminders";
import {
  checklistProgressLabel,
  countWords,
  htmlToMarkdown,
  htmlToPlainText,
  resolveThumbnailUrl,
} from "./ui/noteContent";
import {
  copyTextToClipboard,
  downloadTextFile,
  noteAppLink,
  noteMailtoHref,
  notesToEnex,
  safeFilename,
} from "./ui/share";
import { LAST_SESSION_KEY, parseLastSession } from "./ui/navigation";

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
  const [notebookPicker, setNotebookPicker] = useState<"move" | "copy" | null>(null);
  const [showReminderMenu, setShowReminderMenu] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [sidebarFilterOpen, setSidebarFilterOpen] = useState(false);
  const [editorChrome, setEditorChrome] = useState(() =>
    parseEditorChrome(
      typeof localStorage === "undefined" ? null : localStorage.getItem(EDITOR_CHROME_KEY)
    )
  );
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [newName, setNewName] = useState("");
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("application");
  const [showGallery, setShowGallery] = useState(false);
  const [showNewMenu, setShowNewMenu] = useState(false);
  const [showNoteMenu, setShowNoteMenu] = useState(false);
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
  const [sidebarFlyout, setSidebarFlyout] = useState<SidebarFlyout>(null);
  const [sidebarFlyoutPinned, setSidebarFlyoutPinned] = useState(false);
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
  const sidebarFilterRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const noteListRef = useRef<HTMLDivElement>(null);
  const dragSelectRef = useRef<{
    anchorId: string | null;
    dragging: boolean;
  }>({ anchorId: null, dragging: false });
  const skipNoteClickRef = useRef(false);
  const sessionReadyRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);
  const sidebarFlyoutCloseTimerRef = useRef<number | null>(null);

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

  const searchInNotebook = (notebook: { id: string; name: string }) => {
    setSearchScope(notebook);
    setSearchOpen(true);
    if (paneLayout.listCollapsed) {
      persistPaneLayout({ ...paneLayout, listCollapsed: false });
    }
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
    if (paneLayout.listCollapsed) {
      persistPaneLayout({ ...paneLayout, listCollapsed: false });
    }
  };

  /** A hidden sidebar has nowhere to hang the panel, so bring it back first. */
  const revealSidebarFlyout = (kind: SidebarFlyoutKind) => {
    if (paneLayout.sidebarCollapsed) {
      persistPaneLayout({ ...paneLayout, sidebarCollapsed: false });
    }
    setSidebarFlyout(kind);
    setSidebarFlyoutPinned(true);
  };


  const cancelSidebarFlyoutClose = () => {
    if (sidebarFlyoutCloseTimerRef.current === null) return;
    window.clearTimeout(sidebarFlyoutCloseTimerRef.current);
    sidebarFlyoutCloseTimerRef.current = null;
  };

  const closeSidebarFlyout = () => {
    cancelSidebarFlyoutClose();
    setSidebarFlyout(null);
    setSidebarFlyoutPinned(false);
    setSidebarFilter("");
    setSidebarFilterOpen(false);
  };

  /** Hover previews a section; a click pins it until navigation, Escape, or another click. */
  const previewSidebarFlyout = (kind: SidebarFlyoutKind) => {
    cancelSidebarFlyoutClose();
    const next = sidebarFlyoutAfterHover(sidebarFlyout, sidebarFlyoutPinned, kind);
    if (next.flyout !== sidebarFlyout) {
      setSidebarFilter("");
      setSidebarFilterOpen(false);
    }
    setSidebarFlyout(next.flyout);
    setSidebarFlyoutPinned(next.pinned);
  };

  const scheduleSidebarFlyoutClose = () => {
    cancelSidebarFlyoutClose();
    if (sidebarFlyoutPinned) return;
    sidebarFlyoutCloseTimerRef.current = window.setTimeout(() => {
      setSidebarFlyout(null);
      setSidebarFilter("");
      setSidebarFilterOpen(false);
      sidebarFlyoutCloseTimerRef.current = null;
    }, 180);
  };
  const openSidebarFilter = (kind: "notebooks" | "tags" = "notebooks") => {
    setSidebarFilterOpen(true);
    revealSidebarFlyout(kind);
    window.setTimeout(() => sidebarFilterRef.current?.focus(), 0);
  };

  /** Opening a different section starts it unfiltered, so the panel matches its label. */
  const openSidebarFlyout = (kind: SidebarFlyoutKind) => {
    cancelSidebarFlyoutClose();
    const next = sidebarFlyoutAfterClick(sidebarFlyout, sidebarFlyoutPinned, kind);
    if (!next.flyout) {
      closeSidebarFlyout();
      return;
    }
    setSidebarFlyout(next.flyout);
    setSidebarFlyoutPinned(next.pinned);
    if (next.flyout !== sidebarFlyout) {
      setSidebarFilter("");
      setSidebarFilterOpen(false);
    }
  };

  useEffect(() => () => {
    if (sidebarFlyoutCloseTimerRef.current !== null) {
      window.clearTimeout(sidebarFlyoutCloseTimerRef.current);
    }
  }, []);

  const loadNote = useCallback(
    (id: string, tabId?: string) => noteSession.loadNoteInto(id, tabId),
    []
  );

  const goBack = () => {
    const location = noteSession.goBack();
    if (location?.filter.type === "search") setSearchInput(location.filter.query ?? "");
  };

  const goForward = () => {
    const location = noteSession.goForward();
    if (location?.filter.type === "search") setSearchInput(location.filter.query ?? "");
  };

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
    api
      .listNotes({ templates: false })
      .then((list) => {
        if (!cancelled) setJumpNotes(list);
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
          setPrefs({ ...defaultPreferences, ...loadedPrefs });
          applyTheme(loadedPrefs.theme);
          setAccount(loadedAccount);
          setStorage(loadedStorage);
          setCatalog(loadedCatalog);
          setReady(true);
          await refreshMeta();
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
          sessionReadyRef.current = true;
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

  useEffect(() => {
    applyTheme(prefs.theme);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme(prefs.theme);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [prefs.theme]);

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
      notes.filter(
        (note) =>
          noteMatchesFacets(note, listFacets) &&
          noteMatchesDateRange(note.updated_at, listDateRange)
      ),
    [notes, listFacets, listDateRange]
  );

  const groupedNotes = useMemo(() => {
    if (filter.type === "reminders") {
      return groupRemindersForList(visibleNotes, completedReminders);
    }
    if (filter.type === "search") {
      return groupNotesByNotebook(visibleNotes);
    }
    return groupNotesForList(
      visibleNotes,
      prefs.sort_by === "title"
        ? "title"
        : prefs.sort_by === "created"
          ? "created"
          : "updated"
    );
  }, [visibleNotes, prefs.sort_by, filter.type, completedReminders]);

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
        <div className="logo-mark">N</div>
        <p>Starting Notebook…</p>
      </div>
    );
  }

  const viewTitle =
    filter.type === "all"
      ? "Notes"
      : filter.type === "notebook"
        ? filter.name
        : filter.type === "tag"
          ? `#${filter.name}`
          : filter.type === "shortcuts"
            ? "Shortcuts"
            : filter.type === "reminders"
              ? "Reminders"
              : filter.type === "templates"
              ? "Templates"
              : filter.type === "files"
                ? "Files"
                : filter.type === "trash"
                ? "Trash"
                : `Search: ${filter.query}`;

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

  const toggleTheme = () => {
    const theme = prefs.theme === "dark" ? "light" : "dark";
    setPrefs((current) => ({ ...current, theme }));
    void api.updateSettings({ theme });
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
    setSidebarFlyout,
    setSelectedNoteIds: noteSession.setSelectedNoteIds,
    setShowReminderMenu,
    setPrefs,
    setActiveNote: noteSession.setActiveNote,
    persistPaneLayout,
    persistEditorChrome,
    revealSidebarFlyout,
    closeSidebarFlyout,
    restoreSelectedNotes,
    deleteSelectedNotes,
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
    copyActiveNoteAs,
    exportNotebook,
    snoozeReminder,
    searchInNotebook,
    setListView,
    importNotes: () => importRef.current?.click(),
    setNotebookDefault: async (notebook) => {
      await api.updateNotebook(notebook.id, { is_default: true });
      const next = await api.updateSettings({
        default_notebook_id: notebook.id,
      });
      setPrefs({ ...defaultPreferences, ...next });
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
    toggleTheme,
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

  const sidebarRail = isSidebarRail(paneLayout);

  return (
    <div
      className={
        "app-shell" +
        (paneLayout.sidebarCollapsed ? " sidebar-collapsed" : "") +
        (sidebarRail ? " sidebar-rail" : "") +
        (paneLayout.listCollapsed ? " list-collapsed" : "") +
        (filter.type === "files" ? " files-mode" : "") +
        (focusMode ? " focus-mode" : "") +
        (showInfo && activeNote ? " info-open" : "")
      }
      style={
        {
          "--sidebar-width": paneLayout.sidebarCollapsed
            ? "0px"
            : `${paneLayout.sidebarWidth}px`,
          "--sidebar-rail-width": `${SIDEBAR_RAIL_WIDTH}px`,
          "--list-width": `${paneLayout.listWidth}px`,
        } as CSSProperties
      }
      onMouseDown={(event) => {
        setShowNewMenu(false);
        setShowNoteMenu(false);
        setShowReminderMenu(false);
        hideHoverPreview();
        setContextMenu(null);
        if (!(event.target as HTMLElement).closest(".sidebar")) {
          closeSidebarFlyout();
        }
      }}
    >
      <MenuBar groups={menuGroups} />
      <NoteTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        canGoBack={navPast.length > 0}
        canGoForward={navFuture.length > 0}
        onBack={goBack}
        onForward={goForward}
        onSelect={(id) => void noteSession.switchToTab(id)}
        onClose={noteSession.closeTab}
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
            <Icon.Search size={18} />
          </button>
          <button
            type="button"
            className="sidebar-new-note"
            title="New note"
            onClick={() => void createNote()}
          >
            <Icon.Plus size={18} />
          </button>
          <div className="menu-anchor">
            <button
              type="button"
              className={showNewMenu ? "icon-btn active" : "icon-btn"}
              title="More actions"
              onClick={() => setShowNewMenu((v) => !v)}
            >
              <Icon.More size={18} />
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
              </div>
            )}
          </div>
        </div>

        <nav className="sidebar-nav scroll-pane">
          <button
            className={filter.type === "all" ? "nav-item active" : "nav-item"}
            title="Notes"
            onClick={() => {
              closeSidebarFlyout();
              noteSession.setFilter({ type: "all" });
            }}
          >
            <Icon.Notes size={16} />
            <span className="nav-label">Notes</span>
            <span className="nav-count">{counts.notes}</span>
          </button>
          {prefs.show_shortcuts && (
            <button
              className={
                (filter.type === "shortcuts" || sidebarFlyout === "shortcuts"
                  ? "nav-item active"
                  : "nav-item")
              }
              title="Shortcuts"
              aria-haspopup="dialog"
              aria-expanded={sidebarFlyout === "shortcuts"}
              onMouseEnter={() => previewSidebarFlyout("shortcuts")}
              onMouseLeave={scheduleSidebarFlyoutClose}
              onFocus={() => previewSidebarFlyout("shortcuts")}
              onBlur={scheduleSidebarFlyoutClose}
              onClick={() => openSidebarFlyout("shortcuts")}
            >
              <Icon.Shortcuts size={16} />
              <span className="nav-label">Shortcuts</span>
              <span className="nav-count">{shortcutNotes.length}</span>
            </button>
          )}
          {prefs.show_reminders && (
            <button
              className={filter.type === "reminders" ? "nav-item active" : "nav-item"}
              title="Reminders"
              onClick={() => {
                closeSidebarFlyout();
                noteSession.setFilter({ type: "reminders" });
              }}
            >
              <Icon.Reminder size={16} />
              <span className="nav-label">Reminders</span>
              <span className="nav-count">{counts.reminders}</span>
            </button>
          )}

          {prefs.show_notebooks && (
            <button
              className={
                (filter.type === "notebook" || sidebarFlyout === "notebooks"
                  ? "nav-item active"
                  : "nav-item")
              }
              title="Notebooks"
              aria-haspopup="dialog"
              aria-expanded={sidebarFlyout === "notebooks"}
              onMouseEnter={() => previewSidebarFlyout("notebooks")}
              onMouseLeave={scheduleSidebarFlyoutClose}
              onBlur={scheduleSidebarFlyoutClose}
              onFocus={() => previewSidebarFlyout("notebooks")}
              onClick={() => openSidebarFlyout("notebooks")}
            >
              <Icon.Notebooks size={16} />
              <span className="nav-label">Notebooks</span>
              <span className="nav-count">{notebooks.length}</span>
            </button>
          )}

          {prefs.show_tags && (
            <button
              className={
                (filter.type === "tag" || sidebarFlyout === "tags"
                  ? "nav-item active"
                  : "nav-item")
              }
              title="Tags"
              aria-haspopup="dialog"
              aria-expanded={sidebarFlyout === "tags"}
              onMouseEnter={() => previewSidebarFlyout("tags")}
              onBlur={scheduleSidebarFlyoutClose}
              onMouseLeave={scheduleSidebarFlyoutClose}
              onFocus={() => previewSidebarFlyout("tags")}
              onClick={() => openSidebarFlyout("tags")}
            >
              <Icon.Tags size={16} />
              <span className="nav-label">Tags</span>
              <span className="nav-count">{tags.length}</span>
            </button>
          )}

          {prefs.show_templates && (
            <button
              className={filter.type === "templates" ? "nav-item active" : "nav-item"}
              title="Templates"
              onClick={() => {
                closeSidebarFlyout();
                noteSession.setFilter({ type: "templates" });
              }}
            >
              <Icon.Templates size={16} />
              <span className="nav-label">Templates</span>
              <span className="nav-count">{counts.templates}</span>
            </button>
          )}

          {prefs.show_files && (
            <button
              className={filter.type === "files" ? "nav-item active" : "nav-item"}
              title="Files"
              onClick={() => {
                closeSidebarFlyout();
                noteSession.setFilter({ type: "files" });
              }}
            >
              <Icon.Files size={16} />
              <span className="nav-label">Files</span>
              <span className="nav-count">{counts.files}</span>
            </button>
          )}

          {prefs.show_trash && (
            <button
              className={filter.type === "trash" ? "nav-item active" : "nav-item"}
              title="Trash"
              onClick={() => {
                closeSidebarFlyout();
                noteSession.setFilter({ type: "trash" });
              }}
            >
              <Icon.Trash size={16} />
              <span className="nav-label">Trash</span>
              <span className="nav-count">{counts.trash}</span>
            </button>
          )}
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
                      if (sidebarFilterOpen || sidebarFilter.trim()) {
                        setSidebarFilter("");
                        setSidebarFilterOpen(false);
                      } else {
                        setSidebarFilterOpen(true);
                        window.setTimeout(() => sidebarFilterRef.current?.focus(), 0);
                      }
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
                    onChange={(e) => setSidebarFilter(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setSidebarFilter("");
                        setSidebarFilterOpen(false);
                      }
                    }}
                    placeholder={sidebarFilterLabel(sidebarFlyout)}
                    aria-label={sidebarFilterLabel(sidebarFlyout)}
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    title="Close filter"
                    onClick={() => {
                      setSidebarFilter("");
                      setSidebarFilterOpen(false);
                    }}
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
                          <Icon.Chevron size={12} />
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
                      <span className="nav-count">{tag.note_count ?? 0}</span>
                    </button>
                  ))
                ))}
            </div>
          </div>
        )}
        <div className="sidebar-footer">
          <button
            type="button"
            className="icon-btn"
            title="Settings"
            onClick={() => openSettings()}
          >
            <Icon.Gear size={16} />
          </button>
        </div>
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
            try {
              setImportStatus("Importing…");
              let totalImported = 0;
              let totalSkipped = 0;
              let lastNotebookId: string | undefined;
              let lastNotebookName: string | undefined;
              let notebookCount = 0;
              for (const file of files) {
                const result = await api.importEnex(file, {
                  notebookName: file.name.replace(/\.enex$/i, ""),
                });
                totalImported += result.imported;
                totalSkipped += result.skipped;
                lastNotebookId = result.notebook_id;
                lastNotebookName = result.notebook_name;
                notebookCount = Math.max(notebookCount, result.notebook_count ?? 1);
              }
              const target =
                files.length === 1 &&
                notebookCount <= 1 &&
                lastNotebookId &&
                lastNotebookName
                  ? ` into “${lastNotebookName}”`
                  : "";
              setImportStatus(
                `Imported ${totalImported} note${totalImported === 1 ? "" : "s"}${target}` +
                  (totalSkipped ? ` (${totalSkipped} skipped)` : "")
              );
              await refreshMeta();
              await refreshNotes();
              if (
                files.length === 1 &&
                notebookCount <= 1 &&
                lastNotebookId &&
                lastNotebookName
              ) {
                noteSession.setFilter({
                  type: "notebook",
                  id: lastNotebookId,
                  name: lastNotebookName,
                });
              } else {
                noteSession.setFilter({ type: "all" });
              }
            } catch (err) {
              setImportStatus(err instanceof Error ? err.message : "Import failed");
            }
          }}
        />
      </aside>
      <div className="sidebar-divider" aria-hidden="true" />

      <section className="note-list-panel">
        <div className="panel-header">
          <div>
            <h2>{viewTitle}</h2>
            <span className="count" title="Notes in this view">
              {notesLoaded ? (
                <>
                  {visibleNotes.length}
                  {visibleNotes.length !== notes.length ? ` of ${notes.length}` : ""}
                </>
              ) : (
                <>&nbsp;</>
              )}
            </span>
          </div>
          <div className="panel-tools">
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
            <select
              className="list-sort"
              aria-label="Sort notes by"
              value={prefs.sort_by}
              onChange={(e) => {
                const sort_by = e.target.value as Preferences["sort_by"];
                setPrefs((p) => ({ ...p, sort_by }));
                api.updateSettings({ sort_by }).catch(console.error);
              }}
            >
              <option value="updated">Updated</option>
              <option value="created">Created</option>
              <option value="title">Title</option>
            </select>
            <div className="view-toggle" role="group" aria-label="Note list view">
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
                className={listView === "titles" ? "active" : ""}
                title="Titles"
                onClick={() => setListView("titles")}
              >
                <Icon.Titles size={14} />
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
        {filter.type !== "trash" && (
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
          </div>
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
                    onClick={() => void deleteSelectedNotes()}
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
                    onClick={() => void deleteSelectedNotes()}
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
              {group.label ? <div className="list-group-label">{group.label}</div> : null}
              {group.notes.map((note) => (
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
                {note.is_pinned && <Icon.Pin size={13} />}
                {note.is_template && <Icon.Templates size={13} />}
                {note.title || "Untitled"}
              </div>
              <div className="note-card-meta">
                {formatDate(note.updated_at, prefs.date_format)}
                {note.notebook_name ? ` · ${note.notebook_name}` : ""}
              </div>
              {(note.reminder_at ||
                note.attachment_count > 0 ||
                (note.checklist_total || 0) > 0) && (
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
                  {checklistProgressLabel(note.checklist_done || 0, note.checklist_total || 0) && (
                    <span className="meta-chip">
                      <Icon.Checklist size={12} />
                      {checklistProgressLabel(note.checklist_done || 0, note.checklist_total || 0)}
                    </span>
                  )}
                </div>
              )}
              {listView === "cards" &&
                resolveThumbnailUrl(note.thumbnail_url, attachmentUrl) && (
                  <div
                    className="note-card-thumb"
                    style={{
                      backgroundImage: `url("${resolveThumbnailUrl(note.thumbnail_url, attachmentUrl)}")`,
                    }}
                    aria-hidden="true"
                  />
                )}
              {listView !== "titles" && prefs.show_snippets && (
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
              {listView !== "titles" && note.tag_names.length > 0 && (
                <div className="note-card-tags">
                  {note.tag_names.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              )}
            </button>
              ))}
            </div>
          ))}
          {notesLoaded && notes.length === 0 && (
            <EmptyListState
              filter={filter}
              onCreate={() => void createNote()}
              onBrowseTemplates={() => setShowGallery(true)}
            />
          )}
          {notesLoaded && notes.length > 0 && visibleNotes.length === 0 && (
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
        {activeNote ? (
          <div className="editor-body">
          <div className="editor-main">
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
              <div className="editor-header-row">
                <input
                  ref={titleRef}
                  className="title-input"
                  value={activeNote.title}
                  onChange={(e) =>
                    noteSession.setActiveNote({ ...activeNote, title: e.target.value })
                  }
                  placeholder="Title"
                />
                <div className="editor-actions">
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
              </div>
              <div className="editor-header-meta">
                <label className="notebook-crumb">
                  <Icon.Notebooks size={14} />
                  <select
                    value={activeNote.notebook_id}
                    aria-label="Notebook"
                    onChange={(e) =>
                      saveNote({ ...activeNote, notebook_id: e.target.value })
                    }
                  >
                    {notebooks.map((nb) => (
                      <option key={nb.id} value={nb.id}>
                        {nb.name}
                      </option>
                    ))}
                  </select>
                </label>
                {activeNote.reminder_at && (
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
                )}
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
              fontFamily={prefs.font_family}
              fontSize={prefs.font_size}
              noteWidth={prefs.note_width}
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
            <NoteTagBar
              tags={tags}
              selectedIds={activeNote.tag_ids}
              onChange={(tagIds) => void saveNote({ tag_ids: tagIds })}
              onCreateTag={async (name) => {
                const tag = await api.createTag(name);
                await refreshMeta();
                await saveNote({ tag_ids: [...activeNote.tag_ids, tag.id] });
              }}
            />
            <div className="editor-status">
              <span>
                {countWords(activeNote.content_plain)} word
                {countWords(activeNote.content_plain) === 1 ? "" : "s"}
              </span>
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
              <span className="save-state">{saveState}</span>
            </div>
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
            <div className="logo-mark large">N</div>
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
            setPrefs({ ...defaultPreferences, ...next });
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
            setPrefs({ ...defaultPreferences, ...next });
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
          onClose={() => setShowJump(false)}
          onSelect={(target) => {
            setShowJump(false);
            if (target.kind === "notebook") {
              const notebook = notebooks.find((item) => item.id === target.id);
              if (notebook) noteSession.setFilter({ type: "notebook", id: notebook.id, name: notebook.name });
            } else if (target.kind === "tag") {
              const tag = tags.find((item) => item.id === target.id);
              if (tag) noteSession.setFilter({ type: "tag", id: tag.id, name: tag.name });
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
          onQueryChange={setSearchInput}
          onClearRecent={() => persistRecentSearches([])}
          onClearScope={() => setSearchScope(null)}
          onSaveSearch={saveCurrentSearch}
          onDeleteSearch={(id) => persistSavedSearches(deleteSavedSearch(savedSearches, id))}
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
