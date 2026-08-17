import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Account,
  api,
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
import { ContextMenu, ContextMenuEntry } from "./components/ContextMenu";
import { MenuBar, MenuBarGroup } from "./components/MenuBar";
import { NoteInfoPanel } from "./components/NoteInfoPanel";
import { NoteTagBar } from "./components/NoteTagBar";
import { PaneSplitter } from "./components/PaneSplitter";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { JumpToDialog } from "./components/JumpToDialog";
import { NotebookPickerDialog } from "./components/NotebookPickerDialog";
import {
  batchConfirmMessage,
  noteIdsInRange,
  pruneNoteIds,
  toggleNoteId,
} from "./noteSelection";
import { isPdfFile, titleFromFilename } from "./components/fileAttachment";
import {
  EDITOR_CHROME_KEY,
  LIST_MAX,
  LIST_MIN,
  NOTE_DRAG_TYPE,
  PANE_LAYOUT_KEY,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
  adjacentNoteId,
  clampPaneWidth,
  countWords,
  decodeNoteDrag,
  dispatchEditorCommand,
  downloadTextFile,
  emptyStateCopy,
  encodeNoteDrag,
  formatReminderLabel,
  fromDatetimeLocalValue,
  groupNotesForList,
  HIGHLIGHT_COLORS,
  isReminderOverdue,
  hasVisibleSidebarNotebooks,
  matchesSidebarFilter,
  mergeNoteBodies,
  nextZoom,
  noteAppLink,
  notebooksMatchingFilter,
  notesToEnex,
  notesToHtmlDocument,
  parseEditorChrome,
  parsePaneLayout,
  reminderFromPreset,
  resolveListView,
  safeFilename,
  snippetParts,
  TEXT_COLORS,
  toDatetimeLocalValue,
  windowTitleForNote,
  type ListView,
  type ReminderPreset,
} from "./uiChrome";

type ContextTarget =
  | { kind: "note"; x: number; y: number; note: NoteSummary }
  | { kind: "notebook"; x: number; y: number; notebook: Notebook }
  | { kind: "stack"; x: number; y: number; stack: Stack }
  | { kind: "tag"; x: number; y: number; tag: Tag }
  | { kind: "sidebar"; x: number; y: number };

type RenameTarget =
  | { kind: "notebook"; id: string; name: string }
  | { kind: "stack"; id: string; name: string }
  | { kind: "tag"; id: string; name: string };

type PendingConfirm = {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

function formatDate(iso: string, format: Preferences["date_format"]) {
  const options: Intl.DateTimeFormatOptions =
    format === "short"
      ? { month: "numeric", day: "numeric" }
      : format === "long"
        ? { weekday: "short", month: "long", day: "numeric", year: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  return new Date(iso).toLocaleDateString(undefined, options);
}

function applyTheme(theme: Preferences["theme"]) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function isBlankNote(note: Note) {
  const text = note.content_plain?.trim() || note.content.replace(/<[^>]+>/g, "").trim();
  return (!note.title || note.title === "Untitled") && text.length === 0;
}

function isTextInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

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
  const [searchInput, setSearchInput] = useState("");
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
  const [notebooksOpen, setNotebooksOpen] = useState(true);
  const [tagsOpen, setTagsOpen] = useState(true);
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
  const skipNextSave = useRef(false);
  const lastClickedNoteId = useRef<string | null>(null);
  const noteListRef = useRef<HTMLDivElement>(null);
  const dragSelectRef = useRef<{
    anchorId: string | null;
    dragging: boolean;
  }>({ anchorId: null, dragging: false });
  const skipNoteClickRef = useRef(false);

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

  const refreshNotes = useCallback(async () => {
    let list: NoteSummary[] = [];
    switch (filter.type) {
      case "all":
        list = await api.listNotes({ templates: false });
        break;
      case "notebook":
        list = await api.listNotes({ notebookId: filter.id });
        break;
      case "tag":
        list = await api.listNotes({ tagId: filter.id });
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

  const loadNote = useCallback(async (id: string) => {
    skipNextSave.current = true;
    const note = await api.getNote(id);
    setActiveNote(note);
    setSelectedNoteIds(new Set([id]));
    lastClickedNoteId.current = id;
    setShowNoteMenu(false);
  }, []);

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

  const createBlankNote = async (notebookId?: string) => {
    const nbId =
      notebookId || (filter.type === "notebook" ? filter.id : defaultNotebook?.id);
    if (!nbId) return;
    const note = await api.createNote(nbId);
    await refreshNotes();
    await loadNote(note.id);
  };

  const createNote = async () => {
    setShowNewMenu(false);
    if (prefs.new_note_behavior === "ask") {
      setShowGallery(true);
      return;
    }
    await createBlankNote();
  };

  const useTemplate = async (templateId: string, notebookId?: string) => {
    const nbId =
      notebookId ||
      (filter.type === "notebook" ? filter.id : defaultNotebook?.id);
    const note = await api.useTemplate(templateId, nbId);
    setShowGallery(false);
    await refreshNotes();
    await loadNote(note.id);
  };

  const confirm = (
    message: string,
    options?: { confirmLabel?: string; danger?: boolean; always?: boolean }
  ) => {
    if (!prefs.confirm_delete && !options?.always) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      setPendingConfirm({
        message,
        confirmLabel: options?.confirmLabel,
        danger: options?.danger,
        resolve,
      });
    });
  };

  const selectedNotes = useMemo(
    () => notes.filter((note) => selectedNoteIds.has(note.id)),
    [notes, selectedNoteIds]
  );

  const targetNoteIds = () => {
    if (selectedNoteIds.size > 0) return [...selectedNoteIds];
    return activeNote ? [activeNote.id] : [];
  };

  const applyToNotes = async (
    ids: string[],
    action: (id: string) => Promise<unknown>,
    options?: {
      closeActive?: boolean;
      clearSelection?: boolean;
      refreshMeta?: boolean;
    }
  ) => {
    try {
      for (const id of ids) {
        await action(id);
      }
    } finally {
      if (options?.closeActive && activeNote && ids.includes(activeNote.id)) {
        setActiveNote(null);
      }
      if (options?.clearSelection) {
        setSelectedNoteIds(new Set());
        lastClickedNoteId.current = null;
      }
      await refreshNotes();
      if (options?.refreshMeta) await refreshMeta();
    }
  };

  const deleteSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    const inTrash = filter.type === "trash";
    const first = notes.find((note) => note.id === ids[0]);
    const title = first?.title || "Untitled";
    if (inTrash) {
      if (
        !(await confirm(batchConfirmMessage("permanent", ids.length, title), {
          confirmLabel: "Delete",
          danger: true,
        }))
      ) {
        return;
      }
      await applyToNotes(ids, (id) => api.permanentlyDeleteNote(id), {
        closeActive: true,
        clearSelection: true,
      });
      return;
    }
    if (
      !(await confirm(batchConfirmMessage("trash", ids.length, title), {
        confirmLabel: "Move to Trash",
        danger: true,
      }))
    ) {
      return;
    }
    await applyToNotes(ids, (id) => api.deleteNote(id), {
      closeActive: true,
      clearSelection: true,
    });
  };

  const restoreSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, (id) => api.restoreNote(id), {
      closeActive: true,
      clearSelection: true,
    });
  };

  const moveSelectedNotes = async (notebookId: string) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, async (id) => {
      const updated = await api.updateNote(id, { notebook_id: notebookId });
      if (activeNote?.id === id) setActiveNote(updated);
    });
    setNotebookPicker(null);
  };

  const pinSelectedNotes = async (pinned: boolean) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, async (id) => {
      const updated = await api.updateNote(id, { is_pinned: pinned });
      if (activeNote?.id === id) setActiveNote(updated);
    });
  };

  const archiveSelectedNotes = async (archived: boolean) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, async (id) => {
      const updated = await api.updateNote(id, { is_archived: archived });
      if (activeNote?.id === id) setActiveNote(updated);
    });
  };

  const shortcutSelectedNotes = async (add: boolean) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(
      ids,
      (id) => (add ? api.addShortcut(id) : api.removeShortcut(id)),
      { refreshMeta: true }
    );
  };

  const duplicateSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    let lastId: string | null = null;
    for (const id of ids) {
      const source = await api.getNote(id);
      const duplicate = await api.createNote(source.notebook_id, {
        title: `${source.title || "Untitled"} copy`,
        content: source.content,
        tag_ids: source.tag_ids,
        is_template: source.is_template,
        template_category: source.template_category || undefined,
      });
      lastId = duplicate.id;
    }
    await refreshNotes();
    if (lastId) await loadNote(lastId);
  };

  const copySelectedNotes = async (notebookId: string) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    let lastId: string | null = null;
    for (const id of ids) {
      const source = await api.getNote(id);
      const copy = await api.createNote(notebookId, {
        title: source.title,
        content: source.content,
        tag_ids: source.tag_ids,
        is_template: source.is_template,
        template_category: source.template_category || undefined,
      });
      lastId = copy.id;
    }
    setNotebookPicker(null);
    await refreshNotes();
    await refreshMeta();
    if (lastId) await loadNote(lastId);
  };

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

  const mergeSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length < 2) return;
    const first = notes.find((note) => note.id === ids[0]);
    const title = first?.title || "Untitled";
    if (
      !(await confirm(
        `Merge ${ids.length} notes into “${title}”? The other notes will move to Trash.`,
        { confirmLabel: "Merge", danger: true, always: true }
      ))
    ) {
      return;
    }
    const full: Note[] = [];
    for (const id of ids) {
      full.push(await api.getNote(id));
    }
    const [keep, ...rest] = full;
    if (!keep) return;
    const content = mergeNoteBodies(full);
    const tagIds = [...new Set(full.flatMap((note) => note.tag_ids))];
    await api.updateNote(keep.id, { content, tag_ids: tagIds });
    for (const note of rest) {
      await api.deleteNote(note.id);
    }
    setActiveNote(null);
    setSelectedNoteIds(new Set([keep.id]));
    lastClickedNoteId.current = keep.id;
    await refreshNotes();
    await refreshMeta();
    await loadNote(keep.id);
  };

  const exportSelectedNotes = async (format: "html" | "enex") => {
    const ids = targetNoteIds();
    if (!ids.length) return;
    const full: Note[] = [];
    for (const id of ids) {
      full.push(await api.getNote(id));
    }
    if (format === "html") {
      if (full.length === 1) {
        downloadTextFile(
          `${safeFilename(full[0].title)}.html`,
          notesToHtmlDocument(full[0].title, full[0].content),
          "text/html"
        );
        return;
      }
      const html = full
        .map((note) => notesToHtmlDocument(note.title, note.content))
        .join("\n");
      downloadTextFile("notes.html", html, "text/html");
      return;
    }
    downloadTextFile(
      full.length === 1 ? `${safeFilename(full[0].title)}.enex` : "notes.enex",
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

  const groupedNotes = useMemo(
    () =>
      groupNotesForList(
        notes,
        prefs.sort_by === "title"
          ? "title"
          : prefs.sort_by === "created"
            ? "created"
            : "updated"
      ),
    [notes, prefs.sort_by]
  );

  const visibleTags = useMemo(
    () => tags.filter((tag) => matchesSidebarFilter(tag.name, sidebarFilter)),
    [tags, sidebarFilter]
  );

  useEffect(() => {
    document.title = windowTitleForNote(activeNote ? activeNote.title : null);
  }, [activeNote]);

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
        searchRef.current?.focus();
      } else if (meta && e.key === "f") {
        e.preventDefault();
        if (activeNote) setFindTick((tick) => tick + 1);
        else searchRef.current?.focus();
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
      } else if (e.key === "Escape" && focusMode) {
        e.preventDefault();
        setFocusMode(false);
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
        notes.length > 0
      ) {
        e.preventDefault();
        const current =
          lastClickedNoteId.current ||
          (selectedNoteIds.size === 1 ? [...selectedNoteIds][0] : null);
        const nextId = adjacentNoteId(
          notes,
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
        setFilter({ type: "templates" });
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

  const contextMenuItems = (target: ContextTarget): ContextMenuEntry[] => {
    if (target.kind === "sidebar") {
      return [
        {
          label: "New note",
          shortcut: "Ctrl/⌘ N",
          onSelect: () => void createNote(),
        },
        {
          label: "New notebook…",
          onSelect: () => {
            setNewNotebookStackId(null);
            setNewName("");
            setShowNewNotebook(true);
          },
        },
        {
          label: "New stack…",
          onSelect: openNewStack,
        },
        {
          label: "New tag…",
          onSelect: () => {
            setNewName("");
            setShowNewTag(true);
          },
        },
        { type: "separator" },
        {
          label: "Settings…",
          shortcut: "Ctrl/⌘ ,",
          onSelect: () => openSettings(),
        },
      ];
    }

    if (target.kind === "note") {
      const targets =
        selectedNoteIds.size > 1 && selectedNoteIds.has(target.note.id)
          ? selectedNotes
          : [target.note];
      const ids = targets.map((note) => note.id);
      const count = targets.length;
      const inTrash = filter.type === "trash";
      const allShortcuts = targets.every((note) => shortcutIds.has(note.id));
      const allPinned = targets.every((note) => note.is_pinned);
      const allArchived = targets.every((note) => note.is_archived);
      const allTemplates = targets.every((note) => note.is_template);

      if (inTrash) {
        return [
          {
            label: count > 1 ? `Restore ${count} notes` : "Restore note",
            onSelect: () => void restoreSelectedNotes(),
          },
          { type: "separator" },
          {
            label: count > 1 ? `Delete ${count} notes permanently` : "Delete permanently",
            danger: true,
            shortcut: "Delete",
            onSelect: () => void deleteSelectedNotes(),
          },
        ];
      }

      return [
        ...(count === 1
          ? [{ label: "Open note", onSelect: () => void loadNote(targets[0].id) }]
          : []),
        {
          label: allShortcuts
            ? count > 1
              ? `Remove ${count} from shortcuts`
              : "Remove from shortcuts"
            : count > 1
              ? `Add ${count} to shortcuts`
              : "Add to shortcuts",
          onSelect: () => void shortcutSelectedNotes(!allShortcuts),
        },
        {
          label: allPinned
            ? count > 1
              ? `Unpin ${count} notes`
              : "Unpin from top"
            : count > 1
              ? `Pin ${count} notes`
              : "Pin to top",
          onSelect: () => void pinSelectedNotes(!allPinned),
        },
        {
          label: "Move to notebook…",
          onSelect: () => setNotebookPicker("move"),
        },
        {
          label: count > 1 ? `Duplicate ${count} notes` : "Duplicate note",
          onSelect: () => void duplicateSelectedNotes(),
        },
        {
          label: "Copy to notebook…",
          onSelect: () => setNotebookPicker("copy"),
        },
        ...(count > 1
          ? [
              {
                label: `Merge ${count} notes`,
                onSelect: () => void mergeSelectedNotes(),
              },
            ]
          : []),
        {
          label: count > 1 ? "Export notes as HTML" : "Export as HTML",
          onSelect: () => void exportSelectedNotes("html"),
        },
        {
          label: count > 1 ? "Export notes as Evernote XML" : "Export as Evernote XML",
          onSelect: () => void exportSelectedNotes("enex"),
        },
        ...(count === 1
          ? [
              {
                label: "Copy note link",
                onSelect: () =>
                  void navigator.clipboard.writeText(noteAppLink(targets[0].id)),
              },
              {
                label: "Note info",
                onSelect: () => {
                  void loadNote(targets[0].id);
                  setShowInfo(true);
                },
              },
            ]
          : []),
        { type: "separator" },
        ...(count === 1
          ? [
              {
                label: allTemplates ? "Convert to note" : "Save as template",
                onSelect: async () => {
                  await updateNoteById(ids[0], {
                    is_template: !allTemplates,
                    template_category: allTemplates ? null : "My templates",
                  });
                  await refreshMeta();
                },
              },
            ]
          : []),
        {
          label: allArchived
            ? count > 1
              ? `Unarchive ${count} notes`
              : "Unarchive note"
            : count > 1
              ? `Archive ${count} notes`
              : "Archive note",
          onSelect: () => void archiveSelectedNotes(!allArchived),
        },
        { type: "separator" },
        {
          label: count > 1 ? `Move ${count} notes to trash` : "Move to trash",
          danger: true,
          shortcut: "Delete",
          onSelect: () => void deleteSelectedNotes(),
        },
      ];
    }

    if (target.kind === "notebook") {
      const { notebook } = target;
      return [
        {
          label: "New note in this notebook",
          onSelect: () => void createBlankNote(notebook.id),
        },
        {
          label: "Rename notebook…",
          onSelect: () =>
            openRename({
              kind: "notebook",
              id: notebook.id,
              name: notebook.name,
            }),
        },
        {
          label: "Set as default notebook",
          checked: notebook.is_default,
          disabled: notebook.is_default,
          onSelect: async () => {
            await api.updateNotebook(notebook.id, { is_default: true });
            const next = await api.updateSettings({
              default_notebook_id: notebook.id,
            });
            setPrefs({ ...defaultPreferences, ...next });
            await refreshMeta();
          },
        },
        {
          label: "Move to stack",
          children: [
            {
              label: "No stack",
              checked: notebook.stack_id === null,
              disabled: notebook.stack_id === null,
              onSelect: () =>
                void api
                  .updateNotebook(notebook.id, { stack_id: null })
                  .then(refreshMeta),
            },
            { type: "separator" },
            ...stacks.map((stack) => ({
              label: stack.name,
              checked: notebook.stack_id === stack.id,
              disabled: notebook.stack_id === stack.id,
              onSelect: () =>
                void api
                  .updateNotebook(notebook.id, { stack_id: stack.id })
                  .then(refreshMeta),
            })),
          ],
        },
        { type: "separator" },
        {
          label: "Delete notebook",
          danger: true,
          disabled: notebook.is_default,
          onSelect: async () => {
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
        },
      ];
    }

    if (target.kind === "stack") {
      const { stack } = target;
      return [
        {
          label: "New notebook in this stack…",
          onSelect: () => {
            setNewNotebookStackId(stack.id);
            setNewName("");
            setShowNewNotebook(true);
          },
        },
        {
          label: "Rename stack…",
          onSelect: () =>
            openRename({ kind: "stack", id: stack.id, name: stack.name }),
        },
        { type: "separator" },
        {
          label: "Delete stack",
          danger: true,
          onSelect: async () => {
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
        },
      ];
    }

    const { tag } = target;
    return [
      {
        label: "Show notes with this tag",
        onSelect: () => setFilter({ type: "tag", id: tag.id, name: tag.name }),
      },
      {
        label: "Rename tag…",
        onSelect: () =>
          openRename({ kind: "tag", id: tag.id, name: tag.name }),
      },
      { type: "separator" },
      {
        label: "Delete tag",
        danger: true,
        onSelect: async () => {
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
      },
    ];
  };

  const runEditorCommand = (
    command: Parameters<typeof dispatchEditorCommand>[0]
  ) => {
    dispatchEditorCommand(command);
  };

  const menuGroups: MenuBarGroup[] = [
    {
      label: "File",
      items: [
        { label: "New Note", shortcut: "Ctrl/⌘ N", onSelect: () => void createNote() },
        {
          label: "New Note from Template…",
          shortcut: "Ctrl/⌘ ⇧ N",
          onSelect: () => setShowGallery(true),
        },
        {
          label: "New Notebook…",
          onSelect: () => {
            setNewNotebookStackId(null);
            setNewName("");
            setShowNewNotebook(true);
          },
        },
        {
          label: "New Stack…",
          onSelect: openNewStack,
        },
        { type: "separator" },
        {
          label: "Import Notes…",
          onSelect: () => importRef.current?.click(),
        },
        {
          label: "Export as HTML…",
          disabled: targetNoteIds().length === 0,
          onSelect: () => void exportSelectedNotes("html"),
        },
        {
          label: "Export as Evernote XML…",
          disabled: targetNoteIds().length === 0,
          onSelect: () => void exportSelectedNotes("enex"),
        },
        {
          label: "Print…",
          shortcut: "Ctrl/⌘ P",
          disabled: !activeNote,
          onSelect: printActiveNote,
        },
        {
          label: "Copy Note Link",
          disabled: !activeNote,
          onSelect: () => void copyActiveNoteLink(),
        },
        { type: "separator" },
        {
          label: "Settings…",
          shortcut: "Ctrl/⌘ ,",
          onSelect: () => openSettings(),
        },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: "Ctrl/⌘ Z", onSelect: () => runEditorCommand({ type: "undo" }) },
        {
          label: "Redo",
          shortcut: "Ctrl/⌘ ⇧ Z",
          onSelect: () => runEditorCommand({ type: "redo" }),
        },
        { type: "separator" },
        { label: "Cut", shortcut: "Ctrl/⌘ X", onSelect: () => runEditorCommand({ type: "cut" }) },
        { label: "Copy", shortcut: "Ctrl/⌘ C", onSelect: () => runEditorCommand({ type: "copy" }) },
        { label: "Paste", shortcut: "Ctrl/⌘ V", onSelect: () => runEditorCommand({ type: "paste" }) },
        { type: "separator" },
        {
          label: "Select All",
          shortcut: "Ctrl/⌘ A",
          onSelect: () => {
            if (isTextInputFocused()) {
              runEditorCommand({ type: "selectAll" });
              return;
            }
            setSelectedNoteIds(new Set(notes.map((n) => n.id)));
          },
        },
        {
          label: "Find…",
          shortcut: "Ctrl/⌘ F",
          disabled: !activeNote,
          onSelect: () => setFindTick((tick) => tick + 1),
        },
        {
          label: "Find and Replace…",
          shortcut: "Ctrl/⌘ H",
          disabled: !activeNote,
          onSelect: () => setReplaceTick((tick) => tick + 1),
        },
      ],
    },
    {
      label: "View",
      items: [
        { label: "All Notes", onSelect: () => setFilter({ type: "all" }) },
        { label: "Shortcuts", onSelect: () => setFilter({ type: "shortcuts" }) },
        { label: "Reminders", onSelect: () => setFilter({ type: "reminders" }) },
        { label: "Templates", onSelect: () => setFilter({ type: "templates" }) },
        { type: "separator" },
        {
          label: paneLayout.sidebarCollapsed ? "Show Sidebar" : "Hide Sidebar",
          onSelect: () =>
            persistPaneLayout({
              ...paneLayout,
              sidebarCollapsed: !paneLayout.sidebarCollapsed,
            }),
        },
        {
          label: paneLayout.listCollapsed ? "Show Note List" : "Hide Note List",
          onSelect: () =>
            persistPaneLayout({
              ...paneLayout,
              listCollapsed: !paneLayout.listCollapsed,
            }),
        },
        {
          label: editorChrome.toolbarHidden
            ? "Show Formatting Toolbar"
            : "Hide Formatting Toolbar",
          disabled: !activeNote,
          onSelect: () =>
            persistEditorChrome({
              ...editorChrome,
              toolbarHidden: !editorChrome.toolbarHidden,
            }),
        },
        {
          label: showInfo ? "Hide Note Info" : "Show Note Info",
          disabled: !activeNote,
          shortcut: "Ctrl/⌘ ⇧ I",
          onSelect: () => setShowInfo((open) => !open),
        },
        {
          label: focusMode ? "Exit Focus Mode" : "Enter Focus Mode",
          shortcut: "F11",
          onSelect: () => setFocusMode((open) => !open),
        },
        { type: "separator" },
        {
          label: "Jump to…",
          shortcut: "Ctrl/⌘ J",
          onSelect: () => setShowJump(true),
        },
        {
          label: "Snippets View",
          onSelect: () => setListView("snippets"),
        },
        {
          label: "Titles View",
          onSelect: () => setListView("titles"),
        },
        {
          label: "Cards View",
          onSelect: () => setListView("cards"),
        },
        { type: "separator" },
        {
          label: "Zoom In",
          shortcut: "Ctrl/⌘ +",
          disabled: !activeNote,
          onSelect: () =>
            persistEditorChrome({
              ...editorChrome,
              zoom: nextZoom(editorChrome.zoom, 1),
            }),
        },
        {
          label: "Zoom Out",
          shortcut: "Ctrl/⌘ -",
          disabled: !activeNote,
          onSelect: () =>
            persistEditorChrome({
              ...editorChrome,
              zoom: nextZoom(editorChrome.zoom, -1),
            }),
        },
        {
          label: "Actual Size",
          shortcut: "Ctrl/⌘ 0",
          disabled: !activeNote || editorChrome.zoom === 100,
          onSelect: () =>
            persistEditorChrome({
              ...editorChrome,
              zoom: nextZoom(editorChrome.zoom, 0),
            }),
        },
        { type: "separator" },
        {
          label: prefs.theme === "dark" ? "Use Light Theme" : "Use Dark Theme",
          onSelect: () => {
            const theme = prefs.theme === "dark" ? "light" : "dark";
            setPrefs((current) => ({ ...current, theme }));
            void api.updateSettings({ theme });
          },
        },
      ],
    },
    {
      label: "Note",
      items: [
        {
          label:
            selectedNoteIds.size > 1
              ? allSelectedPinned
                ? `Unpin ${selectedNoteIds.size} Notes`
                : `Pin ${selectedNoteIds.size} Notes`
              : activeNote?.is_pinned
                ? "Unpin Note"
                : "Pin Note",
          disabled: targetNoteIds().length === 0,
          onSelect: () => {
            void pinSelectedNotes(
              selectedNoteIds.size > 1 ? !allSelectedPinned : !activeNote?.is_pinned
            );
          },
        },
        {
          label:
            selectedNoteIds.size > 1
              ? allSelectedShortcuts
                ? `Remove ${selectedNoteIds.size} from Shortcuts`
                : `Add ${selectedNoteIds.size} to Shortcuts`
              : isShortcut
                ? "Remove from Shortcuts"
                : "Add to Shortcuts",
          disabled: targetNoteIds().length === 0,
          onSelect: () => void shortcutSelectedNotes(
              selectedNoteIds.size > 1 ? !allSelectedShortcuts : !isShortcut
            ),
        },
        {
          label: "Note Info",
          shortcut: "Ctrl/⌘ ⇧ I",
          disabled: !activeNote,
          onSelect: () => setShowInfo(true),
        },
        {
          label: "Find in Note",
          shortcut: "Ctrl/⌘ F",
          disabled: !activeNote,
          onSelect: () => setFindTick((tick) => tick + 1),
        },
        {
          label: "Move to Notebook…",
          disabled: targetNoteIds().length === 0 || filter.type === "trash",
          onSelect: () => setNotebookPicker("move"),
        },
        {
          label: "Copy to Notebook…",
          disabled: targetNoteIds().length === 0 || filter.type === "trash",
          onSelect: () => setNotebookPicker("copy"),
        },
        {
          label: "Set Reminder",
          disabled: !activeNote,
          onSelect: () => setShowReminderMenu(true),
        },
        {
          label: `Merge ${selectedNoteIds.size} Notes`,
          disabled: selectedNoteIds.size < 2,
          onSelect: () => void mergeSelectedNotes(),
        },
        {
          label:
            selectedNoteIds.size > 1
              ? allSelectedArchived
                ? `Unarchive ${selectedNoteIds.size} Notes`
                : `Archive ${selectedNoteIds.size} Notes`
              : activeNote?.is_archived
                ? "Unarchive Note"
                : "Archive Note",
          disabled: targetNoteIds().length === 0,
          onSelect: () => {
            void archiveSelectedNotes(
              selectedNoteIds.size > 1
                ? !allSelectedArchived
                : !activeNote?.is_archived
            );
          },
        },
        { type: "separator" },
        ...(filter.type === "trash"
          ? [
              {
                label:
                  selectedNoteIds.size > 1
                    ? `Restore ${selectedNoteIds.size} Notes`
                    : "Restore Note",
                disabled: targetNoteIds().length === 0,
                onSelect: () => void restoreSelectedNotes(),
              },
              {
                label:
                  selectedNoteIds.size > 1
                    ? `Delete ${selectedNoteIds.size} Notes Permanently`
                    : "Delete Note Permanently",
                disabled: targetNoteIds().length === 0,
                onSelect: () => void deleteSelectedNotes(),
              },
            ]
          : [
              {
                label:
                  selectedNoteIds.size > 1
                    ? `Move ${selectedNoteIds.size} Notes to Trash`
                    : "Move Note to Trash",
                disabled: targetNoteIds().length === 0,
                onSelect: () => void deleteSelectedNotes(),
              },
            ]),
      ],
    },
    {
      label: "Format",
      items: [
        {
          label: "Heading 1",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "heading", level: 1 }),
        },
        {
          label: "Heading 2",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "heading", level: 2 }),
        },
        {
          label: "Heading 3",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "heading", level: 3 }),
        },
        { type: "separator" },
        {
          label: "Bold",
          shortcut: "Ctrl/⌘ B",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "bold" }),
        },
        {
          label: "Italic",
          shortcut: "Ctrl/⌘ I",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "italic" }),
        },
        {
          label: "Underline",
          shortcut: "Ctrl/⌘ U",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "underline" }),
        },
        {
          label: "Strikethrough",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "strike" }),
        },
        { type: "separator" },
        ...HIGHLIGHT_COLORS.map((swatch) => ({
          label: `Highlight ${swatch.label}`,
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "highlight", color: swatch.color }),
        })),
        { type: "separator" },
        ...TEXT_COLORS.filter((swatch) => swatch.color).map((swatch) => ({
          label: `Text ${swatch.label}`,
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "color", color: swatch.color }),
        })),
        {
          label: "Remove Text Color",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "color" }),
        },
        { type: "separator" },
        {
          label: "Align Left",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "align", align: "left" }),
        },
        {
          label: "Align Center",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "align", align: "center" }),
        },
        {
          label: "Align Right",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "align", align: "right" }),
        },
        {
          label: "Justify",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "align", align: "justify" }),
        },
        {
          label: "Increase Indent",
          shortcut: "Tab",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "indent" }),
        },
        {
          label: "Decrease Indent",
          shortcut: "⇧ Tab",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "outdent" }),
        },
        { type: "separator" },
        {
          label: "Insert Table",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "insertTable" }),
        },
        {
          label: "Insert Link…",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "openLinkDialog" }),
        },
        { type: "separator" },
        {
          label: "Bulleted List",
          shortcut: "Ctrl/⌘ ⇧ L",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "bulletList" }),
        },
        {
          label: "Numbered List",
          shortcut: "Ctrl/⌘ ⇧ O",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "orderedList" }),
        },
        {
          label: "Checklist",
          shortcut: "Ctrl/⌘ ⇧ C",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "taskList" }),
        },
        {
          label: "Insert Checkbox",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "inlineCheckbox" }),
        },
        { type: "separator" },
        {
          label: "Quote",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "blockquote" }),
        },
        {
          label: "Code Block",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "codeBlock" }),
        },
        {
          label: "Inline Code",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "inlineCode" }),
        },
        {
          label: "Horizontal Rule",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "horizontalRule" }),
        },
        {
          label: "Insert Date and Time",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "insertDate" }),
        },
        { type: "separator" },
        {
          label: "Remove Formatting",
          disabled: !activeNote,
          onSelect: () => runEditorCommand({ type: "clear" }),
        },
      ],
    },
    {
      label: "Tools",
      items: [
        {
          label: "Import from Evernote…",
          onSelect: () => importRef.current?.click(),
        },
        {
          label: "Restore Built-in Templates",
          onSelect: () => void api.restoreTemplates().then(refreshMeta),
        },
      ],
    },
    {
      label: "Help",
      items: [
        {
          label: "Keyboard Shortcuts",
          shortcut: "Ctrl/⌘ /",
          onSelect: () => openSettings("shortcuts"),
        },
        {
          label: "About Notebook",
          onSelect: () => openSettings("about"),
        },
      ],
    },
  ];

  return (
    <div
      className={
        "app-shell" +
        (paneLayout.sidebarCollapsed ? " sidebar-collapsed" : "") +
        (paneLayout.listCollapsed ? " list-collapsed" : "") +
        (focusMode ? " focus-mode" : "") +
        (showInfo && activeNote ? " info-open" : "")
      }
      style={
        {
          "--sidebar-width": paneLayout.sidebarCollapsed
            ? "0px"
            : `${paneLayout.sidebarWidth}px`,
          "--list-width": `${paneLayout.listWidth}px`,
        } as CSSProperties
      }
      onMouseDown={() => {
        setShowNewMenu(false);
        setShowNoteMenu(false);
        setShowReminderMenu(false);
        setContextMenu(null);
      }}
    >
      <MenuBar groups={menuGroups} />
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
        <div className="new-note-wrap" onMouseDown={(e) => e.stopPropagation()}>
          <button className="new-note-btn" onClick={createNote}>
            <Icon.Plus size={16} />
            New note
          </button>
          <button
            className="new-note-more"
            title="More"
            onClick={() => setShowNewMenu((v) => !v)}
          >
            <Icon.Chevron size={16} />
          </button>
          {showNewMenu && (
            <div className="menu-popover">
              <button
                onClick={() => {
                  setShowNewMenu(false);
                  createBlankNote();
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
            </div>
          )}
        </div>

        <div className="sidebar-search">
          <Icon.Search size={15} />
          <input
            ref={searchRef}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchInput.trim()) {
                setFilter({ type: "search", query: searchInput.trim() });
              }
            }}
            placeholder="Search"
          />
        </div>
        <div className="sidebar-search sidebar-filter">
          <Icon.Notebooks size={15} />
          <input
            value={sidebarFilter}
            onChange={(e) => setSidebarFilter(e.target.value)}
            placeholder="Filter notebooks & tags"
            aria-label="Filter notebooks and tags"
          />
          {sidebarFilter && (
            <button
              type="button"
              className="icon-btn"
              title="Clear filter"
              onClick={() => setSidebarFilter("")}
            >
              <Icon.Close size={14} />
            </button>
          )}
        </div>

        <nav className="sidebar-nav scroll-pane">
          <button
            className={filter.type === "all" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter({ type: "all" })}
          >
            <Icon.Notes size={16} />
            Notes
            <span className="nav-count">{counts.notes}</span>
          </button>
          {prefs.show_shortcuts && (
            <button
              className={filter.type === "shortcuts" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "shortcuts" })}
            >
              <Icon.Shortcuts size={16} />
              Shortcuts
              <span className="nav-count">{counts.shortcuts}</span>
            </button>
          )}
          {prefs.show_reminders && (
            <button
              className={filter.type === "reminders" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "reminders" })}
            >
              <Icon.Reminder size={16} />
              Reminders
              <span className="nav-count">{counts.reminders}</span>
            </button>
          )}

          {prefs.show_notebooks && (
            <div className="nav-section">
              <button
                className="nav-section-title"
                onClick={() => setNotebooksOpen((v) => !v)}
              >
                <span>
                  <Icon.Notebooks size={14} />
                  Notebooks
                </span>
                <span className="section-actions">
                  <span
                    className="plus"
                    onClick={(e) => {
                      e.stopPropagation();
                      setNewNotebookStackId(null);
                      setShowNewNotebook(true);
                    }}
                  >
                    +
                  </span>
                  <Icon.Chevron
                    size={14}
                    style={{
                      transform:
                        notebooksOpen || sidebarFilter.trim()
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
                    }}
                  />
                </span>
              </button>
              { (notebooksOpen || Boolean(sidebarFilter.trim())) && (
                <>
                  {stacks.map((stack) => {
                    const stacked = notebooksMatchingFilter(
                      notebooksByStack[stack.id] || [],
                      stack.name,
                      sidebarFilter
                    );
                    if (!stacked.length) return null;
                    return (
                    <div key={stack.id} className="stack-group">
                      <button
                        className="stack-name"
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
                        {stack.name}
                      </button>
                      {stacked.map((nb) => (
                        <NotebookNavItem
                          key={nb.id}
                          notebook={nb}
                          active={filter.type === "notebook" && filter.id === nb.id}
                          isDropTarget={dropTarget === `notebook:${nb.id}`}
                          onSelect={() =>
                            setFilter({ type: "notebook", id: nb.id, name: nb.name })
                          }
                          onDragOver={(event) => allowNoteDrop(event, `notebook:${nb.id}`)}
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
                      onDragOver={(event) => allowNoteDrop(event, `notebook:${nb.id}`)}
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
            </div>
          )}

          {prefs.show_tags && (
            <div className="nav-section">
              <button
                className="nav-section-title"
                onClick={() => setTagsOpen((v) => !v)}
              >
                <span>
                  <Icon.Tags size={14} />
                  Tags
                </span>
                <span className="section-actions">
                  <span
                    className="plus"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowNewTag(true);
                    }}
                  >
                    +
                  </span>
                  <Icon.Chevron
                    size={14}
                    style={{
                      transform:
                        tagsOpen || sidebarFilter.trim()
                          ? "rotate(0deg)"
                          : "rotate(-90deg)",
                    }}
                  />
                </span>
              </button>
              {(tagsOpen || Boolean(sidebarFilter.trim())) &&
                visibleTags.map((tag) => (
                  <button
                    key={tag.id}
                    className={
                      (filter.type === "tag" && filter.id === tag.id
                        ? "nav-item active indent"
                        : "nav-item indent") +
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
                    #{tag.name}
                    <span className="nav-count">{tag.note_count ?? 0}</span>
                  </button>
                ))}
              {sidebarFilter.trim() && tagsOpen !== false && visibleTags.length === 0 && (
                <div className="empty-state compact">No matching tags</div>
              )}
            </div>
          )}

          {prefs.show_templates && (
            <button
              className={filter.type === "templates" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "templates" })}
            >
              <Icon.Templates size={16} />
              Templates
              <span className="nav-count">{counts.templates}</span>
            </button>
          )}

          {prefs.show_trash && (
            <button
              className={filter.type === "trash" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "trash" })}
            >
              <Icon.Trash size={16} />
              Trash
              <span className="nav-count">{counts.trash}</span>
            </button>
          )}

          {prefs.show_import && (
            <div className="nav-section">
              <div className="nav-section-title static">
                <span>
                  <Icon.Import size={14} />
                  Import
                </span>
              </div>
              <button
                className="nav-item indent"
                onClick={() => importRef.current?.click()}
              >
                Evernote (.enex)
              </button>
              {importStatus && <div className="import-status">{importStatus}</div>}
            </div>
          )}
        </nav>
        <div className="sidebar-account">
          <button
            type="button"
            className="account-chip"
            onClick={() => openSettings("account")}
            title="Account"
          >
            <span className="avatar">{account.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="account-copy">
              <span className="account-name">{account.display_name}</span>
              <span className="account-email">{account.email || "Local account"}</span>
            </span>
          </button>
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
        label="Resize sidebar"
        onDrag={(delta) =>
          persistPaneLayout({
            ...paneLayout,
            sidebarCollapsed: false,
            sidebarWidth: clampPaneWidth(
              (paneLayout.sidebarCollapsed ? SIDEBAR_MIN : paneLayout.sidebarWidth) + delta,
              SIDEBAR_MIN,
              SIDEBAR_MAX
            ),
          })
        }
      />

      <section className="note-list-panel">
        <div className="panel-header">
          <div>
            <h2>{viewTitle}</h2>
            <span className="count">{notes.length}</span>
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
                {note.reminder_at && <Icon.Reminder size={13} />}
                {note.attachment_count > 0 && <Icon.Attach size={13} />}
                {note.title || "Untitled"}
              </div>
              <div className="note-card-meta">
                {note.reminder_at
                  ? formatReminderLabel(note.reminder_at, prefs.date_format)
                  : formatDate(note.updated_at, prefs.date_format)}
                {note.notebook_name ? ` · ${note.notebook_name}` : ""}
              </div>
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

function PromptModal({
  title,
  submitLabel = "Create",
  value,
  onChange,
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel?: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && value && onSubmit()}
        />
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="primary-btn" disabled={!value.trim()} onClick={onSubmit}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function NotebookNavItem({
  notebook,
  active,
  isDropTarget,
  onSelect,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}: {
  notebook: Notebook;
  active: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  return (
    <button
      className={
        (active ? "nav-item active indent" : "nav-item indent") +
        (isDropTarget ? " drop-target" : "")
      }
      onClick={onSelect}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <span className="nav-item-text">
        {notebook.name}
        {notebook.is_default ? (
          <span className="default-notebook-star" title="Default notebook">
            <Icon.Shortcuts size={11} />
          </span>
        ) : null}
      </span>
      <span className="nav-count">{notebook.note_count ?? 0}</span>
    </button>
  );
}

function EmptyListState({
  filter,
  onCreate,
  onBrowseTemplates,
}: {
  filter: ViewFilter;
  onCreate: () => void;
  onBrowseTemplates: () => void;
}) {
  const copy = emptyStateCopy(
    filter.type,
    filter.type === "notebook" || filter.type === "tag"
      ? filter.name
      : filter.type === "search"
        ? filter.query
        : ""
  );
  const icon =
    filter.type === "trash" ? (
      <Icon.Trash size={36} />
    ) : filter.type === "shortcuts" ? (
      <Icon.Shortcuts size={36} />
    ) : filter.type === "reminders" ? (
      <Icon.Reminder size={36} />
    ) : filter.type === "templates" ? (
      <Icon.Templates size={36} />
    ) : filter.type === "tag" ? (
      <Icon.Tags size={36} />
    ) : filter.type === "search" ? (
      <Icon.Search size={36} />
    ) : (
      <Icon.Notes size={36} />
    );
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden>
        {icon}
      </div>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      {filter.type === "templates" ? (
        <div className="empty-actions">
          <button type="button" className="primary-btn" onClick={onBrowseTemplates}>
            Open gallery
          </button>
        </div>
      ) : filter.type !== "trash" && filter.type !== "search" ? (
        <div className="empty-actions">
          <button type="button" className="primary-btn" onClick={onCreate}>
            New note
          </button>
        </div>
      ) : null}
    </div>
  );
}
