import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";

export type ContextMenuEntry =
  | { type: "separator" }
  | {
      type?: "item";
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      checked?: boolean;
      danger?: boolean;
      disabled?: boolean;
      onSelect?: () => void;
      children?: ContextMenuEntry[];
    };

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x, y });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    setPosition({
      x: Math.max(margin, Math.min(x, window.innerWidth - rect.width - margin)),
      y: Math.max(margin, Math.min(y, window.innerHeight - rect.height - margin)),
    });
    menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="Context menu"
      style={{ left: position.x, top: position.y }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {items.map((item, index) =>
        item.type === "separator" ? (
          <div className="context-menu-separator" role="separator" key={index} />
        ) : (
          <div className="context-menu-item-wrap" key={`${item.label}-${index}`}>
            <button
              className={`context-menu-item${item.danger ? " danger-text" : ""}`}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                if (item.children?.length) return;
                item.onSelect?.();
                onClose();
              }}
            >
              <span className="context-menu-icon">
                {item.checked ? "✓" : item.icon || null}
              </span>
              <span className="context-menu-label">{item.label}</span>
              {item.shortcut && (
                <span className="context-menu-shortcut">{item.shortcut}</span>
              )}
              {item.children?.length ? (
                <span className="context-menu-arrow" aria-hidden="true">
                  ›
                </span>
              ) : null}
            </button>
            {item.children?.length ? (
              <div className="context-submenu" role="menu">
                {item.children.map((child, childIndex) =>
                  child.type === "separator" ? (
                    <div
                      className="context-menu-separator"
                      role="separator"
                      key={childIndex}
                    />
                  ) : (
                    <button
                      className={`context-menu-item${child.danger ? " danger-text" : ""}`}
                      type="button"
                      role="menuitem"
                      disabled={child.disabled}
                      key={`${child.label}-${childIndex}`}
                      onClick={() => {
                        child.onSelect?.();
                        onClose();
                      }}
                    >
                      <span className="context-menu-icon">
                        {child.checked ? "✓" : child.icon || null}
                      </span>
                      <span className="context-menu-label">{child.label}</span>
                    </button>
                  )
                )}
              </div>
            ) : null}
          </div>
        )
      )}
    </div>
  );
}
