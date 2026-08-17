import { DragEvent } from "react";
import { Icon } from "./Icons";
import { NOTE_TAB_DRAG_TYPE } from "../uiChrome";

export type NoteTabItem = {
  id: string;
  title: string;
};

export function NoteTabBar({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTab,
  onReorder,
}: {
  tabs: NoteTabItem[];
  activeTabId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNewTab: () => void;
  onReorder: (fromId: string, toId: string) => void;
}) {
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

  return (
    <div className="note-tab-bar" onMouseDown={(event) => event.stopPropagation()}>
      <div className="note-tabs" role="tablist" aria-label="Open notes">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={active}
              className={active ? "note-tab is-active" : "note-tab"}
              title={tab.title}
              draggable
              onDragStart={(event) => onDragStart(event, tab.id)}
              onDragOver={onDragOver}
              onDrop={(event) => onDrop(event, tab.id)}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
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
    </div>
  );
}
