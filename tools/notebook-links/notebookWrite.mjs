// Notebook write path for materialization - reuses tools/notebook-mcp's
// transport resolution and offline SQLite write logic verbatim (see
// ../notebook-mcp/noteTransport.mjs), rather than hand-rolling a second
// writer against notebook.db. That module's SQLite path mirrors
// service.rs's update_note/save_revision exactly, so a write through here
// lands in the note's normal revision history exactly like a write from the
// app or from notebook-mcp.
//
// Unlike notebook-mcp, this tool isn't scoped to one notebook: `notebookId`
// is left `null`, which `resolveNoteTransport`/`httpNoteStore` already
// support for exactly this reason (get/update-by-id needs no notebook
// scope).

import process from "node:process";
import { resolveNoteTransport } from "../notebook-mcp/noteTransport.mjs";

const HEALTH_TIMEOUT_MS = 800;
const REQUEST_TIMEOUT_MS = 10_000;

// A function, not a module-level constant - see adapters/notebook.mjs's
// identical `apiBase()` for why: NOTEBOOK_API must be read fresh on every
// call, not frozen the first time this module happens to be imported.
function apiBase() {
  return (process.env.NOTEBOOK_API || "http://127.0.0.1:8799").replace(/\/$/, "");
}

async function withNoteStore(fn) {
  const store = await resolveNoteTransport({
    apiBase: apiBase(),
    notebookId: null,
    envDb: process.env.NOTEBOOK_DB,
    cachedDbPath: null,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
  });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

/** `{ id, content } | null` - null when the note doesn't exist. */
export async function getNoteContent(id) {
  return withNoteStore(async (store) => {
    const note = await store.getNote(id);
    return note ? { id: note.id, content: note.content } : null;
  });
}

/** Writes `contentHtml` as the note's new content, through whichever
 * transport is live - same write path notebook-mcp uses. */
export async function updateNoteContent(id, contentHtml) {
  return withNoteStore((store) => store.updateNote(id, contentHtml));
}
