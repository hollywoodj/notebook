export const NOTE_TAB_DRAG_TYPE = "application/x-notebook-tab";

function newNoteTabId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createNoteTab(init?: { noteId?: string | null; title?: string }): {
  id: string;
  noteId: string | null;
  title: string;
} {
  const noteId = init?.noteId ?? null;
  return {
    id: newNoteTabId(),
    noteId,
    title: noteTabLabel(init?.title, Boolean(noteId)),
  };
}

export function noteTabLabel(title: string | null | undefined, hasNote: boolean): string {
  if (!hasNote) return "Notes";
  const cleaned = (title || "").trim();
  return cleaned || "Untitled";
}

export function nextActiveTabId(
  tabIds: string[],
  closingId: string,
  activeId: string
): string | null {
  if (tabIds.length <= 1) return tabIds[0] ?? null;
  const remaining = tabIds.filter((id) => id !== closingId);
  if (!remaining.length) return null;
  if (activeId !== closingId && remaining.includes(activeId)) return activeId;
  const index = tabIds.indexOf(closingId);
  const fallback = Math.min(Math.max(index, 0), remaining.length - 1);
  return remaining[fallback] ?? remaining[0];
}

export function reorderById<T extends { id: string }>(
  items: T[],
  fromId: string,
  toId: string
): T[] {
  const from = items.findIndex((item) => item.id === fromId);
  const to = items.findIndex((item) => item.id === toId);
  if (from < 0 || to < 0 || from === to) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

export const CLOSED_TABS_LIMIT = 12;

export function rememberClosedTab<T>(stack: T[], closed: T, limit = CLOSED_TABS_LIMIT): T[] {
  return [closed, ...stack].slice(0, limit);
}

export function popClosedTab<T>(stack: T[]): { item: T; remaining: T[] } | null {
  if (!stack.length) return null;
  return { item: stack[0], remaining: stack.slice(1) };
}

export function pinTabById<T extends { id: string; pinned?: boolean }>(
  tabs: T[],
  id: string
): T[] {
  return tabs.map((tab) => (tab.id === id ? { ...tab, pinned: !tab.pinned } : tab));
}

export function closeOtherTabIds(tabIds: string[], keepId: string): string[] {
  return tabIds.filter((id) => id !== keepId);
}

export function closeTabsToTheRight(tabIds: string[], fromId: string): string[] {
  const index = tabIds.indexOf(fromId);
  if (index < 0) return [];
  return tabIds.slice(index + 1);
}

export function closeAllUnpinnedTabIds<T extends { id: string; pinned?: boolean }>(
  tabs: T[]
): string[] {
  return tabs.filter((tab) => !tab.pinned).map((tab) => tab.id);
}
