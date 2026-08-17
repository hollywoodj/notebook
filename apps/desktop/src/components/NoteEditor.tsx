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
import { Attachment, attachmentUrl } from "../api";
import { Icon } from "./Icons";

interface Props {
  content: string;
  onChange: (html: string) => void;
  onAttach: (file: File) => Promise<Attachment>;
  spellCheck: boolean;
  fontFamily: "default" | "serif" | "mono";
  fontSize: number;
  noteWidth: "readable" | "full";
  placeholder?: string;
}

export function NoteEditor({
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

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      Link.configure({ openOnClick: false }),
      Highlight,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder }),
      Image,
    ],
    content,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "note-editor-content",
        spellcheck: spellCheck ? "true" : "false",
      },
      handleDrop: (view, event) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        setDragActive(false);
        const position = view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        })?.pos;
        queueFilesRef.current(files, position);
        return true;
      },
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (!files.length) return false;
        event.preventDefault();
        queueFilesRef.current(files);
        return true;
      },
    },
  });

  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, false);
    }
  }, [content, editor]);

  useEffect(() => {
    editor?.setOptions({
      editorProps: {
        attributes: {
          class: "note-editor-content",
          spellcheck: spellCheck ? "true" : "false",
        },
      },
    });
  }, [spellCheck, editor]);

  if (!editor) return null;

  queueFilesRef.current = (files, position) => {
    if (!files.length) return;
    const insertionPosition = position ?? editor.state.selection.from;
    setUploading((count) => count + files.length);
    setUploadError(null);

    void Promise.all(files.map((file) => onAttach(file)))
      .then((attachments) => {
        const nodes: JSONContent[] = [];
        attachments.forEach((attachment) => {
          const url = attachmentUrl(attachment.id);
          if (attachment.mime_type.startsWith("image/")) {
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

          nodes.push({
            type: "paragraph",
            content: [
              {
                type: "text",
                text: `📎 ${attachment.filename}`,
                marks: [
                  {
                    type: "link",
                    attrs: {
                      href: url,
                      target: "_blank",
                      rel: "noopener noreferrer",
                    },
                  },
                ],
              },
            ],
          });
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
      onDrop={() => setDragActive(false)}
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
