import { useSyncExternalStore } from "react";
import type { SidebarFlyoutState, SidebarFlyoutStore } from "./sidebarFlyout";

/** Thin React binding over a `SidebarFlyoutStore`. Not unit-tested (needs React). */
export function useSidebarFlyout(store: SidebarFlyoutStore): SidebarFlyoutState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
