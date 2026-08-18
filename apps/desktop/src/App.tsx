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
  SidebarCounts,
  Stack,
  Tag,
  TemplateCatalogItem,
  ViewFilter,
} from "./api";
import { NoteEditor } from "./components/NoteEditor";
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
import { NotebookPickerDialog } from "./components/NotebookPickerDialog";
import {
  noteIdsInRange,
  pruneNoteIds,
  toggleNoteId,
} from "./noteSelection";
import {
  applyTheme,
  formatDate,
  isBlankNote,
  isTextInputFocused,
  makeNoteTab,
  type ContextTarget,
  type NoteTab,
  type PendingConfirm,
  type RenameTarget,
} from "./appTypes";
import { createNoteActions } from "./noteActions";
import { buildContextMenu, buildMenuBar, type AppMenuContext } from "./appMenus";
import { isPdfFile, titleFromFilename } from "./components/fileAttachment";
import {
  EDITOR_CHROME_KEY,
  LIST_MAX,
  LIST_MIN,
  NOTE_DRAG_TYPE,
  PANE_LAYOUT_KEY,
  RECENT_SEARCHES_KEY,
  COLLAPSED_STACKS_KEY,
  SIDEBAR_RAIL_WIDTH,
  adjacentNoteId,
  attachmentCountLabel,
  avatarColor,
  checklistProgressLabel,
  clampPaneWidth,
  collapseAllIds,
  countWords,
  decodeNoteDrag,
  dispatchEditorCommand,
  encodeNoteDrag,
  formatReminderLabel,
  fromDatetimeLocalValue,
  groupNotesForList,
  isReminderOverdue,
  isNoteExpanded,
  isSidebarRail,
  hasVisibleSidebarNotebooks,
  matchesSidebarFilter,
  nextActiveTabId,
  nextSidebarFlyout,
  nextZoom,
  noteAppLink,
  noteMatchesFacets,
  noteTabLabel,
  notebooksMatchingFilter,
  parseCollapsedStacks,
  parseEditorChrome,
  parsePaneLayout,
  parseRecentSearches,
  reminderFromPreset,
  rememberSearch,
  reorderById,
  resizeSidebarTo,
  resolveListView,
  resolveThumbnailUrl,
  sidebarFilterLabel,
  sidebarFlyoutTitle,
  snippetParts,
  toDatetimeLocalValue,
  toggleCollapsedId,
  toggleListFacet,
  toggleNoteExpanded,
  toggleNoteListHidden,
  toggleSidebarRail,
  windowTitleForNote,
  type ListView,
  type NoteListFacet,
  type ReminderPreset,
  type SidebarFlyout,
  type SidebarFlyoutKind,
} from "./uiChrome";

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState("0.1.1");
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [stacks, setStacks] = useState<Stack[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [templates, setTemplates] = useState<NoteSummary[]>([]);
  const [catalog, setCatalog] = useState<TemplateCatalogItem[]>([]);
  const [selectedNoteIds, setSelectedNoteIds] = useState<Set<string>>(new Set());
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [filter, setFilter] = useState<ViewFilter>({ type: "all" });
  const [tabs, setTabs] = useState<NoteTab[]>(() => [makeNoteTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [searchInput, setSearchInput] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [recentSearches, setRecentSearches] = useState(() =>
    parseRecentSearches(
      typeof localStorage === "undefined" ? null : localStorage.getItem(RECENT_SEARCHES_KEY)
    )
  );
  const [listFacets, setListFacets] = useState<NoteListFacet[]>([]);
  const [collapsedStacks, setCollapsedStacks] = useState(() =>
    parseCollapsedStacks(
      typeof localStorage === "undefined" ? null : localStorage.getItem(COLLAPSED_STACKS_KEY)
    )
  );
  const [accountMenu, setAccountMenu] = useState(false);
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
  const [shortcutIds, setShortcutIds] = useState<Set<string>>(new Set());
  const [shortcutNotes, setShortcutNotes] = useState<NoteSummary[]>([]);
  const [sidebarFlyout, setSidebarFlyout] = useState<SidebarFlyout>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [findTick, setFindTick] = useState(0);
  const [replaceTick, setReplaceTick] = useState(0);
  const [paneLayout, setPaneLayout] = useState(() =>
    parsePaneLayout(
      typeof localStorage === "undefined" ? null : localStorage.getItem(PANE_LAYOUT_KEY)
    )
  );
  const [counts, setCounts] = useState<SidebarCounts>({
    notes: 0,
    reminders: 0,
    trash: 0,
    templates: 0,
    shortcuts: 0,
  });
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const sidebarFilterRef = useRef<HTMLInputElement>(null);
  const skipNextSave = useRef(false);
  const lastClickedNoteId = useRef<string | null>(null);
  const noteListRef = useRef<HTMLDivElement>(null);
  const dragSelectRef = useRef<{
    anchorId: string | null;
    dragging: boolean;
  }>({ anchorId: null, dragging: false });
  const skipNoteClickRef = useRef(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const activeNoteRef = useRef(activeNote);
  activeNoteRef.current = activeNote;
  const filterRef = useRef(filter);
  filterRef.current = filter;

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

  const refreshMeta = useCallback(async () => {
    const [nb, st, tg, sc, tm, sidebarCounts] = await Promise.all([
      api.listNotebooks(),
      api.listStacks(),
      api.listTags(),
      api.listShortcuts(),
      api.listNotes({ templates: true }),
      api.sidebarCounts().catch(() => ({
        notes: 0,
        reminders: 0,
        trash: 0,
        templates: 0,
        shortcuts: 0,
      })),
    ]);
    setNotebooks(nb);
    setStacks(st);
    setTags(tg);
    setShortcutIds(new Set(sc.map((n) => n.id)));
    setShortcutNotes(sc);
    setTemplates(tm);
    setCounts(sidebarCounts);
  }, []);

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

  const persistCollapsedStacks = (ids: string[]) => {
    setCollapsedStacks(ids);
    localStorage.setItem(COLLAPSED_STACKS_KEY, JSON.stringify(ids));
  };

  const runSearch = (query: string) => {
    const cleaned = query.trim();
    if (!cleaned) return;
    persistRecentSearches(rememberSearch(recentSearches, cleaned));
    setSearchInput(cleaned);
    setFilter({ type: "search", query: cleaned });
  };

  const openGlobalSearch = () => {
    setSearchOpen(true);
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
  };

  const openSidebarFilter = (kind: "notebooks" | "tags" = "notebooks") => {
    setSidebarFilterOpen(true);
    revealSidebarFlyout(kind);
    window.setTimeout(() => sidebarFilterRef.current?.focus(), 0);
  };

  /** Opening a different section starts it unfiltered, so the panel matches its label. */
  const openSidebarFlyout = (kind: SidebarFlyoutKind) => {
    const next = nextSidebarFlyout(sidebarFlyout, kind);
    setSidebarFlyout(next);
    if (next !== sidebarFlyout) {
      setSidebarFilter("");
      setSidebarFilterOpen(false);
    }
  };

  const refreshNotes = useCallback(async () => {
    let list: NoteSummary[] = [];
    switch (filter.type) {
      case "all":
        list = await api.listNotes({ templates: false });
        break;
      case "notebook":
        list = await api.listNotes({ notebookId: filter.id, templates: false });
        break;
      case "tag":
        list = await api.listNotes({ tagId: filter.id, templates: false });
        break;
      case "shortcuts":
        list = await api.listShortcuts();
        break;
      case "reminders":
        list = (await api.listNotes({ templates: false })).filter((note) => note.reminder_at);
        break;
      case "templates":
        list = await api.listNotes({ templates: true });
        break;
      case "trash":
        list = await api.listNotes({ trash: true });
        break;
      case "search":
        list = (await api.search(filter.query)).notes;
        break;
    }
    const sorted = [...list].sort((a, b) => {
      if (filter.type === "reminders") {
        return (
          new Date(a.reminder_at || 0).getTime() - new Date(b.reminder_at || 0).getTime()
        );
      }
      if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
      if (prefs.sort_by === "title") return a.title.localeCompare(b.title);
      if (prefs.sort_by === "created") {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    setNotes(sorted);
  }, [filter, prefs.sort_by]);

  const loadNote = useCallback(async (id: string, tabId?: string) => {
    skipNextSave.current = true;
    const note = await api.getNote(id);
    const targetTabId = tabId ?? activeTabIdRef.current;
    setActiveNote(note);
    setSelectedNoteIds(new Set([id]));
    lastClickedNoteId.current = id;
    setShowNoteMenu(false);
    setTabs((current) =>
      current.map((tab) =>
        tab.id === targetTabId
          ? {
              ...tab,
              noteId: note.id,
              title: noteTabLabel(note.title, true),
              filter: filterRef.current,
            }
          : tab
      )
    );
  }, []);

  const rememberCurrentTab = () => {
    const currentId = activeTabIdRef.current;
    const note = activeNoteRef.current;
    const currentFilter = filterRef.current;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === currentId
          ? {
              ...tab,
              filter: currentFilter,
              noteId: note?.id ?? null,
              title: noteTabLabel(note?.title, Boolean(note)),
            }
          : tab
      )
    );
  };

  const switchToTab = useCallback(async (tabId: string) => {
    if (tabId === activeTabIdRef.current) return;
    rememberCurrentTab();
    const next = tabsRef.current.find((tab) => tab.id === tabId);
    if (!next) return;
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    setFilter(next.filter);
    if (next.noteId) {
      await loadNote(next.noteId, tabId);
      return;
    }
    skipNextSave.current = true;
    setActiveNote(null);
    setSelectedNoteIds(new Set());
    lastClickedNoteId.current = null;
  }, [loadNote]);

  const openNewTab = useCallback(() => {
    rememberCurrentTab();
    const tab = makeNoteTab({ filter: { type: "all" } });
    setTabs((current) => [...current, tab]);
    activeTabIdRef.current = tab.id;
    setActiveTabId(tab.id);
    setFilter({ type: "all" });
    skipNextSave.current = true;
    setActiveNote(null);
    setSelectedNoteIds(new Set());
    lastClickedNoteId.current = null;
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      const currentTabs = tabsRef.current;
      const closing = currentTabs.find((tab) => tab.id === tabId);
      if (!closing) return;

      if (currentTabs.length === 1) {
        skipNextSave.current = true;
        setActiveNote(null);
        setSelectedNoteIds(new Set());
        lastClickedNoteId.current = null;
        const emptied = {
          ...closing,
          noteId: null,
          title: noteTabLabel(null, false),
        };
        tabsRef.current = [emptied];
        setTabs([emptied]);
        return;
      }

      const remaining = currentTabs.filter((tab) => tab.id !== tabId);
      const nextId = nextActiveTabId(
        currentTabs.map((tab) => tab.id),
        tabId,
        activeTabIdRef.current
      );
      tabsRef.current = remaining;
      setTabs(remaining);
      if (!nextId || nextId === activeTabIdRef.current) return;
      const next = remaining.find((tab) => tab.id === nextId);
      if (!next) return;
      activeTabIdRef.current = next.id;
      setActiveTabId(next.id);
      setFilter(next.filter);
      if (next.noteId) {
        void loadNote(next.noteId, next.id);
        return;
      }
      skipNextSave.current = true;
      setActiveNote(null);
      setSelectedNoteIds(new Set());
      lastClickedNoteId.current = null;
    },
    [loadNote]
  );

  const openInNewTab = useCallback(
    async (noteId: string) => {
      const existing = tabsRef.current.find((tab) => tab.noteId === noteId);
      if (existing) {
        await switchToTab(existing.id);
        return;
      }
      rememberCurrentTab();
      const summary = notes.find((note) => note.id === noteId);
      const tab = makeNoteTab({
        noteId,
        title: summary?.title || activeNoteRef.current?.title,
        filter: filterRef.current,
      });
      setTabs((current) => [...current, tab]);
      activeTabIdRef.current = tab.id;
      setActiveTabId(tab.id);
      await loadNote(noteId, tab.id);
    },
    [loadNote, notes, switchToTab]
  );

  const handleNoteClick = useCallback(
    (noteId: string, event: MouseEvent) => {
      if (skipNoteClickRef.current) {
        skipNoteClickRef.current = false;
        event.preventDefault();
        return;
      }
      const meta = event.metaKey || event.ctrlKey;

      if (event.shiftKey) {
        setSelectedNoteIds(new Set(noteIdsInRange(notes, lastClickedNoteId.current, noteId)));
        return;
      }

      if (meta) {
        setSelectedNoteIds((prev) => toggleNoteId(prev, noteId));
        lastClickedNoteId.current = noteId;
        return;
      }

      lastClickedNoteId.current = noteId;
      setSelectedNoteIds(new Set([noteId]));
      void loadNote(noteId);
    },
    [notes, loadNote]
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
      lastClickedNoteId.current = drag.anchorId;
      setSelectedNoteIds(new Set(noteIdsInRange(notes, drag.anchorId, noteId)));
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
    if (!showJump) return;
    let cancelled = false;
    api
      .listNotes({ templates: false })
      .then((list) => {
        if (!cancelled) setJumpNotes(list);
      })
      .catch(() => {
        if (!cancelled) setJumpNotes(notes);
      });
    return () => {
      cancelled = true;
    };
  }, [notes, showJump]);

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
            setFilter({ type: "shortcuts" });
          }
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      setError("Could not connect to Notebook API on http://127.0.0.1:8799");
    })();
  }, [refreshMeta]);

  useEffect(() => {
    if (ready) refreshNotes().catch(console.error);
  }, [ready, filter, refreshNotes]);

  useEffect(() => {
    const noteIds = new Set(notes.map((n) => n.id));
    setSelectedNoteIds((prev) => pruneNoteIds(prev, noteIds));
  }, [notes]);

  useEffect(() => {
    if (!ready) return;
    const noteIds = new Set(notes.map((note) => note.id));
    setTabs((current) => {
      const next = current.map((tab) =>
        tab.noteId && !noteIds.has(tab.noteId)
          ? { ...tab, noteId: null, title: noteTabLabel(null, false) }
          : tab
      );
      const changed = next.some((tab, index) => tab !== current[index]);
      if (!changed) return current;
      tabsRef.current = next;
      return next;
    });
  }, [notes, ready]);

  useEffect(() => {
    if (!activeNote) return;
    setTabs((current) =>
      current.map((tab) =>
        tab.id === activeTabIdRef.current && tab.noteId === activeNote.id
          ? { ...tab, title: noteTabLabel(activeNote.title, true) }
          : tab
      )
    );
  }, [activeNote?.id, activeNote?.title]);

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
        setActiveNote(updated);
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
    if (activeNote?.id === id) setActiveNote(updated);
    await refreshNotes();
    return updated;
  };

  useEffect(() => {
    if (!activeNote) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
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
    lastClickedNoteId,
    setActiveNote,
    setSelectedNoteIds,
    setPendingConfirm,
    setNotebookPicker,
    setShowGallery,
    setShowNewMenu,
    refreshNotes,
    refreshMeta,
    loadNote,
  });

  const setReminderPreset = async (kind: ReminderPreset | "clear") => {
    if (!activeNote) return;
    setShowReminderMenu(false);
    await saveNote({
      reminder_at: kind === "clear" ? null : reminderFromPreset(kind),
    });
  };

  const setListView = (list_view: ListView) => {
    const show_snippets = list_view !== "titles";
    setPrefs((current) => ({ ...current, list_view, show_snippets }));
    void api.updateSettings({ list_view, show_snippets });
  };

  const printActiveNote = () => window.print();

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
      if (activeNote?.id === id) setActiveNote(updated);
    }, { refreshMeta: true });
  };

  const tagDroppedNotes = async (tagId: string, event: DragEvent) => {
    const ids = dropNoteIds(event);
    if (!ids.length) return;
    await applyToNotes(
      ids,
      async (id) => {
        const summary = notes.find((note) => note.id === id);
        const current = summary?.tag_ids || (activeNote?.id === id ? activeNote.tag_ids : []);
        if (current.includes(tagId)) return;
        const updated = await api.updateNote(id, { tag_ids: [...current, tagId] });
        if (activeNote?.id === id) setActiveNote(updated);
      },
      { refreshMeta: true }
    );
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
    () => notes.filter((note) => noteMatchesFacets(note, listFacets)),
    [notes, listFacets]
  );

  const groupedNotes = useMemo(
    () =>
      groupNotesForList(
        visibleNotes,
        prefs.sort_by === "title"
          ? "title"
          : prefs.sort_by === "created"
            ? "created"
            : "updated"
      ),
    [visibleNotes, prefs.sort_by]
  );

  const visibleTags = useMemo(
    () => tags.filter((tag) => matchesSidebarFilter(tag.name, sidebarFilter)),
    [tags, sidebarFilter]
  );

  useEffect(() => {
    document.title = windowTitleForNote(activeNote ? activeNote.title : null);
  }, [activeNote]);

  useEffect(() => {
    if (searchOpen || filter.type === "search") {
      searchRef.current?.focus();
    }
  }, [searchOpen, filter]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "n" && e.shiftKey) {
        e.preventDefault();
        setShowGallery(true);
      } else if (meta && e.key === "n") {
        e.preventDefault();
        createNote();
      } else if (meta && e.key === "f" && e.shiftKey) {
        e.preventDefault();
        openGlobalSearch();
      } else if (meta && e.key === "f") {
        e.preventDefault();
        if (activeNote) setFindTick((tick) => tick + 1);
        else openGlobalSearch();
      } else if (meta && e.key === "h") {
        e.preventDefault();
        if (activeNote) setReplaceTick((tick) => tick + 1);
      } else if (meta && (e.key === "=" || e.key === "+")) {
        e.preventDefault();
        persistEditorChrome({
          ...editorChrome,
          zoom: nextZoom(editorChrome.zoom, 1),
        });
      } else if (meta && e.key === "-") {
        e.preventDefault();
        persistEditorChrome({
          ...editorChrome,
          zoom: nextZoom(editorChrome.zoom, -1),
        });
      } else if (meta && e.key === "0") {
        e.preventDefault();
        persistEditorChrome({
          ...editorChrome,
          zoom: nextZoom(editorChrome.zoom, 0),
        });
      } else if (e.key === "F11") {
        e.preventDefault();
        setFocusMode((open) => !open);
      } else if (e.altKey && meta && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        e.preventDefault();
        persistPaneLayout(
          e.key === "ArrowLeft"
            ? toggleNoteListHidden(paneLayout)
            : toggleNoteExpanded(paneLayout)
        );
      } else if (e.altKey && meta && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        persistPaneLayout(toggleSidebarRail(paneLayout));
      } else if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
      } else if (e.key === "Escape" && accountMenu) {
        e.preventDefault();
        setAccountMenu(false);
        e.preventDefault();
        setSidebarFlyout(null);
      } else if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        setSearchOpen(false);
        if (filter.type === "search") setFilter({ type: "all" });
      } else if (meta && e.key === "j") {
        e.preventDefault();
        setShowJump(true);
      } else if (meta && e.key === "p") {
        e.preventDefault();
        window.print();
      } else if (meta && e.key === "i" && e.shiftKey && activeNote) {
        e.preventDefault();
        setShowInfo((open) => !open);
      } else if (
        (e.key === "ArrowDown" || e.key === "ArrowUp") &&
        !isTextInputFocused() &&
        visibleNotes.length > 0
      ) {
        e.preventDefault();
        const current =
          lastClickedNoteId.current ||
          (selectedNoteIds.size === 1 ? [...selectedNoteIds][0] : null);
        const nextId = adjacentNoteId(
          visibleNotes,
          current,
          e.key === "ArrowDown" ? 1 : -1
        );
        if (nextId) {
          lastClickedNoteId.current = nextId;
          if (e.shiftKey && current) {
            setSelectedNoteIds(new Set(noteIdsInRange(notes, current, nextId)));
          } else {
            void loadNote(nextId);
          }
        }
      } else if (meta && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (meta && e.key === "/") {
        e.preventDefault();
        openSettings("shortcuts");
      } else if (meta && e.key === "t" && e.shiftKey) {
        e.preventDefault();
        openNewTab();
      } else if (meta && e.key === "w") {
        e.preventDefault();
        closeTab(activeTabIdRef.current);
      } else if (meta && e.key === "Tab") {
        e.preventDefault();
        const ids = tabsRef.current.map((tab) => tab.id);
        const index = ids.indexOf(activeTabIdRef.current);
        if (index < 0 || ids.length < 2) return;
        const nextIndex = e.shiftKey
          ? (index - 1 + ids.length) % ids.length
          : (index + 1) % ids.length;
        void switchToTab(ids[nextIndex]);
      } else if (meta && e.key === "o" && e.altKey && activeNote) {
        e.preventDefault();
        void openInNewTab(activeNote.id);
      } else if (meta && e.shiftKey && (e.key === "l" || e.key === "L") && activeNote) {
        e.preventDefault();
        dispatchEditorCommand({ type: "bulletList" });
      } else if (meta && e.shiftKey && (e.key === "o" || e.key === "O") && activeNote) {
        e.preventDefault();
        dispatchEditorCommand({ type: "orderedList" });
      } else if (meta && e.shiftKey && (e.key === "c" || e.key === "C") && activeNote) {
        e.preventDefault();
        dispatchEditorCommand({ type: "taskList" });
      } else if (meta && e.key === "a" && !isTextInputFocused()) {
        e.preventDefault();
        setSelectedNoteIds(new Set(notes.map((n) => n.id)));
      } else if (e.key === "Escape" && selectedNoteIds.size > 1) {
        if (activeNote) setSelectedNoteIds(new Set([activeNote.id]));
        else setSelectedNoteIds(new Set());
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
    openNewTab,
    openInNewTab,
    closeTab,
    loadNote,
    setNewNotebookStackId,
    setNewName,
    setShowNewNotebook,
    setShowNewTag,
    setShowGallery,
    setNotebookPicker,
    setShowInfo,
    setShowJump,
    setFindTick,
    setReplaceTick,
    setFocusMode,
    setFilter,
    setSidebarFlyout,
    setSelectedNoteIds,
    setShowReminderMenu,
    setPrefs,
    setActiveNote,
    persistPaneLayout,
    persistEditorChrome,
    revealSidebarFlyout,
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
        setFilter({ type: "all" });
      }
      setActiveNote(null);
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
        setFilter({ type: "all" });
      }
      await refreshMeta();
      await refreshNotes();
    },
    restoreTemplates: () => void api.restoreTemplates().then(refreshMeta),
    toggleTheme: () => {
      const theme = prefs.theme === "dark" ? "light" : "dark";
      setPrefs((current) => ({ ...current, theme }));
      void api.updateSettings({ theme });
    },
    collapsedStacks,
    toggleStackCollapsed: (id: string) =>
      persistCollapsedStacks(toggleCollapsedId(collapsedStacks, id)),
    collapseAllStacks: () => persistCollapsedStacks(collapseAllIds(stacks.map((stack) => stack.id))),
    expandAllStacks: () => persistCollapsedStacks([]),
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
        setAccountMenu(false);
        setContextMenu(null);
        if (!(event.target as HTMLElement).closest(".sidebar")) {
          setSidebarFlyout(null);
        }
      }}
    >
      <MenuBar groups={menuGroups} />
      <NoteTabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelect={(id) => void switchToTab(id)}
        onClose={closeTab}
        onNewTab={openNewTab}
        onReorder={(fromId, toId) => {
          setTabs((current) => {
            const next = reorderById(current, fromId, toId);
            tabsRef.current = next;
            return next;
          });
        }}
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
            className="icon-btn sidebar-rail-toggle"
            title={sidebarRail ? "Pin sidebar open" : "Collapse sidebar to icons"}
            aria-pressed={!sidebarRail}
            onClick={() => persistPaneLayout(toggleSidebarRail(paneLayout))}
          >
            <Icon.Sidebar size={18} />
          </button>
          <button
            type="button"
            className={searchOpen || filter.type === "search" ? "icon-btn active" : "icon-btn"}
            title="Search"
            onClick={() => {
              if (searchOpen || filter.type === "search") {
                setSearchOpen(false);
                if (filter.type === "search") setFilter({ type: "all" });
                return;
              }
              openGlobalSearch();
            }}
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
              <div className="menu-popover right">
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    void createBlankNote();
                  }}
                >
                  Blank note
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowGallery(true);
                  }}
                >
                  From template
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setNewNotebookStackId(null);
                    setShowNewNotebook(true);
                  }}
                >
                  New notebook
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    setShowNewTag(true);
                  }}
                >
                  New tag
                </button>
                <button
                  onClick={() => {
                    setShowNewMenu(false);
                    openSidebarFilter("notebooks");
                  }}
                >
                  Filter notebooks
                </button>
                <button
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
              setSidebarFlyout(null);
              setFilter({ type: "all" });
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
              aria-expanded={sidebarFlyout === "shortcuts"}
              onClick={() => {
                openSidebarFlyout("shortcuts");
                setFilter({ type: "shortcuts" });
              }}
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
                setSidebarFlyout(null);
                setFilter({ type: "reminders" });
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
              aria-expanded={sidebarFlyout === "notebooks"}
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
              aria-expanded={sidebarFlyout === "tags"}
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
                setSidebarFlyout(null);
                setFilter({ type: "templates" });
              }}
            >
              <Icon.Templates size={16} />
              <span className="nav-label">Templates</span>
              <span className="nav-count">{counts.templates}</span>
            </button>
          )}

          {prefs.show_trash && (
            <button
              className={filter.type === "trash" ? "nav-item active" : "nav-item"}
              title="Trash"
              onClick={() => {
                setSidebarFlyout(null);
                setFilter({ type: "trash" });
              }}
            >
              <Icon.Trash size={16} />
              <span className="nav-label">Trash</span>
              <span className="nav-count">{counts.trash}</span>
            </button>
          )}
        </nav>
        {sidebarFlyout && (
          <div className="sidebar-flyout" onMouseDown={(event) => event.stopPropagation()}>
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
                onClick={() => setSidebarFlyout(null)}
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
                        setFilter({ type: "shortcuts" });
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
                            onSelect={() =>
                              setFilter({
                                type: "notebook",
                                id: nb.id,
                                name: nb.name,
                              })
                            }
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
                      onSelect={() =>
                        setFilter({ type: "notebook", id: nb.id, name: nb.name })
                      }
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
                      onClick={() =>
                        setFilter({ type: "tag", id: tag.id, name: tag.name })
                      }
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
        <div className="sidebar-account">
          <div className="account-menu-wrap" onMouseDown={(event) => event.stopPropagation()}>
            <button
              type="button"
              className={accountMenu ? "account-chip active" : "account-chip"}
              onClick={() => setAccountMenu((open) => !open)}
              title="Account"
            >
              <span
                className="avatar"
                style={{ background: avatarColor(account.display_name) }}
              >
                {account.display_name.slice(0, 1).toUpperCase()}
              </span>
              <span className="account-copy">
                <span className="account-name">{account.display_name}</span>
                <span className="account-email">{account.email || "Local account"}</span>
              </span>
            </button>
            {accountMenu && (
              <div className="account-popover" role="menu">
                <div className="account-popover-head">
                  <span
                    className="avatar"
                    style={{ background: avatarColor(account.display_name) }}
                  >
                    {account.display_name.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="account-copy">
                    <span className="account-name">{account.display_name}</span>
                    <span className="account-email">{account.email || "Local account"}</span>
                  </span>
                </div>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenu(false);
                    openSettings("account");
                  }}
                >
                  Account
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenu(false);
                    openSettings();
                  }}
                >
                  Settings
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccountMenu(false);
                    const theme = prefs.theme === "dark" ? "light" : "dark";
                    setPrefs((current) => ({ ...current, theme }));
                    void api.updateSettings({ theme });
                  }}
                >
                  {prefs.theme === "dark" ? "Use light theme" : "Use dark theme"}
                </button>
              </div>
            )}
          </div>
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
                setFilter({
                  type: "notebook",
                  id: lastNotebookId,
                  name: lastNotebookName,
                });
              } else {
                setFilter({ type: "all" });
              }
            } catch (err) {
              setImportStatus(err instanceof Error ? err.message : "Import failed");
            }
          }}
        />
      </aside>
      <PaneSplitter
        className="sidebar-splitter"
        label="Resize sidebar"
        onDrag={(_delta, position) => persistPaneLayout(resizeSidebarTo(paneLayout, position))}
      />

      <section className="note-list-panel">
        {(searchOpen || filter.type === "search") && (
          <div className="list-search">
            <Icon.Search size={15} />
            <input
              ref={searchRef}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && searchInput.trim()) {
                  runSearch(searchInput);
                }
                if (e.key === "Escape") {
                  setSearchOpen(false);
                  if (filter.type === "search") setFilter({ type: "all" });
                }
              }}
              placeholder="Search notes"
              aria-label="Search notes"
            />
            <button
              type="button"
              className="icon-btn"
              title="Close search"
              onClick={() => {
                setSearchOpen(false);
                setSearchInput("");
                if (filter.type === "search") setFilter({ type: "all" });
              }}
            >
              <Icon.Close size={14} />
            </button>
            {recentSearches.length > 0 && !searchInput.trim() && (
              <div className="recent-searches">
                <div className="recent-searches-head">
                  <span>Recent searches</span>
                  <button
                    type="button"
                    className="ghost-btn small"
                    onClick={() => persistRecentSearches([])}
                  >
                    Clear
                  </button>
                </div>
                {recentSearches.map((query) => (
                  <button
                    key={query}
                    type="button"
                    className="recent-search-item"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => runSearch(query)}
                  >
                    <Icon.Search size={13} />
                    {query}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="panel-header">
          <div>
            <h2>{viewTitle}</h2>
            <span className="count" title="Notes in this view">
              {visibleNotes.length}
              {listFacets.length && visibleNotes.length !== notes.length
                ? ` of ${notes.length}`
                : ""}
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
                  setActiveNote(null);
                  await refreshNotes();
                }}
              >
                Empty
              </button>
            )}
            <select
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
                  : "")
              }
              aria-pressed={selectedNoteIds.has(note.id)}
              draggable={filter.type !== "trash"}
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
                  setSelectedNoteIds(new Set([note.id]));
                  lastClickedNoteId.current = note.id;
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
                        isReminderOverdue(note.reminder_at)
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
          {notes.length === 0 && (
            <EmptyListState
              filter={filter}
              onCreate={() => void createNote()}
              onBrowseTemplates={() => setShowGallery(true)}
            />
          )}
          {notes.length > 0 && visibleNotes.length === 0 && (
            <div className="empty-state compact">No notes match these filters.</div>
          )}
        </div>
      </section>
      <PaneSplitter
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
                  className="title-input"
                  value={activeNote.title}
                  onChange={(e) =>
                    setActiveNote({ ...activeNote, title: e.target.value })
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
                        {!activeNote.is_template && (
                          <button
                            onClick={() => {
                              setShowNoteMenu(false);
                              saveNote({
                                ...activeNote,
                                is_template: true,
                                template_category: "My templates",
                              });
                              setFilter({ type: "templates" });
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
                        {filter.type === "trash" ? (
                          <>
                            <button
                              onClick={async () => {
                                await api.restoreNote(activeNote.id);
                                setActiveNote(null);
                                await refreshNotes();
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
                                setActiveNote(null);
                                await refreshNotes();
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
                              setActiveNote(null);
                              await refreshNotes();
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
                      isReminderOverdue(activeNote.reminder_at)
                        ? "reminder-chip overdue"
                        : "reminder-chip"
                    }
                  >
                    <Icon.Reminder size={12} />
                    {formatReminderLabel(activeNote.reminder_at, prefs.date_format)}
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
              findTick={findTick}
              replaceTick={replaceTick}
              toolbarHidden={editorChrome.toolbarHidden}
              attachmentsExpanded={editorChrome.attachmentsExpanded}
              onAttachmentsExpandedChange={(expanded) =>
                persistEditorChrome({
                  ...editorChrome,
                  attachmentsExpanded: expanded,
                })
              }
              zoom={editorChrome.zoom}
              onOpenNoteLink={(id) => void loadNote(id)}
              onChange={(html) =>
                setActiveNote({ ...activeNote, content: html })
              }
              onUseAsTitle={(title) =>
                setActiveNote({ ...activeNote, title })
              }
              onAttach={async (file) => {
                const attachment = await api.uploadAttachment(activeNote.id, file);
                await refreshNotes();
                if (
                  isPdfFile(attachment.mime_type, attachment.filename) &&
                  (!activeNote.title || activeNote.title === "Untitled")
                ) {
                  setActiveNote((current) =>
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
                    isReminderOverdue(activeNote.reminder_at) ? "reminder-overdue-text" : ""
                  }
                >
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
                skipNextSave.current = true;
                setActiveNote(restored);
                await refreshNotes();
                await refreshMeta();
              }}
            />
          )}
          </div>
        ) : (
          <div className="empty-editor">
            <div className="logo-mark large">N</div>
            <h2>Select a note or create a new one</h2>
            <div className="empty-actions">
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
              if (
                filter.type === "notebook" &&
                filter.id === renameTarget.id
              ) {
                setFilter({ type: "notebook", id: renameTarget.id, name });
              }
            } else if (renameTarget.kind === "stack") {
              await api.updateStack(renameTarget.id, { name });
            } else {
              await api.updateTag(renameTarget.id, { name });
              if (filter.type === "tag" && filter.id === renameTarget.id) {
                setFilter({ type: "tag", id: renameTarget.id, name });
              }
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
            await refreshNotes();
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
              if (notebook) setFilter({ type: "notebook", id: notebook.id, name: notebook.name });
            } else if (target.kind === "tag") {
              const tag = tags.find((item) => item.id === target.id);
              if (tag) setFilter({ type: "tag", id: tag.id, name: tag.name });
            } else {
              void loadNote(target.id);
            }
          }}
        />
      )}

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
