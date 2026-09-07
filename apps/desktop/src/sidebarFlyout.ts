/**
 * Owns the sidebar flyout state machine: which section is open, whether a
 * click pinned it, the filter box beside it, and the 220ms grace period that
 * lets the pointer travel from a nav button to the panel without the panel
 * vanishing underneath it.
 *
 * This lived as five closures over `useState` inside `App.tsx`, where the
 * only thing guarding it was a set of regex source-greps in
 * `App.hooks.test.ts` - they check the JSX is wired up, not that the machine
 * behaves. Four pieces of state plus a timer is exactly the shape that goes
 * wrong quietly, so it moves here.
 *
 * Same idiom as `noteSession.ts` and `noteStore.ts`: factory +
 * subscribe/getSnapshot + a module-level singleton + no runtime React
 * import, so it stays testable under `node --test` without jsdom.
 * `useSidebarFlyout.ts` is the thin React binding.
 *
 * The clock is injected rather than calling `window` directly - that is what
 * makes the hover timer assertable instead of a real 220ms sleep in the test
 * suite.
 */
import {
  sidebarFlyoutAfterClick,
  sidebarFlyoutAfterHover,
  type SidebarFlyout,
  type SidebarFlyoutKind,
} from "./ui/sidebar.ts";

/** How long an unpinned panel survives after the pointer leaves it.
 * Long enough to cross the rail border onto the panel; short enough that a
 * skim of the icons does not leave a panel hanging. Evernote’s hover panel
 * uses a similar grace period. */
export const SIDEBAR_FLYOUT_CLOSE_DELAY = 220;

export interface SidebarFlyoutState {
  flyout: SidebarFlyout;
  pinned: boolean;
  filter: string;
  filterOpen: boolean;
}

export interface SidebarFlyoutClock {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
}

/** Resolved lazily off `globalThis` so importing this module never touches
 * `window` - `node --test` has no DOM. */
const defaultClock: SidebarFlyoutClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle as unknown as number),
};

export function createSidebarFlyout({
  clock = defaultClock,
  delay = SIDEBAR_FLYOUT_CLOSE_DELAY,
}: { clock?: SidebarFlyoutClock; delay?: number } = {}) {
  let state: SidebarFlyoutState = {
    flyout: null,
    pinned: false,
    filter: "",
    filterOpen: false,
  };

  let closeHandle: number | null = null;
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

  function getSnapshot(): SidebarFlyoutState {
    return state;
  }

  /** Keeps the snapshot referentially stable when an action changes nothing,
   * which `useSyncExternalStore` requires to avoid an infinite render loop. */
  function setState(patch: Partial<SidebarFlyoutState>): void {
    const next = { ...state, ...patch };
    if (
      next.flyout === state.flyout &&
      next.pinned === state.pinned &&
      next.filter === state.filter &&
      next.filterOpen === state.filterOpen
    ) {
      return;
    }
    state = next;
    notify();
  }

  /** A filter typed into one section should not follow you into the next. */
  function withFilterResetIfSectionChanged(
    next: SidebarFlyout
  ): Partial<SidebarFlyoutState> {
    return next === state.flyout ? {} : { filter: "", filterOpen: false };
  }

  function cancelClose(): void {
    if (closeHandle === null) return;
    clock.clearTimeout(closeHandle);
    closeHandle = null;
  }

  /** Hover previews a section unless a click already pinned one open. */
  function preview(kind: SidebarFlyoutKind): void {
    cancelClose();
    const next = sidebarFlyoutAfterHover(state.flyout, state.pinned, kind);
    setState({
      flyout: next.flyout,
      pinned: next.pinned,
      ...withFilterResetIfSectionChanged(next.flyout),
    });
  }

  /** Click pins a preview, switches sections, or toggles the pinned one shut. */
  function open(kind: SidebarFlyoutKind): void {
    cancelClose();
    const next = sidebarFlyoutAfterClick(state.flyout, state.pinned, kind);
    if (!next.flyout) {
      close();
      return;
    }
    setState({
      flyout: next.flyout,
      pinned: next.pinned,
      ...withFilterResetIfSectionChanged(next.flyout),
    });
  }

  /** Forced open + pinned, for the menu bar, palette, and keyboard entries
   * that do not come from a hover. Cancels a pending hover-close: without
   * that, a menu opened within the grace period is closed again by a timer
   * the user has already stopped interacting with. */
  function reveal(kind: SidebarFlyoutKind): void {
    cancelClose();
    setState({ flyout: kind, pinned: true });
  }

  /** Reveal a section with its filter box already open (the caller focuses
   * the input - this store owns no DOM). */
  function openFilter(kind: SidebarFlyoutKind): void {
    cancelClose();
    setState({ flyout: kind, pinned: true, filterOpen: true });
  }

  /** Returns true when the filter box was opened, so the caller knows
   * whether to focus the input. */
  function toggleFilter(): boolean {
    if (state.filterOpen || state.filter.trim()) {
      setState({ filter: "", filterOpen: false });
      return false;
    }
    setState({ filterOpen: true });
    return true;
  }

  function setFilter(filter: string): void {
    setState({ filter });
  }

  function closeFilter(): void {
    setState({ filter: "", filterOpen: false });
  }

  /** Pointer left an unpinned panel: close it after the grace period. A
   * pinned panel stays until it is dismissed explicitly. */
  function scheduleClose(): void {
    cancelClose();
    if (state.pinned) return;
    closeHandle = clock.setTimeout(() => {
      closeHandle = null;
      setState({ flyout: null, filter: "", filterOpen: false });
    }, delay);
  }

  function close(): void {
    cancelClose();
    setState({ flyout: null, pinned: false, filter: "", filterOpen: false });
  }

  /** For the unmount effect - a timer that fires after teardown would set
   * state on a dead component. */
  function dispose(): void {
    cancelClose();
  }

  /** Test-only view of the timer. The invariant worth holding is that a
   * pinned panel never has a close pending against it. */
  function hasPendingClose(): boolean {
    return closeHandle !== null;
  }

  return {
    subscribe,
    getSnapshot,
    preview,
    open,
    reveal,
    openFilter,
    toggleFilter,
    setFilter,
    closeFilter,
    scheduleClose,
    cancelClose,
    close,
    dispose,
    hasPendingClose,
  };
}

export type SidebarFlyoutStore = ReturnType<typeof createSidebarFlyout>;

export const sidebarFlyout = createSidebarFlyout();
