import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SIDEBAR_FLYOUT_CLOSE_DELAY,
  createSidebarFlyout,
  type SidebarFlyoutClock,
} from "./sidebarFlyout.ts";

/** A hand-driven clock, so the close grace period is asserted rather than
 * slept through. `advance` fires everything that has come due. */
function fakeClock() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();

  const clock: SidebarFlyoutClock = {
    setTimeout(fn, ms) {
      const handle = nextHandle++;
      pending.set(handle, { at: now + ms, fn });
      return handle;
    },
    clearTimeout(handle) {
      pending.delete(handle);
    },
  };

  return {
    clock,
    advance(ms: number) {
      now += ms;
      for (const [handle, timer] of [...pending]) {
        if (timer.at <= now) {
          pending.delete(handle);
          timer.fn();
        }
      }
    },
    scheduled: () => pending.size,
  };
}

function setup() {
  const timers = fakeClock();
  const store = createSidebarFlyout({ clock: timers.clock });
  return { store, timers };
}

describe("sidebar flyout: hover and click", () => {
  it("previews a section on hover without pinning it", () => {
    const { store } = setup();
    store.preview("notebooks");
    assert.deepEqual(store.getSnapshot(), {
      flyout: "notebooks",
      pinned: false,
      filter: "",
      filterOpen: false,
    });
  });

  it("swaps the preview when the pointer moves to another section", () => {
    const { store } = setup();
    store.preview("notebooks");
    store.preview("tags");
    assert.equal(store.getSnapshot().flyout, "tags");
    assert.equal(store.getSnapshot().pinned, false);
  });

  it("refuses to let a hover replace a pinned panel", () => {
    const { store } = setup();
    store.open("notebooks");
    store.preview("tags");
    assert.equal(store.getSnapshot().flyout, "notebooks");
    assert.equal(store.getSnapshot().pinned, true);
  });

  it("pins a hovered preview when it is clicked", () => {
    const { store } = setup();
    store.preview("tags");
    store.open("tags");
    assert.equal(store.getSnapshot().flyout, "tags");
    assert.equal(store.getSnapshot().pinned, true);
  });

  it("toggles a pinned section shut when it is clicked again", () => {
    const { store } = setup();
    store.open("tags");
    store.setFilter("work");
    store.open("tags");
    assert.deepEqual(store.getSnapshot(), {
      flyout: null,
      pinned: false,
      filter: "",
      filterOpen: false,
    });
  });

  it("switches straight to another section when a different one is clicked", () => {
    const { store } = setup();
    store.open("tags");
    store.open("notebooks");
    assert.equal(store.getSnapshot().flyout, "notebooks");
    assert.equal(store.getSnapshot().pinned, true);
  });
});

describe("sidebar flyout: the filter belongs to its own section", () => {
  it("clears a typed filter when a click moves to another section", () => {
    const { store } = setup();
    store.open("notebooks");
    store.setFilter("recipes");
    store.open("tags");
    assert.equal(store.getSnapshot().filter, "");
    assert.equal(store.getSnapshot().filterOpen, false);
  });

  it("clears a typed filter when a hover moves to another section", () => {
    const { store } = setup();
    store.preview("notebooks");
    store.setFilter("recipes");
    store.preview("tags");
    assert.equal(store.getSnapshot().filter, "");
  });

  it("keeps the filter when the pointer re-enters the section already open", () => {
    const { store } = setup();
    store.preview("notebooks");
    store.setFilter("recipes");
    store.preview("notebooks");
    assert.equal(store.getSnapshot().filter, "recipes");
  });

  it("keeps the filter when a click pins the section already previewed", () => {
    const { store } = setup();
    store.preview("notebooks");
    store.setFilter("recipes");
    store.open("notebooks");
    assert.equal(store.getSnapshot().filter, "recipes");
    assert.equal(store.getSnapshot().pinned, true);
  });

  it("opens the filter box, then clears and closes it on the second toggle", () => {
    const { store } = setup();
    store.open("tags");
    assert.equal(store.toggleFilter(), true);
    assert.equal(store.getSnapshot().filterOpen, true);
    store.setFilter("home");
    assert.equal(store.toggleFilter(), false);
    assert.equal(store.getSnapshot().filter, "");
    assert.equal(store.getSnapshot().filterOpen, false);
  });

  it("treats leftover filter text as an open filter, so the toggle clears it first", () => {
    const { store } = setup();
    store.open("tags");
    store.setFilter("home");
    store.closeFilter();
    assert.equal(store.toggleFilter(), true);
  });

  it("closes the filter without disturbing the panel behind it", () => {
    const { store } = setup();
    store.openFilter("notebooks");
    store.setFilter("work");
    store.closeFilter();
    assert.deepEqual(store.getSnapshot(), {
      flyout: "notebooks",
      pinned: true,
      filter: "",
      filterOpen: false,
    });
  });

  it("opens a section with its filter box already showing", () => {
    const { store } = setup();
    store.openFilter("tags");
    assert.deepEqual(store.getSnapshot(), {
      flyout: "tags",
      pinned: true,
      filter: "",
      filterOpen: true,
    });
  });
});

describe("sidebar flyout: the close grace period", () => {
  it("keeps an unpinned panel open until the delay has fully elapsed", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY - 1);
    assert.equal(store.getSnapshot().flyout, "tags");
    timers.advance(1);
    assert.equal(store.getSnapshot().flyout, null);
  });

  it("clears the filter box along with the panel when the delay fires", () => {
    const { store, timers } = setup();
    store.preview("notebooks");
    store.toggleFilter();
    store.setFilter("recipes");
    store.scheduleClose();
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY);
    assert.deepEqual(store.getSnapshot(), {
      flyout: null,
      pinned: false,
      filter: "",
      filterOpen: false,
    });
  });

  it("cancels the close when the pointer reaches the panel in time", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY - 20);
    store.cancelClose();
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY);
    assert.equal(store.getSnapshot().flyout, "tags");
  });

  it("never schedules a close against a pinned panel", () => {
    const { store, timers } = setup();
    store.open("tags");
    store.scheduleClose();
    assert.equal(timers.scheduled(), 0);
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY * 10);
    assert.equal(store.getSnapshot().flyout, "tags");
  });

  it("leaves one timer pending however often the pointer crosses the edge", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    store.scheduleClose();
    store.scheduleClose();
    assert.equal(timers.scheduled(), 1);
  });

  it("holds the invariant that a pinned panel has no close pending against it", () => {
    const { store } = setup();
    store.preview("tags");
    store.scheduleClose();
    assert.equal(store.hasPendingClose(), true);
    store.open("tags");
    assert.equal(store.getSnapshot().pinned, true);
    assert.equal(store.hasPendingClose(), false);
  });

  it("does not resurrect a panel that was closed while its timer was pending", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    store.close();
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY);
    assert.equal(store.getSnapshot().flyout, null);
    assert.equal(timers.scheduled(), 0);
  });
});

describe("sidebar flyout: opening from the menu bar, palette, and keyboard", () => {
  it("opens pinned from nothing", () => {
    const { store } = setup();
    store.reveal("notebooks");
    assert.equal(store.getSnapshot().flyout, "notebooks");
    assert.equal(store.getSnapshot().pinned, true);
  });

  it("survives a hover-close that was already pending when it was invoked", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    store.reveal("notebooks");
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY);
    assert.equal(store.getSnapshot().flyout, "notebooks");
    assert.equal(store.getSnapshot().pinned, true);
  });

  it("survives a pending hover-close when opened with its filter", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    store.openFilter("notebooks");
    timers.advance(SIDEBAR_FLYOUT_CLOSE_DELAY);
    assert.equal(store.getSnapshot().flyout, "notebooks");
    assert.equal(store.getSnapshot().filterOpen, true);
  });
});

describe("sidebar flyout: closing and teardown", () => {
  it("resets every piece of state, so nothing is left behind for the next open", () => {
    const { store } = setup();
    store.openFilter("notebooks");
    store.setFilter("recipes");
    store.close();
    assert.deepEqual(store.getSnapshot(), {
      flyout: null,
      pinned: false,
      filter: "",
      filterOpen: false,
    });
  });

  it("drops a pending close on dispose, so no timer fires after unmount", () => {
    const { store, timers } = setup();
    store.preview("tags");
    store.scheduleClose();
    store.dispose();
    assert.equal(timers.scheduled(), 0);
  });
});

describe("sidebar flyout: subscribers", () => {
  it("holds the snapshot identity stable across no-ops, as useSyncExternalStore requires", () => {
    const { store } = setup();
    store.reveal("tags");
    const first = store.getSnapshot();
    store.reveal("tags");
    assert.equal(store.getSnapshot(), first);
    store.setFilter("");
    assert.equal(store.getSnapshot(), first);
    store.preview("notebooks");
    assert.equal(store.getSnapshot(), first);
    store.setFilter("work");
    assert.notEqual(store.getSnapshot(), first);
  });

  it("notifies once per real change and not at all for a no-op", () => {
    const { store } = setup();
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.open("tags");
    assert.equal(notifications, 1);
    store.open("tags");
    assert.equal(notifications, 2);
    store.close();
    assert.equal(notifications, 2);
    unsubscribe();
    store.open("notebooks");
    assert.equal(notifications, 2);
  });
});
