// Pure, dependency-free logic for the "Dev - Overview" global note: a
// two-zone note (Ideas, hand-maintained; Reference, generated) that mirrors
// James's Dev root markdown files into the notebook so he can read them
// without leaving the app. No network or filesystem I/O in this module -
// server.mjs owns statting/reading the source files and talking to the
// store; everything here is pure string/HTML transforms so it's unit
// testable the same way notes.mjs and format.mjs are.

import { escapeHtml, decodeEntities, findAllBalancedBlocks, parseTaskListItems, renderTaskList, markdownToHtml } from "./format.mjs";

export const OVERVIEW_NOTE_TITLE = "Dev - Overview";

/** The ten Dev root files mirrored into the Reference zone, in mirror order. */
export const OVERVIEW_FILES = [
  "NOW.md",
  "GOALS.md",
  "STACK.md",
  "PROJECTS.md",
  "PORTS.md",
  "DECISIONS.md",
  "SKILLS.md",
  "GLOSSARY.md",
  "SETUP.md",
  "CLAUDE.md",
];

/** One-line "what it's for" shown in the Reference zone's index table. */
export const FILE_DESCRIPTIONS = {
  "NOW.md": "What's actively getting attention right now, across all projects.",
  "GOALS.md": "Longer-term goals and directional priorities.",
  "STACK.md": "Default tools/conventions this Dev folder leans on.",
  "PROJECTS.md": "Map of every project in this Dev folder - what it is, its stack, and when it was last touched.",
  "PORTS.md": "Every port claimed by something in this Dev folder.",
  "DECISIONS.md": "Log of deliberate deviations from STACK.md defaults, with the reasoning behind each.",
  "SKILLS.md": "Registry of Claude Code skills shared across projects.",
  "GLOSSARY.md": "Recurring terms/abbreviations across projects.",
  "SETUP.md": "What a fresh machine needs before projects here will run.",
  "CLAUDE.md": "Project-wide Claude Code instructions.",
};

function decodeHtmlText(html) {
  return decodeEntities(html.replace(/<[^>]+>/g, "")).trim();
}

export function isDevProject(project) {
  return typeof project === "string" && project.trim().toLowerCase() === "dev";
}

/** The predicate every "which notes are project notes" call site shares: a
 * note titled `devLogTitle` (the Dev Log catch-all) or OVERVIEW_NOTE_TITLE
 * (the global note) is never itself a project. Used by list_projects and by
 * read_backlog/read_reports when no project filter is given, so
 * "Dev - Overview" can never appear as a phantom project. */
export function isProjectNoteTitle(title, devLogTitle) {
  return title !== devLogTitle && title !== OVERVIEW_NOTE_TITLE;
}

// ---------------------------------------------------------------------------
// Source markdown transforms (applied before markdownToHtml, in this order):
// flatten relative links, drop the leading `# Title`, demote remaining headings.
// ---------------------------------------------------------------------------

/** Relative/local markdown links (`[PORTS.md](PORTS.md)`, `[x](./y.md)`) flatten
 * to their label text so they never become broken hyperlinks in the note.
 * Absolute http(s) links are left as real links. */
export function flattenRelativeLinks(md) {
  return md.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (whole, label, url) => {
    if (/^https?:\/\//i.test(url.trim())) return whole;
    return label;
  });
}

/** Drops a leading `# Title` heading (only the very first line, after skipping
 * leading blank lines) - it's redundant with the file's own <h3> section
 * heading in the Reference zone. Leaves everything else untouched. */
export function dropLeadingTitle(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length && /^#\s+/.test(lines[i])) {
    lines.splice(i, 1);
    while (i < lines.length && lines[i].trim() === "") lines.splice(i, 1);
  }
  return lines.join("\n");
}

/** Demotes a file's own headings to nest under its <h3> section heading:
 * `#`->h4 (level+3), `##`->h5, `###`->h6, anything deeper stays at h6.
 * Fence-aware, so a `#` at the start of a fenced code line is left alone. */
export function demoteHeadings(md) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  let inFence = false;
  const out = lines.map((line) => {
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      return line;
    }
    if (inFence) return line;
    const m = /^(#{1,6})(\s+.*)$/.exec(line);
    if (!m) return line;
    const newLevel = Math.min(m[1].length + 3, 6);
    return "#".repeat(newLevel) + m[2];
  });
  return out.join("\n");
}

/** Full source-markdown -> mirror-ready-markdown pipeline for one file, in
 * the order specified: flatten links, drop the leading title, demote headings. */
export function mirrorFileMarkdown(md) {
  return demoteHeadings(dropLeadingTitle(flattenRelativeLinks(md)));
}

// ---------------------------------------------------------------------------
// Ideas zone: `<h2>Ideas</h2>` + a single flat TipTap task list.
// ---------------------------------------------------------------------------

export function buildIdeasZoneHtml(items) {
  return `<h2>Ideas</h2>${renderTaskList(items)}`;
}

// ---------------------------------------------------------------------------
// Reference zone: `<h2>Reference</h2>` + generated intro/index/sections.
// ---------------------------------------------------------------------------

/**
 * `statResults`: `[{ name, exists, mtimeMs, size, content }]` in
 * `OVERVIEW_FILES` order (as produced by server.mjs's file statting - `content`
 * is only read for files that exist; ignored otherwise). `syncedAtIso`: ISO
 * datetime string for the "Last synced" line.
 */
export function buildReferenceZoneHtml(statResults, syncedAtIso) {
  const introHtml = `<p><em>Generated from the Dev root markdown files - edits below are overwritten. Last synced ${escapeHtml(
    syncedAtIso
  )}.</em></p>`;

  const rows = statResults.map((f) => {
    const lastMod = f.exists ? escapeHtml(new Date(f.mtimeMs).toISOString()) : "missing";
    return `<tr><td><p>${escapeHtml(f.name)}</p></td><td><p>${escapeHtml(
      FILE_DESCRIPTIONS[f.name] || ""
    )}</p></td><td><p>${lastMod}</p></td></tr>`;
  });
  const indexTableHtml =
    `<table><tbody>` +
    `<tr><th><p>File</p></th><th><p>What it's for</p></th><th><p>Last modified</p></th></tr>` +
    rows.join("") +
    `</tbody></table>`;

  const sections = statResults
    .filter((f) => f.exists)
    .map((f) => `<h3>${escapeHtml(f.name)}</h3>${markdownToHtml(mirrorFileMarkdown(f.content))}`)
    .join("");

  return `<h2>Reference</h2>${introHtml}${indexTableHtml}${sections}`;
}

// ---------------------------------------------------------------------------
// Zone splitting: locate `<h2>Ideas</h2>` / `<h2>Reference</h2>` and slice the
// note's HTML into the two zones. Regeneration only ever replaces the
// Reference zone, so `ideasZoneHtml` returned here must be reused byte-for-byte.
// ---------------------------------------------------------------------------

export function parseOverviewZones(html) {
  const h2s = findAllBalancedBlocks(html, "h2");
  let ideasIdx = -1;
  let refIdx = -1;
  for (let i = 0; i < h2s.length; i++) {
    const text = decodeHtmlText(h2s[i].inner);
    if (text === "Ideas" && ideasIdx === -1) ideasIdx = i;
    if (text === "Reference" && refIdx === -1) refIdx = i;
  }

  if (ideasIdx === -1) {
    // No Ideas heading at all (shouldn't happen for a note this feature
    // created, but tolerate it rather than throw): treat the whole thing as
    // the Reference zone and synthesize an empty Ideas zone ahead of it.
    return { ideasZoneHtml: buildIdeasZoneHtml([]), referenceZoneHtml: html, hasReference: refIdx !== -1 };
  }

  const ideasStart = h2s[ideasIdx].start;
  const ideasEnd = refIdx !== -1 ? h2s[refIdx].start : html.length;
  const ideasZoneHtml = html.slice(ideasStart, ideasEnd);
  const referenceZoneHtml = refIdx !== -1 ? html.slice(h2s[refIdx].start) : "";
  return { ideasZoneHtml, referenceZoneHtml, hasReference: refIdx !== -1 };
}

/** Parses the flat Ideas task list out of an Ideas zone (or any HTML containing one). */
export function parseIdeasItems(ideasZoneHtml) {
  return parseTaskListItems(ideasZoneHtml);
}

/** Full note HTML from its two zones - the exact inverse of concatenation. */
export function buildOverviewNoteHtml(ideasZoneHtml, referenceZoneHtml) {
  return ideasZoneHtml + referenceZoneHtml;
}

// ---------------------------------------------------------------------------
// Extracting one file's mirrored section (or the index table) back out of an
// already-built Reference zone - used by read_overview to answer from what's
// actually stored, not by recomputing straight from disk.
// ---------------------------------------------------------------------------

/** The HTML for one file's `<h3>Name</h3>` section (excluding the heading
 * itself), or null if that file has no section (e.g. it was missing at last sync). */
export function extractFileSectionHtml(referenceZoneHtml, filename) {
  const h3s = findAllBalancedBlocks(referenceZoneHtml, "h3");
  for (let i = 0; i < h3s.length; i++) {
    if (decodeHtmlText(h3s[i].inner) === filename) {
      const end = i + 1 < h3s.length ? h3s[i + 1].start : referenceZoneHtml.length;
      return referenceZoneHtml.slice(h3s[i].end, end);
    }
  }
  return null;
}

/** The Reference zone's index `<table>...</table>` HTML, or null if absent. */
export function extractIndexTableHtml(referenceZoneHtml) {
  const tables = findAllBalancedBlocks(referenceZoneHtml, "table");
  return tables.length ? referenceZoneHtml.slice(tables[0].start, tables[0].end) : null;
}

/** Resolve a user-supplied `section` argument (e.g. "STACK", "stack.md") to
 * its canonical filename in OVERVIEW_FILES, or null if it doesn't match one. */
export function resolveSectionName(section) {
  const normalized = section.trim().toLowerCase().replace(/\.md$/, "");
  return OVERVIEW_FILES.find((f) => f.toLowerCase().replace(/\.md$/, "") === normalized) || null;
}
