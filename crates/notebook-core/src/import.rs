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

impl NotebookService {
    pub fn import_enex(&self, data: &[u8], options: EnexImportRequest) -> Result<EnexImportResult> {
        let parsed = parse_enex(data)?;
        let default_name = options
            .notebook_name
            .clone()
            .unwrap_or_else(|| "Imported".to_string());
        let mut imported = 0u32;
        let mut skipped = 0u32;
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
                Ok(()) => imported += 1,
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

        let notebook_id = primary_notebook_id.ok_or_else(|| {
            NotebookError::Other("ENEX file contains no notes".to_string())
        })?;
        let notebook_count = notebook_ids.len() as u32;
        let notebook_name = if notebook_count > 1 {
            format!("{} notebooks", notebook_count)
        } else {
            primary_notebook_name.unwrap_or_else(|| default_name)
        };

        Ok(EnexImportResult {
            imported,
            skipped,
            notebook_id,
            notebook_name,
            notebook_count,
            errors,
        })
    }

    pub fn import_enex_file(&self, path: &Path, options: EnexImportRequest) -> Result<EnexImportResult> {
        let data = std::fs::read(path).map_err(NotebookError::from)?;
        let mut options = options;
        if options.notebook_name.is_none() {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                options.notebook_name = Some(stem.to_string());
            }
        }
        self.import_enex(&data, options)
    }

    fn resolve_import_notebook_by_name(
        &self,
        name: &str,
        stack_id: Option<Uuid>,
    ) -> Result<Uuid> {
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

    fn import_enex_note(&self, notebook_id: Uuid, note: EnexNote) -> Result<()> {
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
            content: Some(html),
            tag_ids: Some(tag_ids),
            is_pinned: None,
            reminder_at: note.reminder_at,
            source_url: note.source_url,
            is_template: None,
            template_category: None,
        })?;

        for resource in note.resources {
            if resource.mime.starts_with("image/") {
                continue;
            }
            let resource_marker = format!("notebook-resource://{}", resource.hash);
            let attachment = self.add_attachment(
                created.id,
                resource
                    .filename
                    .unwrap_or_else(|| "attachment".to_string()),
                resource.mime,
                &resource.data,
            )?;
            html = html.replace(
                &resource_marker,
                &format!("notebook-attachment://{}", attachment.id),
            );
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

        if let (Some(created_at), Some(updated_at)) = (note.created, note.updated) {
            self.set_note_timestamps(created.id, created_at, updated_at)?;
        }

        Ok(())
    }

    fn set_note_timestamps(&self, id: Uuid, created_at: DateTime<Utc>, updated_at: DateTime<Utc>) -> Result<()> {
        self.db().connection().execute(
            "UPDATE notes SET created_at = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![created_at.to_rfc3339(), updated_at.to_rfc3339(), id.to_string()],
        )?;
        Ok(())
    }
}
