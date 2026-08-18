import { Mark, mergeAttributes, Node } from "@tiptap/core";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    superscript: {
      toggleSuperscript: () => ReturnType;
    };
    subscript: {
      toggleSubscript: () => ReturnType;
    };
    callout: {
      setCallout: (kind?: "info" | "warning" | "tip") => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const Superscript = Mark.create({
  name: "superscript",
  excludes: "subscript",
  parseHTML() {
    return [{ tag: "sup" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sup", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      toggleSuperscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});

export const Subscript = Mark.create({
  name: "subscript",
  excludes: "superscript",
  parseHTML() {
    return [{ tag: "sub" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["sub", mergeAttributes(HTMLAttributes), 0];
  },
  addCommands() {
    return {
      toggleSubscript:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
    };
  },
});

export const CALLOUT_KINDS = ["info", "warning", "tip"] as const;
export type CalloutKind = (typeof CALLOUT_KINDS)[number];

export const Callout = Node.create({
  name: "callout",
  group: "block",
  content: "block+",
  defining: true,

  addAttributes() {
    return {
      kind: {
        default: "info",
        parseHTML: (element) => element.getAttribute("data-callout") || "info",
        renderHTML: (attributes) => ({ "data-callout": attributes.kind || "info" }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-callout]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes({ class: "notebook-callout" }, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setCallout:
        (kind = "info") =>
        ({ commands }) =>
          commands.wrapIn(this.name, { kind }),
      unsetCallout:
        () =>
        ({ commands }) =>
          commands.lift(this.name),
    };
  },
});
