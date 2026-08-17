use std::collections::HashMap;
use std::io::Cursor;

use base64::Engine;
use chrono::{DateTime, NaiveDateTime, Utc};
use md5;
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::error::{NotebookError, Result};

#[derive(Debug, Clone)]
pub struct EnexExport {
    pub notes: Vec<EnexNote>,
}

#[derive(Debug, Clone)]
pub struct EnexNote {
    pub title: String,
    pub content: String,
    pub notebook: Option<String>,
    pub created: Option<DateTime<Utc>>,
    pub updated: Option<DateTime<Utc>>,
    pub reminder_at: Option<DateTime<Utc>>,
    pub tags: Vec<String>,
    pub source_url: Option<String>,
    pub resources: Vec<EnexResource>,
}

#[derive(Debug, Clone)]
pub struct EnexResource {
    pub data: Vec<u8>,
    pub mime: String,
    pub filename: Option<String>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub hash: String,
}

pub fn parse_enex(data: &[u8]) -> Result<EnexExport> {
    let mut reader = Reader::from_reader(Cursor::new(data));
    reader.config_mut().trim_text(true);

    let mut notes = Vec::new();
    let mut buf = Vec::new();
    let mut in_note = false;
    let mut current: Option<PartialNote> = None;
    let mut current_field = String::new();
    let mut in_resource = false;
    let mut current_resource: Option<PartialResource> = None;
    let mut in_resource_attributes = false;
    let mut in_note_attributes = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "note" => {
                        in_note = true;
                        current = Some(PartialNote::default());
                    }
                    "resource" if in_note => {
                        in_resource = true;
                        current_resource = Some(PartialResource::default());
                    }
                    "resource-attributes" if in_resource => {
                        in_resource_attributes = true;
                    }
                    "note-attributes" if in_note => {
                        in_note_attributes = true;
                    }
                    _ if in_note && !in_resource => {
                        current_field = name;
                    }
                    _ if in_resource && !in_resource_attributes => {
                        current_field = name;
                    }
                    _ if in_resource_attributes => {
                        current_field = name;
                    }
                    _ if in_note_attributes => {
                        current_field = name;
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref()).into_owned();
                if in_resource {
                    if let Some(resource) = current_resource.as_mut() {
                        match current_field.as_str() {
                            "data" => resource.data_b64.push_str(text.trim()),
                            "mime" => resource.mime = text.trim().to_string(),
                            "width" => resource.width = text.trim().parse().ok(),
                            "height" => resource.height = text.trim().parse().ok(),
                            "file-name" if in_resource_attributes => {
                                resource.filename = Some(text.trim().to_string())
                            }
                            _ => {}
                        }
                    }
                } else if let Some(note) = current.as_mut() {
                    match current_field.as_str() {
                        "title" => note.title = text.trim().to_string(),
                        "notebook" => {
                            let name = text.trim();
                            if !name.is_empty() {
                                note.notebook = Some(name.to_string());
                            }
                        }
                        "content" => note.content.push_str(&text),
                        "created" => note.created = parse_evernote_datetime(text.trim()),
                        "updated" => note.updated = parse_evernote_datetime(text.trim()),
                        "tag" => {
                            let tag = text.trim();
                            if !tag.is_empty() {
                                note.tags.push(tag.to_string());
                            }
                        }
                        "source-url" => note.source_url = Some(text.trim().to_string()),
                        "reminder-time" => note.reminder_at = parse_evernote_datetime(text.trim()),
                        _ if in_note_attributes && current_field == "source-url" => {
                            note.source_url = Some(text.trim().to_string())
                        }
                        _ if in_note_attributes && current_field == "reminder-time" => {
                            note.reminder_at = parse_evernote_datetime(text.trim())
                        }
                        _ => {}
                    }
                }
            }
            Ok(Event::CData(e)) => {
                let bytes = e.into_inner();
                let text = String::from_utf8_lossy(&bytes);
                if in_resource {
                    if let Some(resource) = current_resource.as_mut() {
                        if current_field == "data" {
                            resource.data_b64.push_str(text.trim());
                        }
                    }
                } else if let Some(note) = current.as_mut() {
                    if current_field == "content" {
                        note.content.push_str(&text);
                    }
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "note" => {
                        if let Some(note) = current.take() {
                            notes.push(note.into_note()?);
                        }
                        in_note = false;
                        in_resource = false;
                        in_resource_attributes = false;
                        in_note_attributes = false;
                        current_resource = None;
                        current_field.clear();
                    }
                    "resource" => {
                        if let (Some(note), Some(resource)) =
                            (current.as_mut(), current_resource.take())
                        {
                            if let Ok(parsed) = resource.into_resource() {
                                note.resources.push(parsed);
                            }
                        }
                        in_resource = false;
                        in_resource_attributes = false;
                        current_field.clear();
                    }
                    "resource-attributes" => {
                        in_resource_attributes = false;
                        current_field.clear();
                    }
                    "note-attributes" => {
                        in_note_attributes = false;
                        current_field.clear();
                    }
                    _ => {
                        current_field.clear();
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => return Err(NotebookError::Other(err.to_string())),
            _ => {}
        }
        buf.clear();
    }

    Ok(EnexExport { notes })
}

#[derive(Default)]
struct PartialNote {
    title: String,
    content: String,
    notebook: Option<String>,
    created: Option<DateTime<Utc>>,
    updated: Option<DateTime<Utc>>,
    reminder_at: Option<DateTime<Utc>>,
    tags: Vec<String>,
    source_url: Option<String>,
    resources: Vec<EnexResource>,
}

impl PartialNote {
    fn into_note(self) -> Result<EnexNote> {
        Ok(EnexNote {
            title: if self.title.is_empty() {
                "Untitled".to_string()
            } else {
                self.title
            },
            content: self.content,
            notebook: self.notebook,
            created: self.created,
            updated: self.updated,
            reminder_at: self.reminder_at,
            tags: self.tags,
            source_url: self.source_url,
            resources: self.resources,
        })
    }
}

#[derive(Default)]
struct PartialResource {
    data_b64: String,
    mime: String,
    filename: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
}

impl PartialResource {
    fn into_resource(self) -> Result<EnexResource> {
        let data = decode_enex_base64(&self.data_b64)?;
        if data.is_empty() {
            return Err(NotebookError::Other("empty ENEX resource".into()));
        }
        let mut mime = if self.mime.is_empty() {
            "application/octet-stream".to_string()
        } else {
            self.mime
        };
        if looks_like_pdf(&mime, self.filename.as_deref(), &data) {
            mime = "application/pdf".to_string();
        }
        let hash = format!("{:x}", md5::compute(&data));
        Ok(EnexResource {
            data,
            mime,
            filename: self.filename,
            width: self.width,
            height: self.height,
            hash,
        })
    }
}

fn decode_enex_base64(raw: &str) -> Result<Vec<u8>> {
    let compact: String = raw.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.is_empty() {
        return Err(NotebookError::Other("empty ENEX resource data".into()));
    }
    let padded = pad_base64(&compact);
    let engines = [
        base64::engine::general_purpose::STANDARD,
        base64::engine::general_purpose::STANDARD_NO_PAD,
        base64::engine::general_purpose::URL_SAFE,
        base64::engine::general_purpose::URL_SAFE_NO_PAD,
    ];
    for engine in engines {
        if let Ok(data) = engine.decode(&padded) {
            return Ok(data);
        }
        if let Ok(data) = engine.decode(&compact) {
            return Ok(data);
        }
    }
    Err(NotebookError::Other("invalid base64 in resource".into()))
}

fn pad_base64(value: &str) -> String {
    let mut padded = value.to_string();
    while padded.len() % 4 != 0 {
        padded.push('=');
    }
    padded
}

pub fn looks_like_pdf(mime: &str, filename: Option<&str>, data: &[u8]) -> bool {
    let mime = mime.to_ascii_lowercase();
    mime == "application/pdf"
        || mime == "application/x-pdf"
        || filename
            .map(|name| name.to_ascii_lowercase().ends_with(".pdf"))
            .unwrap_or(false)
        || data.starts_with(b"%PDF")
}

pub fn is_inline_image(resource: &EnexResource) -> bool {
    resource.mime.to_ascii_lowercase().starts_with("image/")
        && !looks_like_pdf(&resource.mime, resource.filename.as_deref(), &resource.data)
}

pub fn file_attachment_html(href: &str, filename: &str, mime: &str) -> String {
    format!(
        "<div data-notebook-file=\"true\" data-href=\"{href}\" data-filename=\"{filename}\" data-mime=\"{mime}\"><a href=\"{href}\">{visible}</a></div>",
        href = escape_attr(href),
        filename = escape_attr(filename),
        mime = escape_attr(mime),
        visible = escape_html(filename),
    )
}

pub fn parse_evernote_datetime(value: &str) -> Option<DateTime<Utc>> {
    if value.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(value) {
        return Some(dt.with_timezone(&Utc));
    }
    NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%SZ")
        .ok()
        .map(|dt| dt.and_utc())
}

pub fn enml_to_html(enml: &str, resources: &[EnexResource]) -> Result<String> {
    let resource_map: HashMap<String, &EnexResource> = resources
        .iter()
        .map(|r| (r.hash.to_ascii_lowercase(), r))
        .collect();

    let mut reader = Reader::from_reader(Cursor::new(enml.as_bytes()));
    reader.config_mut().trim_text(false);

    let mut out = String::new();
    let mut buf = Vec::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "en-note" => out.push_str("<div>"),
                    "en-todo" => {
                        let checked = e
                            .attributes()
                            .flatten()
                            .any(|a| a.key.as_ref() == b"checked" && a.value.as_ref() != b"false");
                        out.push_str(if checked { "<p>☑ " } else { "<p>☐ " });
                    }
                    "en-crypt" => {
                        out.push_str("<p><em>[Encrypted content not imported]</em></p>");
                    }
                    "en-media" => {
                        render_en_media(&mut out, &e, &resource_map);
                    }
                    "a" | "div" | "span" | "p" | "br" | "ul" | "ol" | "li" | "b" | "i" | "u"
                    | "strong" | "em" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote"
                    | "pre" | "code" | "table" | "tr" | "td" | "th" | "thead" | "tbody" => {
                        out.push('<');
                        out.push_str(&name);
                        for attr in e.attributes().flatten() {
                            let key = String::from_utf8_lossy(attr.key.as_ref());
                            if key == "style" || key == "href" || key == "class" {
                                let value = String::from_utf8_lossy(&attr.value);
                                out.push_str(&format!(" {key}=\"{value}\""));
                            }
                        }
                        out.push('>');
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "en-note" => out.push_str("</div>"),
                    "en-todo" => out.push_str("</p>"),
                    "a" | "div" | "span" | "p" | "ul" | "ol" | "li" | "b" | "i" | "u"
                    | "strong" | "em" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "blockquote"
                    | "pre" | "code" | "table" | "tr" | "td" | "th" | "thead" | "tbody" => {
                        out.push_str("</");
                        out.push_str(&name);
                        out.push('>');
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let text = String::from_utf8_lossy(e.as_ref());
                out.push_str(&escape_html(&text));
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "br" => out.push_str("<br/>"),
                    "en-media" => render_en_media(&mut out, &e, &resource_map),
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                if out.is_empty() {
                    return Err(NotebookError::Other(format!("invalid ENML: {err}")));
                }
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    if out.trim().is_empty() {
        out.push_str("<p></p>");
    }

    Ok(out)
}

fn render_en_media(
    out: &mut String,
    e: &quick_xml::events::BytesStart<'_>,
    resource_map: &HashMap<String, &EnexResource>,
) {
    let mut hash = None;
    let mut mime = None;
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"hash" => hash = Some(String::from_utf8_lossy(&attr.value).to_string()),
            b"type" => mime = Some(String::from_utf8_lossy(&attr.value).to_string()),
            _ => {}
        }
    }
    let resource = hash
        .as_deref()
        .and_then(|value| resource_map.get(&normalize_hash(value)).copied())
        .or_else(|| match_unique_resource(resource_map, mime.as_deref()));
    if let Some(resource) = resource {
        let use_mime = mime.unwrap_or_else(|| resource.mime.clone());
        if use_mime.to_ascii_lowercase().starts_with("image/")
            && !looks_like_pdf(&use_mime, resource.filename.as_deref(), &resource.data)
        {
            let b64 = base64::engine::general_purpose::STANDARD.encode(&resource.data);
            out.push_str(&format!(
                "<img src=\"data:{};base64,{}\" alt=\"{}\" />",
                escape_attr(&use_mime),
                b64,
                escape_attr(resource.filename.as_deref().unwrap_or("image"))
            ));
        } else {
            out.push_str(&file_attachment_html(
                &format!("notebook-resource://{}", resource.hash),
                resource.filename.as_deref().unwrap_or("attachment"),
                &use_mime,
            ));
        }
    }
}

fn match_unique_resource<'a>(
    resource_map: &HashMap<String, &'a EnexResource>,
    mime: Option<&str>,
) -> Option<&'a EnexResource> {
    let mime = mime?;
    let matches: Vec<_> = resource_map
        .values()
        .copied()
        .filter(|resource| {
            resource.mime.eq_ignore_ascii_case(mime)
                || (looks_like_pdf(mime, None, &[])
                    && looks_like_pdf(&resource.mime, resource.filename.as_deref(), &resource.data))
        })
        .collect();
    if matches.len() == 1 {
        Some(matches[0])
    } else {
        None
    }
}

fn normalize_hash(hash: &str) -> String {
    hash.trim().to_ascii_lowercase()
}

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn escape_attr(input: &str) -> String {
    escape_html(input).replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export3.dtd">
<en-export>
  <note>
    <title>Test Note</title>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd">
<en-note><div>Hello <b>world</b></div></en-note>]]></content>
    <created>20240115T100000Z</created>
    <updated>20240116T120000Z</updated>
    <tag>work</tag>
    <tag>ideas</tag>
  </note>
</en-export>"#;

    #[test]
    fn parses_basic_enex() {
        let export = parse_enex(SAMPLE.as_bytes()).unwrap();
        assert_eq!(export.notes.len(), 1);
        assert_eq!(export.notes[0].title, "Test Note");
        assert_eq!(export.notes[0].tags, vec!["work", "ideas"]);
        let html = enml_to_html(&export.notes[0].content, &[]).unwrap();
        assert!(html.contains("Hello"));
        assert!(html.contains("<b>"));
    }

    #[test]
    fn parses_evernote_datetime() {
        let dt = parse_evernote_datetime("20240115T100000Z").unwrap();
        assert_eq!(dt.format("%Y-%m-%d").to_string(), "2024-01-15");
    }

    #[test]
    fn imports_enex_into_database() {
        let dir = std::env::temp_dir().join("notebook-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let db = crate::db::Database::open(&db_path).unwrap();
        let service = crate::service::NotebookService::new(db);
        let result = service
            .import_enex(
                SAMPLE.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let search = service
            .search(crate::models::SearchQuery {
                q: "world".into(),
                notebook_id: None,
                tag_id: None,
                include_trash: Some(false),
                include_archived: Some(true),
                limit: None,
                offset: None,
            })
            .unwrap();
        assert_eq!(search.total, 1);
    }

    #[test]
    fn parses_multi_note_enex() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>First</title>
    <notebook>Work</notebook>
    <content><![CDATA[<en-note><div>Note one</div></en-note>]]></content>
  </note>
  <note>
    <title>Second</title>
    <notebook>Personal</notebook>
    <content><![CDATA[<en-note><div>Note two</div></en-note>]]></content>
  </note>
  <note>
    <title>Third</title>
    <content><![CDATA[<en-note><div>Note three</div></en-note>]]></content>
  </note>
</en-export>"#;
        let export = parse_enex(enex.as_bytes()).unwrap();
        assert_eq!(export.notes.len(), 3);
        assert_eq!(export.notes[0].notebook.as_deref(), Some("Work"));
        assert_eq!(export.notes[1].notebook.as_deref(), Some("Personal"));
        assert!(export.notes[2].notebook.is_none());
    }

    #[test]
    fn renders_self_closing_en_media() {
        let hash = "f03c1c2d96bc67eda02968c8b5af9008";
        let resource = EnexResource {
            data: vec![0x89, 0x50, 0x4e, 0x47],
            mime: "image/png".to_string(),
            filename: Some("photo.png".to_string()),
            width: None,
            height: None,
            hash: hash.to_string(),
        };
        let enml = format!(
            r#"<en-note><div>Before <en-media type="image/png" hash="{}"/> after</div></en-note>"#,
            hash
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(html.contains("<img"), "expected image tag, got: {html}");
        assert!(html.contains("Before"));
        assert!(html.contains("after"));
    }

    #[test]
    fn renders_pdf_media_with_uppercase_hash() {
        let file_data = b"%PDF-1.4 preview";
        let hash = format!("{:x}", md5::compute(file_data));
        let resource = EnexResource {
            data: file_data.to_vec(),
            mime: "application/pdf".to_string(),
            filename: Some("deck.pdf".to_string()),
            width: None,
            height: None,
            hash: hash.clone(),
        };
        let enml = format!(
            r#"<en-note><en-media type="application/pdf" hash="{}"/></en-note>"#,
            hash.to_ascii_uppercase()
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(html.contains("data-notebook-file=\"true\""), "got: {html}");
        assert!(html.contains("notebook-resource://"));
        assert!(html.contains("deck.pdf"));
    }

    #[test]
    fn imports_file_resources_with_working_attachment_links() {
        let file_data = b"%PDF-1.4 test document";
        let hash = format!("{:x}", md5::compute(file_data));
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>PDF Note</title>
    <content><![CDATA[<en-note><div>Document</div><en-media type="application/pdf" hash="{hash}"/></en-note>]]></content>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>application/pdf</mime>
      <resource-attributes><file-name>manual.pdf</file-name></resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let dir = std::env::temp_dir().join("notebook-pdf-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db = crate::db::Database::open(dir.join("test.db")).unwrap();
        let service = crate::service::NotebookService::new(db);

        let result = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();

        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = service
            .list_notes(Some(result.notebook_id), None, false, None, Some(false))
            .unwrap()
            .pop()
            .and_then(|summary| service.get_note(summary.id).ok())
            .unwrap();
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "manual.pdf");
        assert_eq!(attachments[0].mime_type, "application/pdf");
        assert_eq!(
            service.read_attachment_data(attachments[0].id).unwrap(),
            file_data
        );
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
        assert!(note.content.contains("data-notebook-file=\"true\""));
        assert!(note.content.contains("data-mime=\"application/pdf\""));
        assert!(!note.content.contains("notebook-resource://"));
    }

    #[test]
    fn imports_pdf_with_uppercase_hash_and_messy_base64() {
        let file_data = b"%PDF-1.4 uppercase hash";
        let hash = format!("{:x}", md5::compute(file_data)).to_ascii_uppercase();
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let messy: String = encoded
            .as_bytes()
            .chunks(8)
            .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
            .collect::<Vec<_>>()
            .join("\n ");
        let unpadded = messy.trim_end_matches('=').to_string();
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Upper PDF</title>
    <content><![CDATA[<en-note><en-media type="application/pdf" hash="{hash}"></en-media></en-note>]]></content>
    <resource>
      <data encoding="base64">{unpadded}</data>
      <mime>application/pdf</mime>
      <resource-attributes><file-name>scan.pdf</file-name></resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let dir = std::env::temp_dir().join("notebook-pdf-uppercase-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let service = crate::service::NotebookService::new(
            crate::db::Database::open(dir.join("test.db")).unwrap(),
        );
        let result = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = service
            .list_notes(Some(result.notebook_id), None, false, None, Some(false))
            .unwrap()
            .pop()
            .and_then(|summary| service.get_note(summary.id).ok())
            .unwrap();
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments[0].filename, "scan.pdf");
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
    }

    #[test]
    fn imports_pdf_resource_without_en_media() {
        let file_data = b"%PDF-1.4 attachment only";
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Hidden PDF</title>
    <content><![CDATA[<en-note><div>See attached</div></en-note>]]></content>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>application/octet-stream</mime>
      <resource-attributes>
        <file-name>invoice.pdf</file-name>
        <attachment>true</attachment>
      </resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let dir = std::env::temp_dir().join("notebook-pdf-unreferenced-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let service = crate::service::NotebookService::new(
            crate::db::Database::open(dir.join("test.db")).unwrap(),
        );
        let result = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = service
            .list_notes(Some(result.notebook_id), None, false, None, Some(false))
            .unwrap()
            .pop()
            .and_then(|summary| service.get_note(summary.id).ok())
            .unwrap();
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "invoice.pdf");
        assert_eq!(attachments[0].mime_type, "application/pdf");
        assert!(note.content.contains("invoice.pdf"));
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
    }

    #[test]
    fn imports_pdf_resource_from_cdata() {
        let file_data = b"%PDF-1.4 cdata";
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>CDATA PDF</title>
    <content><![CDATA[<en-note><en-media type="application/pdf" hash="{hash}"/></en-note>]]></content>
    <resource>
      <data encoding="base64"><![CDATA[{encoded}]]></data>
      <mime>application/pdf</mime>
      <resource-attributes><file-name>cdata.pdf</file-name></resource-attributes>
    </resource>
  </note>
</en-export>"#,
            hash = format!("{:x}", md5::compute(file_data)),
            encoded = encoded
        );
        let dir = std::env::temp_dir().join("notebook-pdf-cdata-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let service = crate::service::NotebookService::new(
            crate::db::Database::open(dir.join("test.db")).unwrap(),
        );
        let result = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = service
            .list_notes(Some(result.notebook_id), None, false, None, Some(false))
            .unwrap()
            .pop()
            .and_then(|summary| service.get_note(summary.id).ok())
            .unwrap();
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments[0].filename, "cdata.pdf");
        assert_eq!(
            service.read_attachment_data(attachments[0].id).unwrap(),
            file_data
        );
    }

    #[test]
    fn imports_multi_note_enex_into_notebooks() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Work Note</title>
    <notebook>Work</notebook>
    <content><![CDATA[<en-note><div>Work content</div></en-note>]]></content>
  </note>
  <note>
    <title>Personal Note</title>
    <notebook>Personal</notebook>
    <content><![CDATA[<en-note><div>Personal content</div></en-note>]]></content>
  </note>
</en-export>"#;
        let dir = std::env::temp_dir().join("notebook-multi-import-test");
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("test.db");
        let db = crate::db::Database::open(&db_path).unwrap();
        let service = crate::service::NotebookService::new(db);
        let result = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Fallback".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(result.imported, 2, "errors: {:?}", result.errors);
        assert_eq!(result.notebook_count, 2);
        let notebooks = service.list_notebooks(false).unwrap();
        let names: Vec<_> = notebooks.iter().map(|n| n.name.as_str()).collect();
        assert!(names.contains(&"Work"));
        assert!(names.contains(&"Personal"));
    }
}
