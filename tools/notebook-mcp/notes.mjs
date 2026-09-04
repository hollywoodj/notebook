// Pure, dependency-free logic for the notebook-mcp project-note structure:
// a "Dev Log" catch-all note plus one opt-in note per enabled project. Both
// shapes hold the same {Bugs, Future Improvements, Architecture Reviews}
// content - only the heading level differs, captured here as a single
// `offset` parameter (0 for a project's own note, 1 for a project's block
// inside Dev Log, which additionally wraps it in an `<h2>ProjectName</h2>`
// heading). One parser/serializer pair handles both shapes; server.mjs adds
// the Dev Log-specific "many named blocks" wrapper on top. No network or
// filesystem I/O in this module - kept separate from server.mjs so it can be
// unit tested without touching stdio, SQLite, or the live API.

import process from "node:process";
import path from "node:path";
import { escapeHtml, decodeEntities, findAllBalancedBlocks, parseTaskListItems, renderTaskList } from "./format.mjs";

/** Bad tool input / refused-by-policy - surfaced to the caller as isError:true. */
export class ToolInputError extends Error {}

export function decodeHtmlText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

// ---------------------------------------------------------------------------
// Level-offset project block: {bugs, improvements, reviews} <-> HTML
// ---------------------------------------------------------------------------

export const PROJECT_NOTE_OFFSET = 0; // a project's own note: sections start at h2
export const DEV_LOG_OFFSET = 1; // a Dev Log block: wrapped in h2 <ProjectName>, sections at h3

/** Heading tag for the Bugs / Future Improvements / Architecture Reviews headings at this offset. */
export function sectionTag(offset) {
  return `h${2 + offset}`;
}

/** Heading tag for individual Architecture Reviews entries (one level under sectionTag). */
export function reviewTag(offset) {
  return `h${3 + offset}`;
}

function parseReviewEntries(html, offset) {
  const rTag = reviewTag(offset);
  const blocks = findAllBalancedBlocks(html, rTag);
  const entries = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    const date = decodeHtmlText(b.inner);
    const end = i + 1 < blocks.length ? blocks[i + 1].start : html.length;
    let entryHtml = html.slice(b.end, end);
    entryHtml = entryHtml.replace(/<hr\s*\/?>\s*$/i, "");
    let subtitle = null;
    const subMatch = /^\s*<p><em>([\s\S]*?)<\/em><\/p>/i.exec(entryHtml);
    let bodyHtml = entryHtml;
    if (subMatch) {
      subtitle = decodeHtmlText(subMatch[1]);
      bodyHtml = entryHtml.slice(subMatch[0].length);
    }
    entries.push({ date, subtitle, bodyHtml });
  }
  return entries;
}

function serializeReviewEntries(entries, offset) {
  const rTag = reviewTag(offset);
  return entries
    .map((e) => {
      let html = `<${rTag}>${escapeHtml(e.date)}</${rTag}>`;
      if (e.subtitle) html += `<p><em>${escapeHtml(e.subtitle)}</em></p>`;
      html += e.bodyHtml;
      html += "<hr>";
      return html;
    })
    .join("");
}

/**
 * Parse a project block - the full content of a project's own note (offset 0),
 * or the HTML following one `<h2>ProjectName</h2>` heading inside Dev Log
 * (offset 1) - into `{ bugs, improvements, reviews }`. `reviews` is returned
 * in document order, i.e. newest-first exactly as maintained on write; this
 * function never reorders.
 */
export function parseProjectBlock(html, offset) {
  const sTag = sectionTag(offset);
  const sections = findAllBalancedBlocks(html, sTag);
  let bugs = [];
  let improvements = [];
  let reviews = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const label = decodeHtmlText(s.inner);
    const end = i + 1 < sections.length ? sections[i + 1].start : html.length;
    const inner = html.slice(s.end, end);
    if (label === "Bugs") bugs = parseTaskListItems(inner);
    else if (label === "Future Improvements") improvements = parseTaskListItems(inner);
    else if (label === "Architecture Reviews") reviews = parseReviewEntries(inner, offset);
  }
  return { bugs, improvements, reviews };
}

/** Inverse of parseProjectBlock. Always emits all three headings (even when
 * empty), so re-parsing the output round-trips exactly. */
export function serializeProjectBlock({ bugs, improvements, reviews }, offset) {
  const sTag = sectionTag(offset);
  return (
    `<${sTag}>Bugs</${sTag}>${renderTaskList(bugs)}` +
    `<${sTag}>Future Improvements</${sTag}>${renderTaskList(improvements)}` +
    `<${sTag}>Architecture Reviews</${sTag}>${serializeReviewEntries(reviews, offset)}`
  );
}

export function combinedItems(block) {
  return [
    ...block.bugs.map((it) => ({ it, list: "bugs" })),
    ...block.improvements.map((it) => ({ it, list: "improvements" })),
  ];
}

export function formatNumberedItems(items, startNum) {
  if (!items.length) return "(none)";
  return items.map((it, i) => `${startNum + i}. [${it.checked ? "x" : " "}] ${it.text}`).join("\n");
}

// ---------------------------------------------------------------------------
// Dev Log: many named project blocks (offset 1), each wrapped in
// `<h2>ProjectName</h2>`, preceded by an intro paragraph.
// ---------------------------------------------------------------------------

export function parseDevLog(html) {
  const h2s = findAllBalancedBlocks(html, "h2");
  const intro = html.slice(0, h2s.length ? h2s[0].start : html.length);
  const projects = [];
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    const name = decodeHtmlText(h2.inner);
    const end = i + 1 < h2s.length ? h2s[i + 1].start : html.length;
    const sectionHtml = html.slice(h2.end, end);
    projects.push({ name, ...parseProjectBlock(sectionHtml, DEV_LOG_OFFSET) });
  }
  return { intro, projects };
}

export function serializeDevLog({ intro, projects }) {
  const body = projects
    .map((p) => `<h2>${escapeHtml(p.name)}</h2>${serializeProjectBlock(p, DEV_LOG_OFFSET)}`)
    .join("");
  return intro + body;
}

// ---------------------------------------------------------------------------
// Project-name defaulting
// ---------------------------------------------------------------------------

/** `project` defaults to the cwd's folder name. `Dev` (the Dev root) is a
 * reserved project name meaning the global `Dev - Overview` note - it's no
 * longer refused here; routing tools (update_backlog/read_backlog) special-case
 * it, and the ones that don't allow it (add_report, enable_project,
 * disable_project) refuse it themselves with a clearer, tool-specific message. */
export function resolveRequiredProject(explicit, cwd = process.cwd()) {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const base = path.basename(cwd);
  return base || "Dev";
}

/** Like resolveRequiredProject, but never defaults from cwd - used by
 * enable_project/disable_project, which always require an explicit project. */
export function requireProjectArg(args) {
  if (typeof args.project !== "string" || !args.project.trim()) {
    throw new ToolInputError("project is required.");
  }
  return args.project.trim();
}
