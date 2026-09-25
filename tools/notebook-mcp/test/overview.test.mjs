import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown } from "../format.mjs";
import {
  OVERVIEW_NOTE_TITLE,
  LEGACY_OVERVIEW_NOTE_TITLE,
  isDevProject,
  isProjectNoteTitle,
  projectNoteTitle,
  projectNameFromTitle,
  flattenRelativeLinks,
  dropLeadingTitle,
  demoteHeadings,
  mirrorFileMarkdown,
  buildIdeasZoneHtml,
  buildReferenceZoneHtml,
  parseOverviewZones,
  parseIdeasItems,
  extractFileSectionHtml,
  extractIndexTableHtml,
  resolveSectionName,
} from "../overview.mjs";
import { applyIdeaEdits } from "../notes.mjs";

function noEdits(overrides = {}) {
  return { addBugs: [], addImprovements: [], checkRefs: [], uncheckRefs: [], removeRefs: [], ...overrides };
}

function fakeStat(name, content) {
  return { name, exists: true, mtimeMs: 1_725_000_000_000, size: content.length, content };
}

// ---------------------------------------------------------------------------
// Relative-link flattening (absolute http(s) links preserved)
// ---------------------------------------------------------------------------

test("flattenRelativeLinks turns relative markdown links into plain label text, leaves absolute http(s) links as real links", () => {
  const md =
    "See [PORTS.md](PORTS.md) and [Title](file.md) and [nested](./sub/file.md) " +
    "but [Anthropic](https://anthropic.com) and [secure](HTTPS://example.com/x) stay real.";
  const out = flattenRelativeLinks(md);
  assert.match(out, /See PORTS\.md and Title and nested but/);
  assert.match(out, /\[Anthropic\]\(https:\/\/anthropic\.com\)/);
  assert.match(out, /\[secure\]\(HTTPS:\/\/example\.com\/x\)/);
  assert.doesNotMatch(out, /\[PORTS\.md\]/);
  assert.doesNotMatch(out, /\[Title\]/);
});

// ---------------------------------------------------------------------------
// Dropping a leading `# Title`
// ---------------------------------------------------------------------------

test("dropLeadingTitle removes only the file's very first heading line", () => {
  const md = "# NOW\n\nSome intro text.\n\n## Active focus\n\n- item";
  const out = dropLeadingTitle(md);
  assert.doesNotMatch(out, /^# NOW/);
  assert.match(out, /Some intro text\./);
  assert.match(out, /## Active focus/); // untouched - not the leading heading
});

test("dropLeadingTitle leaves a file with no leading heading untouched", () => {
  const md = "Just text.\n\n## Section";
  assert.equal(dropLeadingTitle(md), md);
});

test("dropLeadingTitle does not touch a later top-level heading", () => {
  const md = "# First\n\nbody\n\n# Second (not the leading title)";
  const out = dropLeadingTitle(md);
  assert.doesNotMatch(out, /^# First/);
  assert.match(out, /# Second \(not the leading title\)/);
});

// ---------------------------------------------------------------------------
// Heading demotion: # -> h4, ## -> h5, ### -> h6, deeper stays h6
// ---------------------------------------------------------------------------

test("demoteHeadings shifts every level by +3, capped at h6", () => {
  const md = "# one\n## two\n### three\n#### four\n##### five\n###### six";
  const out = demoteHeadings(md);
  assert.equal(
    out,
    "#### one\n##### two\n###### three\n###### four\n###### five\n###### six"
  );
});

test("demoteHeadings does not touch '#' characters inside a fenced code block", () => {
  const md = "## Real heading\n\n```\n# not a heading\n```\n\n### Another real heading";
  const out = demoteHeadings(md);
  assert.match(out, /^##### Real heading/m);
  assert.match(out, /^# not a heading/m); // inside the fence, untouched
  assert.match(out, /^###### Another real heading/m);
});

test("mirrorFileMarkdown pipeline: drops the leading title, demotes remaining headings, flattens relative links", () => {
  const md = "# STACK\n\nSee [PORTS.md](PORTS.md).\n\n## Conventions\n\n- a point";
  const out = mirrorFileMarkdown(md);
  assert.doesNotMatch(out, /^#### STACK/m); // leading title dropped entirely, not just demoted
  assert.doesNotMatch(out, /# STACK/);
  assert.match(out, /See PORTS\.md\./);
  assert.match(out, /^##### Conventions/m); // ## -> h5 (5 hashes)
});

// ---------------------------------------------------------------------------
// Ideas / Reference zone splitting and byte-identical regeneration
// ---------------------------------------------------------------------------

test("parseOverviewZones splits Ideas from Reference at the top-level <h2> boundaries", () => {
  const ideas = buildIdeasZoneHtml([{ text: "settle the thing", checked: false }]);
  const reference = buildReferenceZoneHtml([fakeStat("NOW.md", "# NOW\n\nbody")], "2026-09-04T00:00:00.000Z");
  const full = ideas + reference;

  const zones = parseOverviewZones(full);
  assert.equal(zones.ideasZoneHtml, ideas);
  assert.equal(zones.referenceZoneHtml, reference);
  assert.equal(zones.hasReference, true);
  assert.deepEqual(parseIdeasItems(zones.ideasZoneHtml), [{ text: "settle the thing", checked: false }]);
});

test("regenerating the Reference zone leaves the Ideas zone BYTE-IDENTICAL", () => {
  const originalIdeas = buildIdeasZoneHtml([
    { text: "idea one", checked: false },
    { text: "idea two", checked: true },
  ]);
  const oldReference = buildReferenceZoneHtml([fakeStat("NOW.md", "# NOW\n\nold body")], "2026-09-01T00:00:00.000Z");
  const noteBefore = originalIdeas + oldReference;

  // "sync": reparse zones, keep ideasZoneHtml verbatim, rebuild only Reference
  // with different (newer) source content - mirrors ensureOverviewSynced.
  const zones = parseOverviewZones(noteBefore);
  const newReference = buildReferenceZoneHtml(
    [fakeStat("NOW.md", "# NOW\n\ncompletely different body now"), fakeStat("GOALS.md", "# GOALS\n\nnew file appeared")],
    "2026-09-04T12:00:00.000Z"
  );
  const noteAfter = zones.ideasZoneHtml + newReference;

  const zonesAfter = parseOverviewZones(noteAfter);
  assert.equal(zonesAfter.ideasZoneHtml, originalIdeas, "Ideas zone HTML must be byte-identical after regeneration");
  assert.notEqual(zonesAfter.referenceZoneHtml, oldReference, "Reference zone must actually have changed");
  assert.match(zonesAfter.referenceZoneHtml, /completely different body now/);
  assert.match(zonesAfter.referenceZoneHtml, /new file appeared/);
});

test("a missing source file is listed as missing in the index table, with no <h3> section, never an error", () => {
  const stats = [fakeStat("NOW.md", "# NOW\n\nbody"), { name: "GOALS.md", exists: false, mtimeMs: null, size: null, content: "" }];
  const reference = buildReferenceZoneHtml(stats, "2026-09-04T00:00:00.000Z");
  assert.match(reference, /<td><p>GOALS\.md<\/p><\/td><td><p>[^<]*<\/p><\/td><td><p>missing<\/p><\/td>/);
  assert.doesNotMatch(reference, /<h3>GOALS\.md<\/h3>/);
  assert.match(reference, /<h3>NOW\.md<\/h3>/);
});

// ---------------------------------------------------------------------------
// Extracting a stored section / the index table back out (what read_overview uses)
// ---------------------------------------------------------------------------

test("extractFileSectionHtml pulls one file's mirrored body out of the Reference zone, htmlToMarkdown-able", () => {
  const stats = [fakeStat("STACK.md", "# STACK\n\n## Conventions\n\n- pick a port")];
  const reference = buildReferenceZoneHtml(stats, "2026-09-04T00:00:00.000Z");
  const section = extractFileSectionHtml(reference, "STACK.md");
  assert.ok(section);
  assert.doesNotMatch(section, /<h3>/); // heading itself excluded
  const md = htmlToMarkdown(section);
  assert.match(md, /^##### Conventions/m);
  assert.match(md, /pick a port/);
  assert.equal(extractFileSectionHtml(reference, "NOPE.md"), null);
});

test("extractIndexTableHtml finds the generated index table and it converts to a real markdown table", () => {
  const stats = [fakeStat("NOW.md", "# NOW\n\nbody"), fakeStat("PORTS.md", "# PORTS\n\nbody")];
  const reference = buildReferenceZoneHtml(stats, "2026-09-04T00:00:00.000Z");
  const tableHtml = extractIndexTableHtml(reference);
  assert.match(tableHtml, /^<table>/);
  const md = htmlToMarkdown(tableHtml);
  assert.match(md, /\| File \| What it's for \| Last modified \|/);
  assert.match(md, /NOW\.md/);
  assert.match(md, /PORTS\.md/);
});

test("resolveSectionName is case-insensitive and tolerates a missing .md suffix", () => {
  assert.equal(resolveSectionName("STACK.md"), "STACK.md");
  assert.equal(resolveSectionName("stack"), "STACK.md");
  assert.equal(resolveSectionName("StAcK.MD"), "STACK.md");
  assert.equal(resolveSectionName("nonexistent"), null);
});

// ---------------------------------------------------------------------------
// Dev routing: project: "Dev" targets the Ideas zone
// ---------------------------------------------------------------------------

test("isDevProject matches \"Dev\" case-insensitively, with whitespace tolerated, and nothing else", () => {
  assert.equal(isDevProject("Dev"), true);
  assert.equal(isDevProject("dev"), true);
  assert.equal(isDevProject("DEV"), true);
  assert.equal(isDevProject("  Dev  "), true);
  assert.equal(isDevProject("DevOps"), false);
  assert.equal(isDevProject("Headquarters"), false);
  assert.equal(isDevProject(undefined), false);
});

test("Dev routing: update_backlog-style edits against Ideas round-trip through parse/build (add, check, re-read)", () => {
  // No note yet -> Ideas starts empty, mirrors ensureOverviewSynced's fallback.
  let ideasZoneHtml = buildIdeasZoneHtml([]);
  const referenceZoneHtml = buildReferenceZoneHtml([fakeStat("NOW.md", "# NOW\n\nbody")], "2026-09-04T00:00:00.000Z");
  let noteHtml = ideasZoneHtml + referenceZoneHtml;

  // update_backlog project:"Dev" add_bugs:["idea one"] add_improvements:["idea two"]
  let zones = parseOverviewZones(noteHtml);
  let items = parseIdeasItems(zones.ideasZoneHtml);
  items.push({ text: "idea one", checked: false });
  items.push({ text: "idea two", checked: false });
  noteHtml = buildIdeasZoneHtml(items) + zones.referenceZoneHtml;

  // update_backlog project:"Dev" check:[1]
  zones = parseOverviewZones(noteHtml);
  items = parseIdeasItems(zones.ideasZoneHtml);
  items[0].checked = true;
  noteHtml = buildIdeasZoneHtml(items) + zones.referenceZoneHtml;

  // read_backlog project:"Dev" - both items present, first checked, flat list (no Bugs/Improvements split)
  zones = parseOverviewZones(noteHtml);
  const reread = parseIdeasItems(zones.ideasZoneHtml);
  assert.deepEqual(reread, [
    { text: "idea one", checked: true },
    { text: "idea two", checked: false },
  ]);
  // Reference zone (a different note area entirely) was never touched by any of this.
  assert.equal(zones.referenceZoneHtml, referenceZoneHtml);
});

// ---------------------------------------------------------------------------
// applyIdeaEdits: the flat Ideas list has no `list` field on its entries, so
// removal splices `items` directly - exercise that path (shared with
// applyBacklogEdits's project-block path, tested in notes.test.mjs).
// ---------------------------------------------------------------------------

test("applyIdeaEdits removes an idea by number, then by exact text", () => {
  const items = [
    { text: "idea one", checked: false },
    { text: "idea two", checked: false },
    { text: "idea three", checked: false },
  ];

  const summary = applyIdeaEdits(items, noEdits({ removeRefs: [2] }));
  assert.deepEqual(items, [
    { text: "idea one", checked: false },
    { text: "idea three", checked: false },
  ]);
  assert.match(summary, /removed 1 idea\(s\)/);

  applyIdeaEdits(items, noEdits({ removeRefs: ["idea one"] }));
  assert.deepEqual(items, [{ text: "idea three", checked: false }]);
});

// ---------------------------------------------------------------------------
// Dev - Overview excluded everywhere a note is treated as a per-project note
// ---------------------------------------------------------------------------

test("projectNoteTitle prefixes a project name with 'Dev: '", () => {
  assert.equal(projectNoteTitle("Omni Suite"), "Dev: Omni Suite");
  assert.equal(projectNoteTitle("notebook"), "Dev: notebook");
});

test("projectNameFromTitle strips the prefix, or returns null when it's absent", () => {
  assert.equal(projectNameFromTitle("Dev: Omni Suite"), "Omni Suite");
  assert.equal(projectNameFromTitle("Dev: notebook"), "notebook");
  assert.equal(projectNameFromTitle("Omni Suite"), null); // unprefixed - not a Dev: title
  assert.equal(projectNameFromTitle("GTD: Getting Things Done (David Allen) - Summary"), null);
});

test("isProjectNoteTitle only treats Dev:-prefixed titles as project notes - an unprefixed one-off note is never a phantom project", () => {
  // The bug this fixes: a one-off note (a book summary, a reference dump)
  // has no "Dev: " prefix and must not be mistaken for a project note just
  // because it also isn't Dev Log or the overview note.
  assert.equal(isProjectNoteTitle("GTD: Getting Things Done (David Allen) - Summary", "Dev Log"), false);
  assert.equal(isProjectNoteTitle("Dev Log", "Dev Log"), false);
  assert.equal(isProjectNoteTitle(OVERVIEW_NOTE_TITLE, "Dev Log"), false);
  assert.equal(isProjectNoteTitle(LEGACY_OVERVIEW_NOTE_TITLE, "Dev Log"), false);
  assert.equal(isProjectNoteTitle("Dev: Omni Suite", "Dev Log"), true);
});

test("list_projects-style filtering over a note listing never yields a phantom project from an unprefixed one-off note", () => {
  const notes = [
    { title: "Dev Log" },
    { title: OVERVIEW_NOTE_TITLE },
    { title: "Dev: Headquarters" },
    { title: "Dev: BBC" },
    { title: "GTD: Getting Things Done (David Allen) - Summary" },
  ];
  const projectNotes = notes.filter((n) => isProjectNoteTitle(n.title, "Dev Log"));
  assert.deepEqual(
    projectNotes.map((n) => n.title).sort(),
    ["Dev: BBC", "Dev: Headquarters"]
  );
});
