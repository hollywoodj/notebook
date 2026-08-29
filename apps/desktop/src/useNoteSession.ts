import { useSyncExternalStore } from "react";
import type { NoteSession, NoteSessionState } from "./noteSession";

/** Thin React binding over a `NoteSession`. Not unit-tested (needs React). */
export function useNoteSession(session: NoteSession): NoteSessionState {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
