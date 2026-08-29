/** Sidebar sections whose contents open in a panel beside the sidebar. */
export type SidebarFlyoutKind = "shortcuts" | "notebooks" | "tags";
export type SidebarFlyout = SidebarFlyoutKind | null;

export type SidebarFlyoutInteraction = {
  flyout: SidebarFlyout;
  pinned: boolean;
};

/** Hover swaps the preview unless a click-pinned panel is already open. */
export function sidebarFlyoutAfterHover(
  current: SidebarFlyout,
  pinned: boolean,
  hovered: SidebarFlyoutKind
): SidebarFlyoutInteraction {
  return pinned
    ? { flyout: current, pinned: true }
    : { flyout: hovered, pinned: false };
}

/** Clicking pins a preview, switches sections, or toggles the pinned section closed. */
export function sidebarFlyoutAfterClick(
  current: SidebarFlyout,
  pinned: boolean,
  clicked: SidebarFlyoutKind
): SidebarFlyoutInteraction {
  if (pinned && current === clicked) return { flyout: null, pinned: false };
  return { flyout: clicked, pinned: true };
}

export function sidebarFlyoutTitle(kind: SidebarFlyoutKind): string {
  if (kind === "shortcuts") return "Shortcuts";
  if (kind === "notebooks") return "Notebooks";
  return "Tags";
}

export function sidebarFilterLabel(kind: SidebarFlyoutKind): string {
  return kind === "tags" ? "Filter tags" : "Filter notebooks";
}

export function matchesSidebarFilter(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return name.toLowerCase().includes(needle);
}

export function notebooksMatchingFilter<T extends { name: string }>(
  notebooks: T[],
  stackName: string | null,
  query: string
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return notebooks;
  if (stackName && stackName.toLowerCase().includes(needle)) return notebooks;
  return notebooks.filter((notebook) => notebook.name.toLowerCase().includes(needle));
}

export function hasVisibleSidebarNotebooks(
  notebooks: { name: string }[],
  stacks: { name: string }[],
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return notebooks.length > 0;
  if (stacks.some((stack) => stack.name.toLowerCase().includes(needle))) return true;
  return notebooks.some((notebook) => notebook.name.toLowerCase().includes(needle));
}

export const COLLAPSED_STACKS_KEY = "notebook.collapsedStacks";

export function parseCollapsedStacks(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string" && id.length > 0);
  } catch {
    return [];
  }
}

export function toggleCollapsedId(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function collapseAllIds(allIds: string[]): string[] {
  return [...new Set(allIds.filter(Boolean))];
}
