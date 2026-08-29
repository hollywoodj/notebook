import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseLastSession, pushNavHistory, sameNavLocation, stepNavBack, stepNavForward } from "./navigation.ts";

describe("navigation history", () => {
  it("pushes a new location and can step back and forward", () => {
    const notes = { filter: { type: "all" }, noteId: null };
    const invoice = { filter: { type: "all" }, noteId: "n1" };
    const work = { filter: { type: "notebook", id: "nb" }, noteId: "n1" };
    assert.equal(sameNavLocation(notes, { filter: { type: "all" }, noteId: null }), true);
    assert.equal(sameNavLocation(notes, invoice), false);
    const pushed = pushNavHistory([], notes, invoice);
    assert.ok(pushed);
    assert.equal(pushNavHistory(pushed.past, invoice, invoice), null);
    const back = stepNavBack(pushed.past, invoice, []);
    assert.ok(back);
    assert.equal(back.current.noteId, null);
    const forward = stepNavForward(back.past, back.current, back.future);
    assert.ok(forward);
    assert.equal(forward.current.noteId, "n1");
    const notebook = pushNavHistory(forward.past, forward.current, work);
    assert.ok(notebook);
    assert.equal(notebook.future.length, 0);
  });
});

describe("last session restore", () => {
  it("parses the last session", () => {
    const session = parseLastSession(
      JSON.stringify({ filter: { type: "notebook", id: "nb", name: "Work" }, noteId: "n1" })
    );
    assert.equal(session?.filter.type, "notebook");
    assert.equal(session?.noteId, "n1");
    assert.equal(parseLastSession("{"), null);
  });
});
