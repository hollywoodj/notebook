/** XML/HTML named entities. `&apos;` is the XML name for apostrophe. */
export function decodeXmlEntities(value: string | null | undefined): string {
  if (value == null) return "";
  return String(value)
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

export function repairImportedHtml(html: string | null | undefined): string {
  if (html == null) return "";
  return String(html)
    .replace(/&amp;apos;/gi, "'")
    .replace(/&amp;nbsp;/gi, "&nbsp;")
    .replace(/&amp;#39;/gi, "'")
    .replace(/&amp;#x27;/gi, "'");
}

