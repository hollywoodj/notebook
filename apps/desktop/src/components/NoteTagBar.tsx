import { FormEvent, useMemo, useState } from "react";
import { Tag } from "../api";
import { suggestedTags } from "../uiChrome";
import { Icon } from "./Icons";

export function NoteTagBar({
  tags,
  selectedIds,
  onChange,
}: {
  tags: Tag[];
  selectedIds: string[];
  onChange: (tagIds: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = tags.filter((tag) => selectedIds.includes(tag.id));
  const suggestions = useMemo(
    () => suggestedTags(tags, query, selectedIds),
    [tags, query, selectedIds]
  );

  const addTag = (tag: Tag) => {
    if (selectedIds.includes(tag.id)) return;
    onChange([...selectedIds, tag.id]);
    setQuery("");
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const match =
      suggestions.find((tag) => tag.name.toLowerCase() === query.trim().toLowerCase()) ||
      suggestions[0];
    if (match) addTag(match as Tag);
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
        {query && suggestions.length > 0 && (
          <div className="note-tag-suggestions">
            {suggestions.map((tag) => (
              <button key={tag.id} type="button" onMouseDown={() => addTag(tag as Tag)}>
                #{tag.name}
              </button>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
