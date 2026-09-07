import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Renders the "Copy" affordance on code blocks as a ProseMirror widget
 * decoration.
 *
 * This used to be a plain `<button>` appended into each `<pre>` from a
 * MutationObserver watching the editor DOM. Everything inside the editor's
 * contentEditable belongs to ProseMirror, which reconciles foreign nodes back
 * out again - so the observer re-added the button, ProseMirror stripped it,
 * the removal was itself a mutation, and the two spun against each other at
 * 100% of a core for as long as a note containing a code block stayed open.
 * The renderer never became responsive again.
 *
 * A widget decoration is owned by ProseMirror: it is not part of the document,
 * it survives re-renders, and there is nothing for the two to fight over.
 */

const COPY_RESET_MS = 1200;

function createCopyButton(getText: () => string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "code-copy-btn";
  button.textContent = "Copy";
  // Widgets sit inside contentEditable; without this the caret can land in it.
  button.contentEditable = "false";
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    void navigator.clipboard.writeText(getText()).then(() => {
      button.textContent = "Copied";
      window.setTimeout(() => {
        button.textContent = "Copy";
      }, COPY_RESET_MS);
    });
  });
  return button;
}

export const CodeCopyButton = Extension.create({
  name: "codeCopyButton",

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("codeCopyButton"),
        props: {
          decorations(state) {
            const decorations: Decoration[] = [];
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "codeBlock") return;
              // The text comes from the document, not from `pre.textContent`,
              // so the button's own label can never end up in the clipboard -
              // the old implementation had to strip a trailing "Copy".
              const text = node.textContent;
              decorations.push(
                Decoration.widget(pos + 1, () => createCopyButton(() => text), {
                  side: -1,
                  ignoreSelection: true,
                })
              );
              return false;
            });
            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
