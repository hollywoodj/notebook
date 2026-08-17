use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{NotebookError, Result};

const SCHEMA: &str = include_str!("../migrations/001_initial.sql");
const SCHEMA_TEMPLATES_SETTINGS: &str =
    include_str!("../migrations/002_templates_settings.sql");

pub struct Database {
    conn: Connection,
    data_dir: PathBuf,
}

impl Database {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        let data_dir = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join("attachments");
        std::fs::create_dir_all(&data_dir)?;
        let db = Self { conn, data_dir };
        db.migrate()?;
        db.ensure_default_user()?;
        db.seed_defaults()?;
        Ok(db)
    }

    pub fn open_default() -> Result<Self> {
        let dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("notebook");
        std::fs::create_dir_all(&dir)?;
        Self::open(dir.join("notebook.db"))
    }

    pub fn connection(&self) -> &Connection {
        &self.conn
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn attachment_path(&self, attachment_id: &Uuid) -> PathBuf {
        self.data_dir.join(attachment_id.to_string())
    }

    fn migrate(&self) -> Result<()> {
        self.conn.execute_batch(SCHEMA)?;
        self.conn.execute_batch(SCHEMA_TEMPLATES_SETTINGS)?;
        self.ensure_column("notes", "is_template", "INTEGER NOT NULL DEFAULT 0")?;
        self.ensure_column("notes", "template_category", "TEXT")?;
        self.ensure_column("notes", "template_key", "TEXT")?;
        Ok(())
    }

    fn column_exists(&self, table: &str, column: &str) -> Result<bool> {
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))?;
        let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
        for name in names {
            if name? == column {
                return Ok(true);
            }
        }
        Ok(false)
    }

    fn ensure_column(&self, table: &str, column: &str, def: &str) -> Result<()> {
        if !self.column_exists(table, column)? {
            self.conn
                .execute(&format!("ALTER TABLE {table} ADD COLUMN {column} {def}"), [])?;
        }
        Ok(())
    }

    fn ensure_default_user(&self) -> Result<()> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))?;
        if count == 0 {
            let now = chrono::Utc::now().to_rfc3339();
            let user_id = Uuid::new_v4();
            let notebook_id = Uuid::new_v4();
            self.conn.execute(
                "INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![user_id.to_string(), "local@notebook.app", "Local User", now, now],
            )?;
            self.conn.execute(
                "INSERT INTO notebooks (id, user_id, name, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, 1, 0, ?4, ?5)",
                params![notebook_id.to_string(), user_id.to_string(), "First Notebook", now, now],
            )?;
        }
        Ok(())
    }

    fn seed_defaults(&self) -> Result<()> {
        let user_id = self.default_user_id()?;
        let notebook_id = self.templates_notebook_id(user_id)?;
        crate::templates::seed_builtin_templates(&self.conn, user_id, notebook_id)?;

        let count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM app_settings WHERE key = 'preferences'",
            [],
            |row| row.get(0),
        )?;
        if count == 0 {
            let now = chrono::Utc::now().to_rfc3339();
            self.conn.execute(
                "INSERT INTO app_settings (key, value, updated_at) VALUES ('preferences', ?1, ?2)",
                params![
                    crate::templates::default_preferences().to_string(),
                    now
                ],
            )?;
        }
        Ok(())
    }

    fn templates_notebook_id(&self, user_id: Uuid) -> Result<Uuid> {
        let existing: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM notebooks WHERE user_id = ?1 AND name = 'Templates' AND deleted_at IS NULL LIMIT 1",
                params![user_id.to_string()],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return Uuid::parse_str(&id).map_err(|e| NotebookError::Other(e.to_string()));
        }
        let id = Uuid::new_v4();
        let now = chrono::Utc::now().to_rfc3339();
        self.conn.execute(
            "INSERT INTO notebooks (id, user_id, name, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, 0, 1, ?4, ?5)",
            params![id.to_string(), user_id.to_string(), "Templates", now, now],
        )?;
        Ok(id)
    }

    pub fn default_user_id(&self) -> Result<Uuid> {
        let id: String = self.conn.query_row(
            "SELECT id FROM users ORDER BY created_at LIMIT 1",
            [],
            |row| row.get(0),
        )?;
        Uuid::parse_str(&id).map_err(|e| NotebookError::Other(e.to_string()))
    }
}
