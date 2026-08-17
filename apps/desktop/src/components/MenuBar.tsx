import { useEffect, useState } from "react";

export type MenuBarItem =
  | { type: "separator" }
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect: () => void;
    };

export interface MenuBarGroup {
  label: string;
  items: MenuBarItem[];
}

export function MenuBar({ groups }: { groups: MenuBarGroup[] }) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  useEffect(() => {
    const close = () => setOpenMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <header
      className="app-menu-bar"
      onMouseDown={(event) => event.stopPropagation()}
      role="menubar"
      aria-label="Application menu"
    >
      <div className="app-menu-brand" aria-label="Notebook">
        <span className="app-menu-logo">N</span>
        <span>Notebook</span>
      </div>
      {groups.map((group) => {
        const open = openMenu === group.label;
        return (
          <div
            className="app-menu-group"
            key={group.label}
            onMouseEnter={() => openMenu && setOpenMenu(group.label)}
          >
            <button
              type="button"
              className={open ? "app-menu-trigger active" : "app-menu-trigger"}
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpenMenu(open ? null : group.label)}
            >
              {group.label}
            </button>
            {open && (
              <div className="app-menu-dropdown" role="menu">
                {group.items.map((item, index) =>
                  item.type === "separator" ? (
                    <div
                      className="app-menu-separator"
                      role="separator"
                      key={`separator-${index}`}
                    />
                  ) : (
                    <button
                      type="button"
                      role="menuitem"
                      key={`${item.label}-${index}`}
                      disabled={item.disabled}
                      onClick={() => {
                        setOpenMenu(null);
                        item.onSelect();
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <kbd>{item.shortcut}</kbd>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        );
      })}
    </header>
  );
}
