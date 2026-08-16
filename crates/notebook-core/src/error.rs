use thiserror::Error;

pub type Result<T> = std::result::Result<T, NotebookError>;

#[derive(Debug, Error)]
pub enum NotebookError {
    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invalid input: {0}")]
    InvalidInput(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    Other(String),
}
