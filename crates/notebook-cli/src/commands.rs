use std::io::Write;
use std::path::Path;

use anyhow::Result;
use notebook_core::{
    CreateNoteRequest, CreateNotebookRequest, CreateStackRequest, CreateTagRequest,
    EnexImportRequest, EnexImportResult, NoteSummary, SearchQuery, UpdateNoteRequest,
};
use uuid::Uuid;

use crate::backend::{BackendInfo, NotebookBackend};
use crate::cli::{
    Commands, ImportAction, NoteAction, NotebookAction, ShortcutAction, StackAction, TagAction,
    TrashAction,
};

/// Dispatches a parsed `Commands` against whichever backend was chosen and
/// renders the result to `out`. This is the *only* place command output is
/// produced — both `LocalBackend` and `ApiClient` return plain data.
pub fn run(
    backend: &dyn NotebookBackend,
    command: &Commands,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match command {
        Commands::Info => info(backend, json_out, out),
        Commands::Note { action } => note(backend, action, json_out, out),
        Commands::Notebook { action } => notebook(backend, action, json_out, out),
        Commands::Tag { action } => tag(backend, action, json_out, out),
        Commands::Stack { action } => stack(backend, action, json_out, out),
        Commands::Search {
            query,
            notebook,
            tag,
            limit,
        } => search(
            backend,
            SearchQuery {
                q: query.clone(),
                notebook_id: *notebook,
                tag_id: *tag,
                include_trash: Some(false),
                include_archived: Some(true),
                limit: *limit,
                offset: None,
            },
            json_out,
            out,
        ),
        Commands::Trash { action } => trash(backend, action, json_out, out),
        Commands::Shortcut { action } => shortcut(backend, action, json_out, out),
        Commands::Import { action } => import(backend, action, json_out, out),
    }
}

fn info(backend: &dyn NotebookBackend, json_out: bool, out: &mut dyn Write) -> Result<()> {
    match backend.info()? {
        BackendInfo::Local { database } => {
            if json_out {
                writeln!(
                    out,
                    "{}",
                    serde_json::json!({
                        "mode": "local",
                        "database": database,
                    })
                )?;
            } else {
                writeln!(out, "Mode: local")?;
                writeln!(out, "Database: {database}")?;
            }
        }
        BackendInfo::Api { server, health } => {
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&health)?)?;
            } else {
                writeln!(out, "Mode: api")?;
                writeln!(out, "Server: {server}")?;
                writeln!(out, "Status: {}", health.status)?;
                writeln!(out, "Database: {}", health.database)?;
            }
        }
    }
    Ok(())
}

fn note(
    backend: &dyn NotebookBackend,
    action: &NoteAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        NoteAction::List {
            notebook,
            tag,
            archived,
        } => {
            let notes = backend.list_notes(*notebook, *tag, *archived)?;
            print_notes(&notes, json_out, out)?;
        }
        NoteAction::Get { id } => {
            let note = backend.get_note(*id)?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&note)?)?;
            } else {
                writeln!(out, "{} ({})", display_title(&note.title), note.id)?;
                writeln!(out, "Updated: {}", note.updated_at)?;
                writeln!(out, "\n{}", note.content)?;
            }
        }
        NoteAction::Create {
            notebook,
            title,
            content,
            file,
            tags,
            pinned,
        } => {
            let content = resolve_content(content.as_deref(), file.as_deref())?;
            let tag_ids = parse_tag_names(backend, tags.as_deref())?;
            let note = backend.create_note(CreateNoteRequest {
                notebook_id: *notebook,
                title: Some(title.clone()),
                content: Some(content),
                tag_ids,
                is_pinned: Some(*pinned),
                reminder_at: None,
                source_url: None,
                is_template: None,
                template_category: None,
            })?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&note)?)?;
            } else {
                writeln!(
                    out,
                    "Created note {} ({})",
                    display_title(&note.title),
                    note.id
                )?;
            }
        }
        NoteAction::Update {
            id,
            title,
            content,
            notebook,
            pinned,
            archived,
        } => {
            let note = backend.update_note(
                *id,
                UpdateNoteRequest {
                    notebook_id: *notebook,
                    title: title.clone(),
                    content: content.clone(),
                    tag_ids: None,
                    is_pinned: *pinned,
                    is_archived: *archived,
                    reminder_at: None,
                    source_url: None,
                    is_template: None,
                    template_category: None,
                },
            )?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&note)?)?;
            } else {
                writeln!(
                    out,
                    "Updated note {} ({})",
                    display_title(&note.title),
                    note.id
                )?;
            }
        }
        NoteAction::Delete { id } => {
            backend.delete_note(*id)?;
            writeln!(out, "Moved note {id} to trash")?;
        }
        NoteAction::Restore { id } => {
            let note = backend.restore_note(*id)?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&note)?)?;
            } else {
                writeln!(
                    out,
                    "Restored note {} ({})",
                    display_title(&note.title),
                    note.id
                )?;
            }
        }
        NoteAction::Revisions { id } => {
            let revisions = backend.list_revisions(*id)?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&revisions)?)?;
            } else {
                for rev in revisions {
                    writeln!(out, "{} — {} ({})", rev.created_at, rev.title, rev.id)?;
                }
            }
        }
        NoteAction::Attach { id, file } => {
            let filename = file
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("attachment")
                .to_string();
            let data = std::fs::read(file)?;
            let mime = mime_guess(&filename);
            let att = backend.attach_file(*id, &filename, &mime, &data)?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&att)?)?;
            } else {
                writeln!(out, "Attached {} ({})", att.filename, att.id)?;
            }
        }
    }
    Ok(())
}

fn notebook(
    backend: &dyn NotebookBackend,
    action: &NotebookAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        NotebookAction::List => {
            let notebooks = backend.list_notebooks()?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&notebooks)?)?;
            } else {
                for nb in notebooks {
                    writeln!(out, "{} ({})", nb.name, nb.id)?;
                }
            }
        }
        NotebookAction::Create { name, stack } => {
            let nb = backend.create_notebook(CreateNotebookRequest {
                name: name.clone(),
                stack_id: *stack,
                is_default: None,
            })?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&nb)?)?;
            } else {
                writeln!(out, "Created notebook {} ({})", nb.name, nb.id)?;
            }
        }
        NotebookAction::Delete { id } => {
            backend.delete_notebook(*id)?;
            writeln!(out, "Deleted notebook {id}")?;
        }
    }
    Ok(())
}

fn tag(
    backend: &dyn NotebookBackend,
    action: &TagAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        TagAction::List => {
            let tags = backend.list_tags()?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&tags)?)?;
            } else {
                for tag in tags {
                    writeln!(out, "{} ({})", tag.name, tag.id)?;
                }
            }
        }
        TagAction::Create { name } => {
            let tag = backend.create_tag(CreateTagRequest { name: name.clone() })?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&tag)?)?;
            } else {
                writeln!(out, "Created tag {} ({})", tag.name, tag.id)?;
            }
        }
        TagAction::Delete { id } => {
            backend.delete_tag(*id)?;
            writeln!(out, "Deleted tag {id}")?;
        }
    }
    Ok(())
}

fn stack(
    backend: &dyn NotebookBackend,
    action: &StackAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        StackAction::List => {
            let stacks = backend.list_stacks()?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&stacks)?)?;
            } else {
                for stack in stacks {
                    writeln!(out, "{} ({})", stack.name, stack.id)?;
                }
            }
        }
        StackAction::Create { name } => {
            let stack = backend.create_stack(CreateStackRequest { name: name.clone() })?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&stack)?)?;
            } else {
                writeln!(out, "Created stack {} ({})", stack.name, stack.id)?;
            }
        }
        StackAction::Delete { id } => {
            backend.delete_stack(*id)?;
            writeln!(out, "Deleted stack {id}")?;
        }
    }
    Ok(())
}

fn search(
    backend: &dyn NotebookBackend,
    query: SearchQuery,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    let result = backend.search(query)?;
    if json_out {
        writeln!(out, "{}", serde_json::to_string_pretty(&result)?)?;
    } else {
        writeln!(out, "Found {} notes", result.total)?;
        print_notes(&result.notes, false, out)?;
    }
    Ok(())
}

fn trash(
    backend: &dyn NotebookBackend,
    action: &TrashAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        TrashAction::List => {
            let notes = backend.list_trash()?;
            print_notes(&notes, json_out, out)?;
        }
        TrashAction::Empty => {
            let count = backend.empty_trash()?;
            writeln!(out, "Permanently deleted {count} notes")?;
        }
    }
    Ok(())
}

fn shortcut(
    backend: &dyn NotebookBackend,
    action: &ShortcutAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        ShortcutAction::List => {
            let notes = backend.list_shortcuts()?;
            print_notes(&notes, json_out, out)?;
        }
        ShortcutAction::Add { note_id } => {
            let shortcut = backend.add_shortcut(*note_id)?;
            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&shortcut)?)?;
            } else {
                writeln!(out, "Shortcut added for note {note_id}")?;
            }
        }
        ShortcutAction::Remove { note_id } => {
            backend.remove_shortcut(*note_id)?;
            writeln!(out, "Shortcut removed for note {note_id}")?;
        }
    }
    Ok(())
}

fn import(
    backend: &dyn NotebookBackend,
    action: &ImportAction,
    json_out: bool,
    out: &mut dyn Write,
) -> Result<()> {
    match action {
        ImportAction::Enex {
            path,
            notebook,
            notebook_name,
            stack,
        } => {
            let options = EnexImportRequest {
                notebook_id: *notebook,
                notebook_name: notebook_name.clone(),
                stack_id: *stack,
            };
            let results = if path.is_dir() {
                let mut combined: Option<EnexImportResult> = None;
                for entry in std::fs::read_dir(path)? {
                    let entry = entry?;
                    let file_path = entry.path();
                    if file_path.extension().and_then(|s| s.to_str()) == Some("enex") {
                        let result = backend.import_enex_file(&file_path, options.clone())?;
                        combined = Some(match combined {
                            Some(mut acc) => {
                                acc.imported += result.imported;
                                acc.skipped += result.skipped;
                                acc.duplicates += result.duplicates;
                                acc.notebook_count = acc.notebook_count.max(result.notebook_count);
                                acc.errors.extend(result.errors);
                                acc
                            }
                            None => result,
                        });
                    }
                }
                combined.ok_or_else(|| anyhow::anyhow!("no .enex files found in directory"))?
            } else {
                backend.import_enex_file(path, options)?
            };

            if json_out {
                writeln!(out, "{}", serde_json::to_string_pretty(&results)?)?;
            } else {
                let duplicates_suffix = if results.duplicates > 0 {
                    format!(", {} already imported", results.duplicates)
                } else {
                    String::new()
                };
                writeln!(
                    out,
                    "Imported {} notes into '{}' ({} skipped{})",
                    results.imported, results.notebook_name, results.skipped, duplicates_suffix
                )?;
                for err in &results.errors {
                    writeln!(out, "  error[{}]: {}", err.index, err.message)?;
                }
            }
        }
    }
    Ok(())
}

fn resolve_content(content: Option<&str>, file: Option<&Path>) -> Result<String> {
    if let Some(path) = file {
        Ok(std::fs::read_to_string(path)?)
    } else {
        Ok(content.unwrap_or_default().to_string())
    }
}

fn parse_tag_names(backend: &dyn NotebookBackend, tags: Option<&str>) -> Result<Option<Vec<Uuid>>> {
    let Some(names) = tags else {
        return Ok(None);
    };
    let mut ids = Vec::new();
    for name in names.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        let tag = backend.get_or_create_tag(name)?;
        ids.push(tag.id);
    }
    Ok(Some(ids))
}

fn print_notes(notes: &[NoteSummary], json_out: bool, out: &mut dyn Write) -> Result<()> {
    if json_out {
        writeln!(
            out,
            "{}",
            serde_json::to_string_pretty(notes).unwrap_or_default()
        )?;
        return Ok(());
    }
    for note in notes {
        let tags = if note.tag_names.is_empty() {
            String::new()
        } else {
            format!(" [{}]", note.tag_names.join(", "))
        };
        writeln!(
            out,
            "{} — {}{} ({})",
            note.updated_at.format("%Y-%m-%d"),
            display_title(&note.title),
            tags,
            note.id
        )?;
    }
    Ok(())
}

fn mime_guess(filename: &str) -> String {
    let lower = filename.to_lowercase();
    if lower.ends_with(".png") {
        "image/png".into()
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg".into()
    } else if lower.ends_with(".pdf") {
        "application/pdf".into()
    } else if lower.ends_with(".txt") {
        "text/plain".into()
    } else if lower.ends_with(".html") {
        "text/html".into()
    } else {
        "application/octet-stream".into()
    }
}

/// Notes may carry an empty title; show the same "Untitled" placeholder the
/// desktop app uses rather than printing a blank column.
fn display_title(title: &str) -> &str {
    if title.trim().is_empty() {
        "Untitled"
    } else {
        title
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cli::ImportAction as ImportActionCli;
    use crate::fake::{sample_note_summary, FakeBackend};
    use notebook_core::db::TempDir;
    use notebook_core::{HealthResponse, ImportError};

    fn run_text(backend: &dyn NotebookBackend, command: &Commands) -> String {
        let mut buf = Vec::new();
        run(backend, command, false, &mut buf).expect("command should succeed");
        String::from_utf8(buf).expect("utf8 output")
    }

    fn run_json(backend: &dyn NotebookBackend, command: &Commands) -> String {
        let mut buf = Vec::new();
        run(backend, command, true, &mut buf).expect("command should succeed");
        String::from_utf8(buf).expect("utf8 output")
    }

    #[test]
    fn note_list_text_renders_date_title_tags_and_id() {
        let mut backend = FakeBackend::new();
        let n = sample_note_summary("My Note", &["work", "ideas"]);
        let id = n.id;
        let date = n.updated_at.format("%Y-%m-%d").to_string();
        backend.notes = vec![n];

        let output = run_text(
            &backend,
            &Commands::Note {
                action: NoteAction::List {
                    notebook: None,
                    tag: None,
                    archived: None,
                },
            },
        );

        assert_eq!(output, format!("{date} — My Note [work, ideas] ({id})\n"));
    }

    #[test]
    fn note_list_json_emits_summaries_array() {
        let mut backend = FakeBackend::new();
        let n = sample_note_summary("My Note", &[]);
        backend.notes = vec![n.clone()];

        let output = run_json(
            &backend,
            &Commands::Note {
                action: NoteAction::List {
                    notebook: None,
                    tag: None,
                    archived: None,
                },
            },
        );

        let parsed: Vec<NoteSummary> = serde_json::from_str(&output).unwrap();
        assert_eq!(parsed.len(), 1);
        assert_eq!(parsed[0].id, n.id);
    }

    #[test]
    fn note_with_empty_title_renders_as_untitled() {
        let mut backend = FakeBackend::new();
        backend.notes = vec![sample_note_summary("", &[])];

        let output = run_text(
            &backend,
            &Commands::Note {
                action: NoteAction::List {
                    notebook: None,
                    tag: None,
                    archived: None,
                },
            },
        );

        assert!(output.contains("Untitled"), "output was: {output}");
    }

    #[test]
    fn note_attach_sniffs_mime_and_forwards_to_backend() {
        let backend = FakeBackend::new();
        let dir = TempDir::new("notebook-cli-test").unwrap();
        let file_path = dir.path().join("foo.pdf");
        std::fs::write(&file_path, b"%PDF-1.4 fake").unwrap();
        let note_id = Uuid::new_v4();

        let _output = run_text(
            &backend,
            &Commands::Note {
                action: NoteAction::Attach {
                    id: note_id,
                    file: file_path,
                },
            },
        );

        let calls = backend.attach_calls.borrow();
        assert_eq!(calls.len(), 1);
        let (recorded_note_id, filename, mime, data) = &calls[0];
        assert_eq!(*recorded_note_id, note_id);
        assert_eq!(filename, "foo.pdf");
        assert_eq!(mime, "application/pdf");
        assert_eq!(data, b"%PDF-1.4 fake");
    }

    #[test]
    fn note_create_trims_and_resolves_tag_names() {
        let backend = FakeBackend::new();

        let _output = run_text(
            &backend,
            &Commands::Note {
                action: NoteAction::Create {
                    notebook: Uuid::new_v4(),
                    title: "Untitled".to_string(),
                    content: Some("hello".to_string()),
                    file: None,
                    tags: Some("a, b".to_string()),
                    pinned: false,
                },
            },
        );

        let resolved = backend.get_or_create_tag_calls.borrow();
        assert_eq!(resolved.as_slice(), ["a", "b"]);

        let created = backend.create_note_calls.borrow();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].content.as_deref(), Some("hello"));
    }

    #[test]
    fn import_enex_directory_combines_per_file_results() {
        let dir = TempDir::new("notebook-cli-import-test").unwrap();
        std::fs::write(dir.path().join("a.enex"), b"<a/>").unwrap();
        std::fs::write(dir.path().join("b.enex"), b"<b/>").unwrap();
        std::fs::write(dir.path().join("ignore.txt"), b"not enex").unwrap();

        let backend = FakeBackend::new();
        backend.set_enex_result(
            "a.enex",
            EnexImportResult {
                imported: 2,
                skipped: 1,
                duplicates: 0,
                notebook_id: Uuid::new_v4(),
                notebook_name: "Imported".to_string(),
                notebook_count: 1,
                errors: vec![ImportError {
                    index: 0,
                    title: Some("bad".to_string()),
                    message: "boom".to_string(),
                }],
            },
        );
        backend.set_enex_result(
            "b.enex",
            EnexImportResult {
                imported: 5,
                skipped: 0,
                duplicates: 0,
                notebook_id: Uuid::new_v4(),
                notebook_name: "Imported".to_string(),
                notebook_count: 3,
                errors: vec![],
            },
        );

        let output = run_text(
            &backend,
            &Commands::Import {
                action: ImportActionCli::Enex {
                    path: dir.path().to_path_buf(),
                    notebook: None,
                    notebook_name: None,
                    stack: None,
                },
            },
        );

        let calls = backend.import_calls.borrow();
        assert_eq!(calls.len(), 2);

        assert!(output.contains("Imported 7 notes into 'Imported' (1 skipped)"));
        assert!(!output.contains("already imported"));
        assert!(output.contains("boom"));
    }

    #[test]
    fn import_enex_directory_reports_duplicates_when_present() {
        let dir = TempDir::new("notebook-cli-import-dup-test").unwrap();
        std::fs::write(dir.path().join("a.enex"), b"<a/>").unwrap();

        let backend = FakeBackend::new();
        backend.set_enex_result(
            "a.enex",
            EnexImportResult {
                imported: 5,
                skipped: 0,
                duplicates: 3,
                notebook_id: Uuid::new_v4(),
                notebook_name: "Music".to_string(),
                notebook_count: 1,
                errors: vec![],
            },
        );

        let output = run_text(
            &backend,
            &Commands::Import {
                action: ImportActionCli::Enex {
                    path: dir.path().to_path_buf(),
                    notebook: None,
                    notebook_name: None,
                    stack: None,
                },
            },
        );

        assert!(output.contains("Imported 5 notes into 'Music' (0 skipped, 3 already imported)"));
    }

    #[test]
    fn import_enex_directory_with_no_enex_files_errors() {
        let dir = TempDir::new("notebook-cli-import-empty-test").unwrap();
        std::fs::write(dir.path().join("readme.txt"), b"nothing here").unwrap();

        let backend = FakeBackend::new();
        let mut buf = Vec::new();
        let err = run(
            &backend,
            &Commands::Import {
                action: ImportActionCli::Enex {
                    path: dir.path().to_path_buf(),
                    notebook: None,
                    notebook_name: None,
                    stack: None,
                },
            },
            false,
            &mut buf,
        )
        .unwrap_err();

        assert_eq!(err.to_string(), "no .enex files found in directory");
    }

    #[test]
    fn search_renders_found_count_and_rows() {
        let mut backend = FakeBackend::new();
        let n = sample_note_summary("Result One", &[]);
        let id = n.id;
        let date = n.updated_at.format("%Y-%m-%d").to_string();
        backend.search_result = notebook_core::SearchResult {
            notes: vec![n],
            total: 1,
        };

        let output = run_text(
            &backend,
            &Commands::Search {
                query: "hello".to_string(),
                notebook: None,
                tag: None,
                limit: None,
            },
        );

        assert_eq!(
            output,
            format!("Found 1 notes\n{date} — Result One ({id})\n")
        );
    }

    #[test]
    fn trash_empty_prints_count() {
        let mut backend = FakeBackend::new();
        backend.trash_deleted = 3;

        let output = run_text(
            &backend,
            &Commands::Trash {
                action: TrashAction::Empty,
            },
        );

        assert_eq!(output, "Permanently deleted 3 notes\n");
    }

    #[test]
    fn info_local_produces_local_json_shape() {
        let mut backend = FakeBackend::new();
        backend.backend_info = BackendInfo::Local {
            database: "C:/db.sqlite".to_string(),
        };

        let output = run_json(&backend, &Commands::Info);
        let value: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(value["mode"], "local");
        assert_eq!(value["database"], "C:/db.sqlite");
    }

    #[test]
    fn info_api_produces_health_json_shape() {
        let mut backend = FakeBackend::new();
        backend.backend_info = BackendInfo::Api {
            server: "http://127.0.0.1:8799".to_string(),
            health: HealthResponse {
                status: "ok".to_string(),
                version: "1.2.3".to_string(),
                database: "postgres".to_string(),
            },
        };

        let output = run_json(&backend, &Commands::Info);
        let value: serde_json::Value = serde_json::from_str(&output).unwrap();
        assert_eq!(value["status"], "ok");
        assert_eq!(value["version"], "1.2.3");
        assert_eq!(value["database"], "postgres");
    }

    #[test]
    fn mime_guess_matches_known_extensions() {
        assert_eq!(mime_guess("photo.PNG"), "image/png");
        assert_eq!(mime_guess("photo.jpg"), "image/jpeg");
        assert_eq!(mime_guess("photo.jpeg"), "image/jpeg");
        assert_eq!(mime_guess("doc.pdf"), "application/pdf");
        assert_eq!(mime_guess("notes.txt"), "text/plain");
        assert_eq!(mime_guess("page.html"), "text/html");
        assert_eq!(mime_guess("archive.zip"), "application/octet-stream");
    }
}
