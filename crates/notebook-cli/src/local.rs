use std::path::Path;

use anyhow::Result;
use notebook_core::{
    Attachment, CreateNoteRequest, CreateNotebookRequest, CreateStackRequest, CreateTagRequest,
    EnexImportRequest, EnexImportResult, Note, NoteRevision, NoteSummary, Notebook,
    NotebookService, SearchQuery, SearchResult, Shortcut, Stack, Tag, UpdateNoteRequest,
};
use uuid::Uuid;

use crate::backend::{BackendInfo, NotebookBackend};

pub struct LocalBackend {
    service: NotebookService,
}

impl LocalBackend {
    pub fn new(service: NotebookService) -> Self {
        Self { service }
    }
}

impl NotebookBackend for LocalBackend {
    fn info(&self) -> Result<BackendInfo> {
        let database = self
            .service
            .db()
            .connection()
            .path()
            .unwrap_or("memory")
            .to_string();
        Ok(BackendInfo::Local { database })
    }

    fn list_notes(
        &self,
        notebook: Option<Uuid>,
        tag: Option<Uuid>,
        archived: Option<bool>,
    ) -> Result<Vec<NoteSummary>> {
        Ok(self
            .service
            .list_notes(notebook, tag, false, archived, None)?)
    }

    fn get_note(&self, id: Uuid) -> Result<Note> {
        Ok(self.service.get_note(id)?)
    }

    fn create_note(&self, req: CreateNoteRequest) -> Result<Note> {
        Ok(self.service.create_note(req)?)
    }

    fn update_note(&self, id: Uuid, req: UpdateNoteRequest) -> Result<Note> {
        Ok(self.service.update_note(id, req)?)
    }

    fn delete_note(&self, id: Uuid) -> Result<()> {
        Ok(self.service.delete_note(id)?)
    }

    fn restore_note(&self, id: Uuid) -> Result<Note> {
        Ok(self.service.restore_note(id)?)
    }

    fn list_revisions(&self, id: Uuid) -> Result<Vec<NoteRevision>> {
        Ok(self.service.list_revisions(id)?)
    }

    fn attach_file(
        &self,
        note_id: Uuid,
        filename: &str,
        mime: &str,
        data: &[u8],
    ) -> Result<Attachment> {
        Ok(self
            .service
            .add_attachment(note_id, filename.to_string(), mime.to_string(), data)?)
    }

    fn list_notebooks(&self) -> Result<Vec<Notebook>> {
        Ok(self.service.list_notebooks(false)?)
    }

    fn create_notebook(&self, req: CreateNotebookRequest) -> Result<Notebook> {
        Ok(self.service.create_notebook(req)?)
    }

    fn delete_notebook(&self, id: Uuid) -> Result<()> {
        Ok(self.service.delete_notebook(id)?)
    }

    fn list_tags(&self) -> Result<Vec<Tag>> {
        Ok(self.service.list_tags()?)
    }

    fn create_tag(&self, req: CreateTagRequest) -> Result<Tag> {
        Ok(self.service.create_tag(req)?)
    }

    fn delete_tag(&self, id: Uuid) -> Result<()> {
        Ok(self.service.delete_tag(id)?)
    }

    fn get_or_create_tag(&self, name: &str) -> Result<Tag> {
        Ok(self.service.get_or_create_tag_by_name(name)?)
    }

    fn list_stacks(&self) -> Result<Vec<Stack>> {
        Ok(self.service.list_stacks()?)
    }

    fn create_stack(&self, req: CreateStackRequest) -> Result<Stack> {
        Ok(self.service.create_stack(req)?)
    }

    fn delete_stack(&self, id: Uuid) -> Result<()> {
        Ok(self.service.delete_stack(id)?)
    }

    fn search(&self, query: SearchQuery) -> Result<SearchResult> {
        Ok(self.service.search(query)?)
    }

    fn list_trash(&self) -> Result<Vec<NoteSummary>> {
        Ok(self.service.list_notes(None, None, true, None, None)?)
    }

    fn empty_trash(&self) -> Result<usize> {
        Ok(self.service.empty_trash()? as usize)
    }

    fn list_shortcuts(&self) -> Result<Vec<NoteSummary>> {
        let shortcuts = self.service.list_shortcuts()?;
        Ok(shortcuts.into_iter().map(|(_, n)| n).collect())
    }

    fn add_shortcut(&self, note_id: Uuid) -> Result<Shortcut> {
        Ok(self.service.add_shortcut(note_id)?)
    }

    fn remove_shortcut(&self, note_id: Uuid) -> Result<()> {
        Ok(self.service.remove_shortcut(note_id)?)
    }

    fn import_enex_file(
        &self,
        path: &Path,
        options: EnexImportRequest,
    ) -> Result<EnexImportResult> {
        Ok(self.service.import_enex_file(path, options)?)
    }
}
