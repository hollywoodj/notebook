import { InputRule, mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineCheckbox: {
      insertInlineCheckbox: (checked?: boolean) => ReturnType;
    };
  }
}

export function checkboxShortcutKind(
  token: string
): "checked" | "unchecked" | null {
  const cleaned = token.trim().toLowerCase();
  if (cleaned === "[]" || cleaned === "[ ]") return "unchecked";
  if (cleaned === "[x]") return "checked";
  return null;
}

export const InlineCheckbox = Node.create({
  name: "inlineCheckbox",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      checked: {
        default: false,
        parseHTML: (element) =>
          element.getAttribute("data-checked") === "true" ||
          (element instanceof HTMLInputElement && element.checked),
        renderHTML: (attributes) => ({
          "data-checked": attributes.checked ? "true" : "false",
        }),
      },
    };
  },

  parseHTML() {
    return [
      { tag: "input[type='checkbox'][data-inline-checkbox]" },
      { tag: "span[data-inline-checkbox]" },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const checked = Boolean(HTMLAttributes.checked) || HTMLAttributes["data-checked"] === "true";
    return [
      "input",
      mergeAttributes(HTMLAttributes, {
        type: "checkbox",
        "data-inline-checkbox": "true",
        ...(checked ? { checked: "checked" } : {}),
      }),
    ];
  },

  addCommands() {
    return {
      insertInlineCheckbox:
        (checked = false) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { checked },
          }),
    };
  },

  addInputRules() {
    return [
      new InputRule({
        find: /(?<=\S )\[([ xX]?)\] $/,
        handler: ({ range, match, chain }) => {
          const checked = match[1].toLowerCase() === "x";
          chain()
            .deleteRange(range)
            .insertContent({ type: this.name, attrs: { checked } })
            .run();
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.inlineCheckbox = "true";
      input.checked = Boolean(node.attrs.checked);
      input.title = "Checkbox";
      input.addEventListener("mousedown", (event) => event.preventDefault());
      input.addEventListener("change", () => {
        if (typeof getPos !== "function") return;
        editor
          .chain()
          .command(({ tr }) => {
            const position = getPos();
            if (typeof position !== "number") return false;
            tr.setNodeMarkup(position, undefined, { checked: input.checked });
            return true;
          })
          .run();
      });
      return {
        dom: input,
        update: (updated) => {
          if (updated.type.name !== this.name) return false;
          input.checked = Boolean(updated.attrs.checked);
          return true;
        },
      };
    };
  },
});
