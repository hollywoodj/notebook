import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import { ReactNode, useEffect, useRef } from "react";
import { Icon } from "./Icons";

interface Props {
  content: string;
  onChange: (html: string) => void;
  onAttach: (file: File) => void;
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
    <div className="note-editor">
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
        {btn("Attach", () => fileRef.current?.click(), false, <Icon.Attach size={16} />)}
      </div>
      <input
        ref={fileRef}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onAttach(file);
          e.target.value = "";
        }}
      />
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
