import TaskItem from "@tiptap/extension-task-item";
import type { Editor } from "@tiptap/core";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type ReactNodeViewProps,
} from "@tiptap/react";

function taskItemStartAt(editor: Editor, position: number) {
  const resolved = editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth -= 1) {
    if (resolved.node(depth).type.name === "taskItem") return resolved.before(depth);
  }
  return null;
}

function reorderTaskItem(editor: Editor, source: number, target: number, afterTarget: boolean) {
  if (source === target) return false;

  const sourcePos = editor.state.doc.resolve(source);
  const targetPos = editor.state.doc.resolve(target);
  if (sourcePos.parent !== targetPos.parent) return false;

  const parent = sourcePos.parent;
  const sourceIndex = sourcePos.index();
  const targetIndex = targetPos.index();
  let destinationIndex = targetIndex + (afterTarget ? 1 : 0);
  if (sourceIndex < destinationIndex) destinationIndex -= 1;
  if (destinationIndex === sourceIndex) return false;

  const items = Array.from({ length: parent.childCount }, (_, index) => parent.child(index));
  const [item] = items.splice(sourceIndex, 1);
  if (!item) return false;
  items.splice(destinationIndex, 0, item);

  const contentStart = sourcePos.start();
  const transaction = editor.state.tr.replaceWith(
    contentStart,
    sourcePos.end(),
    Fragment.fromArray(items)
  );
  const newPosition =
    contentStart + items.slice(0, destinationIndex).reduce((size, node) => size + node.nodeSize, 0);
  transaction.setSelection(NodeSelection.create(transaction.doc, newPosition));
  editor.view.dispatch(transaction.scrollIntoView());
  editor.view.focus();
  return true;
}

function moveTaskItem(editor: Editor, getPos: () => number | undefined, direction: -1 | 1) {
  const source = getPos();
  if (typeof source !== "number") return false;

  const resolved = editor.state.doc.resolve(source);
  const index = resolved.index();
  const parent = resolved.parent;
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= parent.childCount) return false;
  const target =
    source +
    (direction < 0 ? -parent.child(targetIndex).nodeSize : parent.child(index).nodeSize);
  return reorderTaskItem(editor, source, target, direction > 0);
}

function TaskItemView({ editor, getPos, node, updateAttributes }: ReactNodeViewProps) {
  const checked = Boolean(node.attrs.checked);
  const itemLabel = node.textContent.trim() || "empty checklist item";
  const dragCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => dragCleanupRef.current?.(), []);

  const startDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (event.button !== 0 || !editor.isEditable) return;
    const source = getPos();
    if (typeof source !== "number") return;

    event.preventDefault();
    const handle = event.currentTarget;
    const sourceRow = handle.closest<HTMLElement>(".task-item-node");
    const origin = { x: event.clientX, y: event.clientY };
    let dragging = false;
    let target: { position: number; after: boolean; row: HTMLElement } | null = null;

    const clearTarget = () => {
      document
        .querySelectorAll(".task-item-node.is-task-drop-before, .task-item-node.is-task-drop-after")
        .forEach((row) => row.classList.remove("is-task-drop-before", "is-task-drop-after"));
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.body.classList.remove("is-task-reordering");
      sourceRow?.classList.remove("is-task-drag-source");
      clearTarget();
      dragCleanupRef.current = null;
    };
    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (!dragging && Math.hypot(pointerEvent.clientX - origin.x, pointerEvent.clientY - origin.y) < 4) {
        return;
      }
      dragging = true;
      pointerEvent.preventDefault();
      document.body.classList.add("is-task-reordering");
      sourceRow?.classList.add("is-task-drag-source");

      const row = document
        .elementFromPoint(pointerEvent.clientX, pointerEvent.clientY)
        ?.closest<HTMLElement>(".task-item-node");
      clearTarget();
      target = null;
      if (!row || row === sourceRow || !editor.view.dom.contains(row)) return;

      const domPosition = editor.view.posAtDOM(row, 0);
      const position = taskItemStartAt(editor, domPosition);
      if (position === null) return;
      const sourceParent = editor.state.doc.resolve(source).parent;
      const targetParent = editor.state.doc.resolve(position).parent;
      if (sourceParent !== targetParent) return;

      const bounds = row.getBoundingClientRect();
      const after = pointerEvent.clientY >= bounds.top + bounds.height / 2;
      row.classList.add(after ? "is-task-drop-after" : "is-task-drop-before");
      target = { position, after, row };
    };
    const onPointerUp = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      const destination = target;
      cleanup();
      if (dragging && destination) {
        reorderTaskItem(editor, source, destination.position, destination.after);
      } else {
        handle.focus();
      }
    };
    const onPointerCancel = () => cleanup();

    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerUp, { once: true });
    document.addEventListener("pointercancel", onPointerCancel, { once: true });
  };

  return (
    <NodeViewWrapper className="task-item-row">
      <span
        className="task-item-drag-handle"
        contentEditable={false}
        data-drag-handle
        role="button"
        tabIndex={0}
        aria-label={`Drag to reorder ${itemLabel}. Use Alt plus arrow keys for keyboard reordering.`}
        title="Drag to reorder · Alt+↑/↓"
        onPointerDown={startDrag}
        onKeyDown={(event) => {
          if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
          event.preventDefault();
          moveTaskItem(editor, getPos, event.key === "ArrowUp" ? -1 : 1);
        }}
      >
        <span aria-hidden="true">⠿</span>
      </span>
      <label className="task-item-check" contentEditable={false}>
        <input
          type="checkbox"
          checked={checked}
          disabled={!editor.isEditable}
          aria-label={`Mark ${itemLabel} ${checked ? "incomplete" : "complete"}`}
          onMouseDown={(event) => event.preventDefault()}
          onChange={(event) => updateAttributes({ checked: event.currentTarget.checked })}
        />
        <span />
      </label>
      <NodeViewContent className="task-item-content" />
    </NodeViewWrapper>
  );
}

/** Evernote-style checklist row with a gutter drag handle. */
export const DraggableTaskItem = TaskItem.extend({
  draggable: false,

  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView, {
      as: "li",
      className: "task-item-node",
      attrs: ({ node, HTMLAttributes }) => ({
        ...HTMLAttributes,
        "data-type": "taskItem",
        "data-checked": String(Boolean(node.attrs.checked)),
      }),
    });
  },
});
