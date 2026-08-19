import { useEffect, useMemo, useRef, useState } from "react";
import { jumpToMatches, type JumpTarget, type SavedSearch } from "../uiChrome";
import { Icon } from "./Icons";

export function SearchDialog({
  query,
  recentSearches,
  savedSearches,
  scope,
  notes,
  notebooks,
  tags,
  onQueryChange,
  onClearRecent,
  onClearScope,
  onSaveSearch,
  onDeleteSearch,
  onClose,
  onSearch,
  onSelect,
}: {
  query: string;
  recentSearches: string[];
  savedSearches: SavedSearch[];
  scope: { id: string; name: string } | null;
  notes: { id: string; title: string; notebook_name: string }[];
  notebooks: { id: string; name: string }[];
  tags: { id: string; name: string }[];
  onQueryChange: (query: string) => void;
  onClearRecent: () => void;
  onClearScope: () => void;
  onSaveSearch: (query: string) => void;
  onDeleteSearch: (id: string) => void;
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
  const trimmed = query.trim();
  const recents = trimmed ? [] : recentSearches;
  const saved = trimmed ? [] : savedSearches;
  const showSearchAction = Boolean(trimmed);
  const showSaveAction = showSearchAction;
  const prefix = (showSearchAction ? 1 : 0) + (showSaveAction ? 1 : 0);
  const rows = prefix + saved.length + recents.length + matches.length;

  useEffect(() => {
    setIndex(0);
  }, [query, recents.length, saved.length, matches.length]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
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
        if (showSearchAction && index === 0) {
          if (trimmed) onSearch(trimmed);
          return;
        }
        if (showSaveAction && index === 1) {
          onSaveSearch(trimmed);
          return;
        }
        const savedIndex = index - prefix;
        if (savedIndex >= 0 && savedIndex < saved.length) {
          onSearch(saved[savedIndex].query);
          return;
        }
        const recentIndex = savedIndex - saved.length;
        if (recentIndex >= 0 && recentIndex < recents.length) {
          onSearch(recents[recentIndex]);
          return;
        }
        const match = matches[recentIndex - recents.length];
        if (match) onSelect(match);
        else if (trimmed) onSearch(trimmed);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    index,
    matches,
    onClose,
    onSaveSearch,
    onSearch,
    onSelect,
    prefix,
    query,
    recents,
    rows,
    saved,
    showSaveAction,
    showSearchAction,
    trimmed,
  ]);

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
            placeholder="Search notes  notebook: tag: created: resource:"
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
              onClick={() => onSearch(trimmed)}
            >
              <Icon.Search size={15} />
              <span>Search notes for “{trimmed}”</span>
            </button>
          )}
          {showSaveAction && (
            <button
              type="button"
              className={index === 1 ? "search-dialog-item active" : "search-dialog-item"}
              onMouseEnter={() => setIndex(1)}
              onClick={() => onSaveSearch(trimmed)}
            >
              <Icon.Shortcuts size={15} />
              <span>Save this search</span>
            </button>
          )}
          {saved.length > 0 && (
            <div className="search-dialog-section">
              <div className="search-dialog-head">
                <span>Saved searches</span>
              </div>
              {saved.map((item, itemIndex) => {
                const row = prefix + itemIndex;
                return (
                  <div
                    key={item.id}
                    className={
                      row === index
                        ? "search-saved-row search-dialog-item active"
                        : "search-saved-row search-dialog-item"
                    }
                    onMouseEnter={() => setIndex(row)}
                  >
                    <button
                      type="button"
                      className="search-saved-run"
                      onClick={() => onSearch(item.query)}
                    >
                      <Icon.Shortcuts size={15} />
                      <span className="search-saved-name">{item.name}</span>
                      {item.name !== item.query ? (
                        <span className="search-saved-query">{item.query}</span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      className="search-saved-delete"
                      aria-label={`Delete saved search ${item.name}`}
                      onClick={() => onDeleteSearch(item.id)}
                    >
                      <Icon.Close size={11} />
                    </button>
                  </div>
                );
              })}
            </div>
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
                const row = prefix + saved.length + itemIndex;
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
                const row = prefix + saved.length + recents.length + itemIndex;
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
          {!showSearchAction && saved.length === 0 && recents.length === 0 && matches.length === 0 && (
            <div className="empty-state compact">Type to search notes, notebooks, and tags.</div>
          )}
        </div>
      </div>
    </div>
  );
}
