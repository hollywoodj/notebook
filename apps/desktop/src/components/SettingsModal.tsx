import { ReactNode, useEffect, useState } from "react";
import { Account, Notebook, Preferences } from "../api";
import { Icon } from "./Icons";

export type SettingsSection =
  | "application"
  | "notes"
  | "notebooks"
  | "sidebar"
  | "shortcuts"
  | "account"
  | "import"
  | "advanced"
  | "about";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Icon.Application }[] = [
  { id: "application", label: "Application", icon: Icon.Application },
  { id: "notes", label: "Notes", icon: Icon.Notes },
  { id: "notebooks", label: "Notebooks", icon: Icon.Notebooks },
  { id: "sidebar", label: "Sidebar", icon: Icon.List },
  { id: "shortcuts", label: "Keyboard shortcuts", icon: Icon.Keyboard },
  { id: "account", label: "Account", icon: Icon.Account },
  { id: "import", label: "Import & Export", icon: Icon.Import },
  { id: "advanced", label: "Advanced", icon: Icon.Advanced },
  { id: "about", label: "About", icon: Icon.Info },
];

const SHORTCUTS = [
  ["New note", "Ctrl/⌘ N"],
  ["New note from template", "Ctrl/⌘ Shift N"],
  ["Find in note", "Ctrl/⌘ F"],
  ["Find and replace", "Ctrl/⌘ H"],
  ["Search all notes", "Ctrl/⌘ Shift F"],
  ["Hide / show note list", "Ctrl/⌘ Alt ←"],
  ["Expand / restore note", "Ctrl/⌘ Alt →"],
  ["Jump to note, notebook, or tag", "Ctrl/⌘ J"],
  ["Print note", "Ctrl/⌘ P"],
  ["Note info", "Ctrl/⌘ Shift I"],
  ["Zoom in", "Ctrl/⌘ +"],
  ["Zoom out", "Ctrl/⌘ -"],
  ["Actual size", "Ctrl/⌘ 0"],
  ["Settings", "Ctrl/⌘ ,"],
  ["Keyboard shortcuts", "Ctrl/⌘ /"],
  ["Templates", "Ctrl/⌘ Shift T"],
  ["Select all notes", "Ctrl/⌘ A"],
  ["Range select notes", "Shift+click"],
  ["Drag-select notes", "Click and drag"],
  ["Toggle note selection", "Ctrl/⌘+click"],
  ["Move selected notes to trash", "Delete"],
  ["Bold", "Ctrl/⌘ B"],
  ["Italic", "Ctrl/⌘ I"],
  ["Underline", "Ctrl/⌘ U"],
  ["Bulleted list", "Ctrl/⌘ Shift L"],
  ["Numbered list", "Ctrl/⌘ Shift O"],
  ["Checklist", "Ctrl/⌘ Shift C"],
  ["Increase indent", "Tab"],
  ["Decrease indent", "Shift+Tab"],
  ["Focus mode", "F11"],
];

export function SettingsModal({
  prefs,
  account,
  notebooks,
  version,
  storage,
  onClose,
  onSavePrefs,
  onSaveAccount,
  onResetPrefs,
  onRestoreTemplates,
  onImport,
  onEmptyTrash,
  initialSection = "application",
}: {
  prefs: Preferences;
  account: Account;
  notebooks: Notebook[];
  version: string;
  storage: { database: string; attachments: string };
  onClose: () => void;
  onSavePrefs: (patch: Partial<Preferences>) => void;
  onSaveAccount: (patch: Partial<Account>) => void;
  onResetPrefs: () => void;
  onRestoreTemplates: () => void;
  onImport: () => void;
  onEmptyTrash: () => void;
  initialSection?: SettingsSection;
}) {
  const [section, setSection] = useState<SettingsSection>(initialSection);
  const [name, setName] = useState(account.display_name);
  const [email, setEmail] = useState(account.email);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="settings-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Settings"
      >
        <aside className="settings-nav">
          <div className="settings-nav-title">Settings</div>
          {SECTIONS.map((s) => {
            const Glyph = s.icon;
            return (
              <button
                key={s.id}
                className={section === s.id ? "settings-nav-item active" : "settings-nav-item"}
                onClick={() => setSection(s.id)}
              >
                <Glyph size={16} />
                {s.label}
              </button>
            );
          })}
        </aside>
        <section className="settings-content">
          <header className="settings-header">
            <h2>{SECTIONS.find((s) => s.id === section)?.label}</h2>
            <button className="icon-btn" onClick={onClose} title="Close">
              <Icon.Close />
            </button>
          </header>
          <div className="settings-body scroll-pane">
            {section === "application" && (
              <>
                <SettingsRow
                  title="Theme"
                  hint="Light, dark, or follow your system appearance."
                >
                  <select
                    value={prefs.theme}
                    onChange={(e) =>
                      onSavePrefs({ theme: e.target.value as Preferences["theme"] })
                    }
                  >
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                    <option value="system">Match system</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Startup view" hint="What opens when Notebook launches.">
                  <select
                    value={prefs.startup_view}
                    onChange={(e) =>
                      onSavePrefs({
                        startup_view: e.target.value as Preferences["startup_view"],
                      })
                    }
                  >
                    <option value="all">Notes</option>
                    <option value="shortcuts">Shortcuts</option>
                    <option value="notebook">Default notebook</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Confirm before deleting"
                  hint="Ask before moving a note to trash or emptying trash."
                >
                  <Toggle
                    on={prefs.confirm_delete}
                    onChange={(v) => onSavePrefs({ confirm_delete: v })}
                  />
                </SettingsRow>
                <SettingsRow
                  title="Spell check"
                  hint="Underline misspelled words in the note editor."
                >
                  <Toggle
                    on={prefs.spell_check}
                    onChange={(v) => onSavePrefs({ spell_check: v })}
                  />
                </SettingsRow>
                <SettingsRow title="Date format" hint="How dates appear in the note list.">
                  <select
                    value={prefs.date_format}
                    onChange={(e) =>
                      onSavePrefs({
                        date_format: e.target.value as Preferences["date_format"],
                      })
                    }
                  >
                    <option value="short">Short</option>
                    <option value="medium">Medium</option>
                    <option value="long">Long</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Start week on" hint="Used by planners and date pickers.">
                  <select
                    value={prefs.week_starts_on}
                    onChange={(e) =>
                      onSavePrefs({
                        week_starts_on: e.target.value as Preferences["week_starts_on"],
                      })
                    }
                  >
                    <option value="sunday">Sunday</option>
                    <option value="monday">Monday</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="New note"
                  hint="Whether the New button creates a blank note or opens templates."
                >
                  <select
                    value={prefs.new_note_behavior}
                    onChange={(e) =>
                      onSavePrefs({
                        new_note_behavior: e.target.value as Preferences["new_note_behavior"],
                      })
                    }
                  >
                    <option value="blank">Start with a blank note</option>
                    <option value="ask">Ask for a template</option>
                  </select>
                </SettingsRow>
              </>
            )}

            {section === "notes" && (
              <>
                <SettingsRow
                  title="Note width"
                  hint="Optimize for reading or fill the window."
                >
                  <select
                    value={prefs.note_width}
                    onChange={(e) =>
                      onSavePrefs({
                        note_width: e.target.value as Preferences["note_width"],
                      })
                    }
                  >
                    <option value="readable">Optimize readability</option>
                    <option value="full">Fit to window</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Default font" hint="Typeface used in the note body.">
                  <select
                    value={prefs.font_family}
                    onChange={(e) =>
                      onSavePrefs({
                        font_family: e.target.value as Preferences["font_family"],
                      })
                    }
                  >
                    <option value="default">Sans serif</option>
                    <option value="serif">Serif</option>
                    <option value="mono">Monospace</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Font size" hint="Body text size in the editor.">
                  <select
                    value={String(prefs.font_size)}
                    onChange={(e) => onSavePrefs({ font_size: Number(e.target.value) })}
                  >
                    <option value="14">14</option>
                    <option value="16">16</option>
                    <option value="18">18</option>
                    <option value="20">20</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="PDF attachments"
                  hint="Evernote can show a PDF as a filename title or as an expanded preview. You can also right-click a PDF in a note to switch."
                >
                  <select
                    value={prefs.pdf_view || "expanded"}
                    onChange={(e) =>
                      onSavePrefs({
                        pdf_view: e.target.value as Preferences["pdf_view"],
                      })
                    }
                  >
                    <option value="expanded">Expanded preview</option>
                    <option value="title">Title only</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Note list view"
                  hint="Evernote can show snippets, titles only, or a card grid."
                >
                  <select
                    value={prefs.list_view || (prefs.show_snippets ? "snippets" : "titles")}
                    onChange={(e) => {
                      const list_view = e.target.value as Preferences["list_view"];
                      onSavePrefs({
                        list_view,
                        show_snippets: list_view !== "titles",
                      });
                    }}
                  >
                    <option value="snippets">Snippets</option>
                    <option value="titles">Titles</option>
                    <option value="cards">Cards</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Show snippets"
                  hint="Show a preview of each note in the list."
                >
                  <Toggle
                    on={prefs.show_snippets}
                    onChange={(v) =>
                      onSavePrefs({
                        show_snippets: v,
                        list_view: v ? "snippets" : "titles",
                      })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="Note list density" hint="Spacing between notes.">
                  <select
                    value={prefs.list_density}
                    onChange={(e) =>
                      onSavePrefs({
                        list_density: e.target.value as Preferences["list_density"],
                      })
                    }
                  >
                    <option value="comfortable">Comfortable</option>
                    <option value="compact">Compact</option>
                  </select>
                </SettingsRow>
                <SettingsRow title="Sort notes by" hint="Default order in the note list.">
                  <select
                    value={prefs.sort_by}
                    onChange={(e) =>
                      onSavePrefs({ sort_by: e.target.value as Preferences["sort_by"] })
                    }
                  >
                    <option value="updated">Date updated</option>
                    <option value="created">Date created</option>
                    <option value="title">Title</option>
                  </select>
                </SettingsRow>
                <SettingsRow
                  title="Auto-save delay"
                  hint="How quickly edits are written after you stop typing."
                >
                  <select
                    value={String(prefs.auto_save_ms)}
                    onChange={(e) => onSavePrefs({ auto_save_ms: Number(e.target.value) })}
                  >
                    <option value="300">Instant</option>
                    <option value="600">Fast</option>
                    <option value="1200">Balanced</option>
                    <option value="2500">Relaxed</option>
                  </select>
                </SettingsRow>
              </>
            )}

            {section === "notebooks" && (
              <SettingsRow
                title="Default notebook"
                hint="Used for new notes and restored gallery templates."
              >
                <select
                  value={prefs.default_notebook_id || ""}
                  onChange={(e) =>
                    onSavePrefs({ default_notebook_id: e.target.value || null })
                  }
                >
                  <option value="">First notebook</option>
                  {notebooks.map((nb) => (
                    <option key={nb.id} value={nb.id}>
                      {nb.name}
                      {nb.is_default ? " (default)" : ""}
                    </option>
                  ))}
                </select>
              </SettingsRow>
            )}

            {section === "sidebar" && (
              <>
                {(
                  [
                    ["show_shortcuts", "Shortcuts"],
                    ["show_reminders", "Reminders"],
                    ["show_notebooks", "Notebooks"],
                    ["show_tags", "Tags"],
                    ["show_templates", "Templates"],
                    ["show_trash", "Trash"],
                  ] as const
                ).map(([key, label]) => (
                  <SettingsRow
                    key={key}
                    title={label}
                    hint={`Show ${label.toLowerCase()} in the left sidebar.`}
                  >
                    <Toggle
                      on={prefs[key]}
                      onChange={(v) => onSavePrefs({ [key]: v })}
                    />
                  </SettingsRow>
                ))}
              </>
            )}

            {section === "shortcuts" && (
              <div className="shortcut-table">
                {SHORTCUTS.map(([action, keys]) => (
                  <div key={action} className="shortcut-row">
                    <span>{action}</span>
                    <kbd>{keys}</kbd>
                  </div>
                ))}
              </div>
            )}

            {section === "account" && (
              <>
                <SettingsRow title="Name" hint="Shown at the top of the sidebar.">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() =>
                      name.trim() &&
                      name !== account.display_name &&
                      onSaveAccount({ display_name: name.trim() })
                    }
                  />
                </SettingsRow>
                <SettingsRow title="Email" hint="Local account identifier.">
                  <input
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onBlur={() =>
                      email.trim() &&
                      email !== account.email &&
                      onSaveAccount({ email: email.trim() })
                    }
                  />
                </SettingsRow>
              </>
            )}

            {section === "import" && (
              <>
                <SettingsRow
                  title="Import Evernote"
                  hint="Bring in .enex notebooks, including images and tags."
                >
                  <button className="primary-btn" onClick={onImport}>
                    Import .enex
                  </button>
                </SettingsRow>
                <SettingsRow
                  title="Restore built-in templates"
                  hint="Add any missing gallery templates back to your notebooks."
                >
                  <button className="ghost-btn" onClick={onRestoreTemplates}>
                    Restore templates
                  </button>
                </SettingsRow>
              </>
            )}

            {section === "advanced" && (
              <>
                <SettingsRow title="Database" hint="SQLite file used by this app.">
                  <code className="path-value">{storage.database}</code>
                </SettingsRow>
                <SettingsRow title="Attachments" hint="Files saved with your notes.">
                  <code className="path-value">{storage.attachments}</code>
                </SettingsRow>
                <SettingsRow
                  title="Reset preferences"
                  hint="Restore application, notes, and sidebar settings."
                >
                  <button className="ghost-btn" onClick={onResetPrefs}>
                    Reset
                  </button>
                </SettingsRow>
                <SettingsRow
                  title="Empty trash"
                  hint="Permanently delete every note currently in Trash."
                >
                  <button className="ghost-btn danger-text" onClick={onEmptyTrash}>
                    Empty trash
                  </button>
                </SettingsRow>
              </>
            )}

            {section === "about" && (
              <div className="about-panel">
                <div className="logo-mark large">N</div>
                <h3>Notebook</h3>
                <p>Version {version}</p>
                <p className="muted">
                  An Evernote-style notes app without AI features. Notes, notebooks,
                  tags, templates, and search stay on this computer.
                </p>
                <p className="muted">MIT License</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function SettingsRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <div className="settings-row-title">{title}</div>
        <div className="settings-row-hint">{hint}</div>
      </div>
      <div className="settings-row-control">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={on ? "toggle on" : "toggle"}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}
