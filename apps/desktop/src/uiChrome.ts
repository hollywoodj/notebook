export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const LIST_MIN = 220;
export const LIST_MAX = 560;
export const DEFAULT_SIDEBAR_WIDTH = 248;
export const DEFAULT_LIST_WIDTH = 320;
export const PANE_LAYOUT_KEY = "notebook.paneLayout";
export const NOTE_DRAG_TYPE = "application/x-notebook-notes";

export interface PaneLayout {
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
}

export function clampPaneWidth(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function defaultPaneLayout(): PaneLayout {
  return {
    sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
    listWidth: DEFAULT_LIST_WIDTH,
    sidebarCollapsed: false,
  };
}

export function parsePaneLayout(raw: string | null): PaneLayout {
  const fallback = defaultPaneLayout();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<PaneLayout>;
    return {
      sidebarWidth: clampPaneWidth(
        Number(parsed.sidebarWidth),
        SIDEBAR_MIN,
        SIDEBAR_MAX
      ),
      listWidth: clampPaneWidth(Number(parsed.listWidth), LIST_MIN, LIST_MAX),
      sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
    };
  } catch {
    return fallback;
  }
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

export function findMatchOffsets(text: string, query: string): number[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hay = text.toLowerCase();
  const offsets: number[] = [];
  let from = 0;
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from);
    if (idx < 0) break;
    offsets.push(idx);
    from = idx + needle.length;
  }
  return offsets;
}

export function nextMatchIndex(count: number, current: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}

export function adjacentNoteId<T extends { id: string }>(
  notes: T[],
  currentId: string | null,
  direction: -1 | 1
): string | null {
  if (notes.length === 0) return null;
  if (!currentId) return notes[0].id;
  const idx = notes.findIndex((note) => note.id === currentId);
  if (idx < 0) return notes[0].id;
  const next = idx + direction;
  if (next < 0 || next >= notes.length) return currentId;
  return notes[next].id;
}

export function toDatetimeLocalValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDatetimeLocalValue(value: string): string | null {
  if (!value.trim()) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function isReminderOverdue(iso: string | null, now = new Date()): boolean {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  return date.getTime() < now.getTime();
}

export function formatReminderLabel(
  iso: string,
  format: "short" | "medium" | "long" = "medium"
): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const datePart =
    format === "short"
      ? date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
      : format === "long"
        ? date.toLocaleDateString(undefined, {
            weekday: "short",
            month: "long",
            day: "numeric",
          })
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${datePart}, ${timePart}`;
}

export function noteAppLink(id: string): string {
  return `notebook://note/${id}`;
}

export function encodeNoteDrag(ids: string[]): string {
  return JSON.stringify(ids);
}

export function decodeNoteDrag(data: string): string[] {
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function suggestedTags(
  tags: { id: string; name: string }[],
  query: string,
  excludeIds: Iterable<string>
): { id: string; name: string }[] {
  const excluded = new Set(excludeIds);
  const needle = query.trim().toLowerCase();
  return tags
    .filter((tag) => !excluded.has(tag.id))
    .filter((tag) => !needle || tag.name.toLowerCase().includes(needle))
    .slice(0, 8);
}
