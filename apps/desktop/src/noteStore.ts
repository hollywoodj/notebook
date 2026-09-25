/**
 * A hand-rolled cache for everything the sidebar and note list read through
 * the api seam: notebooks, stacks, tags, shortcuts, templates, sidebar
 * counts, the current notes list, and files. This replaces the old pattern
 * of "remember to call refreshMeta() after your change" with named verbs
 * (`afterNoteChange()`, `afterNotebookChange()`, ...) that say what actually
 * needs to be refetched.
 *
 * No runtime React import here on purpose: `useNoteStore.ts` is the thin
 * React binding, and this file stays plain-TypeScript testable under
 * `node --test`.
 */
import { api as productionApi } from "./api.ts";
import type {
  AttachmentSummary,
  NoteSummary,
  Notebook,
  Preferences,
  SidebarCounts,
  Stack,
  Tag,
  ViewFilter,
} from "./api.ts";
import { noteMatchesSearchOperators, parseSearchQuery } from "./ui/search.ts";

/** The subset of the api surface the store (and `loadNotes`) needs. */
export type NoteStoreApi = {
  listNotebooks: () => Promise<Notebook[]>;
  listStacks: () => Promise<Stack[]>;
  listTags: () => Promise<Tag[]>;
  listShortcuts: () => Promise<NoteSummary[]>;
  listNotes: (params: {
    notebookId?: string;
    tagId?: string;
    trash?: boolean;
    archived?: boolean;
    templates?: boolean;
  }) => Promise<NoteSummary[]>;
  search: (q: string) => Promise<{ notes: NoteSummary[]; total: number }>;
  sidebarCounts: () => Promise<SidebarCounts>;
  listAllAttachments: () => Promise<AttachmentSummary[]>;
};

export interface StoreDataMap {
  notebooks: Notebook[];
  stacks: Stack[];
  tags: Tag[];
  shortcuts: NoteSummary[];
  templates: NoteSummary[];
  counts: SidebarCounts;
  notes: NoteSummary[];
  files: AttachmentSummary[];
}

export type StoreKey = keyof StoreDataMap;

/** `invalidate()` also accepts the "meta" group alias. */
export type InvalidateKey = StoreKey | "meta";

export interface StoreState<K extends StoreKey = StoreKey> {
  data: StoreDataMap[K];
  loaded: boolean;
}

export interface NotesContext {
  filter: ViewFilter;
  sortBy: Preferences["sort_by"];
  searchScope: { id: string } | null;
}

const ZERO_COUNTS: SidebarCounts = {
  notes: 0,
  reminders: 0,
  trash: 0,
  templates: 0,
  shortcuts: 0,
  files: 0,
};

const META_KEYS: StoreKey[] = [
  "notebooks",
  "stacks",
  "tags",
  "shortcuts",
  "templates",
  "counts",
];

/**
 * Builds the notes list for the given view: routes to the right api call for
 * `filter.type`, applies search operators / scope narrowing, and sorts.
 * Moved verbatim out of App.tsx's old `refreshNotes` so it can be unit
 * tested without React.
 */
export async function loadNotes(
  api: NoteStoreApi,
  ctx: NotesContext
): Promise<NoteSummary[]> {
  const { filter, sortBy, searchScope } = ctx;
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
    case "search": {
      const parsed = parseSearchQuery(filter.query);
      if (parsed.text) {
        list = (await api.search(parsed.text)).notes;
      } else {
        list = await api.listNotes({ templates: false });
      }
      list = list.filter((note) => noteMatchesSearchOperators(note, parsed));
      if (searchScope) {
        list = list.filter((note) => note.notebook_id === searchScope.id);
      }
      break;
    }
  }
  const sorted = [...list].sort((a, b) => {
    if (filter.type === "reminders") {
      return new Date(a.reminder_at || 0).getTime() - new Date(b.reminder_at || 0).getTime();
    }
    if (filter.type === "notebook" && a.is_pinned !== b.is_pinned) {
      return a.is_pinned ? -1 : 1;
    }
    if (sortBy === "title") return a.title.localeCompare(b.title);
    if (sortBy === "created") {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    }
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
  return sorted;
}

function contextsEqual(a: NotesContext, b: NotesContext): boolean {
  if (a.sortBy !== b.sortBy) return false;
  if ((a.searchScope?.id ?? null) !== (b.searchScope?.id ?? null)) return false;
  return JSON.stringify(a.filter) === JSON.stringify(b.filter);
}

export function createNoteStore({ api }: { api: NoteStoreApi }) {
  const state: Record<StoreKey, { data: unknown; loaded: boolean }> = {
    notebooks: { data: [] as Notebook[], loaded: false },
    stacks: { data: [] as Stack[], loaded: false },
    tags: { data: [] as Tag[], loaded: false },
    shortcuts: { data: [] as NoteSummary[], loaded: false },
    templates: { data: [] as NoteSummary[], loaded: false },
    counts: { data: ZERO_COUNTS, loaded: false },
    notes: { data: [] as NoteSummary[], loaded: false },
    files: { data: [] as AttachmentSummary[], loaded: false },
  };

  const generations: Record<StoreKey, number> = {
    notebooks: 0,
    stacks: 0,
    tags: 0,
    shortcuts: 0,
    templates: 0,
    counts: 0,
    notes: 0,
    files: 0,
  };

  const snapshotCache: Partial<Record<StoreKey, StoreState>> = {};

  let context: NotesContext = {
    filter: { type: "all" },
    sortBy: "updated",
    searchScope: null,
  };

  const listeners = new Set<() => void>();

  function notify(): void {
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  /**
   * Returns a cached object for `key` with a stable identity, and only a new
   * identity when the underlying data or loaded flag actually changed.
   * `useSyncExternalStore` infinite-loops if this doesn't hold.
   */
  function getSnapshot<K extends StoreKey>(key: K): StoreState<K> {
    const current = state[key];
    const cached = snapshotCache[key];
    if (cached && cached.data === current.data && cached.loaded === current.loaded) {
      return cached as StoreState<K>;
    }
    const next = { data: current.data, loaded: current.loaded } as StoreState<K>;
    snapshotCache[key] = next as StoreState;
    return next;
  }

  const fetchers: Record<StoreKey, () => Promise<unknown>> = {
    notebooks: () => api.listNotebooks(),
    stacks: () => api.listStacks(),
    tags: () => api.listTags(),
    shortcuts: () => api.listShortcuts(),
    templates: () => api.listNotes({ templates: true }),
    // Preserve the existing fallback: a failed counts fetch resolves to all
    // zeros rather than rejecting, so it never trips the generic catch below.
    counts: () => api.sidebarCounts().catch(() => ZERO_COUNTS),
    notes: () => loadNotes(api, context),
    files: () => api.listAllAttachments(),
  };

  async function fetchKey(key: StoreKey): Promise<void> {
    const gen = ++generations[key];
    try {
      const data = await fetchers[key]();
      if (generations[key] !== gen) return; // superseded by a newer fetch
      state[key] = { data, loaded: true };
      notify();
    } catch (err) {
      if (generations[key] !== gen) return;
      console.error(err);
      // Keep the last good value. The Files view previously marked itself
      // "loaded" even on error (so it can show an empty state instead of
      // spinning forever); preserve that one exception.
      if (key === "files") {
        state[key] = { ...state[key], loaded: true };
        notify();
      }
    }
  }

  async function invalidate(...keys: InvalidateKey[]): Promise<void> {
    const expanded = keys.flatMap((key) => (key === "meta" ? META_KEYS : [key]));
    const unique = [...new Set(expanded)];
    await Promise.allSettled(unique.map((key) => fetchKey(key)));
  }

  /**
   * Points the notes fetcher at the current view. A pure setter on purpose:
   * App calls this during render, and the effect that watches filter/sort/
   * scope is the single thing that actually triggers the refetch. Fetching
   * here too would double every request and put a side effect in render.
   */
  function setContext(next: NotesContext): void {
    if (contextsEqual(context, next)) return;
    context = next;
  }

  return {
    getSnapshot,
    subscribe,
    setContext,
    invalidate,
    afterNoteChange: () => invalidate("notes", "counts", "shortcuts", "templates"),
    afterNotebookChange: () => invalidate("notebooks", "counts", "notes"),
    afterTagChange: () => invalidate("tags", "notes"),
    afterStackChange: () => invalidate("stacks", "notebooks"),
    afterAttachmentChange: () => invalidate("files", "counts"),
  };
}

export type NoteStore = ReturnType<typeof createNoteStore>;

export const noteStore = createNoteStore({ api: productionApi });
