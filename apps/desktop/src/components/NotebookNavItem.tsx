import type { DragEvent, MouseEvent } from "react";
import { Notebook } from "../api";
import { navCountLabel } from "../uiChrome";
import { Icon } from "./Icons";

export function NotebookNavItem({
  notebook,
  active,
  isDropTarget,
  onSelect,
  onDragOver,
  onDragLeave,
  onDrop,
  onContextMenu,
}: {
  notebook: Notebook;
  active: boolean;
  isDropTarget: boolean;
  onSelect: () => void;
  onDragOver: (event: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (event: DragEvent) => void;
  onContextMenu: (event: MouseEvent) => void;
}) {
  return (
    <button
      className={
        (active ? "nav-item active indent" : "nav-item indent") +
        (isDropTarget ? " drop-target" : "")
      }
      onClick={onSelect}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
    >
      <span className="nav-item-text">
        {notebook.name}
        {notebook.is_default ? (
          <span className="default-notebook-star" title="Default notebook">
            <Icon.Shortcuts size={11} />
          </span>
        ) : null}
      </span>
      <span className="nav-count">{navCountLabel(notebook.note_count)}</span>
    </button>
  );
}
