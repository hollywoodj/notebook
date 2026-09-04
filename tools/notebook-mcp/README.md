# notebook-mcp

A zero-dependency, single-file-per-concern MCP (Model Context Protocol) server
that lets Claude Code read and write notes in the Notebook app over stdio.

No npm dependencies, no build step, no TypeScript. `server.mjs` hand-rolls the
MCP JSON-RPC-over-stdio protocol using Node's built-in `fetch`; `format.mjs`
hand-rolls the HTML<->Markdown conversion; `notes.mjs` hand-rolls the Dev
Log / per-project note structural parsing; `sqlite.mjs` hand-rolls the offline
SQLite path using Node's **built-in** `node:sqlite`. Node 24+ required.

## Why it's scoped to one notebook

This server is hard-scoped to a single notebook (the "Dev" notebook by
default). Every read and write verifies the target note's `notebook_id`
matches the scoped notebook and refuses otherwise. There is **no tool that
lists other notebooks, moves notes between notebooks, or permanently
deletes notes** - the blast radius of anything Claude does through this
server is "notes inside one notebook," never anything else in your Notebook
data. Deletes (`disable_project`) are always soft deletes (trash), never
permanent.

Every write goes through the app's normal update path (online) or writes a
`note_revisions` row itself (offline) - so it's captured in that note's
**revision history** in the app either way. If the server (or Claude) writes
something wrong, restore the previous revision from the Notes > History
panel, same as undoing any other edit.

## Online / offline transport

Each tool call resolves its own transport, so **the server keeps working
while the Notebook app is closed**:

1. `GET /health` against `NOTEBOOK_API` with an 800ms timeout.
2. Success -> **HTTP mode** (the normal REST API path). The `database` path
   from the health response is cached into `config.local.json` as `dbPath`,
   for step 4 below.
3. Failure -> **SQLite mode**: talks directly to the database file via
   Node's built-in `node:sqlite` (`DatabaseSync`) - no dependency added.
4. The database file is resolved in this order: `NOTEBOOK_DB` env var ->
   `dbPath` cached in `config.local.json` -> `%APPDATA%\notebook-desktop\notebook.db`
   -> `%APPDATA%\notebook\notebook.db`. If none of those exist, the tool
   returns `isError` naming every path it tried.
5. `NOTEBOOK_MCP_FORCE_SQLITE=1` forces SQLite mode regardless of whether the
   API is reachable (used for testing the offline path without stopping the
   app).

The server **never** writes via SQLite when the health check just succeeded
- that check is what guarantees it isn't writing concurrently with the
running API. On the SQLite path it opens the database with
`PRAGMA busy_timeout = 5000` (nothing else - the Rust side owns every other
pragma, including `journal_mode`), mirrors the exact logic
`crates/notebook-core/src/service.rs`'s `create_note` / `update_note` /
`save_revision` and `crates/notebook-core/src/content/plain.rs`'s
`strip_html` use (see `sqlite.mjs`), wraps multi-statement writes in a
transaction, and closes the handle at the end of the call. Full-text search
needs **no manual FTS maintenance** on either transport - the
`notes_ai`/`notes_ad`/`notes_au` triggers in
`crates/notebook-core/migrations/001_initial.sql` keep `notes_fts` in sync
for every writer, SQL client included.

Every tool result written offline ends with a short note, e.g.
`(offline - wrote directly to the database; open Notebook to see it)`.
Nothing extra is added in HTTP mode.

## Config / environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NOTEBOOK_API` | `http://127.0.0.1:8799` | Base URL of the running `notebook-api`, used for the health check and HTTP mode. |
| `NOTEBOOK_MCP_NOTEBOOK_ID` | `3634580e-8510-409a-9f1d-efba851586da` (the "Dev" notebook) | The one notebook this server is allowed to touch. |
| `NOTEBOOK_DB` | (unset) | SQLite database file path, checked first in offline DB-path resolution. |
| `NOTEBOOK_MCP_FORCE_SQLITE` | (unset) | Set to `1` to force offline (SQLite) mode even when the API is reachable. |

`config.local.json` (next to `server.mjs`, gitignored - machine-specific)
caches resolved ids and the last-known database path:

```json
{
  "dbPath": "C:\\Users\\James\\AppData\\Roaming\\notebook-desktop\\notebook.db",
  "devLogNoteId": "6b0910c3-...",
  "projectNotes": { "Headquarters": "f3003ec4-..." }
}
```

Resolution is lazy and idempotent, and **id-cached with exact-title lookup
as fallback** - so renaming a note in the app doesn't orphan the cache
(it just falls back to a title search and re-caches), and nothing is ever
duplicated. Reads never create Dev Log just to find nothing in it; writes
create it (with seed content) on first use.

## Registering the server

User scope (available in every project):

```
claude mcp add --scope user notebook -- node "C:\Users\James\Dev\Apps\notebook\tools\notebook-mcp\server.mjs"
```

**Restart Claude Code** after registering (or after any server.mjs change)
for it to pick up the server / reload the tool list.

## The note model: Dev Log + one opt-in note per project

This notebook holds exactly two kinds of note: the **`Dev Log`** catch-all,
and one note per **enabled** project, titled with just the project's name
(e.g. `Headquarters`, `BBC`). A project's note holds *everything* for that
project - bugs, future improvements, and architecture reviews - there's no
separate reviews note.

**Routing**, applied by every backlog/report tool: if a note titled exactly
`<project>` exists in the scoped notebook, that note is the target;
otherwise the project's section inside `Dev Log` is (created on demand, and
`Dev Log` itself is created on first write).

Both shapes use the exact same three sections - Bugs, Future Improvements,
Architecture Reviews - just at different heading levels, since a
per-project note is literally its Dev Log section promoted one heading
level. `notes.mjs` has one parser/serializer pair taking a level `offset`
(`0` for a project's own note, `1` for a block inside Dev Log) rather than
two separate implementations.

A project's own note (`Headquarters`, offset 0):

```html
<h2>Bugs</h2>
<ul data-type="taskList">...</ul>
<h2>Future Improvements</h2>
<ul data-type="taskList">...</ul>
<h2>Architecture Reviews</h2>
<h3>2026-09-04</h3>
<p><em>optional one-line scope subtitle</em></p>
... body ...
<hr>
<h3>2026-08-28</h3>
...
```

`Dev Log` (offset 1 - same shape, shifted down one level, wrapped per
project):

```html
<h2>Headquarters</h2>
<h3>Bugs</h3>
<ul data-type="taskList">...</ul>
<h3>Future Improvements</h3>
<ul data-type="taskList">...</ul>
<h3>Architecture Reviews</h3>
<h4>2026-09-04</h4>
...
<h2>BBC</h2>
...
```

Architecture Reviews entries are always **newest-first** (each new entry is
unshifted). Sections and subsections are created on demand; a new project
section is appended to the end of Dev Log.

## The 11 tools

1. **`list_notes`** `{}` - lists notes in the scoped notebook (id, title, updated_at). Only ever `Dev Log` plus enabled projects' notes.
2. **`read_note`** `{ note_id?, title? }` - reads a note as Markdown. One of `note_id`/`title` required; title lookups only search the scoped notebook.
3. **`write_note`** `{ note_id?, title?, content_markdown, mode?, create_if_missing? }` - creates or updates a note inside the scoped notebook. `mode` is `"replace" | "append" | "prepend"` (default `"append"`).
4. **`search_notes`** `{ query, limit? }` - full-text search scoped to the notebook; returns title, snippet, id.
5. **`read_backlog`** `{ project? }` - reads a project's Bugs / Future Improvements checklists (routed per above). Omit `project` to read every project known to Dev Log or holding its own note.
6. **`update_backlog`** `{ project, add_bugs?, add_improvements?, check?, uncheck? }` - adds new unchecked items and/or ticks/unticks existing ones (by item number from `read_backlog`, or exact item text). All references are validated before anything is written.
7. **`read_reports`** `{ project?, limit? }` - reads a project's most recent Architecture Reviews entries, newest first (default `limit: 3`). Omit `project` for the most recent entries across every project.
8. **`add_report`** `{ project, body_markdown, subtitle? }` - prepends a new dated Architecture Reviews entry for a project.
9. **`enable_project`** `{ project }` - gives a project its own note: **moves** (never copies) its Dev Log section into a new note titled with the project name, promoting heading levels. No-op if already enabled.
10. **`disable_project`** `{ project }` - inverse: folds the note's content back into Dev Log as a `## project` section (demoting levels), then soft-deletes the now-empty project note. No-op if not currently enabled.
11. **`list_projects`** `{}` - every project known to Dev Log or holding its own note, with its enabled state and item counts.

For `update_backlog` and `add_report`, `project` defaults to the basename of
the server process's working directory; if that resolves to `Dev` (the Dev
root, not a specific project) the call fails and asks for `project`
explicitly. `enable_project`/`disable_project` always require `project`
explicitly (no cwd default).

## Concurrency

Every write is a fresh read-modify-write: GET (or SQLite `SELECT`) the live
note immediately before the write, transform in memory, then write - never
reusing a copy from earlier in the call, so an edit made in the app while a
tool call is in flight isn't clobbered. If something does still go wrong,
use the note's revision history in the app to recover (written on both
transports).

## Failure handling

- **HTTP mode**: if a request to the Notebook API fails after the health
  check already succeeded, or times out (10s), the tool returns
  `isError: true` with the underlying error.
- **SQLite mode**: if no database file can be found at any of the resolution
  candidates, or opening/querying it fails, the tool returns `isError: true`
  naming every path that was tried.
- The server never tries to spawn the app or API itself.

## Development

```
node --test        # unit tests for format.mjs / notes.mjs (no live API or DB needed)
```

`format.mjs` holds the pure HTML<->Markdown conversion; `notes.mjs` holds the
pure level-offset parsing/serialization for the Dev Log / per-project note
structure, plus project-name defaulting; `sqlite.mjs` holds the offline
SQLite transport (DB path resolution, `strip_html` mirror, note CRUD +
revisions + FTS search); `server.mjs` wires all of that to the resolved
transport and the MCP stdio protocol.
