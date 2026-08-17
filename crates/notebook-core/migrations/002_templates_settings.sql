-- Templates live as notes with is_template = 1 (Evernote-style).
-- Settings are a JSON document in app_settings.

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
