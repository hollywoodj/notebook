import { useEditor, EditorContent, NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
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
import { mergeAttributes } from "@tiptap/core";
import {
  ReactNode,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type Ref,
} from "react";
import { api, Attachment, attachmentUrl } from "../api";
import {
  NOTE_STYLE_OPTIONS,
  noteFontStyleVars,
  stylesFromLegacy,
  type NoteFontStyles,
} from "../ui/noteFonts.ts";
import { Icon } from "./Icons";
import {
  CODE_LANGUAGES,
  EDITOR_FONTS,
  EDITOR_FONT_SIZES,
  HIGHLIGHT_COLORS,
  IMAGE_SIZE_PRESETS,
  INSERT_MENU_ITEMS,
  MORE_FORMAT_ITEMS,
  TEXT_COLORS,
  attachmentsLabel,
  filterInsertItems,
  formattingToolbarVisible,
  clampImageWidth,
  clampFloatingToolbarCenter,
  insertDateStamp,
  insertTimeStamp,
  nextFontSize,
  selectionToolbarVisible,
  slashConsumeRange,
  slashQueryFromBlock,
  type InsertMenuId,
  type MoreFormatId,
} from "../ui/editorChrome";
import { countWords, escapeHtml, outlineToHtml } from "../ui/noteContent";
import { findMatchOffsets, nextMatchIndex } from "../ui/search";
import { visibleToolbarCount } from "../ui/panes";
import type { EditorCommand, EditorHandle } from "../editorHandle";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { LinkDialog } from "./LinkDialog";
import { FontFamily, FontSize } from "./fontMarks";
import { Callout, Subscript, Superscript } from "./editorMarks";
import { CodeCopyButton } from "./codeCopyButton";
import { CollapsibleHeading } from "./collapsibleHeading";
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
import { ReadOnlyGuard } from "./readOnlyGuard";
import { DraggableTaskItem } from "./draggableTaskItem";

interface Props {
  noteId: string;
  content: string;
  onChange: (html: string) => void;
  onAttach: (file: File) => Promise<Attachment>;
  spellCheck: boolean;
  spellLanguage?: string;
  fontFamily: "default" | "serif" | "mono";
  fontSize: number;
  fontStyles?: NoteFontStyles;
  noteWidth: "readable" | "full";
  lineHeight?: number;
  readOnly?: boolean;
  pdfView?: "expanded" | "title";
  placeholder?: string;
  onUseAsTitle?: (filename: string) => void;
  editorRef?: Ref<EditorHandle>;
  toolbarHidden?: boolean;
  attachmentsExpanded?: boolean;
  onAttachmentsExpandedChange?: (expanded: boolean) => void;
  zoom?: number;
  outlineOpen?: boolean;
  onOpenNoteLink?: (noteId: string) => void;
  onSelectionWords?: (count: number) => void;
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

function ResizableImageView({ node, updateAttributes, selected }: NodeViewProps) {
  const width = node.attrs.width as string | null;
  const align = String(node.attrs.align || "left");
  const caption = node.attrs.title as string | null;
  const onResize = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const img = event.currentTarget.parentElement?.querySelector("img") as HTMLImageElement | null;
    const startWidth = img?.getBoundingClientRect().width || 320;
    const onMove = (ev: PointerEvent) => {
      updateAttributes({ width: `${clampImageWidth(startWidth + ev.clientX - startX)}px` });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };
  return (
    <NodeViewWrapper
      as="figure"
      className={"note-image-wrap" + (selected ? " is-selected" : "")}
      data-align={align}
    >
      <div className="note-image-frame">
        <img
          src={node.attrs.src}
          alt={node.attrs.alt || ""}
          title={caption || ""}
          style={width ? { width } : undefined}
          onDoubleClick={() =>
            window.dispatchEvent(
              new CustomEvent("notebook:image-lightbox", { detail: { src: node.attrs.src } })
            )
          }
        />
        {selected ? (
          <button
            type="button"
            className="image-handle se"
            aria-label="Resize image"
            onPointerDown={onResize}
          />
        ) : null}
      </div>
      {caption ? <figcaption>{caption}</figcaption> : null}
    </NodeViewWrapper>
  );
}

const CaptionImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("width") || (element as HTMLElement).style?.width || null,
        renderHTML: (attributes) =>
          attributes.width ? { width: attributes.width, style: `width: ${attributes.width}` } : {},
      },
      title: {
        default: null,
        parseHTML: (element) => element.getAttribute("title"),
        renderHTML: (attributes) => (attributes.title ? { title: attributes.title } : {}),
      },
      align: {
        default: "left",
        parseHTML: (element) =>
          element.getAttribute("data-align") ||
          (element as HTMLElement).style?.textAlign ||
          "left",
        renderHTML: (attributes) =>
          attributes.align && attributes.align !== "left"
            ? { "data-align": attributes.align }
            : {},
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "figure.note-figure, figure.note-image-wrap",
        getAttrs: (node) => {
          const el = node as HTMLElement;
          const img = el.querySelector("img");
          if (!img) return false;
          return {
            src: img.getAttribute("src"),
            alt: img.getAttribute("alt"),
            title: el.querySelector("figcaption")?.textContent || img.getAttribute("title"),
            width: img.getAttribute("width") || (img as HTMLElement).style?.width,
            align: el.getAttribute("data-align") || "left",
          };
        },
      },
      { tag: "img[src]" },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    const caption = HTMLAttributes.title;
    const align = HTMLAttributes.align || HTMLAttributes["data-align"] || "left";
    const imgAttrs = mergeAttributes(this.options.HTMLAttributes, HTMLAttributes);
    delete imgAttrs.align;
    if (!caption) {
      return ["img", imgAttrs];
    }
    return [
      "figure",
      { class: "note-figure", "data-align": align },
      ["img", imgAttrs],
      ["figcaption", {}, String(caption)],
    ];
  },
  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageView);
  },
});

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
  spellLanguage = "en-US",
  fontFamily,
  fontSize,
  fontStyles,
  noteWidth,
  lineHeight = 1.5,
  readOnly = false,
  pdfView = "expanded",
  placeholder = "Start writing, or pick a template…",
  onUseAsTitle,
  editorRef,
  toolbarHidden = false,
  attachmentsExpanded = false,
  onAttachmentsExpandedChange,
  zoom = 100,
  outlineOpen = false,
  onOpenNoteLink,
  onSelectionWords,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queueFilesRef = useRef<(files: File[], position?: number) => void>(() => {});
  const findInputRef = useRef<HTMLInputElement>(null);
  const selectFindInput = () => {
    window.setTimeout(() => findInputRef.current?.select(), 0);
  };
  const toolbarRef = useRef<HTMLDivElement>(null);
  const selectionToolbarRef = useRef<HTMLDivElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showFind, setShowFind] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findIndex, setFindIndex] = useState(0);
  const [findCount, setFindCount] = useState(0);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findWholeWord, setFindWholeWord] = useState(false);
  const [showColors, setShowColors] = useState(false);
  const [showTextColors, setShowTextColors] = useState(false);
  const [showOverflow, setShowOverflow] = useState(false);
  const [showInsertMenu, setShowInsertMenu] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [overflowIds, setOverflowIds] = useState<string[]>([]);
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [bubblePos, setBubblePos] = useState<{ x: number; y: number } | null>(null);
  const slashQueryRef = useRef<string | null>(null);
  const slashIndexRef = useRef(0);
  const slashItemsRef = useRef<(typeof INSERT_MENU_ITEMS)[number][]>([...INSERT_MENU_ITEMS]);
  const runInsertRef = useRef<(id: InsertMenuId, consumeSlash?: boolean) => void>(() => {});
  slashQueryRef.current = slashQuery;
  slashIndexRef.current = slashIndex;
  const [editorMenu, setEditorMenu] = useState<{ x: number; y: number } | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ href: string; text: string } | null>(null);
  const indentRef = useRef<(shift: boolean) => boolean>(() => false);

  useLayoutEffect(() => {
    const toolbar = selectionToolbarRef.current;
    if (!toolbar || !bubblePos) return;

    const boundary = toolbar.closest<HTMLElement>(".editor-main")?.getBoundingClientRect();
    const left = boundary?.left ?? 0;
    const right = boundary?.right ?? window.innerWidth;
    const center = clampFloatingToolbarCenter(
      bubblePos.x,
      toolbar.getBoundingClientRect().width,
      left,
      right
    );
    toolbar.style.left = `${Math.round(center)}px`;
  }, [bubblePos]);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editorFocused, setEditorFocused] = useState(false);
  const restoredFilesRef = useRef(false);
  const pdfViewRef = useRef(pdfView);
  pdfViewRef.current = pdfView;
  const onUseAsTitleRef = useRef(onUseAsTitle);
  onUseAsTitleRef.current = onUseAsTitle;
  const onSelectionWordsRef = useRef(onSelectionWords);
  onSelectionWordsRef.current = onSelectionWords;

  const syncEditorChrome = (current: Editor) => {
    const { from, to, empty, $from } = current.state.selection;
    const selected = empty ? "" : current.state.doc.textBetween(from, to, " ");
    onSelectionWordsRef.current?.(countWords(selected));
    if (current.isEditable && selectionToolbarVisible(from, to, empty) && current.view.hasFocus()) {
      const start = current.view.coordsAtPos(from);
      const end = current.view.coordsAtPos(to);
      setBubblePos({
        x: Math.round((start.left + end.right) / 2),
        y: Math.round(Math.min(start.top, end.top)),
      });
    } else {
      setBubblePos(null);
    }
    setSlashQuery(
      current.isEditable && empty && $from.parent.type.name === "paragraph"
        ? slashQueryFromBlock($from.parent.textContent, $from.parentOffset) : null
    );
  };

  const editor = useEditor({
    extensions: [
      ReadOnlyGuard,
      StarterKit.configure({
        codeBlock: { languageClassPrefix: "language-" },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Highlight.extend({
        addKeyboardShortcuts() {
          return {};
        },
      }).configure({ multicolor: true }),
      TaskList,
      DraggableTaskItem.configure({ nested: true }),
      InlineCheckbox,
      Placeholder.configure({ placeholder }),
      CaptionImage.configure({ allowBase64: true }),
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
      Superscript,
      Subscript,
      Callout,
      CodeCopyButton,
      CollapsibleHeading,
    ],
    content,
    autofocus: false,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
      syncEditorChrome(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      syncEditorChrome(editor);
    },
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
        setShowInsertMenu(false);
        setShowStyleMenu(false);
        setBubblePos(null);
        setSlashQuery(null);
      });
    },
    editorProps: {
        attributes: {
          class: "note-editor-content",
          spellcheck: spellCheck ? "true" : "false",
          lang: spellLanguage,
        },
      handleKeyDown: (_view, event) => {
        if (slashQueryRef.current !== null) {
          const items = slashItemsRef.current;
          if (event.key === "Escape") {
            setSlashQuery(null);
            return true;
          }
          if (event.key === "ArrowDown") {
            if (!items.length) return true;
            setSlashIndex((index) => (index + 1) % items.length);
            return true;
          }
          if (event.key === "ArrowUp") {
            if (!items.length) return true;
            setSlashIndex((index) => (index - 1 + items.length) % items.length);
            return true;
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const item = items[slashIndexRef.current];
            if (item) {
              runInsertRef.current(item.id, true);
              return true;
            }
          }
        }
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
      try {
        editor.chain().setContent(content, false).setMeta("notebook:load-content", true).run();
      } catch (err) {
        console.error(err);
      }
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
          lang: spellLanguage,
        },
      },
    });
  }, [spellCheck, spellLanguage, editor]);

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

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

  // The code-block "Copy" button lives in the `CodeCopyButton` extension as a
  // ProseMirror widget decoration. It was a MutationObserver appending a real
  // button into each <pre>; ProseMirror reconciled the foreign node away, the
  // observer put it back, and the two span at 100% CPU forever on any note
  // containing a code block. See components/codeCopyButton.ts.

  useEffect(() => {
    const onLightbox = (event: Event) => {
      const src = (event as CustomEvent<{ src?: string }>).detail?.src;
      if (src) setLightboxSrc(src);
    };
    window.addEventListener("notebook:image-lightbox", onLightbox);
    return () => window.removeEventListener("notebook:image-lightbox", onLightbox);
  }, []);

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
    if (!editor || !showFind) return;
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "", "");
    const offsets = findMatchOffsets(text, findQuery, {
      caseSensitive: findCaseSensitive,
      wholeWord: findWholeWord,
    });
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
  }, [editor, findQuery, findIndex, showFind, findCaseSensitive, findWholeWord]);

  const replaceCurrent = () => {
    if (!editor?.isEditable || !findQuery.trim()) return;
    const { from, to } = editor.state.selection;
    const selected = editor.state.doc.textBetween(from, to, "");
    if (selected.toLowerCase() !== findQuery.trim().toLowerCase()) return;
    editor.chain().focus().insertContent(replaceQuery).run();
    setFindIndex((current) => current);
  };

  const replaceAll = () => {
    if (!editor?.isEditable || !findQuery.trim()) return;
    const needle = findQuery.trim();
    const text = editor.state.doc.textBetween(0, editor.state.doc.content.size, "", "");
    const offsets = findMatchOffsets(text, needle);
    for (let i = offsets.length - 1; i >= 0; i--) {
      const from = textOffsetToPos(editor.state.doc, offsets[i]);
      const to = from + needle.length;
      editor.commands.insertContentAt({ from, to }, replaceQuery);
    }
  };

  const runEditorCommand = (command: EditorCommand) => {
    if (!editor || editor.isDestroyed) return;
    if (!editor.isEditable && !["copy", "selectAll", "findNext", "findPrev"].includes(command.type)) return;
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
        chain.insertContent(insertDateStamp()).run();
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
      case "superscript":
        chain.toggleSuperscript().run();
        break;
      case "subscript":
        chain.toggleSubscript().run();
        break;
      case "callout": {
        const kind = command.kind || "info";
        if (editor.isActive("callout")) {
          const current = String(editor.getAttributes("callout").kind || "info");
          if (current === kind) chain.unsetCallout().run();
          else chain.updateAttributes("callout", { kind }).run();
        } else {
          chain.setCallout(kind).run();
        }
        break;
      }
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

      // Ported from main's editor bus onto candidate 7's typed handle.
      case "findNext":
        setShowFind(true);
        setFindIndex((current) => nextMatchIndex(findCount, current, 1));
        break;
      case "findPrev":
        setShowFind(true);
        setFindIndex((current) => nextMatchIndex(findCount, current, -1));
        break;
      case "fontSizeStep": {
        const current = String(editor.getAttributes("textStyle").fontSize || "");
        chain.setFontSize(nextFontSize(current, command.direction)).run();
        break;
      }
      case "imageAlign":
        if (editor.isActive("image")) {
          chain.updateAttributes("image", { align: command.align }).run();
        }
        break;
      case "imageCaption":
        if (editor.isActive("image")) {
          chain.updateAttributes("image", { title: command.title || null }).run();
        }
        break;
      case "imageSize":
        if (editor.isActive("image")) {
          chain.updateAttributes("image", { width: command.width || null }).run();
        }
        break;
      case "insertDateTime":
        chain.insertContent(new Date().toLocaleString()).run();
        break;
      case "insertTime":
        chain.insertContent(insertTimeStamp()).run();
        break;
      case "insertToc": {
        const headings: { level: number; text: string }[] = [];
        editor.state.doc.descendants((node) => {
          if (node.type.name === "heading") {
            headings.push({
              level: Number(node.attrs.level || 1),
              text: node.textContent || "Untitled heading",
            });
          }
        });
        const html = outlineToHtml(headings);
        if (html) chain.insertContentAt(1, html).run();
        break;
      }
      case "pastePlain": {
        void navigator.clipboard.readText().then((text) => {
          if (!text) return;
          editor
            .chain()
            .focus()
            .insertContent(escapeHtml(text).replace(/\n/g, "<br>"))
            .run();
        });
        break;
      }
      case "tasks": {
        const checked = command.action === "checkAll";
        const { tr } = editor.state;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "taskItem") {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked });
          }
        });
        if (tr.docChanged) editor.view.dispatch(tr);
        break;
      }
      case "unlink":
        chain.unsetLink().run();
        break;
      case "unsetColor":
        chain.unsetColor().run();
        break;
    }
  };

  useImperativeHandle(
    editorRef,
    () => ({
      run: runEditorCommand,
      openFind: () => {
        setShowFind(true);
        selectFindInput();
      },
      openReplace: () => {
        setShowFind(true);
        setShowReplace(true);
        selectFindInput();
      },
    }),
    // Matches the dependency list the window listener used: `run` closes over the
    // live editor and over findQuery/replaceQuery for the replace commands.
    [editor, findQuery, replaceQuery]
  );

  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el || !editor || !formattingToolbarVisible(toolbarHidden, editorFocused)) return;

    // Measuring an overflowed item means briefly un-hiding it, which is a
    // layout change inside the element the ResizeObserver is watching. Doing
    // that from the observer's own callback re-triggers the observer, and
    // hiding an item frees the width that made it overflow in the first place,
    // so the toolbar oscillates and the renderer never goes idle. Natural
    // widths are cached per item, and the observer only reacts when the
    // toolbar's own width actually changed.
    const naturalWidths = new Map<string, number>();
    let measuring = false;
    let lastWidth = -1;
    let frame = 0;

    const widthOf = (item: HTMLElement): number => {
      const id = item.dataset.toolbarItem || "";
      if (!item.classList.contains("is-overflowed")) {
        const width = item.getBoundingClientRect().width + 2;
        if (id) naturalWidths.set(id, width);
        return width;
      }
      const cached = id ? naturalWidths.get(id) : undefined;
      if (cached !== undefined) return cached;
      const previous = item.style.display;
      item.style.display = "inline-flex";
      const width = item.getBoundingClientRect().width + 2;
      item.style.display = previous;
      if (id) naturalWidths.set(id, width);
      return width;
    };

    const measure = () => {
      measuring = true;
      try {
        const items = [...el.querySelectorAll<HTMLElement>("[data-toolbar-item]")];
        const overflowCandidates = items.filter((item) => item.dataset.toolbarPinned !== "true");
        const pinnedWidth = items
          .filter((item) => item.dataset.toolbarPinned === "true")
          .reduce((sum, item) => sum + widthOf(item), 0);
        const toolbarStyle = getComputedStyle(el);
        const padding = parseFloat(toolbarStyle.paddingLeft) + parseFloat(toolbarStyle.paddingRight);
        const separatorWidth = [...el.querySelectorAll<HTMLElement>(".toolbar-sep")].reduce((sum, separator) => {
          const style = getComputedStyle(separator);
          return sum + separator.getBoundingClientRect().width + parseFloat(style.marginLeft) + parseFloat(style.marginRight);
        }, 0);
        const available = el.clientWidth - padding - separatorWidth - pinnedWidth;
        const visible = visibleToolbarCount(available, overflowCandidates.map(widthOf), 0);
        const hiddenIds = overflowCandidates
          .slice(visible)
          .map((item) => item.dataset.toolbarItem || "");
        setOverflowIds((current) => {
          const next = hiddenIds.filter(Boolean);
          if (current.length === next.length && current.every((id, index) => id === next[index])) {
            return current;
          }
          return next;
        });
      } finally {
        lastWidth = el.clientWidth;
        measuring = false;
      }
    };

    const observer = new ResizeObserver(() => {
      if (measuring || el.clientWidth === lastWidth) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(el);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [editor, toolbarHidden, editorFocused]);

  useEffect(() => {
    setSlashIndex(0);
  }, [slashQuery]);

  if (!editor) return null;

  indentRef.current = (shift) => {
    if (editor.isActive("table")) return false;
    applyIndent(editor, shift ? -1 : 1);
    return true;
  };

  queueFilesRef.current = (files, position) => {
    if (!editor.isEditable || !files.length) return;
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
      onMouseDown={(e) => e.preventDefault()}
      onClick={action}
      disabled={!editor.isEditable}
      aria-label={label}
      title={label}
    >
      {icon ?? label}
    </button>
  );

  const wrap = (id: string, node: ReactNode, pinned = false) => (
    <span
      key={id}
      data-toolbar-item={id}
      data-toolbar-pinned={pinned ? "true" : undefined}
      className={overflowIds.includes(id) ? "toolbar-item is-overflowed" : "toolbar-item"}
    >
      {node}
    </span>
  );

  const runInsert = (id: InsertMenuId, consumeSlash = false) => {
    const chain = editor.chain().focus();
    if (consumeSlash) {
      const { $from } = editor.state.selection;
      const range = slashConsumeRange($from.start(), $from.parent.textContent);
      if (range) chain.deleteRange(range);
    }
    switch (id) {
      case "attachment":
        chain.run();
        fileRef.current?.click();
        break;
      case "table":
        chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
        break;
      case "code":
        chain.setCodeBlock().run();
        break;
      case "quote":
        chain.setBlockquote().run();
        break;
      case "checkbox":
        chain.insertInlineCheckbox(false).run();
        break;
      case "divider":
        chain.setHorizontalRule().run();
        break;
      case "datetime":
        chain.insertContent(new Date().toLocaleString()).run();
        break;
      case "link":
        chain.run();
        setLinkDialog(openLinkDialog(editor));
        break;
      case "h1":
        chain.setHeading({ level: 1 }).run();
        break;
      case "h2":
        chain.setHeading({ level: 2 }).run();
        break;
      case "h3":
        chain.setHeading({ level: 3 }).run();
        break;
      case "checklist":
        chain.toggleTaskList().run();
        break;
    }
    setSlashQuery(null);
    setShowInsertMenu(false);
  };
  runInsertRef.current = runInsert;

  const runMore = (id: MoreFormatId) => {
    switch (id) {
      case "align-left":
        editor.chain().focus().setTextAlign("left").run();
        break;
      case "align-center":
        editor.chain().focus().setTextAlign("center").run();
        break;
      case "align-right":
        editor.chain().focus().setTextAlign("right").run();
        break;
      case "justify":
        editor.chain().focus().setTextAlign("justify").run();
        break;
      case "outdent":
        applyIndent(editor, -1);
        break;
      case "indent":
        applyIndent(editor, 1);
        break;
      case "strike":
        editor.chain().focus().toggleStrike().run();
        break;
      case "superscript":
        editor.chain().focus().toggleSuperscript().run();
        break;
      case "subscript":
        editor.chain().focus().toggleSubscript().run();
        break;
      case "clear":
        editor.chain().focus().unsetAllMarks().clearNodes().run();
        break;
    }
    setShowOverflow(false);
  };

  const slashItems = slashQuery !== null ? filterInsertItems(slashQuery) : [];
  slashItemsRef.current = slashItems;
  const slashCoords =
    slashQuery !== null ? editor.view.coordsAtPos(editor.state.selection.from) : null;

  const fontClass =
    fontFamily === "serif"
      ? "font-serif"
      : fontFamily === "mono"
        ? "font-mono"
        : "font-sans";

  const fileAttachments = attachments.filter(isFileAttachment);
  const showToolbar = !readOnly && formattingToolbarVisible(toolbarHidden, editorFocused);
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

  const fontFamilyControl = (
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
  );
  const fontSizeControl = (
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
  );
  const codeLanguageControl = (
    <select
      className="toolbar-select code-lang"
      aria-label="Code language"
      value={String(editor.getAttributes("codeBlock").language || "")}
      onChange={(event) => {
        editor
          .chain()
          .focus()
          .updateAttributes("codeBlock", { language: event.target.value })
          .run();
      }}
    >
      {CODE_LANGUAGES.map((language) => (
        <option key={language.label} value={language.id}>
          {language.label}
        </option>
      ))}
    </select>
  );
  const overflowControls: Record<string, ReactNode> = {
    "font-family": fontFamilyControl,
    "font-size": fontSizeControl,
    "code-lang": codeLanguageControl,
    "text-style": <select className="toolbar-select" aria-label="Text style" value={String(editor.getAttributes("heading").level || 0)}
      onChange={(event) => {
        const level = Number(event.target.value) as 0 | 1 | 2 | 3;
        if (level === 0) editor.chain().focus().setParagraph().run();
        else editor.chain().focus().setHeading({ level }).run();
      }}>
      {NOTE_STYLE_OPTIONS.map((style) => <option key={style.id} value={style.heading}>{style.label}</option>)}
    </select>,
    color: <select className="toolbar-select" aria-label="Text color" value={String(editor.getAttributes("textStyle").color || "")}
      onChange={(event) => {
        if (event.target.value) editor.chain().focus().setColor(event.target.value).run();
        else editor.chain().focus().unsetColor().run();
      }}>
      {TEXT_COLORS.map((swatch) => <option key={swatch.id} value={swatch.color || ""}>{swatch.label}</option>)}
    </select>,
  };
  const overflowActions: { id: string; label: string; action: () => void }[] = [
    { id: "bold", label: "Bold", action: () => editor.chain().focus().toggleBold().run() },
    { id: "italic", label: "Italic", action: () => editor.chain().focus().toggleItalic().run() },
    { id: "underline", label: "Underline", action: () => editor.chain().focus().toggleUnderline().run() },
    { id: "highlight", label: "Highlight", action: () => editor.chain().focus().toggleHighlight().run() },
    { id: "bullets", label: "Bulleted list", action: () => editor.chain().focus().toggleBulletList().run() },
    { id: "numbers", label: "Numbered list", action: () => editor.chain().focus().toggleOrderedList().run() },
    { id: "checklist", label: "Checklist", action: () => editor.chain().focus().toggleTaskList().run() },
    { id: "link", label: "Link", action: () => setLinkDialog(openLinkDialog(editor)) },
  ];

  const editorMenuItems: ContextMenuEntry[] = [
    { label: "Cut", shortcut: "Ctrl/⌘ X", onSelect: () => document.execCommand("cut") },
    { label: "Copy", shortcut: "Ctrl/⌘ C", onSelect: () => document.execCommand("copy") },
    { label: "Paste", shortcut: "Ctrl/⌘ V", onSelect: () => document.execCommand("paste") },
    {
      label: "Paste and Match Style",
      onSelect: () =>
        void navigator.clipboard.readText().then((text) => {
          if (!text) return;
          editor.chain().focus().insertContent(escapeHtml(text).replace(/\n/g, "<br>")).run();
        }),
    },
    { type: "separator" },
    { label: "Bold", onSelect: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", onSelect: () => editor.chain().focus().toggleItalic().run() },
    { label: "Highlight", onSelect: () => editor.chain().focus().toggleHighlight().run() },
    { type: "separator" },
    { label: "Bulleted list", onSelect: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", onSelect: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Checklist", onSelect: () => editor.chain().focus().toggleTaskList().run() },
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
          {
            label: "Remove link",
            onSelect: () => editor.chain().focus().unsetLink().run(),
          },
        ]
      : []),
    ...(editor.isActive("image")
      ? [
          {
            label: "Image size",
            children: IMAGE_SIZE_PRESETS.map((preset) => ({
              label: preset.label,
              onSelect: () =>
                editor.chain().focus().updateAttributes("image", { width: preset.width || null }).run(),
            })),
          },
          {
            label: "Add caption…",
            onSelect: () => {
              const current = String(editor.getAttributes("image").title || "");
              const next = window.prompt("Image caption", current);
              if (next === null) return;
              editor.chain().focus().updateAttributes("image", { title: next.trim() || null }).run();
            },
          },
          {
            label: "Align image",
            children: [
              {
                label: "Left",
                onSelect: () =>
                  editor.chain().focus().updateAttributes("image", { align: "left" }).run(),
              },
              {
                label: "Center",
                onSelect: () =>
                  editor.chain().focus().updateAttributes("image", { align: "center" }).run(),
              },
              {
                label: "Right",
                onSelect: () =>
                  editor.chain().focus().updateAttributes("image", { align: "right" }).run(),
              },
            ],
          },
          {
            label: "View image",
            onSelect: () => setLightboxSrc(String(editor.getAttributes("image").src || "")),
          },
          {
            label: "Copy image address",
            onSelect: () =>
              void navigator.clipboard.writeText(String(editor.getAttributes("image").src || "")),
          },
          {
            label: "Save image as…",
            onSelect: () => {
              const src = String(editor.getAttributes("image").src || "");
              if (!src) return;
              const link = document.createElement("a");
              link.href = src;
              link.download = "image";
              link.target = "_blank";
              link.rel = "noopener";
              link.click();
            },
          },
        ]
      : []),
    {
      label: "Check all tasks",
      onSelect: () => {
        const { tr } = editor.state;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "taskItem") {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: true });
          }
        });
        if (tr.docChanged) editor.view.dispatch(tr);
      },
    },
    {
      label: "Uncheck all tasks",
      onSelect: () => {
        const { tr } = editor.state;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "taskItem") {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, checked: false });
          }
        });
        if (tr.docChanged) editor.view.dispatch(tr);
      },
    },
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
          <button
            type="button"
            className={findCaseSensitive ? "ghost-btn small active" : "ghost-btn small"}
            title="Match case"
            aria-pressed={findCaseSensitive}
            onClick={() => {
              setFindCaseSensitive((on) => !on);
              setFindIndex(0);
            }}
          >
            Aa
          </button>
          <button
            type="button"
            className={findWholeWord ? "ghost-btn small active" : "ghost-btn small"}
            title="Whole word"
            aria-pressed={findWholeWord}
            onClick={() => {
              setFindWholeWord((on) => !on);
              setFindIndex(0);
            }}
          >
            W
          </button>
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
      {!toolbarHidden && (
      <div
        ref={toolbarRef}
        className={`editor-toolbar ${showToolbar ? "is-visible" : "is-concealed"}`}
        aria-hidden={!showToolbar}
      >
        {wrap(
          "insert",
          <div className="highlight-picker">
            {btn(
              "Insert",
              () => {
                setShowInsertMenu((open) => !open);
                setShowOverflow(false);
                setShowStyleMenu(false);
              },
              showInsertMenu,
              <Icon.Plus size={16} />
            )}
            {showInsertMenu && (
              <div className="toolbar-overflow-menu insert-menu" onMouseDown={(event) => event.preventDefault()}>
                {INSERT_MENU_ITEMS.map((item) => (
                  <button key={item.id} type="button" onClick={() => runInsert(item.id)}>
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>,
          true
        )}
        {wrap(
          "undo",
          btn("Undo", () => editor.chain().focus().undo().run(), false, <Icon.Undo size={16} />),
          true
        )}
        {wrap(
          "redo",
          btn("Redo", () => editor.chain().focus().redo().run(), false, <Icon.Redo size={16} />),
          true
        )}
        <span className="toolbar-sep" />
        {wrap(
          "text-style",
          <div className="style-picker">
            {btn(
              "Text style",
              () => setShowStyleMenu((open) => !open),
              editor.isActive("heading"),
              <span className="toolbar-text">Aa</span>
            )}
            {showStyleMenu && (
              <div className="style-menu" onMouseDown={(event) => event.preventDefault()}>
                {NOTE_STYLE_OPTIONS.map((style) => {
                  const active =
                    style.heading === 0
                      ? editor.isActive("paragraph") && !editor.isActive("heading")
                      : editor.isActive("heading", { level: style.heading });
                  return (
                    <button
                      key={style.id}
                      type="button"
                      data-style={style.id}
                      className={active ? "style-menu-item is-active" : "style-menu-item"}
                      onClick={() => {
                        const chain = editor.chain().focus();
                        if (style.heading === 0) chain.setParagraph().run();
                        else chain.toggleHeading({ level: style.heading }).run();
                        setShowStyleMenu(false);
                      }}
                    >
                      {style.label}
                      <span
                        className="style-menu-reset"
                        onClick={(event) => {
                          event.stopPropagation();
                          const chain = editor
                            .chain()
                            .focus()
                            .unsetFontFamily()
                            .unsetFontSize()
                            .unsetColor();
                          if (style.heading === 0) chain.setParagraph();
                          else chain.setHeading({ level: style.heading });
                          chain.run();
                          setShowStyleMenu(false);
                        }}
                      >
                        Reset
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
        {wrap("font-family", fontFamilyControl)}
        {wrap("font-size", fontSizeControl)}
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
        <span className="toolbar-sep" />
        <span className="toolbar-list-group" role="group" aria-label="Lists">
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
        </span>
        <span className="toolbar-sep" />
        {wrap("link", btn(
          "Link",
          () => setLinkDialog(openLinkDialog(editor)),
          editor.isActive("link"),
          <Icon.Link size={16} />
        ))}
        {editor.isActive("codeBlock") &&
          wrap("code-lang", codeLanguageControl)}
        {wrap(
          "more",
          <div className="highlight-picker toolbar-overflow">
            {btn(
              "More formatting",
              () => {
                setShowOverflow((open) => !open);
                setShowInsertMenu(false);
                setShowStyleMenu(false);
              },
              showOverflow,
              <span className="toolbar-text">…</span>
            )}
            {showOverflow && (
              <div className="toolbar-overflow-menu" onMouseDown={(event) => { if (!(event.target instanceof HTMLSelectElement)) event.preventDefault(); }}>
                {MORE_FORMAT_ITEMS.map((item) => (
                  <button key={item.id} type="button" onClick={() => runMore(item.id)}>
                    {item.label}
                  </button>
                ))}
                {overflowIds.length > 0 && (
                  <>
                    <div className="toolbar-overflow-sep" />
                    {overflowIds.filter((id) => overflowControls[id]).map((id) => (
                      <label className="overflow-control" key={id}>
                        {id === "font-family" ? "Font" : id === "font-size" ? "Font size" : id === "text-style" ? "Text style" : id === "code-lang" ? "Code language" : "Text color"}
                        {overflowControls[id]}
                      </label>
                    ))}
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
                  </>
                )}
              </div>
            )}
          </div>,
          true
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
      <div className={outlineOpen ? "editor-workspace has-outline" : "editor-workspace"}>
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
          style={{
            ...noteFontStyleVars(
              fontStyles ?? stylesFromLegacy(fontFamily, fontSize, undefined)
            ),
            zoom: zoom / 100,
            ["--editor-line-height" as string]: String(lineHeight),
          }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
      {outlineOpen && (
        <aside className="note-outline" aria-label="Note outline">
          <div className="note-outline-title">
            Outline
            <button
              type="button"
              className="ghost-btn small"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const headings: { level: number; text: string }[] = [];
                editor.state.doc.descendants((node) => {
                  if (node.type.name === "heading") {
                    headings.push({
                      level: Number(node.attrs.level || 1),
                      text: node.textContent || "Untitled heading",
                    });
                  }
                });
                const html = outlineToHtml(headings);
                if (html) editor.chain().focus().insertContentAt(1, html).run();
              }}
            >
              Insert
            </button>
          </div>
          {(() => {
            const headings: { level: number; text: string; pos: number }[] = [];
            editor.state.doc.descendants((node, pos) => {
              if (node.type.name === "heading") {
                headings.push({
                  level: Number(node.attrs.level || 1),
                  text: node.textContent || "Untitled heading",
                  pos,
                });
              }
            });
            if (!headings.length) {
              return <div className="empty-state compact">Add headings to build an outline.</div>;
            }
            return headings.map((heading, index) => (
              <button
                key={`${heading.pos}-${index}`}
                type="button"
                className={`outline-item level-${heading.level}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  editor.chain().focus().setTextSelection(heading.pos + 1).scrollIntoView().run();
                }}
              >
                {heading.text}
              </button>
            ));
          })()}
        </aside>
      )}
      </div>
      {editorMenu && (
        <ContextMenu
          x={editorMenu.x}
          y={editorMenu.y}
          items={editorMenuItems.map((item) => item.type === "separator" || !readOnly ? item : {
            ...item,
            disabled: item.disabled || !["Copy", "Open link", "Copy link", "View image", "Copy image address", "Save image as…"].includes(item.label),
            children: undefined,
          })}
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
      {lightboxSrc && (
        <div className="image-lightbox" onMouseDown={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="" onMouseDown={(event) => event.stopPropagation()} />
          <button type="button" className="image-lightbox-close" onClick={() => setLightboxSrc(null)}>
            Close
          </button>
        </div>
      )}
      {slashQuery !== null && slashCoords && (
        <div
          className="slash-insert-menu"
          style={{ left: slashCoords.left, top: slashCoords.bottom + 6 }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {slashItems.length === 0 ? (
            <div className="slash-insert-empty">No matching inserts</div>
          ) : (
            slashItems.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={index === slashIndex ? "is-active" : ""}
                onClick={() => runInsert(item.id, true)}
              >
                {item.label}
              </button>
            ))
          )}
        </div>
      )}
      {bubblePos && (
        <div
          ref={selectionToolbarRef}
          className="selection-toolbar"
          style={{ left: bubblePos.x, top: bubblePos.y }}
          onMouseDown={(event) => event.preventDefault()}
        >
          {btn(
            "Bold",
            () => editor.chain().focus().toggleBold().run(),
            editor.isActive("bold"),
            <Icon.Bold size={16} />
          )}
          {btn(
            "Italic",
            () => editor.chain().focus().toggleItalic().run(),
            editor.isActive("italic"),
            <Icon.Italic size={16} />
          )}
          {btn(
            "Underline",
            () => editor.chain().focus().toggleUnderline().run(),
            editor.isActive("underline"),
            <Icon.Underline size={16} />
          )}
          {btn(
            "Highlight",
            () => editor.chain().focus().toggleHighlight({ color: HIGHLIGHT_COLORS[0].color }).run(),
            editor.isActive("highlight"),
            <span className="toolbar-text hl">HL</span>
          )}
          {btn(
            "Link",
            () => setLinkDialog(openLinkDialog(editor)),
            editor.isActive("link"),
            <Icon.Link size={16} />
          )}
        </div>
      )}
    </div>
  );
}
