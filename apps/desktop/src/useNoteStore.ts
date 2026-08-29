import { useSyncExternalStore } from "react";
import type { NoteStore, StoreKey, StoreState } from "./noteStore";

/** Thin React binding over a `NoteStore` key. Not unit-tested (needs React). */
export function useNoteStore<K extends StoreKey>(store: NoteStore, key: K): StoreState<K> {
  const getSnapshot = () => store.getSnapshot(key);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}
