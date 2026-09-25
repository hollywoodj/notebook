pub mod enex;

use std::path::Path;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::error::{NotebookError, Result};
use crate::models::{
    CreateNoteRequest, EnexImportRequest, EnexImportResult, ImportError, UpdateNoteRequest,
};
use crate::service::NotebookService;

use self::enex::{parse_enex, EnexNote};

enum ImportOutcome {
    Imported,
    Duplicate,
}

impl NotebookService {
    pub fn import_enex(&self, data: &[u8], options: EnexImportRequest) -> Result<EnexImportResult> {
        let parsed = parse_enex(data)?;
        let default_name = options
            .notebook_name
            .clone()
            .unwrap_or_else(|| "Imported".to_string());
        let mut imported = 0u32;
        let mut skipped = 0u32;
        let mut duplicates = 0u32;
        let mut errors = Vec::new();
        let mut primary_notebook_id = None;
        let mut primary_notebook_name = None;
        let mut notebook_ids = std::collections::HashSet::new();

        for (index, enex_note) in parsed.notes.into_iter().enumerate() {
            let note_title = enex_note.title.clone();
            let notebook_id = if let Some(id) = options.notebook_id {
                id
            } else {
                let name = enex_note
                    .notebook
                    .clone()
                    .unwrap_or_else(|| default_name.clone());
                self.resolve_import_notebook_by_name(&name, options.stack_id)?
            };

            notebook_ids.insert(notebook_id);
            if primary_notebook_id.is_none() {
                primary_notebook_id = Some(notebook_id);
                primary_notebook_name = Some(self.get_notebook(notebook_id)?.name);
            }

            match self.import_enex_note(notebook_id, enex_note) {
                Ok(ImportOutcome::Imported) => imported += 1,
                Ok(ImportOutcome::Duplicate) => duplicates += 1,
                Err(e) => {
                    skipped += 1;
                    errors.push(ImportError {
                        index,
                        title: Some(note_title),
                        message: e.to_string(),
                    });
                }
            }
        }

        let notebook_id = primary_notebook_id
            .ok_or_else(|| NotebookError::InvalidInput("ENEX file contains no notes".to_string()))?;
        let notebook_count = notebook_ids.len() as u32;
        let notebook_name = if notebook_count > 1 {
            format!("{} notebooks", notebook_count)
        } else {
            primary_notebook_name.unwrap_or_else(|| default_name)
        };

        Ok(EnexImportResult {
            imported,
            skipped,
            duplicates,
            notebook_id,
            notebook_name,
            notebook_count,
            errors,
        })
    }

    pub fn import_enex_file(
        &self,
        path: &Path,
        options: EnexImportRequest,
    ) -> Result<EnexImportResult> {
        let data = std::fs::read(path).map_err(NotebookError::from)?;
        let mut options = options;
        if options.notebook_name.is_none() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                options.notebook_name = Some(stem.to_string());
            }
        }
        self.import_enex(&data, options)
    }

    fn resolve_import_notebook_by_name(&self, name: &str, stack_id: Option<Uuid>) -> Result<Uuid> {
        let notebooks = self.list_notebooks(false)?;
        if let Some(existing) = notebooks.into_iter().find(|nb| nb.name == name) {
            return Ok(existing.id);
        }

        let notebook = self.create_notebook(crate::models::CreateNotebookRequest {
            name: name.to_string(),
            stack_id,
            is_default: Some(false),
        })?;
        Ok(notebook.id)
    }

    fn import_enex_note(&self, notebook_id: Uuid, note: EnexNote) -> Result<ImportOutcome> {
        if self.note_already_imported(notebook_id, &note.title, note.created)? {
            return Ok(ImportOutcome::Duplicate);
        }

        let tag_ids: Vec<Uuid> = note
            .tags
            .iter()
            .map(|name| self.get_or_create_tag_by_name(name))
            .collect::<Result<Vec<_>>>()?
            .into_iter()
            .map(|t| t.id)
            .collect();

        let mut html = enex::enml_to_html(&note.content, &note.resources)?;

        let created = self.create_note(CreateNoteRequest {
            notebook_id,
            title: Some(note.title),
            content: Some(html.clone()),
            tag_ids: Some(tag_ids),
            is_pinned: None,
            reminder_at: note.reminder_at,
            source_url: note.source_url,
            is_template: None,
            template_category: None,
        })?;

        for resource in note.resources {
            let filename = resource.filename.clone().unwrap_or_else(|| {
                crate::content::default_attachment_name(&resource.mime)
            });
            let resource_marker = format!("notebook-resource://{}", resource.hash);
            let was_referenced = html.contains(&resource_marker);
            let attachment = self.add_attachment(
                created.id,
                filename.clone(),
                resource.mime.clone(),
                &resource.data,
            )?;
            let attachment_href = format!("notebook-attachment://{}", attachment.id);
            if was_referenced {
                html = html.replace(&resource_marker, &attachment_href);
            } else {
                html.push_str(&crate::content::file_attachment_html(
                    &attachment_href,
                    &filename,
                    &resource.mime,
                ));
            }
        }

        if html != created.content {
            self.update_note(
                created.id,
                UpdateNoteRequest {
                    content: Some(html),
                    ..Default::default()
                },
            )?;
        }

        // A note missing one of <created>/<updated> should still keep the
        // timestamp it does have, rather than falling through to "today" for
        // both. Evernote semantics: a note that was never updated has
        // updated == created.
        let created_at = note.created.or(note.updated);
        let updated_at = note.updated.or(note.created);
        if let (Some(created_at), Some(updated_at)) = (created_at, updated_at) {
            self.set_note_timestamps(created.id, created_at, updated_at)?;
        }

        Ok(ImportOutcome::Imported)
    }

    /// Keyed on notebook + title + created timestamp - title alone is not
    /// unique in real data. A note with no `<created>` timestamp can't be
    /// keyed safely, so it always imports (returns `false`).
    fn note_already_imported(
        &self,
        notebook_id: Uuid,
        title: &str,
        created: Option<DateTime<Utc>>,
    ) -> Result<bool> {
        let Some(created) = created else {
            return Ok(false);
        };
        let user_id = self.db().default_user_id()?;
        let mut stmt = self.db().connection().prepare(
            "SELECT created_at FROM notes WHERE user_id = ?1 AND notebook_id = ?2 AND title = ?3 AND deleted_at IS NULL",
        )?;
        let rows = stmt.query_map(
            rusqlite::params![user_id.to_string(), notebook_id.to_string(), title],
            |row| row.get::<_, String>(0),
        )?;
        for row in rows {
            let existing = row?;
            if let Ok(existing_dt) = DateTime::parse_from_rfc3339(&existing) {
                if existing_dt.with_timezone(&Utc) == created {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    }

    fn set_note_timestamps(
        &self,
        id: Uuid,
        created_at: DateTime<Utc>,
        updated_at: DateTime<Utc>,
    ) -> Result<()> {
        self.db().connection().execute(
            "UPDATE notes SET created_at = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![
                created_at.to_rfc3339(),
                updated_at.to_rfc3339(),
                id.to_string()
            ],
        )?;
        Ok(())
    }
}
