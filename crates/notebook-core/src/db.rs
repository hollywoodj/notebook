use std::path::{Path, PathBuf};

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::error::{NotebookError, Result};

const SCHEMA: &str = include_str!("../migrations/001_initial.sql");
const SCHEMA_TEMPLATES_SETTINGS: &str = include_str!("../migrations/002_templates_settings.sql");

/// Schema steps, applied in order and stamped into SQLite's `user_version`, so
/// an already-current database opens without re-running any DDL.
///
/// Every step must stay idempotent regardless: databases created before the
/// version stamp existed report `user_version = 0` while already carrying the
/// full schema, so on their first open they replay all three.
const MIGRATIONS: &[fn(&Connection) -> Result<()>] = &[
    migrate_initial_schema,
    migrate_templates_and_settings,
    migrate_template_columns,
    migrate_reindex_template_content_plain,
];

/// A directory that removes itself on drop.
///
/// `Database::in_memory` still needs somewhere real to write attachment blobs,
/// and tests that import from a file need a path of their own. Hand-rolling it
/// keeps `tempfile` out of the dependency list for the sake of a few call sites.
pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    /// Creates a uniquely named directory under the system temp directory. The
    /// name is never reused, so concurrent callers cannot collide.
    pub fn new(prefix: &str) -> Result<Self> {
        let path = std::env::temp_dir().join(format!("{prefix}-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

pub struct Database {
    conn: Connection,
    data_dir: PathBuf,
    /// Held only so an in-memory database's attachment directory lives exactly
    /// as long as the database does.
    _temp_dir: Option<TempDir>,
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
        Self::bootstrap(conn, data_dir, None)
    }

    pub fn open_default() -> Result<Self> {
        let dir = dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("notebook");
        std::fs::create_dir_all(&dir)?;
        Self::open(dir.join("notebook.db"))
    }

    /// An isolated, fully migrated database for tests: the schema lives in
    /// memory and attachments go to a temp directory that is deleted on drop.
    /// Each call gets its own, so tests may run in parallel.
    pub fn in_memory() -> Result<Self> {
        let temp_dir = TempDir::new("notebook-test")?;
        let data_dir = temp_dir.path().join("attachments");
        let conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")?;
        Self::bootstrap(conn, data_dir, Some(temp_dir))
    }

    fn bootstrap(conn: Connection, data_dir: PathBuf, temp_dir: Option<TempDir>) -> Result<Self> {
        std::fs::create_dir_all(&data_dir)?;
        let db = Self {
            conn,
            data_dir,
            _temp_dir: temp_dir,
        };
        db.migrate()?;
        db.ensure_default_user()?;
        db.seed_defaults()?;
        Ok(db)
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

    /// The number of migrations applied to this database.
    pub fn schema_version(&self) -> Result<u32> {
        Ok(self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?)
    }

    fn migrate(&self) -> Result<()> {
        let current = self.schema_version()?;
        for (index, apply) in MIGRATIONS.iter().enumerate() {
            let version = index as u32 + 1;
            if current >= version {
                continue;
            }
            // The step and its version stamp commit together, so an interrupted
            // migration is retried rather than silently skipped.
            let tx = self.conn.unchecked_transaction()?;
            apply(&tx)?;
            tx.execute_batch(&format!("PRAGMA user_version = {version}"))?;
            tx.commit()?;
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
                params![crate::templates::default_preferences().to_string(), now],
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

fn migrate_initial_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA)?;
    Ok(())
}

fn migrate_templates_and_settings(conn: &Connection) -> Result<()> {
    conn.execute_batch(SCHEMA_TEMPLATES_SETTINGS)?;
    Ok(())
}

fn migrate_template_columns(conn: &Connection) -> Result<()> {
    ensure_column(conn, "notes", "is_template", "INTEGER NOT NULL DEFAULT 0")?;
    ensure_column(conn, "notes", "template_category", "TEXT")?;
    ensure_column(conn, "notes", "template_key", "TEXT")?;
    Ok(())
}

/// Recomputes `content_plain` for every template row from `content` using the
/// current, block-aware `strip_html`. Older databases were seeded (before
/// that stripper existed) with a naive `content_plain` that runs block-level
/// elements together, e.g. `<h2>Agenda</h2><p>Notes</p>` -> `AgendaNotes`,
/// which makes those templates unfindable by search. `seed_builtin_templates`
/// skips any `template_key` that already exists, so it never repairs rows a
/// prior run already inserted - only this migration can.
///
/// Recomputing from `content` is naturally idempotent (same input always
/// yields the same output), so this rewrites every `template_key IS NOT NULL`
/// row unconditionally rather than trying to detect which ones are already
/// correct - safe to replay on databases that predate the `user_version`
/// stamp along with every other step here (see the comment above
/// `MIGRATIONS`). The `notes_au` AFTER UPDATE trigger
/// (`migrations/001_initial.sql`) keeps `notes_fts` in sync, so no manual FTS
/// maintenance is needed here.
fn migrate_reindex_template_content_plain(conn: &Connection) -> Result<()> {
    let mut rows: Vec<(String, String)> = {
        let mut stmt =
            conn.prepare("SELECT id, content FROM notes WHERE template_key IS NOT NULL")?;
        let mapped = stmt.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        mapped.collect::<rusqlite::Result<Vec<_>>>()?
    };
    for (id, content) in rows.drain(..) {
        let plain = crate::content::strip_html(&content);
        conn.execute(
            "UPDATE notes SET content_plain = ?1 WHERE id = ?2",
            params![plain, id],
        )?;
    }
    Ok(())
}

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({table})"))?;
    let names = stmt.query_map([], |row| row.get::<_, String>(1))?;
    for name in names {
        if name? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, def: &str) -> Result<()> {
    if !column_exists(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {table} ADD COLUMN {column} {def}"),
            [],
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn notebook_names(db: &Database) -> Vec<String> {
        let mut stmt = db
            .connection()
            .prepare("SELECT name FROM notebooks ORDER BY name")
            .unwrap();
        let rows = stmt.query_map([], |row| row.get::<_, String>(0)).unwrap();
        rows.map(|name| name.unwrap()).collect()
    }

    #[test]
    fn a_new_database_is_stamped_with_every_migration() {
        let db = Database::in_memory().unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as u32);
    }

    #[test]
    fn in_memory_databases_do_not_share_state() {
        let first = Database::in_memory().unwrap();
        let second = Database::in_memory().unwrap();
        first
            .connection()
            .execute(
                "INSERT INTO notebooks (id, user_id, name, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, 'Only In First', 0, 9, '', '')",
                params![
                    Uuid::new_v4().to_string(),
                    first.default_user_id().unwrap().to_string()
                ],
            )
            .unwrap();

        assert!(notebook_names(&first).contains(&"Only In First".to_string()));
        assert!(!notebook_names(&second).contains(&"Only In First".to_string()));
        assert_ne!(first.data_dir(), second.data_dir());
    }

    #[test]
    fn the_attachment_directory_is_removed_when_an_in_memory_database_drops() {
        let data_dir = {
            let db = Database::in_memory().unwrap();
            let dir = db.data_dir().to_path_buf();
            assert!(dir.exists());
            dir
        };
        assert!(!data_dir.exists());
    }

    #[test]
    fn reopening_a_database_does_not_reseed_it() {
        let temp = TempDir::new("notebook-reopen-test").unwrap();
        let path = temp.path().join("test.db");

        let before = {
            let db = Database::open(&path).unwrap();
            notebook_names(&db)
        };
        let after = {
            let db = Database::open(&path).unwrap();
            assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as u32);
            notebook_names(&db)
        };

        assert_eq!(before, after);
    }

    #[test]
    fn a_database_predating_the_version_stamp_replays_cleanly() {
        let temp = TempDir::new("notebook-legacy-test").unwrap();
        let path = temp.path().join("test.db");

        let before = {
            let db = Database::open(&path).unwrap();
            // Databases created before `user_version` was stamped look exactly
            // like this: the full schema, reporting version 0.
            db.connection()
                .execute_batch("PRAGMA user_version = 0")
                .unwrap();
            notebook_names(&db)
        };

        let db = Database::open(&path).unwrap();
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as u32);
        assert_eq!(notebook_names(&db), before);
    }

    #[test]
    fn reindex_migration_separates_run_together_content_plain_and_is_idempotent() {
        let db = Database::in_memory().unwrap();
        let conn = db.connection();
        let user_id = db.default_user_id().unwrap();
        let notebook_id: String = conn
            .query_row(
                "SELECT id FROM notebooks WHERE user_id = ?1 LIMIT 1",
                params![user_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();

        // Simulate a template row seeded by the old naive stripper: two
        // block-level elements whose text ran together with no separator.
        let note_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, is_pinned, is_archived, is_template, template_category, template_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'Agenda Template', '<h2>Agenda</h2><p>Notes</p>', 'AgendaNotes', 0, 0, 1, 'work', 'legacy-agenda', ?4, ?4)",
            params![note_id, user_id.to_string(), notebook_id, now],
        )
        .unwrap();

        let find_notes = |term: &str| -> Vec<String> {
            let mut stmt = conn
                .prepare("SELECT note_id FROM notes_fts WHERE notes_fts MATCH ?1")
                .unwrap();
            stmt.query_map(params![term], |row| row.get::<_, String>(0))
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
        };

        // Before the migration runs on this row, the run-together text means
        // a search for "Notes" alone does not find it.
        assert!(!find_notes("Notes").contains(&note_id));

        migrate_reindex_template_content_plain(conn).unwrap();

        let plain: String = conn
            .query_row(
                "SELECT content_plain FROM notes WHERE id = ?1",
                params![note_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(plain, "Agenda Notes");
        assert!(find_notes("Notes").contains(&note_id));

        // Idempotency: recomputing from the same `content` again must not
        // change the value.
        migrate_reindex_template_content_plain(conn).unwrap();
        let plain_again: String = conn
            .query_row(
                "SELECT content_plain FROM notes WHERE id = ?1",
                params![note_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(plain_again, "Agenda Notes");
    }

    #[test]
    fn reindex_step_is_wired_into_the_migration_chain() {
        // The test above calls the step directly, which passes even if the step
        // was never added to MIGRATIONS. This one proves the wiring: an existing
        // database stamped at the previous version must pick the step up on its
        // next open, because that is the only thing that repairs a DB seeded by
        // the old naive stripper.
        let db = Database::in_memory().unwrap();
        let conn = db.connection();
        let user_id = db.default_user_id().unwrap();
        let notebook_id: String = conn
            .query_row(
                "SELECT id FROM notebooks WHERE user_id = ?1 LIMIT 1",
                params![user_id.to_string()],
                |row| row.get(0),
            )
            .unwrap();

        let note_id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, is_pinned, is_archived, is_template, template_category, template_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'Agenda Template', '<h2>Agenda</h2><p>Notes</p>', 'AgendaNotes', 0, 0, 1, 'work', 'legacy-agenda', ?4, ?4)",
            params![note_id, user_id.to_string(), notebook_id, now],
        )
        .unwrap();

        // Rewind the stamp to before this step existed, then replay the chain.
        let previous = MIGRATIONS.len() as u32 - 1;
        conn.execute_batch(&format!("PRAGMA user_version = {previous}"))
            .unwrap();
        db.migrate().unwrap();

        let plain: String = conn
            .query_row(
                "SELECT content_plain FROM notes WHERE id = ?1",
                params![note_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(plain, "Agenda Notes", "migration chain did not run the reindex step");
        assert_eq!(db.schema_version().unwrap(), MIGRATIONS.len() as u32);
    }
}
