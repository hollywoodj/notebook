import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { noteAppLink, noteMailtoHref, notesToEnex } from "./share.ts";

describe("noteAppLink", () => {
  it("uses an Evernote-style app URL", () => {
    assert.equal(noteAppLink("abc"), "notebook://note/abc");
  });
});

describe("notesToEnex", () => {
  it("wraps notes in Evernote export XML", () => {
    const enex = notesToEnex([
      {
        title: "Hello",
        content: "<p>Hi</p>",
        created_at: "2026-08-17T12:00:00.000Z",
        updated_at: "2026-08-17T12:00:00.000Z",
        tag_names: ["work"],
      },
    ]);
    assert.match(enex, /<en-export>/);
    assert.match(enex, /<title>Hello<\/title>/);
    assert.match(enex, /<tag>work<\/tag>/);
  });
});

describe("noteMailtoHref", () => {
  it("builds a mailto link", () => {
    assert.match(noteMailtoHref("Hello", "Body text"), /^mailto:\?subject=Hello&body=Body%20text$/);
  });
});
