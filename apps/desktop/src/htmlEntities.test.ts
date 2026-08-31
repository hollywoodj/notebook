import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeXmlEntities, repairImportedHtml } from "./htmlEntities.ts";
import { htmlToPlainText } from "./ui/noteContent.ts";

describe("imported entity repair", () => {
  it("decodes XML apostrophe entities so imported notes show ' not &apos;", () => {
    assert.equal(decodeXmlEntities("John&apos;s note"), "John's note");
    assert.equal(decodeXmlEntities("It&amp;apos;s"), "It's");
    assert.equal(htmlToPlainText("<p>Don&apos;t forget</p>"), "Don't forget");
    assert.equal(htmlToPlainText("<p>It&amp;apos;s fine</p>"), "It's fine");
    assert.equal(repairImportedHtml("<p>It&amp;apos;s Tom&amp;apos;s</p>"), "<p>It's Tom's</p>");
    assert.equal(decodeXmlEntities(null), "");
    assert.equal(repairImportedHtml(undefined), "");
    assert.equal(htmlToPlainText(null), "");
    assert.equal(htmlToPlainText(undefined), "");
  });
});
