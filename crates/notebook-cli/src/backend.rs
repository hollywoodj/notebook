use std::path::Path;

use anyhow::Result;
use notebook_core::{
    Attachment, CreateNoteRequest, CreateNotebookRequest, CreateStackRequest, CreateTagRequest,
    EnexImportRequest, EnexImportResult, HealthResponse, Note, NoteRevision, NoteSummary, Notebook,
    SearchQuery, SearchResult, Shortcut, Stack, Tag, UpdateNoteRequest,
};
use uuid::Uuid;

/// What kind of backend is answering the command, and the connection details
/// worth surfacing to the user (via `notebook info`).
pub enum BackendInfo {
    Local {
        database: String,
    },
    Api {
        server: String,
        health: HealthResponse,
    },
}

/// The full command surface shared by both the local (SQLite) and API (HTTP)
/// backends. All dispatch and output rendering lives one layer up, in
/// `commands.rs`; implementations here return data, never print it.
pub trait NotebookBackend {
    fn info(&self) -> Result<BackendInfo>;

    fn list_notes(
        &self,
        notebook: Option<Uuid>,
        tag: Option<Uuid>,
        archived: Option<bool>,
    ) -> Result<Vec<NoteSummary>>;
    fn get_note(&self, id: Uuid) -> Result<Note>;
    fn create_note(&self, req: CreateNoteRequest) -> Result<Note>;
    fn update_note(&self, id: Uuid, req: UpdateNoteRequest) -> Result<Note>;
    fn delete_note(&self, id: Uuid) -> Result<()>;
    fn restore_note(&self, id: Uuid) -> Result<Note>;
    fn list_revisions(&self, id: Uuid) -> Result<Vec<NoteRevision>>;
    fn attach_file(
        &self,
        note_id: Uuid,
        filename: &str,
        mime: &str,
        data: &[u8],
    ) -> Result<Attachment>;

    fn list_notebooks(&self) -> Result<Vec<Notebook>>;
    fn create_notebook(&self, req: CreateNotebookRequest) -> Result<Notebook>;
    fn delete_notebook(&self, id: Uuid) -> Result<()>;

    fn list_tags(&self) -> Result<Vec<Tag>>;
    fn create_tag(&self, req: CreateTagRequest) -> Result<Tag>;
    fn delete_tag(&self, id: Uuid) -> Result<()>;
    fn get_or_create_tag(&self, name: &str) -> Result<Tag>;

    fn list_stacks(&self) -> Result<Vec<Stack>>;
    fn create_stack(&self, req: CreateStackRequest) -> Result<Stack>;
    fn delete_stack(&self, id: Uuid) -> Result<()>;

    fn search(&self, query: SearchQuery) -> Result<SearchResult>;

    fn list_trash(&self) -> Result<Vec<NoteSummary>>;
    fn empty_trash(&self) -> Result<usize>;

    fn list_shortcuts(&self) -> Result<Vec<NoteSummary>>;
    fn add_shortcut(&self, note_id: Uuid) -> Result<Shortcut>;
    fn remove_shortcut(&self, note_id: Uuid) -> Result<()>;

    /// Import exactly ONE .enex file. Directory expansion is the caller's job.
    fn import_enex_file(&self, path: &Path, options: EnexImportRequest)
        -> Result<EnexImportResult>;
}
