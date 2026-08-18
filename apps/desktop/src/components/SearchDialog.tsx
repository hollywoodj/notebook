import { useEffect, useMemo, useRef, useState } from "react";
import { jumpToMatches, type JumpTarget } from "../uiChrome";
import { Icon } from "./Icons";

export function SearchDialog({
  query,
  recentSearches,
  scope,
  notes,
  notebooks,
  tags,
  onQueryChange,
  onClearRecent,
  onClearScope,
  onClose,
  onSearch,
  onSelect,
}: {
  query: string;
  recentSearches: string[];
  scope: { id: string; name: string } | null;
  notes: { id: string; title: string; notebook_name: string }[];
  notebooks: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  onQueryChange: (query: string) => void;
  onClearRecent: () => void;
  onClearScope: () => void;
  onClose: () => void;
  onSearch: (query: string) => void;
  onSelect: (target: JumpTarget) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(0);
  const matches = useMemo(
    () => jumpToMatches(query, notes, notebooks, tags, 8),
    [query, notes, notebooks, tags]
  );
  const recents = query.trim() ? [] : recentSearches;
  const showSearchAction = Boolean(query.trim());
  const rows =
    (showSearchAction ? 1 : 0) + recents.length + matches.length;

  useEffect(() => {
    setIndex(0);
  }, [query, recents.length, matches.length]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setIndex((current) => (rows ? (current + 1) % rows : 0));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setIndex((current) => (rows ? (current - 1 + rows) % rows : 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const cleaned = query.trim();
        if (showSearchAction && index === 0) {
          if (cleaned) onSearch(cleaned);
          return;
        }
        const recentIndex = index - (showSearchAction ? 1 : 0);
        if (recentIndex >= 0 && recentIndex < recents.length) {
          onSearch(recents[recentIndex]);
          return;
        }
        const match = matches[recentIndex - recents.length];
        if (match) onSelect(match);
        else if (cleaned) onSearch(cleaned);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [index, matches, onClose, onSearch, onSelect, query, recents, rows, showSearchAction]);

  return (
    <div className="modal-backdrop search-backdrop" onMouseDown={onClose}>
      <div
        className="search-dialog"
        role="dialog"
        aria-label="Search notes"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="search-dialog-field">
          <Icon.Search size={18} />
          <input
            ref={inputRef}
            value={query}
            placeholder="Search notes  notebook: tag: intitle:"
            aria-label="Search notes"
            onChange={(event) => onQueryChange(event.target.value)}
          />
          {scope && (
            <button
              type="button"
              className="search-scope-chip"
              title="Search everywhere"
              onClick={onClearScope}
            >
              in {scope.name}
              <Icon.Close size={11} />
            </button>
          )}
        </div>
        <div className="search-dialog-body">
          {showSearchAction && (
            <button
              type="button"
              className={index === 0 ? "search-dialog-item active" : "search-dialog-item"}
              onMouseEnter={() => setIndex(0)}
              onClick={() => onSearch(query.trim())}
            >
              <Icon.Search size={15} />
              <span>Search notes for “{query.trim()}”</span>
            </button>
          )}
          {recents.length > 0 && (
            <div className="search-dialog-section">
              <div className="search-dialog-head">
                <span>Recent searches</span>
                <button type="button" className="ghost-btn small" onClick={onClearRecent}>
                  Clear
                </button>
              </div>
              {recents.map((item, itemIndex) => {
                const row = (showSearchAction ? 1 : 0) + itemIndex;
                return (
                  <button
                    key={item}
                    type="button"
                    className={row === index ? "search-dialog-item active" : "search-dialog-item"}
                    onMouseEnter={() => setIndex(row)}
                    onClick={() => onSearch(item)}
                  >
                    <Icon.Search size={15} />
                    <span>{item}</span>
                  </button>
                );
              })}
            </div>
          )}
          {matches.length > 0 && (
            <div className="search-dialog-section">
              <div className="search-dialog-head">
                <span>Go to</span>
              </div>
              {matches.map((target, itemIndex) => {
                const row = (showSearchAction ? 1 : 0) + recents.length + itemIndex;
                return (
                  <button
                    key={`${target.kind}-${target.id}`}
                    type="button"
                    className={row === index ? "search-dialog-item active" : "search-dialog-item"}
                    onMouseEnter={() => setIndex(row)}
                    onClick={() => onSelect(target)}
                  >
                    <span className="jump-kind">{target.kind}</span>
                    <span className="jump-title">{target.title}</span>
                    <span className="jump-sub">{target.subtitle}</span>
                  </button>
                );
              })}
            </div>
          )}
          {!showSearchAction && recents.length === 0 && matches.length === 0 && (
            <div className="empty-state compact">Type to search notes, notebooks, and tags.</div>
          )}
        </div>
      </div>
    </div>
  );
}
