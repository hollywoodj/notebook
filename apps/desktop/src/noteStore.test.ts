import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNoteStore, loadNotes, type NoteStoreApi } from "./noteStore.ts";
import type { NoteSummary, SidebarCounts } from "./api.ts";

function note(overrides: Partial<NoteSummary> = {}): NoteSummary {
  return {
    id: "n1",
    notebook_id: "nb1",
    title: "Untitled",
    snippet: "",
    is_pinned: false,
    is_archived: false,
    reminder_at: null,
    tag_ids: [],
    tag_names: [],
    attachment_count: 0,
    is_template: false,
    template_category: null,
    notebook_name: "Notebook",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

const ZERO_COUNTS: SidebarCounts = {
  notes: 0,
  reminders: 0,
  trash: 0,
  templates: 0,
  shortcuts: 0,
  files: 0,
};

function fakeApi(overrides: Partial<NoteStoreApi> = {}): NoteStoreApi {
  return {
    listNotebooks: async () => [],
    listStacks: async () => [],
    listTags: async () => [],
    listShortcuts: async () => [],
    listNotes: async () => [],
    search: async () => ({ notes: [], total: 0 }),
    sidebarCounts: async () => ZERO_COUNTS,
    listAllAttachments: async () => [],
    ...overrides,
  };
}

describe("createNoteStore", () => {
  it("invalidate('notes') fetches and notifies subscribers", async () => {
    const list = [note({ id: "a" })];
    const store = createNoteStore({ api: fakeApi({ listNotes: async () => list }) });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    await store.invalidate("notes");
    assert.equal(notified > 0, true);
    assert.deepEqual(store.getSnapshot("notes").data, list);
    assert.equal(store.getSnapshot("notes").loaded, true);
  });

  it("getSnapshot returns an identity-stable object when nothing changed", async () => {
    const store = createNoteStore({ api: fakeApi() });
    await store.invalidate("notes");
    const first = store.getSnapshot("notes");
    const second = store.getSnapshot("notes");
    assert.equal(first, second);
  });

  it("discards a slow fetch that resolves after a newer one for the same key", async () => {
    let resolveFirst!: (value: NoteSummary[]) => void;
    let call = 0;
    const store = createNoteStore({
      api: fakeApi({
        listNotes: () => {
          call += 1;
          if (call === 1) {
            return new Promise<NoteSummary[]>((resolve) => {
              resolveFirst = resolve;
            });
          }
          return Promise.resolve([note({ id: "newer" })]);
        },
      }),
    });

    const firstInvalidate = store.invalidate("notes");
    const secondInvalidate = store.invalidate("notes");
    await secondInvalidate;
    // Resolve the slow first fetch after the newer one has already landed.
    resolveFirst([note({ id: "stale" })]);
    await firstInvalidate;

    assert.deepEqual(
      store.getSnapshot("notes").data.map((n) => n.id),
      ["newer"]
    );
  });

  it("afterNoteChange refetches counts (stale sidebar counts regression)", async () => {
    let countsCalls = 0;
    const store = createNoteStore({
      api: fakeApi({
        sidebarCounts: async () => {
          countsCalls += 1;
          return { ...ZERO_COUNTS, notes: countsCalls };
        },
      }),
    });
    await store.afterNoteChange();
    assert.equal(countsCalls, 1);
    assert.equal(store.getSnapshot("counts").data.notes, 1);
  });

  it("invalidate('meta') calls exactly the six meta fetchers", async () => {
    const calls: string[] = [];
    const store = createNoteStore({
      api: fakeApi({
        listNotebooks: async () => (calls.push("notebooks"), []),
        listStacks: async () => (calls.push("stacks"), []),
        listTags: async () => (calls.push("tags"), []),
        listShortcuts: async () => (calls.push("shortcuts"), []),
        listNotes: async () => (calls.push("templates"), []),
        sidebarCounts: async () => (calls.push("counts"), ZERO_COUNTS),
      }),
    });
    await store.invalidate("meta");
    assert.deepEqual(calls.sort(), [
      "counts",
      "notebooks",
      "shortcuts",
      "stacks",
      "tags",
      "templates",
    ]);
  });

  it("keeps the previous good value and does not reject invalidate when a fetcher rejects", async () => {
    const good = [note({ id: "keeper" })];
    let shouldFail = false;
    const store = createNoteStore({
      api: fakeApi({
        listNotebooks: async () => {
          if (shouldFail) throw new Error("boom");
          return [];
        },
        listNotes: async () => good,
      }),
    });
    await store.invalidate("notes");
    assert.deepEqual(store.getSnapshot("notes").data, good);

    shouldFail = true;
    await assert.doesNotReject(store.invalidate("notebooks"));
    assert.deepEqual(store.getSnapshot("notebooks").data, []);
  });

  it("loadNotes routes each ViewFilter type to the expected api call", async () => {
    const calls: { method: string; args?: unknown }[] = [];
    const api = fakeApi({
      listNotes: async (params) => {
        calls.push({ method: "listNotes", args: params });
        return [];
      },
      listShortcuts: async () => {
        calls.push({ method: "listShortcuts" });
        return [];
      },
      search: async (q) => {
        calls.push({ method: "search", args: q });
        return { notes: [], total: 0 };
      },
    });
    const ctx = (filter: NotesFilter) => ({ filter, sortBy: "updated" as const, searchScope: null });

    await loadNotes(api, ctx({ type: "all" }));
    assert.deepEqual(calls.pop(), { method: "listNotes", args: { templates: false } });

    await loadNotes(api, ctx({ type: "notebook", id: "nb1", name: "Work" }));
    assert.deepEqual(calls.pop(), {
      method: "listNotes",
      args: { notebookId: "nb1", templates: false },
    });

    await loadNotes(api, ctx({ type: "tag", id: "t1", name: "urgent" }));
    assert.deepEqual(calls.pop(), { method: "listNotes", args: { tagId: "t1", templates: false } });

    await loadNotes(api, ctx({ type: "shortcuts" }));
    assert.deepEqual(calls.pop(), { method: "listShortcuts" });

    await loadNotes(api, ctx({ type: "reminders" }));
    assert.deepEqual(calls.pop(), { method: "listNotes", args: { templates: false } });

    await loadNotes(api, ctx({ type: "templates" }));
    assert.deepEqual(calls.pop(), { method: "listNotes", args: { templates: true } });

    await loadNotes(api, ctx({ type: "trash" }));
    assert.deepEqual(calls.pop(), { method: "listNotes", args: { trash: true } });

    await loadNotes(api, ctx({ type: "search", query: "hello" }));
    assert.deepEqual(calls.pop(), { method: "search", args: "hello" });
  });

  it("loadNotes sorts pinned-first, honors sort_by, and reminders ascending", async () => {
    const api = fakeApi({
      listNotes: async () => [
        note({ id: "a", is_pinned: false, title: "Banana", created_at: "2024-01-01", updated_at: "2024-01-03" }),
        note({ id: "b", is_pinned: true, title: "Apple", created_at: "2024-01-02", updated_at: "2024-01-01" }),
        note({ id: "c", is_pinned: false, title: "Apple", created_at: "2024-01-03", updated_at: "2024-01-02" }),
      ],
    });

    const updated = await loadNotes(api, { filter: { type: "all" }, sortBy: "updated", searchScope: null });
    assert.deepEqual(updated.map((n) => n.id), ["b", "a", "c"]);

    const created = await loadNotes(api, { filter: { type: "all" }, sortBy: "created", searchScope: null });
    assert.deepEqual(created.map((n) => n.id), ["b", "c", "a"]);

    const title = await loadNotes(api, { filter: { type: "all" }, sortBy: "title", searchScope: null });
    assert.deepEqual(title.map((n) => n.id), ["b", "c", "a"]);

    const reminderApi = fakeApi({
      listNotes: async () =>
        [
          note({ id: "r1", reminder_at: "2024-01-05T00:00:00Z" }),
          note({ id: "r2", reminder_at: "2024-01-01T00:00:00Z" }),
        ].filter((n) => n.reminder_at),
    });
    const reminders = await loadNotes(reminderApi, {
      filter: { type: "reminders" },
      sortBy: "updated",
      searchScope: null,
    });
    assert.deepEqual(reminders.map((n) => n.id), ["r2", "r1"]);
  });

  it("loadNotes narrows a search to the given searchScope notebook", async () => {
    const api = fakeApi({
      search: async () => ({
        notes: [
          note({ id: "in-scope", notebook_id: "nb1" }),
          note({ id: "out-of-scope", notebook_id: "nb2" }),
        ],
        total: 2,
      }),
    });
    const results = await loadNotes(api, {
      filter: { type: "search", query: "hello" },
      sortBy: "updated",
      searchScope: { id: "nb1" },
    });
    assert.deepEqual(results.map((n) => n.id), ["in-scope"]);
  });

  it("setContext is a pure setter and never fetches on its own", async () => {
    let calls = 0;
    const store = createNoteStore({
      api: fakeApi({
        listNotes: async () => {
          calls += 1;
          return [];
        },
      }),
    });
    // App calls setContext during render, so it must not fire a request:
    // the filter/sort/scope effect is the single thing that refetches.
    store.setContext({ filter: { type: "trash" }, sortBy: "title", searchScope: null });
    await Promise.resolve();
    assert.equal(calls, 0, "setContext must not fetch during render");
  });

  it("invalidate('notes') reads the context set by the last setContext", async () => {
    const seen: unknown[] = [];
    const store = createNoteStore({
      api: fakeApi({
        listNotes: async (params) => {
          seen.push(params);
          return [];
        },
      }),
    });
    await store.invalidate("notes");
    assert.deepEqual(seen[0], { templates: false }, "defaults to the all-notes view");

    store.setContext({ filter: { type: "trash" }, sortBy: "title", searchScope: null });
    await store.invalidate("notes");
    assert.deepEqual(seen[1], { trash: true }, "the new context drives the next fetch");
  });
});

type NotesFilter = Parameters<typeof loadNotes>[1]["filter"];
