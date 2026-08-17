import { useEffect, useMemo, useRef, useState } from "react";

export function NotebookPickerDialog({
  title,
  notebooks,
  currentId,
  confirmLabel = "Copy",
  onCancel,
  onPick,
}: {
  title: string;
  notebooks: { id: string; name: string }[];
  currentId?: string | null;
  confirmLabel?: string;
  onCancel: () => void;
  onPick: (notebookId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState(
    notebooks.find((notebook) => notebook.id !== currentId)?.id || notebooks[0]?.id || ""
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return notebooks.filter(
      (notebook) => !needle || notebook.name.toLowerCase().includes(needle)
    );
  }, [notebooks, query]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Enter" && selectedId) {
        event.preventDefault();
        onPick(selectedId);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onCancel, onPick, selectedId]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>{title}</h3>
        <input
          ref={inputRef}
          value={query}
          placeholder="Search notebooks"
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="picker-list">
          {filtered.map((notebook) => (
            <button
              type="button"
              key={notebook.id}
              className={selectedId === notebook.id ? "picker-item active" : "picker-item"}
              disabled={notebook.id === currentId}
              onClick={() => setSelectedId(notebook.id)}
            >
              {notebook.name}
              {notebook.id === currentId ? " (current)" : ""}
            </button>
          ))}
          {filtered.length === 0 && <div className="empty-state compact">No notebooks</div>}
        </div>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!selectedId || selectedId === currentId}
            onClick={() => onPick(selectedId)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
