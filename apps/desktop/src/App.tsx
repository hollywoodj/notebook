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
import { SearchDialog } from "./components/SearchDialog";
import { CommandPalette } from "./components/CommandPalette";
import { NotebookPickerDialog } from "./components/NotebookPickerDialog";
import { ShortcutOverlay } from "./components/ShortcutOverlay";
import { ReminderCalendar } from "./components/ReminderCalendar";
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
  COMPLETED_REMINDERS_KEY,
  LAST_SESSION_KEY,
  SAVED_SEARCHES_KEY,
  RECENT_NOTES_KEY,
  SIDEBAR_SECTIONS_KEY,
  NOTE_COLORS_KEY,
  LOCKED_NOTES_KEY,
  SIDEBAR_RAIL_WIDTH,
  SIDEBAR_NAV_ICON_SIZE,
  adjacentNoteId,
  noteIdByOffset,
  attachmentCountLabel,
  avatarColor,
  checklistProgressLabel,
  clampPaneWidth,
  collapseAllIds,
  copyTextToClipboard,
  countWords,
  decodeNoteDrag,
  dispatchEditorCommand,
  downloadTextFile,
  encodeNoteDrag,
  formatReminderLabel,
  fromDatetimeLocalValue,
  groupNotesByNotebook,
  groupNotesForList,
  groupRemindersForList,
  htmlToMarkdown,
  htmlToPlainText,
  isReminderDone,
  isReminderOverdue,
  isNoteExpanded,
  isSidebarRail,
  hasVisibleSidebarNotebooks,
  matchesSidebarFilter,
  nextActiveTabId,
  nextSidebarFlyout,
  nextZoom,
  noteAppLink,
  noteMailtoHref,
  noteMatchesDateRange,
  noteMatchesFacets,
  noteMatchesSearchOperators,
  noteTabLabel,
  notebooksMatchingFilter,
  notesToEnex,
  parseCollapsedStacks,
  parseCompletedReminders,
  parseEditorChrome,
  parseLastSession,
  parsePaneLayout,
  parseRecentSearches,
  parseSavedSearches,
  parseSearchQuery,
  parseRecentNotes,
  parseSidebarSections,
  parseNoteColorMap,
  parseIdList,
  pushNavHistory,
  reminderFromPreset,
  reminderFromSnooze,
  rememberSearch,
  reorderById,
  resizeSidebarTo,
  resolveListView,
  resolveThumbnailUrl,
  safeFilename,
  sameNavLocation,
  sidebarFilterLabel,
  sidebarFlyoutTitle,
  snippetParts,
  stepNavBack,
  stepNavForward,
  toDatetimeLocalValue,
  toggleCollapsedId,
  toggleCompletedReminder,
  toggleListFacet,
  toggleNoteExpanded,
  toggleNoteListHidden,
  toggleSidebarRail,
  windowTitleForNote,
  deleteSavedSearch,
  upsertSavedSearch,
  closeOtherTabIds,
  closeTabsToTheRight,
  countCharacters,
  formatRelativeTime,
  hasActiveListFilters,
  popClosedTab,
  readingTimeLabel,
  rememberClosedTab,
  rememberRecentNote,
  reminderFallsOnDay,
  renameSavedSearch,
  isoDayKey,
  trashToastCopy,
  viewTitleForFilter,
  setNoteColor as applyNoteColor,
  pinTabById,
  closeAllUnpinnedTabIds,
  listCountLabel,
  sortNotes,
  type DateRangeFacet,
  type ListView,
  type NoteListFacet,
  type ReminderPreset,
  type SidebarFlyout,
  type SidebarFlyoutKind,
  type SnoozePreset,
  type NavLocation,
  type PaletteAction,
  type SidebarSectionId,
  NOTE_COLORS,
} from "./uiChrome";
import {
  parseNotebookUrl,
  sendUrlsForChecklists,
  sendUrlsForNote,
  type OmniCloneSchemePref,
} from "./omniFocus";

const PALETTE_ACTIONS: PaletteAction[] = [
  { id: "new-note", label: "New note", hint: "Ctrl/⌘ N" },
  { id: "search", label: "Search notes", hint: "Ctrl/⌘ K" },
  { id: "jump", label: "Jump to…", hint: "Ctrl/⌘ J" },
  { id: "settings", label: "Settings", hint: "Ctrl/⌘ ," },
  { id: "templates", label: "Browse templates" },
  { id: "print", label: "Print note", hint: "Ctrl/⌘ P" },
  { id: "email", label: "Email note…" },
  { id: "send-omniclone", label: "Send to OmniClone" },
  { id: "theme", label: "Toggle theme" },
  { id: "focus", label: "Focus mode", hint: "F11" },
  { id: "back", label: "Go back", hint: "Ctrl/⌘ [" },
  { id: "forward", label: "Go forward", hint: "Ctrl/⌘ ]" },
  { id: "new-notebook", label: "New notebook…" },
  { id: "new-tag", label: "New tag…" },
  { id: "reminders", label: "Show reminders" },
  { id: "shortcuts", label: "Show shortcuts" },
  { id: "all-notes", label: "All notes" },
  { id: "archived", label: "Show archived notes" },
  { id: "info", label: "Note info", hint: "Ctrl/⌘ Shift I" },
  { id: "outline", label: "Toggle note outline" },
  { id: "jump-tag", label: "Go to tag…", hint: "Ctrl/⌘ Alt T" },
  { id: "shortcuts-overlay", label: "Keyboard shortcuts", hint: "Ctrl/⌘ /" },
  { id: "lock-note", label: "Lock / unlock note" },
];

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
  const [navPast, setNavPast] = useState<NavLocation[]>([]);
  const [navFuture, setNavFuture] = useState<NavLocation[]>([]);
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
  const sidebarFilterRef = useRef<HTMLInputElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
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
  const ignoreNavRef = useRef(false);
  const navSeededRef = useRef(false);
  const navCurrentRef = useRef<NavLocation>({ filter: { type: "all" }, noteId: null });
  const sessionReadyRef = useRef(false);
  const hoverTimerRef = useRef<number | null>(null);

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
    setFilter({ type: "search", query: cleaned });
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
        list = await api.listNotes({ templates: false, archived: false });
        break;
      case "notebook":
        list = await api.listNotes({ notebookId: filter.id, templates: false, archived: false });
        break;
      case "tag":
        list = await api.listNotes({ tagId: filter.id, templates: false, archived: false });
        break;
      case "shortcuts":
        list = await api.listShortcuts();
        break;
      case "reminders":
        list = (await api.listNotes({ templates: false, archived: false })).filter((note) => note.reminder_at);
        break;
      case "templates":
        list = await api.listNotes({ templates: true });
        break;
      case "trash":
        list = await api.listNotes({ trash: true });
        break;
      case "archived":
        list = await api.listNotes({ templates: false, archived: true });
        break;
      case "search": {
        const parsed = parseSearchQuery(filter.query);
        if (parsed.text) {
          list = (await api.search(parsed.text)).notes;
        } else {
          list = await api.listNotes({ templates: false, archived: false });
        }
        list = list.filter((note) => noteMatchesSearchOperators(note, parsed));
        if (searchScope) {
          list = list.filter((note) => note.notebook_id === searchScope.id);
        }
        break;
      }
    }
    const sorted = sortNotes(
      list,
      filter.type === "reminders" ? "reminder" : prefs.sort_by,
      Boolean(prefs.sort_descending)
    );
    setNotes(sorted);
  }, [filter, prefs.sort_by, prefs.sort_descending, searchScope]);

  const loadNote = useCallback(async (id: string, tabId?: string) => {
    skipNextSave.current = true;
    const note = await api.getNote(id);
    const targetTabId = tabId ?? activeTabIdRef.current;
    setActiveNote(note);
    setSelectedNoteIds(new Set([id]));
    lastClickedNoteId.current = id;
    setShowNoteMenu(false);
    setRecentNotes((current) => {
      const next = rememberRecentNote(current, {
        id: note.id,
        title: note.title || "Untitled",
      });
      localStorage.setItem(RECENT_NOTES_KEY, JSON.stringify(next));
      return next;
    });
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

  const currentNavLocation = (): NavLocation => ({
    filter: filterRef.current,
    noteId: activeNoteRef.current?.id ?? null,
  });

  const applyNavLocation = (location: NavLocation) => {
    ignoreNavRef.current = true;
    let nextFilter: ViewFilter = { type: "all" };
    if (location.filter.type === "notebook") {
      nextFilter = { type: "notebook", id: location.filter.id || "", name: location.filter.name || "" };
    } else if (location.filter.type === "tag") {
      nextFilter = { type: "tag", id: location.filter.id || "", name: location.filter.name || "" };
    } else if (location.filter.type === "search") {
      nextFilter = { type: "search", query: location.filter.query || "" };
    } else if (location.filter.type === "shortcuts") {
      nextFilter = { type: "shortcuts" };
    } else if (location.filter.type === "reminders") {
      nextFilter = { type: "reminders" };
    } else if (location.filter.type === "templates") {
      nextFilter = { type: "templates" };
    } else if (location.filter.type === "trash") {
      nextFilter = { type: "trash" };
    } else if (location.filter.type === "archived") {
      nextFilter = { type: "archived" };
    }
    setFilter(nextFilter);
    if (nextFilter.type === "search") setSearchInput(nextFilter.query);
    navCurrentRef.current = location;
    if (location.noteId) {
      void loadNote(location.noteId).finally(() => {
        navCurrentRef.current = location;
        ignoreNavRef.current = false;
      });
      return;
    }
    skipNextSave.current = true;
    setActiveNote(null);
    setSelectedNoteIds(new Set());
    lastClickedNoteId.current = null;
    ignoreNavRef.current = false;
  };

  const goBack = () => {
    const stepped = stepNavBack(navPast, currentNavLocation(), navFuture);
    if (!stepped) return;
    setNavPast(stepped.past);
    setNavFuture(stepped.future);
    applyNavLocation(stepped.current);
  };

  const goForward = () => {
    const stepped = stepNavForward(navPast, currentNavLocation(), navFuture);
    if (!stepped) return;
    setNavPast(stepped.past);
    setNavFuture(stepped.future);
    applyNavLocation(stepped.current);
  };

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
    ignoreNavRef.current = true;
    rememberCurrentTab();
    const next = tabsRef.current.find((tab) => tab.id === tabId);
    if (!next) {
      ignoreNavRef.current = false;
      return;
    }
    activeTabIdRef.current = tabId;
    setActiveTabId(tabId);
    setFilter(next.filter);
    if (next.noteId) {
      await loadNote(next.noteId, tabId);
      navCurrentRef.current = { filter: next.filter, noteId: next.noteId };
      ignoreNavRef.current = false;
      return;
    }
    skipNextSave.current = true;
    setActiveNote(null);
    setSelectedNoteIds(new Set());
    lastClickedNoteId.current = null;
    navCurrentRef.current = { filter: next.filter, noteId: null };
    ignoreNavRef.current = false;
  }, [loadNote]);

  const openNewTab = useCallback(() => {
    ignoreNavRef.current = true;
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
    navCurrentRef.current = { filter: { type: "all" }, noteId: null };
    ignoreNavRef.current = false;
  }, []);

  const closeTab = useCallback(
    (tabId: string) => {
      const currentTabs = tabsRef.current;
      const closing = currentTabs.find((tab) => tab.id === tabId);
      if (!closing) return;
      if (closing.noteId) {
        setClosedTabs((stack) => rememberClosedTab(stack, closing));
      }
      ignoreNavRef.current = true;

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
        navCurrentRef.current = { filter: filterRef.current, noteId: null };
        ignoreNavRef.current = false;
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
      if (!nextId || nextId === activeTabIdRef.current) {
        ignoreNavRef.current = false;
        return;
      }
      const next = remaining.find((tab) => tab.id === nextId);
      if (!next) {
        ignoreNavRef.current = false;
        return;
      }
      activeTabIdRef.current = next.id;
      setActiveTabId(next.id);
      setFilter(next.filter);
      if (next.noteId) {
        void loadNote(next.noteId, next.id).then(() => {
          navCurrentRef.current = { filter: next.filter, noteId: next.noteId };
          ignoreNavRef.current = false;
        });
        return;
      }
      skipNextSave.current = true;
      setActiveNote(null);
      setSelectedNoteIds(new Set());
      lastClickedNoteId.current = null;
      navCurrentRef.current = { filter: next.filter, noteId: null };
      ignoreNavRef.current = false;
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
            setFilter({ type: "shortcuts" });
          } else {
            const session = parseLastSession(
              typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_SESSION_KEY)
            );
            if (session) applyNavLocation(session);
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
        if (activeNote?.id === id) setActiveNote(updated);
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
    return groupNotesForList(
      visibleNotes,
      prefs.sort_by === "title" || prefs.sort_by === "created" || prefs.sort_by === "reminder"
        ? prefs.sort_by
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

  useEffect(() => {
    document.title = windowTitleForNote(activeNote ? activeNote.title : null);
  }, [activeNote]);

  useEffect(() => {
    if (!ready) return;
    const next: NavLocation = {
      filter,
      noteId: activeNote?.id ?? null,
    };
    if (!navSeededRef.current) {
      navSeededRef.current = true;
      navCurrentRef.current = next;
      return;
    }
    if (sameNavLocation(navCurrentRef.current, next)) {
      navCurrentRef.current = next;
      return;
    }
    if (ignoreNavRef.current) {
      navCurrentRef.current = next;
      return;
    }
    const pushed = pushNavHistory(navPast, navCurrentRef.current, next);
    navCurrentRef.current = next;
    if (!pushed) return;
    setNavPast(pushed.past);
    setNavFuture(pushed.future);
  }, [ready, filter, activeNote?.id, navPast]);

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
      } else if (meta && (e.key === "k" || e.key === "K") && e.shiftKey) {
        e.preventDefault();
        openGlobalSearch();
      } else if (meta && (e.key === "k" || e.key === "K") && !e.shiftKey) {
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
      } else if (meta && (e.key === "[" || e.key === "BracketLeft") && !e.altKey) {
        e.preventDefault();
        goBack();
      } else if (meta && (e.key === "]" || e.key === "BracketRight") && !e.altKey) {
        e.preventDefault();
        goForward();
      } else if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
      } else if (e.key === "Escape" && accountMenu) {
        e.preventDefault();
        setAccountMenu(false);
      } else if (e.key === "Escape" && sidebarFlyout) {
        e.preventDefault();
        setSidebarFlyout(null);
      } else if (e.key === "Escape" && showPalette) {
        e.preventDefault();
        setShowPalette(false);
      } else if (e.key === "Escape" && searchOpen) {
        e.preventDefault();
        closeSearch();
      } else if (e.key === "Escape" && hoverPreview) {
        e.preventDefault();
        hideHoverPreview();
      } else if (meta && e.key === "j" && e.altKey) {
        e.preventDefault();
        setJumpMode("notebook");
        setShowJump(true);
      } else if (meta && e.key === "j") {
        e.preventDefault();
        setJumpMode("all");
        setShowJump(true);
      } else if (e.key === "F3") {
        e.preventDefault();
        dispatchEditorCommand({ type: e.shiftKey ? "findPrev" : "findNext" });
      } else if (meta && e.shiftKey && (e.key === "v" || e.key === "V") && activeNote) {
        e.preventDefault();
        dispatchEditorCommand({ type: "pastePlain" });
      } else if (meta && (e.key === "p" || e.key === "P") && e.shiftKey) {
        e.preventDefault();
        setShowPalette(true);
      } else if (meta && (e.key === "p" || e.key === "P")) {
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
      } else if (
        (e.key === "j" || e.key === "k" || e.key === "J" || e.key === "K") &&
        !meta &&
        !e.altKey &&
        !isTextInputFocused() &&
        visibleNotes.length > 0
      ) {
        e.preventDefault();
        const current =
          lastClickedNoteId.current ||
          (selectedNoteIds.size === 1 ? [...selectedNoteIds][0] : null);
        const nextId = adjacentNoteId(visibleNotes, current, e.key === "j" || e.key === "J" ? 1 : -1);
        if (nextId) {
          lastClickedNoteId.current = nextId;
          void loadNote(nextId);
        }
      } else if (
        (e.key === "Home" || e.key === "End" || e.key === "PageDown" || e.key === "PageUp") &&
        !isTextInputFocused() &&
        visibleNotes.length > 0
      ) {
        e.preventDefault();
        const current =
          lastClickedNoteId.current ||
          (selectedNoteIds.size === 1 ? [...selectedNoteIds][0] : null);
        const offset =
          e.key === "Home"
            ? -visibleNotes.length
            : e.key === "End"
              ? visibleNotes.length
              : e.key === "PageDown"
                ? 8
                : -8;
        const nextId = noteIdByOffset(visibleNotes, current, offset);
        if (nextId) {
          lastClickedNoteId.current = nextId;
          void loadNote(nextId);
        }
      } else if (e.key === "F2" && !isTextInputFocused() && activeNote) {
        e.preventDefault();
        openRename({
          kind: "note",
          id: activeNote.id,
          name: activeNote.title || "Untitled",
        });
      } else if (meta && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (
        e.ctrlKey &&
        e.altKey &&
        (e.key === "c" || e.key === "C") &&
        !e.shiftKey &&
        activeNote
      ) {
        const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
        if (!isMac || e.metaKey) {
          e.preventDefault();
          void copyActiveNoteLink();
        }
      } else if (meta && e.key === "/") {
        e.preventDefault();
        setShowShortcuts((open) => !open);
      } else if (meta && e.altKey && (e.key === "t" || e.key === "T")) {
        e.preventDefault();
        setJumpMode("tag");
        setShowJump(true);
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
        void deleteSelectedNotesWithUndo();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
        <div className="logo-mark">N</div>
        <p>Starting Notebook…</p>
      </div>
    );
  }

  const viewTitle = viewTitleForFilter(filter);

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

  const runPaletteAction = (id: string) => {
    switch (id) {
      case "new-note":
        void createNote();
        break;
      case "search":
        openGlobalSearch();
        break;
      case "jump":
        setJumpMode("all");
        setShowJump(true);
        break;
      case "settings":
        openSettings();
        break;
      case "templates":
        setShowGallery(true);
        break;
      case "print":
        printActiveNote();
        break;
      case "email":
        void emailActiveNote();
        break;
      case "send-omniclone":
        void sendToOmniClone("note");
        break;
      case "theme":
        toggleTheme();
        break;
      case "focus":
        setFocusMode((open) => !open);
        break;
      case "back":
        goBack();
        break;
      case "forward":
        goForward();
        break;
      case "new-notebook":
        setNewNotebookStackId(null);
        setNewName("");
        setShowNewNotebook(true);
        break;
      case "new-tag":
        setNewName("");
        setShowNewTag(true);
        break;
      case "reminders":
        setSidebarFlyout(null);
        setFilter({ type: "reminders" });
        break;
      case "shortcuts":
        revealSidebarFlyout("shortcuts");
        setFilter({ type: "shortcuts" });
        break;
      case "all-notes":
        setSidebarFlyout(null);
        setFilter({ type: "all" });
        break;
      case "archived":
        setSidebarFlyout(null);
        setFilter({ type: "archived" });
        break;
      case "info":
        if (activeNote) setShowInfo((open) => !open);
        break;
      case "outline":
        persistEditorChrome({
          ...editorChrome,
          outlineOpen: !editorChrome.outlineOpen,
        });
        break;
      case "jump-tag":
        setJumpMode("tag");
        setShowJump(true);
        break;
      case "shortcuts-overlay":
        setShowShortcuts(true);
        break;
      case "lock-note":
        if (activeNote) {
          const next = toggleCollapsedId(lockedNoteIds, activeNote.id);
          setLockedNoteIds(next);
          localStorage.setItem(LOCKED_NOTES_KEY, JSON.stringify(next));
        }
        break;
      default:
        break;
    }
  };

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
    ignoreNavRef.current = true;
    rememberCurrentTab();
    const tab = { ...popped.item, id: popped.item.id || makeNoteTab().id };
    setTabs((current) => {
      const next = [...current, tab];
      tabsRef.current = next;
      return next;
    });
    activeTabIdRef.current = tab.id;
    setActiveTabId(tab.id);
    setFilter(tab.filter);
    if (tab.noteId) {
      void loadNote(tab.noteId, tab.id).finally(() => {
        ignoreNavRef.current = false;
      });
      return;
    }
    skipNextSave.current = true;
    setActiveNote(null);
    ignoreNavRef.current = false;
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
      const ids = closeAllUnpinnedTabIds(tabsRef.current);
      if (!ids.length) return;
      ids.forEach((id) => closeTab(id));
    },
    pinActiveTab: () => {
      setTabs((current) => {
        const next = pinTabById(current, activeTabIdRef.current);
        tabsRef.current = next;
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
        hideHoverPreview();
        setContextMenu(null);
        if (!(event.target as HTMLElement).closest(".sidebar")) {
          setSidebarFlyout(null);
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
        onSelect={(id) => void switchToTab(id)}
        onClose={closeTab}
        onCloseOthers={(id) => {
          closeOtherTabIds(
            tabsRef.current.map((tab) => tab.id),
            id
          ).forEach((tabId) => closeTab(tabId));
        }}
        onCloseToTheRight={(id) => {
          closeTabsToTheRight(
            tabsRef.current.map((tab) => tab.id),
            id
          ).forEach((tabId) => closeTab(tabId));
        }}
        onCloseAll={() => {
          closeAllUnpinnedTabIds(tabsRef.current).forEach((id) => closeTab(id));
        }}
        onPin={(id) => {
          setTabs((current) => {
            const next = pinTabById(current, id);
            tabsRef.current = next;
            return next;
          });
        }}
        onNewTab={openNewTab}
        onReopenClosed={reopenClosedTab}
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
            <Icon.Sidebar size={SIDEBAR_NAV_ICON_SIZE} />
          </button>
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
          <div className="menu-anchor">
            <button
              type="button"
              className={showNewMenu ? "icon-btn active" : "icon-btn"}
              title="More actions"
              onClick={() => setShowNewMenu((v) => !v)}
            >
              <Icon.More size={SIDEBAR_NAV_ICON_SIZE} />
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
          {sidebarSections.map((section) => {
            if (section === "notes") {
              return (
                <button
                  key="notes"
                  className={filter.type === "all" ? "nav-item active" : "nav-item"}
                  title="Notes"
                  onClick={() => {
                    setSidebarFlyout(null);
                    setFilter({ type: "all" });
                  }}
                >
                  <Icon.Notes size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Notes</span>
                  <span className="nav-count">{counts.notes}</span>
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
                  title="Shortcuts"
                  aria-expanded={sidebarFlyout === "shortcuts"}
                  onClick={() => {
                    openSidebarFlyout("shortcuts");
                    setFilter({ type: "shortcuts" });
                  }}
                >
                  <Icon.Shortcuts size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Shortcuts</span>
                  <span className="nav-count">{shortcutNotes.length}</span>
                </button>
              ) : null;
            }
            if (section === "reminders") {
              return prefs.show_reminders ? (
                <button
                  key="reminders"
                  className={filter.type === "reminders" ? "nav-item active" : "nav-item"}
                  title="Reminders"
                  onClick={() => {
                    setSidebarFlyout(null);
                    setFilter({ type: "reminders" });
                  }}
                >
                  <Icon.Reminder size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Reminders</span>
                  <span className="nav-count">{counts.reminders}</span>
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
                  title="Notebooks"
                  aria-expanded={sidebarFlyout === "notebooks"}
                  onClick={() => openSidebarFlyout("notebooks")}
                >
                  <Icon.Notebooks size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Notebooks</span>
                  <span className="nav-count">{notebooks.length}</span>
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
                  title="Tags"
                  aria-expanded={sidebarFlyout === "tags"}
                  onClick={() => openSidebarFlyout("tags")}
                >
                  <Icon.Tags size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Tags</span>
                  <span className="nav-count">{tags.length}</span>
                </button>
              ) : null;
            }
            if (section === "templates") {
              return prefs.show_templates ? (
                <button
                  key="templates"
                  className={filter.type === "templates" ? "nav-item active" : "nav-item"}
                  title="Templates"
                  onClick={() => {
                    setSidebarFlyout(null);
                    setFilter({ type: "templates" });
                  }}
                >
                  <Icon.Templates size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Templates</span>
                  <span className="nav-count">{counts.templates}</span>
                </button>
              ) : null;
            }
            if (section === "archived") {
              return (
                <button
                  key="archived"
                  className={filter.type === "archived" ? "nav-item active" : "nav-item"}
                  title="Archived"
                  onClick={() => {
                    setSidebarFlyout(null);
                    setFilter({ type: "archived" });
                  }}
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
                        setSidebarFlyout(null);
                        setSearchInput(search.query);
                        setFilter({ type: "search", query: search.query });
                        setSearchOpen(true);
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
                  title="Trash"
                  onClick={() => {
                    setSidebarFlyout(null);
                    setFilter({ type: "trash" });
                  }}
                >
                  <Icon.Trash size={SIDEBAR_NAV_ICON_SIZE} />
                  <span className="nav-label">Trash</span>
                  <span className="nav-count">{counts.trash}</span>
                </button>
              ) : null;
            }
            return null;
          })}
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
        <div className="panel-header">
          <div>
            <h2>{viewTitle}</h2>
            <span className="count" title="Notes in this view">
              {listCountLabel(visibleNotes.length, notes.length)}
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
              <option value="reminder">Reminder</option>
            </select>
            <button
              type="button"
              className={prefs.sort_descending ? "icon-btn active" : "icon-btn"}
              title={prefs.sort_descending ? "Newest first" : "Reverse sort"}
              onClick={() => {
                const sort_descending = !prefs.sort_descending;
                setPrefs((p) => ({ ...p, sort_descending }));
                api.updateSettings({ sort_descending }).catch(console.error);
              }}
            >
              <Icon.Sort size={14} />
            </button>
            <button
              type="button"
              className={prefs.list_density === "compact" ? "icon-btn active" : "icon-btn"}
              title={prefs.list_density === "compact" ? "Comfortable density" : "Compact density"}
              onClick={() => {
                const list_density = prefs.list_density === "compact" ? "comfortable" : "compact";
                setPrefs((p) => ({ ...p, list_density }));
                api.updateSettings({ list_density }).catch(console.error);
              }}
            >
              <Icon.Compact size={14} />
            </button>
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
                <span title={formatDate(note.updated_at, prefs.date_format)}>
                  {formatRelativeTime(note.updated_at)}
                </span>
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
          <div
            className={
              "editor-body" +
              (noteColors[activeNote.id] ? ` note-color-${noteColors[activeNote.id]}` : "")
            }
          >
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
                  <div className="note-color-swatches" role="group" aria-label="Note color">
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
                        }}
                      />
                    ))}
                  </div>
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
                  <button
                    type="button"
                    className="notebook-crumb-open"
                    title="Show notes in this notebook"
                    onClick={() => {
                      const notebook = notebooks.find((item) => item.id === activeNote.notebook_id);
                      if (!notebook) return;
                      setSidebarFlyout(null);
                      setFilter({ type: "notebook", id: notebook.id, name: notebook.name });
                    }}
                  >
                    <Icon.Notebooks size={14} />
                  </button>
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
              spellLanguage={prefs.spell_language || "en-US"}
              fontFamily={prefs.font_family}
              fontSize={prefs.font_size}
              noteWidth={prefs.note_width}
              lineHeight={editorChrome.lineHeight}
              readOnly={lockedNoteIds.includes(activeNote.id)}
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
              outlineOpen={editorChrome.outlineOpen}
              onOpenNoteLink={(id) => void loadNote(id)}
              onSelectionWords={setSelectionWords}
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
              onCreateTag={async (name) => {
                const tag = await api.createTag(name);
                await refreshMeta();
                await saveNote({ tag_ids: [...activeNote.tag_ids, tag.id] });
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
              <span className="save-state">{saveState}</span>
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
            } else if (renameTarget.kind === "note") {
              await api.updateNote(renameTarget.id, { title: name });
              if (activeNote?.id === renameTarget.id) {
                setActiveNote({ ...activeNote, title: name });
              }
              setTabs((current) =>
                current.map((tab) =>
                  tab.noteId === renameTarget.id
                    ? { ...tab, title: noteTabLabel(name, true) }
                    : tab
                )
              );
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
          mode={jumpMode}
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
          onRenameSearch={(id, name) =>
            persistSavedSearches(renameSavedSearch(savedSearches, id, name))
          }
          onClose={closeSearch}
          onSearch={runSearch}
          onSelect={(target) => {
            setSearchOpen(false);
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

      <CommandPalette
        open={showPalette}
        actions={PALETTE_ACTIONS}
        onRun={runPaletteAction}
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
