import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Account,
  api,
  defaultPreferences,
  Note,
  NoteSummary,
  Notebook,
  Preferences,
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
import {
  batchConfirmMessage,
  noteIdsInRange,
  pruneNoteIds,
  toggleNoteId,
} from "./noteSelection";
import { isPdfFile, titleFromFilename } from "./components/fileAttachment";

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
  const [showNewTag, setShowNewTag] = useState(false);
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
    const [nb, st, tg, sc, tm] = await Promise.all([
      api.listNotebooks(),
      api.listStacks(),
      api.listTags(),
      api.listShortcuts(),
      api.listNotes({ templates: true }),
    ]);
    setNotebooks(nb);
    setStacks(st);
    setTags(tg);
    setShortcutIds(new Set(sc.map((n) => n.id)));
    setTemplates(tm);
  }, []);

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

  const confirm = (message: string) => {
    if (!prefs.confirm_delete) return true;
    return window.confirm(message);
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
      if (!confirm(batchConfirmMessage("permanent", ids.length, title))) {
        return;
      }
      await applyToNotes(ids, (id) => api.permanentlyDeleteNote(id), {
        closeActive: true,
        clearSelection: true,
      });
      return;
    }
    if (!confirm(batchConfirmMessage("trash", ids.length, title))) {
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "n" && e.shiftKey) {
        e.preventDefault();
        setShowGallery(true);
      } else if (meta && e.key === "n") {
        e.preventDefault();
        createNote();
      } else if (meta && e.key === "f") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (meta && e.key === ",") {
        e.preventDefault();
        openSettings();
      } else if (meta && e.key === "t" && e.shiftKey) {
        e.preventDefault();
        setFilter({ type: "templates" });
      } else if (meta && e.key === "p" && !isTextInputFocused() && targetNoteIds().length > 0) {
        e.preventDefault();
        const targets = notes.filter((note) => targetNoteIds().includes(note.id));
        const allPinned = targets.length > 0 && targets.every((note) => note.is_pinned);
        void pinSelectedNotes(!allPinned);
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
      const sameNotebookId =
        targets.every((note) => note.notebook_id === targets[0]?.notebook_id)
          ? targets[0]?.notebook_id
          : null;

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
          label: "Move to notebook",
          children: notebooks.map((notebook) => ({
            label: notebook.name,
            checked: sameNotebookId === notebook.id,
            disabled: sameNotebookId === notebook.id,
            onSelect: () => void moveSelectedNotes(notebook.id),
          })),
        },
        {
          label: count > 1 ? `Duplicate ${count} notes` : "Duplicate note",
          onSelect: () => void duplicateSelectedNotes(),
        },
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
              !confirm(
                `Delete “${notebook.name}”? Notes in this notebook will move to Trash.`
              )
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
              !confirm(
                `Delete “${stack.name}”? Its notebooks and notes will be kept.`
              )
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
          if (!confirm(`Delete the tag “${tag.name}”?`)) return;
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

  const runEditorCommand = (command: string) => {
    document.execCommand(command);
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
        { type: "separator" },
        {
          label: "Import Notes…",
          onSelect: () => importRef.current?.click(),
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
        { label: "Undo", shortcut: "Ctrl/⌘ Z", onSelect: () => runEditorCommand("undo") },
        {
          label: "Redo",
          shortcut: "Ctrl/⌘ ⇧ Z",
          onSelect: () => runEditorCommand("redo"),
        },
        { type: "separator" },
        { label: "Cut", shortcut: "Ctrl/⌘ X", onSelect: () => runEditorCommand("cut") },
        { label: "Copy", shortcut: "Ctrl/⌘ C", onSelect: () => runEditorCommand("copy") },
        { label: "Paste", shortcut: "Ctrl/⌘ V", onSelect: () => runEditorCommand("paste") },
        { type: "separator" },
        {
          label: "Select All",
          shortcut: "Ctrl/⌘ A",
          onSelect: () => {
            if (isTextInputFocused()) {
              runEditorCommand("selectAll");
              return;
            }
            setSelectedNoteIds(new Set(notes.map((n) => n.id)));
          },
        },
      ],
    },
    {
      label: "View",
      items: [
        { label: "All Notes", onSelect: () => setFilter({ type: "all" }) },
        { label: "Shortcuts", onSelect: () => setFilter({ type: "shortcuts" }) },
        { label: "Templates", onSelect: () => setFilter({ type: "templates" }) },
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
          onSelect: () => {
            void shortcutSelectedNotes(
              selectedNoteIds.size > 1 ? !allSelectedShortcuts : !isShortcut
            );
          },
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
          label: "Bold",
          shortcut: "Ctrl/⌘ B",
          disabled: !activeNote,
          onSelect: () => runEditorCommand("bold"),
        },
        {
          label: "Italic",
          shortcut: "Ctrl/⌘ I",
          disabled: !activeNote,
          onSelect: () => runEditorCommand("italic"),
        },
        {
          label: "Underline",
          shortcut: "Ctrl/⌘ U",
          disabled: !activeNote,
          onSelect: () => runEditorCommand("underline"),
        },
        {
          label: "Strikethrough",
          disabled: !activeNote,
          onSelect: () => runEditorCommand("strikeThrough"),
        },
        { type: "separator" },
        {
          label: "Remove Formatting",
          disabled: !activeNote,
          onSelect: () => runEditorCommand("removeFormat"),
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
      className="app-shell"
      onMouseDown={() => {
        setShowNewMenu(false);
        setShowNoteMenu(false);
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
        <div className="sidebar-account">
          <div className="account-chip">
            <span className="avatar">{account.display_name.slice(0, 1).toUpperCase()}</span>
            <span className="account-name">{account.display_name}</span>
          </div>
        </div>

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

        <nav className="sidebar-nav scroll-pane">
          <button
            className={filter.type === "all" ? "nav-item active" : "nav-item"}
            onClick={() => setFilter({ type: "all" })}
          >
            <Icon.Notes size={16} />
            Notes
          </button>
          {prefs.show_shortcuts && (
            <button
              className={filter.type === "shortcuts" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "shortcuts" })}
            >
              <Icon.Shortcuts size={16} />
              Shortcuts
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
                      transform: notebooksOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    }}
                  />
                </span>
              </button>
              {notebooksOpen && (
                <>
                  {stacks.map((stack) => (
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
                      {(notebooksByStack[stack.id] || []).map((nb) => (
                        <button
                          key={nb.id}
                          className={
                            filter.type === "notebook" && filter.id === nb.id
                              ? "nav-item active indent"
                              : "nav-item indent"
                          }
                          onClick={() =>
                            setFilter({ type: "notebook", id: nb.id, name: nb.name })
                          }
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
                        >
                          {nb.name}
                        </button>
                      ))}
                    </div>
                  ))}
                  {notebooksByStack.uncategorized.map((nb) => (
                    <button
                      key={nb.id}
                      className={
                        filter.type === "notebook" && filter.id === nb.id
                          ? "nav-item active indent"
                          : "nav-item indent"
                      }
                      onClick={() =>
                        setFilter({ type: "notebook", id: nb.id, name: nb.name })
                      }
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
                    >
                      {nb.name}
                    </button>
                  ))}
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
                      transform: tagsOpen ? "rotate(0deg)" : "rotate(-90deg)",
                    }}
                  />
                </span>
              </button>
              {tagsOpen &&
                tags.map((tag) => (
                  <button
                    key={tag.id}
                    className={
                      filter.type === "tag" && filter.id === tag.id
                        ? "nav-item active indent"
                        : "nav-item indent"
                    }
                    onClick={() =>
                      setFilter({ type: "tag", id: tag.id, name: tag.name })
                    }
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
                  </button>
                ))}
            </div>
          )}

          {prefs.show_templates && (
            <button
              className={filter.type === "templates" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "templates" })}
            >
              <Icon.Templates size={16} />
              Templates
            </button>
          )}

          {prefs.show_trash && (
            <button
              className={filter.type === "trash" ? "nav-item active" : "nav-item"}
              onClick={() => setFilter({ type: "trash" })}
            >
              <Icon.Trash size={16} />
              Trash
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
                  if (!confirm("Permanently delete all notes in Trash?")) return;
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
                  <select
                    aria-label="Move selected notes to notebook"
                    value=""
                    onChange={(e) => {
                      const notebookId = e.target.value;
                      if (notebookId) void moveSelectedNotes(notebookId);
                    }}
                  >
                    <option value="" disabled>
                      Move to…
                    </option>
                    {notebooks.map((notebook) => (
                      <option key={notebook.id} value={notebook.id}>
                        {notebook.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="ghost-btn small"
                    onClick={() => void pinSelectedNotes(!allSelectedPinned)}
                  >
                    {allSelectedPinned ? "Unpin" : "Pin"}
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
        <div className="note-list scroll-pane" ref={noteListRef}>
          {notes.map((note) => (
            <button
              key={note.id}
              className={
                (selectedNoteIds.has(note.id) ? "note-card selected" : "note-card") +
                (prefs.list_density === "compact" ? " compact" : "")
              }
              aria-pressed={selectedNoteIds.has(note.id)}
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
              {prefs.show_snippets && (
                <div className="note-card-snippet">{note.snippet}</div>
              )}
              {note.tag_names.length > 0 && (
                <div className="note-card-tags">
                  {note.tag_names.map((t) => (
                    <span key={t}>#{t}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
          {notes.length === 0 && (
            <div className="empty-state">
              {filter.type === "templates"
                ? "No templates yet. Open the gallery to get started."
                : "No notes here yet."}
            </div>
          )}
        </div>
      </section>

      <main className="editor-panel">
        {activeNote ? (
          <>
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
              <input
                className="title-input"
                value={activeNote.title}
                onChange={(e) =>
                  setActiveNote({ ...activeNote, title: e.target.value })
                }
                placeholder="Title"
              />
              <div className="editor-actions">
                <select
                  value={activeNote.notebook_id}
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
                <button
                  onClick={() =>
                    saveNote({ ...activeNote, is_pinned: !activeNote.is_pinned })
                  }
                >
                  {activeNote.is_pinned ? "Unpin" : "Pin"}
                </button>
                <button
                  onClick={async () => {
                    if (isShortcut) await api.removeShortcut(activeNote.id);
                    else await api.addShortcut(activeNote.id);
                    await refreshMeta();
                  }}
                >
                  {isShortcut ? "Unstar" : "Shortcut"}
                </button>
                <div className="menu-anchor" onMouseDown={(e) => e.stopPropagation()}>
                  <button onClick={() => setShowNoteMenu((v) => !v)} title="More">
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
                              if (!confirm("Delete this note forever?")) return;
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
                            if (!confirm("Move this note to Trash?")) return;
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
                <span className="save-state">{saveState}</span>
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
          </>
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
            if (!confirm("Permanently delete all notes in Trash?")) return;
            await api.emptyTrash();
            await refreshNotes();
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
