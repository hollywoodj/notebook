# notebook-mcp

A zero-dependency, single-file MCP (Model Context Protocol) server that lets
Claude Code read and write notes in the Notebook app over stdio. It talks to
the Notebook REST API (`notebook-api`), the same API the desktop app and CLI
use.

No npm dependencies, no build step, no TypeScript - `server.mjs` hand-rolls
the MCP JSON-RPC-over-stdio protocol using Node's built-in `fetch`, and
`format.mjs` / `notes.mjs` hand-roll the HTML<->Markdown conversion and the
special notes' structural parsing. Node 24+ required.

## Why it's scoped to one notebook

This server is hard-scoped to a single notebook (the "Dev" notebook by
default). Every read and write verifies the target note's `notebook_id`
matches the scoped notebook and refuses otherwise. There is **no tool that
lists other notebooks, moves notes between notebooks, deletes notes, or
empties trash** - the blast radius of anything Claude does through this
server is "notes inside one notebook," never anything else in your Notebook
data.

Every write goes through the app's normal update path, so it's captured in
that note's **revision history** in the app - if the server (or Claude)
writes something wrong, restore the previous revision from the Notes >
History panel, same as undoing any other edit.

## Config / environment variables

| Variable | Default | Purpose |
|---|---|---|
| `NOTEBOOK_API` | `http://127.0.0.1:8799` | Base URL of the running `notebook-api`. |
| `NOTEBOOK_MCP_NOTEBOOK_ID` | `3634580e-8510-409a-9f1d-efba851586da` (the "Dev" notebook) | The one notebook this server is allowed to touch. |

`config.local.json` (next to `server.mjs`, gitignored - machine-specific) caches the
resolved ids of the two special notes described below, e.g.:

```json
{
  "architectureReviewNoteId": "2021dabb-...",
  "backlogNoteId": "310c1196-..."
}
```

Resolution is lazy and idempotent: the first time a tool needs a special
note, the server checks `config.local.json`; if the id is missing or no
longer resolves inside the scoped notebook, it looks the note up by exact
title within the scoped notebook; if it's still missing, it creates the note
(with seed content) and writes the id back to `config.local.json`. It never
creates a duplicate.

## Registering the server

User scope (available in every project):

```
claude mcp add --scope user notebook -- node "C:\Users\James\Dev\Apps\notebook\tools\notebook-mcp\server.mjs"
```

**Restart Claude Code** after registering (or after any server.mjs change)
for it to pick up the server / reload the tool list.

## The 8 tools

1. **`list_notes`** `{}` - lists notes in the scoped notebook (id, title, updated_at).
2. **`read_note`** `{ note_id?, title? }` - reads a note as Markdown. One of `note_id`/`title` required; title lookups only search the scoped notebook.
3. **`write_note`** `{ note_id?, title?, content_markdown, mode?, create_if_missing? }` - creates or updates a note inside the scoped notebook. `mode` is `"replace" | "append" | "prepend"` (default `"append"`).
4. **`search_notes`** `{ query, limit? }` - full-text search (`GET /api/v1/search`) scoped to the notebook; returns title, snippet, id.
5. **`read_backlog`** `{ project? }` - reads the **Bugs & Future Improvements** note. With `project`, returns just that project's section, numbered for use with `update_backlog`; without, returns every project.
6. **`update_backlog`** `{ project, add_bugs?, add_improvements?, check?, uncheck? }` - adds new unchecked items and/or ticks/unticks existing ones (by item number from `read_backlog`, or exact item text). All references are validated before anything is written - a bad reference fails the whole call with no partial write.
7. **`read_reports`** `{ project?, limit? }` - reads the most recent **Architecture Review** entries, newest first (default `limit: 3`).
8. **`add_report`** `{ project, body_markdown, subtitle? }` - prepends a new dated entry to **Architecture Review**.

For `update_backlog` and `add_report`, `project` defaults to the basename of
the server process's working directory; if that resolves to `Dev` (the Dev
root, not a specific project) the call fails and asks for `project`
explicitly - the server never guesses a project name from anything else.

## The two special notes

Both live in the scoped notebook, are resolved/created lazily (see above),
and use the same TipTap task-list HTML the desktop editor produces, so
checkboxes are real and tickable in the app:

```html
<ul data-type="taskList">
  <li data-type="taskItem" data-checked="false">
    <label><input type="checkbox"><span></span></label>
    <div><p>item text</p></div>
  </li>
</ul>
```

### "Architecture Review"

Claude's progress reports. **Newest entry first** (prepended). Each entry:

```html
<h2>2026-09-04 · Headquarters</h2>
<p><em>optional one-line scope subtitle</em></p>
... body ...
<hr>
```

### "Bugs & Future Improvements"

James's input to Claude, one section per project:

```html
<h2>ProjectName</h2>
<h3>Bugs</h3>
<ul data-type="taskList">...</ul>
<h3>Future Improvements</h3>
<ul data-type="taskList">...</ul>
```

## Concurrency

Every write is a fresh read-modify-write: GET the live note, transform in
memory, PUT `{ content }` - the server always re-fetches immediately before
writing rather than reusing a copy from earlier in the call, so an edit made
in the app while a tool call is in flight isn't clobbered. If something does
still go wrong, use the note's revision history in the app to recover.

## Failure handling

If the Notebook API can't be reached (app / `cargo run -p notebook-api` not
running) or a request to it times out (10s), every tool returns
`isError: true` with a message telling you to start the app / API - the
server never tries to spawn it itself.

## Development

```
node --test        # unit tests for format.mjs / notes.mjs (no live API needed)
```

`format.mjs` holds the pure HTML<->Markdown conversion; `notes.mjs` holds the
pure parsing/serialization for the two special notes and project-name
defaulting; `server.mjs` wires those to the Notebook API and the MCP
stdio protocol.
