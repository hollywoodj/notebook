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

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { htmlToMarkdown, markdownToHtml, escapeHtml } from "./format.mjs";
import { createSqliteStore, candidateDbPaths, resolveDbPath } from "./sqlite.mjs";
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.local.json");

const API_BASE = (process.env.NOTEBOOK_API || "http://127.0.0.1:8799").replace(/\/$/, "");
const NOTEBOOK_ID = process.env.NOTEBOOK_MCP_NOTEBOOK_ID || "3634580e-8510-409a-9f1d-efba851586da";
const REQUEST_TIMEOUT_MS = 10_000;
const HEALTH_TIMEOUT_MS = 800;
const DEV_LOG_TITLE = "Dev Log";

function log(...args) {
  console.error("[notebook-mcp]", ...args);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Notebook API unreachable, timed out, or returned a non-2xx status. */
class ApiError extends Error {}

/** Offline (SQLite) transport failed - no DB found, or the query itself failed. */
class SqliteError extends Error {}

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

// ---------------------------------------------------------------------------
// HTTP transport (Notebook API)
// ---------------------------------------------------------------------------

async function apiFetch(pathAndQuery, options = {}) {
  const url = `${API_BASE}${pathAndQuery}`;
  let res;
  try {
    res = await fetch(url, {
      ...options,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "content-type": "application/json", ...(options.headers || {}) },
    });
  } catch (err) {
    if (err && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new ApiError(`Notebook API request to ${pathAndQuery} timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`);
    }
    throw new ApiError(`Could not reach the Notebook API at ${API_BASE}. (${err.message})`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const err = new ApiError(
      `Notebook API ${options.method || "GET"} ${pathAndQuery} -> ${res.status} ${res.statusText}${text ? `: ${text}` : ""}`
    );
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function httpStore() {
  const store = { offline: false, wrote: false };

  store.listNotes = async () => apiFetch(`/api/v1/notes?notebook_id=${NOTEBOOK_ID}`);

  store.getNote = async (id) => {
    try {
      return await apiFetch(`/api/v1/notes/${id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  };

  store.findByExactTitle = async (title) => {
    const notes = await store.listNotes();
    const found = notes.find((n) => n.title === title);
    return found ? { id: found.id, title: found.title } : null;
  };

  store.createNote = async (title, contentHtml) => {
    const created = await apiFetch("/api/v1/notes", {
      method: "POST",
      body: JSON.stringify({ notebook_id: NOTEBOOK_ID, title, content: contentHtml }),
    });
    store.wrote = true;
    return created;
  };

  store.updateNote = async (id, contentHtml) => {
    const updated = await apiFetch(`/api/v1/notes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ content: contentHtml }),
    });
    store.wrote = true;
    return updated;
  };

  store.softDeleteNote = async (id) => {
    await apiFetch(`/api/v1/notes/${id}`, { method: "DELETE" });
    store.wrote = true;
  };

  store.search = async (query, limit) =>
    apiFetch(`/api/v1/search?q=${encodeURIComponent(query)}&notebook_id=${NOTEBOOK_ID}&limit=${limit}`);

  store.close = () => {};

  return store;
}

// ---------------------------------------------------------------------------
// Transport resolution
// ---------------------------------------------------------------------------

async function resolveTransport() {
  if (process.env.NOTEBOOK_MCP_FORCE_SQLITE === "1") {
    return buildSqliteStore();
  }
  const health = await checkHealth();
  if (health) {
    if (health.database) cacheDbPath(health.database);
    return httpStore();
  }
  return buildSqliteStore();
}

function buildSqliteStore() {
  const config = loadConfig();
  const opts = { envDb: process.env.NOTEBOOK_DB, cachedDbPath: config.dbPath };
  const dbPath = resolveDbPath(opts);
  if (!dbPath) {
    const tried = candidateDbPaths(opts);
    throw new SqliteError(
      "Notebook app isn't running and no SQLite database could be found offline. Tried:\n" +
        tried.map((p) => `  - ${p}`).join("\n") +
        "\nStart the Notebook app, or set NOTEBOOK_DB to the database file path."
    );
  }
  try {
    return createSqliteStore(dbPath, NOTEBOOK_ID);
  } catch (err) {
    throw new SqliteError(`Could not open the offline database at ${dbPath}: ${err.message}`);
  }
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
// Tool result helpers
// ---------------------------------------------------------------------------

function textResult(text) {
  return { content: [{ type: "text", text }] };
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
    if (n.title === DEV_LOG_TITLE) continue;
    const note = await getNoteScoped(store, n.id);
    rows.push({ name: n.title, enabled: true, block: parseProjectBlock(note.content, PROJECT_NOTE_OFFSET) });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

async function toolReadBacklog(args, store) {
  const projectFilter = typeof args.project === "string" && args.project.trim() ? args.project.trim() : null;

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

  const summary = await withProjectBlock(store, project, (block) => {
    const combined = combinedItems(block);

    function resolveItemRef(ref) {
      const asString = String(ref).trim();
      if (/^\d+$/.test(asString)) {
        const n = Number(asString);
        if (n < 1 || n > combined.length) {
          return { error: `item number ${ref} (project "${project}" currently has ${combined.length} item(s))` };
        }
        return { entry: combined[n - 1] };
      }
      const match = combined.find((c) => c.it.text === asString);
      if (!match) return { error: `item text "${ref}"` };
      return { entry: match };
    }

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
  });

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

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS = {
  list_notes: {
    description:
      "List all notes in the scoped notebook (id, title, last-updated). This notebook only ever holds a 'Dev Log' catch-all note plus one note per enabled project. Only notes inside this one hard-scoped notebook are visible - there is no way to list, browse, or move notes into other notebooks.",
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
      "Read a project's Bugs / Future Improvements checklists. Routing: if the project has its own note (see enable_project), that note is read; otherwise its section in the 'Dev Log' catch-all note is read. Items are numbered (numbers line up with what update_backlog's check/uncheck expect). Pass project to read just that project; omit to read every project known to Dev Log or holding its own note. If the requested project has no section yet, says so plainly rather than erroring.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name; omit to read every project." } },
      additionalProperties: false,
    },
    handler: toolReadBacklog,
  },
  update_backlog: {
    description:
      "Add and/or check off items in one project's Bugs / Future Improvements checklists. Routing: writes to the project's own note if it has one (see enable_project), otherwise to its section in the 'Dev Log' catch-all note, creating that section (and Dev Log itself) on demand. add_bugs/add_improvements add new unchecked items. check/uncheck each take an item number (from read_backlog's output) or exact item text, and tick/untick existing items. All references are validated before anything is written - if any check/uncheck reference doesn't match, the whole call fails with no changes made. project defaults to the current project directory's name if omitted, and is required explicitly when that would resolve to the Dev root.",
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
      "Prepend a new dated Architecture Reviews entry for a project, written as Markdown (converted to rich HTML). Routing: writes to the project's own note if it has one (see enable_project), otherwise to its section in the 'Dev Log' catch-all note, creating that section (and Dev Log itself) on demand. Optional subtitle renders as an italic one-line summary under the heading. project defaults to the current working directory's folder name if omitted, and is required explicitly when that would resolve to the Dev root. Returns the exact date heading written.",
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
      "List every project known to the 'Dev Log' catch-all note or holding its own note in the scoped notebook, with its enabled state (own note vs. Dev Log section) and item counts (open/total bugs and improvements, review count).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    handler: toolListProjects,
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
const SERVER_INFO = { name: "notebook-mcp", version: "0.2.0" };

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
    ? "(offline - wrote directly to the database; open Notebook to see it)"
    : "(offline - read directly from the database)";
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
