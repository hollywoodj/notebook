use std::path::PathBuf;

use clap::{Parser, Subcommand};
use uuid::Uuid;

#[derive(Parser)]
#[command(
    name = "notebook",
    about = "Notebook CLI — Evernote-compatible notes for your stack",
    version
)]
pub struct Cli {
    /// Path to local SQLite database (local mode)
    #[arg(long, env = "NOTEBOOK_DB", global = true)]
    pub db: Option<PathBuf>,

    /// Remote API base URL (e.g. http://127.0.0.1:8799). When set, all commands use the API.
    #[arg(long, env = "NOTEBOOK_API", default_value = "", global = true)]
    pub api: String,

    /// Output format: text or json
    #[arg(long, default_value = "text", global = true)]
    pub output: String,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Show connection info
    Info,
    /// Note operations
    Note {
        #[command(subcommand)]
        action: NoteAction,
    },
    /// Notebook operations
    Notebook {
        #[command(subcommand)]
        action: NotebookAction,
    },
    /// Tag operations
    Tag {
        #[command(subcommand)]
        action: TagAction,
    },
    /// Stack operations
    Stack {
        #[command(subcommand)]
        action: StackAction,
    },
    /// Full-text search
    Search {
        query: String,
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        tag: Option<Uuid>,
        #[arg(long)]
        limit: Option<u32>,
    },
    /// Trash operations
    Trash {
        #[command(subcommand)]
        action: TrashAction,
    },
    /// Shortcut operations
    Shortcut {
        #[command(subcommand)]
        action: ShortcutAction,
    },
    /// Import notes from external formats
    Import {
        #[command(subcommand)]
        action: ImportAction,
    },
}

#[derive(Subcommand)]
pub enum ImportAction {
    /// Import notes from an Evernote ENEX export file
    Enex {
        /// Path to .enex file (or directory of .enex files)
        path: PathBuf,
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        notebook_name: Option<String>,
        #[arg(long)]
        stack: Option<Uuid>,
    },
}

#[derive(Subcommand)]
pub enum NoteAction {
    List {
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        tag: Option<Uuid>,
        #[arg(long)]
        archived: Option<bool>,
    },
    Get {
        id: Uuid,
    },
    Create {
        #[arg(long)]
        notebook: Uuid,
        #[arg(long, default_value = "Untitled")]
        title: String,
        #[arg(long)]
        content: Option<String>,
        #[arg(long)]
        file: Option<PathBuf>,
        #[arg(long)]
        tags: Option<String>,
        #[arg(long)]
        pinned: bool,
    },
    Update {
        id: Uuid,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        content: Option<String>,
        #[arg(long)]
        notebook: Option<Uuid>,
        #[arg(long)]
        pinned: Option<bool>,
        #[arg(long)]
        archived: Option<bool>,
    },
    Delete {
        id: Uuid,
    },
    Restore {
        id: Uuid,
    },
    Revisions {
        id: Uuid,
    },
    Attach {
        id: Uuid,
        file: PathBuf,
    },
}

#[derive(Subcommand)]
pub enum NotebookAction {
    List,
    Create {
        name: String,
        #[arg(long)]
        stack: Option<Uuid>,
    },
    Delete {
        id: Uuid,
    },
}

#[derive(Subcommand)]
pub enum TagAction {
    List,
    Create { name: String },
    Delete { id: Uuid },
}

#[derive(Subcommand)]
pub enum StackAction {
    List,
    Create { name: String },
    Delete { id: Uuid },
}

#[derive(Subcommand)]
pub enum TrashAction {
    List,
    Empty,
}

#[derive(Subcommand)]
pub enum ShortcutAction {
    List,
    Add { note_id: Uuid },
    Remove { note_id: Uuid },
}
