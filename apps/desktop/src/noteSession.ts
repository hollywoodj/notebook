/**
 * Owns the "open a note" invariant: tabs + active note + selection + filter
 * + nav history, all as one external store. `App.tsx` used to write this
 * longhand at six different sites, and `closeTab` had five exit paths that
 * each had to remember to reset `ignoreNavRef` - moving it here means there
 * is exactly one place that gets it right.
 *
 * Same idiom as `noteStore.ts`: factory + subscribe/getSnapshot + a
 * module-level singleton + no runtime React import, so this stays testable
 * under `node --test` without jsdom. `useNoteSession.ts` is the thin React
 * binding.
 *
 * This is an external store with SYNCHRONOUS mutation, not a `useReducer`.
 * `ignoreNav`, `skipNextSave`, `navSeeded`, `navCurrent` and
 * `lastClickedNoteId` are plain closure variables - never part of the
 * reactive snapshot - because their correctness depends on being read/set
 * synchronously between `await` boundaries. Putting any of them into React
 * state would change their timing and break nav history.
 */
import { api as productionApi } from "./api.ts";
import type { Note, ViewFilter } from "./api.ts";
import { makeNoteTab, type NoteTab } from "./appTypes.ts";
import { noteIdsInRange, pruneNoteIds, toggleNoteId } from "./noteSelection.ts";
import { nextActiveTabId, noteTabLabel, reorderById } from "./ui/tabs.ts";
import {
  pushNavHistory,
  sameNavLocation,
  stepNavBack,
  stepNavForward,
  type NavLocation,
} from "./ui/navigation.ts";

export interface NoteSessionState {
  tabs: NoteTab[];
  activeTabId: string;
  activeNote: Note | null;
  selectedNoteIds: Set<string>;
  filter: ViewFilter;
  navPast: NavLocation[];
  navFuture: NavLocation[];
}

export type NoteSessionApi = { getNote: (id: string) => Promise<Note> };

type Updater<T> = T | ((prev: T) => T);

function resolve<T>(value: Updater<T>, prev: T): T {
  return typeof value === "function" ? (value as (prev: T) => T)(prev) : value;
}

export function createNoteSession({ api }: { api: NoteSessionApi }) {
  const initialTabs = [makeNoteTab()];

  let state: NoteSessionState = {
    tabs: initialTabs,
    activeTabId: initialTabs[0].id,
    activeNote: null,
    selectedNoteIds: new Set<string>(),
    filter: { type: "all" },
    navPast: [],
    navFuture: [],
  };

  // Non-reactive internals - direct replacements for the old mirror refs.
  // Never read through getSnapshot(); never put into React state.
  let lastClickedNoteId: string | null = null;
  let skipNextSave = false;
  let ignoreNav = false;
  let navSeeded = false;
  let navCurrent: NavLocation = { filter: { type: "all" }, noteId: null };

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
   * Reactive state is one snapshot object; this returns it by identity.
   * Every mutation replaces it wholesale via `setState`. A verb that
   * changes nothing must not call `setState`, or `useSyncExternalStore`
   * will loop forever - same discipline as `noteStore.getSnapshot`'s
   * identity cache.
   */
  function getSnapshot(): NoteSessionState {
    return state;
  }

  function setState(patch: Partial<NoteSessionState>): void {
    state = { ...state, ...patch };
    notify();
  }

  /** Synchronous read of the whole snapshot, for call sites that need a
   * value right now rather than through the React binding. */
  function get(): NoteSessionState {
    return state;
  }

  /** Drop-in `MutableRefObject<string | null>` so `createNoteActions` (which
   * expects a ref) needs no change at all. */
  const lastClickedNoteIdRef = {
    get current() {
      return lastClickedNoteId;
    },
    set current(v: string | null) {
      lastClickedNoteId = v;
    },
  };

  function consumeSkipNextSave(): boolean {
    const value = skipNextSave;
    skipNextSave = false;
    return value;
  }

  function markSkipNextSave(): void {
    skipNextSave = true;
  }

  // ---- Plain setters (mirror the useState setters they replace) --------

  function setActiveNote(v: Updater<Note | null>): void {
    setState({ activeNote: resolve(v, state.activeNote) });
  }
  function setSelectedNoteIds(v: Updater<Set<string>>): void {
    setState({ selectedNoteIds: resolve(v, state.selectedNoteIds) });
  }
  function setTabs(v: Updater<NoteTab[]>): void {
    setState({ tabs: resolve(v, state.tabs) });
  }
  function setActiveTabId(id: string): void {
    setState({ activeTabId: id });
  }
  function setFilter(v: Updater<ViewFilter>): void {
    setState({ filter: resolve(v, state.filter) });
  }
  function setNavPast(v: Updater<NavLocation[]>): void {
    setState({ navPast: resolve(v, state.navPast) });
  }
  function setNavFuture(v: Updater<NavLocation[]>): void {
    setState({ navFuture: resolve(v, state.navFuture) });
  }

  /** Only replaces `tabs` if the recomputed array actually differs, so
   * effect-driven verbs (dropMissingTabs, syncActiveTabTitle, ...) never
   * bump the snapshot identity for a no-op. */
  function setTabsIfChanged(next: NoteTab[]): void {
    if (next === state.tabs) return;
    const changed =
      next.length !== state.tabs.length || next.some((tab, i) => tab !== state.tabs[i]);
    if (changed) setTabs(next);
  }

  /**
   * Renames a `notebook` or `tag` filter target everywhere its `name` is
   * cached: `state.filter`, every `tab.filter`, every `NavLocation` in
   * `navPast`/`navFuture`, and the closure-level `navCurrent`. This is a
   * rename of something already being viewed, not a navigation, so it must
   * NOT go through `setFilter`/`recordLocation` - that would push a history
   * entry and clear `navFuture`. It writes state directly (through the one
   * `setState` call below) so subscribers still get notified.
   *
   * Entries that don't match `kind`+`id` keep their exact object identity,
   * so unrelated tabs don't re-render.
   */
  function renameFilterTarget(kind: "notebook" | "tag", id: string, name: string): void {
    function renameFilter(filter: ViewFilter): ViewFilter {
      if (filter.type === "notebook" && kind === "notebook" && filter.id === id) {
        return { ...filter, name };
      }
      if (filter.type === "tag" && kind === "tag" && filter.id === id) {
        return { ...filter, name };
      }
      return filter;
    }
    function renameLocation(location: NavLocation): NavLocation {
      if (location.filter.type !== kind || location.filter.id !== id) return location;
      return { ...location, filter: { ...location.filter, name } };
    }

    const nextFilter = renameFilter(state.filter);
    const nextTabs = state.tabs.map((tab) => {
      const nextTabFilter = renameFilter(tab.filter);
      return nextTabFilter === tab.filter ? tab : { ...tab, filter: nextTabFilter };
    });
    const nextPast = state.navPast.map(renameLocation);
    const nextFuture = state.navFuture.map(renameLocation);

    navCurrent = renameLocation(navCurrent);

    setState({ filter: nextFilter, tabs: nextTabs, navPast: nextPast, navFuture: nextFuture });
  }

  // ---- The nine verbs ----------------------------------------------------

  function openNote(note: Note, tabId?: string): void {
    const targetTabId = tabId ?? state.activeTabId;
    lastClickedNoteId = note.id;
    setState({
      activeNote: note,
      selectedNoteIds: new Set([note.id]),
      tabs: state.tabs.map((tab) =>
        tab.id === targetTabId
          ? { ...tab, noteId: note.id, title: noteTabLabel(note.title, true), filter: state.filter }
          : tab
      ),
    });
  }

  function clearNote(): void {
    skipNextSave = true;
    lastClickedNoteId = null;
    setState({ activeNote: null, selectedNoteIds: new Set() });
  }

  async function loadNoteInto(id: string, tabId?: string): Promise<void> {
    skipNextSave = true;
    const note = await api.getNote(id);
    openNote(note, tabId);
  }

  function rememberCurrentTab(): void {
    const currentId = state.activeTabId;
    const note = state.activeNote;
    const currentFilter = state.filter;
    const next = state.tabs.map((tab) =>
      tab.id === currentId
        ? {
            ...tab,
            filter: currentFilter,
            noteId: note?.id ?? null,
            title: noteTabLabel(note?.title, Boolean(note)),
          }
        : tab
    );
    setTabsIfChanged(next);
  }

  async function switchToTab(tabId: string): Promise<void> {
    if (tabId === state.activeTabId) return;
    ignoreNav = true;
    rememberCurrentTab();
    const next = state.tabs.find((tab) => tab.id === tabId);
    if (!next) {
      ignoreNav = false;
      return;
    }
    setActiveTabId(tabId);
    setFilter(next.filter);
    if (next.noteId) {
      await loadNoteInto(next.noteId, tabId);
      navCurrent = { filter: next.filter, noteId: next.noteId };
      ignoreNav = false;
      return;
    }
    clearNote();
    navCurrent = { filter: next.filter, noteId: null };
    ignoreNav = false;
  }

  function openNewTab(): void {
    ignoreNav = true;
    rememberCurrentTab();
    const tab = makeNoteTab({ filter: { type: "all" } });
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    setFilter({ type: "all" });
    clearNote();
    navCurrent = { filter: { type: "all" }, noteId: null };
    ignoreNav = false;
  }

  function closeTab(tabId: string): void {
    const currentTabs = state.tabs;
    const closing = currentTabs.find((tab) => tab.id === tabId);
    if (!closing) return;
    ignoreNav = true;

    // Every exit path below funnels through this single reset point,
    // instead of five copies that can each forget to flip it back.
    const finish = () => {
      ignoreNav = false;
    };

    if (currentTabs.length === 1) {
      clearNote();
      const emptied = { ...closing, noteId: null, title: noteTabLabel(null, false) };
      setTabs([emptied]);
      navCurrent = { filter: state.filter, noteId: null };
      finish();
      return;
    }

    const remaining = currentTabs.filter((tab) => tab.id !== tabId);
    const nextId = nextActiveTabId(currentTabs.map((tab) => tab.id), tabId, state.activeTabId);
    setTabs(remaining);
    if (!nextId || nextId === state.activeTabId) {
      finish();
      return;
    }
    const next = remaining.find((tab) => tab.id === nextId);
    if (!next) {
      finish();
      return;
    }
    setActiveTabId(next.id);
    setFilter(next.filter);
    if (next.noteId) {
      void loadNoteInto(next.noteId, next.id).then(() => {
        navCurrent = { filter: next.filter, noteId: next.noteId };
        finish();
      });
      return;
    }
    clearNote();
    navCurrent = { filter: next.filter, noteId: null };
    finish();
  }

  async function openInNewTab(noteId: string, fallbackTitle?: string): Promise<void> {
    const existing = state.tabs.find((tab) => tab.noteId === noteId);
    if (existing) {
      await switchToTab(existing.id);
      return;
    }
    rememberCurrentTab();
    const tab = makeNoteTab({
      noteId,
      title: fallbackTitle,
      filter: state.filter,
    });
    setTabs((current) => [...current, tab]);
    setActiveTabId(tab.id);
    await loadNoteInto(noteId, tab.id);
  }

  // ---- Selection ----------------------------------------------------------

  function clickNote(
    noteId: string,
    mods: { shift: boolean; meta: boolean },
    orderedNoteIds: { id: string }[]
  ): void {
    if (mods.shift) {
      setSelectedNoteIds(new Set(noteIdsInRange(orderedNoteIds, lastClickedNoteId, noteId)));
      return;
    }
    if (mods.meta) {
      setSelectedNoteIds((prev) => toggleNoteId(prev, noteId));
      lastClickedNoteId = noteId;
      return;
    }
    lastClickedNoteId = noteId;
    setSelectedNoteIds(new Set([noteId]));
    void loadNoteInto(noteId);
  }

  function dragSelectTo(anchorId: string, noteId: string, orderedNoteIds: { id: string }[]): void {
    lastClickedNoteId = anchorId;
    setSelectedNoteIds(new Set(noteIdsInRange(orderedNoteIds, anchorId, noteId)));
  }

  function selectAll(ids: string[]): void {
    setSelectedNoteIds(new Set(ids));
  }

  function selectActiveOnly(): void {
    setSelectedNoteIds(state.activeNote ? new Set([state.activeNote.id]) : new Set());
  }

  function pruneSelection(visibleIds: Iterable<string>): void {
    const next = pruneNoteIds(state.selectedNoteIds, visibleIds);
    if (next !== state.selectedNoteIds) setSelectedNoteIds(next);
  }

  // ---- Nav ------------------------------------------------------------

  function currentNavLocation(): NavLocation {
    return { filter: state.filter, noteId: state.activeNote?.id ?? null };
  }

  function recordLocation(): void {
    const next: NavLocation = { filter: state.filter, noteId: state.activeNote?.id ?? null };
    if (!navSeeded) {
      navSeeded = true;
      navCurrent = next;
      return;
    }
    if (sameNavLocation(navCurrent, next)) {
      navCurrent = next;
      return;
    }
    if (ignoreNav) {
      navCurrent = next;
      return;
    }
    const pushed = pushNavHistory(state.navPast, navCurrent, next);
    navCurrent = next;
    if (!pushed) return;
    setState({ navPast: pushed.past, navFuture: pushed.future });
  }

  /** Maps a `NavLocation` onto real session state (filter + note load) and
   * returns the location as actually applied, so callers driving chrome the
   * session doesn't own (the search input) can react to it. Used by
   * goBack/goForward and by App's last-session restore on boot. */
  function applyNavLocation(location: NavLocation): NavLocation {
    ignoreNav = true;
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
    } else if (location.filter.type === "files") {
      nextFilter = { type: "files" };
    } else if (location.filter.type === "trash") {
      nextFilter = { type: "trash" };
    }
    setFilter(nextFilter);
    const applied: NavLocation = { filter: nextFilter, noteId: location.noteId };
    navCurrent = applied;
    if (location.noteId) {
      void loadNoteInto(location.noteId).finally(() => {
        navCurrent = applied;
        ignoreNav = false;
      });
      return applied;
    }
    clearNote();
    ignoreNav = false;
    return applied;
  }

  function goBack(): NavLocation | null {
    const stepped = stepNavBack(state.navPast, currentNavLocation(), state.navFuture);
    if (!stepped) return null;
    setState({ navPast: stepped.past, navFuture: stepped.future });
    return applyNavLocation(stepped.current);
  }

  function goForward(): NavLocation | null {
    const stepped = stepNavForward(state.navPast, currentNavLocation(), state.navFuture);
    if (!stepped) return null;
    setState({ navPast: stepped.past, navFuture: stepped.future });
    return applyNavLocation(stepped.current);
  }

  // ---- Tabs driven by App effects ---------------------------------------

  function dropMissingTabs(visibleNoteIds: Iterable<string>): void {
    const noteIds = new Set(visibleNoteIds);
    const next = state.tabs.map((tab) =>
      tab.noteId && !noteIds.has(tab.noteId)
        ? { ...tab, noteId: null, title: noteTabLabel(null, false) }
        : tab
    );
    setTabsIfChanged(next);
  }

  function syncActiveTabTitle(): void {
    const note = state.activeNote;
    if (!note) return;
    const next = state.tabs.map((tab) =>
      tab.id === state.activeTabId && tab.noteId === note.id
        ? { ...tab, title: noteTabLabel(note.title, true) }
        : tab
    );
    setTabsIfChanged(next);
  }

  function reorderTabs(fromId: string, toId: string): void {
    const next = reorderById(state.tabs, fromId, toId);
    if (next !== state.tabs) setTabs(next);
  }

  return {
    subscribe,
    getSnapshot,
    get,
    lastClickedNoteIdRef,
    consumeSkipNextSave,
    markSkipNextSave,
    setActiveNote,
    setSelectedNoteIds,
    setTabs,
    setActiveTabId,
    setFilter,
    setNavPast,
    setNavFuture,
    renameFilterTarget,
    openNote,
    clearNote,
    loadNoteInto,
    switchToTab,
    openNewTab,
    closeTab,
    openInNewTab,
    clickNote,
    dragSelectTo,
    selectAll,
    selectActiveOnly,
    pruneSelection,
    recordLocation,
    applyNavLocation,
    goBack,
    goForward,
    rememberCurrentTab,
    dropMissingTabs,
    syncActiveTabTitle,
    reorderTabs,
  };
}

export type NoteSession = ReturnType<typeof createNoteSession>;

export const noteSession = createNoteSession({ api: productionApi });
