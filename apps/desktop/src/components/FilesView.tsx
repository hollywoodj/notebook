import { useEffect, useMemo, useRef, useState } from "react";
import { attachmentUrl, type AttachmentSummary, type Preferences } from "../api";
import { formatDate } from "../appTypes";
import {
  FILE_KIND_FILTERS,
  FILES_VIEW_KEY,
  fileExtensionLabel,
  fileKind,
  fileKindCounts,
  fileKindLabel,
  fileTotalsLabel,
  filesEmptyCopy,
  filterFiles,
  parseFilesViewState,
  sortFiles,
  type FileKind,
  type FilesViewState,
} from "../filesView";
import { formatFileSize } from "./fileAttachment";
import { Icon } from "./Icons";

function KindIcon({ kind, size = 20 }: { kind: FileKind; size?: number }) {
  if (kind === "image") return <Icon.FileImage size={size} />;
  if (kind === "audio") return <Icon.FileAudio size={size} />;
  if (kind === "video") return <Icon.FileVideo size={size} />;
  if (kind === "document") return <Icon.FileDoc size={size} />;
  return <Icon.Paperclip size={size} />;
}

/**
 * Evernote-style Files tab: every attachment across every notebook, filtered by
 * type, searchable, and linked back to the note it came from.
 */
export function FilesView({
  files,
  loaded,
  dateFormat,
  onOpenNote,
}: {
  files: AttachmentSummary[];
  loaded: boolean;
  dateFormat: Preferences["date_format"];
  onOpenNote: (file: AttachmentSummary) => void;
}) {
  const [view, setView] = useState<FilesViewState>(() =>
    parseFilesViewState(
      typeof localStorage === "undefined" ? null : localStorage.getItem(FILES_VIEW_KEY)
    )
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  /** Images whose data failed to load fall back to the generic glyph. */
  const [brokenIds, setBrokenIds] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);

  const persistView = (next: FilesViewState) => {
    setView(next);
    localStorage.setItem(FILES_VIEW_KEY, JSON.stringify(next));
  };

  const counts = useMemo(() => fileKindCounts(files), [files]);
  const visible = useMemo(
    () => sortFiles(filterFiles(files, { kind: view.kind, query }), view.sort),
    [files, view.kind, view.sort, query]
  );

  useEffect(() => {
    if (selectedId && !visible.some((file) => file.id === selectedId)) setSelectedId(null);
  }, [visible, selectedId]);

  const openFile = (file: AttachmentSummary) => {
    window.open(attachmentUrl(file.id), "_blank", "noopener,noreferrer");
  };

  const empty = filesEmptyCopy(view.kind, query);

  const renderCard = (file: AttachmentSummary) => {
    const kind = fileKind(file.mime_type, file.filename);
    const selected = file.id === selectedId;
    return (
      <div
        key={file.id}
        className={selected ? "file-card is-selected" : "file-card"}
        onClick={() => setSelectedId(file.id)}
        onDoubleClick={() => openFile(file)}
      >
        <button
          type="button"
          className="file-card-preview"
          title={`Open ${file.filename}`}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedId(file.id);
            openFile(file);
          }}
        >
          {kind === "image" && !brokenIds.includes(file.id) ? (
            <img
              src={attachmentUrl(file.id)}
              alt=""
              loading="lazy"
              onError={() =>
                setBrokenIds((current) =>
                  current.includes(file.id) ? current : [...current, file.id]
                )
              }
            />
          ) : (
            <span className="file-card-glyph">
              <KindIcon kind={kind} size={30} />
              <span className="file-ext">{fileExtensionLabel(file.filename, file.mime_type)}</span>
            </span>
          )}
        </button>
        <div className="file-card-body">
          <span className="file-name" title={file.filename}>
            {file.filename}
          </span>
          <span className="file-meta">
            {formatFileSize(file.size)} · {formatDate(file.created_at, dateFormat)}
          </span>
          <button
            type="button"
            className="file-note-link"
            title={`Go to “${file.note_title}” in ${file.notebook_name}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpenNote(file);
            }}
          >
            <Icon.Notes size={12} />
            <span>{file.note_title || "Untitled"}</span>
          </button>
        </div>
      </div>
    );
  };

  const renderRow = (file: AttachmentSummary) => {
    const kind = fileKind(file.mime_type, file.filename);
    const selected = file.id === selectedId;
    return (
      <div
        key={file.id}
        className={selected ? "file-row is-selected" : "file-row"}
        onClick={() => setSelectedId(file.id)}
        onDoubleClick={() => openFile(file)}
      >
        <span className="file-row-icon" aria-hidden>
          <KindIcon kind={kind} size={18} />
        </span>
        <span className="file-row-name" title={file.filename}>
          {file.filename}
        </span>
        <button
          type="button"
          className="file-row-note"
          title={`Go to “${file.note_title}” in ${file.notebook_name}`}
          onClick={(event) => {
            event.stopPropagation();
            onOpenNote(file);
          }}
        >
          {file.note_title || "Untitled"}
        </button>
        <span className="file-row-notebook">{file.notebook_name}</span>
        <span className="file-row-kind">{fileKindLabel(kind)}</span>
        <span className="file-row-size">{formatFileSize(file.size)}</span>
        <span className="file-row-date">{formatDate(file.created_at, dateFormat)}</span>
        <span className="file-row-actions">
          <button
            type="button"
            className="icon-btn"
            title={`Open ${file.filename}`}
            aria-label={`Open ${file.filename}`}
            onClick={(event) => {
              event.stopPropagation();
              openFile(file);
            }}
          >
            <Icon.Download size={15} />
          </button>
        </span>
      </div>
    );
  };

  return (
    <section className="files-panel" aria-label="Files">
      <div className="panel-header files-header">
        <div>
          <h2>Files</h2>
          <span className="count" title="Files in this view">
            {loaded ? fileTotalsLabel(visible, formatFileSize) : <>&nbsp;</>}
          </span>
        </div>
        <div className="panel-tools">
          <div className="files-search">
            <Icon.Search size={14} />
            <input
              ref={searchRef}
              type="search"
              value={query}
              placeholder="Search files"
              aria-label="Search files"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <select
            className="list-sort"
            aria-label="Sort files by"
            value={view.sort}
            onChange={(event) =>
              persistView({ ...view, sort: event.target.value as FilesViewState["sort"] })
            }
          >
            <option value="recent">Newest</option>
            <option value="name">Name</option>
            <option value="size">Size</option>
          </select>
          <div className="view-toggle" role="group" aria-label="Files layout">
            <button
              type="button"
              className={view.layout === "grid" ? "active" : ""}
              title="Grid"
              aria-pressed={view.layout === "grid"}
              onClick={() => persistView({ ...view, layout: "grid" })}
            >
              <Icon.Cards size={14} />
            </button>
            <button
              type="button"
              className={view.layout === "list" ? "active" : ""}
              title="List"
              aria-pressed={view.layout === "list"}
              onClick={() => persistView({ ...view, layout: "list" })}
            >
              <Icon.Snippets size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="file-kind-chips" role="tablist" aria-label="File type">
        {FILE_KIND_FILTERS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            role="tab"
            aria-selected={view.kind === entry.id}
            className={view.kind === entry.id ? "file-chip is-active" : "file-chip"}
            onClick={() => persistView({ ...view, kind: entry.id })}
          >
            {entry.label}
            <span className="file-chip-count">{counts[entry.id]}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="files-body scroll-pane">
          {loaded && (
            <div className="empty-state">
              <div className="empty-illustration" aria-hidden>
                <Icon.Files size={36} />
              </div>
              <h3>{empty.title}</h3>
              <p>{empty.body}</p>
            </div>
          )}
        </div>
      ) : view.layout === "grid" ? (
        <div className="files-body scroll-pane">
          <div className="file-grid">{visible.map(renderCard)}</div>
        </div>
      ) : (
        <div className="files-body scroll-pane">
          <div className="file-list">
            <div className="file-row file-row-head" aria-hidden>
              <span className="file-row-icon" />
              <span className="file-row-name">Name</span>
              <span className="file-row-note">Note</span>
              <span className="file-row-notebook">Notebook</span>
              <span className="file-row-kind">Type</span>
              <span className="file-row-size">Size</span>
              <span className="file-row-date">Added</span>
              <span className="file-row-actions" />
            </div>
            {visible.map(renderRow)}
          </div>
        </div>
      )}
    </section>
  );
}
