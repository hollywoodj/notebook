import type { MutableRefObject } from "react";
import type { Note, NoteSummary, Preferences, ViewFilter } from "./api.ts";
import { batchConfirmMessage } from "./noteSelection.ts";
import {
  downloadTextFile,
  htmlToMarkdown,
  mergeNoteBodies,
  notesToEnex,
  notesToHtmlDocument,
  printHtmlDocument,
  safeFilename,
} from "./uiChrome.ts";

export type NoteActionApi = {
  getNote: (id: string) => Promise<Note>;
  createNote: (
    notebookId: string,
    options?: {
      title?: string;
      content?: string;
      tag_ids?: string[];
      is_template?: boolean;
      template_category?: string;
    }
  ) => Promise<Note>;
  updateNote: (
    id: string,
    patch: Partial<{
      title: string;
      content: string;
      notebook_id: string;
      is_pinned: boolean;
      is_archived: boolean;
      tag_ids: string[];
      reminder_at: string | null;
      source_url: string | null;
      is_template: boolean;
      template_category: string | null;
    }>
  ) => Promise<Note>;
  deleteNote: (id: string) => Promise<unknown>;
  permanentlyDeleteNote: (id: string) => Promise<unknown>;
  restoreNote: (id: string) => Promise<unknown>;
  addShortcut: (id: string) => Promise<unknown>;
  removeShortcut: (id: string) => Promise<unknown>;
  useTemplate: (id: string, notebookId?: string) => Promise<Note>;
};

export type NoteActionDeps = {
  api: NoteActionApi;
  notes: NoteSummary[];
  selectedNoteIds: Set<string>;
  activeNote: Note | null;
  filter: ViewFilter;
  prefs: Preferences;
  defaultNotebookId?: string;
  lastClickedNoteId: MutableRefObject<string | null>;
  setActiveNote: (note: Note | null) => void;
  setSelectedNoteIds: (ids: Set<string>) => void;
  setPendingConfirm: (confirm: {
    message: string;
    confirmLabel?: string;
    danger?: boolean;
    resolve: (ok: boolean) => void;
  } | null) => void;
  setNotebookPicker: (value: "move" | "copy" | null) => void;
  setShowGallery: (open: boolean) => void;
  setShowNewMenu: (open: boolean) => void;
  refreshNotes: () => Promise<void>;
  refreshMeta: () => Promise<void>;
  loadNote: (id: string) => Promise<void> | void;
  /** Put the caret in the title field, the way Evernote does on a new note. */
  focusTitle: () => void;
};

export function createNoteActions(deps: NoteActionDeps) {
  const confirm = (
    message: string,
    options?: { confirmLabel?: string; danger?: boolean; always?: boolean }
  ) => {
    if (!deps.prefs.confirm_delete && !options?.always) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      deps.setPendingConfirm({
        message,
        confirmLabel: options?.confirmLabel,
        danger: options?.danger,
        resolve,
      });
    });
  };

  const targetNoteIds = () => {
    if (deps.selectedNoteIds.size > 0) return [...deps.selectedNoteIds];
    return deps.activeNote ? [deps.activeNote.id] : [];
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
      if (options?.closeActive && deps.activeNote && ids.includes(deps.activeNote.id)) {
        deps.setActiveNote(null);
      }
      if (options?.clearSelection) {
        deps.setSelectedNoteIds(new Set());
        deps.lastClickedNoteId.current = null;
      }
      await deps.refreshNotes();
      if (options?.refreshMeta) await deps.refreshMeta();
    }
  };

  const createBlankNote = async (notebookId?: string) => {
    const nbId =
      notebookId ||
      (deps.filter.type === "notebook" ? deps.filter.id : deps.defaultNotebookId);
    if (!nbId) return;
    const note = await deps.api.createNote(nbId);
    await deps.refreshNotes();
    await deps.loadNote(note.id);
    deps.focusTitle();
  };

  const createNote = async () => {
    deps.setShowNewMenu(false);
    if (deps.prefs.new_note_behavior === "ask") {
      deps.setShowGallery(true);
      return;
    }
    await createBlankNote();
  };

  const useTemplate = async (templateId: string, notebookId?: string) => {
    const nbId =
      notebookId ||
      (deps.filter.type === "notebook" ? deps.filter.id : deps.defaultNotebookId);
    const note = await deps.api.useTemplate(templateId, nbId);
    deps.setShowGallery(false);
    await deps.refreshNotes();
    await deps.loadNote(note.id);
  };

  const deleteSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    const inTrash = deps.filter.type === "trash";
    const first = deps.notes.find((note) => note.id === ids[0]);
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
      await applyToNotes(ids, (id) => deps.api.permanentlyDeleteNote(id), {
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
    await applyToNotes(ids, (id) => deps.api.deleteNote(id), {
      closeActive: true,
      clearSelection: true,
    });
    return ids;
  };

  const restoreSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, (id) => deps.api.restoreNote(id), {
      closeActive: true,
      clearSelection: true,
    });
  };

  const moveSelectedNotes = async (notebookId: string) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, async (id) => {
      const updated = await deps.api.updateNote(id, { notebook_id: notebookId });
      if (deps.activeNote?.id === id) deps.setActiveNote(updated);
    });
    deps.setNotebookPicker(null);
  };

  const pinSelectedNotes = async (pinned: boolean) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, async (id) => {
      const updated = await deps.api.updateNote(id, { is_pinned: pinned });
      if (deps.activeNote?.id === id) deps.setActiveNote(updated);
    });
  };

  const archiveSelectedNotes = async (archived: boolean) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(ids, async (id) => {
      const updated = await deps.api.updateNote(id, { is_archived: archived });
      if (deps.activeNote?.id === id) deps.setActiveNote(updated);
    });
  };

  const shortcutSelectedNotes = async (add: boolean) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    await applyToNotes(
      ids,
      (id) => (add ? deps.api.addShortcut(id) : deps.api.removeShortcut(id)),
      { refreshMeta: true }
    );
  };

  const duplicateSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    let lastId: string | null = null;
    for (const id of ids) {
      const source = await deps.api.getNote(id);
      const duplicate = await deps.api.createNote(source.notebook_id, {
        title: `${source.title || "Untitled"} copy`,
        content: source.content,
        tag_ids: source.tag_ids,
        is_template: source.is_template,
        template_category: source.template_category || undefined,
      });
      lastId = duplicate.id;
    }
    await deps.refreshNotes();
    if (lastId) await deps.loadNote(lastId);
  };

  const copySelectedNotes = async (notebookId: string) => {
    const ids = targetNoteIds();
    if (ids.length === 0) return;
    let lastId: string | null = null;
    for (const id of ids) {
      const source = await deps.api.getNote(id);
      const copy = await deps.api.createNote(notebookId, {
        title: source.title,
        content: source.content,
        tag_ids: source.tag_ids,
        is_template: source.is_template,
        template_category: source.template_category || undefined,
      });
      lastId = copy.id;
    }
    deps.setNotebookPicker(null);
    await deps.refreshNotes();
    await deps.refreshMeta();
    if (lastId) await deps.loadNote(lastId);
  };

  const mergeSelectedNotes = async () => {
    const ids = targetNoteIds();
    if (ids.length < 2) return;
    const first = deps.notes.find((note) => note.id === ids[0]);
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
      full.push(await deps.api.getNote(id));
    }
    const [keep, ...rest] = full;
    if (!keep) return;
    const content = mergeNoteBodies(full);
    const tagIds = [...new Set(full.flatMap((note) => note.tag_ids))];
    await deps.api.updateNote(keep.id, { content, tag_ids: tagIds });
    for (const note of rest) {
      await deps.api.deleteNote(note.id);
    }
    deps.setActiveNote(null);
    deps.setSelectedNoteIds(new Set([keep.id]));
    deps.lastClickedNoteId.current = keep.id;
    await deps.refreshNotes();
    await deps.refreshMeta();
    await deps.loadNote(keep.id);
  };

  const exportSelectedNotes = async (format: "html" | "enex" | "markdown" | "pdf") => {
    const ids = targetNoteIds();
    if (!ids.length) return;
    const full: Note[] = [];
    for (const id of ids) {
      full.push(await deps.api.getNote(id));
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
    if (format === "markdown") {
      if (full.length === 1) {
        downloadTextFile(
          `${safeFilename(full[0].title)}.md`,
          htmlToMarkdown(full[0].content),
          "text/markdown"
        );
        return;
      }
      const markdown = full
        .map((note) => `# ${note.title || "Untitled"}\n\n${htmlToMarkdown(note.content)}`)
        .join("\n\n---\n\n");
      downloadTextFile("notes.md", markdown, "text/markdown");
      return;
    }
    if (format === "pdf") {
      const title = full.length === 1 ? full[0].title || "Untitled" : "Notes";
      const content = full
        .map((note) => `<h1>${note.title || "Untitled"}</h1>${note.content || ""}`)
        .join("");
      printHtmlDocument(title, content);
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

  return {
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
  };
}
