import { useMemo, useState } from "react";
import {
  NoteSummary,
  Notebook,
  TemplateCatalogItem,
} from "../api";
import { Icon } from "./Icons";

const CATEGORIES = [
  "All",
  "Meetings",
  "Work",
  "Project management",
  "Personal",
  "Education",
  "My templates",
];

export function TemplateGallery({
  templates,
  catalog,
  notebooks,
  defaultNotebookId,
  onClose,
  onUse,
  onCreateBlank,
}: {
  templates: NoteSummary[];
  catalog: TemplateCatalogItem[];
  notebooks: Notebook[];
  defaultNotebookId: string;
  onClose: () => void;
  onUse: (templateId: string, notebookId: string) => void;
  onCreateBlank: () => void;
}) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [selectedId, setSelectedId] = useState<string | null>(
    templates[0]?.id ?? null
  );
  const [notebookId, setNotebookId] = useState(defaultNotebookId);

  const descriptions = useMemo(() => {
    const map = new Map(catalog.map((c) => [c.title, c.description]));
    return map;
  }, [catalog]);

  const filtered = useMemo(() => {
    return templates.filter((t) => {
      const cat = t.template_category || "My templates";
      const isBuiltin = catalog.some((c) => c.title === t.title);
      if (category === "My templates" && isBuiltin && cat !== "My templates") {
        return false;
      }
      if (category !== "All" && category !== "My templates" && cat !== category) {
        return false;
      }
      const q = query.trim().toLowerCase();
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.snippet.toLowerCase().includes(q) ||
        cat.toLowerCase().includes(q)
      );
    });
  }, [templates, category, query, catalog]);

  const selected = templates.find((t) => t.id === selectedId) || filtered[0];

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="gallery-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Templates"
      >
        <header className="gallery-header">
          <div>
            <h2>Templates</h2>
            <p>Start from a layout, then make it yours.</p>
          </div>
          <button className="icon-btn" onClick={onClose} title="Close">
            <Icon.Close />
          </button>
        </header>
        <div className="gallery-search">
          <Icon.Search size={16} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search templates"
          />
        </div>
        <div className="gallery-cats">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              className={c === category ? "chip active" : "chip"}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="gallery-body">
          <div className="gallery-grid scroll-pane">
            {filtered.map((t) => (
              <button
                key={t.id}
                className={
                  selected?.id === t.id ? "template-card selected" : "template-card"
                }
                onClick={() => setSelectedId(t.id)}
                onDoubleClick={() => onUse(t.id, notebookId)}
              >
                <div className="template-card-mark">
                  <Icon.Templates size={16} />
                </div>
                <div className="template-card-title">{t.title}</div>
                <div className="template-card-cat">
                  {t.template_category || "My templates"}
                </div>
                <div className="template-card-snippet">
                  {descriptions.get(t.title) || t.snippet || "Custom template"}
                </div>
              </button>
            ))}
            {filtered.length === 0 && (
              <div className="empty-state compact">No templates in this category.</div>
            )}
          </div>
          <aside className="gallery-preview">
            {selected ? (
              <>
                <div className="preview-kicker">
                  {selected.template_category || "My templates"}
                </div>
                <h3>{selected.title}</h3>
                <p>
                  {descriptions.get(selected.title) ||
                    selected.snippet ||
                    "Your custom template."}
                </p>
                <label className="field-label">Create in</label>
                <select
                  value={notebookId}
                  onChange={(e) => setNotebookId(e.target.value)}
                >
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                    </option>
                  ))}
                </select>
                <button
                  className="primary-btn large"
                  onClick={() => onUse(selected.id, notebookId)}
                >
                  Use this template
                </button>
                <button className="ghost-btn" onClick={onCreateBlank}>
                  Start with a blank note
                </button>
              </>
            ) : (
              <div className="empty-state compact">Select a template to preview.</div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}
