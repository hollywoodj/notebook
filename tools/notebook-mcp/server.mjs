#!/usr/bin/env node
// Notebook MCP server: a single-file, zero-dependency Node ESM server that
// exposes a Claude<->Notebook bridge over stdio (MCP: newline-delimited
// JSON-RPC 2.0). Hard-scoped to one notebook - see README.md.
//
// Nothing but JSON-RPC may ever reach stdout. All logging goes to stderr.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { htmlToMarkdown, markdownToHtml, escapeHtml } from "./format.mjs";
import {
  ToolInputError,
  REPORT_HEADING_SEP,
  parseBacklogHtml,
  serializeBacklogHtml,
  combinedBacklogItems,
  formatNumberedItems,
  parseReportEntries,
  prependReportEntry,
  resolveRequiredProject,
} from "./notes.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, "config.local.json");

const API_BASE = (process.env.NOTEBOOK_API || "http://127.0.0.1:8799").replace(/\/$/, "");
const NOTEBOOK_ID = process.env.NOTEBOOK_MCP_NOTEBOOK_ID || "3634580e-8510-409a-9f1d-efba851586da";
const REQUEST_TIMEOUT_MS = 10_000;

function log(...args) {
  console.error("[notebook-mcp]", ...args);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Notebook API unreachable, timed out, or returned a non-2xx status. */
class ApiError extends Error {}

// ---------------------------------------------------------------------------
// Notebook API client
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
      throw new ApiError(
        `Notebook API request to ${pathAndQuery} timed out after ${REQUEST_TIMEOUT_MS / 1000}s. ` +
          `Is the Notebook app / \`cargo run -p notebook-api\` running at ${API_BASE}?`
      );
    }
    throw new ApiError(
      `Could not reach the Notebook API at ${API_BASE}. ` +
        `Is the Notebook app / \`cargo run -p notebook-api\` running? (${err.message})`
    );
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

/** Fetch a note by id, or null if it doesn't exist. Does NOT enforce notebook scope. */
async function getNoteRaw(id) {
  try {
    return await apiFetch(`/api/v1/notes/${id}`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Fetch a note by id and refuse it if missing or outside the scoped notebook. */
async function getNoteScoped(id) {
  const note = await getNoteRaw(id);
  if (!note) throw new ToolInputError(`No note found with id ${id}.`);
  if (note.notebook_id !== NOTEBOOK_ID) {
    throw new ToolInputError(`Note ${id} is not in the scoped notebook (${NOTEBOOK_ID}); refusing.`);
  }
  return note;
}

async function listScopedNotes() {
  return apiFetch(`/api/v1/notes?notebook_id=${NOTEBOOK_ID}`);
}

async function findByExactTitle(title) {
  const notes = await listScopedNotes();
  return notes.find((n) => n.title === title) || null;
}

async function createScopedNote(title, contentHtml) {
  return apiFetch("/api/v1/notes", {
    method: "POST",
    body: JSON.stringify({ notebook_id: NOTEBOOK_ID, title, content: contentHtml }),
  });
}

// ---------------------------------------------------------------------------
// Config (resolved special-note ids)
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

const BACKLOG_SEED_MD = `This note is James's input to Claude Code, per project: bugs to fix and improvements to make. Each project gets its own section below with a **Bugs** checklist and a **Future Improvements** checklist. Add items under the right project; \`update_backlog\` (the Notebook MCP server's tool) adds new items and ticks/unticks existing ones by number or exact text.

## Example Project

### Bugs

- [ ] (add a bug here)

### Future Improvements

- [ ] (add an improvement here)`;

const REPORT_SEED_MD = `This note is written by Claude Code (the \`/architecture-review\` command and the Notebook MCP server's \`add_report\` tool). Newest entry is at the top.`;

const SPECIAL_NOTES = {
  backlog: { configKey: "backlogNoteId", title: "Bugs & Future Improvements", seedMarkdown: BACKLOG_SEED_MD },
  report: { configKey: "architectureReviewNoteId", title: "Architecture Review", seedMarkdown: REPORT_SEED_MD },
};

// In-flight resolution promises, so concurrent calls within one process never create duplicates.
const resolving = {};

async function resolveSpecialNoteId(kind) {
  if (resolving[kind]) return resolving[kind];
  const task = (async () => {
    const meta = SPECIAL_NOTES[kind];
    const config = loadConfig();
    const existingId = config[meta.configKey];
    if (existingId) {
      const note = await getNoteRaw(existingId);
      if (note && !note.deleted_at && note.notebook_id === NOTEBOOK_ID) {
        return note.id;
      }
    }
    const found = await findByExactTitle(meta.title);
    if (found) {
      config[meta.configKey] = found.id;
      saveConfig(config);
      return found.id;
    }
    const created = await createScopedNote(meta.title, markdownToHtml(meta.seedMarkdown));
    config[meta.configKey] = created.id;
    saveConfig(config);
    return created.id;
  })();
  resolving[kind] = task;
  try {
    return await task;
  } finally {
    delete resolving[kind];
  }
}

// ---------------------------------------------------------------------------
// Tool result helpers
// ---------------------------------------------------------------------------

function textResult(text) {
  return { content: [{ type: "text", text }] };
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

async function toolListNotes() {
  const notes = await listScopedNotes();
  if (!notes.length) return textResult("(no notes in the scoped notebook yet)");
  const lines = notes.map((n) => `- ${n.title || "(untitled)"}  [id: ${n.id}]  updated: ${n.updated_at}`);
  return textResult(lines.join("\n"));
}

function describeRef({ note_id, title }) {
  return note_id ? `note_id "${note_id}"` : `title "${title}"`;
}

async function resolveNoteRef({ note_id, title }) {
  if (note_id) return getNoteScoped(note_id);
  if (title) {
    const found = await findByExactTitle(title);
    if (!found) return null;
    return getNoteScoped(found.id);
  }
  throw new ToolInputError("Provide note_id or title.");
}

async function toolReadNote(args) {
  const note = await resolveNoteRef(args);
  if (!note) throw new ToolInputError(`No note found matching ${describeRef(args)} in the scoped notebook.`);
  return textResult(`# ${note.title}\n\n${htmlToMarkdown(note.content)}`);
}

async function toolWriteNote(args) {
  const { note_id, title, content_markdown, mode = "append", create_if_missing = false } = args;
  if (!note_id && !title) throw new ToolInputError("Provide note_id or title.");
  if (typeof content_markdown !== "string") throw new ToolInputError("content_markdown is required.");
  if (!["replace", "append", "prepend"].includes(mode)) {
    throw new ToolInputError(`Invalid mode "${mode}"; use replace, append, or prepend.`);
  }

  let existing;
  if (note_id) {
    existing = await getNoteScoped(note_id);
  } else {
    existing = await resolveNoteRef({ title });
  }

  if (!existing) {
    if (!create_if_missing) {
      throw new ToolInputError(
        `No note titled "${title}" found in the scoped notebook. Pass create_if_missing:true to create it.`
      );
    }
    const created = await createScopedNote(title, markdownToHtml(content_markdown));
    return textResult(`Created note "${title}" [id: ${created.id}].`);
  }

  // Read-modify-write: re-GET immediately before the PUT, never reuse a cached copy.
  const fresh = await getNoteScoped(existing.id);
  const newHtml = markdownToHtml(content_markdown);
  let finalHtml;
  if (mode === "replace") finalHtml = newHtml;
  else if (mode === "prepend") finalHtml = newHtml + fresh.content;
  else finalHtml = fresh.content + newHtml;

  const updated = await apiFetch(`/api/v1/notes/${fresh.id}`, {
    method: "PUT",
    body: JSON.stringify({ content: finalHtml }),
  });
  return textResult(`Updated note "${updated.title}" [id: ${updated.id}] (mode: ${mode}).`);
}

async function toolSearchNotes(args) {
  const query = args.query;
  if (typeof query !== "string" || !query.trim()) throw new ToolInputError("query is required.");
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 20;
  const result = await apiFetch(
    `/api/v1/search?q=${encodeURIComponent(query)}&notebook_id=${NOTEBOOK_ID}&limit=${limit}`
  );
  if (!result.notes.length) return textResult(`No matches for "${query}" in the scoped notebook.`);
  const lines = result.notes.map((n) => `- ${n.title || "(untitled)"}  [id: ${n.id}]\n  ${n.snippet}`);
  return textResult(lines.join("\n"));
}

async function toolReadBacklog(args) {
  const noteId = await resolveSpecialNoteId("backlog");
  const note = await getNoteScoped(noteId);
  const parsed = parseBacklogHtml(note.content);
  const projectFilter = typeof args.project === "string" && args.project.trim() ? args.project.trim() : null;
  const projects = projectFilter ? parsed.projects.filter((p) => p.name === projectFilter) : parsed.projects;

  if (projectFilter && projects.length === 0) {
    return textResult(`No section for project "${projectFilter}" yet in Bugs & Future Improvements.`);
  }
  if (projects.length === 0) {
    return textResult("Bugs & Future Improvements has no project sections yet.");
  }

  const out = projects.map((p) => {
    return [
      `## ${p.name}`,
      `### Bugs`,
      formatNumberedItems(p.bugs, 1),
      `### Future Improvements`,
      formatNumberedItems(p.improvements, p.bugs.length + 1),
    ].join("\n\n");
  });
  return textResult(out.join("\n\n"));
}

async function toolUpdateBacklog(args) {
  const project = resolveRequiredProject(args.project);
  const addBugs = Array.isArray(args.add_bugs) ? args.add_bugs.map(String) : [];
  const addImprovements = Array.isArray(args.add_improvements) ? args.add_improvements.map(String) : [];
  const checkRefs = Array.isArray(args.check) ? args.check : [];
  const uncheckRefs = Array.isArray(args.uncheck) ? args.uncheck : [];

  const noteId = await resolveSpecialNoteId("backlog");
  const note = await getNoteScoped(noteId); // fresh GET, immediately before the PUT below
  const parsed = parseBacklogHtml(note.content);

  let section = parsed.projects.find((p) => p.name === project);
  const isNewSection = !section;
  if (!section) section = { name: project, bugs: [], improvements: [] };

  const combined = combinedBacklogItems(section);

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
    throw new ToolInputError(
      `update_backlog: no matching item for ${failures.join(", ")}. No changes were made.`
    );
  }

  // All references validated - now mutate in memory and write once.
  for (const { res } of checkResolved) res.entry.it.checked = true;
  for (const { res } of uncheckResolved) res.entry.it.checked = false;
  for (const text of addBugs) section.bugs.push({ text, checked: false });
  for (const text of addImprovements) section.improvements.push({ text, checked: false });
  if (isNewSection) parsed.projects.push(section);

  const newHtml = serializeBacklogHtml(parsed);
  await apiFetch(`/api/v1/notes/${note.id}`, { method: "PUT", body: JSON.stringify({ content: newHtml }) });

  const summary = [];
  if (addBugs.length) summary.push(`added ${addBugs.length} bug(s)`);
  if (addImprovements.length) summary.push(`added ${addImprovements.length} improvement(s)`);
  if (checkResolved.length) summary.push(`checked ${checkResolved.length} item(s)`);
  if (uncheckResolved.length) summary.push(`unchecked ${uncheckResolved.length} item(s)`);
  return textResult(
    `Updated "${project}" in Bugs & Future Improvements: ${summary.length ? summary.join(", ") : "no changes"}.`
  );
}

async function toolReadReports(args) {
  const noteId = await resolveSpecialNoteId("report");
  const note = await getNoteScoped(noteId);
  let entries = parseReportEntries(note.content);
  const projectFilter = typeof args.project === "string" && args.project.trim() ? args.project.trim() : null;
  if (projectFilter) entries = entries.filter((e) => e.project === projectFilter);
  const limit = Number.isInteger(args.limit) && args.limit > 0 ? args.limit : 3;
  entries = entries.slice(0, limit);

  if (!entries.length) {
    return textResult(
      projectFilter
        ? `No Architecture Review entries yet for project "${projectFilter}".`
        : "No Architecture Review entries yet."
    );
  }
  const out = entries.map((e) => `## ${e.heading}\n\n${htmlToMarkdown(e.bodyHtml)}`);
  return textResult(out.join("\n\n---\n\n"));
}

async function toolAddReport(args) {
  const project = resolveRequiredProject(args.project);
  if (typeof args.body_markdown !== "string" || !args.body_markdown.trim()) {
    throw new ToolInputError("body_markdown is required.");
  }
  const date = new Date().toISOString().slice(0, 10);
  const heading = `${date}${REPORT_HEADING_SEP}${project}`;
  let entryHtml = `<h2>${escapeHtml(heading)}</h2>`;
  if (typeof args.subtitle === "string" && args.subtitle.trim()) {
    entryHtml += `<p><em>${escapeHtml(args.subtitle.trim())}</em></p>`;
  }
  entryHtml += markdownToHtml(args.body_markdown);
  entryHtml += "<hr>";

  const noteId = await resolveSpecialNoteId("report");
  const note = await getNoteScoped(noteId); // fresh GET, immediately before the PUT below
  const newHtml = prependReportEntry(note.content, entryHtml);
  await apiFetch(`/api/v1/notes/${note.id}`, { method: "PUT", body: JSON.stringify({ content: newHtml }) });
  return textResult(`Added Architecture Review entry: "${heading}"`);
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

const TOOLS = {
  list_notes: {
    description:
      "List all notes in the scoped notebook (id, title, last-updated). Use this to see what notes exist before reading or writing one. Only notes inside this one hard-scoped notebook are visible - there is no way to list, browse, or move notes into other notebooks.",
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
      "Create or update a note in the scoped notebook, given Markdown content (converted to the app's rich-text HTML). `mode` controls how content_markdown combines with any existing content: 'append' (default) adds after, 'prepend' adds before, 'replace' overwrites. Set create_if_missing:true to create the note (requires title) when no match exists. Every write is a fresh read-modify-write, and the app's note revision history covers mistakes.",
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
      "Read the 'Bugs & Future Improvements' note (per-project bug/improvement checklists). Pass project to see just that project's section, with items numbered and their checked state shown (numbers line up with what update_backlog's check/uncheck expect); omit project to see every project's section. If the requested project has no section yet, says so plainly rather than erroring.",
    inputSchema: {
      type: "object",
      properties: { project: { type: "string", description: "Project name; omit to read every project's section." } },
      additionalProperties: false,
    },
    handler: toolReadBacklog,
  },
  update_backlog: {
    description:
      "Add and/or check off items in the 'Bugs & Future Improvements' note for one project. add_bugs/add_improvements add new unchecked items, creating the project's section and/or the Bugs/Future Improvements subsection if missing. check/uncheck each take an item number (from read_backlog's output) or exact item text, and tick/untick existing items. All references are validated before anything is written - if any check/uncheck reference doesn't match, the whole call fails with no changes made. project defaults to the current project directory's name if omitted, and is required explicitly when that would resolve to the Dev root.",
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
      "Read the most recent entries from the 'Architecture Review' note (Claude's progress reports), newest first. Pass project to filter to that project's entries; limit controls how many entries to return (default 3).",
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
      "Prepend a new dated entry to the 'Architecture Review' note for a project, written as Markdown (converted to rich HTML). Optional subtitle renders as an italic one-line summary under the heading. project defaults to the current working directory's folder name if omitted, and is required explicitly when that would resolve to the Dev root. Returns the exact heading written.",
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
const SERVER_INFO = { name: "notebook-mcp", version: "0.1.0" };

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

function handleInitialize(params) {
  const requested = params && params.protocolVersion;
  const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : "2025-06-18";
  return { protocolVersion, capabilities: { tools: {} }, serverInfo: SERVER_INFO };
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
  try {
    return await tool.handler(args);
  } catch (err) {
    if (err instanceof ToolInputError || err instanceof ApiError) {
      return { content: [{ type: "text", text: err.message }], isError: true };
    }
    log(`internal error in tool "${params.name}":`, err && err.stack ? err.stack : err);
    return { content: [{ type: "text", text: `Internal error: ${err.message || err}` }], isError: true };
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
