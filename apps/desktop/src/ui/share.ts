import { escapeHtml } from "./noteContent.ts";

export function noteAppLink(id: string): string {
  return `notebook://note/${id}`;
}

function toEnexTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export function notesToHtmlDocument(title: string, content: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title || "Untitled")}</title></head>
<body><h1>${escapeHtml(title || "Untitled")}</h1>${content}</body></html>`;
}

export function notesToEnex(
  notes: {
    title: string;
    content: string;
    created_at: string;
    updated_at: string;
    tag_names?: string[];
  }[]
): string {
  const body = notes
    .map((note) => {
      const enml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note>${note.content}</en-note>`;
      const tags = (note.tag_names || [])
        .map((tag) => `<tag>${escapeHtml(tag)}</tag>`)
        .join("");
      return `<note><title>${escapeHtml(note.title || "Untitled")}</title><content><![CDATA[${enml}]]></content><created>${toEnexTimestamp(note.created_at)}</created><updated>${toEnexTimestamp(note.updated_at)}</updated>${tags}</note>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd"><en-export>${body}</en-export>`;
}

export function downloadTextFile(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function safeFilename(title: string): string {
  const cleaned = (title || "Untitled").replace(/[\\/:*?"<>|]+/g, " ").trim();
  return cleaned || "Untitled";
}

export async function copyTextToClipboard(text: string, html?: string) {
  if (html && "ClipboardItem" in window && navigator.clipboard.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/plain": new Blob([text], { type: "text/plain" }),
          "text/html": new Blob([html], { type: "text/html" }),
        }),
      ]);
      return;
    } catch {
      // Fall through to plain text.
    }
  }
  await navigator.clipboard.writeText(text);
}

export function noteMailtoHref(title: string, plain: string): string {
  const subject = encodeURIComponent(title.trim() || "Untitled");
  const body = encodeURIComponent(plain.trim() || "");
  return `mailto:?subject=${subject}&body=${body}`;
}

export function printHtmlDocument(title: string, content: string) {
  const html = notesToHtmlDocument(title, content);
  const frame = window.open("", "_blank", "noopener,noreferrer");
  if (!frame) {
    window.print();
    return;
  }
  frame.document.write(html);
  frame.document.title = title || "Untitled";
  frame.document.close();
  frame.focus();
  window.setTimeout(() => frame.print(), 50);
}
