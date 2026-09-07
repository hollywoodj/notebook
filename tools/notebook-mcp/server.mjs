#!/usr/bin/env node
// Notebook MCP server: a single-file, zero-dependency Node ESM server that
// exposes a Claude<->Notebook bridge over stdio (MCP: newline-delimited
// JSON-RPC 2.0). Hard-scoped to one notebook - see README.md.
//
// Transport is resolved per tool call: HTTP against notebook-api when it's
// reachable, direct SQLite (node:sqlite, no new dependency) when it isn't -
// so every tool keeps working while the Notebook app is closed. See
// sqlite.mjs for the offline implementation.
//
// Nothing but JSON-RPC may ever reach stdout. All logging goes to stderr.

import { readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { htmlToMarkdown, markdownToHtml, escapeHtml, parseTaskListItems } from "./format.mjs";
import { ApiError, SqliteError, resolveNoteTransport } from "./noteTransport.mjs";
import {
  ToolInputError,
  PROJECT_NOTE_OFFSET,
  parseProjectBlock,
  serializeProjectBlock,
  parseDevLog,
  serializeDevLog,
  combinedItems,
  formatNumberedItems,
  resolveRequiredProject,
  requireProjectArg,
} from "./notes.mjs";
import {
  OVERVIEW_NOTE_TITLE,
  OVERVIEW_FILES,
  isDevProject,
  isProjectNoteTitle,
  buildIdeasZoneHtml,
  buildReferenceZoneHtml,
  parseOverviewZones,
  extractFileSectionHtml,
  extractIndexTableHtml,
  resolveSectionName,
} from "./overview.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.local.json");

const API_BASE = (process.env.NOTEBOOK_API || "http://127.0.0.1:8799").replace(/\/$/, "");
const NOTEBOOK_ID = process.env.NOTEBOOK_MCP_NOTEBOOK_ID || "3634580e-8510-409a-9f1d-efba851586da";
const REQUEST_TIMEOUT_MS = 10_000;
// Generous on purpose. The old 800ms budget could not tell "the app is not
// running" from "the app is busy": every API handler shares one mutex, so a
// single slow request stalled /health, and this server quietly wrote straight
// into the SQLite file behind the running app instead.
const HEALTH_TIMEOUT_MS = 5_000;
/** Backoff between health retries once the API is known to be up but busy. */
const HEALTH_RETRY_DELAYS_MS = [1_000, 2_000, 4_000];
const DEV_LOG_TITLE = "Dev Log";
const DEV_ROOT = process.env.DEV_ROOT || "C:\\Users\\James\\Dev";

function log(...args) {
  console.error("[notebook-mcp]", ...args);
}

// ApiError / SqliteError are imported from noteTransport.mjs now (see below).

// ---------------------------------------------------------------------------
// Config (resolved special-note ids, cached db path)
// ---------------------------------------------------------------------------

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function saveConfig(cfg) {
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n", "utf8");
}

function cacheDbPath(dbPath) {
  if (!dbPath) return;
  const config = loadConfig();
  if (config.dbPath !== dbPath) {
    config.dbPath = dbPath;
    saveConfig(config);
  }
}

function cacheProjectNoteId(project, noteId) {
  const config = loadConfig();
  config.projectNotes = config.projectNotes || {};
  if (config.projectNotes[project] !== noteId) {
    config.projectNotes[project] = noteId;
    saveConfig(config);
  }
}

function uncacheProjectNoteId(project) {
  const config = loadConfig();
  if (config.projectNotes && project in config.projectNotes) {
    delete config.projectNotes[project];
    saveConfig(config);
  }
}

function cacheDevLogNoteId(noteId) {
  const config = loadConfig();
  if (config.devLogNoteId !== noteId) {
    config.devLogNoteId = noteId;
    saveConfig(config);
  }
}

function cacheOverviewNoteId(noteId) {
  const config = loadConfig();
  if (config.overviewNoteId !== noteId) {
    config.overviewNoteId = noteId;
    saveConfig(config);
  }
}

function saveOverviewSyncState(statResults) {
  const config = loadConfig();
  const sync = {};
  for (const f of statResults) {
    if (f.exists) sync[f.name] = { mtimeMs: f.mtimeMs, size: f.size };
  }
  config.overviewSync = sync;
  saveConfig(config);
}

// ---------------------------------------------------------------------------
// Transport resolution - the actual HTTP/SQLite logic lives in
// noteTransport.mjs (shared with tools/notebook-links, which reuses the
// exact same write path). This is a thin wrapper plugging in notebook-mcp's
// own env vars, config-file db-path cache, and logging.
// ---------------------------------------------------------------------------

async function resolveTransport() {
  return resolveNoteTransport({
    apiBase: API_BASE,
    notebookId: NOTEBOOK_ID,
    envDb: process.env.NOTEBOOK_DB,
    cachedDbPath: loadConfig().dbPath,
    forceSqlite: process.env.NOTEBOOK_MCP_FORCE_SQLITE === "1",
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
    retryDelaysMs: HEALTH_RETRY_DELAYS_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    onHealthOk: (health) => {
      if (health?.database) cacheDbPath(health.database);
    },
    log,
  });
}

// ---------------------------------------------------------------------------
// Note helpers (transport-agnostic; operate through a resolved `store`)
// ---------------------------------------------------------------------------

async function getNoteScoped(store, id) {
  const note = await store.getNote(id);
  if (!note) throw new ToolInputError(`No note found with id ${id}.`);
  if (note.notebook_id !== NOTEBOOK_ID) {
    throw new ToolInputError(`Note ${id} is not in the scoped notebook (${NOTEBOOK_ID}); refusing.`);
  }
  return note;
}

async function resolveNoteRef(store, { note_id, title }) {
  if (note_id) return getNoteScoped(store, note_id);
  if (title) {
    const found = await store.findByExactTitle(title);
    if (!found) return null;
    return getNoteScoped(store, found.id);
  }
  throw new ToolInputError("Provide note_id or title.");
}

// ---------------------------------------------------------------------------
// Dev Log / per-project note resolution
// ---------------------------------------------------------------------------

const DEV_LOG_SEED_MD = `This note is Claude Code's and James's shared catch-all: every project that hasn't been given its own note lives here as a "## ProjectName" section, holding "### Bugs", "### Future Improvements", and "### Architecture Reviews" subsections (reviews newest first). \`update_backlog\` / \`add_report\` (the Notebook MCP server's tools) create sections and subsections on demand.

Once a project is busy enough to want its own note, run \`enable_project\` - it moves that project's whole section out of here into a dedicated note titled with just the project's name (\`disable_project\` folds it back in, never permanently deleting anything). \`list_projects\` shows every project known here or holding its own note, with its enabled state.`;

/** Dev Log, if it currently exists - never creates it. Used by pure reads and
 * by enable_project, which must not conjure Dev Log into existence just to
 * discover a brand-new project has no section in it. */
async function findDevLogNote(store) {
  const config = loadConfig();
  if (config.devLogNoteId) {
    const note = await store.getNote(config.devLogNoteId);
    if (note && !note.deleted_at && note.notebook_id === NOTEBOOK_ID && note.title === DEV_LOG_TITLE) {
      return note;
    }
  }
  const found = await store.findByExactTitle(DEV_LOG_TITLE);
  if (found) {
    const note = await getNoteScoped(store, found.id);
    if (!note.deleted_at) {
      cacheDevLogNoteId(note.id);
      return note;
    }
  }
  return null;
}

/** Dev Log's id, creating it (with seed content) on first use if it doesn't
 * exist yet. Used by writes, which always need somewhere to land. */
async function resolveDevLogNoteId(store) {
  const existing = await findDevLogNote(store);
  if (existing) return existing.id;
  const created = await store.createNote(DEV_LOG_TITLE, markdownToHtml(DEV_LOG_SEED_MD));
  cacheDevLogNoteId(created.id);
  return created.id;
}

/** The project's own note, if one currently exists in the scoped notebook (an "enabled" project). */
async function findOwnProjectNote(store, project) {
  const config = loadConfig();
  const cachedId = config.projectNotes && config.projectNotes[project];
  if (cachedId) {
    const note = await store.getNote(cachedId);
    if (note && !note.deleted_at && note.notebook_id === NOTEBOOK_ID && note.title === project) {
      return note;
    }
  }
  const found = await store.findByExactTitle(project);
  if (found) {
    const note = await getNoteScoped(store, found.id);
    if (!note.deleted_at) {
      cacheProjectNoteId(project, note.id);
      return note;
    }
  }
  return null;
}

/** Routing rule shared by every backlog/report tool: a note titled exactly
 * `project` is that project's target (offset 0); otherwise Dev Log (offset 1),
 * created on first use. */
async function resolveProjectTarget(store, project) {
  const own = await findOwnProjectNote(store, project);
  if (own) return { kind: "own", noteId: own.id };
  const devLogId = await resolveDevLogNoteId(store);
  return { kind: "devlog", noteId: devLogId };
}

/** Read a project's block for display: returns a null block if the project
 * has no section anywhere yet. Never creates Dev Log - a pure read must not
 * conjure it into existence just to find nothing in it. */
async function getProjectBlock(store, project) {
  const own = await findOwnProjectNote(store, project);
  if (own) {
    const note = await getNoteScoped(store, own.id);
    return { kind: "own", note, block: parseProjectBlock(note.content, PROJECT_NOTE_OFFSET) };
  }
  const devLogNote = await findDevLogNote(store);
  if (!devLogNote) return { kind: "devlog", note: null, block: null };
  const devLog = parseDevLog(devLogNote.content);
  const found = devLog.projects.find((p) => p.name === project);
  return {
    kind: "devlog",
    note: devLogNote,
    block: found ? { bugs: found.bugs, improvements: found.improvements, reviews: found.reviews } : null,
  };
}

/** Read-modify-write a project's block, creating it (and Dev Log, if needed)
 * on demand. `mutate(block)` mutates `{bugs, improvements, reviews}` in place
 * and its return value is passed back to the caller. Always re-resolves and
 * re-fetches immediately before writing - never reuses an earlier read. */
async function withProjectBlock(store, project, mutate) {
  const target = await resolveProjectTarget(store, project);
  const note = await getNoteScoped(store, target.noteId); // fresh GET, immediately before the write below
  if (target.kind === "own") {
    const block = parseProjectBlock(note.content, PROJECT_NOTE_OFFSET);
    const result = mutate(block);
    await store.updateNote(note.id, serializeProjectBlock(block, PROJECT_NOTE_OFFSET));
    return result;
  }
  const devLog = parseDevLog(note.content);
  let entry = devLog.projects.find((p) => p.name === project);
  if (!entry) {
    entry = { name: project, bugs: [], improvements: [], reviews: [] };
    devLog.projects.push(entry);
  }
  const result = mutate(entry);
  await store.updateNote(note.id, serializeDevLog(devLog));
  return result;
}

// ---------------------------------------------------------------------------
// Dev - Overview: the global note (Ideas zone + generated Reference zone
// mirroring the Dev root markdown files). Sync is one-way (files -> note)
// and mtime-driven: read_overview only regenerates the Reference zone when
// something's actually stale; sync_overview always does.
// ---------------------------------------------------------------------------

/** Stats + reads all Dev root files listed in OVERVIEW_FILES. A missing file is never an error -
 * it's just `exists: false` and gets listed as "missing" in the index table. */
function statAllDevRootFiles() {
  return OVERVIEW_FILES.map((name) => {
    const full = path.join(DEV_ROOT, name);
    try {
      const st = statSync(full);
      const content = readFileSync(full, "utf8");
      return { name, exists: true, mtimeMs: st.mtimeMs, size: st.size, content };
    } catch {
      return { name, exists: false, mtimeMs: null, size: null, content: "" };
    }
  });
}

/** Which of `statResults` differ (existence, mtime, or size) from the last
 * recorded sync state - the trigger for an mtime-driven regeneration. */
function diffSyncState(prevSync, statResults) {
  const changed = [];
  for (const f of statResults) {
    const old = prevSync[f.name];
    if (!!old !== f.exists) {
      changed.push(f.name);
      continue;
    }
    if (f.exists && (old.mtimeMs !== f.mtimeMs || old.size !== f.size)) changed.push(f.name);
  }
  return changed;
}

/** Dev - Overview, if it currently exists - never creates it. */
async function findOverviewNote(store) {
  const config = loadConfig();
  if (config.overviewNoteId) {
    const note = await store.getNote(config.overviewNoteId);
    if (note && !note.deleted_at && note.notebook_id === NOTEBOOK_ID && note.title === OVERVIEW_NOTE_TITLE) {
      return note;
    }
  }
  const found = await store.findByExactTitle(OVERVIEW_NOTE_TITLE);
  if (found) {
    const note = await getNoteScoped(store, found.id);
    if (!note.deleted_at) {
      cacheOverviewNoteId(note.id);
      return note;
    }
  }
  return null;
}

/**
 * Stats all Dev root files listed in OVERVIEW_FILES, and regenerates the Reference zone (creating
 * Dev - Overview on first use if it doesn't exist yet) whenever `force` is
 * set, the note doesn't exist yet, its Reference zone is absent, or any
 * file's mtime/size differs from what was recorded at last sync. The Ideas
 * zone is always carried over byte-identical. Returns the live note,
 * `statResults`, the list of file names whose stat changed since last sync,
 * and whether a write actually happened.
 */
async function ensureOverviewSynced(store, { force = false } = {}) {
  const statResults = statAllDevRootFiles();
  const config = loadConfig();
  const existingNote = await findOverviewNote(store);
  const zones = existingNote ? parseOverviewZones(existingNote.content) : null;
  const hasReferenceZone = !!(zones && zones.hasReference);
  const changed = diffSyncState(config.overviewSync || {}, statResults);
  const shouldSync = force || !existingNote || !hasReferenceZone || changed.length > 0;

  if (!shouldSync) {
    return { note: existingNote, statResults, changed: [], synced: false };
  }

  const ideasZoneHtml = zones ? zones.ideasZoneHtml : buildIdeasZoneHtml([]);
  const syncedAtIso = new Date().toISOString();
  const referenceZoneHtml = buildReferenceZoneHtml(statResults, syncedAtIso);
  const newContent = ideasZoneHtml + referenceZoneHtml;

  const note = existingNote
    ? await store.updateNote(existingNote.id, newContent)
    : await store.createNote(OVERVIEW_NOTE_TITLE, newContent);
  cacheOverviewNoteId(note.id);
  saveOverviewSyncState(statResults);
  return { note, statResults, changed, synced: true };
}

/** Read-modify-write against just the Ideas zone, leaving the Reference zone
 * (whatever it currently is) untouched. Always syncs first (force:false) so
 * the note - and its Reference zone - exists and is fresh before we touch
 * Ideas, then re-fetches immediately before writing, per the project's usual
 * fresh-read-modify-write convention. */
async function withIdeasList(store, mutate) {
  const { note: justSynced } = await ensureOverviewSynced(store, { force: false });
  const fresh = await getNoteScoped(store, justSynced.id); // fresh GET, immediately before the write below
  const zones = parseOverviewZones(fresh.content);
  const items = parseTaskListItems(zones.ideasZoneHtml);
  const result = mutate(items);
  const newContent = buildIdeasZoneHtml(items) + zones.referenceZoneHtml;
  await store.updateNote(fresh.id, newContent);
  return result;
}

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

/** Resolves a check/uncheck ref (an item number from read_backlog's output, or
 * exact item text) against a `combined` list of `{ it }}` entries (as produced
 * by combinedItems, or a flat `items.map((it) => ({ it }))` for Dev's Ideas
 * list). `label` only shapes the error message (e.g. `project "X"` or "Dev's
 * Ideas list"). */
function makeResolveItemRef(combined, label) {
  return function resolveItemRef(ref) {
    const asString = String(ref).trim();
    if (/^\d+$/.test(asString)) {
      const n = Number(asString);
      if (n < 1 || n > combined.length) {
        return { error: `item number ${ref} (${label} currently has ${combined.length} item(s))` };
      }
      return { entry: combined[n - 1] };
    }
    const match = combined.find((c) => c.it.text === asString);
    if (!match) return { error: `item text "${ref}"` };
    return { entry: match };
  };
}

/** Applies validated check/uncheck/add-bugs/add-improvements against one
 * `{ bugs, improvements }`-shaped block (or Dev's Ideas list, passed as
 * `{ bugs: items, improvements: [] }` so both add_bugs/add_improvements land
 * in the same flat array). Throws ToolInputError (no changes made) if any
 * check/uncheck ref doesn't resolve. Returns a human-readable summary string. */
function applyBacklogEdits(block, { addBugs, addImprovements, checkRefs, uncheckRefs }, label) {
  const combined = combinedItems(block);
  const resolveItemRef = makeResolveItemRef(combined, label);

  const checkResolved = checkRefs.map((r) => ({ ref: r, res: resolveItemRef(r) }));
  const uncheckResolved = uncheckRefs.map((r) => ({ ref: r, res: resolveItemRef(r) }));
  const failures = [...checkResolved, ...uncheckResolved].filter((x) => x.res.error).map((x) => x.res.error);
  if (failures.length) {
    throw new ToolInputError(`update_backlog: no matching item for ${failures.join(", ")}. No changes were made.`);
  }

  for (const { res } of checkResolved) res.entry.it.checked = true;
  for (const { res } of uncheckResolved) res.entry.it.checked = false;
  for (const text of addBugs) block.bugs.push({ text, checked: false });
  for (const text of addImprovements) block.improvements.push({ text, checked: false });

  const parts = [];
  if (addBugs.length) parts.push(`added ${addBugs.length} bug(s)`);
  if (addImprovements.length) parts.push(`added ${addImprovements.length} improvement(s)`);
  if (checkResolved.length) parts.push(`checked ${checkResolved.length} item(s)`);
  if (uncheckResolved.length) parts.push(`unchecked ${uncheckResolved.length} item(s)`);
  return parts.length ? parts.join(", ") : "no changes";
}

/** Dev's Ideas list is a single flat list - unlike an ordinary project's
 * bugs/improvements split, add_bugs and add_improvements both just append to
 * it. Same validate-before-mutate shape as applyBacklogEdits otherwise. */
function applyIdeaEdits(items, { addBugs, addImprovements, checkRefs, uncheckRefs }) {
  const combined = items.map((it) => ({ it }));
  const resolveItemRef = makeResolveItemRef(combined, `Dev's Ideas list`);

  const checkResolved = checkRefs.map((r) => ({ ref: r, res: resolveItemRef(r) }));
  const uncheckResolved = uncheckRefs.map((r) => ({ ref: r, res: resolveItemRef(r) }));
  const failures = [...checkResolved, ...uncheckResolved].filter((x) => x.res.error).map((x) => x.res.error);
  if (failures.length) {
    throw new ToolInputError(`update_backlog: no matching item for ${failures.join(", ")}. No changes were made.`);
  }

  for (const { res } of checkResolved) res.entry.it.checked = true;
  for (const { res } of uncheckResolved) res.entry.it.checked = false;
  const newTexts = [...addBugs, ...addImprovements];
  for (const text of newTexts) items.push({ text, checked: false });

  const parts = [];
  if (newTexts.length) parts.push(`added ${newTexts.length} idea(s)`);
  if (checkResolved.length) parts.push(`checked ${checkResolved.length} item(s)`);
  if (uncheckResolved.length) parts.push(`unchecked ${uncheckResolved.length} item(s)`);
  return parts.length ? parts.join(", ") : "no changes";
}

function blockCounts(block) {
  return {
    bugsOpen: block.bugs.filter((b) => !b.checked).length,
    bugsTotal: block.bugs.length,
    improvementsOpen: block.improvements.filter((b) => !b.checked).length,
    improvementsTotal: block.improvements.length,
    reviews: block.reviews.length,
  };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolListNotes(_args, store) {
  const notes = await store.listNotes();
  if (!notes.length) return textResult("(no notes in the scoped notebook yet)");
  const lines = notes.map((n) => `- ${n.title || "(untitled)"}  [id: ${n.id}]  updated: ${n.updated_at}`);
  return textResult(lines.join("\n"));
}

function describeRef({ note_id, title }) {
  return note_id ? `note_id "${note_id}"` : `title "${title}"`;
}

async function toolReadNote(args, store) {
  const note = await resolveNoteRef(store, args);
  if (!note) throw new ToolInputError(`No note found matching ${describeRef(args)} in the scoped notebook.`);
  return textResult(`# ${note.title}\n\n${htmlToMarkdown(note.content)}`);
}

async function toolWriteNote(args, store) {
  const { note_id, title, content_markdown, mode = "append", create_if_missing = false } = args;
  if (!note_id && !title) throw new ToolInputError("Provide note_id or title.");
  if (typeof content_markdown !== "string") throw new ToolInputError("content_markdown is required.");
  if (!["replace", "append", "prepend"].includes(mode)) {
    throw new ToolInputError(`Invalid mode "${mode}"; use replace, append, or prepend.`);
  }

  let existing;
  if (note_id) {
    existing = await getNoteScoped(store, note_id);
  } else {
    existing = await resolveNoteRef(store, { title });
  }

  if (!existing) {
    if (!create_if_missing) {
      throw new ToolInputError(
        `No note titled "${title}" found in the scoped notebook. Pass create_if_missing:true to create it.`
      );
    }
    const created = await store.createNote(title, markdownToHtml(content_markdown));
    return textResult(`Created note "${title}" [id: ${created.id}].`);
  }

  // Read-modify-write: re-GET immediately before the write, never reuse a cached copy.
  const fresh = await getNoteScoped(store, existing.id);
  const newHtml = markdownToHtml(content_markdown);
  let finalHtml;
  if (mode === "replace") finalHtml = newHtml;
  else if (mode === "prepend") finalHtml = newHtml + fresh.content;
  else finalHtml = fresh.content + newHtml;

  const updated = await store.updateNote(fresh.id, finalHtml);
  return textResult(`Updated note "${updated.title || fresh.title}" [id: ${updated.id || fresh.id}] (mode: ${mode}).`);
}

async function toolSearchNotes(args, store) {
  const query = args.query;
  if (typeof query !== "string" || !query.trim()) throw new ToolInputError("query is required.");
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 20;
  const result = await store.search(query, limit);
  if (!result.notes.length) return textResult(`No matches for "${query}" in the scoped notebook.`);
  const lines = result.notes.map((n) => `- ${n.title || "(untitled)"}  [id: ${n.id}]\n  ${n.snippet}`);
  return textResult(lines.join("\n"));
}

/** Enumerate every project known to Dev Log or holding its own note: any
 * note in the scoped notebook other than Dev Log IS a project note (that's
 * exactly what enable_project creates, and all this notebook ever holds). */
async function listAllProjects(store) {
  const notes = await store.listNotes();
  const devLogSummary = notes.find((n) => n.title === DEV_LOG_TITLE);
  const rows = [];
  if (devLogSummary) {
    const devLogNote = await getNoteScoped(store, devLogSummary.id);
    for (const p of parseDevLog(devLogNote.content).projects) {
      rows.push({ name: p.name, enabled: false, block: { bugs: p.bugs, improvements: p.improvements, reviews: p.reviews } });
    }
  }
  for (const n of notes) {
    if (!isProjectNoteTitle(n.title, DEV_LOG_TITLE)) continue;
    const note = await getNoteScoped(store, n.id);
    rows.push({ name: n.title, enabled: true, block: parseProjectBlock(note.content, PROJECT_NOTE_OFFSET) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

async function toolReadBacklog(args, store) {
  const projectFilter = typeof args.project === "string" && args.project.trim() ? args.project.trim() : null;

  if (projectFilter && isDevProject(projectFilter)) {
    const { note } = await ensureOverviewSynced(store, { force: false });
    const zones = parseOverviewZones(note.content);
    const items = parseTaskListItems(zones.ideasZoneHtml);
    return textResult([`## Ideas`, formatNumberedItems(items, 1)].join("\n\n"));
  }

  if (projectFilter) {
    const { block } = await getProjectBlock(store, projectFilter);
    if (!block) return textResult(`No section for project "${projectFilter}" yet in Dev Log.`);
    return textResult(
      [
        `## ${projectFilter}`,
        `### Bugs`,
        formatNumberedItems(block.bugs, 1),
        `### Future Improvements`,
        formatNumberedItems(block.improvements, block.bugs.length + 1),
      ].join("\n\n")
    );
  }

  const rows = await listAllProjects(store);
  if (!rows.length) return textResult("No projects yet - Dev Log has no sections and no project has its own note.");
  const out = rows.map((r) =>
    [
      `## ${r.name}${r.enabled ? " (own note)" : " (Dev Log)"}`,
      `### Bugs`,
      formatNumberedItems(r.block.bugs, 1),
      `### Future Improvements`,
      formatNumberedItems(r.block.improvements, r.block.bugs.length + 1),
    ].join("\n\n")
  );
  return textResult(out.join("\n\n"));
}

async function toolUpdateBacklog(args, store) {
  const project = resolveRequiredProject(args.project);
  const addBugs = Array.isArray(args.add_bugs) ? args.add_bugs.map(String) : [];
  const addImprovements = Array.isArray(args.add_improvements) ? args.add_improvements.map(String) : [];
  const checkRefs = Array.isArray(args.check) ? args.check : [];
  const uncheckRefs = Array.isArray(args.uncheck) ? args.uncheck : [];
  const edits = { addBugs, addImprovements, checkRefs, uncheckRefs };

  if (isDevProject(project)) {
    const summary = await withIdeasList(store, (items) => applyIdeaEdits(items, edits));
    return textResult(`Updated "${OVERVIEW_NOTE_TITLE}" Ideas: ${summary}.`);
  }

  const summary = await withProjectBlock(store, project, (block) =>
    applyBacklogEdits(block, edits, `project "${project}"`)
  );
  return textResult(`Updated "${project}": ${summary}.`);
}

async function toolReadReports(args, store) {
  const projectFilter = typeof args.project === "string" && args.project.trim() ? args.project.trim() : null;
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 3;

  if (projectFilter) {
    const { block } = await getProjectBlock(store, projectFilter);
    const entries = (block ? block.reviews : []).slice(0, limit);
    if (!entries.length) return textResult(`No Architecture Review entries yet for project "${projectFilter}".`);
    const out = entries.map((e) => {
      const subtitle = e.subtitle ? `*${e.subtitle}*\n\n` : "";
      return `## ${e.date}\n\n${subtitle}${htmlToMarkdown(e.bodyHtml)}`;
    });
    return textResult(out.join("\n\n---\n\n"));
  }

  const rows = await listAllProjects(store);
  const all = [];
  for (const r of rows) {
    for (const e of r.block.reviews) all.push({ ...e, project: r.name });
  }
  // Newest-first across all projects, by date string (RFC3339-ish "YYYY-MM-DD" sorts lexically).
  all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const entries = all.slice(0, limit);
  if (!entries.length) return textResult("No Architecture Review entries yet.");
  const out = entries.map((e) => {
    const subtitle = e.subtitle ? `*${e.subtitle}*\n\n` : "";
    return `## ${e.date} · ${e.project}\n\n${subtitle}${htmlToMarkdown(e.bodyHtml)}`;
  });
  return textResult(out.join("\n\n---\n\n"));
}

async function toolAddReport(args, store) {
  const project = resolveRequiredProject(args.project);
  if (isDevProject(project)) {
    throw new ToolInputError(
      `add_report: "Dev" is the global "${OVERVIEW_NOTE_TITLE}" note, not a project - architecture reviews belong to a real project. Pass an explicit project.`
    );
  }
  if (typeof args.body_markdown !== "string" || !args.body_markdown.trim()) {
    throw new ToolInputError("body_markdown is required.");
  }
  const date = new Date().toISOString().slice(0, 10);
  const subtitle = typeof args.subtitle === "string" && args.subtitle.trim() ? args.subtitle.trim() : null;
  const bodyHtml = markdownToHtml(args.body_markdown);

  await withProjectBlock(store, project, (block) => {
    block.reviews.unshift({ date, subtitle, bodyHtml });
  });

  return textResult(`Added Architecture Review entry for "${project}": "${date}"`);
}

async function toolEnableProject(args, store) {
  const project = requireProjectArg(args);
  if (isDevProject(project)) {
    throw new ToolInputError(
      `enable_project: "Dev" is reserved for the global "${OVERVIEW_NOTE_TITLE}" note, not an ordinary project - it has no Dev Log section to move.`
    );
  }
  const already = await findOwnProjectNote(store, project);
  if (already) {
    return textResult(`"${project}" is already enabled - it has its own note [id: ${already.id}]. No changes made.`);
  }

  // Only touch Dev Log if it already exists - enabling a brand-new project
  // (one with no Dev Log presence yet) must not create Dev Log as a side effect.
  const devLogNote = await findDevLogNote(store);
  let block = { bugs: [], improvements: [], reviews: [] };
  let devLog = null;
  let idx = -1;
  if (devLogNote) {
    devLog = parseDevLog(devLogNote.content);
    idx = devLog.projects.findIndex((p) => p.name === project);
    if (idx !== -1) block = devLog.projects[idx];
  }

  const created = await store.createNote(project, serializeProjectBlock(block, PROJECT_NOTE_OFFSET));
  cacheProjectNoteId(project, created.id);

  if (idx !== -1) {
    devLog.projects.splice(idx, 1);
    await store.updateNote(devLogNote.id, serializeDevLog(devLog));
    return textResult(`Enabled "${project}": moved its Dev Log section into a new note [id: ${created.id}].`);
  }
  return textResult(`Enabled "${project}": created its own note [id: ${created.id}] (it had no Dev Log section yet).`);
}

async function toolDisableProject(args, store) {
  const project = requireProjectArg(args);
  if (isDevProject(project)) {
    throw new ToolInputError(
      `disable_project: "Dev" is reserved for the global "${OVERVIEW_NOTE_TITLE}" note, not an ordinary project - it has no Dev Log section to fold back into.`
    );
  }
  const ownNote = await findOwnProjectNote(store, project);
  if (!ownNote) {
    return textResult(`"${project}" is not enabled (no dedicated note in the scoped notebook) - nothing to disable.`);
  }
  const fresh = await getNoteScoped(store, ownNote.id); // fresh
  const block = parseProjectBlock(fresh.content, PROJECT_NOTE_OFFSET);

  const devLogId = await resolveDevLogNoteId(store);
  const devLogNote = await getNoteScoped(store, devLogId); // fresh
  const devLog = parseDevLog(devLogNote.content);
  const idx = devLog.projects.findIndex((p) => p.name === project);
  if (idx !== -1) devLog.projects.splice(idx, 1); // shouldn't exist while enabled, but guard against drift
  devLog.projects.push({ name: project, ...block });

  // Fold into Dev Log first, then trash the note - so a failure never loses content.
  await store.updateNote(devLogNote.id, serializeDevLog(devLog));
  await store.softDeleteNote(fresh.id);
  uncacheProjectNoteId(project);

  return textResult(`Disabled "${project}": folded its content back into Dev Log and moved its note to trash.`);
}

async function toolListProjects(_args, store) {
  const rows = await listAllProjects(store);
  if (!rows.length) return textResult("No projects yet - Dev Log has no sections and no project has its own note.");
  const lines = rows.map((r) => {
    const c = blockCounts(r.block);
    return `- ${r.name} (${r.enabled ? "enabled" : "disabled, in Dev Log"}) - bugs: ${c.bugsOpen} open / ${c.bugsTotal} total, improvements: ${c.improvementsOpen} open / ${c.improvementsTotal} total, reviews: ${c.reviews}`;
  });
  return textResult(lines.join("\n"));
}

function overviewIndexMarkdown(referenceZoneHtml) {
  const tableHtml = extractIndexTableHtml(referenceZoneHtml);
  return tableHtml ? htmlToMarkdown(tableHtml) : "(no index table)";
}

async function toolReadOverview(args, store) {
  const { note, statResults } = await ensureOverviewSynced(store, { force: false });
  const zones = parseOverviewZones(note.content);
  const ideas = parseTaskListItems(zones.ideasZoneHtml);
  const sectionArg = typeof args.section === "string" && args.section.trim() ? args.section.trim() : null;

  if (!sectionArg) {
    const sectionNames = statResults.map((f) => (f.exists ? f.name : `${f.name} (missing)`)).join(", ");
    return textResult(
      [
        `## Ideas`,
        formatNumberedItems(ideas, 1),
        `## Reference index`,
        overviewIndexMarkdown(zones.referenceZoneHtml),
        `Available sections: ${sectionNames}. Pass section: "<name>" for one file's mirrored content, or section: "all" for everything.`,
      ].join("\n\n")
    );
  }

  if (sectionArg.toLowerCase() === "all") {
    const parts = [`## Ideas`, formatNumberedItems(ideas, 1), `## Reference index`, overviewIndexMarkdown(zones.referenceZoneHtml)];
    for (const f of statResults) {
      if (!f.exists) continue;
      const sectionHtml = extractFileSectionHtml(zones.referenceZoneHtml, f.name);
      parts.push(`### ${f.name}`, sectionHtml ? htmlToMarkdown(sectionHtml) : "(no mirrored content)");
    }
    return textResult(parts.join("\n\n"));
  }

  const resolved = resolveSectionName(sectionArg);
  if (!resolved) {
    throw new ToolInputError(
      `read_overview: unknown section "${sectionArg}". Available sections: ${OVERVIEW_FILES.join(", ")}, or "all".`
    );
  }
  const statEntry = statResults.find((f) => f.name === resolved);
  if (!statEntry.exists) {
    return textResult(`"${resolved}" is missing from ${DEV_ROOT} - nothing mirrored for it.`);
  }
  const sectionHtml = extractFileSectionHtml(zones.referenceZoneHtml, resolved);
  if (!sectionHtml) {
    return textResult(`"${resolved}" exists on disk but has no mirrored section yet - run sync_overview.`);
  }
  return textResult(htmlToMarkdown(sectionHtml));
}

async function toolSyncOverview(_args, store) {
  const { note, changed } = await ensureOverviewSynced(store, { force: true });
  const changedMsg = changed.length ? changed.join(", ") : "(none - every file was already up to date)";
  return textResult(`Synced "${OVERVIEW_NOTE_TITLE}" [id: ${note.id}]. Changed: ${changedMsg}.`);
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS = {
  list_notes: {
    description:
      "List all notes in the scoped notebook (id, title, last-updated). This notebook only ever holds a 'Dev Log' catch-all note, the global 'Dev - Overview' note, plus one note per enabled project. Only notes inside this one hard-scoped notebook are visible - there is no way to list, browse, or move notes into other notebooks.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolListNotes,
  },
  read_note: {
    description:
      "Read a note's full content as Markdown. Provide either note_id or an exact title (title lookups only search the scoped notebook). Refuses notes outside the scoped notebook.",
    inputSchema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "Note UUID." },
        title: { type: "string", description: "Exact note title (used if note_id is omitted)." },
      },
      additionalProperties: false,
    },
    handler: toolReadNote,
  },
  write_note: {
    description:
      "Create or update a note in the scoped notebook, given Markdown content (converted to the app's rich-text HTML). `mode` controls how content_markdown combines with any existing content: 'append' (default) adds after, 'prepend' adds before, 'replace' overwrites. Set create_if_missing:true to create the note (requires title) when no match exists. Every write is a fresh read-modify-write, and the app's note revision history covers mistakes (written on both transports).",
    inputSchema: {
      type: "object",
      properties: {
        note_id: { type: "string", description: "Note UUID to write to." },
        title: { type: "string", description: "Exact note title, used to find (or name) the note if note_id is omitted." },
        content_markdown: { type: "string", description: "Markdown content to write." },
        mode: {
          type: "string",
          enum: ["replace", "append", "prepend"],
          default: "append",
          description: "How to combine content_markdown with existing content.",
        },
        create_if_missing: {
          type: "boolean",
          default: false,
          description: "Create the note (by title) if no matching note exists yet.",
        },
      },
      required: ["content_markdown"],
      additionalProperties: false,
    },
    handler: toolWriteNote,
  },
  search_notes: {
    description: "Full-text search notes inside the scoped notebook. Returns matching titles, a snippet, and each note's id, ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search text." },
        limit: { type: "integer", default: 20, description: "Maximum results to return." },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: toolSearchNotes,
  },
  read_backlog: {
    description:
      "Read a project's Bugs / Future Improvements checklists. Routing: if the project has its own note (see enable_project), that note is read; otherwise its section in the 'Dev Log' catch-all note is read. project: \"Dev\" (case-insensitive) is reserved and reads the flat Ideas list in the global 'Dev - Overview' note instead. Items are numbered (numbers line up with what update_backlog's check/uncheck expect). Pass project to read just that project; omit to read every project known to Dev Log or holding its own note (this never includes 'Dev - Overview' itself). If the requested project has no section yet, says so plainly rather than erroring.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name; omit to read every project." } },
      additionalProperties: false,
    },
    handler: toolReadBacklog,
  },
  update_backlog: {
    description:
      "Add and/or check off items in one project's Bugs / Future Improvements checklists. Routing: writes to the project's own note if it has one (see enable_project), otherwise to its section in the 'Dev Log' catch-all note, creating that section (and Dev Log itself) on demand. project: \"Dev\" (case-insensitive) is reserved and targets the flat Ideas list in the global 'Dev - Overview' note instead - add_bugs/add_improvements both just append to it there. add_bugs/add_improvements add new unchecked items. check/uncheck each take an item number (from read_backlog's output) or exact item text, and tick/untick existing items. All references are validated before anything is written - if any check/uncheck reference doesn't match, the whole call fails with no changes made. project defaults to the current working directory's folder name if omitted (the Dev root resolves to \"Dev\").",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name; defaults to the current working directory's folder name." },
        add_bugs: { type: "array", items: { type: "string" }, description: "New unchecked bug items to add." },
        add_improvements: { type: "array", items: { type: "string" }, description: "New unchecked improvement items to add." },
        check: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "integer" }] },
          description: "Item numbers (from read_backlog) or exact item text to mark checked.",
        },
        uncheck: {
          type: "array",
          items: { oneOf: [{ type: "string" }, { type: "integer" }] },
          description: "Item numbers (from read_backlog) or exact item text to mark unchecked.",
        },
      },
      required: ["project"],
      additionalProperties: false,
    },
    handler: toolUpdateBacklog,
  },
  read_reports: {
    description:
      "Read a project's most recent Architecture Reviews entries, newest first. Routing: reads from the project's own note if it has one (see enable_project), otherwise from its section in the 'Dev Log' catch-all note. Pass project to read just that project; omit to read the most recent entries across every project (each heading then shows its project). limit controls how many entries to return (default 3).",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name to filter to; omit for all projects." },
        limit: { type: "integer", default: 3, description: "Maximum number of entries to return." },
      },
      additionalProperties: false,
    },
    handler: toolReadReports,
  },
  add_report: {
    description:
      "Prepend a new dated Architecture Reviews entry for a project, written as Markdown (converted to rich HTML). Routing: writes to the project's own note if it has one (see enable_project), otherwise to its section in the 'Dev Log' catch-all note, creating that section (and Dev Log itself) on demand. project: \"Dev\" is refused - architecture reviews belong to a real project, not the global 'Dev - Overview' note. project defaults to the current working directory's folder name if omitted. Returns the exact date heading written.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name; defaults to the current working directory's folder name." },
        body_markdown: { type: "string", description: "Markdown body of the report entry." },
        subtitle: { type: "string", description: "Optional one-line italic scope subtitle." },
      },
      required: ["project", "body_markdown"],
      additionalProperties: false,
    },
    handler: toolAddReport,
  },
  enable_project: {
    description:
      "Give a project its own note, titled with just the project name, inside the scoped notebook. Moves (never copies) that project's whole section out of the 'Dev Log' catch-all note into the new note, promoting its heading levels - the content ends up in exactly one place. If the project had no Dev Log section yet, creates an empty note. No-op with a clear message if the project already has its own note.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name (required, no default)." } },
      required: ["project"],
      additionalProperties: false,
    },
    handler: toolEnableProject,
  },
  disable_project: {
    description:
      "Inverse of enable_project: folds a project's own note back into the 'Dev Log' catch-all note as a '## ProjectName' section (demoting heading levels), then moves the now-empty project note to trash (soft delete only - always recoverable, never permanent). Only ever operates on a note that resolves as that project's note inside the scoped notebook. No-op with a clear message if the project isn't currently enabled.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name (required, no default)." } },
      required: ["project"],
      additionalProperties: false,
    },
    handler: toolDisableProject,
  },
  list_projects: {
    description:
      "List every project known to the 'Dev Log' catch-all note or holding its own note in the scoped notebook, with its enabled state (own note vs. Dev Log section) and item counts (open/total bugs and improvements, review count). Never lists 'Dev - Overview' - it's the global note, not a project.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolListProjects,
  },
  read_overview: {
    description:
      "Read the global 'Dev - Overview' note: a status board for cross-project matters, holding a hand-maintained Ideas list plus a Reference zone that mirrors James's Dev root markdown files (NOW/GOALS/STACK/PROJECTS/CLONES/PORTS/DECISIONS/SKILLS/GLOSSARY/SETUP/CLAUDE.md) one-way from disk. Auto-syncs first: if any source file's mtime/size has changed, the note doesn't exist yet, or its Reference zone is missing, the Reference zone is regenerated before answering (the Ideas zone is always left untouched). Omit `section` to get just the Ideas list, the Reference index table, and the list of available section names - NOT the full mirror. Pass `section: \"STACK.md\"` (or \"STACK\", case-insensitive) for just that file's mirrored content as Markdown, or `section: \"all\"` for everything.",
    inputSchema: {
      type: "object",
      properties: {
        section: {
          type: "string",
          description:
            'Omit for a summary (Ideas + index + available section names). One of the mirrored filenames from OVERVIEW_FILES (with or without ".md", case-insensitive) for just that file, or "all" for everything.',
        },
      },
      additionalProperties: false,
    },
    handler: toolReadOverview,
  },
  sync_overview: {
    description:
      "Force-regenerate the Reference zone of 'Dev - Overview' from the Dev root markdown files listed in OVERVIEW_FILES right now, regardless of recorded mtimes (creating the note on first use). The Ideas zone is always left byte-identical. Reports which files' mirrored content changed since the last sync.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolSyncOverview,
  },
};

const TOOL_DEFS = Object.entries(TOOLS).map(([name, t]) => ({
  name,
  description: t.description,
  inputSchema: t.inputSchema,
}));

// ---------------------------------------------------------------------------
// MCP JSON-RPC over stdio
// ---------------------------------------------------------------------------

const SUPPORTED_PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18"];
const SERVER_INFO = { name: "notebook-mcp", version: "0.3.0" };

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handleInitialize(params) {
  const requested = params && params.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-06-18";
  return { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
}

function appendTransportNote(result, store) {
  if (!store.offline || !result || !Array.isArray(result.content)) return result;
  const note = store.wrote
    ? "(offline - the Notebook app was not running, so this wrote directly to the database; open Notebook to see it)"
    : "(offline - the Notebook app was not running, so this read directly from the database)";
  result.content = result.content.map((c) => (c.type === "text" ? { ...c, text: `${c.text}\n\n${note}` } : c));
  return result;
}

async function handleToolsCall(params) {
  if (!params || typeof params.name !== "string") {
    const err = new Error("tools/call requires a string 'name' param");
    err.rpcCode = -32602;
    throw err;
  }
  const tool = TOOLS[params.name];
  if (!tool) {
    const err = new Error(`Unknown tool: ${params.name}`);
    err.rpcCode = -32602;
    throw err;
  }
  const args = params.arguments && typeof params.arguments === "object" ? params.arguments : {};

  let store;
  try {
    store = await resolveTransport();
  } catch (err) {
    if (err instanceof SqliteError) return { content: [{ type: "text", text: err.message }], isError: true };
    log(`internal error resolving transport for "${params.name}":`, err && err.stack ? err.stack : err);
    return { content: [{ type: "text", text: `Internal error: ${err.message || err}` }], isError: true };
  }

  try {
    const result = await tool.handler(args, store);
    return appendTransportNote(result, store);
  } catch (err) {
    if (err instanceof ToolInputError || err instanceof ApiError || err instanceof SqliteError) {
      return appendTransportNote({ content: [{ type: "text", text: err.message }], isError: true }, store);
    }
    log(`internal error in tool "${params.name}":`, err && err.stack ? err.stack : err);
    return { content: [{ type: "text", text: `Internal error: ${err.message || err}` }], isError: true };
  } finally {
    store.close();
  }
}

async function handleMessage(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
    log("ignoring malformed message:", msg);
    return;
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  const { method, params, id } = msg;

  if (method === "notifications/initialized") {
    log("client sent notifications/initialized");
    return; // notifications never get a response
  }
  if (!hasId) {
    log("ignoring notification:", method);
    return;
  }

  try {
    let result;
    switch (method) {
      case "initialize":
        result = handleInitialize(params);
        break;
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOL_DEFS };
        break;
      case "tools/call":
        result = await handleToolsCall(params);
        break;
      default: {
        send({ jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } });
        return;
      }
    }
    send({ jsonrpc: "2.0", id, result });
  } catch (err) {
    send({
      jsonrpc: "2.0",
      id,
      error: { code: err.rpcCode || -32603, message: err.message || String(err) },
    });
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: `Parse error: ${err.message}` } });
      continue;
    }
    handleMessage(msg).catch((err) => log("unhandled error in handleMessage:", err));
  }
});
process.stdin.on("end", () => process.exit(0));

process.on("uncaughtException", (err) => log("uncaughtException:", err && err.stack ? err.stack : err));
process.on("unhandledRejection", (err) => log("unhandledRejection:", err));

log(`notebook-mcp starting. API=${API_BASE} notebook=${NOTEBOOK_ID} config=${CONFIG_PATH}`);
