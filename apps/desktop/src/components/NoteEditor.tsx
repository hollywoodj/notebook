import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import type { JSONContent } from "@tiptap/core";
import { ReactNode, useEffect, useRef, useState } from "react";
import { api, Attachment, attachmentUrl } from "../api";
import { Icon } from "./Icons";
import {
  FileAttachment,
  contentReferencesAttachment,
  fileAttachmentNode,
  isFileAttachment,
  isPdfFile,
} from "./fileAttachment";

interface Props {
  noteId: string;
  content: string;
  onChange: (html: string) => void;
  onAttach: (file: File) => Promise<Attachment>;
  spellCheck: boolean;
  fontFamily: "default" | "serif" | "mono";
  fontSize: number;
  noteWidth: "readable" | "full";
  placeholder?: string;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  placeholder = "Start writing, or pick a template…",
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const queueFilesRef = useRef<(files: File[], position?: number) => void>(() => {});
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const restoredFilesRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Image.configure({ allowBase64: true }),
      FileAttachment,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "note-editor-content",
        spellcheck: spellCheck ? "true" : "false",
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
        if (
          href &&
          (href.includes("/attachments/") || href.startsWith("notebook-attachment://"))
        ) {
          event.preventDefault();
          window.open(href, "_blank", "noopener,noreferrer");
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
    const nodes: JSONContent[] = missing.map((item) =>
      fileAttachmentNode(item, attachmentUrl(item.id))
    );
    nodes.push({ type: "paragraph" });
    editor.chain().insertContentAt(editor.state.doc.content.size, nodes).run();
  }, [attachments, editor]);

  if (!editor) return null;

  queueFilesRef.current = (files, position) => {
    if (!files.length) return;
    const insertionPosition = position ?? editor.state.selection.from;
    setUploading((count) => count + files.length);
    setUploadError(null);

    void Promise.all(files.map((file) => onAttach(file)))
      .then((uploaded) => {
        setAttachments((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [
            ...current,
            ...uploaded.filter((item) => !seen.has(item.id)),
          ];
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

          nodes.push(fileAttachmentNode(attachment, url));
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

  const fontClass =
    fontFamily === "serif"
      ? "font-serif"
      : fontFamily === "mono"
        ? "font-mono"
        : "font-sans";

  return (
    <div
      className={dragActive ? "note-editor is-dragging" : "note-editor"}
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
      <div className="editor-toolbar">
        {btn(
          "Heading 1",
          () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
          editor.isActive("heading", { level: 1 }),
          <Icon.Heading size={16} />
        )}
        {btn(
          "Heading 2",
          () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
          editor.isActive("heading", { level: 2 }),
          <span className="toolbar-text">H2</span>
        )}
        <span className="toolbar-sep" />
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
          "Strikethrough",
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive("strike"),
          <Icon.Strike size={16} />
        )}
        {btn(
          "Highlight",
          () => editor.chain().focus().toggleHighlight().run(),
          editor.isActive("highlight"),
          <span className="toolbar-text hl">HL</span>
        )}
        <span className="toolbar-sep" />
        {btn(
          "Bulleted list",
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
          <Icon.List size={16} />
        )}
        {btn(
          "Numbered list",
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
          <Icon.Ordered size={16} />
        )}
        {btn(
          "Checkbox",
          () => editor.chain().focus().toggleTaskList().run(),
          editor.isActive("taskList"),
          <Icon.Check size={16} />
        )}
        {btn(
          "Quote",
          () => editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
          <Icon.Quote size={16} />
        )}
        {btn(
          "Code block",
          () => editor.chain().focus().toggleCodeBlock().run(),
          editor.isActive("codeBlock"),
          <Icon.Code size={16} />
        )}
        {btn(
          "Link",
          () => {
            const url = window.prompt("URL");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          },
          editor.isActive("link"),
          <Icon.Link size={16} />
        )}
        {btn("Insert media or file", () => fileRef.current?.click(), false, <Icon.Attach size={16} />)}
        {uploading > 0 && (
          <span className="upload-status">
            Uploading {uploading} {uploading === 1 ? "item" : "items"}…
          </span>
        )}
      </div>
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
      {attachments.filter(isFileAttachment).length > 0 && (
        <div className="note-attachments">
          {attachments.filter(isFileAttachment).map((attachment) => (
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
      {dragActive && (
        <div className="media-drop-overlay">
          <Icon.Attach size={28} />
          <strong>Drop files into this note</strong>
          <span>Images appear inline; other files become attachments.</span>
        </div>
      )}
      <div className="editor-scroll">
        <div
          className={`editor-page ${fontClass} ${noteWidth === "readable" ? "readable" : "full"}`}
          style={{ fontSize: `${fontSize}px` }}
        >
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
