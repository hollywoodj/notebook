import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

/**
 * Evernote-style collapsible headings.
 *
 * Evernote's ENEX export marks a collapsed section as
 * `<h1 style="--en-isCollapsed:true; --en-nodeId:...;">` and simply omits
 * nothing from the document - the hiding is a pure rendering decision, not a
 * change to what's stored. TipTap's heading node had no attribute for this at
 * all, so on import the unknown `style` was dropped by the schema and the
 * first save after opening the note wiped the marker for good.
 *
 * This extension adds a `collapsed` attribute to the heading node (persisted
 * as `data-collapsed="true"`) and renders the hide/reveal behavior entirely
 * through ProseMirror decorations, the same pattern codeCopyButton.ts uses for
 * its "Copy" button: decorations are owned by ProseMirror, so there is
 * nothing for a MutationObserver or React re-render to fight over, and
 * read-only notes keep honoring the collapsed state without being able to
 * toggle it (ReadOnlyGuard filters the transaction; here we simply don't
 * render a control to dispatch one).
 */

export type BlockOutline = { isHeading: boolean; level: number; collapsed: boolean };

// Shared scan: for the heading at `index`, find the exclusive end index of the
// range it would hide (the index of the next heading at <= its own level, or
// blocks.length if none). Non-headings never hide anything.
function hiddenRangeEnd(blocks: BlockOutline[], index: number): number {
  const heading = blocks[index];
  if (!heading.isHeading) return index;
  let end = blocks.length;
  for (let i = index + 1; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.isHeading && block.level <= heading.level) {
      end = i;
      break;
    }
  }
  return end;
}

export function hiddenBlockIndexes(blocks: BlockOutline[]): Set<number> {
  const hidden = new Set<number>();
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (!block.isHeading || !block.collapsed || hidden.has(i)) continue;
    const end = hiddenRangeEnd(blocks, i);
    for (let j = i + 1; j < end; j++) hidden.add(j);
  }
  return hidden;
}

export function hidesAnything(blocks: BlockOutline[], index: number): boolean {
  return hiddenRangeEnd(blocks, index) > index + 1;
}

function createToggle(collapsed: boolean, onToggle: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "heading-collapse-toggle";
  // Widgets sit inside contentEditable; without this the caret can land in it.
  button.contentEditable = "false";
  button.setAttribute("aria-expanded", String(!collapsed));
  const label = collapsed ? "Expand section" : "Collapse section";
  button.setAttribute("aria-label", label);
  button.title = label;
  button.textContent = "▸"; // ▸ - rotated via CSS when expanded
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggle();
  });
  return button;
}

export const CollapsibleHeading = Extension.create({
  name: "collapsibleHeading",

  addGlobalAttributes() {
    return [
      {
        types: ["heading"],
        attributes: {
          collapsed: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element) =>
              element.getAttribute("data-collapsed") === "true" ||
              // Recovers notes imported from Evernote that haven't been
              // opened (and re-saved) since the importer started emitting
              // data-collapsed directly - the legacy private CSS property
              // still round-trips through old rows in the DB.
              /--en-iscollapsed:\s*true/i.test(element.getAttribute("style") ?? ""),
            renderHTML: (attrs) => (attrs.collapsed ? { "data-collapsed": "true" } : {}),
          },
        },
      },
    ];
  },

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey("collapsibleHeading"),
        props: {
          decorations(state) {
            const blocks: BlockOutline[] = [];
            const positions: { pos: number; size: number }[] = [];
            state.doc.forEach((node, offset) => {
              blocks.push({
                isHeading: node.type.name === "heading",
                level: node.type.name === "heading" ? (node.attrs.level as number) : 0,
                collapsed: node.attrs.collapsed === true,
              });
              positions.push({ pos: offset, size: node.nodeSize });
            });

            const decorations: Decoration[] = [];

            for (const index of hiddenBlockIndexes(blocks)) {
              const { pos, size } = positions[index];
              decorations.push(Decoration.node(pos, pos + size, { class: "collapsed-hidden" }));
            }

            blocks.forEach((block, index) => {
              if (!block.isHeading || !hidesAnything(blocks, index)) return;
              const { pos, size } = positions[index];
              const collapsed = block.collapsed;
              decorations.push(
                Decoration.node(pos, pos + size, {
                  class: collapsed ? "heading-collapsible is-collapsed" : "heading-collapsible",
                })
              );
              if (editor.isEditable) {
                decorations.push(
                  Decoration.widget(
                    pos + 1,
                    (view) =>
                      createToggle(collapsed, () => {
                        const node = view.state.doc.nodeAt(pos);
                        if (!node || node.type.name !== "heading") return;
                        view.dispatch(
                          view.state.tr.setNodeMarkup(pos, undefined, {
                            ...node.attrs,
                            collapsed: !node.attrs.collapsed,
                          })
                        );
                      }),
                    { side: -1, ignoreSelection: true }
                  )
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
