import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

// Tiptap editability blocks typing but commands and node views can still
// dispatch document changes. Locking a note must cover those paths too.
export const ReadOnlyGuard = Extension.create({
  name: "readOnlyGuard",
  addProseMirrorPlugins() {
    return [new Plugin({
      filterTransaction: (transaction) =>
        !transaction.docChanged || this.editor.isEditable || transaction.getMeta("notebook:load-content") === true,
    })];
  },
});
