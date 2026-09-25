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

export const SIDEBAR_NAV_ICON_SIZE = 20;

export function navIconTitle(label: string, count?: number | null): string {
  return typeof count === "number" && Number.isFinite(count)
    ? `${label} (${Math.round(count)})`
    : label;
}

export type SidebarSectionId = (typeof DEFAULT_SIDEBAR_SECTIONS)[number];

export const DEFAULT_SIDEBAR_SECTIONS = [
  "shortcuts",
  "notes",
  "notebooks",
  "tags",
  "reminders",
  "templates",
  "files",
  "archived",
  "saved",
  "trash",
] as const;

/** Utility sections that sit pinned at the foot of the sidebar, below a flexible gap. */
export const BOTTOM_SIDEBAR_SECTIONS = [
  "templates",
  "files",
  "archived",
  "saved",
  "trash",
] as const satisfies readonly SidebarSectionId[];

export function isBottomSidebarSection(id: SidebarSectionId): boolean {
  return (BOTTOM_SIDEBAR_SECTIONS as readonly string[]).includes(id);
}

/** Splits the user's section order into the top group and the pinned bottom group,
 *  preserving relative order within each. */
export function partitionSidebarSections(sections: SidebarSectionId[]): {
  top: SidebarSectionId[];
  bottom: SidebarSectionId[];
} {
  return {
    top: sections.filter((id) => !isBottomSidebarSection(id)),
    bottom: sections.filter((id) => isBottomSidebarSection(id)),
  };
}

export const SIDEBAR_SECTIONS_KEY = "notebook.sidebarSections";

export function parseSidebarSections(raw: string | null): SidebarSectionId[] {
  const fallback = [...DEFAULT_SIDEBAR_SECTIONS];
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const allowed = new Set<string>(DEFAULT_SIDEBAR_SECTIONS);
    const seen = new Set<string>();
    const ordered: SidebarSectionId[] = [];
    for (const item of parsed) {
      if (typeof item === "string" && allowed.has(item) && !seen.has(item)) {
        ordered.push(item as SidebarSectionId);
        seen.add(item);
      }
    }
    for (const item of DEFAULT_SIDEBAR_SECTIONS) {
      if (!seen.has(item)) ordered.push(item);
    }
    return ordered;
  } catch {
    return fallback;
  }
}

export function moveSidebarSection(
  sections: SidebarSectionId[],
  id: SidebarSectionId,
  direction: -1 | 1
): SidebarSectionId[] {
  const index = sections.indexOf(id);
  if (index < 0) return sections;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= sections.length) return sections;
  const next = [...sections];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  return next;
}

export function sidebarSectionLabel(id: SidebarSectionId): string {
  const labels: Record<SidebarSectionId, string> = {
    notes: "Notes",
    shortcuts: "Shortcuts",
    reminders: "Reminders",
    notebooks: "Notebooks",
    tags: "Tags",
    templates: "Templates",
    files: "Files",
    archived: "Archived",
    saved: "Saved searches",
    trash: "Trash",
  };
  return labels[id];
}

const AVATAR_COLORS = ["#00a82d", "#2b6cb0", "#d64545", "#d9822b", "#6b46c1", "#0f9d8e"];

export function avatarColor(name: string): string {
  const source = name.trim() || "?";
  let hash = 0;
  for (let i = 0; i < source.length; i++) {
    hash = (hash * 31 + source.charCodeAt(i)) | 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}
