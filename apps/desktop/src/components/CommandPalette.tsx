import { useEffect, useMemo, useRef, useState } from "react";
import type { PaletteAction } from "../uiChrome";
import { paletteMatches } from "../uiChrome";
import { Icon } from "./Icons";

export function CommandPalette({
  open,
  actions,
  onRun,
  onClose,
}: {
  open: boolean;
  actions: PaletteAction[];
  onRun: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const matches = useMemo(() => paletteMatches(query, actions, 24), [actions, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => (matches.length ? (current + 1) % matches.length : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) =>
          matches.length ? (current - 1 + matches.length) % matches.length : 0
        );
      } else if (event.key === "Enter") {
        event.preventDefault();
        const hit = matches[index];
        if (hit) {
          onRun(hit.id);
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, matches, onClose, onRun, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop jump-backdrop" onMouseDown={onClose}>
      <div
        className="jump-dialog command-palette"
        role="dialog"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="jump-search">
          <Icon.Search size={16} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Type a command…"
            aria-label="Filter commands"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="jump-results">
          {matches.length === 0 && <div className="empty-state compact">No matching commands</div>}
          {matches.map((action, resultIndex) => (
            <button
              type="button"
              key={action.id}
              className={resultIndex === index ? "jump-item active" : "jump-item"}
              onMouseEnter={() => setIndex(resultIndex)}
              onClick={() => {
                onRun(action.id);
                onClose();
              }}
            >
              <span className="jump-title">{action.label}</span>
              {action.hint ? <span className="jump-sub">{action.hint}</span> : null}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
