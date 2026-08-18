import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TextAlign from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import { TextStyle } from "@tiptap/extension-text-style";
import type { Editor } from "@tiptap/core";
import type { JSONContent } from "@tiptap/core";
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, Attachment, attachmentUrl } from "../api";
import { Icon } from "./Icons";
import {
  EDITOR_COMMAND_EVENT,
  EDITOR_FONTS,
  EDITOR_FONT_SIZES,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
  attachmentsLabel,
  escapeHtml,
  findMatchOffsets,
  formattingToolbarVisible,
  nextMatchIndex,
  visibleToolbarCount,
  type EditorCommand,
} from "../uiChrome";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { LinkDialog } from "./LinkDialog";
import { FontFamily, FontSize } from "./fontMarks";
import {
  FileAttachment,
  USE_FILE_AS_TITLE,
  contentReferencesAttachment,
  fileAttachmentNode,
  formatFileSize,
  isFileAttachment,
  isPdfFile,
  titleFromFilename,
} from "./fileAttachment";
import { InlineCheckbox } from "./inlineCheckbox";

interface Props {
  noteId: string;
  content: string;
  onChange: (html: string) => void;
  onAttach: (file: File) => Promise<Attachment>;
  spellCheck: boolean;
  fontFamily: "default" | "serif" | "mono";
  fontSize: number;
  noteWidth: "readable" | "full";
  pdfView?: "expanded" | "title";
  placeholder?: string;
  onUseAsTitle?: (filename: string) => void;
  findTick?: number;
  replaceTick?: number;
  toolbarHidden?: boolean;
  attachmentsExpanded?: boolean;
  onAttachmentsExpandedChange?: (expanded: boolean) => void;
  zoom?: number;
  onOpenNoteLink?: (noteId: string) => void;
}

function formatSize(bytes: number) {
  return formatFileSize(bytes);
}

function applyIndent(editor: Editor, direction: 1 | -1) {
  if (direction === 1) {
    if (editor.can().sinkListItem("listItem")) {
      editor.chain().focus().sinkListItem("listItem").run();
      return;
    }
    if (editor.can().sinkListItem("taskItem")) {
      editor.chain().focus().sinkListItem("taskItem").run();
      return;
    }
    editor.chain().focus().insertContent("\t").run();
    return;
  }
  if (editor.can().liftListItem("listItem")) {
    editor.chain().focus().liftListItem("listItem").run();
    return;
  }
  if (editor.can().liftListItem("taskItem")) {
    editor.chain().focus().liftListItem("taskItem").run();
  }
}

function openLinkDialog(editor: Editor) {
  const href = String(editor.getAttributes("link").href || "");
  const { from, to } = editor.state.selection;
  const text = editor.state.doc.textBetween(from, to, "");
  return { href, text };
}

function textOffsetToPos(
  doc: {
    descendants: (
      fn: (node: { isText?: boolean; text?: string }, pos: number) => boolean | void
    ) => void;
  },
  offset: number
) {
  let remaining = offset;
  let found = 1;
  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    if (remaining <= node.text.length) {
      found = pos + remaining;
      return false;
    }
    remaining -= node.text.length;
  });
  return found;
}

export function NoteEditor({
  noteId,
  content,
  onChange,
  onAttach,
  spellCheck,
  fontFamily,
  fontSize,
  noteWidth,
  pdfView = "expanded",
  placeholder = "Start writing, or pick a template…",
  onUseAsTitle,
  findTick = 0,
  replaceTick = 0,
  toolbarHidden = false,
  attachmentsExpanded = false,
  onAttachmentsExpandedChange,
  zoom = 100,
  onOpenNoteLink,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queueFilesRef = useRef<(files: File[], position?: number) => void>(() => {});
  const findInputRef = useRef<HTMLInputElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [showTextColors, setShowTextColors] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number } | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ href: string; text: string } | null>(null);
  const indentRef = useRef<(shift: boolean) => boolean>(() => false);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editorFocused, setEditorFocused] = useState(false);
  const restoredFilesRef = useRef(false);
  const pdfViewRef = useRef(pdfView);
  pdfViewRef.current = pdfView;
  const onUseAsTitleRef = useRef(onUseAsTitle);
  onUseAsTitleRef.current = onUseAsTitle;

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      InlineCheckbox,
      Placeholder.configure({ placeholder }),
      Image.configure({ allowBase64: true }),
      FileAttachment,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      FontFamily,
      FontSize,
    ],
    content,
    autofocus: false,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    onFocus: () => setEditorFocused(true),
    onBlur: ({ editor: current, event }) => {
      const related = (event as FocusEvent | undefined)?.relatedTarget as Node | null;
      if (related && toolbarRef.current?.contains(related)) return;
      queueMicrotask(() => {
        if (current.view.hasFocus()) return;
        if (toolbarRef.current?.contains(document.activeElement)) return;
        setEditorFocused(false);
        setShowColors(false);
        setShowTextColors(false);
        setShowOverflow(false);
      });
    },
    editorProps: {
      attributes: {
        class: "note-editor-content",
        spellcheck: spellCheck ? "true" : "false",
      },
      handleKeyDown: (_view, event) => {
        if (event.key !== "Tab") return false;
        return indentRef.current(event.shiftKey);
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        queueFilesRef.current(files);
        return true;
      },
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement | null;
        const href = target?.closest("a")?.getAttribute("href");
        if (!href) return false;
        if (
          href.includes("/attachments/") ||
          href.startsWith("notebook-attachment://")
        ) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
          return true;
        }
        const noteLink = href.match(/^notebook:\/\/note\/([0-9a-f-]{36})$/i);
        if (noteLink) {
          event.preventDefault();
          onOpenNoteLink?.(noteLink[1]);
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    restoredFilesRef.current = false;
    setAttachments([]);
  }, [noteId]);

  useEffect(() => {
    let cancelled = false;
    api
      .listAttachments(noteId)
      .then((items) => {
        if (!cancelled) setAttachments(items);
      })
      .catch(() => {
        if (!cancelled) setAttachments([]);
      });
    return () => {
      cancelled = true;
    };
  }, [noteId, uploading]);

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        ...editor.options.editorProps,
        attributes: {
          ...editor.options.editorProps.attributes,
          class: "note-editor-content",
          spellcheck: spellCheck ? "true" : "false",
        },
      },
    });
  }, [spellCheck, editor]);

  useEffect(() => {
    if (!editor || restoredFilesRef.current) return;
    const missing = attachments.filter(
      (item) =>
        isFileAttachment(item) &&
        !contentReferencesAttachment(editor.getHTML(), item.id)
    );
    if (!missing.length) {
      if (attachments.length) restoredFilesRef.current = true;
      return;
    }
    restoredFilesRef.current = true;
    const expanded = pdfViewRef.current !== "title";
    const nodes: JSONContent[] = missing.map((item) =>
      fileAttachmentNode(item, attachmentUrl(item.id), expanded)
    );
    nodes.push({ type: "paragraph" });
    editor.chain().insertContentAt(editor.state.doc.content.size, nodes).run();
  }, [attachments, editor]);

  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const onUseTitle = (event: Event) => {
      const filename = (event as CustomEvent<{ filename?: string }>).detail?.filename;
      if (filename) onUseAsTitleRef.current?.(titleFromFilename(filename));
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".notebook-file-menu, .notebook-file-more")) return;
      document.querySelectorAll(".notebook-file-menu.is-open").forEach((menu) => {
        menu.classList.remove("is-open");
      });
    };
    root.addEventListener(USE_FILE_AS_TITLE, onUseTitle);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      root.removeEventListener(USE_FILE_AS_TITLE, onUseTitle);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [editor]);

  useEffect(() => {
    if (!findTick) return;
    setShowFind(true);
    window.setTimeout(() => findInputRef.current?.select(), 0);
  }, [findTick]);

  useEffect(() => {
    if (!replaceTick) return;
    setShowFind(true);
    setShowReplace(true);
    window.setTimeout(() => findInputRef.current?.select(), 0);
  }, [replaceTick]);

  useEffect(() => {
    if (!editor || !showFind) return;
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "", "");
    const offsets = findMatchOffsets(text, findQuery);
    setFindCount(offsets.length);
    if (!offsets.length) {
      setFindIndex(0);
      return;
    }
    const index = Math.min(findIndex, offsets.length - 1);
    if (index !== findIndex) setFindIndex(index);
    const from = textOffsetToPos(editor.state.doc, offsets[index]);
    const to = from + findQuery.trim().length;
    editor.commands.setTextSelection({ from, to });
    editor.commands.scrollIntoView();
  }, [editor, findQuery, findIndex, showFind]);

  const replaceCurrent = () => {
    if (!editor || !findQuery.trim()) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "");
    if (selected.toLowerCase() !== findQuery.trim().toLowerCase()) return;
    editor.chain().focus().insertContent(replaceQuery).run();
    setFindIndex((current) => current);
  };

  const replaceAll = () => {
    if (!editor || !findQuery.trim()) return;
    const needle = findQuery.trim();
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "", "");
    const offsets = findMatchOffsets(text, needle);
    for (let i = offsets.length - 1; i >= 0; i--) {
      const from = textOffsetToPos(editor.state.doc, offsets[i]);
      const to = from + needle.length;
      editor.commands.insertContentAt({ from, to }, replaceQuery);
    }
  };

  useEffect(() => {
    if (!editor) return;
    const onCommand = (event: Event) => {
      const command = (event as CustomEvent<EditorCommand>).detail;
      if (!command) return;
      const chain = editor.chain().focus();
      switch (command.type) {
        case "undo":
          chain.undo().run();
          break;
        case "redo":
          chain.redo().run();
          break;
        case "cut":
          document.execCommand("cut");
          break;
        case "copy":
          document.execCommand("copy");
          break;
        case "paste":
          document.execCommand("paste");
          break;
        case "selectAll":
          chain.selectAll().run();
          break;
        case "bold":
          chain.toggleBold().run();
          break;
        case "italic":
          chain.toggleItalic().run();
          break;
        case "underline":
          chain.toggleUnderline().run();
          break;
        case "strike":
          chain.toggleStrike().run();
          break;
        case "clear":
          chain.unsetAllMarks().clearNodes().run();
          break;
        case "highlight":
          if (command.color) chain.toggleHighlight({ color: command.color }).run();
          else chain.unsetHighlight().run();
          break;
        case "color":
          if (command.color) chain.setColor(command.color).run();
          else chain.unsetColor().run();
          break;
        case "horizontalRule":
          chain.setHorizontalRule().run();
          break;
        case "insertDate":
          chain.insertContent(new Date().toLocaleString()).run();
          break;
        case "insertTable":
          chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          break;
        case "heading":
          chain.toggleHeading({ level: command.level }).run();
          break;
        case "bulletList":
          chain.toggleBulletList().run();
          break;
        case "orderedList":
          chain.toggleOrderedList().run();
          break;
        case "taskList":
          chain.toggleTaskList().run();
          break;
        case "inlineCheckbox":
          chain.insertInlineCheckbox(false).run();
          break;
        case "blockquote":
          chain.toggleBlockquote().run();
          break;
        case "codeBlock":
          chain.toggleCodeBlock().run();
          break;
        case "inlineCode":
          chain.toggleCode().run();
          break;
        case "align":
          chain.setTextAlign(command.align).run();
          break;
        case "indent":
          applyIndent(editor, 1);
          break;
        case "outdent":
          applyIndent(editor, -1);
          break;
        case "openLinkDialog":
          setLinkDialog(openLinkDialog(editor));
          break;
        case "fontFamily":
          if (command.family) chain.setFontFamily(command.family).run();
          else chain.unsetFontFamily().run();
          break;
        case "fontSize":
          if (command.size) chain.setFontSize(command.size).run();
          else chain.unsetFontSize().run();
          break;
        case "tableAction":
          if (command.action === "insert") {
            chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
          } else if (command.action === "addRow") {
            chain.addRowAfter().run();
          } else if (command.action === "addColumn") {
            chain.addColumnAfter().run();
          } else if (command.action === "deleteRow") {
            chain.deleteRow().run();
          } else if (command.action === "deleteColumn") {
            chain.deleteColumn().run();
          } else {
            chain.deleteTable().run();
          }
          break;
        case "link": {
          if (!command.href) {
            setLinkDialog(openLinkDialog(editor));
            break;
          }
          if (command.text) {
            chain
              .insertContent(
                `<a href="${escapeHtml(command.href)}">${escapeHtml(command.text)}</a>`
              )
              .run();
          } else {
            chain.setLink({ href: command.href }).run();
          }
          break;
        }
        case "replace":
          if (command.all) replaceAll();
          else replaceCurrent();
          break;
      }
    };
    window.addEventListener(EDITOR_COMMAND_EVENT, onCommand);
    return () => window.removeEventListener(EDITOR_COMMAND_EVENT, onCommand);
  }, [editor, findQuery, replaceQuery]);

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el || !editor || !formattingToolbarVisible(toolbarHidden, editorFocused)) return;
    const measure = () => {
      const items = [...el.querySelectorAll<HTMLElement>("[data-toolbar-item]")];
      const overflowBtn = el.querySelector<HTMLElement>(".toolbar-overflow");
      const available = el.clientWidth - 12;
      const widths = items.map((item) => {
        const hidden = item.classList.contains("is-overflowed");
        if (!hidden) return item.getBoundingClientRect().width + 2;
        const previous = item.style.display;
        item.style.display = "inline-flex";
        const width = item.getBoundingClientRect().width + 2;
        item.style.display = previous;
        return width;
      });
      const visible = visibleToolbarCount(
        available,
        widths,
        overflowBtn?.getBoundingClientRect().width || 34
      );
      const hiddenIds = items.slice(visible).map((item) => item.dataset.toolbarItem || "");
      setOverflowIds((current) => {
        const next = hiddenIds.filter(Boolean);
        if (current.length === next.length && current.every((id, index) => id === next[index])) {
          return current;
        }
        return next;
      });
    };
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, [editor, toolbarHidden, editorFocused]);

  if (!editor) return null;

  indentRef.current = (shift) => {
    if (editor.isActive("table")) return false;
    applyIndent(editor, shift ? -1 : 1);
    return true;
  };

  queueFilesRef.current = (files, position) => {
    if (!files.length) return;
    const insertionPosition = position ?? editor.state.selection.from;
    setUploading((count) => count + files.length);
    setUploadError(null);

    void Promise.all(files.map((file) => onAttach(file)))
      .then((uploaded) => {
        setAttachments((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...uploaded.filter((item) => !seen.has(item.id))];
        });
        const nodes: JSONContent[] = [];
        uploaded.forEach((attachment) => {
          const url = attachmentUrl(attachment.id);
          if (
            attachment.mime_type.startsWith("image/") &&
            !isPdfFile(attachment.mime_type, attachment.filename)
          ) {
            nodes.push({
              type: "image",
              attrs: {
                src: url,
                alt: attachment.filename,
                title: attachment.filename,
              },
            });
            return;
          }

          nodes.push(
            fileAttachmentNode(attachment, url, pdfViewRef.current !== "title")
          );
        });

        nodes.push({ type: "paragraph" });
        const safePosition = Math.min(insertionPosition, editor.state.doc.content.size);
        editor.chain().focus().insertContentAt(safePosition, nodes).run();
      })
      .catch((error) => {
        setUploadError(error instanceof Error ? error.message : "Media upload failed");
      })
      .finally(() => setUploading((count) => Math.max(0, count - files.length)));
  };

  const btn = (
    label: string,
    action: () => void,
    active = false,
    icon?: ReactNode
  ) => (
    <button
      key={label}
      type="button"
      className={active ? "toolbar-btn active" : "toolbar-btn"}
      onMouseDown={(e) => {
        e.preventDefault();
        action();
      }}
      title={label}
    >
      {icon ?? label}
    </button>
  );

  const wrap = (id: string, node: ReactNode) => (
    <span
      key={id}
      data-toolbar-item={id}
      className={overflowIds.includes(id) ? "toolbar-item is-overflowed" : "toolbar-item"}
    >
      {node}
    </span>
  );

  const fontClass =
    fontFamily === "serif"
      ? "font-serif"
      : fontFamily === "mono"
        ? "font-mono"
        : "font-sans";

  const fileAttachments = attachments.filter(isFileAttachment);
  const showToolbar = formattingToolbarVisible(toolbarHidden, editorFocused);
  const currentFontFamily = String(editor.getAttributes("textStyle").fontFamily || "");
  const currentFontSize = String(editor.getAttributes("textStyle").fontSize || "").replace("px", "");
  const applyLink = (href: string, text: string) => {
    const label = text.trim();
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "");
    if (label && label !== selected) {
      const chain = editor.chain().focus();
      if (from !== to) chain.deleteSelection();
      chain.insertContent(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href }).run();
  };
  const openHref = (href: string) => {
    const noteLink = href.match(/^notebook:\/\/note\/([0-9a-f-]{36})$/i);
    if (noteLink) {
      onOpenNoteLink?.(noteLink[1]);
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
  };

  const overflowActions: { id: string; label: string; action: () => void }[] = [
    { id: "h1", label: "Heading 1", action: () => editor.chain().focus().toggleHeading({ level: 1 }).run() },
    { id: "h2", label: "Heading 2", action: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { id: "h3", label: "Heading 3", action: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { id: "bold", label: "Bold", action: () => editor.chain().focus().toggleBold().run() },
    { id: "italic", label: "Italic", action: () => editor.chain().focus().toggleItalic().run() },
    { id: "underline", label: "Underline", action: () => editor.chain().focus().toggleUnderline().run() },
    { id: "strike", label: "Strikethrough", action: () => editor.chain().focus().toggleStrike().run() },
    { id: "highlight", label: "Highlight", action: () => editor.chain().focus().toggleHighlight().run() },
    { id: "color", label: "Text color", action: () => setShowTextColors(true) },
    { id: "align-left", label: "Align left", action: () => editor.chain().focus().setTextAlign("left").run() },
    { id: "align-center", label: "Align center", action: () => editor.chain().focus().setTextAlign("center").run() },
    { id: "align-right", label: "Align right", action: () => editor.chain().focus().setTextAlign("right").run() },
    { id: "justify", label: "Justify", action: () => editor.chain().focus().setTextAlign("justify").run() },
    { id: "outdent", label: "Decrease indent", action: () => applyIndent(editor, -1) },
    { id: "indent", label: "Increase indent", action: () => applyIndent(editor, 1) },
    { id: "bullets", label: "Bulleted list", action: () => editor.chain().focus().toggleBulletList().run() },
    { id: "numbers", label: "Numbered list", action: () => editor.chain().focus().toggleOrderedList().run() },
    { id: "checklist", label: "Checklist", action: () => editor.chain().focus().toggleTaskList().run() },
    { id: "checkbox", label: "Checkbox", action: () => editor.chain().focus().insertInlineCheckbox(false).run() },
    { id: "quote", label: "Quote", action: () => editor.chain().focus().toggleBlockquote().run() },
    { id: "code", label: "Code block", action: () => editor.chain().focus().toggleCodeBlock().run() },
    { id: "inline-code", label: "Inline code", action: () => editor.chain().focus().toggleCode().run() },
    { id: "divider", label: "Divider", action: () => editor.chain().focus().setHorizontalRule().run() },
    { id: "date", label: "Insert date and time", action: () => editor.chain().focus().insertContent(new Date().toLocaleString()).run() },
    { id: "link", label: "Link", action: () => setLinkDialog(openLinkDialog(editor)) },
    { id: "table", label: "Insert table", action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { id: "attach", label: "Insert media or file", action: () => fileRef.current?.click() },
  ];

  const editorMenuItems: ContextMenuEntry[] = [
    { label: "Cut", shortcut: "Ctrl/⌘ X", onSelect: () => document.execCommand("cut") },
    { label: "Copy", shortcut: "Ctrl/⌘ C", onSelect: () => document.execCommand("copy") },
    { label: "Paste", shortcut: "Ctrl/⌘ V", onSelect: () => document.execCommand("paste") },
    { type: "separator" },
    { label: "Bold", onSelect: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", onSelect: () => editor.chain().focus().toggleItalic().run() },
    { label: "Highlight", onSelect: () => editor.chain().focus().toggleHighlight().run() },
    { type: "separator" },
    { label: "Bulleted list", onSelect: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", onSelect: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Checklist", onSelect: () => editor.chain().focus().toggleTaskList().run() },
    {
      label: "Checkbox",
      onSelect: () => editor.chain().focus().insertInlineCheckbox(false).run(),
    },
    { type: "separator" },
    { label: "Align left", onSelect: () => editor.chain().focus().setTextAlign("left").run() },
    { label: "Align center", onSelect: () => editor.chain().focus().setTextAlign("center").run() },
    { label: "Align right", onSelect: () => editor.chain().focus().setTextAlign("right").run() },
    { label: "Justify", onSelect: () => editor.chain().focus().setTextAlign("justify").run() },
    { type: "separator" },
    ...(editor.isActive("link")
      ? [
          {
            label: "Open link",
            onSelect: () => openHref(String(editor.getAttributes("link").href || "")),
          },
          {
            label: "Copy link",
            onSelect: () =>
              void navigator.clipboard.writeText(String(editor.getAttributes("link").href || "")),
          },
        ]
      : []),
    {
      label: "Link…",
      onSelect: () => setLinkDialog(openLinkDialog(editor)),
    },
    { label: "Insert table", onSelect: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
    { label: "Insert date and time", onSelect: () => editor.chain().focus().insertContent(new Date().toLocaleString()).run() },
    ...(editor.isActive("table")
      ? [
          { type: "separator" as const },
          { label: "Add row below", onSelect: () => editor.chain().focus().addRowAfter().run() },
          { label: "Add column right", onSelect: () => editor.chain().focus().addColumnAfter().run() },
          { label: "Delete row", onSelect: () => editor.chain().focus().deleteRow().run() },
          { label: "Delete column", onSelect: () => editor.chain().focus().deleteColumn().run() },
          { label: "Delete table", onSelect: () => editor.chain().focus().deleteTable().run() },
        ]
      : []),
  ];

  return (
    <div
      className={
        dragActive
          ? "note-editor is-dragging"
          : editorFocused
            ? "note-editor is-editing"
            : "note-editor"
      }
      onDragEnter={(event) => {
        if (event.dataTransfer.types.includes("Files")) setDragActive(true);
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragActive(false);
        }
      }}
      onDropCapture={(event) => {
        setDragActive(false);
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        const position = editor.view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        queueFilesRef.current(files, position);
      }}
    >
      {showFind && (
        <div className="find-in-note" onMouseDown={(event) => event.stopPropagation()}>
          <Icon.Search size={14} />
          <input
            ref={findInputRef}
            value={findQuery}
            placeholder="Find in note"
            onChange={(event) => {
              setFindQuery(event.target.value);
              setFindIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                setFindIndex((current) =>
                  nextMatchIndex(findCount, current, event.shiftKey ? -1 : 1)
                );
              } else if (event.key === "Escape") {
                event.preventDefault();
                setShowFind(false);
                setShowReplace(false);
                editor.commands.focus();
              }
            }}
          />
          {showReplace && (
            <input
              value={replaceQuery}
              placeholder="Replace with"
              onChange={(event) => setReplaceQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  replaceCurrent();
                }
              }}
            />
          )}
          <span className="find-count">
            {findQuery.trim()
              ? findCount
                ? `${findIndex + 1} of ${findCount}`
                : "No matches"
              : ""}
          </span>
          <button
            type="button"
            className="ghost-btn small"
            onClick={() => setShowReplace((open) => !open)}
          >
            Replace
          </button>
          {showReplace && (
            <>
              <button type="button" className="ghost-btn small" onClick={replaceCurrent}>
                Replace
              </button>
              <button type="button" className="ghost-btn small" onClick={replaceAll}>
                All
              </button>
            </>
          )}
          <button
            type="button"
            className="icon-btn"
            title="Previous"
            onClick={() => setFindIndex((current) => nextMatchIndex(findCount, current, -1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Next"
            onClick={() => setFindIndex((current) => nextMatchIndex(findCount, current, 1))}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Close"
            onClick={() => {
              setShowFind(false);
              setShowReplace(false);
              editor.commands.focus();
            }}
          >
            <Icon.Close size={14} />
          </button>
        </div>
      )}
      {showToolbar && (
      <div ref={toolbarRef} className="editor-toolbar">
        {wrap(
          "font-family",
          <select
            className="toolbar-select"
            aria-label="Font"
            value={EDITOR_FONTS.some((font) => font.id === currentFontFamily) ? currentFontFamily : ""}
            onChange={(event) => {
              const value = event.target.value;
              if (value) editor.chain().focus().setFontFamily(value).run();
              else editor.chain().focus().unsetFontFamily().run();
            }}
          >
            {EDITOR_FONTS.map((font) => (
              <option key={font.label} value={font.id}>
                {font.label}
              </option>
            ))}
          </select>
        )}
        {wrap(
          "font-size",
          <select
            className="toolbar-select size"
            aria-label="Font size"
            value={EDITOR_FONT_SIZES.some((size) => String(size) === currentFontSize) ? currentFontSize : ""}
            onChange={(event) => {
              const value = event.target.value;
              if (value) editor.chain().focus().setFontSize(`${value}px`).run();
              else editor.chain().focus().unsetFontSize().run();
            }}
          >
            <option value="">Size</option>
            {EDITOR_FONT_SIZES.map((size) => (
              <option key={size} value={String(size)}>
                {size}
              </option>
            ))}
          </select>
        )}
        <span className="toolbar-sep" />
        {wrap("h1", btn(
          "Heading 1",
          () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          editor.isActive("heading", { level: 1 }),
          <Icon.Heading size={16} />
        ))}
        {wrap("h2", btn(
          "Heading 2",
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          editor.isActive("heading", { level: 2 }),
          <span className="toolbar-text">H2</span>
        ))}
        {wrap("h3", btn(
          "Heading 3",
          () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          editor.isActive("heading", { level: 3 }),
          <span className="toolbar-text">H3</span>
        ))}
        <span className="toolbar-sep" />
        {wrap("bold", btn(
          "Bold",
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
          <Icon.Bold size={16} />
        ))}
        {wrap("italic", btn(
          "Italic",
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
          <Icon.Italic size={16} />
        ))}
        {wrap("underline", btn(
          "Underline",
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive("underline"),
          <Icon.Underline size={16} />
        ))}
        {wrap("strike", btn(
          "Strikethrough",
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive("strike"),
          <Icon.Strike size={16} />
        ))}
        {wrap(
          "highlight",
          <div className="highlight-picker">
          {btn(
            "Highlight",
            () => setShowColors((open) => !open),
            editor.isActive("highlight"),
            <span className="toolbar-text hl">HL</span>
          )}
          {showColors && (
            <div className="highlight-colors" onMouseDown={(event) => event.preventDefault()}>
              {HIGHLIGHT_COLORS.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  title={swatch.label}
                  className="highlight-swatch"
                  style={{ background: swatch.color }}
                  onClick={() => {
                    editor.chain().focus().toggleHighlight({ color: swatch.color }).run();
                    setShowColors(false);
                  }}
                />
              ))}
              <button
                type="button"
                className="ghost-btn small"
                onClick={() => {
                  editor.chain().focus().unsetHighlight().run();
                  setShowColors(false);
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
        )}
        {wrap(
          "color",
          <div className="highlight-picker">
          {btn(
            "Text color",
            () => setShowTextColors((open) => !open),
            Boolean(editor.getAttributes("textStyle").color),
            <Icon.Color size={16} />
          )}
          {showTextColors && (
            <div className="highlight-colors" onMouseDown={(event) => event.preventDefault()}>
              {TEXT_COLORS.map((swatch) => (
                <button
                  key={swatch.id}
                  type="button"
                  title={swatch.label}
                  className={swatch.color ? "highlight-swatch" : "ghost-btn small"}
                  style={swatch.color ? { background: swatch.color } : undefined}
                  onClick={() => {
                    if (swatch.color) editor.chain().focus().setColor(swatch.color).run();
                    else editor.chain().focus().unsetColor().run();
                    setShowTextColors(false);
                  }}
                >
                  {swatch.color ? "" : "Aa"}
                </button>
              ))}
            </div>
          )}
        </div>
        )}
        <span className="toolbar-sep" />
        {wrap("align-left", btn(
          "Align left",
          () => editor.chain().focus().setTextAlign("left").run(),
          editor.isActive({ textAlign: "left" }) || (!editor.isActive({ textAlign: "center" }) && !editor.isActive({ textAlign: "right" }) && !editor.isActive({ textAlign: "justify" })),
          <Icon.AlignLeft size={16} />
        ))}
        {wrap("align-center", btn(
          "Align center",
          () => editor.chain().focus().setTextAlign("center").run(),
          editor.isActive({ textAlign: "center" }),
          <Icon.AlignCenter size={16} />
        ))}
        {wrap("align-right", btn(
          "Align right",
          () => editor.chain().focus().setTextAlign("right").run(),
          editor.isActive({ textAlign: "right" }),
          <Icon.AlignRight size={16} />
        ))}
        {wrap("justify", btn(
          "Justify",
          () => editor.chain().focus().setTextAlign("justify").run(),
          editor.isActive({ textAlign: "justify" }),
          <Icon.AlignJustify size={16} />
        ))}
        {wrap("outdent", btn(
          "Decrease indent",
          () => applyIndent(editor, -1),
          false,
          <Icon.Outdent size={16} />
        ))}
        {wrap("indent", btn(
          "Increase indent",
          () => applyIndent(editor, 1),
          false,
          <Icon.Indent size={16} />
        ))}
        <span className="toolbar-sep" />
        {wrap("bullets", btn(
          "Bulleted list",
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
          <Icon.List size={16} />
        ))}
        {wrap("numbers", btn(
          "Numbered list",
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
          <Icon.Ordered size={16} />
        ))}
        {wrap("checklist", btn(
          "Checklist",
          () => editor.chain().focus().toggleTaskList().run(),
          editor.isActive("taskList"),
          <Icon.Checklist size={16} />
        ))}
        {wrap("checkbox", btn(
          "Checkbox",
          () => editor.chain().focus().insertInlineCheckbox(false).run(),
          false,
          <Icon.Check size={16} />
        ))}
        {wrap("quote", btn(
          "Quote",
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
          <Icon.Quote size={16} />
        ))}
        {wrap("code", btn(
          "Code block",
          () => editor.chain().focus().toggleCodeBlock().run(),
          editor.isActive("codeBlock"),
          <Icon.Code size={16} />
        ))}
        {wrap("inline-code", btn(
          "Inline code",
          () => editor.chain().focus().toggleCode().run(),
          editor.isActive("code"),
          <span className="toolbar-text">{"<>"}</span>
        ))}
        {wrap("divider", btn(
          "Divider",
          () => editor.chain().focus().setHorizontalRule().run(),
          false,
          <span className="toolbar-text">—</span>
        ))}
        {wrap("date", btn(
          "Insert date and time",
          () => editor.chain().focus().insertContent(new Date().toLocaleString()).run(),
          false,
          <span className="toolbar-text">Date</span>
        ))}
        {wrap("link", btn(
          "Link",
          () => setLinkDialog(openLinkDialog(editor)),
          editor.isActive("link"),
          <Icon.Link size={16} />
        ))}
        {wrap("table", btn(
          "Insert table",
          () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
          editor.isActive("table"),
          <Icon.Table size={16} />
        ))}
        {wrap("attach", btn("Insert media or file", () => fileRef.current?.click(), false, <Icon.Attach size={16} />))}
        {overflowIds.length > 0 && (
          <div className="highlight-picker toolbar-overflow">
            {btn("More formatting", () => setShowOverflow((open) => !open), showOverflow, <span className="toolbar-text">…</span>)}
            {showOverflow && (
              <div className="toolbar-overflow-menu" onMouseDown={(event) => event.preventDefault()}>
                {overflowActions
                  .filter((item) => overflowIds.includes(item.id))
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        item.action();
                        setShowOverflow(false);
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}
        {uploading > 0 && (
          <span className="upload-status">
            Uploading {uploading} {uploading === 1 ? "item" : "items"}…
          </span>
        )}
      </div>
      )}
      <input
        ref={fileRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) queueFilesRef.current(files);
          e.target.value = "";
        }}
      />
      {uploadError && (
        <div className="upload-error" role="alert">
          {uploadError}
          <button type="button" onClick={() => setUploadError(null)}>
            Dismiss
          </button>
        </div>
      )}
      {fileAttachments.length > 0 && (
        <div className="note-attachments">
          <button
            type="button"
            className="note-attachments-toggle"
            aria-expanded={attachmentsExpanded}
            onClick={() => onAttachmentsExpandedChange?.(!attachmentsExpanded)}
          >
            <Icon.Attach size={14} />
            <span>{attachmentsLabel(fileAttachments.length)}</span>
            <Icon.Chevron size={14} />
          </button>
          {attachmentsExpanded && (
            <div className="note-attachments-list">
              {fileAttachments.map((attachment) => (
                <a
                  key={attachment.id}
                  className={
                    isPdfFile(attachment.mime_type, attachment.filename)
                      ? "note-attachment-chip is-pdf"
                      : "note-attachment-chip"
                  }
                  href={attachmentUrl(attachment.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={attachment.filename}
                >
                  <Icon.Attach size={14} />
                  <span className="note-attachment-name">{attachment.filename}</span>
                  <span className="note-attachment-size">{formatSize(attachment.size)}</span>
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {dragActive && (
        <div className="media-drop-overlay">
          <Icon.Attach size={28} />
          <strong>Drop files into this note</strong>
          <span>Images appear inline; other files become attachments.</span>
        </div>
      )}
      <div
        className="editor-scroll"
        onMouseDown={(event) => {
          const scroller = event.currentTarget;
          const rect = scroller.getBoundingClientRect();
          if (
            event.clientX >= rect.left + scroller.clientWidth ||
            event.clientY >= rect.top + scroller.clientHeight
          ) {
            return;
          }
          const target = event.target as HTMLElement | null;
          if (target?.closest(".ProseMirror, a, button, input, .notebook-file")) return;
          editor.chain().focus("end").run();
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setEditorMenu({ x: event.clientX, y: event.clientY });
        }}
      >
        <div
          className={`editor-page ${fontClass} ${noteWidth === "readable" ? "readable" : "full"}`}
          style={{ fontSize: `${fontSize}px`, zoom: zoom / 100 }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      {editorMenu && (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          items={editorMenuItems}
          onClose={() => setEditorMenu(null)}
        />
      )}
      {linkDialog && (
        <LinkDialog
          href={linkDialog.href}
          text={linkDialog.text}
          onCancel={() => setLinkDialog(null)}
          onRemove={() => {
            editor.chain().focus().unsetLink().run();
            setLinkDialog(null);
          }}
          onOpen={(href) => openHref(href)}
          onCopy={(href) => void navigator.clipboard.writeText(href)}
          onSave={(href, text) => {
            applyLink(href, text);
            setLinkDialog(null);
          }}
        />
      )}
    </div>
  );
}
