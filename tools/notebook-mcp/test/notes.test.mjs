import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "../format.mjs";
import {
  PROJECT_NOTE_OFFSET,
  DEV_LOG_OFFSET,
  parseProjectBlock,
  serializeProjectBlock,
  parseDevLog,
  serializeDevLog,
  combinedItems,
  formatNumberedItems,
  resolveRequiredProject,
  requireProjectArg,
  applyBacklogEdits,
  ToolInputError,
} from "../notes.mjs";

function emptyBlock() {
  return { bugs: [], improvements: [], reviews: [] };
}

function noEdits(overrides = {}) {
  return { addBugs: [], addImprovements: [], checkRefs: [], uncheckRefs: [], removeRefs: [], ...overrides };
}

// ---------------------------------------------------------------------------
// Level-offset parse/serialize, both ways, both offsets
// ---------------------------------------------------------------------------

test("serializeProjectBlock / parseProjectBlock round-trip at offset 0 (own note)", () => {
  const block = {
    bugs: [
      { text: "Crash on save", checked: false },
      { text: "Typo in footer", checked: true },
    ],
    improvements: [{ text: "Add dark mode", checked: false }],
    reviews: [
      { date: "2026-09-04", subtitle: "Second pass", bodyHtml: "<p>Looks good.</p>" },
      { date: "2026-08-28", subtitle: null, bodyHtml: "<p>First pass.</p>" },
    ],
  };
  const html = serializeProjectBlock(block, PROJECT_NOTE_OFFSET);

  // offset 0 -> h2 sections, h3 review dates
  assert.match(html, /<h2>Bugs<\/h2>/);
  assert.match(html, /<h2>Future Improvements<\/h2>/);
  assert.match(html, /<h2>Architecture Reviews<\/h2>/);
  assert.match(html, /<h3>2026-09-04<\/h3>/);
  assert.match(html, /<h3>2026-08-28<\/h3>/);

  const reparsed = parseProjectBlock(html, PROJECT_NOTE_OFFSET);
  assert.deepEqual(reparsed, block);
});

test("serializeProjectBlock / parseProjectBlock round-trip at offset 1 (Dev Log block)", () => {
  const block = {
    bugs: [{ text: "old bug", checked: false }],
    improvements: [],
    reviews: [{ date: "2026-09-01", subtitle: null, bodyHtml: "<p>Notes.</p>" }],
  };
  const html = serializeProjectBlock(block, DEV_LOG_OFFSET);

  // offset 1 -> h3 sections, h4 review dates
  assert.match(html, /<h3>Bugs<\/h3>/);
  assert.match(html, /<h3>Future Improvements<\/h3>/);
  assert.match(html, /<h3>Architecture Reviews<\/h3>/);
  assert.match(html, /<h4>2026-09-01<\/h4>/);
  assert.doesNotMatch(html, /<h2>/);

  const reparsed = parseProjectBlock(html, DEV_LOG_OFFSET);
  assert.deepEqual(reparsed, block);
});

test("parseProjectBlock tolerates an empty block (all three headings still emitted)", () => {
  const html = serializeProjectBlock(emptyBlock(), PROJECT_NOTE_OFFSET);
  assert.match(html, /<h2>Bugs<\/h2>/);
  assert.match(html, /<h2>Future Improvements<\/h2>/);
  assert.match(html, /<h2>Architecture Reviews<\/h2>/);
  const reparsed = parseProjectBlock(html, PROJECT_NOTE_OFFSET);
  assert.deepEqual(reparsed, emptyBlock());
});

// ---------------------------------------------------------------------------
// applyBacklogEdits: remove, plus its interaction with add/check/uncheck
// ---------------------------------------------------------------------------

test("applyBacklogEdits removes an item by number", () => {
  const block = {
    bugs: [
      { text: "b1", checked: false },
      { text: "b2", checked: false },
    ],
    improvements: [{ text: "i1", checked: false }],
    reviews: [],
  };
  // combined numbering: 1=b1, 2=b2, 3=i1
  const summary = applyBacklogEdits(block, noEdits({ removeRefs: [2] }), `project "X"`);
  assert.deepEqual(block.bugs, [{ text: "b1", checked: false }]);
  assert.deepEqual(block.improvements, [{ text: "i1", checked: false }]);
  assert.match(summary, /removed 1 item\(s\)/);
});

test("applyBacklogEdits removes an item by exact text", () => {
  const block = {
    bugs: [
      { text: "b1", checked: false },
      { text: "b2", checked: false },
    ],
    improvements: [],
    reviews: [],
  };
  applyBacklogEdits(block, noEdits({ removeRefs: ["b1"] }), `project "X"`);
  assert.deepEqual(block.bugs, [{ text: "b2", checked: false }]);
});

test("applyBacklogEdits removing two items in one call removes exactly those two - the index-vs-identity splicing trap", () => {
  // If removal computed both target indices up front and spliced them in
  // sequence, removing 1 and 2 would actually remove 1 and 3 - the first
  // splice shifts everything after it down by one. Removal must instead
  // find each item's live index (by object identity) at the moment it is
  // spliced.
  const block = {
    bugs: [
      { text: "b1", checked: false },
      { text: "b2", checked: false },
      { text: "b3", checked: false },
      { text: "b4", checked: false },
    ],
    improvements: [],
    reviews: [],
  };
  applyBacklogEdits(block, noEdits({ removeRefs: [1, 2] }), `project "X"`);
  assert.deepEqual(block.bugs, [
    { text: "b3", checked: false },
    { text: "b4", checked: false },
  ]);
});

test("applyBacklogEdits removes across both lists in one call, each landing in its own array", () => {
  const block = {
    bugs: [
      { text: "b1", checked: false },
      { text: "b2", checked: false },
    ],
    improvements: [
      { text: "i1", checked: false },
      { text: "i2", checked: false },
    ],
    reviews: [],
  };
  // combined numbering: 1=b1, 2=b2, 3=i1, 4=i2
  applyBacklogEdits(block, noEdits({ removeRefs: [2, 3] }), `project "X"`);
  assert.deepEqual(block.bugs, [{ text: "b1", checked: false }]);
  assert.deepEqual(block.improvements, [{ text: "i2", checked: false }]);
});

test("applyBacklogEdits is atomic: a bogus remove ref alongside a valid one aborts the whole call, including a pending add", () => {
  const block = {
    bugs: [
      { text: "b1", checked: false },
      { text: "b2", checked: false },
    ],
    improvements: [],
    reviews: [],
  };
  const snapshot = JSON.parse(JSON.stringify(block));
  assert.throws(
    () =>
      applyBacklogEdits(
        block,
        noEdits({ removeRefs: [1, "does not exist"], addBugs: ["new bug"] }),
        `project "X"`
      ),
    ToolInputError
  );
  assert.deepEqual(block, snapshot, "block must be completely unchanged when any ref fails to resolve");
});

test("applyBacklogEdits applies remove + add in the documented order (check/uncheck -> remove -> add)", () => {
  const block = {
    bugs: [
      { text: "b1", checked: false },
      { text: "b2", checked: false },
    ],
    improvements: [],
    reviews: [],
  };
  const summary = applyBacklogEdits(block, noEdits({ removeRefs: [1], addBugs: ["b3"] }), `project "X"`);
  assert.deepEqual(block.bugs, [
    { text: "b2", checked: false },
    { text: "b3", checked: false },
  ]);
  assert.match(summary, /removed 1 item\(s\)/);
  assert.match(summary, /added 1 bug\(s\)/);
});

// ---------------------------------------------------------------------------
// Dev Log: many named offset-1 blocks
// ---------------------------------------------------------------------------

test("parseDevLog / serializeDevLog round-trip multiple projects, preserving intro", () => {
  const intro = "<p>intro text</p>";
  const devLog = {
    intro,
    projects: [
      {
        name: "Headquarters",
        bugs: [{ text: "Crash on save", checked: false }],
        improvements: [{ text: "Add dark mode", checked: false }],
        reviews: [{ date: "2026-09-04", subtitle: null, bodyHtml: "<p>Body.</p>" }],
      },
      {
        name: "BBC",
        bugs: [],
        improvements: [{ text: "Faster search", checked: false }],
        reviews: [],
      },
    ],
  };
  const html = serializeDevLog(devLog);
  assert.match(html, /<h2>Headquarters<\/h2>/);
  assert.match(html, /<h2>BBC<\/h2>/);
  assert.ok(html.startsWith(intro));

  const reparsed = parseDevLog(html);
  assert.equal(reparsed.intro, intro);
  assert.deepEqual(reparsed, devLog);
});

test("combinedItems / formatNumberedItems number bugs then improvements", () => {
  const block = {
    bugs: [
      { text: "Crash on save", checked: false },
      { text: "Typo in footer", checked: true },
    ],
    improvements: [{ text: "Add dark mode", checked: false }],
    reviews: [],
  };
  const combined = combinedItems(block);
  assert.equal(combined.length, 3);
  assert.equal(
    formatNumberedItems(block.bugs, 1) + "\n" + formatNumberedItems(block.improvements, block.bugs.length + 1),
    "1. [ ] Crash on save\n2. [x] Typo in footer\n3. [ ] Add dark mode"
  );
});

// ---------------------------------------------------------------------------
// enable_project / disable_project structural behavior (the pure move, as
// server.mjs's toolEnableProject / toolDisableProject perform it)
// ---------------------------------------------------------------------------

test("enabling a project moves its Dev Log section out - gone from Dev Log, present (promoted) in the new note", () => {
  const devLog = parseDevLog(
    serializeDevLog({
      intro: "<p>intro</p>",
      projects: [
        {
          name: "Headquarters",
          bugs: [{ text: "Crash on save", checked: false }],
          improvements: [{ text: "Add dark mode", checked: false }],
          reviews: [{ date: "2026-09-04", subtitle: "Scope", bodyHtml: "<p>Body.</p>" }],
        },
        {
          name: "BBC",
          bugs: [],
          improvements: [{ text: "Faster search", checked: false }],
          reviews: [],
        },
      ],
    })
  );

  // Simulate toolEnableProject("Headquarters"): extract the section, then
  // build the standalone note's content at offset 0.
  const idx = devLog.projects.findIndex((p) => p.name === "Headquarters");
  assert.notEqual(idx, -1);
  const [block] = devLog.projects.splice(idx, 1);
  const ownNoteHtml = serializeProjectBlock(block, PROJECT_NOTE_OFFSET);

  // Gone from Dev Log.
  const remainingDevLogHtml = serializeDevLog(devLog);
  assert.doesNotMatch(remainingDevLogHtml, /Headquarters/);
  assert.match(remainingDevLogHtml, /BBC/);
  const reparsedDevLog = parseDevLog(remainingDevLogHtml);
  assert.equal(reparsedDevLog.projects.length, 1);
  assert.equal(reparsedDevLog.projects[0].name, "BBC");

  // Present, promoted one heading level, in the new note.
  assert.match(ownNoteHtml, /<h2>Bugs<\/h2>/);
  assert.match(ownNoteHtml, /<h2>Architecture Reviews<\/h2>/);
  assert.match(ownNoteHtml, /<h3>2026-09-04<\/h3>/); // review date promoted from h4 to h3
  const reparsedOwn = parseProjectBlock(ownNoteHtml, PROJECT_NOTE_OFFSET);
  assert.equal(reparsedOwn.bugs[0].text, "Crash on save");
  assert.equal(reparsedOwn.improvements[0].text, "Add dark mode");
  assert.equal(reparsedOwn.reviews[0].date, "2026-09-04");
  assert.equal(reparsedOwn.reviews[0].subtitle, "Scope");
});

test("disabling a project round-trips its content back into Dev Log, demoted, with nothing lost", () => {
  const ownBlock = {
    bugs: [{ text: "Crash on save", checked: false }],
    improvements: [{ text: "Add dark mode", checked: true }],
    reviews: [
      { date: "2026-09-04", subtitle: "Scope", bodyHtml: "<p>Newest.</p>" },
      { date: "2026-08-20", subtitle: null, bodyHtml: "<p>Older.</p>" },
    ],
  };

  // Simulate toolDisableProject("Headquarters") folding it back into an
  // existing Dev Log that already holds another project.
  let devLog = parseDevLog(
    serializeDevLog({
      intro: "<p>intro</p>",
      projects: [{ name: "BBC", bugs: [], improvements: [], reviews: [] }],
    })
  );
  devLog.projects.push({ name: "Headquarters", ...ownBlock });
  const html = serializeDevLog(devLog);

  assert.match(html, /<h2>Headquarters<\/h2>/);
  assert.match(html, /<h3>Bugs<\/h3>/); // demoted from h2
  assert.match(html, /<h4>2026-09-04<\/h4>/); // review date demoted from h3 to h4

  const reparsed = parseDevLog(html);
  const hq = reparsed.projects.find((p) => p.name === "Headquarters");
  assert.ok(hq, "Headquarters section should exist in Dev Log after disabling");
  assert.deepEqual(hq.bugs, ownBlock.bugs);
  assert.deepEqual(hq.improvements, ownBlock.improvements);
  assert.deepEqual(hq.reviews, ownBlock.reviews);
  // BBC untouched.
  assert.ok(reparsed.projects.find((p) => p.name === "BBC"));
});

test("enable then disable round-trips a project's content byte-for-byte through both offsets", () => {
  const original = {
    bugs: [{ text: "b1", checked: false }, { text: "b2", checked: true }],
    improvements: [{ text: "i1", checked: false }],
    reviews: [
      { date: "2026-09-04", subtitle: "s", bodyHtml: "<p>body one</p>" },
      { date: "2026-08-01", subtitle: null, bodyHtml: "<p>body two</p><hr>" },
    ],
  };
  // enable: offset 1 -> offset 0
  const enabledHtml = serializeProjectBlock(original, PROJECT_NOTE_OFFSET);
  const enabledParsed = parseProjectBlock(enabledHtml, PROJECT_NOTE_OFFSET);
  // disable: offset 0 -> offset 1
  const disabledHtml = serializeProjectBlock(enabledParsed, DEV_LOG_OFFSET);
  const disabledParsed = parseProjectBlock(disabledHtml, DEV_LOG_OFFSET);

  assert.deepEqual(disabledParsed, original);
});

// ---------------------------------------------------------------------------
// Architecture Reviews entries stay newest-first
// ---------------------------------------------------------------------------

test("review entries stay newest-first as add_report's unshift pattern maintains them", () => {
  const block = emptyBlock();
  // Mirrors toolAddReport: unshift each new entry.
  block.reviews.unshift({ date: "2026-09-01", subtitle: null, bodyHtml: markdownToHtml("First review body.") });
  block.reviews.unshift({ date: "2026-09-04", subtitle: null, bodyHtml: markdownToHtml("Second review body.") });

  const html = serializeProjectBlock(block, PROJECT_NOTE_OFFSET);
  const reparsed = parseProjectBlock(html, PROJECT_NOTE_OFFSET);

  assert.equal(reparsed.reviews.length, 2);
  assert.equal(reparsed.reviews[0].date, "2026-09-04");
  assert.match(reparsed.reviews[0].bodyHtml, /Second review body\./);
  assert.equal(reparsed.reviews[1].date, "2026-09-01");
  assert.match(reparsed.reviews[1].bodyHtml, /First review body\./);

  // heading order in the raw HTML is newest-first too
  assert.ok(html.indexOf("2026-09-04") < html.indexOf("2026-09-01"));
});

// ---------------------------------------------------------------------------
// Project-name defaulting
// ---------------------------------------------------------------------------

test("resolveRequiredProject defaults to cwd basename, resolving the Dev root to the reserved \"Dev\" project", () => {
  assert.equal(resolveRequiredProject("Explicit", "C:/Users/James/Dev/Apps/Notebook"), "Explicit");
  assert.equal(resolveRequiredProject(undefined, "C:/Users/James/Dev/Apps/Notebook"), "Notebook");
  assert.equal(resolveRequiredProject(undefined, "C:/Users/James/Dev"), "Dev");
});

test("requireProjectArg never defaults - it errors on a missing/blank project", () => {
  assert.equal(requireProjectArg({ project: "Headquarters" }), "Headquarters");
  assert.throws(() => requireProjectArg({}), ToolInputError);
  assert.throws(() => requireProjectArg({ project: "   " }), ToolInputError);
});
