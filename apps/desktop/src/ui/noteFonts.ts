/** Evernote Settings → Notes default font styles (Normal / H1 / H2 / H3). */

export const INTER_STACK =
  '"Inter", "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif';
export const SERIF_STACK = 'Georgia, "Times New Roman", Times, serif';
export const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

export const NOTE_FONT_FAMILIES = [
  { id: "", label: "Default", css: INTER_STACK },
  { id: '"Helvetica Neue", Helvetica, Arial, sans-serif', label: "Helvetica", css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { id: SERIF_STACK, label: "Serif", css: SERIF_STACK },
  { id: MONO_STACK, label: "Monospace", css: MONO_STACK },
  { id: "Trebuchet MS, sans-serif", label: "Trebuchet", css: "Trebuchet MS, sans-serif" },
  { id: "Verdana, sans-serif", label: "Verdana", css: "Verdana, sans-serif" },
] as const;

export const NOTE_FONT_SIZES = [12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 48] as const;

export const NOTE_STYLE_IDS = ["normal", "h1", "h2", "h3"] as const;
export type NoteStyleId = (typeof NOTE_STYLE_IDS)[number];

export const NOTE_STYLE_OPTIONS: {
  id: NoteStyleId;
  label: string;
  heading: 0 | 1 | 2 | 3;
}[] = [
  { id: "normal", label: "Normal text", heading: 0 },
  { id: "h1", label: "Large header", heading: 1 },
  { id: "h2", label: "Medium header", heading: 2 },
  { id: "h3", label: "Small header", heading: 3 },
];

export interface NoteFontStyle {
  family: string;
  size: number;
  color: string;
}

export type NoteFontStyles = Record<NoteStyleId, NoteFontStyle>;

export const DEFAULT_NOTE_TEXT_COLOR = "#26251e";

export function defaultNoteFontStyles(): NoteFontStyles {
  return {
    normal: { family: "", size: 16, color: "" },
    h1: { family: "", size: 28, color: "" },
    h2: { family: "", size: 22, color: "" },
    h3: { family: "", size: 18, color: "" },
  };
}

function clampSize(value: unknown, fallback: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const rounded = Math.round(numeric);
  return Math.min(72, Math.max(8, rounded));
}

function parseStyle(raw: unknown, fallback: NoteFontStyle): NoteFontStyle {
  if (!raw || typeof raw !== "object") return { ...fallback };
  const value = raw as Partial<NoteFontStyle>;
  return {
    family: typeof value.family === "string" ? value.family : fallback.family,
    size: clampSize(value.size, fallback.size),
    color: typeof value.color === "string" ? value.color : fallback.color,
  };
}

export function parseNoteFontStyles(raw: unknown): NoteFontStyles {
  const fallback = defaultNoteFontStyles();
  if (!raw || typeof raw !== "object") return fallback;
  const value = raw as Partial<Record<NoteStyleId, unknown>>;
  return {
    normal: parseStyle(value.normal, fallback.normal),
    h1: parseStyle(value.h1, fallback.h1),
    h2: parseStyle(value.h2, fallback.h2),
    h3: parseStyle(value.h3, fallback.h3),
  };
}

export function cssFontFamily(family: string): string {
  if (!family || family === "default") return INTER_STACK;
  if (family === "serif") return SERIF_STACK;
  if (family === "mono") return MONO_STACK;
  return family;
}

export function legacyFontFamily(
  family: string
): "default" | "serif" | "mono" {
  if (family === "serif" || family === SERIF_STACK) return "serif";
  if (family === "mono" || family === MONO_STACK) return "mono";
  return "default";
}

export function noteFontStyleVars(
  styles: NoteFontStyles
): Record<string, string> {
  const color = (value: string) => value || DEFAULT_NOTE_TEXT_COLOR;
  return {
    "--note-font-family": cssFontFamily(styles.normal.family),
    "--note-font-size": `${styles.normal.size}px`,
    "--note-font-color": color(styles.normal.color),
    "--note-h1-family": cssFontFamily(styles.h1.family),
    "--note-h1-size": `${styles.h1.size}px`,
    "--note-h1-color": color(styles.h1.color),
    "--note-h2-family": cssFontFamily(styles.h2.family),
    "--note-h2-size": `${styles.h2.size}px`,
    "--note-h2-color": color(styles.h2.color),
    "--note-h3-family": cssFontFamily(styles.h3.family),
    "--note-h3-size": `${styles.h3.size}px`,
    "--note-h3-color": color(styles.h3.color),
  };
}

export function patchNoteFontStyle(
  styles: NoteFontStyles,
  id: NoteStyleId,
  patch: Partial<NoteFontStyle>
): NoteFontStyles {
  return {
    ...styles,
    [id]: { ...styles[id], ...patch },
  };
}

export function stylesFromLegacy(
  fontFamily: "default" | "serif" | "mono" | undefined,
  fontSize: number | undefined,
  rawStyles: unknown
): NoteFontStyles {
  const parsed = parseNoteFontStyles(rawStyles);
  if (rawStyles && typeof rawStyles === "object") return parsed;
  const family =
    fontFamily === "serif" ? SERIF_STACK : fontFamily === "mono" ? MONO_STACK : "";
  return {
    ...parsed,
    normal: {
      ...parsed.normal,
      family,
      size: clampSize(fontSize, parsed.normal.size),
    },
  };
}
