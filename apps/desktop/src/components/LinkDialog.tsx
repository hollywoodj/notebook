import { useEffect, useRef, useState } from "react";

export function LinkDialog({
  href = "",
  text = "",
  onCancel,
  onSave,
  onRemove,
  onOpen,
  onCopy,
}: {
  href?: string;
  text?: string;
  onCancel: () => void;
  onSave: (href: string, text: string) => void;
  onRemove?: () => void;
  onOpen?: (href: string) => void;
  onCopy?: (href: string) => void;
}) {
  const [url, setUrl] = useState(href);
  const [label, setLabel] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCancel();
      } else if (event.key === "Enter") {
        event.preventDefault();
        if (url.trim()) onSave(url.trim(), label);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [label, onCancel, onSave, url]);

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal"
        role="dialog"
        aria-label="Insert link"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h3>{href ? "Edit link" : "Insert link"}</h3>
        <label className="modal-field">
          <span>URL</span>
          <input
            ref={inputRef}
            value={url}
            placeholder="https://"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <label className="modal-field">
          <span>Text</span>
          <input
            value={label}
            placeholder="Display text"
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        {href && (onOpen || onCopy) ? (
          <div className="modal-link-actions">
            {onOpen ? (
              <button type="button" className="ghost-btn small" onClick={() => onOpen(url.trim() || href)}>
                Open
              </button>
            ) : null}
            {onCopy ? (
              <button type="button" className="ghost-btn small" onClick={() => onCopy(url.trim() || href)}>
                Copy
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="modal-actions">
          {href && onRemove ? (
            <button type="button" className="danger-text" onClick={onRemove}>
              Remove
            </button>
          ) : (
            <span />
          )}
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="primary-btn"
            disabled={!url.trim()}
            onClick={() => onSave(url.trim(), label)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
