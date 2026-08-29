//! Test double for [`NotebookBackend`], used by `commands.rs`'s test suite
//! to drive [`crate::commands::run`] without a real database or HTTP server.
#![cfg(test)]

use std::cell::RefCell;
use std::collections::HashMap;
use std::path::{Path, PathBuf};

use anyhow::Result;
use notebook_core::{
    Attachment, CreateNoteRequest, CreateNotebookRequest, CreateStackRequest, CreateTagRequest,
    EnexImportRequest, EnexImportResult, Note, NoteRevision, NoteSummary, Notebook, SearchQuery,
    SearchResult, Shortcut, Stack, Tag, UpdateNoteRequest,
};
use uuid::Uuid;

use crate::backend::{BackendInfo, NotebookBackend};

/// One recorded call to `attach_file`: `(note_id, filename, mime, data)`.
type AttachCall = (Uuid, String, String, Vec<u8>);

/// A fixed, deterministic timestamp for fake records. Expands inline (rather
/// than through a helper function) so its return type is inferred from each
/// call site — notebook-cli has no direct `chrono` dependency to name
/// `chrono::DateTime<Utc>` with, so a typed helper function isn't an option.
macro_rules! dummy_time {
    () => {
        notebook_core::datetime::parse_dt("2026-01-01T00:00:00Z").expect("valid rfc3339 timestamp")
    };
}

/// Builds a `NoteSummary` with the given title and tag names; every other
/// field gets a fixed, deterministic value so assertions can pin down exact
/// output.
pub fn sample_note_summary(title: &str, tags: &[&str]) -> NoteSummary {
    NoteSummary {
        id: Uuid::new_v4(),
        notebook_id: Uuid::new_v4(),
        title: title.to_string(),
        snippet: String::new(),
        is_pinned: false,
        is_archived: false,
        reminder_at: None,
        tag_ids: tags.iter().map(|_| Uuid::new_v4()).collect(),
        tag_names: tags.iter().map(|s| s.to_string()).collect(),
        attachment_count: 0,
        thumbnail_url: None,
        checklist_done: 0,
        checklist_total: 0,
        is_template: false,
        template_category: None,
        notebook_name: "Default".to_string(),
        created_at: dummy_time!(),
        updated_at: dummy_time!(),
    }
}

fn sample_note() -> Note {
    Note {
        id: Uuid::new_v4(),
        user_id: Uuid::new_v4(),
        notebook_id: Uuid::new_v4(),
        title: "Sample".to_string(),
        content: "content".to_string(),
        content_plain: "content".to_string(),
        is_pinned: false,
        is_archived: false,
        reminder_at: None,
        source_url: None,
        latitude: None,
        longitude: None,
        is_template: false,
        template_category: None,
        template_key: None,
        tag_ids: Vec::new(),
        tag_names: Vec::new(),
        created_at: dummy_time!(),
        updated_at: dummy_time!(),
        deleted_at: None,
    }
}

/// A canned, call-recording implementation of [`NotebookBackend`]. Fields
/// are `pub` so tests can set canned return values directly; calls the
/// trait methods receive are recorded in the `RefCell` fields for
/// call-shape assertions (interior mutability is required because the
/// trait's methods all take `&self`).
pub struct FakeBackend {
    pub notes: Vec<NoteSummary>,
    pub note: Note,
    pub search_result: SearchResult,
    pub trash_deleted: usize,
    pub backend_info: BackendInfo,

    enex_result_for_file: RefCell<HashMap<String, EnexImportResult>>,

    pub attach_calls: RefCell<Vec<AttachCall>>,
    pub create_note_calls: RefCell<Vec<CreateNoteRequest>>,
    pub import_calls: RefCell<Vec<PathBuf>>,
    pub get_or_create_tag_calls: RefCell<Vec<String>>,
}

impl FakeBackend {
    pub fn new() -> Self {
        Self {
            notes: Vec::new(),
            note: sample_note(),
            search_result: SearchResult {
                notes: Vec::new(),
                total: 0,
            },
            trash_deleted: 0,
            backend_info: BackendInfo::Local {
                database: "test.db".to_string(),
            },
            enex_result_for_file: RefCell::new(HashMap::new()),
            attach_calls: RefCell::new(Vec::new()),
            create_note_calls: RefCell::new(Vec::new()),
            import_calls: RefCell::new(Vec::new()),
            get_or_create_tag_calls: RefCell::new(Vec::new()),
        }
    }

    /// Registers the `EnexImportResult` to return when `import_enex_file` is
    /// called with a path whose file name is `filename`.
    pub fn set_enex_result(&self, filename: &str, result: EnexImportResult) {
        self.enex_result_for_file
            .borrow_mut()
            .insert(filename.to_string(), result);
    }
}

impl Default for FakeBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl NotebookBackend for FakeBackend {
    fn info(&self) -> Result<BackendInfo> {
        match &self.backend_info {
            BackendInfo::Local { database } => Ok(BackendInfo::Local {
                database: database.clone(),
            }),
            BackendInfo::Api { server, health } => Ok(BackendInfo::Api {
                server: server.clone(),
                health: health.clone(),
            }),
        }
    }

    fn list_notes(
        &self,
        _notebook: Option<Uuid>,
        _tag: Option<Uuid>,
        _archived: Option<bool>,
    ) -> Result<Vec<NoteSummary>> {
        Ok(self.notes.clone())
    }

    fn get_note(&self, _id: Uuid) -> Result<Note> {
        Ok(self.note.clone())
    }

    fn create_note(&self, req: CreateNoteRequest) -> Result<Note> {
        let mut note = self.note.clone();
        if let Some(title) = &req.title {
            note.title = title.clone();
        }
        self.create_note_calls.borrow_mut().push(req);
        Ok(note)
    }

    fn update_note(&self, _id: Uuid, _req: UpdateNoteRequest) -> Result<Note> {
        Ok(self.note.clone())
    }

    fn delete_note(&self, _id: Uuid) -> Result<()> {
        Ok(())
    }

    fn restore_note(&self, _id: Uuid) -> Result<Note> {
        Ok(self.note.clone())
    }

    fn list_revisions(&self, _id: Uuid) -> Result<Vec<NoteRevision>> {
        Ok(Vec::new())
    }

    fn attach_file(
        &self,
        note_id: Uuid,
        filename: &str,
        mime: &str,
        data: &[u8],
    ) -> Result<Attachment> {
        self.attach_calls.borrow_mut().push((
            note_id,
            filename.to_string(),
            mime.to_string(),
            data.to_vec(),
        ));
        Ok(Attachment {
            id: Uuid::new_v4(),
            note_id,
            filename: filename.to_string(),
            mime_type: mime.to_string(),
            size: data.len() as i64,
            width: None,
            height: None,
            created_at: dummy_time!(),
            updated_at: dummy_time!(),
        })
    }

    fn list_notebooks(&self) -> Result<Vec<Notebook>> {
        Ok(Vec::new())
    }

    fn create_notebook(&self, req: CreateNotebookRequest) -> Result<Notebook> {
        Ok(Notebook {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            stack_id: req.stack_id,
            name: req.name,
            is_default: false,
            sort_order: 0,
            created_at: dummy_time!(),
            updated_at: dummy_time!(),
            deleted_at: None,
            note_count: 0,
        })
    }

    fn delete_notebook(&self, _id: Uuid) -> Result<()> {
        Ok(())
    }

    fn list_tags(&self) -> Result<Vec<Tag>> {
        Ok(Vec::new())
    }

    fn create_tag(&self, req: CreateTagRequest) -> Result<Tag> {
        Ok(Tag {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: req.name,
            created_at: dummy_time!(),
            updated_at: dummy_time!(),
            note_count: 0,
        })
    }

    fn delete_tag(&self, _id: Uuid) -> Result<()> {
        Ok(())
    }

    fn get_or_create_tag(&self, name: &str) -> Result<Tag> {
        self.get_or_create_tag_calls
            .borrow_mut()
            .push(name.to_string());
        Ok(Tag {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: name.to_string(),
            created_at: dummy_time!(),
            updated_at: dummy_time!(),
            note_count: 0,
        })
    }

    fn list_stacks(&self) -> Result<Vec<Stack>> {
        Ok(Vec::new())
    }

    fn create_stack(&self, req: CreateStackRequest) -> Result<Stack> {
        Ok(Stack {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            name: req.name,
            sort_order: 0,
            created_at: dummy_time!(),
            updated_at: dummy_time!(),
        })
    }

    fn delete_stack(&self, _id: Uuid) -> Result<()> {
        Ok(())
    }

    fn search(&self, _query: SearchQuery) -> Result<SearchResult> {
        Ok(self.search_result.clone())
    }

    fn list_trash(&self) -> Result<Vec<NoteSummary>> {
        Ok(self.notes.clone())
    }

    fn empty_trash(&self) -> Result<usize> {
        Ok(self.trash_deleted)
    }

    fn list_shortcuts(&self) -> Result<Vec<NoteSummary>> {
        Ok(self.notes.clone())
    }

    fn add_shortcut(&self, note_id: Uuid) -> Result<Shortcut> {
        Ok(Shortcut {
            id: Uuid::new_v4(),
            user_id: Uuid::new_v4(),
            note_id,
            sort_order: 0,
            created_at: dummy_time!(),
        })
    }

    fn remove_shortcut(&self, _note_id: Uuid) -> Result<()> {
        Ok(())
    }

    fn import_enex_file(
        &self,
        path: &Path,
        _options: EnexImportRequest,
    ) -> Result<EnexImportResult> {
        self.import_calls.borrow_mut().push(path.to_path_buf());
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or_default()
            .to_string();
        if let Some(result) = self.enex_result_for_file.borrow().get(&filename) {
            return Ok(result.clone());
        }
        Ok(EnexImportResult {
            imported: 0,
            skipped: 0,
            notebook_id: Uuid::new_v4(),
            notebook_name: "Imported".to_string(),
            notebook_count: 0,
            errors: Vec::new(),
        })
    }
}
