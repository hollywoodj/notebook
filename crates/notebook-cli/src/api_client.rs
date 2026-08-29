use std::io::Read;
use std::path::Path;

use anyhow::{bail, Context, Result};
use notebook_core::{
    Attachment, CreateNoteRequest, CreateNotebookRequest, CreateStackRequest, CreateTagRequest,
    EnexImportRequest, EnexImportResult, HealthResponse, Note, NoteRevision, NoteSummary, Notebook,
    SearchQuery, SearchResult, Shortcut, Stack, Tag, UpdateNoteRequest,
};
use uuid::Uuid;

use crate::backend::{BackendInfo, NotebookBackend};

pub struct ApiClient {
    base: String,
}

impl ApiClient {
    pub fn new(base: &str) -> Result<Self> {
        Ok(Self {
            base: base.trim_end_matches('/').to_string(),
        })
    }

    fn url(&self, path: &str) -> String {
        format!("{}{}", self.base, path)
    }

    fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let resp = ureq::get(&self.url(path)).call()?;
        resp.into_json().context("parse json")
    }

    fn post_json<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = ureq::post(&self.url(path)).send_json(body)?;
        resp.into_json().context("parse json")
    }

    fn put_json<T: serde::de::DeserializeOwned, B: serde::Serialize>(
        &self,
        path: &str,
        body: &B,
    ) -> Result<T> {
        let resp = ureq::put(&self.url(path)).send_json(body)?;
        resp.into_json().context("parse json")
    }

    fn delete(&self, path: &str) -> Result<()> {
        let resp = ureq::delete(&self.url(path)).call()?;
        if resp.status() >= 400 {
            bail!("delete failed: {}", resp.status());
        }
        Ok(())
    }
}

impl NotebookBackend for ApiClient {
    fn info(&self) -> Result<BackendInfo> {
        let health: HealthResponse = self.get_json("/health")?;
        Ok(BackendInfo::Api {
            server: self.base.clone(),
            health,
        })
    }

    fn list_notes(
        &self,
        notebook: Option<Uuid>,
        tag: Option<Uuid>,
        archived: Option<bool>,
    ) -> Result<Vec<NoteSummary>> {
        let mut path = String::from("/api/v1/notes");
        let mut qs = Vec::new();
        if let Some(nb) = notebook {
            qs.push(format!("notebook_id={nb}"));
        }
        if let Some(t) = tag {
            qs.push(format!("tag_id={t}"));
        }
        if let Some(a) = archived {
            qs.push(format!("archived={a}"));
        }
        if !qs.is_empty() {
            path = format!("{path}?{}", qs.join("&"));
        }
        self.get_json(&path)
    }

    fn get_note(&self, id: Uuid) -> Result<Note> {
        self.get_json(&format!("/api/v1/notes/{id}"))
    }

    fn create_note(&self, req: CreateNoteRequest) -> Result<Note> {
        self.post_json("/api/v1/notes", &req)
    }

    fn update_note(&self, id: Uuid, req: UpdateNoteRequest) -> Result<Note> {
        self.put_json(&format!("/api/v1/notes/{id}"), &req)
    }

    fn delete_note(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/notes/{id}"))
    }

    fn restore_note(&self, id: Uuid) -> Result<Note> {
        self.post_json(
            &format!("/api/v1/notes/{id}/restore"),
            &serde_json::json!({}),
        )
    }

    fn list_revisions(&self, id: Uuid) -> Result<Vec<NoteRevision>> {
        self.get_json(&format!("/api/v1/notes/{id}/revisions"))
    }

    fn attach_file(
        &self,
        note_id: Uuid,
        filename: &str,
        mime: &str,
        data: &[u8],
    ) -> Result<Attachment> {
        let boundary = "notebookboundary";
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(format!("Content-Type: {mime}\r\n\r\n").as_bytes());
        body.extend_from_slice(data);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let resp = ureq::post(&self.url(&format!("/api/v1/notes/{note_id}/attachments/upload")))
            .set(
                "Content-Type",
                &format!("multipart/form-data; boundary={boundary}"),
            )
            .send_bytes(&body)?;

        resp.into_json().context("parse json")
    }

    fn list_notebooks(&self) -> Result<Vec<Notebook>> {
        self.get_json("/api/v1/notebooks")
    }

    fn create_notebook(&self, req: CreateNotebookRequest) -> Result<Notebook> {
        self.post_json("/api/v1/notebooks", &req)
    }

    fn delete_notebook(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/notebooks/{id}"))
    }

    fn list_tags(&self) -> Result<Vec<Tag>> {
        self.get_json("/api/v1/tags")
    }

    fn create_tag(&self, req: CreateTagRequest) -> Result<Tag> {
        self.post_json("/api/v1/tags", &req)
    }

    fn delete_tag(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/tags/{id}"))
    }

    fn get_or_create_tag(&self, name: &str) -> Result<Tag> {
        // The server trims the name via `validate_name` before its uniqueness
        // check (see notebook-core's `service.rs`), so an untrimmed lookup here
        // would miss an existing tag and POST a duplicate that 409s. Trim
        // before both the comparison and the create to match core's behavior.
        let name = name.trim();
        let tags: Vec<Tag> = self.get_json("/api/v1/tags")?;
        if let Some(tag) = tags.into_iter().find(|t| t.name == name) {
            return Ok(tag);
        }
        self.post_json(
            "/api/v1/tags",
            &CreateTagRequest {
                name: name.to_string(),
            },
        )
    }

    fn list_stacks(&self) -> Result<Vec<Stack>> {
        self.get_json("/api/v1/stacks")
    }

    fn create_stack(&self, req: CreateStackRequest) -> Result<Stack> {
        self.post_json("/api/v1/stacks", &req)
    }

    fn delete_stack(&self, id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/stacks/{id}"))
    }

    fn search(&self, query: SearchQuery) -> Result<SearchResult> {
        let mut path = format!("/api/v1/search?q={}", urlencoding(&query.q));
        if let Some(nb) = query.notebook_id {
            path.push_str(&format!("&notebook_id={nb}"));
        }
        if let Some(tag) = query.tag_id {
            path.push_str(&format!("&tag_id={tag}"));
        }
        if let Some(limit) = query.limit {
            path.push_str(&format!("&limit={limit}"));
        }
        self.get_json(&path)
    }

    fn list_trash(&self) -> Result<Vec<NoteSummary>> {
        self.get_json("/api/v1/notes?trash=true")
    }

    fn empty_trash(&self) -> Result<usize> {
        let resp = ureq::post(&self.url("/api/v1/trash/empty")).send_bytes(b"")?;
        let mut body = String::new();
        resp.into_reader().read_to_string(&mut body)?;
        let value: serde_json::Value = serde_json::from_str(&body)?;
        Ok(value["deleted"].as_u64().unwrap_or(0) as usize)
    }

    fn list_shortcuts(&self) -> Result<Vec<NoteSummary>> {
        self.get_json("/api/v1/shortcuts")
    }

    fn add_shortcut(&self, note_id: Uuid) -> Result<Shortcut> {
        self.post_json(
            &format!("/api/v1/shortcuts/{note_id}"),
            &serde_json::json!({}),
        )
    }

    fn remove_shortcut(&self, note_id: Uuid) -> Result<()> {
        self.delete(&format!("/api/v1/shortcuts/{note_id}"))
    }

    fn import_enex_file(
        &self,
        path: &Path,
        options: EnexImportRequest,
    ) -> Result<EnexImportResult> {
        let data = std::fs::read(path)?;
        let boundary = "notebookboundary";
        let filename = path
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("import.enex");

        let mut query = Vec::new();
        if let Some(id) = options.notebook_id {
            query.push(format!("notebook_id={id}"));
        }
        if let Some(name) = &options.notebook_name {
            query.push(format!("notebook_name={}", urlencoding(name)));
        }
        if let Some(stack) = options.stack_id {
            query.push(format!("stack_id={stack}"));
        }
        let query_str = if query.is_empty() {
            String::new()
        } else {
            format!("?{}", query.join("&"))
        };

        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!("Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n")
                .as_bytes(),
        );
        body.extend_from_slice(b"Content-Type: application/xml\r\n\r\n");
        body.extend_from_slice(&data);
        body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());

        let resp = ureq::post(&format!("{}/api/v1/import/enex{query_str}", self.base))
            .set(
                "Content-Type",
                &format!("multipart/form-data; boundary={boundary}"),
            )
            .send_bytes(&body)?;

        resp.into_json().context("parse json")
    }
}

/// Percent-encode `s` for use in a URL query string, over its UTF-8 *bytes*
/// (not `char`s — encoding by `char as u8` truncates any non-ASCII code
/// point down to its low byte and silently corrupts the value). Spaces
/// become `+`, matching the `application/x-www-form-urlencoded` convention
/// the API expects; the unreserved set `A-Za-z0-9-_.~` is left untouched.
fn urlencoding(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b' ' => out.push('+'),
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// A minimal, single-request HTTP/1.1 mock: accepts exactly one
    /// connection, reads (and discards) the request, and writes back a
    /// canned 200 JSON body. The listener is dropped as soon as that one
    /// request is served, so a *second* request made against the same
    /// address fails with connection-refused rather than silently
    /// succeeding — which is what lets the test below detect an unwanted
    /// extra POST without needing to inspect request bodies at all.
    fn serve_one_json_response(body: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut stream, _)) = listener.accept() {
                let mut buf = [0u8; 4096];
                // Just drain whatever the client sent; we don't need to
                // parse it since this mock only ever serves one canned
                // response regardless of method/path.
                let _ = stream.read(&mut buf);
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
            // `listener` drops here, closing the socket so a follow-up
            // connection attempt (e.g. an unwanted POST) is refused.
        });
        format!("http://{addr}")
    }

    #[test]
    fn get_or_create_tag_trims_before_matching_so_it_does_not_attempt_a_create() {
        let existing_id = Uuid::new_v4();
        let user_id = Uuid::new_v4();
        let now = "2026-01-01T00:00:00Z";
        let tags_json = format!(
            r#"[{{"id":"{existing_id}","user_id":"{user_id}","name":"work","created_at":"{now}","updated_at":"{now}","note_count":0}}]"#
        );
        let base = serve_one_json_response(tags_json);
        let client = ApiClient::new(&base).unwrap();

        // The raw name carries whitespace the server would trim via
        // `validate_name` before its uniqueness check. If `get_or_create_tag`
        // compares (or POSTs) the untrimmed name, it will fail to match
        // "work" above and fall through to a second HTTP call (a create) -
        // which fails immediately since the mock server only answers once.
        let tag = client.get_or_create_tag(" work ").unwrap();
        assert_eq!(tag.id, existing_id);
        assert_eq!(tag.name, "work");
    }

    #[test]
    fn urlencoding_leaves_unreserved_characters_untouched() {
        assert_eq!(urlencoding("abcXYZ019-_.~"), "abcXYZ019-_.~");
    }

    #[test]
    fn urlencoding_turns_spaces_into_plus() {
        assert_eq!(urlencoding("hello world"), "hello+world");
    }

    #[test]
    fn urlencoding_percent_encodes_reserved_ascii() {
        assert_eq!(urlencoding("a/b?c=d"), "a%2Fb%3Fc%3Dd");
    }

    #[test]
    fn urlencoding_percent_encodes_non_ascii_utf8_bytes() {
        // "中" (U+4E2D) is E4 B8 AD in UTF-8 — three bytes, three escapes.
        // The old `c as u8` implementation truncated this down to one byte.
        assert_eq!(urlencoding("中"), "%E4%B8%AD");
    }
}
