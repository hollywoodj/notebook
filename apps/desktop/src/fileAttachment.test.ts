import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPdfFile, titleFromFilename } from "./components/fileAttachment.ts";

describe("titleFromFilename", () => {
  it("uses the PDF name as a note title", () => {
    assert.equal(titleFromFilename("Quarterly report.pdf"), "Quarterly report");
    assert.equal(titleFromFilename("invoice"), "invoice");
  });
});

describe("isPdfFile", () => {
  it("detects PDFs by mime or filename", () => {
    assert.equal(isPdfFile("application/pdf", "file.bin"), true);
    assert.equal(isPdfFile("application/octet-stream", "scan.PDF"), true);
    assert.equal(isPdfFile("image/png", "photo.png"), false);
  });
});
