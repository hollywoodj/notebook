import { test } from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "../format.mjs";
import {
  parseBacklogHtml,
  serializeBacklogHtml,
  combinedBacklogItems,
  formatNumberedItems,
  parseReportEntries,
  prependReportEntry,
  resolveRequiredProject,
  ToolInputError,
  REPORT_HEADING_SEP,
} from "../notes.mjs";

function backlogHtmlFor(projects) {
  // Build backlog HTML the same way the server does, via markdownToHtml + notes.mjs serialize,
  // by round-tripping through parse/serialize starting from a hand-built structure.
  return serializeBacklogHtml({ intro: "<p>intro</p>", projects });
}

test("parses a multi-project backlog note into sections with checked state", () => {
  const html = backlogHtmlFor([
    {
      name: "Headquarters",
      bugs: [
        { text: "Crash on save", checked: false },
        { text: "Typo in footer", checked: true },
      ],
      improvements: [{ text: "Add dark mode", checked: false }],
    },
    {
      name: "Notebook",
      bugs: [],
      improvements: [{ text: "Faster search", checked: false }],
    },
  ]);

  const parsed = parseBacklogHtml(html);
  assert.equal(parsed.intro, "<p>intro</p>");
  assert.equal(parsed.projects.length, 2);

  const hq = parsed.projects.find((p) => p.name === "Headquarters");
  assert.ok(hq);
  assert.equal(hq.bugs.length, 2);
  assert.equal(hq.bugs[0].text, "Crash on save");
  assert.equal(hq.bugs[0].checked, false);
  assert.equal(hq.bugs[1].checked, true);
  assert.equal(hq.improvements.length, 1);
  assert.equal(hq.improvements[0].text, "Add dark mode");

  const nb = parsed.projects.find((p) => p.name === "Notebook");
  assert.ok(nb);
  assert.equal(nb.bugs.length, 0);
  assert.equal(nb.improvements[0].text, "Faster search");

  // numbering used by read_backlog / referenced by update_backlog's check/uncheck
  const combined = combinedBacklogItems(hq);
  assert.equal(combined.length, 3);
  assert.equal(
    formatNumberedItems(hq.bugs, 1) + "\n" + formatNumberedItems(hq.improvements, hq.bugs.length + 1),
    "1. [ ] Crash on save\n2. [x] Typo in footer\n3. [ ] Add dark mode"
  );
});

test("adding an item to a project section that doesn't exist yet creates it, without touching other sections", () => {
  const html = backlogHtmlFor([{ name: "ExistingProject", bugs: [{ text: "old bug", checked: false }], improvements: [] }]);
  const parsed = parseBacklogHtml(html);

  // Mirrors toolUpdateBacklog's logic: find-or-create the section, push a new unchecked item.
  let section = parsed.projects.find((p) => p.name === "NewProject");
  const isNew = !section;
  if (!section) section = { name: "NewProject", bugs: [], improvements: [] };
  section.bugs.push({ text: "brand new bug", checked: false });
  if (isNew) parsed.projects.push(section);

  const rewritten = serializeBacklogHtml(parsed);
  const reparsed = parseBacklogHtml(rewritten);

  assert.equal(reparsed.projects.length, 2);
  const existing = reparsed.projects.find((p) => p.name === "ExistingProject");
  assert.equal(existing.bugs.length, 1);
  assert.equal(existing.bugs[0].text, "old bug");

  const created = reparsed.projects.find((p) => p.name === "NewProject");
  assert.ok(created, "new project section should have been created");
  assert.equal(created.bugs.length, 1);
  assert.equal(created.bugs[0].text, "brand new bug");
  assert.equal(created.bugs[0].checked, false);
  assert.equal(created.improvements.length, 0);
});

test("prepending a report entry puts the newest entry first and preserves older entries", () => {
  const introHtml = "<p>Written by Claude Code. Newest entry at top.</p>";
  let html = introHtml;

  const entry1 = `<h2>2026-09-01${REPORT_HEADING_SEP}Headquarters</h2>${markdownToHtml("First review body.")}<hr>`;
  html = prependReportEntry(html, entry1);

  const entry2 = `<h2>2026-09-04${REPORT_HEADING_SEP}Headquarters</h2>${markdownToHtml("Second review body.")}<hr>`;
  html = prependReportEntry(html, entry2);

  const entries = parseReportEntries(html);
  assert.equal(entries.length, 2);
  assert.equal(entries[0].heading, `2026-09-04${REPORT_HEADING_SEP}Headquarters`);
  assert.equal(entries[0].project, "Headquarters");
  assert.match(entries[0].bodyHtml, /Second review body\./);
  assert.equal(entries[1].heading, `2026-09-01${REPORT_HEADING_SEP}Headquarters`);
  assert.match(entries[1].bodyHtml, /First review body\./);

  // intro text must still precede the first (newest) entry
  assert.ok(html.indexOf(introHtml) < html.indexOf("2026-09-04"));
  assert.ok(html.indexOf("2026-09-04") < html.indexOf("2026-09-01"));
});

test("resolveRequiredProject defaults to cwd basename, and refuses the Dev root", () => {
  assert.equal(resolveRequiredProject("Explicit", "C:/Users/James/Dev/Apps/notebook"), "Explicit");
  assert.equal(resolveRequiredProject(undefined, "C:/Users/James/Dev/Apps/notebook"), "notebook");
  assert.throws(() => resolveRequiredProject(undefined, "C:/Users/James/Dev"), ToolInputError);
});
