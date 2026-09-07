# notebook-links

A zero-dependency CLI that links things across apps - today, a Notebook note
and an OmniClone project - and keeps a human-visible pointer to that link
inside each app's own note, not just in a side database.

No npm dependencies, no build step, no TypeScript, same as `tools/notebook-
mcp` next door. `refs.mjs` hand-rolls the `<app>://<kind>/<id>` ref grammar,
`store.mjs` hand-rolls link storage on Node's **built-in** `node:sqlite`,
`adapters/` hand-roll one small transport-resolving client per app,
`managedBlockHtml.mjs`/OmniClone's `src/textBlock.ts` hand-roll the
tool-managed block each app's note gets, and `omnicloneQueue.mjs` hand-rolls
the file-based command queue that's the only way to write into OmniClone
from outside its own renderer. Node 24+ required.

## Why a separate tool from notebook-mcp

`notebook-mcp` is deliberately scoped to one thing: bridging Claude to one
notebook inside Notebook. Linking Notebook to a second, unrelated app is a
different concern with a different shape (it needs to know about *two* apps'
id/URL schemes, not just one), so it gets its own tool rather than growing
notebook-mcp's scope. It does directly reuse notebook-mcp's transport code
(see "Reusing notebook-mcp's write path" below) rather than duplicating it.

## The ref grammar

```
<app>://<kind>/<id>
```

Both apps already emit this shape for their own deep links (`notebook://
note/{id}`, `omniclone://task/{id}`), including a three-slash variant
(`omniclone:///task/{id}`) that OmniClone always uses for its own
`taskUrl()`. `refs.mjs` accepts either slash count on input and always
formats back out with two slashes - so a ref you paste in from either app's
"copy link" feature works, and anything this tool prints or stores is
canonical.

Unknown app or kind is a parse error that names every app/kind the tool
currently knows, never a bare "invalid ref":

```
$ notebook-links resolve foo://bar/1
Error: Unknown app "foo" in ref "foo://bar/1". Known apps: notebook, omniclone.
```

v1 registers exactly two kinds, one per app:

| App | Kind | Example |
|---|---|---|
| `notebook` | `note` | `notebook://note/6b0910c3-...` |
| `omniclone` | `project` | `omniclone://project/p_ab12` |

## Commands

```
notebook-links link add <refA> <refB> [--rel related] [--note TEXT] [--no-materialize] [--wait MS]
notebook-links link rm  <refA> [refB] [--rel R]                     [--no-materialize] [--wait MS]
notebook-links link ls  [ref] [--app APP] [--limit N]
notebook-links resolve  <ref>
notebook-links list <app> <kind> [--query Q] [--limit N]
notebook-links open <ref>
notebook-links sync [ref] [--wait MS]
notebook-links doctor
```

Global flags: `--json` (structured output instead of aligned text), `--db
PATH` (override the link store path for one call), `--help`, `--version`.
Exit codes: `0` success, `1` usage/runtime error, `2` when a ref can't be
resolved (`resolve`/`open` against something that doesn't exist).

### Discovering ids: `list`

You don't hand-copy ids out of either app's UI - `list` finds them:

```
$ notebook-links list notebook note --query "website"
REF                                        TITLE          SUBTITLE
notebook://note/6b0910c3-...               Website Plan   Redesign the...

$ notebook-links list omniclone project
REF                          TITLE              SUBTITLE
omniclone://project/p_ab12   Website Redesign   Work · active
```

### Linking: `link add` / `link rm` / `link ls`

```
$ notebook-links link add notebook://note/6b0910c3-... omniclone://project/p_ab12
Linked notebook://note/6b0910c3-... <-> omniclone://project/p_ab12 (related).
Materialized:
  notebook://note/6b0910c3-...: updated
  omniclone://project/p_ab12: queued (OmniClone is not running; command is queued for its next launch.)
```

`related` is symmetric - `link add A B` and `link add B A` are the exact
same edge (see "The relation registry" below), so order never matters and
running it twice is a no-op ("already linked", not an error).

`link rm <refA> [refB]` removes one edge (`refB` given) or every edge
touching `refA` (`refB` omitted). Either way it also regenerates the visible
block in every note that was touched, so removing a link doesn't leave a
stale pointer behind.

`link ls [ref]` shows edges - either every edge touching `ref`, or (with no
ref) every edge in the store, optionally filtered with `--app`. Both
endpoints are resolved through their adapters so you see real titles, and
any endpoint that no longer resolves is marked `(dangling)` right in the
listing.

### `resolve` / `open`

`resolve <ref>` prints what a ref currently points to (title, subtitle, an
openable url, and whether it exists - see "The `exists` tri-state" below).
`open <ref>` resolves it first (refusing with exit code `2` if it's
definitely gone) and then hands the url to the OS's URL handler - `rundll32
url.dll,FileProtocolHandler` on Windows (deliberately not `cmd /c start`,
which mangles `&` in query strings), `open` on macOS, `xdg-open` on Linux.

### `doctor`

One-shot health check: store path and link count, each adapter's
reachability and transport, the OmniClone snapshot's age, every dangling
link, the OmniClone command queue's depth and any commands stuck too long
unconsumed, any result files nobody's collected, whether OmniClone is
currently running, and any materialization drift (the broker says two
things are linked but one side's note doesn't actually mention the other -
see "Materialization" below).

## The link store

`node:sqlite` (Node's **built-in** module - zero new dependencies, same
choice `notebook-mcp/sqlite.mjs` already made and the precedent this tool
follows; see DECISIONS.md).

Path: `LINKS_DB` env var, else `<appdata>/notebook-links/links.db`
(`%APPDATA%` on Windows, `~/Library/Application Support` on macOS,
`~/.local/share` on Linux - same platform logic as notebook-mcp's db-path
resolution). Parent directories are created on open.

```sql
CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE links (
  id TEXT PRIMARY KEY,
  src_app TEXT NOT NULL, src_kind TEXT NOT NULL, src_id TEXT NOT NULL,
  dst_app TEXT NOT NULL, dst_kind TEXT NOT NULL, dst_id TEXT NOT NULL,
  rel TEXT NOT NULL DEFAULT 'related',
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_links_edge ON links(src_app,src_kind,src_id,dst_app,dst_kind,dst_id,rel);
CREATE INDEX idx_links_src ON links(src_app,src_kind,src_id);
CREATE INDEX idx_links_dst ON links(dst_app,dst_kind,dst_id);
```

`schema_meta.schema_version` is written on open and a migration hook exists
even though v1 has nothing to migrate from - see "How to add a new relation"
below for what a v2 migration would actually do.

### The relation registry

```js
export const RELATIONS = { related: { symmetric: true } };
```

For a symmetric relation, `add`/`remove` sort the two endpoints by their
canonical ref string before touching the table, so `add A B` and `add B A`
always land in (or remove) the exact same row - the unique index above is a
second line of defense, not the mechanism itself. Every read (`list`)
returns edges as a union of both the `src_*` and `dst_*` columns, normalized
to `{ other, rel, note, createdAt, direction }` - callers never need to know
or care which column a given edge happened to land in.

### The `exists` tri-state

An adapter's `resolve()` returns `exists: true | false | null` - `null`
means *unknown*, not *false*. This only ever happens for OmniClone, when
there's no snapshot to check against yet (see "The OmniClone adapter"
below): the thing might well exist, this tool just can't currently tell.
Treating that the same as "confirmed gone" would make `doctor` flag every
link as dangling the first time OmniClone hasn't been opened since a link
was added, which is wrong - so `resolve`/`link ls`/`doctor` all keep the
three states distinct.

## The two adapters

Every adapter implements the same shape (documented with JSDoc typedefs in
`adapters/index.mjs`):

```js
{ app, kinds: [],
  async resolve(ref)                 // -> { ref, title, subtitle, url, exists } | null
  async list(kind, { query, limit }) // -> Entity[]
  async open(ref)                    // -> void
  async health() }                   // -> { ok, transport, detail }
```

### The notebook adapter (`adapters/notebook.mjs`)

Transport-resolving, the same pattern `notebook-mcp` uses: `GET
{NOTEBOOK_API}/health` (short timeout) - reachable means REST (`GET /api/v1/
notes/:id`, `/api/v1/notes`, `/api/v1/search`); unreachable means a **read-
only** `node:sqlite` connection, found the same way notebook-mcp finds its
database (`candidateDbPaths`/`resolveDbPath`, imported straight from
`../notebook-mcp/sqlite.mjs` rather than re-derived - that module has no
import-time side effects, so importing it directly was safe). `NOTEBOOK_API`
defaults to `http://127.0.0.1:8799`; `NOTEBOOK_DB` overrides the SQLite path
search.

Reads here are deliberately **not** scoped to notebook-mcp's one "Dev"
notebook - this tool can resolve/list/link any note in any notebook.

### The OmniClone adapter (`adapters/omniclone.mjs`)

OmniClone's real data lives in OPFS (a wa-sqlite VFS pool file under
Electron's per-app storage), which nothing outside its own renderer -
including this tool - can read or write. So this adapter reads a **snapshot
file** OmniClone's Electron main process writes on every library change
(`Apps/OmniClone/src/bridgeSnapshot.ts` + `hooks/usePersistedLibrary.ts`):

Path: `LINKS_OMNICLONE_SNAPSHOT` env var, else `<appdata>/OmniClone/bridge/
snapshot.json`.

```json
{
  "schema": 2,
  "app": "omniclone",
  "exportedAt": "2026-09-04T12:00:00.000Z",
  "projects": [
    { "id": "p_ab12", "name": "Website Redesign", "folder": "Work", "status": "active", "note": "..." }
  ],
  "counts": { "projects": 1, "tasks": 12 }
}
```

Schema 1 exported `projects` without `note`; schema 2 added it so `doctor`
can tell whether a project's note actually mentions a linked notebook note
(materialization drift) - `note` is also where the materialized block itself
lives. Tasks are still never exported, only counted; a schema 3 adding them
is the same kind of additive step.

A missing or unparseable snapshot is a **normal state**, not a crash -
`resolve` reports `exists: null` (see above) and `health` reports `{ ok:
false, detail: "snapshot not found — open OmniClone once to generate it" }`.
`doctor` surfaces the snapshot's `exportedAt` as an age, so a stale snapshot
(OmniClone hasn't been opened in a while) is visible at a glance.

## Materialization: making a link visible in both apps, not just the broker

The broker table above is the source of truth, but a link is much more
useful if it shows up as something clickable inside the note/project it's
attached to - so every `link add`/`link rm` (unless `--no-materialize`) also
regenerates a small **tool-managed block** inside each endpoint's own note,
and `sync [ref]` re-runs that regeneration on demand (e.g. to repair drift
`doctor` found).

**The block is wholly owned by this tool.** It's regenerated from the broker
every time, never hand-merged, and never touches a single byte outside its
own span: absent -> appended at the end; present -> replaced in place;
empty after a removal -> the whole block (including its sentinel lines) is
deleted, not left behind empty.

### Marker format: why a literal text sentinel, on both sides

Both sides use the same two sentinel lines:

```
--- notebook-links:begin (do not edit below this line - regenerated by notebook-links) ---
...one line/paragraph per linked entity...
--- notebook-links:end ---
```

OmniClone's project `note` field is plain text, so a literal sentinel is the
obvious choice there - no survivability question to investigate.

Notebook's note content is TipTap/ProseMirror HTML, where that question very
much applies, since the desktop editor (`apps/desktop/src/components/
NoteEditor.tsx`) re-parses a note's stored HTML into its schema and
re-serializes on every save - anything the schema doesn't represent silently
disappears on the next edit made **in the app**, even though writes made
directly via this tool's own REST/SQLite transport are unaffected. Two
alternatives were ruled out before landing on the same literal sentinel:

- **An HTML comment** (`<!-- ... -->`) - ProseMirror's `DOMParser` only
  handles element and text DOM nodes; Comment nodes are unconditionally
  skipped, and nothing in NoteEditor.tsx's extension list (StarterKit +
  Underline/Link/Highlight/TaskList/Image/Table*/TextAlign/TextStyle/Color/
  FontFamily/FontSize/Superscript/Subscript/Callout/CodeCopyButton) adds
  comment support. It would vanish the first time the note is opened and
  re-saved in the app.
- **A wrapper element with a data attribute** (e.g. `<div data-notebook-
  links>`) - none of those extensions define a generic passthrough node.
  ProseMirror's default for an unmatched element is to drop the element (and
  its attributes) but keep parsing its children in place, so the *content*
  would survive an editor round-trip but the attribute this tool would need
  to relocate the block by would not.

A plain `<p>` is exactly what StarterKit's Paragraph node maps to, and
ordinary paragraph text round-trips losslessly through this schema - the
only one of the three shapes that provably survives. See
`managedBlockHtml.mjs`'s header comment for the same reasoning inline with
the code, and `Apps/OmniClone/src/textBlock.ts`'s for the OmniClone side.

### Byte-identical repeat syncs

A no-op `sync` (nothing in the broker changed since the block was last
written) must write nothing - notebook writes a **revision** on every real
update, so a spurious no-op write would pollute a note's history for no
reason. The notebook side reads the note's current content, computes what
the block would be, and compares before deciding whether to write at all
(exactly the same "compare before writing" shape as `tools/notebook-mcp`'s
`overview.mjs` regenerating its Reference zone - see that module's tests for
the same property proven the same way). This is verified by
`test/materialize.test.mjs`, which runs the same sync twice and asserts the
note's `content` and its `note_revisions` row count are both unchanged the
second time.

**This guarantee is asymmetric between the two apps, and that's inherent,
not an oversight.** The notebook side can read the live note directly, so it
can truly skip the write. The OmniClone side cannot be read directly at all
(see "The OmniClone adapter" above) - a write there is always a *command*
enqueued for OmniClone's renderer to apply, and this tool has no way to
check the current note against a fresh copy before enqueueing one. The
*persisted* result is still never mutated by a no-op sync (the renderer
itself compares before touching state - see
`Apps/OmniClone/src/bridgeCommands.ts`), but a transient queue file is
created and consumed either way. `doctor`'s queue-depth reporting exists
partly to make this asymmetry visible rather than silent.

## The OmniClone command queue

OmniClone's OPFS-backed store can only ever be written by its own renderer,
so a write from outside it - from this tool - can't be a direct database
write at all. It's a small durable file queue under `<userData>/bridge/`
(same root the snapshot lives under):

```
bridge/
  snapshot.json     - written by OmniClone (see the adapter section above)
  inbox/<id>.json   - a command this tool wants applied
  results/<id>.json - the outcome, written by OmniClone once applied
  runtime.json      - { pid, startedAt, heartbeat }, written by OmniClone while running
```

**A loopback HTTP server inside OmniClone was considered and rejected**: it
would only answer while OmniClone happens to be running, which is exactly
the "app is closed" case a file queue already has to handle for free - see
DECISIONS.md.

**Writes to OmniClone are queued, not immediate.** If OmniClone is open
right now, `--wait` (default `3000`ms) makes this indistinguishable from a
normal synchronous write - the CLI polls for the result file and reports
`applied`/`failed`. If OmniClone is closed, or doesn't answer in time, the
outcome is reported as `queued`, in those words, never phrased as if the
write already happened. It's applied the next time OmniClone launches (or,
if already running, the next time its inbox-directory watcher fires).

Envelope shape (`schema` versioned so a second command type is additive):

```json
{ "schema": 1, "id": "<sortable-id>", "issuedAt": "2026-09-04T12:00:00.000Z",
  "command": "setProjectLinkBlock", "params": { "projectId": "p_ab12", "block": "notebook note: Website Plan - notebook://note/n1" } }
```

`id` is a millisecond timestamp (base36) plus a short random suffix, so
envelopes sort by issue order on disk with no separate index. v1 has exactly
one command, `setProjectLinkBlock` - it replaces (or, with `block: null`,
removes) the tool-managed block in one project's `note` field, via the exact
same upsert semantics as the notebook side (`Apps/OmniClone/src/
textBlock.ts` mirrors `managedBlockHtml.mjs`'s contract, plain text instead
of HTML).

**At-most-once application.** OmniClone's Electron main process
(`Apps/OmniClone/electron/bridgeQueue.cjs`) records every applied command id
and skips re-applying one that's already been consumed, even if its inbox
file reappears (a crash before cleanup, a manual copy, whatever) - it just
deletes the file and, if nobody's collected the original result yet, writes
one saying so. Commands are also applied strictly one at a time, in id
order, so two commands touching the same project can never race.

**Draining order.** On launch, OmniClone's main process starts watching the
inbox directory immediately, but only starts *forwarding* anything to the
renderer once the renderer signals it has finished hydrating from its own
storage - the same ack shape `onFlushRequest`/`flush-complete` already uses
for save-on-quit (see `Apps/OmniClone/src/hooks/useBridgeCommandQueue.ts`
and `electron/main.cjs`'s `bridge-hydrated` handler). That avoids a command
racing the renderer's own initial load and getting applied against a still-
empty project list.

## Reusing notebook-mcp's write path

Materializing the notebook side means updating an existing note's content,
which has to go through the exact write path `notebook-mcp` already uses
(REST when the app's running, direct `node:sqlite` - matching `service.rs`'s
`update_note`/`save_revision` and `content/plain.rs`'s `strip_html` exactly
- when it isn't), never a hand-rolled second writer that could drift from
notebook-core's FTS/revision invariants. `tools/notebook-mcp/
noteTransport.mjs` is the extracted, shared version of that logic (`server.
mjs` now imports it too, instead of keeping its own copy) - `notebookWrite.
mjs` in this tool is a thin wrapper calling it with `notebookId: null`
(get/update-by-id needs no notebook scope, unlike `notebook-mcp`'s scoped
list/search/create).

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `LINKS_DB` | `<appdata>/notebook-links/links.db` | The link store's database file. |
| `NOTEBOOK_API` | `http://127.0.0.1:8799` | Base URL for the notebook adapter's health check / REST reads+writes. |
| `NOTEBOOK_DB` | (unset) | SQLite path, checked first in the notebook adapter's offline resolution. |
| `LINKS_OMNICLONE_SNAPSHOT` | `<appdata>/OmniClone/bridge/snapshot.json` | Where the OmniClone adapter reads its snapshot. |
| `LINKS_OMNICLONE_BRIDGE_DIR` | `<appdata>/OmniClone/bridge` | Root of the OmniClone command queue (`inbox/`, `results/`, `runtime.json`). |

## Development

```
npm test    # node --test - unit tests, no live Notebook/OmniClone needed
```

Tests use only `os.tmpdir()` subdirectories and env-var overrides - nothing
under a real app's appdata is ever read or written by the test suite.
`test/helpers.mjs` builds a throwaway notebook.db (the subset of
`crates/notebook-core/migrations/001_initial.sql` this tool's queries touch)
and a temp-dir helper shared across test files.

## How to extend this tool

This is the point of building it this way - a third app, a new kind, or an
asymmetric relation should each be a small, additive change, never a
rework.

### Add a new kind to an app that's already registered

One line in `refs.mjs`'s `REGISTRY` (e.g. add `"tag"` to `notebook`'s kind
set), then teach the existing adapter to handle it - add the kind to its
`kinds` array and branch on it in `resolve`/`list`/`open`. The store,
`refs.mjs`'s parser, and the CLI need no changes at all; they're already
generic over kind.

### Add a third app

1. **`refs.mjs`**: add one entry to `REGISTRY`, e.g. `headquarters: new
   Set(["ticket"])`.
2. **A new adapter** (`adapters/headquarters.mjs`) implementing the same
   four methods documented in `adapters/index.mjs`. Pick whichever transport
   makes sense for that app - REST, a database file, a snapshot file (like
   OmniClone's, if the app's data is similarly unreachable), whatever fits;
   nothing else in this tool cares which one you pick as long as `resolve`/
   `list`/`open`/`health` return the documented shapes.
3. **Register it** in `adapters/index.mjs`'s `ADAPTERS` map.
4. If you want links to that app to also show up as a visible block in its
   own notes/records (materialization), add a branch to `materialize.mjs`'s
   `materializeRef` for that app/kind, plus whatever write path that app
   needs (direct, like notebook's, or queued, like OmniClone's, depending on
   whether its data is reachable from outside its own process). This step is
   optional - an app can participate in linking/resolving/listing without
   ever being materialized into.

Nothing about the store, the ref parser, or the CLI's command surface
changes for any of this - they only ever see refs and adapters, never a
hardcoded app name (aside from the registry entries themselves).

### Add an asymmetric relation

Add an entry to `store.mjs`'s `RELATIONS` registry, e.g.:

```js
export const RELATIONS = {
  related: { symmetric: true },
  blocks: { symmetric: false },
};
```

`addLink`/`removeLink`/`listLinks` already branch on `.symmetric` rather
than assuming every relation sorts its endpoints - for `blocks`, `add A B`
would store `A` as `src` and `B` as `dst` exactly as given (meaning "A
blocks B"), and `listLinks`' `direction: "outgoing" | "incoming"` on each
result is precisely what a caller needs to tell "the things I block" from
"the things blocking me" once a relation actually carries that meaning.
`schema_meta`'s migration hook (`store.mjs`'s `MIGRATIONS` array) is where a
schema change this needs (there currently isn't one - the `links` table
already has a `rel` column) would go; append a new `{ version, up(db) {...}
}` entry rather than editing the v1 one in place.
