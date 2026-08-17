import { Node, mergeAttributes } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import type { Attachment } from "../api";

const ATTACHMENT_HREF =
  /(?:notebook-attachment:\/\/|\/(?:api\/v1\/)?attachments\/)([0-9a-f-]{36})/i;

export const USE_FILE_AS_TITLE = "notebook:use-file-as-title";

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

export function formatFileSize(bytes: number | null | undefined) {
  if (bytes == null || Number.isNaN(bytes)) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function titleFromFilename(filename: string) {
  return filename.replace(/\.[^.]+$/, "").trim() || filename;
}

export function fileAttachmentNode(
  attachment: Attachment,
  href: string,
  expanded = true
): JSONContent {
  return {
    type: "fileAttachment",
    attrs: {
      href,
      filename: attachment.filename,
      mime: attachment.mime_type,
      size: attachment.size ?? null,
      expanded,
    },
  };
}

function boolAttr(value: unknown, fallback: boolean) {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return fallback;
}

function openHref(href: string) {
  window.open(href, "_blank", "noopener,noreferrer");
}

function closeOpenMenus() {
  document.querySelectorAll(".notebook-file-menu.is-open").forEach((menu) => {
    menu.classList.remove("is-open");
  });
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
      size: { default: null },
      expanded: {
        default: true,
        parseHTML: (el) => el.getAttribute("data-expanded") !== "false",
        renderHTML: (attrs) => ({
          "data-expanded": attrs.expanded === false ? "false" : "true",
        }),
      },
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
          const filename =
            el.getAttribute("data-filename") ||
            link?.textContent?.replace(/^📎\s*/, "").trim() ||
            "attachment";
          const sizeValue = el.getAttribute("data-size");
          return {
            href,
            filename,
            mime: el.getAttribute("data-mime") || "application/octet-stream",
            size: sizeValue ? Number(sizeValue) : null,
            expanded: boolAttr(el.getAttribute("data-expanded"), true),
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
            size: null,
            expanded: true,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const href = String(HTMLAttributes.href || "");
    const filename = String(HTMLAttributes.filename || "attachment");
    const mime = String(HTMLAttributes.mime || "application/octet-stream");
    const expanded = HTMLAttributes.expanded !== false;
    const size = HTMLAttributes.size;
    return [
      "div",
      mergeAttributes({
        "data-notebook-file": "true",
        "data-href": href,
        "data-filename": filename,
        "data-mime": mime,
        "data-expanded": expanded ? "true" : "false",
        ...(size != null ? { "data-size": String(size) } : {}),
        class: [
          "notebook-file",
          isPdfFile(mime, filename) ? "is-pdf" : "",
          expanded ? "is-expanded" : "is-title",
        ]
          .filter(Boolean)
          .join(" "),
      }),
      ["a", { href, target: "_blank", rel: "noopener noreferrer" }, filename],
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let current = node;
      const dom = document.createElement("div");
      const bar = document.createElement("div");
      const badge = document.createElement("div");
      const meta = document.createElement("div");
      const name = document.createElement("div");
      const details = document.createElement("div");
      const actions = document.createElement("div");
      const expandBtn = document.createElement("button");
      const moreBtn = document.createElement("button");
      const menu = document.createElement("div");
      const preview = document.createElement("div");
      const frame = document.createElement("iframe");

      bar.className = "notebook-file-bar";
      badge.className = "notebook-file-badge";
      meta.className = "notebook-file-meta";
      name.className = "notebook-file-name";
      details.className = "notebook-file-details";
      actions.className = "notebook-file-actions";
      expandBtn.type = "button";
      expandBtn.className = "notebook-file-expand";
      moreBtn.type = "button";
      moreBtn.className = "notebook-file-more";
      moreBtn.setAttribute("aria-label", "PDF actions");
      moreBtn.textContent = "⋯";
      menu.className = "notebook-file-menu";
      preview.className = "notebook-file-preview";
      frame.className = "notebook-pdf-frame";

      meta.append(name, details);
      actions.append(expandBtn, moreBtn, menu);
      bar.append(badge, meta, actions);
      preview.append(frame);
      dom.append(bar, preview);

      const stop = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
      };

      const setAttrs = (patch: Record<string, unknown>) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        editor
          .chain()
          .command(({ tr }) => {
            tr.setNodeMarkup(pos, undefined, { ...current.attrs, ...patch });
            return true;
          })
          .run();
      };

      const renderMenu = (pdf: boolean, expanded: boolean) => {
        menu.innerHTML = "";
        const items: { label: string; checked?: boolean; action: () => void }[] = [];
        if (pdf) {
          items.push(
            {
              label: "View as title",
              checked: !expanded,
              action: () => setAttrs({ expanded: false }),
            },
            {
              label: "Expand",
              checked: expanded,
              action: () => setAttrs({ expanded: true }),
            }
          );
        }
        items.push({
          label: "Open",
          action: () => {
            const href = String(current.attrs.href || "");
            if (href) openHref(href);
          },
        });
        items.push({
          label: "Use as note title",
          action: () => {
            dom.dispatchEvent(
              new CustomEvent(USE_FILE_AS_TITLE, {
                bubbles: true,
                detail: { filename: String(current.attrs.filename || "") },
              })
            );
          },
        });
        items.forEach((item) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "notebook-file-menu-item";
          button.textContent = item.checked ? `✓ ${item.label}` : item.label;
          button.addEventListener("mousedown", stop);
          button.addEventListener("click", (event) => {
            stop(event);
            closeOpenMenus();
            item.action();
          });
          menu.append(button);
        });
      };

      const paint = () => {
        const href = String(current.attrs.href || "");
        const filename = String(current.attrs.filename || "attachment");
        const mime = String(current.attrs.mime || "application/octet-stream");
        const size = current.attrs.size as number | null;
        const pdf = isPdfFile(mime, filename);
        const expanded = pdf && current.attrs.expanded !== false;
        const kind = pdf ? "PDF" : "FILE";
        const sizeLabel = formatFileSize(size);

        dom.className = [
          "notebook-file",
          pdf ? "is-pdf" : "",
          expanded ? "is-expanded" : "is-title",
        ]
          .filter(Boolean)
          .join(" ");
        dom.setAttribute("data-notebook-file", "true");
        dom.setAttribute("data-href", href);
        dom.setAttribute("data-filename", filename);
        dom.setAttribute("data-mime", mime);
        dom.setAttribute("data-expanded", expanded ? "true" : "false");
        if (size != null) dom.setAttribute("data-size", String(size));

        badge.textContent = kind;
        name.textContent = filename;
        details.textContent = sizeLabel ? `${kind} · ${sizeLabel}` : kind;
        expandBtn.hidden = !pdf;
        expandBtn.setAttribute(
          "aria-label",
          expanded ? "View as title" : "Expand PDF"
        );
        expandBtn.textContent = expanded ? "▾" : "▸";
        frame.title = filename;
        if (expanded && href && frame.src !== href) frame.src = href;
        preview.hidden = !expanded;
        renderMenu(pdf, expanded);
      };

      expandBtn.addEventListener("mousedown", stop);
      moreBtn.addEventListener("mousedown", stop);
      menu.addEventListener("mousedown", stop);
      bar.addEventListener("mousedown", (event) => {
        if (event.button !== 0) return;
        stop(event);
      });
      expandBtn.addEventListener("click", (event) => {
        stop(event);
        setAttrs({ expanded: current.attrs.expanded === false });
      });
      moreBtn.addEventListener("click", (event) => {
        stop(event);
        const open = menu.classList.contains("is-open");
        closeOpenMenus();
        if (!open) menu.classList.add("is-open");
      });
      bar.addEventListener("click", (event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest(".notebook-file-actions")) return;
        if (!isPdfFile(String(current.attrs.mime || ""), String(current.attrs.filename || ""))) {
          const href = String(current.attrs.href || "");
          if (href) openHref(href);
          return;
        }
        setAttrs({ expanded: current.attrs.expanded === false });
      });
      bar.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeOpenMenus();
        menu.classList.add("is-open");
      });
      name.addEventListener("dblclick", (event) => {
        stop(event);
        dom.dispatchEvent(
          new CustomEvent(USE_FILE_AS_TITLE, {
            bubbles: true,
            detail: { filename: String(current.attrs.filename || "") },
          })
        );
      });

      paint();

      return {
        dom,
        ignoreMutation: () => true,
        update(updated) {
          if (updated.type.name !== "fileAttachment") return false;
          current = updated;
          paint();
          return true;
        },
        destroy() {
          menu.classList.remove("is-open");
        },
      };
    };
  },
});
