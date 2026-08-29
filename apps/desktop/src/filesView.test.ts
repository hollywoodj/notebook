import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defaultFilesViewState,
  fileExtensionLabel,
  fileKind,
  fileKindCounts,
  fileTotalsLabel,
  filesEmptyCopy,
  filterFiles,
  parseFilesViewState,
  sortFiles,
  type FileLike,
} from "./filesView.ts";

function file(init: Partial<FileLike>): FileLike {
  return {
    filename: "file.bin",
    mime_type: "application/octet-stream",
    size: 100,
    created_at: "2024-01-01T00:00:00Z",
    note_title: "Note",
    notebook_name: "First Notebook",
    ...init,
  };
}

describe("fileKind", () => {
  it("buckets by mime type first", () => {
    assert.equal(fileKind("image/png", "logo.png"), "image");
    assert.equal(fileKind("audio/mpeg", "clip.mp3"), "audio");
    assert.equal(fileKind("video/mp4", "demo.mp4"), "video");
    assert.equal(fileKind("application/pdf", "report.pdf"), "document");
    assert.equal(fileKind("text/plain", "notes.txt"), "document");
  });

  it("falls back to the extension when the upload has a generic mime", () => {
    assert.equal(fileKind("application/octet-stream", "scan.PDF"), "document");
    assert.equal(fileKind("application/octet-stream", "holiday.HEIC"), "image");
    assert.equal(fileKind("application/octet-stream", "voice.m4a"), "audio");
    assert.equal(fileKind("application/octet-stream", "clip.mkv"), "video");
    assert.equal(fileKind("application/octet-stream", "archive.zip"), "other");
    assert.equal(fileKind("", "no-extension"), "other");
  });

  it("treats Office documents as documents", () => {
    assert.equal(
      fileKind(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "memo.docx"
      ),
      "document"
    );
  });
});

describe("fileExtensionLabel", () => {
  it("uses the extension, or the mime subtype when there is none", () => {
    assert.equal(fileExtensionLabel("report.pdf", "application/pdf"), "PDF");
    assert.equal(fileExtensionLabel("photo.jpeg", "image/jpeg"), "JPEG");
    assert.equal(fileExtensionLabel("attachment", "image/png"), "PNG");
    assert.equal(fileExtensionLabel("attachment", ""), "FILE");
  });
});

describe("filterFiles", () => {
  const files = [
    file({ filename: "budget.xlsx", mime_type: "application/vnd.ms-excel", note_title: "Q1" }),
    file({ filename: "logo.png", mime_type: "image/png", note_title: "Brand" }),
    file({ filename: "call.mp3", mime_type: "audio/mpeg", notebook_name: "Interviews" }),
  ];

  it("filters by kind", () => {
    assert.deepEqual(
      filterFiles(files, { kind: "image" }).map((f) => f.filename),
      ["logo.png"]
    );
    assert.equal(filterFiles(files, { kind: "all" }).length, 3);
  });

  it("matches filename, note title, or notebook name", () => {
    assert.deepEqual(
      filterFiles(files, { query: "logo" }).map((f) => f.filename),
      ["logo.png"]
    );
    assert.deepEqual(
      filterFiles(files, { query: "q1" }).map((f) => f.filename),
      ["budget.xlsx"]
    );
    assert.deepEqual(
      filterFiles(files, { query: "interviews" }).map((f) => f.filename),
      ["call.mp3"]
    );
  });

  it("combines kind and query", () => {
    assert.equal(filterFiles(files, { kind: "image", query: "budget" }).length, 0);
    assert.equal(filterFiles(files, { kind: "document", query: "budget" }).length, 1);
  });

  it("keeps everything when nothing is asked for", () => {
    assert.equal(filterFiles(files).length, 3);
    assert.equal(filterFiles(files, { query: "   " }).length, 3);
  });
});

describe("sortFiles", () => {
  const files = [
    file({ filename: "b.png", size: 10, created_at: "2024-03-01T00:00:00Z" }),
    file({ filename: "a.png", size: 300, created_at: "2024-01-01T00:00:00Z" }),
    file({ filename: "c.png", size: 20, created_at: "2024-02-01T00:00:00Z" }),
  ];

  it("sorts newest first, by name, or largest first", () => {
    assert.deepEqual(
      sortFiles(files, "recent").map((f) => f.filename),
      ["b.png", "c.png", "a.png"]
    );
    assert.deepEqual(
      sortFiles(files, "name").map((f) => f.filename),
      ["a.png", "b.png", "c.png"]
    );
    assert.deepEqual(
      sortFiles(files, "size").map((f) => f.filename),
      ["a.png", "c.png", "b.png"]
    );
  });

  it("does not mutate the input", () => {
    const before = files.map((f) => f.filename);
    sortFiles(files, "name");
    assert.deepEqual(
      files.map((f) => f.filename),
      before
    );
  });
});

describe("fileKindCounts", () => {
  it("counts every bucket plus the total", () => {
    const counts = fileKindCounts([
      file({ filename: "a.png", mime_type: "image/png" }),
      file({ filename: "b.png", mime_type: "image/png" }),
      file({ filename: "c.pdf", mime_type: "application/pdf" }),
      file({ filename: "d.zip", mime_type: "application/zip" }),
    ]);
    assert.equal(counts.all, 4);
    assert.equal(counts.image, 2);
    assert.equal(counts.document, 1);
    assert.equal(counts.other, 1);
    assert.equal(counts.audio, 0);
  });
});

describe("fileTotalsLabel", () => {
  const size = (bytes: number) => `${bytes} B`;

  it("summarises count and combined size", () => {
    assert.equal(fileTotalsLabel([], size), "No files");
    assert.equal(fileTotalsLabel([file({ size: 5 })], size), "1 file · 5 B");
    assert.equal(fileTotalsLabel([file({ size: 5 }), file({ size: 7 })], size), "2 files · 12 B");
  });
});

describe("filesEmptyCopy", () => {
  it("explains the empty view in terms of what is filtered", () => {
    assert.match(filesEmptyCopy("all", "").title, /No files yet/);
    assert.match(filesEmptyCopy("image", "").title, /No images yet/);
    assert.match(filesEmptyCopy("all", "invoice").body, /invoice/);
  });
});

describe("parseFilesViewState", () => {
  it("falls back to defaults for missing or bad input", () => {
    assert.deepEqual(parseFilesViewState(null), defaultFilesViewState());
    assert.deepEqual(parseFilesViewState("{oops"), defaultFilesViewState());
    assert.deepEqual(parseFilesViewState('{"kind":"nope","sort":"nope"}'), defaultFilesViewState());
  });

  it("keeps recognised values", () => {
    assert.deepEqual(parseFilesViewState('{"kind":"audio","sort":"size","layout":"list"}'), {
      kind: "audio",
      sort: "size",
      layout: "list",
    });
  });
});
