import { useEffect, useMemo, useRef, useState } from "react";
import { jumpToMatches, type JumpKind, type JumpTarget } from "../uiChrome";
import { Icon } from "./Icons";

export function JumpToDialog({
  notes,
  notebooks,
  tags,
  mode = "all",
  onClose,
  onSelect,
}: {
  notes: { id: string; title: string; notebook_name: string }[];
  notebooks: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  mode?: "all" | "notebook" | "tag";
  onClose: () => void;
  onSelect: (target: JumpTarget) => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const kinds: JumpKind[] | undefined =
    mode === "notebook" ? ["notebook"] : mode === "tag" ? ["tag"] : undefined;
  const results = useMemo(
    () => jumpToMatches(query, notes, notebooks, tags, 12, kinds),
    [query, notes, notebooks, tags, kinds]
  );

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => (results.length ? (current + 1) % results.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) =>
          results.length ? (current - 1 + results.length) % results.length : 0
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        const target = results[index];
        if (target) onSelect(target);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, onClose, onSelect, results]);

  return (
    <div className="modal-backdrop jump-backdrop" onMouseDown={onClose}>
      <div
        className="jump-dialog"
        role="dialog"
        aria-label={
          mode === "notebook" ? "Go to notebook" : mode === "tag" ? "Go to tag" : "Jump to"
        }
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="jump-search">
          <Icon.Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder={
              mode === "notebook"
                ? "Go to a notebook"
                : mode === "tag"
                  ? "Go to a tag"
                  : "Jump to a note, notebook, or tag"
            }
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="jump-results">
          {results.length === 0 && <div className="empty-state compact">No matches</div>}
          {results.map((target, resultIndex) => (
            <button
              type="button"
              key={`${target.kind}-${target.id}`}
              className={resultIndex === index ? "jump-item active" : "jump-item"}
              onMouseEnter={() => setIndex(resultIndex)}
              onClick={() => onSelect(target)}
            >
              <span className="jump-kind">{target.kind}</span>
              <span className="jump-title">{target.title}</span>
              <span className="jump-sub">{target.subtitle}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
