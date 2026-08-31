/**
 * The single typed channel from App down into the note editor.
 *
 * Everything App needs to *tell* the editor to do goes through `EditorHandle`;
 * everything App needs the editor to *know* stays an ordinary prop. There used
 * to be two more channels - `findTick`/`replaceTick` counters that encoded
 * "do it now" as state, and a `window` CustomEvent bus that any editor instance
 * on the page would answer. Both are gone; do not reintroduce either.
 */

export type EditorCommand =
  | { type: "undo" | "redo" | "cut" | "copy" | "paste" | "pastePlain" | "selectAll" }
  | { type: "bold" | "italic" | "underline" | "strike" | "clear" }
  | { type: "highlight"; color?: string }
  | { type: "color"; color?: string }
  | { type: "horizontalRule" | "insertDate" | "insertTable" }
  | { type: "heading"; level: 1 | 2 | 3 }
  | { type: "bulletList" | "orderedList" | "taskList" | "blockquote" | "codeBlock" | "inlineCode" | "inlineCheckbox" }
  | { type: "align"; align: "left" | "center" | "right" | "justify" }
  | { type: "indent" | "outdent" }
  | { type: "link"; href?: string; text?: string }
  | { type: "openLinkDialog" }
  | { type: "fontFamily"; family?: string }
  | { type: "fontSize"; size?: string }
  | {
      type: "tableAction";
      action: "insert" | "addRow" | "addColumn" | "deleteRow" | "deleteColumn" | "deleteTable";
    }
  | { type: "superscript" | "subscript" }
  | { type: "callout"; kind?: "info" | "warning" | "tip" }
  | { type: "replace"; query: string; replacement: string; all?: boolean }
  | { type: "fontSizeStep"; direction: 1 | -1 }
  | { type: "findNext" | "findPrev" }
  | { type: "imageSize"; width?: string }
  | { type: "imageCaption"; title?: string }
  | { type: "imageAlign"; align: "left" | "center" | "right" }
  | { type: "tasks"; action: "checkAll" | "uncheckAll" }
  | { type: "unlink" }
  | { type: "insertToc" }
  | { type: "insertTime" }
  | { type: "insertDateTime" }
  | { type: "unsetColor" };

export type EditorHandle = {
  /** Apply a formatting/editing command to the live document. No-op until the editor mounts. */
  run(command: EditorCommand): void;
  /** Reveal the find bar and select whatever is already in it. */
  openFind(): void;
  /** Reveal the find bar with the replace row expanded. */
  openReplace(): void;
};

/**
 * The App-side view of the handle: three stable callbacks that read the ref at
 * call time. Menus are rebuilt every render and `NoteEditor` is keyed on the note
 * id, so the ref is empty between a note closing and the next one mounting -
 * resolving late is what keeps a menu entry built before the swap from firing at
 * a dead editor. Returns whether the editor was there to receive it.
 */
export function editorCommands(ref: { current: EditorHandle | null }) {
  const send = (action: (editor: EditorHandle) => void) => {
    const editor = ref.current;
    if (!editor) return false;
    action(editor);
    return true;
  };
  return {
    runEditorCommand: (command: EditorCommand) => send((editor) => editor.run(command)),
    openFind: () => send((editor) => editor.openFind()),
    openReplace: () => send((editor) => editor.openReplace()),
  };
}
