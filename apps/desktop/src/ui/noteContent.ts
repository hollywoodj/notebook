import { decodeXmlEntities } from "../htmlEntities.ts";
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
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

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function mergeNoteBodies(
  notes: { title: string; content: string }[]
): string {
  if (notes.length === 0) return "<p></p>";
  const [first, ...rest] = notes;
  const extra = rest.map((note) => {
    const heading = `<h1>${escapeHtml(note.title || "Untitled")}</h1>`;
    return `${heading}${note.content || ""}`;
  });
  return `${first.content || "<p></p>"}${extra.join("")}`;
}

export function checklistProgressLabel(done: number, total: number): string | null {
  if (!Number.isFinite(done) || !Number.isFinite(total) || total <= 0) return null;
  return `${Math.max(0, Math.round(done))}/${Math.max(0, Math.round(total))}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stands in for a note whose first image is inline base64. The API sends the
 * marker instead of the image so a list response stays small; the bytes come
 * from `/api/v1/notes/:id/thumbnail` only for rows that are actually drawn. */
const THUMB_MARKER_PREFIX = "notebook-thumb://";

export function resolveThumbnailUrl(
  raw: string | null | undefined,
  toAttachmentUrl: (id: string) => string,
  toNoteThumbnailUrl: (noteId: string) => string
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const attached = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  // Checked before the attachment cases on purpose: the id regex below matches
  // the note id inside this marker too, and falling through to `return trimmed`
  // would put the raw marker into a CSS url().
  if (trimmed.startsWith(THUMB_MARKER_PREFIX)) {
    return attached ? toNoteThumbnailUrl(attached[1]) : null;
  }
  if (UUID_RE.test(trimmed) && attached) return toAttachmentUrl(attached[1]);
  if (trimmed.startsWith("notebook-attachment://") && attached) {
    return toAttachmentUrl(attached[1]);
  }
  return trimmed;
}


export function htmlToPlainText(html: string | null | undefined): string {
  if (html == null) return "";
  // decodeXmlEntities, not the local decodeHtmlEntities: imported Evernote
  // notes carry `&apos;` and double-encoded `&amp;apos;`, which the HTML table
  // does not cover.
  return decodeXmlEntities(
    String(html)
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n")
      .replace(/<\/h[1-6]>/gi, "\n")
      .replace(/<\/li>/gi, "\n")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function htmlToMarkdown(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, inner) => `# ${htmlToPlainText(inner)}\n\n`);
  text = text.replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, inner) => `## ${htmlToPlainText(inner)}\n\n`);
  text = text.replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, inner) => `### ${htmlToPlainText(inner)}\n\n`);
  text = text.replace(/<strong\b[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
  text = text.replace(/<b\b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
  text = text.replace(/<em\b[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
  text = text.replace(/<i\b[^>]*>([\s\S]*?)<\/i>/gi, "*$1*");
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => `[${htmlToPlainText(inner) || href}](${href})`
  );
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `- ${htmlToPlainText(inner)}\n`);
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, inner) =>
    htmlToPlainText(inner)
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n")
  );
  text = text.replace(
    /<div\b[^>]*data-callout=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi,
    (_m, kind, inner) => `> [!${String(kind).toUpperCase()}]\n> ${htmlToPlainText(inner)}\n\n`
  );
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<hr\b[^>]*>/gi, "\n---\n");
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  text = htmlToPlainText(`<p>${text}</p>`).replace(/\n{3,}/g, "\n\n").trim();
  return text;
}

export function countCharacters(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}

export function readingTimeLabel(wordCount: number): string | null {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return null;
  const minutes = Math.max(1, Math.round(wordCount / 200));
  return minutes === 1 ? "1 min read" : `${minutes} min read`;
}

export function noteHasUrl(note: {
  source_url?: string | null;
  snippet?: string;
}): boolean {
  if (note.source_url?.trim()) return true;
  return /\bhttps?:\/\//i.test(note.snippet || "");
}

export function outlineToHtml(headings: { level: number; text: string }[]): string {
  if (!headings.length) return "";
  const items = headings
    .map((heading) => {
      const pad = "&nbsp;".repeat(Math.max(0, heading.level - 1) * 4);
      return `<li>${pad}${escapeHtml(heading.text)}</li>`;
    })
    .join("");
  return `<h2>Table of Contents</h2><ul>${items}</ul>`;
}

export function plaintextFromClipboardHtml(html: string): string {
  return htmlToPlainText(html).replace(/\n/g, "<br>");
}


export const NOTE_COLORS = [
  { id: "", label: "None", swatch: "transparent" },
  { id: "red", label: "Red", swatch: "#f97066" },
  { id: "orange", label: "Orange", swatch: "#f79009" },
  { id: "yellow", label: "Yellow", swatch: "#f4c430" },
  { id: "green", label: "Green", swatch: "#00a82d" },
  { id: "blue", label: "Blue", swatch: "#2e90fa" },
  { id: "purple", label: "Purple", swatch: "#7a5af8" },
] as const;

export const NOTE_COLORS_KEY = "notebook.noteColors";

export type NoteColorId = (typeof NOTE_COLORS)[number]["id"];

export function parseNoteColorMap(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === "string" && NOTE_COLORS.some((color) => color.id === value && value)) {
        next[id] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

export function setNoteColor(
  map: Record<string, string>,
  id: string,
  color: string
): Record<string, string> {
  const next = { ...map };
  if (!color) delete next[id];
  else next[id] = color;
  return next;
}

export const LOCKED_NOTES_KEY = "notebook.lockedNotes";

export function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item) => typeof item === "string");
  } catch {
    return [];
  }
}
