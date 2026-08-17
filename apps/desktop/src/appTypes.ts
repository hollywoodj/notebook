import type { Note, Notebook, NoteSummary, Preferences, Stack, Tag, ViewFilter } from "./api.ts";
import { createNoteTab } from "./uiChrome.ts";

export type ContextTarget =
  | { kind: "note"; x: number; y: number; note: NoteSummary }
  | { kind: "notebook"; x: number; y: number; notebook: Notebook }
  | { kind: "stack"; x: number; y: number; stack: Stack }
  | { kind: "tag"; x: number; y: number; tag: Tag }
  | { kind: "sidebar"; x: number; y: number };

export type RenameTarget =
  | { kind: "notebook"; id: string; name: string }
  | { kind: "stack"; id: string; name: string }
  | { kind: "tag"; id: string; name: string };

export type NoteTab = {
  id: string;
  noteId: string | null;
  title: string;
  filter: ViewFilter;
};

export type PendingConfirm = {
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (ok: boolean) => void;
};

export function makeNoteTab(init?: Partial<NoteTab>): NoteTab {
  return {
    ...createNoteTab(init),
    filter: init?.filter ?? { type: "all" },
  };
}

export function formatDate(iso: string, format: Preferences["date_format"]) {
  const options: Intl.DateTimeFormatOptions =
    format === "short"
      ? { month: "numeric", day: "numeric" }
      : format === "long"
        ? { weekday: "short", month: "long", day: "numeric", year: "numeric" }
        : { month: "short", day: "numeric", year: "numeric" };
  return new Date(iso).toLocaleDateString(undefined, options);
}

export function applyTheme(theme: Preferences["theme"]) {
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function isBlankNote(note: Note) {
  const text = note.content_plain?.trim() || note.content.replace(/<[^>]+>/g, "").trim();
  return (!note.title || note.title === "Untitled") && text.length === 0;
}

export function isTextInputFocused() {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el instanceof HTMLElement && el.isContentEditable;
}
