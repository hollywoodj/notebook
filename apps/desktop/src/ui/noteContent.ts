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

export function resolveThumbnailUrl(
  raw: string | null | undefined,
  toAttachmentUrl: (id: string) => string
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const attached = trimmed.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (UUID_RE.test(trimmed) && attached) return toAttachmentUrl(attached[1]);
  if (trimmed.startsWith("notebook-attachment://") && attached) {
    return toAttachmentUrl(attached[1]);
  }
  return trimmed;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

export function htmlToPlainText(html: string): string {
  return decodeHtmlEntities(
    html
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
