import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checklistProgressLabel, countCharacters, countWords, htmlToMarkdown, htmlToPlainText, mergeNoteBodies, readingTimeLabel, resolveThumbnailUrl, suggestedTags } from "./noteContent.ts";
import { parsePaneLayout } from "./panes.ts";

describe("countWords", () => {
  it("ignores extra whitespace", () => {
    assert.equal(countWords(""), 0);
    assert.equal(countWords("  hello   world\n\nagain "), 3);
  });
});

describe("suggestedTags", () => {
  it("filters already-applied tags and matches the query", () => {
    const tags = [
      { id: "1", name: "work" },
      { id: "2", name: "travel" },
      { id: "3", name: "recipes" },
    ];
    assert.deepEqual(
      suggestedTags(tags, "e", ["1"]).map((tag) => tag.name),
      ["travel", "recipes"]
    );
  });
});

describe("mergeNoteBodies", () => {
  it("keeps the first body and appends later titles as headings", () => {
    const html = mergeNoteBodies([
      { title: "A", content: "<p>one</p>" },
      { title: "B & C", content: "<p>two</p>" },
    ]);
    assert.equal(html, "<p>one</p><h1>B &amp; C</h1><p>two</p>");
  });
});

describe("checklistProgressLabel", () => {
  it("formats checklist progress", () => {
    assert.equal(checklistProgressLabel(1, 4), "1/4");
    assert.equal(checklistProgressLabel(0, 0), null);
  });
});

describe("resolveThumbnailUrl", () => {
  const toUrl = (id: string) => `http://api/attachments/${id}`;

  it("turns attachment ids into download URLs and leaves remote images alone", () => {
    const id = "11111111-1111-4111-8111-111111111111";
    assert.equal(resolveThumbnailUrl(id, toUrl), `http://api/attachments/${id}`);
    assert.equal(
      resolveThumbnailUrl(`notebook-attachment://${id}`, toUrl),
      `http://api/attachments/${id}`
    );
    assert.equal(resolveThumbnailUrl("https://cdn.example/pic.png", toUrl), "https://cdn.example/pic.png");
    assert.equal(resolveThumbnailUrl(null, toUrl), null);
  });
});

describe("html export helpers", () => {
  it("turns simple HTML into markdown and plain text", () => {
    const html = "<h1>Hello</h1><p>See <strong>this</strong> <a href=\"https://x\">link</a></p>";
    assert.match(htmlToMarkdown(html), /^# Hello/m);
    assert.match(htmlToMarkdown(html), /\*\*this\*\*/);
    assert.match(htmlToMarkdown(html), /\[link\]\(https:\/\/x\)/);
    assert.equal(htmlToPlainText(html).includes("Hello"), true);
    assert.equal(htmlToPlainText(html).includes("<"), false);
  });
});

describe("parsePaneLayout", () => {
  it("counts characters and reading time", () => {
    assert.equal(countCharacters("hello world"), 11);
    assert.equal(readingTimeLabel(0), null);
    assert.equal(readingTimeLabel(50), "1 min read");
    assert.equal(readingTimeLabel(400), "2 min read");
  });
});
