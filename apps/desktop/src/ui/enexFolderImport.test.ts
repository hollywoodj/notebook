import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { filterTopLevelEnexFiles } from "./enexFolderImport.ts";

describe("filterTopLevelEnexFiles", () => {
  it("ignores non-.enex files", () => {
    const result = filterTopLevelEnexFiles([
      { name: "notes.enex", webkitRelativePath: "Export/notes.enex" },
      { name: "readme.txt", webkitRelativePath: "Export/readme.txt" },
    ]);
    assert.deepEqual(result.map((f) => f.name), ["notes.enex"]);
  });

  it("accepts uppercase .ENEX extensions", () => {
    const result = filterTopLevelEnexFiles([
      { name: "Notes.ENEX", webkitRelativePath: "Export/Notes.ENEX" },
    ]);
    assert.deepEqual(result.map((f) => f.name), ["Notes.ENEX"]);
  });

  it("ignores files in subfolders", () => {
    const result = filterTopLevelEnexFiles([
      { name: "top.enex", webkitRelativePath: "Export/top.enex" },
      { name: "nested.enex", webkitRelativePath: "Export/Sub/nested.enex" },
    ]);
    assert.deepEqual(result.map((f) => f.name), ["top.enex"]);
  });

  it("sorts the result by file name", () => {
    const result = filterTopLevelEnexFiles([
      { name: "c.enex", webkitRelativePath: "Export/c.enex" },
      { name: "a.enex", webkitRelativePath: "Export/a.enex" },
      { name: "b.enex", webkitRelativePath: "Export/b.enex" },
    ]);
    assert.deepEqual(result.map((f) => f.name), ["a.enex", "b.enex", "c.enex"]);
  });
});
