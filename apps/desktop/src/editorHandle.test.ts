import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";
import { editorCommands, type EditorCommand, type EditorHandle } from "./editorHandle.ts";

function recorder() {
  const calls: string[] = [];
  const handle: EditorHandle = {
    run: (command: EditorCommand) => calls.push(`run:${command.type}`),
    openFind: () => calls.push("openFind"),
    openReplace: () => calls.push("openReplace"),
  };
  return { calls, handle };
}

describe("editorCommands", () => {
  it("forwards every verb to the attached editor", () => {
    const { calls, handle } = recorder();
    const commands = editorCommands({ current: handle });

    commands.runEditorCommand({ type: "bulletList" });
    commands.openFind();
    commands.openReplace();

    assert.deepEqual(calls, ["run:bulletList", "openFind", "openReplace"]);
  });

  it("reports whether the editor was there to receive the command", () => {
    const { handle } = recorder();
    const ref: { current: EditorHandle | null } = { current: null };
    const commands = editorCommands(ref);

    assert.equal(commands.runEditorCommand({ type: "bold" }), false);
    assert.equal(commands.openFind(), false);
    assert.equal(commands.openReplace(), false);

    ref.current = handle;
    assert.equal(commands.runEditorCommand({ type: "bold" }), true);
  });

  it("resolves the ref at call time, not at build time", () => {
    // Menus are rebuilt every render and NoteEditor is keyed on the note id, so a
    // menu entry can outlive the editor it was built against. Reading `current`
    // late is what makes that safe.
    const first = recorder();
    const second = recorder();
    const ref: { current: EditorHandle | null } = { current: first.handle };
    const commands = editorCommands(ref);

    commands.runEditorCommand({ type: "italic" });
    ref.current = second.handle;
    commands.runEditorCommand({ type: "underline" });
    ref.current = null;
    commands.runEditorCommand({ type: "strike" });

    assert.deepEqual(first.calls, ["run:italic"]);
    assert.deepEqual(second.calls, ["run:underline"]);
  });

  it("passes command payloads through untouched", () => {
    const seen: EditorCommand[] = [];
    const commands = editorCommands({
      current: { run: (c) => seen.push(c), openFind: () => {}, openReplace: () => {} },
    });

    commands.runEditorCommand({ type: "heading", level: 2 });
    commands.runEditorCommand({ type: "replace", query: "a", replacement: "b", all: true });

    assert.deepEqual(seen, [
      { type: "heading", level: 2 },
      { type: "replace", query: "a", replacement: "b", all: true },
    ]);
  });
});

describe("App-to-editor channels", () => {
  const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
  const menuSource = readFileSync(new URL("./appMenus.ts", import.meta.url), "utf8");
  const editorSource = readFileSync(
    new URL("./components/NoteEditor.tsx", import.meta.url),
    "utf8"
  );

  // The old single-file UI-chrome helper module was split into
  // apps/desktop/src/ui/*.ts. Read every module in that directory (skipping
  // the *.test.ts files) so the guarantee below covers all of them, not just
  // whichever one happened to keep the name.
  const uiDir = new URL("./ui/", import.meta.url);
  const uiSources = readdirSync(uiDir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => [`ui/${name}`, readFileSync(new URL(name, uiDir), "utf8")] as const);

  it("drives the editor through one imperative handle", () => {
    assert.match(appSource, /editorRef=\{editorHandleRef\}/);
    assert.match(appSource, /editorCommands\(editorHandleRef\)/);
    assert.match(editorSource, /useImperativeHandle\(\s*editorRef,/);
  });

  it("has no global editor-command bus left to answer", () => {
    // A window-level bus is answered by every mounted editor, not just the active
    // one, and it types the payload only at the cast. Both are gone for good.
    for (const [name, source] of [
      ["App.tsx", appSource],
      ["appMenus.ts", menuSource],
      ["NoteEditor.tsx", editorSource],
      ...uiSources,
    ] as const) {
      assert.equal(source.includes("EDITOR_COMMAND_EVENT"), false, name);
      assert.equal(source.includes("dispatchEditorCommand"), false, name);
    }
  });

  it("has no find/replace tick counters left", () => {
    // Ticks encoded "do it now" as state. NoteEditor is keyed on the note id, so a
    // non-zero tick re-fired on every remount and popped the find bar open when
    // merely switching notes.
    for (const [name, source] of [
      ["App.tsx", appSource],
      ["appMenus.ts", menuSource],
      ["NoteEditor.tsx", editorSource],
    ] as const) {
      assert.equal(/findTick|replaceTick/.test(source), false, name);
    }
  });

  it("makes the menus ask their caller for the editor", () => {
    assert.equal(/^export function runEditorCommand/m.test(menuSource), false);
    assert.match(menuSource, /runEditorCommand: \(command: EditorCommand\) => void;/);
    assert.match(menuSource, /onSelect: \(\) => ctx\.openFind\(\)/);
    assert.match(menuSource, /onSelect: \(\) => ctx\.openReplace\(\)/);
  });
});
