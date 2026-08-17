use chrono::{DateTime, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::error::{NotebookError, Result};
use crate::models::*;
use crate::note_query::{self, NoteListFilter};

pub struct NotebookService {
    db: Database,
}

impl NotebookService {
    pub fn new(db: Database) -> Self {
        Self { db }
    }

    pub fn db(&self) -> &Database {
        &self.db
    }

    pub fn into_db(self) -> Database {
        self.db
    }

    fn now() -> String {
        crate::datetime::now_rfc3339()
    }

    fn parse_dt(s: &str) -> Result<DateTime<Utc>> {
        crate::datetime::parse_dt(s)
    }

    fn optional_dt(s: Option<String>) -> Result<Option<DateTime<Utc>>> {
        crate::datetime::optional_dt(s)
    }

    // --- Notebooks ---

    pub fn list_notebooks(&self, include_deleted: bool) -> Result<Vec<Notebook>> {
        let user_id = self.db.default_user_id()?;
        let sql = if include_deleted {
            "SELECT nb.id, nb.user_id, nb.stack_id, nb.name, nb.is_default, nb.sort_order, nb.created_at, nb.updated_at, nb.deleted_at,
             (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0) as note_count
             FROM notebooks nb WHERE nb.user_id = ?1 ORDER BY nb.sort_order, nb.name"
        } else {
            "SELECT nb.id, nb.user_id, nb.stack_id, nb.name, nb.is_default, nb.sort_order, nb.created_at, nb.updated_at, nb.deleted_at,
             (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0) as note_count
             FROM notebooks nb WHERE nb.user_id = ?1 AND nb.deleted_at IS NULL ORDER BY nb.sort_order, nb.name"
        };
        let conn = self.db.connection();
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Notebook {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                stack_id: row
                    .get::<_, Option<String>>(2)?
                    .map(|s| Uuid::parse_str(&s).unwrap()),
                name: row.get(3)?,
                is_default: row.get::<_, i32>(4)? != 0,
                sort_order: row.get(5)?,
                created_at: Self::parse_dt(&row.get::<_, String>(6)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                deleted_at: Self::optional_dt(row.get(8)?).unwrap(),
                note_count: row.get(9)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(NotebookError::from)
    }

    pub fn create_notebook(&self, req: CreateNotebookRequest) -> Result<Notebook> {
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        if req.is_default.unwrap_or(false) {
            self.db.connection().execute(
                "UPDATE notebooks SET is_default = 0, updated_at = ?1 WHERE user_id = ?2",
                params![now, user_id.to_string()],
            )?;
        }
        self.db.connection().execute(
            "INSERT INTO notebooks (id, user_id, stack_id, name, is_default, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM notebooks WHERE user_id = ?2), ?6, ?7)",
            params![
                id.to_string(),
                user_id.to_string(),
                req.stack_id.map(|s| s.to_string()),
                req.name,
                if req.is_default.unwrap_or(false) { 1 } else { 0 },
                now,
                now
            ],
        )?;
        self.get_notebook(id)
    }

    pub fn get_notebook(&self, id: Uuid) -> Result<Notebook> {
        let conn = self.db.connection();
        conn.query_row(
            "SELECT nb.id, nb.user_id, nb.stack_id, nb.name, nb.is_default, nb.sort_order, nb.created_at, nb.updated_at, nb.deleted_at,
             (SELECT COUNT(*) FROM notes n WHERE n.notebook_id = nb.id AND n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0) as note_count
             FROM notebooks nb WHERE nb.id = ?1",
            params![id.to_string()],
            |row| {
                Ok(Notebook {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                    user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                    stack_id: row
                        .get::<_, Option<String>>(2)?
                        .map(|s| Uuid::parse_str(&s).unwrap()),
                    name: row.get(3)?,
                    is_default: row.get::<_, i32>(4)? != 0,
                    sort_order: row.get(5)?,
                    created_at: Self::parse_dt(&row.get::<_, String>(6)?).unwrap(),
                    updated_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                    deleted_at: Self::optional_dt(row.get(8)?).unwrap(),
                    note_count: row.get(9)?,
                })
            },
        )
        .optional()?
        .ok_or_else(|| NotebookError::NotFound(format!("notebook {id}")))
    }

    pub fn update_notebook(&self, id: Uuid, req: UpdateNotebookRequest) -> Result<Notebook> {
        let mut notebook = self.get_notebook(id)?;
        if let Some(name) = req.name {
            notebook.name = name;
        }
        if let Some(stack_id) = req.stack_id {
            notebook.stack_id = stack_id;
        }
        if let Some(sort_order) = req.sort_order {
            notebook.sort_order = sort_order;
        }
        if let Some(is_default) = req.is_default {
            if is_default {
                let user_id = self.db.default_user_id()?;
                self.db.connection().execute(
                    "UPDATE notebooks SET is_default = 0, updated_at = ?1 WHERE user_id = ?2",
                    params![Self::now(), user_id.to_string()],
                )?;
            }
            notebook.is_default = is_default;
        }
        notebook.updated_at = Utc::now();
        let now = notebook.updated_at.to_rfc3339();
        self.db.connection().execute(
            "UPDATE notebooks SET name = ?1, stack_id = ?2, sort_order = ?3, is_default = ?4, updated_at = ?5 WHERE id = ?6",
            params![
                notebook.name,
                notebook.stack_id.map(|s| s.to_string()),
                notebook.sort_order,
                if notebook.is_default { 1 } else { 0 },
                now,
                id.to_string()
            ],
        )?;
        Ok(notebook)
    }

    pub fn delete_notebook(&self, id: Uuid) -> Result<()> {
        let now = Self::now();
        let affected = self.db.connection().execute(
            "UPDATE notebooks SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id.to_string()],
        )?;
        if affected == 0 {
            return Err(NotebookError::NotFound(format!("notebook {id}")));
        }
        self.db.connection().execute(
            "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE notebook_id = ?2 AND deleted_at IS NULL",
            params![now, id.to_string()],
        )?;
        Ok(())
    }

    pub fn restore_notebook(&self, id: Uuid) -> Result<Notebook> {
        let now = Self::now();
        self.db.connection().execute(
            "UPDATE notebooks SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id.to_string()],
        )?;
        self.get_notebook(id)
    }

    // --- Stacks ---

    pub fn list_stacks(&self) -> Result<Vec<Stack>> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, user_id, name, sort_order, created_at, updated_at FROM stacks WHERE user_id = ?1 ORDER BY sort_order, name",
        )?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Stack {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                name: row.get(2)?,
                sort_order: row.get(3)?,
                created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(5)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(NotebookError::from)
    }

    pub fn create_stack(&self, req: CreateStackRequest) -> Result<Stack> {
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO stacks (id, user_id, name, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM stacks WHERE user_id = ?2), ?4, ?5)",
            params![id.to_string(), user_id.to_string(), req.name, now, now],
        )?;
        self.get_stack(id)
    }

    pub fn get_stack(&self, id: Uuid) -> Result<Stack> {
        self.db
            .connection()
            .query_row(
                "SELECT id, user_id, name, sort_order, created_at, updated_at FROM stacks WHERE id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Stack {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        name: row.get(2)?,
                        sort_order: row.get(3)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(5)?).unwrap(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| NotebookError::NotFound(format!("stack {id}")))
    }

    pub fn update_stack(&self, id: Uuid, req: UpdateStackRequest) -> Result<Stack> {
        let mut stack = self.get_stack(id)?;
        if let Some(name) = req.name {
            stack.name = name;
        }
        if let Some(sort_order) = req.sort_order {
            stack.sort_order = sort_order;
        }
        stack.updated_at = Utc::now();
        self.db.connection().execute(
            "UPDATE stacks SET name = ?1, sort_order = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                stack.name,
                stack.sort_order,
                stack.updated_at.to_rfc3339(),
                id.to_string()
            ],
        )?;
        Ok(stack)
    }

    pub fn delete_stack(&self, id: Uuid) -> Result<()> {
        self.db.connection().execute(
            "UPDATE notebooks SET stack_id = NULL WHERE stack_id = ?1",
            params![id.to_string()],
        )?;
        let affected = self
            .db
            .connection()
            .execute("DELETE FROM stacks WHERE id = ?1", params![id.to_string()])?;
        if affected == 0 {
            return Err(NotebookError::NotFound(format!("stack {id}")));
        }
        Ok(())
    }

    // --- Tags ---

    pub fn list_tags(&self) -> Result<Vec<Tag>> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT t.id, t.user_id, t.name, t.created_at, t.updated_at,
             (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id WHERE nt.tag_id = t.id AND n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0) as note_count
             FROM tags t WHERE t.user_id = ?1 ORDER BY t.name",
        )?;
        let rows = stmt.query_map(params![user_id.to_string()], |row| {
            Ok(Tag {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                name: row.get(2)?,
                created_at: Self::parse_dt(&row.get::<_, String>(3)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                note_count: row.get(5)?,
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(NotebookError::from)
    }

    pub fn create_tag(&self, req: CreateTagRequest) -> Result<Tag> {
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO tags (id, user_id, name, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id.to_string(), user_id.to_string(), req.name, now, now],
        )?;
        self.get_tag(id)
    }

    pub fn get_tag(&self, id: Uuid) -> Result<Tag> {
        self.db
            .connection()
            .query_row(
                "SELECT t.id, t.user_id, t.name, t.created_at, t.updated_at,
                 (SELECT COUNT(*) FROM note_tags nt JOIN notes n ON n.id = nt.note_id WHERE nt.tag_id = t.id AND n.deleted_at IS NULL AND COALESCE(n.is_template, 0) = 0) as note_count
                 FROM tags t WHERE t.id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Tag {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        name: row.get(2)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(3)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                        note_count: row.get(5)?,
                    })
                },
            )
            .optional()?
            .ok_or_else(|| NotebookError::NotFound(format!("tag {id}")))
    }

    pub fn update_tag(&self, id: Uuid, req: UpdateTagRequest) -> Result<Tag> {
        let mut tag = self.get_tag(id)?;
        if let Some(name) = req.name {
            tag.name = name;
        }
        tag.updated_at = Utc::now();
        self.db.connection().execute(
            "UPDATE tags SET name = ?1, updated_at = ?2 WHERE id = ?3",
            params![tag.name, tag.updated_at.to_rfc3339(), id.to_string()],
        )?;
        Ok(tag)
    }

    pub fn delete_tag(&self, id: Uuid) -> Result<()> {
        let affected = self
            .db
            .connection()
            .execute("DELETE FROM tags WHERE id = ?1", params![id.to_string()])?;
        if affected == 0 {
            return Err(NotebookError::NotFound(format!("tag {id}")));
        }
        Ok(())
    }

    pub fn get_or_create_tag_by_name(&self, name: &str) -> Result<Tag> {
        let user_id = self.db.default_user_id()?;
        let existing: Option<String> = self
            .db
            .connection()
            .query_row(
                "SELECT id FROM tags WHERE user_id = ?1 AND name = ?2",
                params![user_id.to_string(), name],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(id) = existing {
            return self.get_tag(Uuid::parse_str(&id).unwrap());
        }
        self.create_tag(CreateTagRequest {
            name: name.to_string(),
        })
    }

    // --- Notes ---

    pub fn list_notes(
        &self,
        notebook_id: Option<Uuid>,
        tag_id: Option<Uuid>,
        trash: bool,
        archived: Option<bool>,
        templates: Option<bool>,
    ) -> Result<Vec<NoteSummary>> {
        let user_id = self.db.default_user_id()?;
        note_query::list_summaries(
            self.db.connection(),
            NoteListFilter {
                user_id,
                notebook_id,
                tag_id,
                trash,
                archived,
                templates,
            },
        )
    }

    fn get_note_tags(&self, note_id: Uuid) -> Result<(Vec<Uuid>, Vec<String>)> {
        let tags = note_query::tags_for_notes(self.db.connection(), &[note_id])?;
        Ok(tags.get(&note_id).cloned().unwrap_or_default())
    }

    fn strip_html(html: &str) -> String {
        let mut out = String::with_capacity(html.len());
        let mut in_tag = false;
        for ch in html.chars() {
            match ch {
                '<' => in_tag = true,
                '>' => in_tag = false,
                _ if !in_tag => out.push(ch),
                _ => {}
            }
        }
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    pub fn create_note(&self, req: CreateNoteRequest) -> Result<Note> {
        self.get_notebook(req.notebook_id)?;
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        let title = req.title.unwrap_or_else(|| "Untitled".to_string());
        let content = req.content.unwrap_or_default();
        let content_plain = Self::strip_html(&content);

        let is_template = req.is_template.unwrap_or(false);
        let template_category = req.template_category.clone();
        self.db.connection().execute(
            "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, is_pinned, reminder_at, source_url, is_template, template_category, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                id.to_string(),
                user_id.to_string(),
                req.notebook_id.to_string(),
                title,
                content,
                content_plain,
                if req.is_pinned.unwrap_or(false) { 1 } else { 0 },
                req.reminder_at.map(|d| d.to_rfc3339()),
                req.source_url,
                if is_template { 1 } else { 0 },
                template_category,
                now,
                now
            ],
        )?;

        if let Some(tag_ids) = req.tag_ids {
            self.set_note_tags(id, &tag_ids)?;
        }

        self.save_revision(id, &title, &content)?;
        self.get_note(id)
    }

    pub fn get_note(&self, id: Uuid) -> Result<Note> {
        let mut note = self.db
            .connection()
            .query_row(
                "SELECT id, user_id, notebook_id, title, content, content_plain, is_pinned, is_archived, reminder_at, source_url, latitude, longitude, created_at, updated_at, deleted_at, is_template, template_category, template_key FROM notes WHERE id = ?1",
            params![id.to_string()],
                |row| {
                    Ok(Note {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        notebook_id: Uuid::parse_str(&row.get::<_, String>(2)?).unwrap(),
                        title: row.get(3)?,
                        content: row.get(4)?,
                        content_plain: row.get(5)?,
                        is_pinned: row.get::<_, i32>(6)? != 0,
                        is_archived: row.get::<_, i32>(7)? != 0,
                        reminder_at: Self::optional_dt(row.get(8)?).unwrap(),
                        source_url: row.get(9)?,
                        latitude: row.get(10)?,
                        longitude: row.get(11)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(12)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(13)?).unwrap(),
                        deleted_at: Self::optional_dt(row.get(14)?).unwrap(),
                        is_template: row.get::<_, i32>(15)? != 0,
                        template_category: row.get(16)?,
                        template_key: row.get(17)?,
                        tag_ids: Vec::new(),
                        tag_names: Vec::new(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| NotebookError::NotFound(format!("note {id}")))?;
        let (tag_ids, tag_names) = self.get_note_tags(id)?;
        note.tag_ids = tag_ids;
        note.tag_names = tag_names;
        Ok(note)
    }

    pub fn update_note(&self, id: Uuid, req: UpdateNoteRequest) -> Result<Note> {
        let mut note = self.get_note(id)?;
        if let Some(notebook_id) = req.notebook_id {
            self.get_notebook(notebook_id)?;
            note.notebook_id = notebook_id;
        }
        if let Some(title) = req.title {
            note.title = title;
        }
        if let Some(content) = req.content {
            note.content = content.clone();
            note.content_plain = Self::strip_html(&content);
            self.save_revision(id, &note.title, &content)?;
        }
        if let Some(pinned) = req.is_pinned {
            note.is_pinned = pinned;
        }
        if let Some(archived) = req.is_archived {
            note.is_archived = archived;
        }
        if let Some(reminder) = req.reminder_at {
            note.reminder_at = reminder;
        }
        if let Some(source_url) = req.source_url {
            note.source_url = if source_url.trim().is_empty() {
                None
            } else {
                Some(source_url)
            };
        }
        if let Some(is_template) = req.is_template {
            note.is_template = is_template;
            if is_template && note.template_category.is_none() {
                note.template_category = Some("My templates".into());
            }
        }
        if let Some(template_category) = req.template_category {
            note.template_category = Some(template_category);
        }
        note.updated_at = Utc::now();

        self.db.connection().execute(
            "UPDATE notes SET notebook_id = ?1, title = ?2, content = ?3, content_plain = ?4, is_pinned = ?5, is_archived = ?6, reminder_at = ?7, source_url = ?8, is_template = ?9, template_category = ?10, updated_at = ?11 WHERE id = ?12",
            params![
                note.notebook_id.to_string(),
                note.title,
                note.content,
                note.content_plain,
                if note.is_pinned { 1 } else { 0 },
                if note.is_archived { 1 } else { 0 },
                note.reminder_at.map(|d| d.to_rfc3339()),
                note.source_url,
                if note.is_template { 1 } else { 0 },
                note.template_category,
                note.updated_at.to_rfc3339(),
                id.to_string()
            ],
        )?;

        if let Some(tag_ids) = req.tag_ids {
            self.set_note_tags(id, &tag_ids)?;
        }

        self.get_note(id)
    }

    fn set_note_tags(&self, note_id: Uuid, tag_ids: &[Uuid]) -> Result<()> {
        let conn = self.db.connection();
        conn.execute(
            "DELETE FROM note_tags WHERE note_id = ?1",
            params![note_id.to_string()],
        )?;
        for tag_id in tag_ids {
            self.get_tag(*tag_id)?;
            conn.execute(
                "INSERT INTO note_tags (note_id, tag_id) VALUES (?1, ?2)",
                params![note_id.to_string(), tag_id.to_string()],
            )?;
        }
        Ok(())
    }

    pub fn delete_note(&self, id: Uuid) -> Result<()> {
        let now = Self::now();
        let affected = self.db.connection().execute(
            "UPDATE notes SET deleted_at = ?1, updated_at = ?1 WHERE id = ?2 AND deleted_at IS NULL",
            params![now, id.to_string()],
        )?;
        if affected == 0 {
            return Err(NotebookError::NotFound(format!("note {id}")));
        }
        Ok(())
    }

    pub fn restore_note(&self, id: Uuid) -> Result<Note> {
        let now = Self::now();
        self.db.connection().execute(
            "UPDATE notes SET deleted_at = NULL, updated_at = ?1 WHERE id = ?2",
            params![now, id.to_string()],
        )?;
        self.get_note(id)
    }

    pub fn permanently_delete_note(&self, id: Uuid) -> Result<()> {
        let attachments = self.list_attachments(id)?;
        for att in attachments {
            let path = self.db.attachment_path(&att.id);
            let _ = std::fs::remove_file(path);
        }
        let affected = self
            .db
            .connection()
            .execute("DELETE FROM notes WHERE id = ?1", params![id.to_string()])?;
        if affected == 0 {
            return Err(NotebookError::NotFound(format!("note {id}")));
        }
        Ok(())
    }

    pub fn empty_trash(&self) -> Result<i32> {
        let trash_notes = self.list_notes(None, None, true, None, None)?;
        let mut count = 0;
        for note in trash_notes {
            self.permanently_delete_note(note.id)?;
            count += 1;
        }
        Ok(count)
    }

    fn save_revision(&self, note_id: Uuid, title: &str, content: &str) -> Result<()> {
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO note_revisions (id, note_id, title, content, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id.to_string(), note_id.to_string(), title, content, now],
        )?;
        Ok(())
    }

    pub fn list_revisions(&self, note_id: Uuid) -> Result<Vec<NoteRevision>> {
        self.get_note(note_id)?;
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, title, content, created_at FROM note_revisions WHERE note_id = ?1 ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map(params![note_id.to_string()], |row| {
            Ok(NoteRevision {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                note_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                title: row.get(2)?,
                content: row.get(3)?,
                created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(NotebookError::from)
    }

    pub fn restore_revision(&self, note_id: Uuid, revision_id: Uuid) -> Result<Note> {
        let revision = self
            .db
            .connection()
            .query_row(
                "SELECT title, content FROM note_revisions WHERE id = ?1 AND note_id = ?2",
                params![revision_id.to_string(), note_id.to_string()],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?
            .ok_or_else(|| NotebookError::NotFound(format!("revision {revision_id}")))?;
        self.update_note(
            note_id,
            UpdateNoteRequest {
                title: Some(revision.0),
                content: Some(revision.1),
                ..Default::default()
            },
        )
    }

    // --- Attachments ---

    pub fn list_attachments(&self, note_id: Uuid) -> Result<Vec<Attachment>> {
        let conn = self.db.connection();
        let mut stmt = conn.prepare(
            "SELECT id, note_id, filename, mime_type, size, width, height, created_at, updated_at FROM attachments WHERE note_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![note_id.to_string()], |row| {
            Ok(Attachment {
                id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                note_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                filename: row.get(2)?,
                mime_type: row.get(3)?,
                size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                created_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                updated_at: Self::parse_dt(&row.get::<_, String>(8)?).unwrap(),
            })
        })?;
        rows.collect::<std::result::Result<Vec<_>, _>>()
            .map_err(NotebookError::from)
    }

    pub fn add_attachment(
        &self,
        note_id: Uuid,
        filename: String,
        mime_type: String,
        data: &[u8],
    ) -> Result<Attachment> {
        self.get_note(note_id)?;
        let id = Uuid::new_v4();
        let now = Self::now();
        let path = self.db.attachment_path(&id);
        std::fs::write(&path, data)?;
        self.db.connection().execute(
            "INSERT INTO attachments (id, note_id, filename, mime_type, size, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id.to_string(),
                note_id.to_string(),
                filename,
                mime_type,
                data.len() as i64,
                now,
                now
            ],
        )?;
        self.get_attachment(id)
    }

    pub fn get_attachment(&self, id: Uuid) -> Result<Attachment> {
        self.db
            .connection()
            .query_row(
                "SELECT id, note_id, filename, mime_type, size, width, height, created_at, updated_at FROM attachments WHERE id = ?1",
                params![id.to_string()],
                |row| {
                    Ok(Attachment {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        note_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        filename: row.get(2)?,
                        mime_type: row.get(3)?,
                        size: row.get(4)?,
                        width: row.get(5)?,
                        height: row.get(6)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(7)?).unwrap(),
                        updated_at: Self::parse_dt(&row.get::<_, String>(8)?).unwrap(),
                    })
                },
            )
            .optional()?
            .ok_or_else(|| NotebookError::NotFound(format!("attachment {id}")))
    }

    pub fn read_attachment_data(&self, id: Uuid) -> Result<Vec<u8>> {
        let path = self.db.attachment_path(&id);
        self.get_attachment(id)?;
        std::fs::read(path).map_err(NotebookError::from)
    }

    pub fn delete_attachment(&self, id: Uuid) -> Result<()> {
        let path = self.db.attachment_path(&id);
        let affected = self.db.connection().execute(
            "DELETE FROM attachments WHERE id = ?1",
            params![id.to_string()],
        )?;
        if affected == 0 {
            return Err(NotebookError::NotFound(format!("attachment {id}")));
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    // --- Shortcuts ---

    pub fn list_shortcuts(&self) -> Result<Vec<(Shortcut, NoteSummary)>> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let shortcuts: Vec<Shortcut> = {
            let mut stmt = conn.prepare(
                "SELECT s.id, s.user_id, s.note_id, s.sort_order, s.created_at FROM shortcuts s WHERE s.user_id = ?1 ORDER BY s.sort_order",
            )?;
            let rows = stmt.query_map(params![user_id.to_string()], |row| {
                Ok(Shortcut {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                    user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                    note_id: Uuid::parse_str(&row.get::<_, String>(2)?).unwrap(),
                    sort_order: row.get(3)?,
                    created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                })
            })?;
            rows.collect::<std::result::Result<Vec<_>, _>>()
                .map_err(NotebookError::from)?
        };
        let ids: Vec<Uuid> = shortcuts.iter().map(|s| s.note_id).collect();
        let mut by_id = note_query::summaries_by_ids(conn, &ids, true)?
            .into_iter()
            .filter(|note| !note.is_template)
            .map(|note| (note.id, note))
            .collect::<std::collections::HashMap<_, _>>();
        let mut result = Vec::new();
        for shortcut in shortcuts {
            if let Some(summary) = by_id.remove(&shortcut.note_id) {
                result.push((shortcut, summary));
            }
        }
        Ok(result)
    }

    pub fn add_shortcut(&self, note_id: Uuid) -> Result<Shortcut> {
        self.get_note(note_id)?;
        let user_id = self.db.default_user_id()?;
        let id = Uuid::new_v4();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT OR REPLACE INTO shortcuts (id, user_id, note_id, sort_order, created_at) VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM shortcuts WHERE user_id = ?2), ?4)",
            params![id.to_string(), user_id.to_string(), note_id.to_string(), now],
        )?;
        self.db
            .connection()
            .query_row(
                "SELECT id, user_id, note_id, sort_order, created_at FROM shortcuts WHERE user_id = ?1 AND note_id = ?2",
                params![user_id.to_string(), note_id.to_string()],
                |row| {
                    Ok(Shortcut {
                        id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                        user_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
                        note_id: Uuid::parse_str(&row.get::<_, String>(2)?).unwrap(),
                        sort_order: row.get(3)?,
                        created_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                    })
                },
            )
            .map_err(NotebookError::from)
    }

    pub fn remove_shortcut(&self, note_id: Uuid) -> Result<()> {
        let user_id = self.db.default_user_id()?;
        self.db.connection().execute(
            "DELETE FROM shortcuts WHERE user_id = ?1 AND note_id = ?2",
            params![user_id.to_string(), note_id.to_string()],
        )?;
        Ok(())
    }

    // --- Search ---

    pub fn search(&self, query: SearchQuery) -> Result<SearchResult> {
        crate::search::search_notes(self, query)
    }

    // --- Account ---

    pub fn get_account(&self) -> Result<User> {
        let conn = self.db.connection();
        conn.query_row(
            "SELECT id, email, display_name, created_at, updated_at FROM users ORDER BY created_at LIMIT 1",
            [],
            |row| {
                Ok(User {
                    id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
                    email: row.get(1)?,
                    display_name: row.get(2)?,
                    created_at: Self::parse_dt(&row.get::<_, String>(3)?).unwrap(),
                    updated_at: Self::parse_dt(&row.get::<_, String>(4)?).unwrap(),
                })
            },
        )
        .map_err(NotebookError::from)
    }

    pub fn update_account(&self, req: UpdateUserRequest) -> Result<User> {
        let mut user = self.get_account()?;
        if let Some(email) = req.email {
            if email.trim().is_empty() {
                return Err(NotebookError::InvalidInput("email is required".into()));
            }
            user.email = email.trim().to_string();
        }
        if let Some(display_name) = req.display_name {
            if display_name.trim().is_empty() {
                return Err(NotebookError::InvalidInput(
                    "display name is required".into(),
                ));
            }
            user.display_name = display_name.trim().to_string();
        }
        user.updated_at = Utc::now();
        self.db.connection().execute(
            "UPDATE users SET email = ?1, display_name = ?2, updated_at = ?3 WHERE id = ?4",
            params![
                user.email,
                user.display_name,
                user.updated_at.to_rfc3339(),
                user.id.to_string()
            ],
        )?;
        Ok(user)
    }

    // --- Settings ---

    pub fn get_preferences(&self) -> Result<serde_json::Value> {
        let mut defaults = crate::templates::default_preferences();
        let stored: Option<String> = self
            .db
            .connection()
            .query_row(
                "SELECT value FROM app_settings WHERE key = 'preferences'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if let Some(raw) = stored {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) {
                if let (Some(base), Some(patch)) = (defaults.as_object_mut(), value.as_object()) {
                    for (k, v) in patch {
                        base.insert(k.clone(), v.clone());
                    }
                }
            }
        }
        Ok(defaults)
    }

    pub fn update_preferences(&self, patch: serde_json::Value) -> Result<serde_json::Value> {
        let mut current = self.get_preferences()?;
        if let (Some(base), Some(incoming)) = (current.as_object_mut(), patch.as_object()) {
            for (k, v) in incoming {
                base.insert(k.clone(), v.clone());
            }
        }
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('preferences', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![current.to_string(), now],
        )?;
        Ok(current)
    }

    pub fn reset_preferences(&self) -> Result<serde_json::Value> {
        let defaults = crate::templates::default_preferences();
        let now = Self::now();
        self.db.connection().execute(
            "INSERT INTO app_settings (key, value, updated_at) VALUES ('preferences', ?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![defaults.to_string(), now],
        )?;
        Ok(defaults)
    }

    // --- Templates ---

    pub fn template_catalog(&self) -> Vec<serde_json::Value> {
        crate::templates::builtin_template_catalog()
    }

    pub fn restore_builtin_templates(&self) -> Result<u32> {
        let user_id = self.db.default_user_id()?;
        let notebooks = self.list_notebooks(false)?;
        let notebook_id = if let Some(nb) = notebooks.iter().find(|n| n.name == "Templates") {
            nb.id
        } else {
            self.create_notebook(CreateNotebookRequest {
                name: "Templates".into(),
                stack_id: None,
                is_default: Some(false),
            })?
            .id
        };
        crate::templates::seed_builtin_templates(self.db.connection(), user_id, notebook_id)
    }

    pub fn use_template(&self, template_id: Uuid, notebook_id: Option<Uuid>) -> Result<Note> {
        let template = self.get_note(template_id)?;
        if !template.is_template {
            return Err(NotebookError::InvalidInput(
                "note is not a template".into(),
            ));
        }
        let target_notebook = notebook_id.unwrap_or(template.notebook_id);
        self.create_note(CreateNoteRequest {
            notebook_id: target_notebook,
            title: Some(template.title),
            content: Some(template.content),
            tag_ids: Some(template.tag_ids),
            is_pinned: None,
            reminder_at: None,
            source_url: None,
            is_template: Some(false),
            template_category: None,
        })
    }

    pub fn storage_info(&self) -> serde_json::Value {
        serde_json::json!({
            "database": self.db.connection().path().unwrap_or("memory"),
            "attachments": self.db.data_dir().display().to_string(),
        })
    }

    pub fn sidebar_counts(&self) -> Result<crate::SidebarCounts> {
        let user_id = self.db.default_user_id()?;
        let conn = self.db.connection();
        let notes: i32 = conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND deleted_at IS NULL AND IFNULL(is_template, 0) = 0",
            params![user_id.to_string()],
            |row| row.get(0),
        )?;
        let reminders: i32 = conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND deleted_at IS NULL AND IFNULL(is_template, 0) = 0 AND reminder_at IS NOT NULL",
            params![user_id.to_string()],
            |row| row.get(0),
        )?;
        let trash: i32 = conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND deleted_at IS NOT NULL",
            params![user_id.to_string()],
            |row| row.get(0),
        )?;
        let templates: i32 = conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND deleted_at IS NULL AND IFNULL(is_template, 0) = 1",
            params![user_id.to_string()],
            |row| row.get(0),
        )?;
        let shortcuts: i32 = conn.query_row(
            "SELECT COUNT(*) FROM shortcuts WHERE user_id = ?1",
            params![user_id.to_string()],
            |row| row.get(0),
        )?;
        Ok(crate::SidebarCounts {
            notes,
            reminders,
            trash,
            templates,
            shortcuts,
        })
    }
}

impl Default for UpdateNoteRequest {
    fn default() -> Self {
        Self {
            notebook_id: None,
            title: None,
            content: None,
            tag_ids: None,
            is_pinned: None,
            is_archived: None,
            reminder_at: None,
            source_url: None,
            is_template: None,
            template_category: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{CreateNotebookRequest, CreateNoteRequest, UpdateNoteRequest};

    fn temp_service(name: &str) -> NotebookService {
        let dir = std::env::temp_dir().join(format!("notebook-ui-gap-{name}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        NotebookService::new(Database::open(dir.join("test.db")).unwrap())
    }

    #[test]
    fn sidebar_counts_and_notebook_badges() {
        let service = temp_service("counts");
        let notebooks = service.list_notebooks(false).unwrap();
        let notebook_id = notebooks[0].id;
        service
            .create_note(CreateNoteRequest {
                notebook_id,
                title: Some("Alarm".into()),
                content: Some("<p>Wake up</p>".into()),
                tag_ids: None,
                is_pinned: None,
                reminder_at: Some(Utc::now()),
                source_url: None,
                is_template: None,
                template_category: None,
            })
            .unwrap();
        let counts = service.sidebar_counts().unwrap();
        assert!(counts.notes >= 1);
        assert_eq!(counts.reminders, 1);
        assert_eq!(counts.trash, 0);
        let listed = service.list_notebooks(false).unwrap();
        assert!(listed.iter().any(|nb| nb.id == notebook_id && nb.note_count >= 1));
    }

    fn sample_note(notebook_id: Uuid, title: &str) -> CreateNoteRequest {
        CreateNoteRequest {
            notebook_id,
            title: Some(title.into()),
            content: Some("<p>x</p>".into()),
            tag_ids: None,
            is_pinned: None,
            reminder_at: None,
            source_url: None,
            is_template: None,
            template_category: None,
        }
    }

    #[test]
    fn notebook_counts_are_per_notebook_not_the_global_total() {
        let service = temp_service("per-notebook-counts");
        let first = service.list_notebooks(false).unwrap()[0].id;
        let second = service
            .create_notebook(CreateNotebookRequest {
                name: "Work".into(),
                stack_id: None,
                is_default: None,
            })
            .unwrap()
            .id;
        service.create_note(sample_note(first, "One")).unwrap();
        service.create_note(sample_note(first, "Two")).unwrap();
        service.create_note(sample_note(second, "Solo")).unwrap();

        let listed = service.list_notebooks(false).unwrap();
        let first_count = listed.iter().find(|nb| nb.id == first).unwrap().note_count;
        let second_count = listed.iter().find(|nb| nb.id == second).unwrap().note_count;
        assert_eq!(second_count, 1);
        assert!(first_count >= 2);
        assert_ne!(first_count, second_count);

        let in_first = service
            .list_notes(Some(first), None, false, None, None)
            .unwrap();
        let in_second = service
            .list_notes(Some(second), None, false, None, None)
            .unwrap();
        assert_eq!(in_first.len() as i32, first_count);
        assert_eq!(in_second.len() as i32, second_count);
        assert_eq!(in_second.len(), 1);
    }

    #[test]
    fn clearing_a_reminder_writes_null() {
        let service = temp_service("reminder-clear");
        let notebook_id = service.list_notebooks(false).unwrap()[0].id;
        let note = service
            .create_note(CreateNoteRequest {
                notebook_id,
                title: Some("Later".into()),
                content: Some("<p>x</p>".into()),
                tag_ids: None,
                is_pinned: None,
                reminder_at: Some(Utc::now()),
                source_url: None,
                is_template: None,
                template_category: None,
            })
            .unwrap();
        assert!(note.reminder_at.is_some());
        let cleared = service
            .update_note(
                note.id,
                UpdateNoteRequest {
                    reminder_at: Some(None),
                    ..UpdateNoteRequest::default()
                },
            )
            .unwrap();
        assert!(cleared.reminder_at.is_none());
    }

    #[test]
    fn list_notes_hydrates_tags_in_one_pass() {
        let service = temp_service("list-tags");
        let notebook_id = service.list_notebooks(false).unwrap()[0].id;
        let work = service
            .create_tag(CreateTagRequest {
                name: "work".into(),
            })
            .unwrap();
        let home = service
            .create_tag(CreateTagRequest {
                name: "home".into(),
            })
            .unwrap();
        service
            .create_note(CreateNoteRequest {
                notebook_id,
                title: Some("Tagged".into()),
                content: Some("<p>hello</p>".into()),
                tag_ids: Some(vec![work.id, home.id]),
                is_pinned: None,
                reminder_at: None,
                source_url: None,
                is_template: None,
                template_category: None,
            })
            .unwrap();
        service
            .create_note(sample_note(notebook_id, "Untagged"))
            .unwrap();

        let listed = service
            .list_notes(None, None, false, None, None)
            .unwrap();
        let tagged = listed.iter().find(|n| n.title == "Tagged").unwrap();
        let untagged = listed.iter().find(|n| n.title == "Untagged").unwrap();
        assert_eq!(tagged.tag_names, vec!["home".to_string(), "work".to_string()]);
        assert!(untagged.tag_names.is_empty());
    }

    #[test]
    fn search_loads_hits_by_id_instead_of_the_full_note_list() {
        let service = temp_service("search-by-id");
        let notebook_id = service.list_notebooks(false).unwrap()[0].id;
        let tag = service
            .create_tag(CreateTagRequest {
                name: "alpha".into(),
            })
            .unwrap();
        for i in 0..12 {
            service
                .create_note(sample_note(notebook_id, &format!("Filler {i}")))
                .unwrap();
        }
        let hit = service
            .create_note(CreateNoteRequest {
                notebook_id,
                title: Some("Unique walrus notes".into()),
                content: Some("<p>walrus foraging</p>".into()),
                tag_ids: Some(vec![tag.id]),
                is_pinned: None,
                reminder_at: None,
                source_url: None,
                is_template: None,
                template_category: None,
            })
            .unwrap();

        let result = service
            .search(SearchQuery {
                q: "walrus".into(),
                notebook_id: None,
                tag_id: None,
                include_trash: None,
                include_archived: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(result.total, 1);
        assert_eq!(result.notes.len(), 1);
        assert_eq!(result.notes[0].id, hit.id);
        assert_eq!(result.notes[0].tag_names, vec!["alpha".to_string()]);

        let tagged = service
            .search(SearchQuery {
                q: "walrus".into(),
                notebook_id: None,
                tag_id: Some(tag.id),
                include_trash: None,
                include_archived: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(tagged.notes.len(), 1);

        let other_tag = service
            .create_tag(CreateTagRequest {
                name: "beta".into(),
            })
            .unwrap();
        let missed = service
            .search(SearchQuery {
                q: "walrus".into(),
                notebook_id: None,
                tag_id: Some(other_tag.id),
                include_trash: None,
                include_archived: None,
                limit: None,
                offset: None,
            })
            .unwrap();
        assert!(missed.notes.is_empty());
    }

    #[test]
    fn shortcuts_resolve_only_the_starred_notes() {
        let service = temp_service("shortcut-by-id");
        let notebook_id = service.list_notebooks(false).unwrap()[0].id;
        let first = service
            .create_note(sample_note(notebook_id, "Keep"))
            .unwrap();
        service
            .create_note(sample_note(notebook_id, "Skip"))
            .unwrap();
        service.add_shortcut(first.id).unwrap();
        let shortcuts = service.list_shortcuts().unwrap();
        assert_eq!(shortcuts.len(), 1);
        assert_eq!(shortcuts[0].1.id, first.id);
        assert_eq!(shortcuts[0].1.title, "Keep");
    }
}
