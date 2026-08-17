use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{DefaultBodyLimit, Multipart, Path, Query, State},
    http::{header, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use notebook_core::{
    CreateNotebookRequest, CreateNoteRequest, CreateStackRequest, CreateTagRequest, Database,
    EnexImportRequest, HealthResponse, NotebookService, SearchQuery, UpdateNoteRequest,
    UpdateNotebookRequest, UpdateStackRequest, UpdateTagRequest, UpdateUserRequest,
    UseTemplateRequest,
};
use serde::Deserialize;
use tokio::sync::Mutex;
use tower_http::cors::{AllowHeaders, AllowMethods, AllowOrigin, CorsLayer};
use tower_http::trace::TraceLayer;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

/// Evernote notebook exports with images routinely exceed Axum's 2 MiB default.
/// Going over that limit closes the connection mid-upload, which Chromium reports
/// as `TypeError: Failed to fetch`.
const MAX_UPLOAD_BYTES: usize = 2 * 1024 * 1024 * 1024;

pub struct ServerConfig {
    pub host: String,
    pub port: u16,
    pub db_path: Option<String>,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self {
            host: std::env::var("NOTEBOOK_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
            port: std::env::var("NOTEBOOK_PORT")
                .ok()
                .and_then(|p| p.parse().ok())
                .unwrap_or(8799),
            db_path: std::env::var("NOTEBOOK_DB").ok(),
        }
    }
}

pub fn init_tracing() {
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "notebook_api=info,tower_http=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .try_init();
}

pub async fn run(config: ServerConfig) -> anyhow::Result<()> {
    let db_path = config.db_path.unwrap_or_else(|| {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("notebook")
            .join("notebook.db")
            .to_string_lossy()
            .to_string()
    });

    let db = Database::open(&db_path)?;
    let service = NotebookService::new(db);
    let state = AppState {
        service: Arc::new(Mutex::new(service)),
    };

    let app = build_router(state);

    let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;
    tracing::info!("Notebook API listening on http://{addr}");
    tracing::info!("Database: {db_path}");

    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn build_router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/api/v1/notebooks", get(list_notebooks).post(create_notebook))
        .route(
            "/api/v1/notebooks/:id",
            get(get_notebook)
                .put(update_notebook)
                .delete(delete_notebook),
        )
        .route("/api/v1/notebooks/:id/restore", post(restore_notebook))
        .route("/api/v1/stacks", get(list_stacks).post(create_stack))
        .route(
            "/api/v1/stacks/:id",
            get(get_stack).put(update_stack).delete(delete_stack),
        )
        .route("/api/v1/tags", get(list_tags).post(create_tag))
        .route(
            "/api/v1/tags/:id",
            get(get_tag).put(update_tag).delete(delete_tag),
        )
        .route("/api/v1/notes", get(list_notes).post(create_note))
        .route(
            "/api/v1/notes/:id",
            get(get_note).put(update_note).delete(delete_note),
        )
        .route("/api/v1/notes/:id/restore", post(restore_note))
        .route(
            "/api/v1/notes/:id/permanent",
            delete(permanently_delete_note),
        )
        .route("/api/v1/notes/:id/revisions", get(list_revisions))
        .route(
            "/api/v1/notes/:id/revisions/:revision_id/restore",
            post(restore_revision),
        )
        .route("/api/v1/notes/:id/attachments", get(list_attachments))
        .route(
            "/api/v1/notes/:id/attachments/upload",
            post(upload_attachment),
        )
        .route("/api/v1/attachments/:id", get(download_attachment))
        .route("/api/v1/attachments/:id/meta", get(get_attachment))
        .route("/api/v1/attachments/:id", delete(delete_attachment))
        .route("/api/v1/shortcuts", get(list_shortcuts))
        .route("/api/v1/shortcuts/:note_id", post(add_shortcut))
        .route("/api/v1/shortcuts/:note_id", delete(remove_shortcut))
        .route("/api/v1/search", get(search))
        .route("/api/v1/trash/empty", post(empty_trash))
        .route("/api/v1/import/enex", post(import_enex))
        .route("/api/v1/import/enex/path", post(import_enex_path))
        .route("/api/v1/account", get(get_account).put(update_account))
        .route(
            "/api/v1/settings",
            get(get_settings).put(update_settings).delete(reset_settings),
        )
        .route("/api/v1/templates/catalog", get(template_catalog))
        .route("/api/v1/templates/restore", post(restore_templates))
        .route("/api/v1/templates/:id/use", post(use_template))
        .route("/api/v1/storage", get(storage_info))
        .layer(DefaultBodyLimit::max(MAX_UPLOAD_BYTES))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::mirror_request())
                .allow_methods(AllowMethods::any())
                .allow_headers(AllowHeaders::any()),
        )
        .layer(middleware::from_fn(allow_private_network))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

async fn allow_private_network(req: axum::extract::Request, next: Next) -> Response {
    let mut response = next.run(req).await;
    response.headers_mut().insert(
        header::HeaderName::from_static("access-control-allow-private-network"),
        HeaderValue::from_static("true"),
    );
    response
}

#[derive(Clone)]
struct AppState {
    service: Arc<Mutex<NotebookService>>,
}

#[derive(Debug, Deserialize)]
struct ListNotesQuery {
    notebook_id: Option<Uuid>,
    tag_id: Option<Uuid>,
    trash: Option<bool>,
    archived: Option<bool>,
    templates: Option<bool>,
}

#[derive(Debug, Deserialize)]
struct ListNotebooksQuery {
    include_deleted: Option<bool>,
}

async fn health(State(state): State<AppState>) -> Json<HealthResponse> {
    let svc = state.service.lock().await;
    Json(HealthResponse {
        status: "ok".into(),
        version: env!("CARGO_PKG_VERSION").into(),
        database: svc.db().connection().path().unwrap_or("memory").to_string(),
    })
}

async fn list_notebooks(
    State(state): State<AppState>,
    Query(q): Query<ListNotebooksQuery>,
) -> Result<Json<Vec<notebook_core::Notebook>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_notebooks(q.include_deleted.unwrap_or(false))?))
}

async fn create_notebook(
    State(state): State<AppState>,
    Json(req): Json<CreateNotebookRequest>,
) -> Result<Json<notebook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_notebook(req)?))
}

async fn get_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_notebook(id)?))
}

async fn update_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateNotebookRequest>,
) -> Result<Json<notebook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_notebook(id, req)?))
}

async fn delete_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_notebook(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore_notebook(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Notebook>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.restore_notebook(id)?))
}

async fn list_stacks(
    State(state): State<AppState>,
) -> Result<Json<Vec<notebook_core::Stack>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_stacks()?))
}

async fn create_stack(
    State(state): State<AppState>,
    Json(req): Json<CreateStackRequest>,
) -> Result<Json<notebook_core::Stack>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_stack(req)?))
}

async fn get_stack(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Stack>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_stack(id)?))
}

async fn update_stack(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateStackRequest>,
) -> Result<Json<notebook_core::Stack>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_stack(id, req)?))
}

async fn delete_stack(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_stack(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_tags(
    State(state): State<AppState>,
) -> Result<Json<Vec<notebook_core::Tag>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_tags()?))
}

async fn create_tag(
    State(state): State<AppState>,
    Json(req): Json<CreateTagRequest>,
) -> Result<Json<notebook_core::Tag>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_tag(req)?))
}

async fn get_tag(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Tag>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_tag(id)?))
}

async fn update_tag(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateTagRequest>,
) -> Result<Json<notebook_core::Tag>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_tag(id, req)?))
}

async fn delete_tag(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_tag(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_notes(
    State(state): State<AppState>,
    Query(q): Query<ListNotesQuery>,
) -> Result<Json<Vec<notebook_core::NoteSummary>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_notes(
        q.notebook_id,
        q.tag_id,
        q.trash.unwrap_or(false),
        q.archived,
        q.templates,
    )?))
}

async fn create_note(
    State(state): State<AppState>,
    Json(req): Json<CreateNoteRequest>,
) -> Result<Json<notebook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.create_note(req)?))
}

async fn get_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_note(id)?))
}

async fn update_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UpdateNoteRequest>,
) -> Result<Json<notebook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_note(id, req)?))
}

async fn delete_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_note(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.restore_note(id)?))
}

async fn permanently_delete_note(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.permanently_delete_note(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_revisions(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<notebook_core::NoteRevision>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_revisions(id)?))
}

async fn restore_revision(
    State(state): State<AppState>,
    Path((id, revision_id)): Path<(Uuid, Uuid)>,
) -> Result<Json<notebook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.restore_revision(id, revision_id)?))
}

async fn list_attachments(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<notebook_core::Attachment>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.list_attachments(id)?))
}

async fn upload_attachment(
    State(state): State<AppState>,
    Path(note_id): Path<Uuid>,
    mut multipart: Multipart,
) -> Result<Json<notebook_core::Attachment>, AppError> {
    let mut filename = String::from("attachment");
    let mut mime = String::from("application/octet-stream");
    let mut data = Vec::new();

    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        let name = field.name().unwrap_or("").to_string();
        if name == "filename" {
            filename = field.text().await.unwrap_or_default();
        } else if name == "file" {
            if let Some(uploaded_name) = field.file_name() {
                filename = uploaded_name.to_string();
            }
            if let Some(ct) = field.content_type() {
                mime = ct.to_string();
            }
            data = field
                .bytes()
                .await
                .map_err(|e| AppError::bad_request(e.to_string()))?
                .to_vec();
        }
    }

    let svc = state.service.lock().await;
    Ok(Json(svc.add_attachment(note_id, filename, mime, &data)?))
}

async fn get_attachment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Json<notebook_core::Attachment>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_attachment(id)?))
}

async fn download_attachment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<Response, AppError> {
    let svc = state.service.lock().await;
    let att = svc.get_attachment(id)?;
    let data = svc.read_attachment_data(id)?;
    let mut content_type = att.mime_type.clone();
    if looks_like_pdf_attachment(&att.filename, &att.mime_type, &data) {
        content_type = "application/pdf".to_string();
    }
    let disposition = content_disposition(&att.filename);
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        data,
    )
        .into_response())
}

fn looks_like_pdf_attachment(filename: &str, mime: &str, data: &[u8]) -> bool {
    let mime = mime.to_ascii_lowercase();
    mime == "application/pdf"
        || mime == "application/x-pdf"
        || filename.to_ascii_lowercase().ends_with(".pdf")
        || data.starts_with(b"%PDF")
}

fn content_disposition(filename: &str) -> String {
    let safe: String = filename
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let name = if safe.is_empty() {
        "attachment".to_string()
    } else {
        safe
    };
    format!("inline; filename=\"{name}\"")
}

async fn delete_attachment(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.delete_attachment(id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_shortcuts(
    State(state): State<AppState>,
) -> Result<Json<Vec<notebook_core::NoteSummary>>, AppError> {
    let svc = state.service.lock().await;
    let shortcuts = svc.list_shortcuts()?;
    Ok(Json(shortcuts.into_iter().map(|(_, n)| n).collect()))
}

async fn add_shortcut(
    State(state): State<AppState>,
    Path(note_id): Path<Uuid>,
) -> Result<Json<notebook_core::Shortcut>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.add_shortcut(note_id)?))
}

async fn remove_shortcut(
    State(state): State<AppState>,
    Path(note_id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let svc = state.service.lock().await;
    svc.remove_shortcut(note_id)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn search(
    State(state): State<AppState>,
    Query(q): Query<SearchQuery>,
) -> Result<Json<notebook_core::SearchResult>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.search(q)?))
}

async fn empty_trash(State(state): State<AppState>) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    let count = svc.empty_trash()?;
    Ok(Json(serde_json::json!({ "deleted": count })))
}

#[derive(Debug, Deserialize)]
struct ImportEnexQuery {
    notebook_id: Option<Uuid>,
    notebook_name: Option<String>,
    stack_id: Option<Uuid>,
}

async fn import_enex(
    State(state): State<AppState>,
    Query(q): Query<ImportEnexQuery>,
    mut multipart: Multipart,
) -> Result<Json<notebook_core::EnexImportResult>, AppError> {
    let mut data = Vec::new();
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| AppError::bad_request(e.to_string()))?
    {
        if field.name() == Some("file") {
            data = field
                .bytes()
                .await
                .map_err(|e| AppError::bad_request(e.to_string()))?
                .to_vec();
            break;
        }
    }
    if data.is_empty() {
        return Err(AppError::bad_request("missing file field".into()));
    }
    tracing::info!("Importing ENEX upload ({} bytes)", data.len());
    let svc = state.service.lock().await;
    Ok(Json(svc.import_enex(
        &data,
        EnexImportRequest {
            notebook_id: q.notebook_id,
            notebook_name: q.notebook_name,
            stack_id: q.stack_id,
        },
    )?))
}

#[derive(Debug, Deserialize)]
struct ImportEnexPathRequest {
    path: String,
    notebook_id: Option<Uuid>,
    notebook_name: Option<String>,
    stack_id: Option<Uuid>,
}

async fn import_enex_path(
    State(state): State<AppState>,
    Json(req): Json<ImportEnexPathRequest>,
) -> Result<Json<notebook_core::EnexImportResult>, AppError> {
    let path = PathBuf::from(&req.path);
    if !path.is_file() {
        return Err(AppError::bad_request(format!(
            "ENEX file not found: {}",
            req.path
        )));
    }
    tracing::info!("Importing ENEX from {}", path.display());
    let svc = state.service.lock().await;
    Ok(Json(svc.import_enex_file(
        &path,
        EnexImportRequest {
            notebook_id: req.notebook_id,
            notebook_name: req.notebook_name,
            stack_id: req.stack_id,
        },
    )?))
}

async fn get_account(
    State(state): State<AppState>,
) -> Result<Json<notebook_core::User>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_account()?))
}

async fn update_account(
    State(state): State<AppState>,
    Json(req): Json<UpdateUserRequest>,
) -> Result<Json<notebook_core::User>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_account(req)?))
}

async fn get_settings(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.get_preferences()?))
}

async fn update_settings(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.update_preferences(req)?))
}

async fn reset_settings(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.reset_preferences()?))
}

async fn template_catalog(
    State(state): State<AppState>,
) -> Result<Json<Vec<serde_json::Value>>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.template_catalog()))
}

async fn restore_templates(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    let inserted = svc.restore_builtin_templates()?;
    Ok(Json(serde_json::json!({ "restored": inserted })))
}

async fn use_template(
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(req): Json<UseTemplateRequest>,
) -> Result<Json<notebook_core::Note>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.use_template(id, req.notebook_id)?))
}

async fn storage_info(
    State(state): State<AppState>,
) -> Result<Json<serde_json::Value>, AppError> {
    let svc = state.service.lock().await;
    Ok(Json(svc.storage_info()))
}

struct AppError(notebook_core::NotebookError);

impl From<notebook_core::NotebookError> for AppError {
    fn from(e: notebook_core::NotebookError) -> Self {
        Self(e)
    }
}

impl AppError {
    fn bad_request(msg: String) -> Self {
        Self(notebook_core::NotebookError::InvalidInput(msg))
    }
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self.0 {
            notebook_core::NotebookError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            notebook_core::NotebookError::InvalidInput(msg) => {
                (StatusCode::BAD_REQUEST, msg.clone())
            }
            _ => (
                StatusCode::INTERNAL_SERVER_ERROR,
                self.0.to_string(),
            ),
        };
        (status, Json(serde_json::json!({ "error": message }))).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use tower::ServiceExt;

    fn sample_enex(title: &str, body: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export>
  <note>
    <title>{title}</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>{body}</div></en-note>]]></content>
  </note>
</en-export>"#
        )
    }

    fn test_app(unique: &str) -> Router {
        let dir = std::env::temp_dir().join(format!("notebook-api-{unique}"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = Database::open(dir.join("test.db")).unwrap();
        build_router(AppState {
            service: Arc::new(Mutex::new(NotebookService::new(db))),
        })
    }

    fn multipart_body(filename: &str, data: &[u8], boundary: &str) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(b"Content-Type: application/xml\r\n\r\n");
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        body
    }

    #[tokio::test]
    async fn imports_enex_larger_than_axum_default_limit() {
        let app = test_app("large-upload");
        let padding = "x".repeat(2 * 1024 * 1024 + 50 * 1024);
        let enex = sample_enex("Large notebook export", &padding);
        assert!(
            enex.len() > 2 * 1024 * 1024,
            "fixture must exceed Axum's 2MiB default"
        );

        let boundary = "notebookboundary";
        let body = multipart_body("notebook.enex", enex.as_bytes(), boundary);
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/import/enex?notebook_name=Imported")
                    .header(
                        "content-type",
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(body))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(result["imported"], 1, "body: {result}");
    }

    #[tokio::test]
    async fn imports_enex_from_local_path() {
        let app = test_app("path-import");
        let dir = std::env::temp_dir().join("notebook-api-path-import-file");
        std::fs::create_dir_all(&dir).unwrap();
        let file_path = dir.join("grouped.enex");
        std::fs::write(&file_path, sample_enex("Path note", "Hello from disk")).unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/import/enex/path")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "path": file_path.to_string_lossy(),
                            "notebook_name": "From Path"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let result: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(result["imported"], 1, "body: {result}");
        assert_eq!(result["notebook_name"], "From Path");
    }

    #[tokio::test]
    async fn seeds_templates_and_uses_them() {
        let app = test_app("templates");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/notes?templates=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let templates: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert!(
            templates.len() >= 10,
            "expected built-in templates, got {}",
            templates.len()
        );
        assert_eq!(templates[0]["is_template"], true);

        let template_id = templates
            .iter()
            .find(|t| t["title"] == "Meeting notes")
            .and_then(|t| t["id"].as_str())
            .unwrap();
        let notebooks: Vec<serde_json::Value> = {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri("/api/v1/notebooks")
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            serde_json::from_slice(&bytes).unwrap()
        };
        let notebook_id = notebooks[0]["id"].as_str().unwrap();

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri(&format!("/api/v1/templates/{template_id}/use"))
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "notebook_id": notebook_id }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let note: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(note["title"], "Meeting notes");
        assert_eq!(note["is_template"], false);
        assert!(note["content"].as_str().unwrap().contains("Agenda"));
    }

    #[tokio::test]
    async fn reads_and_updates_settings() {
        let app = test_app("settings");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/api/v1/settings")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let settings: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(settings["theme"], "light");
        assert_eq!(settings["confirm_delete"], true);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/v1/settings")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "theme": "dark", "note_width": "full" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let settings: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(settings["theme"], "dark");
        assert_eq!(settings["note_width"], "full");
        assert_eq!(settings["confirm_delete"], true);

        let response = app
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri("/api/v1/account")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({ "display_name": "Jordan" }).to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let account: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(account["display_name"], "Jordan");
    }

    #[tokio::test]
    async fn manages_context_menu_resources() {
        let app = test_app("context-menu-resources");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/stacks")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"Projects"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let stack: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/stacks/{}", stack["id"].as_str().unwrap()))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"Renamed projects"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let stack: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(stack["name"], "Renamed projects");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/tags")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"todo"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tag: serde_json::Value = serde_json::from_slice(&bytes).unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("PUT")
                    .uri(format!("/api/v1/tags/{}", tag["id"].as_str().unwrap()))
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"next"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let tag: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(tag["name"], "next");

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/notebooks")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"name":"Disposable"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let notebook: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        let notebook_id = notebook["id"].as_str().unwrap();

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/v1/notes")
                    .header("content-type", "application/json")
                    .body(Body::from(
                        serde_json::json!({
                            "notebook_id": notebook_id,
                            "title": "Trash with notebook"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);

        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("DELETE")
                    .uri(format!("/api/v1/notebooks/{notebook_id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NO_CONTENT);

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/v1/notes?trash=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let notes: Vec<serde_json::Value> = serde_json::from_slice(&bytes).unwrap();
        assert!(notes.iter().any(|note| note["title"] == "Trash with notebook"));
    }
}
