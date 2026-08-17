import { ViewFilter } from "../api";
import { emptyStateCopy } from "../uiChrome";
import { Icon } from "./Icons";

export function EmptyListState({
  filter,
  onCreate,
  onBrowseTemplates,
}: {
  filter: ViewFilter;
  onCreate: () => void;
  onBrowseTemplates: () => void;
}) {
  const copy = emptyStateCopy(
    filter.type,
    filter.type === "notebook" || filter.type === "tag"
      ? filter.name
      : filter.type === "search"
        ? filter.query
        : ""
  );
  const icon =
    filter.type === "trash" ? (
      <Icon.Trash size={36} />
    ) : filter.type === "shortcuts" ? (
      <Icon.Shortcuts size={36} />
    ) : filter.type === "reminders" ? (
      <Icon.Reminder size={36} />
    ) : filter.type === "templates" ? (
      <Icon.Templates size={36} />
    ) : filter.type === "tag" ? (
      <Icon.Tags size={36} />
    ) : filter.type === "search" ? (
      <Icon.Search size={36} />
    ) : (
      <Icon.Notes size={36} />
    );
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden>
        {icon}
      </div>
      <h3>{copy.title}</h3>
      <p>{copy.body}</p>
      {filter.type === "templates" ? (
        <div className="empty-actions">
          <button type="button" className="primary-btn" onClick={onBrowseTemplates}>
            Open gallery
          </button>
        </div>
      ) : filter.type !== "trash" && filter.type !== "search" ? (
        <div className="empty-actions">
          <button type="button" className="primary-btn" onClick={onCreate}>
            New note
          </button>
        </div>
      ) : null}
    </div>
  );
}
