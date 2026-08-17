import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Attachment } from "../api";

const ATTACHMENT_HREF =
  /(?:notebook-attachment:\/\/|\/(?:api\/v1\/)?attachments\/)([0-9a-f-]{36})/i;

export function isPdfFile(mime: string, filename: string) {
  return (
    mime.toLowerCase() === "application/pdf" ||
    mime.toLowerCase() === "application/x-pdf" ||
    filename.toLowerCase().endsWith(".pdf")
  );
}

export function isFileAttachment(attachment: Attachment) {
  if (isPdfFile(attachment.mime_type, attachment.filename)) return true;
  return !attachment.mime_type.toLowerCase().startsWith("image/");
}

export function attachmentIdFromHref(href: string | null | undefined) {
  if (!href) return null;
  return href.match(ATTACHMENT_HREF)?.[1] ?? null;
}

export function contentReferencesAttachment(html: string, id: string) {
  return html.toLowerCase().includes(id.toLowerCase());
}

export function fileAttachmentNode(attachment: Attachment, href: string): JSONContent {
  return {
    type: "fileAttachment",
    attrs: {
      href,
      filename: attachment.filename,
      mime: attachment.mime_type,
    },
  };
}

function openHref(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

export const FileAttachment = Node.create({
  name: "fileAttachment",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  priority: 1200,

  addAttributes() {
    return {
      href: { default: null },
      filename: { default: "attachment" },
      mime: { default: "application/octet-stream" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "div[data-notebook-file]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const link = el.querySelector("a");
          const href =
            el.getAttribute("data-href") || link?.getAttribute("href") || "";
          if (!attachmentIdFromHref(href) && !href) return false;
          return {
            href,
            filename:
              el.getAttribute("data-filename") ||
              link?.textContent?.replace(/^📎\s*/, "").trim() ||
              "attachment",
            mime: el.getAttribute("data-mime") || "application/octet-stream",
          };
        },
      },
      {
        tag: "a[href]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const href = el.getAttribute("href") || "";
          if (!attachmentIdFromHref(href)) return false;
          const filename =
            el.textContent?.replace(/^📎\s*/, "").trim() || "attachment";
          return {
            href,
            filename,
            mime: isPdfFile("", filename)
              ? "application/pdf"
              : "application/octet-stream",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const href = String(HTMLAttributes.href || "");
    const filename = String(HTMLAttributes.filename || "attachment");
    const mime = String(HTMLAttributes.mime || "application/octet-stream");
    return [
      "div",
      mergeAttributes({
        "data-notebook-file": "true",
        "data-href": href,
        "data-filename": filename,
        "data-mime": mime,
        class: isPdfFile(mime, filename)
          ? "notebook-file is-pdf"
          : "notebook-file",
      }),
      ["a", { href, target: "_blank", rel: "noopener noreferrer" }, filename],
    ];
  },

  addNodeView() {
    return ({ node }) => {
      const href = String(node.attrs.href || "");
      const filename = String(node.attrs.filename || "attachment");
      const mime = String(node.attrs.mime || "application/octet-stream");
      const pdf = isPdfFile(mime, filename);

      const dom = document.createElement("div");
      dom.className = pdf ? "notebook-file is-pdf" : "notebook-file";
      dom.setAttribute("data-notebook-file", "true");
      dom.setAttribute("data-href", href);
      dom.setAttribute("data-filename", filename);
      dom.setAttribute("data-mime", mime);

      const bar = document.createElement("div");
      bar.className = "notebook-file-bar";

      const icon = document.createElement("span");
      icon.className = "notebook-file-icon";
      icon.textContent = pdf ? "PDF" : "FILE";

      const name = document.createElement("span");
      name.className = "notebook-file-name";
      name.textContent = filename;

      const open = document.createElement("button");
      open.type = "button";
      open.className = "notebook-file-open";
      open.textContent = "Open";
      open.addEventListener("mousedown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      open.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (href) openHref(href);
      });

      bar.append(icon, name, open);
      dom.append(bar);

      if (pdf && href) {
        const frame = document.createElement("iframe");
        frame.className = "notebook-pdf-frame";
        frame.title = filename;
        frame.src = href;
        dom.append(frame);
      }

      return {
        dom,
        ignoreMutation: () => true,
      };
    };
  },
});
