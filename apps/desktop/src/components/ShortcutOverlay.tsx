import { useEffect } from "react";
import { KEYBOARD_SHORTCUTS } from "../uiChrome";
import { Icon } from "./Icons";

export function ShortcutOverlay({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="modal-backdrop jump-backdrop" onMouseDown={onClose}>
      <div
        className="jump-dialog shortcut-overlay"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="shortcut-overlay-head">
          <Icon.Keyboard size={16} />
          <h2>Keyboard shortcuts</h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <Icon.Close />
          </button>
        </div>
        <div className="shortcut-table shortcut-overlay-table">
          {KEYBOARD_SHORTCUTS.map(([action, keys]) => (
            <div key={action} className="shortcut-row">
              <span>{action}</span>
              <kbd>{keys}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
