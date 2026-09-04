// Pure, dependency-free logic for the two special Notebook-MCP notes
// (Bugs & Future Improvements / Architecture Review) plus project-name
// defaulting. No network or filesystem I/O in this module - kept separate
// from server.mjs so it can be unit tested without touching stdio or the
// live API.

import process from "node:process";
import path from "node:path";
import { escapeHtml, decodeEntities, findAllBalancedBlocks, parseTaskListItems, renderTaskList } from "./format.mjs";

/** Bad tool input / refused-by-policy - surfaced to the caller as isError:true. */
export class ToolInputError extends Error {}

export const REPORT_HEADING_SEP = " · ";

export function decodeHtmlText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

// ---------------------------------------------------------------------------
// Backlog note: parse/serialize project sections
// ---------------------------------------------------------------------------

export function parseBacklogHtml(html) {
  const h2s = findAllBalancedBlocks(html, "h2");
  const intro = html.slice(0, h2s.length ? h2s[0].start : html.length);
  const projects = [];
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    const name = decodeHtmlText(h2.inner);
    const sectionEnd = i + 1 < h2s.length ? h2s[i + 1].start : html.length;
    const sectionHtml = html.slice(h2.end, sectionEnd);
    const h3s = findAllBalancedBlocks(sectionHtml, "h3");
    let bugs = [];
    let improvements = [];
    for (let j = 0; j < h3s.length; j++) {
      const h3 = h3s[j];
      const label = decodeHtmlText(h3.inner).toLowerCase();
      const subEnd = j + 1 < h3s.length ? h3s[j + 1].start : sectionHtml.length;
      const subHtml = sectionHtml.slice(h3.end, subEnd);
      const items = parseTaskListItems(subHtml);
      if (label === "bugs") bugs = items;
      else if (label === "future improvements") improvements = items;
    }
    projects.push({ name, bugs, improvements });
  }
  return { intro, projects };
}

export function serializeBacklogHtml({ intro, projects }) {
  const body = projects
    .map(
      (p) =>
        `<h2>${escapeHtml(p.name)}</h2><h3>Bugs</h3>${renderTaskList(p.bugs)}<h3>Future Improvements</h3>${renderTaskList(
          p.improvements
        )}`
    )
    .join("");
  return intro + body;
}

export function combinedBacklogItems(section) {
  return [
    ...section.bugs.map((it) => ({ it, list: "bugs" })),
    ...section.improvements.map((it) => ({ it, list: "improvements" })),
  ];
}

export function formatNumberedItems(items, startNum) {
  if (!items.length) return "(none)";
  return items.map((it, i) => `${startNum + i}. [${it.checked ? "x" : " "}] ${it.text}`).join("\n");
}

// ---------------------------------------------------------------------------
// Architecture Review note: parse/prepend entries
// ---------------------------------------------------------------------------

export function parseReportEntries(html) {
  const h2s = findAllBalancedBlocks(html, "h2");
  const entries = [];
  for (let i = 0; i < h2s.length; i++) {
    const h2 = h2s[i];
    const heading = decodeHtmlText(h2.inner);
    let project = "";
    const sepIdx = heading.indexOf(REPORT_HEADING_SEP);
    if (sepIdx !== -1) {
      project = heading.slice(sepIdx + REPORT_HEADING_SEP.length).trim();
    }
    const end = i + 1 < h2s.length ? h2s[i + 1].start : html.length;
    let bodyHtml = html.slice(h2.end, end);
    bodyHtml = bodyHtml.replace(/<hr\s*\/?>\s*$/i, "");
    entries.push({ heading, project, bodyHtml });
  }
  return entries;
}

export function prependReportEntry(html, entryHtml) {
  const h2s = findAllBalancedBlocks(html, "h2");
  if (h2s.length === 0) return html + entryHtml;
  return html.slice(0, h2s[0].start) + entryHtml + html.slice(h2s[0].start);
}

// ---------------------------------------------------------------------------
// Project-name defaulting
// ---------------------------------------------------------------------------

export function resolveRequiredProject(explicit, cwd = process.cwd()) {
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const base = path.basename(cwd);
  if (!base || base === "Dev") {
    throw new ToolInputError(
      "No project specified, and the server's working directory is the Dev root (not a specific project) - pass `project` explicitly."
    );
  }
  return base;
}
