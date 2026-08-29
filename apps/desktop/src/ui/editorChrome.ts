export const HIGHLIGHT_COLORS = [
  { id: "yellow", label: "Yellow", color: "#fff3a0" },
  { id: "green", label: "Green", color: "#c6f6d5" },
  { id: "pink", label: "Pink", color: "#ffcce5" },
  { id: "blue", label: "Blue", color: "#cde4ff" },
] as const;

export const TEXT_COLORS = [
  { id: "default", label: "Default", color: "" },
  { id: "red", label: "Red", color: "#d64545" },
  { id: "orange", label: "Orange", color: "#d9822b" },
  { id: "green", label: "Green", color: "#00a82d" },
  { id: "blue", label: "Blue", color: "#2b6cb0" },
  { id: "purple", label: "Purple", color: "#6b46c1" },
] as const;

export const EDITOR_CHROME_KEY = "notebook.editorChrome";
export const ZOOM_MIN = 50;
export const ZOOM_MAX = 200;
export const ZOOM_STEP = 10;
export const DEFAULT_ZOOM = 100;

export interface EditorChrome {
  toolbarHidden: boolean;
  attachmentsExpanded: boolean;
  zoom: number;
  outlineOpen: boolean;
}

export function defaultEditorChrome(): EditorChrome {
  return {
    toolbarHidden: false,
    attachmentsExpanded: false,
    zoom: DEFAULT_ZOOM,
    outlineOpen: false,
  };
}

export function formattingToolbarVisible(
  toolbarHidden: boolean,
  editorFocused: boolean
): boolean {
  return !toolbarHidden && editorFocused;
}

export function attachmentsLabel(count: number): string {
  return count === 1 ? "1 attachment" : `${count} attachments`;
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_ZOOM;
  const stepped = Math.round(value / ZOOM_STEP) * ZOOM_STEP;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, stepped));
}

export function parseEditorChrome(raw: string | null): EditorChrome {
  const fallback = defaultEditorChrome();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<EditorChrome>;
    return {
      toolbarHidden: Boolean(parsed.toolbarHidden),
      attachmentsExpanded: Boolean(parsed.attachmentsExpanded),
      zoom: clampZoom(Number(parsed.zoom ?? DEFAULT_ZOOM)),
      outlineOpen: Boolean(parsed.outlineOpen),
    };
  } catch {
    return fallback;
  }
}

export function nextZoom(current: number, direction: 1 | -1 | 0): number {
  if (direction === 0) return DEFAULT_ZOOM;
  return clampZoom(current + direction * ZOOM_STEP);
}

export function windowTitleForNote(noteTitle: string | null): string {
  if (noteTitle === null) return "Notebook";
  const cleaned = noteTitle.trim() || "Untitled";
  return `${cleaned} – Notebook`;
}

export const EDITOR_FONTS = [
  { id: "", label: "Default" },
  { id: "Arial, sans-serif", label: "Sans Serif" },
  { id: "Georgia, \"Times New Roman\", serif", label: "Serif" },
  { id: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace", label: "Monospace" },
  { id: "Trebuchet MS, sans-serif", label: "Trebuchet" },
  { id: "Verdana, sans-serif", label: "Verdana" },
] as const;

export const EDITOR_FONT_SIZES = [12, 14, 16, 18, 24, 32, 48] as const;

export const CODE_LANGUAGES = [
  { id: "", label: "Plain text" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescript", label: "TypeScript" },
  { id: "python", label: "Python" },
  { id: "rust", label: "Rust" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "shell", label: "Shell" },
] as const;
