export function noteIdsInRange<T extends { id: string }>(
  items: T[],
  anchorId: string | null,
  clickedId: string
): string[] {
  if (!anchorId) return [clickedId];
  const anchorIdx = items.findIndex((item) => item.id === anchorId);
  const clickIdx = items.findIndex((item) => item.id === clickedId);
  if (anchorIdx === -1 || clickIdx === -1) return [clickedId];
  const start = Math.min(anchorIdx, clickIdx);
  const end = Math.max(anchorIdx, clickIdx);
  return items.slice(start, end + 1).map((item) => item.id);
}

export function toggleNoteId(selected: Set<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

export function pruneNoteIds(selected: Set<string>, visibleIds: Iterable<string>): Set<string> {
  const visible = new Set(visibleIds);
  const pruned = new Set([...selected].filter((id) => visible.has(id)));
  return pruned.size === selected.size ? selected : pruned;
}

export function batchConfirmMessage(
  action: "trash" | "permanent",
  count: number,
  title: string
): string {
  if (action === "permanent") {
    return count === 1
      ? `Delete “${title}” forever?`
      : `Delete ${count} notes forever?`;
  }
  return count === 1
    ? `Move “${title}” to Trash?`
    : `Move ${count} notes to Trash?`;
}
