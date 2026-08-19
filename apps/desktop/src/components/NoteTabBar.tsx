import { DragEvent } from "react";
import { Icon } from "./Icons";
import { NOTE_TAB_DRAG_TYPE } from "../uiChrome";
import { ContextMenu, ContextMenuEntry } from "./ContextMenu";
import { useState } from "react";

export type NoteTabItem = {
  id: string;
  title: string;
  pinned?: boolean;
  dirty?: boolean;
};

export function NoteTabBar({
  tabs,
  activeTabId,
  canGoBack,
  canGoForward,
  canReopenClosedTab,
  onBack,
  onForward,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseToTheRight,
  onCloseAll,
  onPin,
  onNewTab,
  onReorder,
  onReopenClosed,
}: {
  tabs: NoteTabItem[];
  activeTabId: string;
  canGoBack: boolean;
  canGoForward: boolean;
  canReopenClosedTab?: boolean;
  onBack: () => void;
  onForward: () => void;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers?: (id: string) => void;
  onCloseToTheRight?: (id: string) => void;
  onCloseAll?: () => void;
  onPin?: (id: string) => void;
  onNewTab: () => void;
  onReorder: (fromId: string, toId: string) => void;
  onReopenClosed?: () => void;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number; id: string } | null>(null);

  const onDragStart = (event: DragEvent<HTMLDivElement>, id: string) => {
    event.dataTransfer.setData(NOTE_TAB_DRAG_TYPE, id);
    event.dataTransfer.effectAllowed = "move";
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (![...event.dataTransfer.types].includes(NOTE_TAB_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };

  const onDrop = (event: DragEvent<HTMLDivElement>, toId: string) => {
    const fromId = event.dataTransfer.getData(NOTE_TAB_DRAG_TYPE);
    if (!fromId || fromId === toId) return;
    event.preventDefault();
    onReorder(fromId, toId);
  };

  const menuItems: ContextMenuEntry[] = menu
    ? [
        { label: "Close Tab", onSelect: () => onClose(menu.id) },
        {
          label: "Close Other Tabs",
          disabled: tabs.length < 2,
          onSelect: () => onCloseOthers?.(menu.id),
        },
        {
          label: "Close Tabs to the Right",
          disabled: tabs.findIndex((tab) => tab.id === menu.id) >= tabs.length - 1,
          onSelect: () => onCloseToTheRight?.(menu.id),
        },
        {
          label: "Close All Tabs",
          disabled: tabs.length < 2 && Boolean(tabs[0]?.pinned),
          onSelect: () => onCloseAll?.(),
        },
        { type: "separator" },
        {
          label: tabs.find((tab) => tab.id === menu.id)?.pinned ? "Unpin Tab" : "Pin Tab",
          onSelect: () => onPin?.(menu.id),
        },
        {
          label: "Reopen Closed Tab",
          disabled: !canReopenClosedTab,
          onSelect: () => onReopenClosed?.(),
        },
      ]
    : [];

  return (
    <div className="note-tab-bar" onMouseDown={(event) => event.stopPropagation()}>
      <div className="note-history" role="group" aria-label="History">
        <button
          type="button"
          className="note-history-btn"
          title="Back"
          aria-label="Back"
          disabled={!canGoBack}
          onClick={onBack}
        >
          <Icon.Back size={16} />
        </button>
        <button
          type="button"
          className="note-history-btn"
          title="Forward"
          aria-label="Forward"
          disabled={!canGoForward}
          onClick={onForward}
        >
          <Icon.Forward size={16} />
        </button>
      </div>
      <div className="note-tabs" role="tablist" aria-label="Open notes">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={
                (active ? "note-tab is-active" : "note-tab") +
                (tab.pinned ? " is-pinned" : "") +
                (tab.dirty ? " is-dirty" : "")
              }
              title={tab.title}
              draggable
              onDragStart={(event) => onDragStart(event, tab.id)}
              onDragOver={onDragOver}
              onDrop={(event) => onDrop(event, tab.id)}
              onClick={() => onSelect(tab.id)}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ x: event.clientX, y: event.clientY, id: tab.id });
              }}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              {tab.pinned ? <Icon.Pin size={11} /> : null}
              {tab.dirty ? <span className="note-tab-dirty" aria-label="Unsaved" /> : null}
              <span className="note-tab-title">{tab.title}</span>
              <button
                type="button"
                className="note-tab-close"
                title="Close tab"
                aria-label={`Close ${tab.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <Icon.Close size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="note-tab-new"
        title="New Tab"
        aria-label="New Tab"
        onClick={onNewTab}
      >
        <Icon.Plus size={16} />
      </button>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />
      )}
    </div>
  );
}
