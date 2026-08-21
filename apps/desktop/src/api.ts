import { decodeXmlEntities, repairImportedHtml } from "./htmlEntities.ts";

export interface Notebook {
  id: string;
  user_id: string;
  stack_id: string | null;
  name: string;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  note_count?: number;
}

export interface Stack {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
  updated_at: string;
  note_count?: number;
}

export interface NoteSummary {
  id: string;
  notebook_id: string;
  title: string;
  snippet: string;
  is_pinned: boolean;
  is_archived: boolean;
  reminder_at: string | null;
  tag_ids: string[];
  tag_names: string[];
  attachment_count: number;
  thumbnail_url?: string | null;
  checklist_done?: number;
  checklist_total?: number;
  is_template: boolean;
  template_category: string | null;
  notebook_name: string;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  notebook_id: string;
  title: string;
  content: string;
  content_plain: string;
  is_pinned: boolean;
  is_archived: boolean;
  reminder_at: string | null;
  source_url: string | null;
  latitude: number | null;
  longitude: number | null;
  is_template: boolean;
  template_category: string | null;
  template_key: string | null;
  tag_ids: string[];
  tag_names: string[];
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface NoteRevision {
  id: string;
  note_id: string;
  title: string;
  content: string;
  created_at: string;
}

export interface Attachment {
  id: string;
  note_id: string;
  filename: string;
  mime_type: string;
  size: number;
  width: number | null;
  height: number | null;
  created_at: string;
  updated_at: string;
}

export type ViewFilter =
  | { type: "all" }
  | { type: "notebook"; id: string; name: string }
  | { type: "tag"; id: string; name: string }
  | { type: "shortcuts" }
  | { type: "reminders" }
  | { type: "templates" }
  | { type: "trash" }
  | { type: "archived" }
  | { type: "search"; query: string };

export interface Account {
  id: string;
  email: string;
  display_name: string;
  created_at: string;
  updated_at: string;
}

export interface Preferences {
  theme: "light" | "dark" | "system";
  startup_view: "all" | "shortcuts" | "notebook";
  confirm_delete: boolean;
  spell_check: boolean;
  date_format: "short" | "medium" | "long";
  week_starts_on: "sunday" | "monday";
  note_width: "readable" | "full";
  font_family: "default" | "serif" | "mono";
  font_size: number;
  show_snippets: boolean;
  list_view: "snippets" | "titles" | "cards";
  list_density: "comfortable" | "compact";
  sort_by: "updated" | "created" | "title" | "reminder";
  sort_descending: boolean;
  spell_language: string;
  show_completed_reminders: boolean;
  new_note_behavior: "blank" | "ask";
  auto_save_ms: number;
  show_shortcuts: boolean;
  show_notebooks: boolean;
  show_tags: boolean;
  show_templates: boolean;
  show_trash: boolean;
  show_import: boolean;
  show_reminders: boolean;
  default_notebook_id: string | null;
  pdf_view: "expanded" | "title";
  omniclone_enabled: boolean;
  omniclone_scheme: "omniclone" | "omnifocus" | "both";
  omniclone_send_due: boolean;
}

export const defaultPreferences: Preferences = {
  theme: "light",
  startup_view: "all",
  confirm_delete: true,
  spell_check: true,
  date_format: "medium",
  week_starts_on: "sunday",
  note_width: "readable",
  font_family: "default",
  font_size: 16,
  show_snippets: true,
  list_view: "snippets",
  list_density: "comfortable",
  sort_by: "updated",
  sort_descending: false,
  spell_language: "en-US",
  show_completed_reminders: true,
  new_note_behavior: "blank",
  auto_save_ms: 600,
  show_shortcuts: true,
  show_notebooks: true,
  show_tags: true,
  show_templates: true,
  show_trash: true,
  show_import: true,
  show_reminders: true,
  default_notebook_id: null,
  pdf_view: "expanded",
  omniclone_enabled: true,
  omniclone_scheme: "omniclone",
  omniclone_send_due: true,
};

export interface SidebarCounts {
  notes: number;
  reminders: number;
  trash: number;
  templates: number;
  shortcuts: number;
}

export interface TemplateCatalogItem {
  key: string;
  title: string;
  category: string;
  description: string;
}

const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8799";

export const attachmentUrl = (id: string) =>
  `${API_BASE}/api/v1/attachments/${encodeURIComponent(id)}`;

function repairImportedNote<T extends { title?: string | null; snippet?: string | null; content?: string | null; content_plain?: string | null }>(
  note: T
): T {
  return {
    ...note,
    ...(note.title != null ? { title: decodeXmlEntities(note.title) } : {}),
    ...(note.snippet != null ? { snippet: decodeXmlEntities(note.snippet) } : {}),
    ...(note.content_plain != null
      ? { content_plain: decodeXmlEntities(note.content_plain) }
      : {}),
    ...(note.content != null ? { content: repairImportedHtml(note.content) } : {}),
  };
}

function asNoteList(value: unknown): NoteSummary[] {
  if (!Array.isArray(value)) {
    throw new Error("Notebook API did not return a note list");
  }
  return value.map(repairImportedNote);
}

function hydrateAttachmentUrls(note: Note): Note {
  const repaired = repairImportedNote(note);
  return {
    ...repaired,
    content: String(repaired.content ?? "").replace(
      /notebook-attachment:\/\/([0-9a-f-]{36})/gi,
      (_match, id: string) => attachmentUrl(id)
    ),
  };
}

function rewriteFetchError(err: unknown): Error {
  if (err instanceof TypeError) {
    return new Error(
      `Could not reach the Notebook API at ${API_BASE}. Large Evernote exports should be imported from disk; if this keeps happening, restart Notebook.`
    );
  }
  if (err instanceof Error) return err;
  return new Error("Request failed");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
  } catch (err) {
    throw rewriteFetchError(err);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),

  listNotebooks: () => request<Notebook[]>("/api/v1/notebooks"),
  createNotebook: (name: string, stackId?: string) =>
    request<Notebook>("/api/v1/notebooks", {
      method: "POST",
      body: JSON.stringify({ name, stack_id: stackId || null }),
    }),
  deleteNotebook: (id: string) =>
    request<void>(`/api/v1/notebooks/${id}`, { method: "DELETE" }),
  updateNotebook: (
    id: string,
    patch: Partial<{ name: string; is_default: boolean; stack_id: string | null }>
  ) =>
    request<Notebook>(`/api/v1/notebooks/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  listStacks: () => request<Stack[]>("/api/v1/stacks"),
  createStack: (name: string) =>
    request<Stack>("/api/v1/stacks", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateStack: (id: string, patch: Partial<{ name: string; sort_order: number }>) =>
    request<Stack>(`/api/v1/stacks/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteStack: (id: string) =>
    request<void>(`/api/v1/stacks/${id}`, { method: "DELETE" }),

  listTags: () => request<Tag[]>("/api/v1/tags"),
  createTag: (name: string) =>
    request<Tag>("/api/v1/tags", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  updateTag: (id: string, patch: Partial<{ name: string }>) =>
    request<Tag>(`/api/v1/tags/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  deleteTag: (id: string) =>
    request<void>(`/api/v1/tags/${id}`, { method: "DELETE" }),

  listNotes: (params: {
    notebookId?: string;
    tagId?: string;
    trash?: boolean;
    archived?: boolean;
    templates?: boolean;
  }) => {
    const qs = new URLSearchParams();
    if (params.notebookId) qs.set("notebook_id", params.notebookId);
    if (params.tagId) qs.set("tag_id", params.tagId);
    if (params.trash) qs.set("trash", "true");
    if (params.archived !== undefined) qs.set("archived", String(params.archived));
    if (params.templates !== undefined) qs.set("templates", String(params.templates));
    const query = qs.toString();
    return request<NoteSummary[]>(`/api/v1/notes${query ? `?${query}` : ""}`).then(
      asNoteList
    );
  },

  getNote: (id: string) =>
    request<Note>(`/api/v1/notes/${id}`).then(hydrateAttachmentUrls),

  createNote: (
    notebookId: string,
    options?: {
      title?: string;
      content?: string;
      tag_ids?: string[];
      is_template?: boolean;
      template_category?: string;
    }
  ) =>
    request<Note>("/api/v1/notes", {
      method: "POST",
      body: JSON.stringify({
        notebook_id: notebookId,
        // Empty, not the literal "Untitled": the title input shows its value, so a
        // placeholder string here forces the user to clear it before typing. The
        // note list and window title already fall back to "Untitled" for display.
        title: options?.title ?? "",
        content: options?.content ?? "<p></p>",
        tag_ids: options?.tag_ids,
        is_template: options?.is_template ?? false,
        template_category: options?.template_category ?? null,
      }),
    }).then(hydrateAttachmentUrls),

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
  ) =>
    request<Note>(`/api/v1/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    }).then(hydrateAttachmentUrls),

  deleteNote: (id: string) =>
    request<void>(`/api/v1/notes/${id}`, { method: "DELETE" }),

  restoreNote: (id: string) =>
    request<Note>(`/api/v1/notes/${id}/restore`, { method: "POST" }).then(
      hydrateAttachmentUrls
    ),

  permanentlyDeleteNote: (id: string) =>
    request<void>(`/api/v1/notes/${id}/permanent`, { method: "DELETE" }),

  emptyTrash: () =>
    request<{ deleted: number }>("/api/v1/trash/empty", { method: "POST" }),

  search: (q: string) =>
    request<{ notes: NoteSummary[]; total: number }>(
      `/api/v1/search?q=${encodeURIComponent(q)}`
    ).then((result) => ({
      ...result,
      notes: asNoteList(result.notes),
    })),

  listShortcuts: () => request<NoteSummary[]>("/api/v1/shortcuts").then(asNoteList),
  addShortcut: (noteId: string) =>
    request(`/api/v1/shortcuts/${noteId}`, { method: "POST" }),
  removeShortcut: (noteId: string) =>
    request<void>(`/api/v1/shortcuts/${noteId}`, { method: "DELETE" }),

  listRevisions: (noteId: string) =>
    request<NoteRevision[]>(`/api/v1/notes/${noteId}/revisions`),

  restoreRevision: (noteId: string, revisionId: string) =>
    request<Note>(`/api/v1/notes/${noteId}/revisions/${revisionId}/restore`, {
      method: "POST",
    }).then(hydrateAttachmentUrls),

  listAttachments: (noteId: string) =>
    request<Attachment[]>(`/api/v1/notes/${noteId}/attachments`),

  uploadAttachment: async (noteId: string, file: File): Promise<Attachment> => {
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE}/api/v1/notes/${noteId}/attachments/upload`,
        { method: "POST", body: form }
      );
    } catch (err) {
      throw rewriteFetchError(err);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Could not upload ${file.name}`);
    }
    return res.json();
  },

  importEnex: async (
    file: File,
    options?: { notebookId?: string; notebookName?: string }
  ) => {
    const filePath = window.notebookDesktop?.getPathForFile?.(file);

    const parseImportResponse = async (res: Response) => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Import failed");
      }
      return res.json() as Promise<{
        imported: number;
        skipped: number;
        notebook_id: string;
        notebook_name: string;
        notebook_count?: number;
        errors: { index: number; title?: string; message: string }[];
      }>;
    };

    if (filePath) {
      return request<{
        imported: number;
        skipped: number;
        notebook_id: string;
        notebook_name: string;
        notebook_count?: number;
        errors: { index: number; title?: string; message: string }[];
      }>("/api/v1/import/enex/path", {
        method: "POST",
        body: JSON.stringify({
          path: filePath,
          notebook_id: options?.notebookId || null,
          notebook_name: options?.notebookName || null,
        }),
      });
    }

    const qs = new URLSearchParams();
    if (options?.notebookId) qs.set("notebook_id", options.notebookId);
    if (options?.notebookName) qs.set("notebook_name", options.notebookName);
    const query = qs.toString();
    const form = new FormData();
    form.append("file", file);
    let res: Response;
    try {
      res = await fetch(
        `${API_BASE}/api/v1/import/enex${query ? `?${query}` : ""}`,
        { method: "POST", body: form }
      );
    } catch (err) {
      throw rewriteFetchError(err);
    }
    return parseImportResponse(res);
  },

  getAccount: () => request<Account>("/api/v1/account"),
  updateAccount: (patch: Partial<{ email: string; display_name: string }>) =>
    request<Account>("/api/v1/account", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),

  getSettings: () => request<Preferences>("/api/v1/settings"),
  updateSettings: (patch: Partial<Preferences>) =>
    request<Preferences>("/api/v1/settings", {
      method: "PUT",
      body: JSON.stringify(patch),
    }),
  resetSettings: () =>
    request<Preferences>("/api/v1/settings", { method: "DELETE" }),

  templateCatalog: () =>
    request<TemplateCatalogItem[]>("/api/v1/templates/catalog"),
  restoreTemplates: () =>
    request<{ restored: number }>("/api/v1/templates/restore", {
      method: "POST",
    }),
  useTemplate: (id: string, notebookId?: string) =>
    request<Note>(`/api/v1/templates/${id}/use`, {
      method: "POST",
      body: JSON.stringify({ notebook_id: notebookId || null }),
    }).then(hydrateAttachmentUrls),

  storageInfo: () =>
    request<{ database: string; attachments: string }>("/api/v1/storage"),

  sidebarCounts: () => request<SidebarCounts>("/api/v1/counts"),
};
