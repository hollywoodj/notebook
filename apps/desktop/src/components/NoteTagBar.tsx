import { FormEvent, useMemo, useState } from "react";
import { Tag } from "../api";
import { suggestedTags } from "../uiChrome";
import { Icon } from "./Icons";

export function NoteTagBar({
  tags,
  selectedIds,
  onChange,
  onCreateTag,
}: {
  tags: Tag[];
  selectedIds: string[];
  onChange: (tagIds: string[]) => void;
  onCreateTag?: (name: string) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = tags.filter((tag) => selectedIds.includes(tag.id));
  const suggestions = useMemo(
    () => suggestedTags(tags, query, selectedIds),
    [tags, query, selectedIds]
  );
  const cleaned = query.trim();
  const exactMatch = tags.some((tag) => tag.name.toLowerCase() === cleaned.toLowerCase());
  const canCreate = Boolean(cleaned && !exactMatch && onCreateTag);

  const addTag = (tag: Tag) => {
    if (selectedIds.includes(tag.id)) return;
    onChange([...selectedIds, tag.id]);
    setQuery("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!cleaned) return;
    const match =
      suggestions.find((tag) => tag.name.toLowerCase() === cleaned.toLowerCase()) ||
      tags.find((tag) => tag.name.toLowerCase() === cleaned.toLowerCase());
    if (match) {
      addTag(match as Tag);
      return;
    }
    if (onCreateTag) {
      onCreateTag(cleaned);
      setQuery("");
    }
  };

  return (
    <div className="note-tag-bar">
      <Icon.Tags size={14} />
      {selected.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className="note-tag-chip"
          onClick={() => onChange(selectedIds.filter((id) => id !== tag.id))}
          title="Remove tag"
        >
          #{tag.name}
          <span aria-hidden="true">×</span>
        </button>
      ))}
      <form className="note-tag-form" onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={selected.length ? "Add tag" : "Add a tag"}
          aria-label="Add a tag"
        />
        {(query && suggestions.length > 0) || canCreate ? (
          <div className="note-tag-suggestions">
            {suggestions.map((tag) => (
              <button key={tag.id} type="button" onMouseDown={() => addTag(tag as Tag)}>
                #{tag.name}
              </button>
            ))}
            {canCreate && (
              <button
                type="button"
                className="note-tag-create"
                onMouseDown={() => {
                  onCreateTag?.(cleaned);
                  setQuery("");
                }}
              >
                Create #{cleaned}
              </button>
            )}
          </div>
        ) : null}
      </form>
    </div>
  );
}
