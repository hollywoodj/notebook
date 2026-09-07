// Materializes broker links into each endpoint's own note, so a link is
// visible in both apps, not just in the broker DB. The broker (store.mjs)
// stays the source of truth; this module only ever regenerates a
// tool-managed block from it - see managedBlockHtml.mjs / OmniClone's
// src/textBlock.ts for the two per-app block formats, and the header
// comment on managedBlockHtml.mjs for why they differ (HTML sentinel
// paragraphs vs. a plain-text sentinel pair).
//
// notebook side writes directly (notebookWrite.mjs, which reuses
// notebook-mcp's transport) and can therefore truly no-op a repeat sync: it
// reads the current content, compares, and skips the write entirely when
// nothing changed. OmniClone side can only be written by enqueueing a
// command for its renderer to apply (omnicloneQueue.mjs) - the *persisted*
// note is still never mutated on a no-op sync (the renderer itself compares
// before touching state), but a transient queue file is created and
// consumed either way, since this tool has no read access to OmniClone's
// live note text to pre-check against (only the last snapshot, which may be
// stale). This asymmetry is inherent to OPFS being unreachable from outside
// the renderer, not an oversight - see README.md's materialization section.

import { formatRef, parseRef } from "./refs.mjs";
import { getAdapter } from "./adapters/index.mjs";
import { getNoteContent, updateNoteContent } from "./notebookWrite.mjs";
import { upsertManagedBlock as upsertHtmlBlock, renderEntryParagraph } from "./managedBlockHtml.mjs";
import { sendCommandAndWait } from "./omnicloneQueue.mjs";

function describeRef(ref) {
  return `${ref.app} ${ref.kind}`;
}

async function partsForRef(store, ref) {
  // store.list expects a raw ref string (it parses internally) - pass the
  // formatted string, not the already-parsed object.
  const edges = store.list(formatRef(ref));
  const parts = [];
  for (const edge of edges) {
    const otherRef = parseRef(edge.other);
    let entity = null;
    try {
      entity = await getAdapter(otherRef.app).resolve(otherRef);
    } catch {
      entity = null;
    }
    parts.push({
      otherRef,
      url: entity?.url ?? formatRef(otherRef),
      title: entity?.title ?? null,
    });
  }
  return parts;
}

function partLabel(part) {
  return part.title
    ? `${describeRef(part.otherRef)}: ${part.title}`
    : `${describeRef(part.otherRef)} (${part.otherRef.id})`;
}

async function materializeNotebookNote(ref, parts) {
  const note = await getNoteContent(ref.id);
  if (!note) return { changed: false, skipped: true, reason: `Note ${ref.id} not found; cannot materialize.` };
  const innerHtml = parts.length ? parts.map((p) => renderEntryParagraph(p.url, partLabel(p))).join("") : null;
  const nextContent = upsertHtmlBlock(note.content, innerHtml);
  if (nextContent === note.content) return { changed: false };
  await updateNoteContent(ref.id, nextContent);
  return { changed: true };
}

async function materializeOmnicloneProject(ref, parts, { waitMs } = {}) {
  const block = parts.length ? parts.map((p) => `${partLabel(p)} - ${p.url}`).join("\n") : null;
  const outcome = await sendCommandAndWait(
    "setProjectLinkBlock",
    { projectId: ref.id, block },
    waitMs != null ? { waitMs } : {}
  );
  return { changed: outcome.status !== "failed", queue: outcome };
}

/**
 * Regenerates the managed block for one ref from the broker's current
 * links. Returns `{ changed, skipped?, reason?, queue? }` - `queue` is
 * present (and worth surfacing to the user) only for the OmniClone side.
 */
export async function materializeRef(store, refRaw, { waitMs } = {}) {
  const ref = parseRef(refRaw);
  const parts = await partsForRef(store, ref);
  if (ref.app === "notebook" && ref.kind === "note") {
    return materializeNotebookNote(ref, parts);
  }
  if (ref.app === "omniclone" && ref.kind === "project") {
    return materializeOmnicloneProject(ref, parts, { waitMs });
  }
  return { changed: false, skipped: true, reason: `Materialization not implemented for ${describeRef(ref)}.` };
}

/** Materializes both endpoints of a link. Failures on one side are reported,
 * never thrown - a materialization problem should never make `link add`/
 * `link rm` look like they failed to update the broker, which is the part
 * that actually matters as the source of truth. */
export async function materializeEdge(store, refARaw, refBRaw, opts = {}) {
  const [a, b] = await Promise.allSettled([
    materializeRef(store, refARaw, opts),
    materializeRef(store, refBRaw, opts),
  ]);
  const toOutcome = (settled, ref) =>
    settled.status === "fulfilled" ? { ref, ...settled.value } : { ref, changed: false, error: settled.reason?.message ?? String(settled.reason) };
  return [toOutcome(a, formatRef(parseRef(refARaw))), toOutcome(b, formatRef(parseRef(refBRaw)))];
}
