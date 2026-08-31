import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parsePaneLayout } from "./panes.ts";
import { fromDatetimeLocalValue, groupRemindersForList, isReminderOverdue, isoDayKey, monthGrid, parseCompletedReminders, reminderFallsOnDay, reminderFromPreset, reminderFromSnooze, shiftMonth, toDatetimeLocalValue, toggleCompletedReminder } from "./reminders.ts";
import { moveSidebarSection, parseSidebarSections, sidebarSectionLabel } from "./sidebar.ts";

describe("reminder datetime helpers", () => {
  it("round-trips a local datetime value", () => {
    const iso = fromDatetimeLocalValue("2026-08-17T09:30");
    assert.ok(iso);
    assert.equal(toDatetimeLocalValue(iso), "2026-08-17T09:30");
  });

  it("marks past reminders as overdue", () => {
    assert.equal(isReminderOverdue("2020-01-01T00:00:00Z", new Date("2026-01-01")), true);
    assert.equal(isReminderOverdue(null), false);
  });
});

describe("reminderFromPreset", () => {
  it("sets tonight, tomorrow morning, and next week", () => {
    const now = new Date("2026-08-17T10:00:00");
    const tonight = new Date(reminderFromPreset("tonight", now));
    const tomorrow = new Date(reminderFromPreset("tomorrow", now));
    const nextWeek = new Date(reminderFromPreset("nextWeek", now));
    assert.equal(tonight.getHours(), 18);
    assert.equal(tonight.getDate(), 17);
    assert.equal(tomorrow.getHours(), 9);
    assert.equal(tomorrow.getDate(), 18);
    assert.equal(nextWeek.getDate(), 24);
  });
});

describe("reminder snooze", () => {
  it("pushes later today by three hours and tomorrow morning to 9am", () => {
    const now = new Date("2026-08-18T10:00:00");
    const later = new Date(reminderFromSnooze("laterToday", now));
    const morning = new Date(reminderFromSnooze("tomorrowMorning", now));
    assert.equal(later.getHours(), 13);
    assert.equal(morning.getDate(), 19);
    assert.equal(morning.getHours(), 9);
  });
});

describe("reminder agenda", () => {
  it("buckets overdue, today, tomorrow, later, and completed", () => {
    const now = new Date("2026-08-18T12:00:00");
    const groups = groupRemindersForList(
      [
        { id: "a", reminder_at: "2026-08-17T09:00:00" },
        { id: "b", reminder_at: "2026-08-18T18:00:00" },
        { id: "c", reminder_at: "2026-08-19T09:00:00" },
        { id: "d", reminder_at: "2026-08-25T09:00:00" },
        { id: "e", reminder_at: "2026-08-18T08:00:00" },
      ],
      ["e"],
      now
    );
    assert.deepEqual(
      groups.map((group) => [group.key, group.notes.map((note) => note.id)]),
      [
        ["overdue", ["a"]],
        ["today", ["b"]],
        ["tomorrow", ["c"]],
        ["later", ["d"]],
        ["completed", ["e"]],
      ]
    );
    assert.deepEqual(toggleCompletedReminder(["e"], "e"), []);
    assert.deepEqual(parseCompletedReminders(JSON.stringify(["x"])), ["x"]);
  });
});

describe("parsePaneLayout", () => {
  it("reorders sidebar sections and builds a reminder month grid", () => {
    const sections = parseSidebarSections(JSON.stringify(["trash", "notes"]));
    assert.equal(sections[0], "trash");
    assert.equal(sections.includes("tags"), true);
    assert.equal(sidebarSectionLabel("saved"), "Saved searches");
    assert.deepEqual(moveSidebarSection(["notes", "tags", "trash"], "tags", -1), [
      "tags",
      "notes",
      "trash",
    ]);
    const days = monthGrid(2026, 7, "sunday", new Date("2026-08-19T12:00:00"));
    assert.equal(days.length, 42);
    assert.equal(days.filter((day) => day.inMonth).length, 31);
    assert.equal(days.find((day) => day.isToday)?.day, 19);
    assert.equal(isoDayKey(new Date(2026, 7, 19)), "2026-08-19");
    assert.equal(reminderFallsOnDay("2026-08-19T09:00:00", "2026-08-19"), true);
    assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  });
});
