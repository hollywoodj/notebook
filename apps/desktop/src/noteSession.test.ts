import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createNoteSession, type NoteSessionApi } from "./noteSession.ts";
import type { Note } from "./api.ts";

function note(overrides: Partial<Note> = {}): Note {
  return {
    id: "n1",
    user_id: "u1",
    notebook_id: "nb1",
    title: "Untitled",
    content: "",
    content_plain: "",
    is_pinned: false,
    is_archived: false,
    reminder_at: null,
    source_url: null,
    latitude: null,
    longitude: null,
    is_template: false,
    template_category: null,
    template_key: null,
    tag_ids: [],
    tag_names: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
    deleted_at: null,
    ...overrides,
  };
}

function fakeApi(notesById: Record<string, Note>): NoteSessionApi {
  return {
    getNote: async (id: string) => {
      const found = notesById[id];
      if (!found) throw new Error(`no such note: ${id}`);
      return found;
    },
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createNoteSession", () => {
  it("overlapping loadNoteInto calls each keep their own skip credit, even resolving out of order", async () => {
    // Regression for notes jumping to the top of a date sort on a bare
    // click: fast sidebar clicks fire overlapping `getNote` calls, and an
    // earlier click's fetch can resolve after a later one's. A single
    // shared boolean flag let the second resolution "steal" the skip
    // armed for the first, leaving one load's autosave effect unguarded -
    // triggering a same-content save that only bumped `updated_at`.
    const n1 = note({ id: "n1", title: "One" });
    const n2 = note({ id: "n2", title: "Two" });
    const gates: Record<string, ReturnType<typeof deferred<Note>>> = {
      n1: deferred<Note>(),
      n2: deferred<Note>(),
    };
    const session = createNoteSession({
      api: { getNote: (id: string) => gates[id].promise },
    });

    void session.loadNoteInto("n1");
    void session.loadNoteInto("n2");

    gates.n2.resolve(n2);
    await flushMicrotasks();
    assert.equal(session.get().activeNote?.id, "n2");
    assert.equal(session.consumeSkipNextSave(), true);

    gates.n1.resolve(n1);
    await flushMicrotasks();
    assert.equal(session.get().activeNote?.id, "n1");
    assert.equal(session.consumeSkipNextSave(), true);
  });


  it("clearNote clears active note, selection and lastClicked, and arms skipNextSave", async () => {
    const n1 = note({ id: "n1" });
    const session = createNoteSession({ api: fakeApi({ n1 }) });
    await session.loadNoteInto("n1");
    session.lastClickedNoteIdRef.current = "n1";

    session.clearNote();

    assert.equal(session.get().activeNote, null);
    assert.equal(session.get().selectedNoteIds.size, 0);
    assert.equal(session.lastClickedNoteIdRef.current, null);
    assert.equal(session.consumeSkipNextSave(), true);
  });

  it("openNote selects exactly that note and retitles only the target tab", () => {
    const session = createNoteSession({ api: fakeApi({}) });
    const firstTabId = session.get().tabs[0].id;
    session.setTabs((current) => [
      ...current,
      { id: "tab-b", noteId: null, title: "Notes", filter: { type: "all" } },
    ]);

    const n1 = note({ id: "n1", title: "Hello" });
    session.openNote(n1, firstTabId);

    const state = session.get();
    assert.deepEqual([...state.selectedNoteIds], ["n1"]);
    assert.equal(state.activeNote?.id, "n1");
    const tabA = state.tabs.find((t) => t.id === firstTabId)!;
    const tabB = state.tabs.find((t) => t.id === "tab-b")!;
    assert.equal(tabA.noteId, "n1");
    assert.equal(tabA.title, "Hello");
    assert.equal(tabB.noteId, null);
    assert.equal(tabB.title, "Notes");
  });

  it("closeTab on the last remaining tab empties it instead of removing it", async () => {
    const n1 = note({ id: "n1" });
    const session = createNoteSession({ api: fakeApi({ n1 }) });
    await session.loadNoteInto("n1");
    const tabId = session.get().tabs[0].id;

    session.closeTab(tabId);

    const state = session.get();
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].id, tabId);
    assert.equal(state.tabs[0].noteId, null);
    assert.equal(state.activeNote, null);
    assert.equal(state.selectedNoteIds.size, 0);
  });

  it("closeTab of a non-active tab leaves the active tab and active note alone", async () => {
    const n1 = note({ id: "n1" });
    const n2 = note({ id: "n2" });
    const session = createNoteSession({ api: fakeApi({ n1, n2 }) });
    const tabA = session.get().tabs[0].id;
    await session.loadNoteInto("n1", tabA);
    session.openNewTab();
    const tabB = session.get().activeTabId;
    await session.loadNoteInto("n2", tabB);

    session.closeTab(tabA);

    const state = session.get();
    assert.equal(state.activeTabId, tabB);
    assert.equal(state.activeNote?.id, "n2");
    assert.equal(state.tabs.length, 1);
    assert.equal(state.tabs[0].id, tabB);
  });

  it("closeTab of the active tab loads the next tab's note, and nav is no longer suppressed once it settles", async () => {
    const n1 = note({ id: "n1" });
    const n2 = note({ id: "n2" });
    const session = createNoteSession({ api: fakeApi({ n1, n2 }) });
    const tabA = session.get().tabs[0].id;
    await session.loadNoteInto("n1", tabA);
    session.openNewTab();
    const tabB = session.get().activeTabId;
    await session.loadNoteInto("n2", tabB);
    // Switch back to A so it's the active tab being closed.
    await session.switchToTab(tabA);

    session.closeTab(tabA);
    await flushMicrotasks();

    const state = session.get();
    assert.equal(state.activeTabId, tabB);
    assert.equal(state.activeNote?.id, "n2");

    // Nav suppression must be lifted: a real move now records history.
    session.recordLocation();
    const before = session.get().navPast.length;
    session.setFilter({ type: "trash" });
    session.recordLocation();
    assert.equal(session.get().navPast.length, before + 1);
  });

  it("switchToTab round-trips: open note in tab A, new tab B, switch back to A and the note reloads", async () => {
    const n1 = note({ id: "n1", title: "A's note" });
    const n2 = note({ id: "n2", title: "B's note" });
    const session = createNoteSession({ api: fakeApi({ n1, n2 }) });
    const tabA = session.get().tabs[0].id;
    await session.loadNoteInto("n1", tabA);

    session.openNewTab();
    const tabB = session.get().activeTabId;
    assert.notEqual(tabB, tabA);
    await session.loadNoteInto("n2", tabB);
    assert.equal(session.get().activeNote?.id, "n2");

    await session.switchToTab(tabA);

    assert.equal(session.get().activeTabId, tabA);
    assert.equal(session.get().activeNote?.id, "n1");
  });

  it("recordLocation pushes history on a real move, and does not push while nav is suppressed or when the location is unchanged", async () => {
    const n1 = note({ id: "n1" });
    const n2 = note({ id: "n2" });
    const session = createNoteSession({ api: fakeApi({ n1, n2 }) });
    const tabA = session.get().tabs[0].id;
    await session.loadNoteInto("n1", tabA);
    session.recordLocation(); // seed

    session.openNewTab();
    const tabB = session.get().activeTabId;
    await session.loadNoteInto("n2", tabB);
    session.recordLocation(); // a real move: pushes
    const afterRealMove = session.get().navPast.length;
    assert.equal(afterRealMove > 0, true);

    session.recordLocation(); // same location again: no-op
    assert.equal(session.get().navPast.length, afterRealMove);

    // Mid-flight switchToTab suppresses nav until it settles.
    const pending = session.switchToTab(tabA);
    session.recordLocation(); // location changed (tab/filter), but suppressed
    assert.equal(session.get().navPast.length, afterRealMove);
    await pending;

    // Once settled, a genuinely new move pushes again.
    session.setFilter({ type: "trash" });
    session.recordLocation();
    assert.equal(session.get().navPast.length, afterRealMove + 1);
  });

  it("goBack / goForward walk past/future and return the applied location", () => {
    const session = createNoteSession({ api: fakeApi({}) });

    session.recordLocation(); // seed at { all, null }
    session.setFilter({ type: "trash" });
    session.recordLocation(); // push { all, null } -> past
    session.setFilter({ type: "templates" });
    session.recordLocation(); // push { trash, null } -> past

    assert.equal(session.get().navPast.length, 2);
    assert.equal(session.get().navFuture.length, 0);

    const back1 = session.goBack();
    assert.equal(back1?.filter.type, "trash");
    assert.equal(session.get().filter.type, "trash");
    assert.equal(session.get().navFuture.length, 1);

    const back2 = session.goBack();
    assert.equal(back2?.filter.type, "all");
    assert.equal(session.get().navPast.length, 0);
    assert.equal(session.get().navFuture.length, 2);

    const forward1 = session.goForward();
    assert.equal(forward1?.filter.type, "trash");
    assert.equal(session.get().filter.type, "trash");

    // Walk all the way back; once past is empty, goBack is a no-op.
    session.goBack();
    const noMoreBack = session.goBack();
    assert.equal(noMoreBack, null);
  });

  it("renameFilterTarget updates a non-active tab's cached filter, so switchToTab restores the new name", async () => {
    const session = createNoteSession({ api: fakeApi({}) });
    const tabA = session.get().tabs[0].id;
    session.setFilter({ type: "notebook", id: "nb1", name: "Old Name" });
    session.openNewTab(); // remembers tabA's filter, switches to a fresh tabB
    const tabB = session.get().activeTabId;
    assert.notEqual(tabB, tabA);

    session.renameFilterTarget("notebook", "nb1", "New Name");

    const tabAState = session.get().tabs.find((t) => t.id === tabA)!;
    assert.deepEqual(tabAState.filter, { type: "notebook", id: "nb1", name: "New Name" });

    await session.switchToTab(tabA);
    assert.deepEqual(session.get().filter, { type: "notebook", id: "nb1", name: "New Name" });
  });

  it("renameFilterTarget rewrites navPast entries so stepping back does not resurrect the old name", () => {
    const session = createNoteSession({ api: fakeApi({}) });
    session.recordLocation(); // seed at { all, null }
    session.setFilter({ type: "notebook", id: "nb1", name: "Old Name" });
    session.recordLocation(); // pushes { all, null } -> past
    session.setFilter({ type: "trash" });
    session.recordLocation(); // pushes { notebook/Old Name, null } -> past

    session.renameFilterTarget("notebook", "nb1", "New Name");

    const pastEntry = session.get().navPast.find((loc) => loc.filter.type === "notebook");
    assert.equal(pastEntry?.filter.name, "New Name");

    const back = session.goBack();
    assert.equal(back?.filter.type, "notebook");
    assert.equal(back?.filter.name, "New Name");
  });

  it("renameFilterTarget works the same way for a tag rename", async () => {
    const session = createNoteSession({ api: fakeApi({}) });
    const tabA = session.get().tabs[0].id;
    session.setFilter({ type: "tag", id: "t1", name: "Old Tag" });
    session.openNewTab();
    const tabB = session.get().activeTabId;
    assert.notEqual(tabB, tabA);

    session.renameFilterTarget("tag", "t1", "New Tag");

    const tabAState = session.get().tabs.find((t) => t.id === tabA)!;
    assert.deepEqual(tabAState.filter, { type: "tag", id: "t1", name: "New Tag" });

    await session.switchToTab(tabA);
    assert.deepEqual(session.get().filter, { type: "tag", id: "t1", name: "New Tag" });
  });

  it("renameFilterTarget leaves a different filter type or a different id untouched, preserving identity", () => {
    const session = createNoteSession({ api: fakeApi({}) });
    session.setTabs((current) => [
      ...current,
      { id: "tab-tag", noteId: null, title: "Tag Tab", filter: { type: "tag", id: "t1", name: "Keep Tag" } },
      {
        id: "tab-nb-other",
        noteId: null,
        title: "Other NB",
        filter: { type: "notebook", id: "nb-other", name: "Keep NB" },
      },
    ]);
    const before = session.get().tabs;

    session.renameFilterTarget("notebook", "nb1", "New Name");

    const after = session.get().tabs;
    assert.equal(after[0], before[0], "unrelated tab (all filter) keeps identity");
    assert.equal(
      after.find((t) => t.id === "tab-tag"),
      before.find((t) => t.id === "tab-tag"),
      "tag tab (different type) keeps identity"
    );
    assert.equal(
      after.find((t) => t.id === "tab-nb-other"),
      before.find((t) => t.id === "tab-nb-other"),
      "notebook tab with a different id keeps identity"
    );
  });

  it("renameFilterTarget does not push nav history or touch navFuture", () => {
    const session = createNoteSession({ api: fakeApi({}) });
    session.recordLocation(); // seed
    session.setFilter({ type: "notebook", id: "nb1", name: "Old Name" });
    session.recordLocation(); // push
    session.setFilter({ type: "trash" });
    session.recordLocation(); // push
    session.goBack(); // populate navFuture
    const pastBefore = session.get().navPast.length;
    const futureBefore = session.get().navFuture.length;
    assert.equal(futureBefore > 0, true);

    session.renameFilterTarget("notebook", "nb1", "New Name");

    assert.equal(session.get().navPast.length, pastBefore);
    assert.equal(session.get().navFuture.length, futureBefore);
  });

  it("renameFilterTarget rewrites the pending current location, not just navPast", () => {
    // navCurrent is a closure variable, not part of the observable state, so a
    // stale name parked there is invisible until the next recordLocation pushes
    // it into navPast - which is exactly how the original bug resurfaced.
    const session = createNoteSession({ api: fakeApi({}) });
    session.recordLocation(); // seed, navCurrent = { all, null }
    session.setFilter({ type: "notebook", id: "nb1", name: "Old Name" });
    session.recordLocation(); // navCurrent now caches notebook/"Old Name"

    session.renameFilterTarget("notebook", "nb1", "New Name");

    // Move away, which pushes the cached current location into navPast.
    session.setFilter({ type: "trash" });
    session.recordLocation();

    const back = session.goBack();
    assert.equal(back?.filter.type, "notebook");
    assert.equal(back?.filter.name, "New Name");
  });

  it("shift-click selects the range; meta-click toggles; plain click selects one", async () => {
    const n1 = note({ id: "n1" });
    const n2 = note({ id: "n2" });
    const n3 = note({ id: "n3" });
    const session = createNoteSession({ api: fakeApi({ n1, n2, n3 }) });
    const ordered = [{ id: "n1" }, { id: "n2" }, { id: "n3" }];

    session.clickNote("n1", { shift: false, meta: false }, ordered);
    await flushMicrotasks();
    assert.deepEqual([...session.get().selectedNoteIds], ["n1"]);
    assert.equal(session.get().activeNote?.id, "n1");

    session.clickNote("n3", { shift: true, meta: false }, ordered);
    assert.deepEqual([...session.get().selectedNoteIds].sort(), ["n1", "n2", "n3"]);

    session.clickNote("n2", { shift: false, meta: true }, ordered);
    assert.deepEqual([...session.get().selectedNoteIds].sort(), ["n1", "n3"]);
  });

  it("pruneSelection drops ids that left the list", () => {
    const session = createNoteSession({ api: fakeApi({}) });
    session.setSelectedNoteIds(new Set(["a", "b", "c"]));

    session.pruneSelection(["a", "c"]);

    assert.deepEqual([...session.get().selectedNoteIds].sort(), ["a", "c"]);

    const stable = session.get().selectedNoteIds;
    session.pruneSelection(["a", "c"]);
    assert.equal(session.get().selectedNoteIds, stable, "no-op prune must not replace the Set");
  });
});
