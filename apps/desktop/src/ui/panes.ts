export const SIDEBAR_MIN = 180;
export const SIDEBAR_MAX = 420;
export const LIST_MIN = 220;
export const LIST_MAX = 560;
export const DEFAULT_SIDEBAR_WIDTH = 248;
export const DEFAULT_LIST_WIDTH = 320;
export const SIDEBAR_RAIL_WIDTH = 96;
export const PANE_LAYOUT_KEY = "notebook.paneLayout";

export interface PaneLayout {
  sidebarWidth: number;
  listWidth: number;
  sidebarCollapsed: boolean;
  listCollapsed: boolean;
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
    listCollapsed: false,
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
      listCollapsed: Boolean(parsed.listCollapsed),
    };
  } catch {
    return fallback;
  }
}

export function isNoteExpanded(layout: PaneLayout): boolean {
  return layout.sidebarCollapsed && layout.listCollapsed;
}

export function toggleNoteListHidden(layout: PaneLayout): PaneLayout {
  if (isNoteExpanded(layout)) {
    return { ...layout, sidebarCollapsed: false, listCollapsed: false };
  }
  return { ...layout, listCollapsed: !layout.listCollapsed };
}

export function toggleSidebarHidden(layout: PaneLayout): PaneLayout {
  if (isNoteExpanded(layout)) {
    return { ...layout, sidebarCollapsed: false, listCollapsed: false };
  }
  return { ...layout, sidebarCollapsed: !layout.sidebarCollapsed };
}

export function toggleNoteExpanded(layout: PaneLayout): PaneLayout {
  if (isNoteExpanded(layout)) {
    return { ...layout, sidebarCollapsed: false, listCollapsed: false };
  }
  return { ...layout, sidebarCollapsed: true, listCollapsed: true };
}

/** An empty editor must always leave a visible route back to the note list. */
export function revealNoteBrowser(layout: PaneLayout): PaneLayout {
  if (!layout.listCollapsed) return layout;
  return {
    ...layout,
    sidebarCollapsed: isNoteExpanded(layout) ? false : layout.sidebarCollapsed,
    listCollapsed: false,
  };
}


export const TOOLBAR_OVERFLOW_WIDTH = 34;

/** How many leading toolbar items fit before the rest move into `…`. */
export function visibleToolbarCount(
  availableWidth: number,
  itemWidths: number[],
  overflowWidth = TOOLBAR_OVERFLOW_WIDTH
): number {
  if (itemWidths.length === 0) return 0;
  const total = itemWidths.reduce((sum, width) => sum + width, 0);
  if (total <= availableWidth) return itemWidths.length;
  const budget = Math.max(0, availableWidth - overflowWidth);
  let used = 0;
  let count = 0;
  for (const width of itemWidths) {
    if (used + width > budget) break;
    used += width;
    count += 1;
  }
  return count;
}

/** Dragging the sidebar edge both resizes it and brings a hidden one back. */
export function resizeSidebarTo(layout: PaneLayout, edge: number): PaneLayout {
  return {
    ...layout,
    sidebarCollapsed: false,
    sidebarWidth: clampPaneWidth(edge, SIDEBAR_MIN, SIDEBAR_MAX),
  };
}
