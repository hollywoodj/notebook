import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildOmniFocusAddUrl,
  buildOmniFocusPasteUrl,
  checklistToTaskPaper,
  extractChecklistTasks,
  omniFocusDueParam,
  omniFocusNoteField,
  parseNotebookUrl,
  schemesForPref,
  sendUrlsForChecklists,
  sendUrlsForNote,
} from "./omniFocus.ts";

describe("parseNotebookUrl", () => {
  it("reads classic app links the way OmniFocus pastes them", () => {
    assert.deepEqual(parseNotebookUrl("notebook://note/abc-123"), {
      kind: "note",
      id: "abc-123",
    });
    assert.deepEqual(parseNotebookUrl("notebook:///note/abc-123"), {
      kind: "note",
      id: "abc-123",
    });
    assert.deepEqual(parseNotebookUrl("#/note/abc-123"), {
      kind: "note",
      id: "abc-123",
    });
    assert.equal(parseNotebookUrl("https://example.com"), null);
  });
});

describe("OmniFocus URL scheme", () => {
  it("builds the documented three-slash add URL", () => {
    const url = buildOmniFocusAddUrl("omniclone", {
      name: "Pick up milk",
      note: "notebook://note/abc",
      due: "2026-08-19 5pm",
      autosave: true,
    });
    assert.equal(url.startsWith("omniclone:///add?"), true);
    assert.equal(url.includes("name=Pick%20up%20milk"), true);
    assert.equal(url.includes("note=notebook%3A%2F%2Fnote%2Fabc"), true);
    assert.equal(url.includes("due=2026-08-19%205pm"), true);
    assert.equal(url.includes("autosave=true"), true);
  });

  it("uses x-callback-url/add when returning to Notebook", () => {
    const url = buildOmniFocusAddUrl("omniclone", {
      name: "Task",
      xSuccess: "notebook://note/abc",
    });
    assert.equal(url.startsWith("omniclone:///x-callback-url/add?"), true);
    assert.equal(url.includes("x-success=notebook"), true);
  });

  it("pastes TaskPaper into the inbox", () => {
    const url = buildOmniFocusPasteUrl(
      "omniclone",
      "- Buy milk\n  notebook://note/abc"
    );
    assert.equal(url.startsWith("omniclone:///paste?"), true);
    assert.equal(url.includes("target=inbox"), true);
    assert.equal(url.includes("content=-%20Buy%20milk"), true);
  });
});

describe("send payloads", () => {
  it("puts the app link in the OmniFocus note field", () => {
    assert.equal(
      omniFocusNoteField("notebook://note/a", "Snippet"),
      "notebook://note/a\n\nSnippet"
    );
    const urls = sendUrlsForNote({
      title: "Meeting notes",
      noteId: "n1",
      reminderAt: "2026-08-19T17:00:00",
      snippet: "Agenda",
    });
    assert.equal(urls.length, 1);
    assert.equal(urls[0].includes("name=Meeting%20notes"), true);
    assert.equal(urls[0].includes("notebook"), true);
    assert.equal(urls[0].includes("due="), true);
  });

  it("sends both OmniClone and OmniFocus when asked", () => {
    assert.deepEqual(schemesForPref("both"), ["omniclone", "omnifocus"]);
    const urls = sendUrlsForNote({
      title: "A",
      noteId: "n1",
      schemePref: "both",
      sendDue: false,
    });
    assert.equal(urls[0].startsWith("omniclone:///"), true);
    assert.equal(urls[1].startsWith("omnifocus:///"), true);
  });

  it("extracts unchecked TipTap checklist items", () => {
    const html = `<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p>Buy milk</p></div></li><li data-type="taskItem" data-checked="true"><div><p>Done</p></div></li></ul>`;
    const tasks = extractChecklistTasks(html);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].title, "Buy milk");
    assert.equal(tasks[0].checked, false);
    assert.equal(tasks[1].checked, true);
    const paper = checklistToTaskPaper(tasks, "notebook://note/n1");
    assert.equal(paper.includes("- Buy milk"), true);
    assert.equal(paper.includes("Done"), false);
  });

  it("batches several checkboxes through paste and one through add", () => {
    const one = sendUrlsForChecklists({
      title: "Note",
      noteId: "n1",
      html: `<li data-type="taskItem" data-checked="false"><p>Only</p></li>`,
    });
    assert.equal(one[0].includes("/add?"), true);
    assert.equal(one[0].includes("name=Only"), true);

    const many = sendUrlsForChecklists({
      title: "Note",
      noteId: "n1",
      html: `<li data-type="taskItem" data-checked="false"><p>One</p></li><li data-type="taskItem" data-checked="false"><p>Two</p></li>`,
    });
    assert.equal(many[0].includes("/paste?"), true);
    assert.equal(many[0].includes("target=inbox"), true);
  });
});

describe("omniFocusDueParam", () => {
  it("formats a local datetime the URL scheme accepts", () => {
    const formatted = omniFocusDueParam("2026-08-19T17:00:00");
    assert.ok(formatted);
    assert.match(formatted, /2026-08-19 \d{1,2}(:\d{2})?(am|pm)/);
  });
});
