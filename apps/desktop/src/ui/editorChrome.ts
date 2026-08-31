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
  statusBarHidden: boolean;
  lineHeight: LineHeight;
}

export function defaultEditorChrome(): EditorChrome {
  return {
    toolbarHidden: false,
    attachmentsExpanded: false,
    zoom: DEFAULT_ZOOM,
    outlineOpen: false,
    statusBarHidden: false,
    lineHeight: 1.5,
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
      statusBarHidden: Boolean(parsed.statusBarHidden),
      lineHeight: parseLineHeight(parsed.lineHeight),
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


export const IMAGE_SIZE_PRESETS = [
  { id: "small", label: "Small", width: "25%" },
  { id: "medium", label: "Medium", width: "50%" },
  { id: "large", label: "Large", width: "75%" },
  { id: "original", label: "Original", width: "" },
] as const;

export function clampImageWidth(width: number): number {
  if (!Number.isFinite(width)) return 320;
  return Math.min(1200, Math.max(80, Math.round(width)));
}

export const LINE_HEIGHTS = [1, 1.15, 1.5, 2] as const;

export type LineHeight = (typeof LINE_HEIGHTS)[number];

export function parseLineHeight(value: unknown): LineHeight {
  const numeric = Number(value);
  return (LINE_HEIGHTS as readonly number[]).includes(numeric)
    ? (numeric as LineHeight)
    : 1.5;
}

export function nextLineHeight(current: LineHeight, direction: 1 | -1): LineHeight {
  const index = LINE_HEIGHTS.indexOf(current);
  const next = Math.min(LINE_HEIGHTS.length - 1, Math.max(0, index + direction));
  return LINE_HEIGHTS[next];
}

export function nextFontSize(current: string | undefined, direction: 1 | -1): string {
  const sizes = [...EDITOR_FONT_SIZES];
  const parsed = Number.parseInt(String(current || ""), 10);
  const fallback = 16;
  const value = Number.isFinite(parsed) ? parsed : fallback;
  let index = sizes.findIndex((size) => size >= value);
  if (index < 0) index = sizes.length - 1;
  if (sizes[index] !== value && direction < 0) index = Math.max(0, index - 1);
  const next = sizes[Math.min(sizes.length - 1, Math.max(0, index + direction))];
  return `${next}px`;
}

export const SPELLCHECK_LANGUAGES = [
  { id: "en-US", label: "English (US)" },
  { id: "en-GB", label: "English (UK)" },
  { id: "de-DE", label: "German" },
  { id: "fr-FR", label: "French" },
  { id: "es-ES", label: "Spanish" },
  { id: "it-IT", label: "Italian" },
  { id: "pt-BR", label: "Portuguese (Brazil)" },
  { id: "nl-NL", label: "Dutch" },
  { id: "pl-PL", label: "Polish" },
  { id: "ru-RU", label: "Russian" },
  { id: "ja-JP", label: "Japanese" },
  { id: "zh-CN", label: "Chinese (Simplified)" },
  { id: "ko-KR", label: "Korean" },
] as const;

export function insertDateStamp(now = new Date()): string {
  return now.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function insertTimeStamp(now = new Date()): string {
  return now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
