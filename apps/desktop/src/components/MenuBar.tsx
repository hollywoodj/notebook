import { useEffect, useState } from "react";

export type MenuBarItem =
  | { type: "separator" }
  | {
      label: string;
      shortcut?: string;
      disabled?: boolean;
      onSelect?: () => void;
      children?: MenuBarItem[];
    };

export interface MenuBarGroup {
  label: string;
  items: MenuBarItem[];
}

function isSeparator(
  item: MenuBarItem
): item is Extract<MenuBarItem, { type: "separator" }> {
  return "type" in item && item.type === "separator";
}

function MenuItems({
  items,
  onClose,
}: {
  items: MenuBarItem[];
  onClose: () => void;
}) {
  return (
    <>
      {items.map((item, index) =>
        isSeparator(item) ? (
          <div className="app-menu-separator" role="separator" key={`separator-${index}`} />
        ) : (
          <div className="app-menu-item-wrap" key={`${item.label}-${index}`}>
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              aria-haspopup={item.children?.length ? "menu" : undefined}
              onClick={() => {
                if (item.children?.length) return;
                onClose();
                item.onSelect?.();
              }}
            >
              <span>{item.label}</span>
              {item.children?.length ? (
                <span className="app-menu-arrow" aria-hidden="true">
                  ›
                </span>
              ) : item.shortcut ? (
                <kbd>{item.shortcut}</kbd>
              ) : null}
            </button>
            {item.children?.length ? (
              <div className="app-menu-submenu" role="menu">
                <MenuItems items={item.children} onClose={onClose} />
              </div>
            ) : null}
          </div>
        )
      )}
    </>
  );
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
                <MenuItems items={group.items} onClose={() => setOpenMenu(null)} />
              </div>
            )}
          </div>
        );
      })}
    </header>
  );
}
