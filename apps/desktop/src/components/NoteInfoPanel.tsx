import { useEffect, useState } from "react";
import { api, Note, NoteRevision, Preferences } from "../api";
import {
  countCharacters,
  countWords,
  formatReminderLabel,
  fromDatetimeLocalValue,
  noteAppLink,
  readingTimeLabel,
  toDatetimeLocalValue,
} from "../uiChrome";
import { Icon } from "./Icons";

export function NoteInfoPanel({
  note,
  dateFormat,
  onClose,
  onPatch,
  onRestored,
}: {
  note: Note;
  dateFormat: Preferences["date_format"];
  onClose: () => void;
  onPatch: (patch: Partial<Note>) => void;
  onRestored: (note: Note) => void;
}) {
  const [revisions, setRevisions] = useState<NoteRevision[]>([]);
  const [copied, setCopied] = useState(false);
  const [sourceUrl, setSourceUrl] = useState(note.source_url || "");
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    setSourceUrl(note.source_url || "");
    setPreviewId(null);
    api.listRevisions(note.id).then(setRevisions).catch(() => setRevisions([]));
  }, [note.id, note.updated_at]);

  const preview = revisions.find((revision) => revision.id === previewId);

  return (
    <aside className="note-info-panel" aria-label="Note info">
      <header className="note-info-header">
        <h3>Note info</h3>
        <button className="icon-btn" onClick={onClose} title="Close">
          <Icon.Close />
        </button>
      </header>
      <div className="note-info-body scroll-pane">
        <dl className="note-info-meta">
          <div>
            <dt>Created</dt>
            <dd>{formatReminderLabel(note.created_at, dateFormat)}</dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatReminderLabel(note.updated_at, dateFormat)}</dd>
          </div>
          <div>
            <dt>Characters</dt>
            <dd>{countCharacters(note.content_plain || "")}</dd>
          </div>
          <div>
            <dt>Reading time</dt>
            <dd>{readingTimeLabel(countWords(note.content_plain || "")) || "—"}</dd>
          </div>
        </dl>

        <label className="note-info-field">
          <span>Reminder</span>
          <div className="note-info-reminder">
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(note.reminder_at)}
              onChange={(event) =>
                onPatch({ reminder_at: fromDatetimeLocalValue(event.target.value) })
              }
            />
            {note.reminder_at && (
              <button type="button" className="ghost-btn small" onClick={() => onPatch({ reminder_at: null })}>
                Clear
              </button>
            )}
          </div>
        </label>

        <label className="note-info-field">
          <span>Source URL</span>
          <input
            value={sourceUrl}
            placeholder="https://"
            onChange={(event) => setSourceUrl(event.target.value)}
            onBlur={() => {
              if ((note.source_url || "") !== sourceUrl) {
                onPatch({ source_url: sourceUrl.trim() || null });
              }
            }}
          />
        </label>
        {note.source_url && (
          <a className="note-info-link" href={note.source_url} target="_blank" rel="noreferrer">
            Open source
          </a>
        )}

        <button
          type="button"
          className="ghost-btn"
          onClick={async () => {
            await navigator.clipboard.writeText(noteAppLink(note.id));
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? "Copied note link" : "Copy note link"}
        </button>

        <h4 className="note-info-history-title">History</h4>
        {revisions.length === 0 && (
          <p className="muted">No earlier versions yet. Edits create snapshots as you type.</p>
        )}
        <ul className="note-history-list">
          {revisions.map((revision) => (
            <li key={revision.id}>
              <button
                type="button"
                className={previewId === revision.id ? "active" : ""}
                onClick={() =>
                  setPreviewId((current) => (current === revision.id ? null : revision.id))
                }
              >
                <strong>{revision.title || "Untitled"}</strong>
                <span>{formatReminderLabel(revision.created_at, dateFormat)}</span>
              </button>
              {previewId === revision.id && (
                <div className="note-history-actions">
                  <button
                    type="button"
                    className="primary-btn small"
                    onClick={async () => {
                      const restored = await api.restoreRevision(note.id, revision.id);
                      onRestored(restored);
                    }}
                  >
                    Restore this version
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {preview && (
          <div
            className="note-history-preview"
            dangerouslySetInnerHTML={{ __html: preview.content }}
          />
        )}
      </div>
    </aside>
  );
}
