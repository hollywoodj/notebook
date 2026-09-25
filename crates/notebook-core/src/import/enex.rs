use std::collections::HashMap;
use std::io::Cursor;

use base64::Engine;
use chrono::{DateTime, NaiveDateTime, Utc};
use md5;
use quick_xml::events::Event;
use quick_xml::Reader;

use crate::content::html::{escape_attr, escape_html};
use crate::content::{
    basename, decode_xml_entities, decode_xml_entities_once, default_attachment_name,
    file_attachment_html, looks_like_pdf, sniff_mime,
};
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
    pub is_attachment: bool,
}

pub fn parse_enex(data: &[u8]) -> Result<EnexExport> {
    let mut reader = Reader::from_reader(Cursor::new(decode_enex_bytes(data)?));
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
                let raw = String::from_utf8_lossy(e.as_ref()).into_owned();
                let text = if current_field == "content" {
                    // Content is normally CDATA (see the Event::CData arm,
                    // which deliberately stays undecoded), but some
                    // exporters (Joplin, Apple Notes, Notion) escape the
                    // ENML instead. That escaped text arrives here via
                    // Event::Text and must be decoded exactly once - not
                    // with decode_xml_entities, which double-decodes and
                    // would corrupt legitimate `&amp;amp;` or materialise
                    // real tags.
                    decode_xml_entities_once(&raw)
                } else {
                    decode_xml_entities(&raw)
                };
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
                            "attachment" if in_resource_attributes => {
                                resource.is_attachment = matches!(
                                    text.trim().to_ascii_lowercase().as_str(),
                                    "true" | "1" | "yes"
                                );
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
    is_attachment: bool,
}

impl PartialResource {
    fn into_resource(self) -> Result<EnexResource> {
        let data = decode_enex_base64(&self.data_b64)?;
        if data.is_empty() {
            return Err(NotebookError::Other("empty ENEX resource".into()));
        }
        let mime = sniff_mime(&self.mime, self.filename.as_deref(), &data);
        let filename = self.filename.map(|name| {
            let base = basename(&name);
            if base.is_empty() {
                default_attachment_name(&mime)
            } else {
                base.to_string()
            }
        });
        let hash = format!("{:x}", md5::compute(&data));
        Ok(EnexResource {
            data,
            mime,
            filename,
            width: self.width,
            height: self.height,
            hash,
            is_attachment: self.is_attachment,
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

fn decode_enex_bytes(data: &[u8]) -> Result<Vec<u8>> {
    if data.starts_with(&[0xEF, 0xBB, 0xBF]) {
        return Ok(data[3..].to_vec());
    }
    if data.starts_with(&[0xFF, 0xFE]) {
        let units: Vec<u16> = data[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_le_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16(&units)
            .map(|text| text.into_bytes())
            .map_err(|err| NotebookError::Other(err.to_string()));
    }
    if data.starts_with(&[0xFE, 0xFF]) {
        let units: Vec<u16> = data[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        return String::from_utf16(&units)
            .map(|text| text.into_bytes())
            .map_err(|err| NotebookError::Other(err.to_string()));
    }
    Ok(data.to_vec())
}

pub fn is_inline_image(resource: &EnexResource) -> bool {
    !resource.is_attachment
        && resource.mime.to_ascii_lowercase().starts_with("image/")
        && !looks_like_pdf(&resource.mime, resource.filename.as_deref(), &resource.data)
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

const HTML_TAGS: &[&str] = &[
    "a",
    "div",
    "span",
    "p",
    "br",
    "ul",
    "ol",
    "li",
    "b",
    "i",
    "u",
    "s",
    "strike",
    "del",
    "strong",
    "em",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "blockquote",
    "pre",
    "code",
    "table",
    "tr",
    "td",
    "th",
    "thead",
    "tbody",
];

const HEADING_TAGS: &[&str] = &["h1", "h2", "h3", "h4", "h5", "h6"];

#[derive(Clone, Debug)]
enum HtmlNode {
    Element {
        name: String,
        attrs: Vec<(String, String)>,
        children: Vec<HtmlNode>,
    },
    Text(String),
    Raw(String),
}

impl HtmlNode {
    fn element(name: impl Into<String>, attrs: Vec<(String, String)>) -> Self {
        HtmlNode::Element {
            name: name.into(),
            attrs,
            children: Vec::new(),
        }
    }
}

pub fn enml_to_html(enml: &str, resources: &[EnexResource]) -> Result<String> {
    let resource_map: HashMap<String, &EnexResource> = resources
        .iter()
        .map(|r| (r.hash.to_ascii_lowercase(), r))
        .collect();

    let mut reader = Reader::from_reader(Cursor::new(enml.as_bytes()));
    reader.config_mut().trim_text(false);

    let mut stack = vec![HtmlNode::element("root", Vec::new())];
    let mut buf = Vec::new();
    let mut saw_error = None;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "en-note" => push_element(&mut stack, "div", Vec::new()),
                    "en-todo" => {
                        let checked = en_todo_checked(&e);
                        push_element(
                            &mut stack,
                            "en-todo-marker",
                            vec![("checked".into(), bool_attr(checked))],
                        );
                    }
                    "en-crypt" => append_child(
                        &mut stack,
                        HtmlNode::Raw(
                            "<p><em>[Encrypted content not imported]</em></p>".to_string(),
                        ),
                    ),
                    "en-media" => {
                        let mut raw = String::new();
                        render_en_media(&mut raw, &e, &resource_map);
                        append_child(&mut stack, HtmlNode::Raw(raw));
                    }
                    "br" => append_child(&mut stack, HtmlNode::element("br", Vec::new())),
                    "hr" => append_child(&mut stack, HtmlNode::element("hr", Vec::new())),
                    "font" => push_element(&mut stack, "span", font_style_attrs(&e)),
                    name if HEADING_TAGS.contains(&name) => {
                        push_element(&mut stack, name, copy_heading_attrs(&e));
                    }
                    name if HTML_TAGS.contains(&name) => {
                        push_element(&mut stack, name, copy_html_attrs(&e));
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "en-note" | "en-todo" | "font" => pop_element(&mut stack),
                    name if HTML_TAGS.contains(&name) && name != "br" => pop_element(&mut stack),
                    _ => {}
                }
            }
            Ok(Event::Text(e)) => {
                let decoded = decode_xml_entities(&String::from_utf8_lossy(e.as_ref()));
                if !decoded.is_empty() {
                    append_child(&mut stack, HtmlNode::Text(decoded));
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_string();
                match name.as_str() {
                    "br" => append_child(&mut stack, HtmlNode::element("br", Vec::new())),
                    "hr" => append_child(&mut stack, HtmlNode::element("hr", Vec::new())),
                    "en-media" => {
                        let mut raw = String::new();
                        render_en_media(&mut raw, &e, &resource_map);
                        append_child(&mut stack, HtmlNode::Raw(raw));
                    }
                    "en-todo" => {
                        let checked = en_todo_checked(&e);
                        append_child(
                            &mut stack,
                            HtmlNode::element(
                                "en-todo-marker",
                                vec![("checked".into(), bool_attr(checked))],
                            ),
                        );
                    }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(err) => {
                saw_error = Some(err.to_string());
                break;
            }
            _ => {}
        }
        buf.clear();
    }

    let mut root = stack
        .pop()
        .unwrap_or_else(|| HtmlNode::element("root", Vec::new()));
    if let HtmlNode::Element { children, .. } = &mut root {
        promote_evernote_todos(children);
    }

    let mut out = String::new();
    if let HtmlNode::Element { children, .. } = &root {
        for child in children {
            write_html(&mut out, child);
        }
    }

    if out.trim().is_empty() {
        if let Some(err) = saw_error {
            return Err(NotebookError::Other(format!("invalid ENML: {err}")));
        }
        out.push_str("<p></p>");
    }

    Ok(out)
}

fn push_element(stack: &mut Vec<HtmlNode>, name: &str, attrs: Vec<(String, String)>) {
    stack.push(HtmlNode::element(name, attrs));
}

fn pop_element(stack: &mut Vec<HtmlNode>) {
    if stack.len() <= 1 {
        return;
    }
    let child = stack.pop().expect("html stack");
    append_child(stack, child);
}

fn append_child(stack: &mut Vec<HtmlNode>, child: HtmlNode) {
    if let Some(HtmlNode::Element { children, .. }) = stack.last_mut() {
        children.push(child);
    }
}

fn copy_html_attrs(e: &quick_xml::events::BytesStart<'_>) -> Vec<(String, String)> {
    e.attributes()
        .flatten()
        .filter_map(|attr| {
            let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
            if key == "style"
                || key == "href"
                || key == "class"
                || key == "colspan"
                || key == "rowspan"
                || key == "start"
            {
                Some((key, attr_value(&attr)))
            } else {
                None
            }
        })
        .collect()
}

fn attr_value(attr: &quick_xml::events::attributes::Attribute<'_>) -> String {
    decode_xml_entities(&String::from_utf8_lossy(&attr.value))
}

// Headings get their own attr copy so Evernote's private
// `--en-isCollapsed` CSS property can be translated into a `data-collapsed`
// attribute that survives the TipTap schema, instead of relying on the raw
// style property round-tripping unopened. Every other `--en-*` property
// (`--en-todo`, `--en-checked`, ...) must stay untouched on non-heading
// elements - checklist.rs reads them straight off `<ul>`/`<li>` style text.
fn copy_heading_attrs(e: &quick_xml::events::BytesStart<'_>) -> Vec<(String, String)> {
    let mut collapsed = false;
    let mut out = Vec::new();
    for (key, value) in copy_html_attrs(e) {
        if key == "style" {
            collapsed = style_has_en_collapsed_true(&value);
            let cleaned = strip_en_style_declarations(&value);
            if !cleaned.is_empty() {
                out.push(("style".to_string(), cleaned));
            }
        } else {
            out.push((key, value));
        }
    }
    if collapsed {
        out.push(("data-collapsed".to_string(), "true".to_string()));
    }
    out
}

fn style_has_en_collapsed_true(style: &str) -> bool {
    style.split(';').any(|decl| {
        let mut parts = decl.splitn(2, ':');
        let prop = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        prop.eq_ignore_ascii_case("--en-isCollapsed") && value.eq_ignore_ascii_case("true")
    })
}

// Real Evernote exports carry `--en-viewAs:attachment;` on an `<en-media>`
// occurrence to force a normally-inline image to render as a file
// attachment in that specific spot in the note body. Other observed values
// (`pdf-pageByPage`, `youtube-video-small`) don't change how we render, so
// this only looks for the `attachment` value. This is per-occurrence, not
// per-resource: the same resource can appear elsewhere without the style
// and should still render inline.
fn style_has_en_view_as_attachment(style: &str) -> bool {
    style.split(';').any(|decl| {
        let mut parts = decl.splitn(2, ':');
        let prop = parts.next().unwrap_or("").trim();
        let value = parts.next().unwrap_or("").trim();
        prop.eq_ignore_ascii_case("--en-viewAs") && value.eq_ignore_ascii_case("attachment")
    })
}

fn strip_en_style_declarations(style: &str) -> String {
    style
        .split(';')
        .map(str::trim)
        .filter(|decl| !decl.is_empty())
        .filter(|decl| {
            let prop = decl.split(':').next().unwrap_or("").trim();
            !prop.to_ascii_lowercase().starts_with("--en-")
        })
        .collect::<Vec<_>>()
        .join("; ")
}

// Legacy `<font color face size>` has no TipTap equivalent, so it is
// converted into a `<span style="...">` whose declarations the desktop
// editor's fontMarks.ts already knows how to parse (color, font-family,
// font-size). `size` uses Evernote's legacy 1-7 point scale; any value
// outside that (e.g. the relative forms "+1"/"-1") is dropped intentionally.
fn font_style_attrs(e: &quick_xml::events::BytesStart<'_>) -> Vec<(String, String)> {
    let mut declarations = Vec::new();
    for attr in e.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref()).into_owned();
        let value = attr_value(&attr);
        match key.as_str() {
            "color" => declarations.push(format!("color: {value}")),
            "face" => declarations.push(format!("font-family: {value}")),
            "size" => {
                if let Some(px) = legacy_font_size_px(value.trim()) {
                    declarations.push(format!("font-size: {px}"));
                }
            }
            _ => {}
        }
    }
    if declarations.is_empty() {
        Vec::new()
    } else {
        vec![("style".to_string(), declarations.join("; "))]
    }
}

fn legacy_font_size_px(size: &str) -> Option<&'static str> {
    match size {
        "1" => Some("10px"),
        "2" => Some("13px"),
        "3" => Some("16px"),
        "4" => Some("18px"),
        "5" => Some("24px"),
        "6" => Some("32px"),
        "7" => Some("48px"),
        _ => None,
    }
}

fn en_todo_checked(e: &quick_xml::events::BytesStart<'_>) -> bool {
    e.attributes().flatten().any(|attr| {
        attr.key.as_ref() == b"checked" && attr_value(&attr).eq_ignore_ascii_case("true")
    })
}

fn bool_attr(value: bool) -> String {
    if value { "true" } else { "false" }.to_string()
}

fn promote_evernote_todos(nodes: &mut Vec<HtmlNode>) {
    walk_and_convert_lists(nodes);
    *nodes = group_todo_lines(std::mem::take(nodes));
}

fn walk_and_convert_lists(nodes: &mut [HtmlNode]) {
    for node in nodes.iter_mut() {
        if let HtmlNode::Element {
            name,
            attrs,
            children,
        } = node
        {
            walk_and_convert_lists(children);
            if name == "ul" || name == "ol" {
                if contains_todo_marker(children) {
                    convert_list_to_task_list(name, attrs, children);
                }
            } else if name != "li" {
                // Group consecutive todo divs/paragraphs, but not inside a list
                // item — Evernote puts `<en-todo/>` in a div wrapped by `<li>`,
                // and those must stay on the `<li>` so the parent list can
                // become a task list instead of nested bullets.
                *children = group_todo_lines(std::mem::take(children));
            }
        }
    }
}

fn convert_list_to_task_list(
    name: &mut String,
    attrs: &mut Vec<(String, String)>,
    children: &mut [HtmlNode],
) {
    *name = "ul".to_string();
    set_attr(attrs, "data-type", "taskList");
    for child in children {
        if let HtmlNode::Element {
            name,
            attrs,
            children,
        } = child
        {
            if name == "li" {
                let checked = extract_todo_checked(children).unwrap_or(false);
                strip_todo_markers(children);
                set_attr(attrs, "data-type", "taskItem");
                set_attr(
                    attrs,
                    "data-checked",
                    if checked { "true" } else { "false" },
                );
            }
        }
    }
}

fn group_todo_lines(nodes: Vec<HtmlNode>) -> Vec<HtmlNode> {
    let mut out = Vec::new();
    let mut run = Vec::new();
    for node in nodes {
        if is_todo_line(&node) {
            run.push(node);
        } else {
            flush_todo_run(&mut out, &mut run);
            out.push(node);
        }
    }
    flush_todo_run(&mut out, &mut run);
    out
}

fn is_todo_line(node: &HtmlNode) -> bool {
    match node {
        HtmlNode::Element {
            name,
            attrs,
            children,
        } => {
            if name == "li" && has_attr(attrs, "data-type", "taskItem") {
                return false;
            }
            (name == "div" || name == "p") && contains_todo_marker(children)
        }
        _ => false,
    }
}

fn flush_todo_run(out: &mut Vec<HtmlNode>, run: &mut Vec<HtmlNode>) {
    if run.is_empty() {
        return;
    }
    let items = run
        .drain(..)
        .map(|node| {
            let checked = match &node {
                HtmlNode::Element { children, .. } => {
                    extract_todo_checked(children).unwrap_or(false)
                }
                _ => false,
            };
            let mut content = match node {
                HtmlNode::Element {
                    name, mut children, ..
                } => {
                    strip_todo_markers(&mut children);
                    if name == "p" {
                        vec![HtmlNode::Element {
                            name: "p".into(),
                            attrs: Vec::new(),
                            children,
                        }]
                    } else {
                        children
                    }
                }
                other => vec![other],
            };
            if content.is_empty() {
                content.push(HtmlNode::element("p", Vec::new()));
            }
            HtmlNode::Element {
                name: "li".into(),
                attrs: vec![
                    ("data-type".into(), "taskItem".into()),
                    ("data-checked".into(), bool_attr(checked)),
                ],
                children: vec![HtmlNode::Element {
                    name: "div".into(),
                    attrs: Vec::new(),
                    children: content,
                }],
            }
        })
        .collect();
    out.push(HtmlNode::Element {
        name: "ul".into(),
        attrs: vec![("data-type".into(), "taskList".into())],
        children: items,
    });
}

fn contains_todo_marker(nodes: &[HtmlNode]) -> bool {
    nodes.iter().any(|node| match node {
        HtmlNode::Element { name, children, .. } => {
            name == "en-todo-marker" || contains_todo_marker(children)
        }
        _ => false,
    })
}

fn extract_todo_checked(nodes: &[HtmlNode]) -> Option<bool> {
    for node in nodes {
        match node {
            HtmlNode::Element {
                name,
                attrs,
                children,
            } if name == "en-todo-marker" => {
                return Some(has_attr(attrs, "checked", "true"));
            }
            HtmlNode::Element { children, .. } => {
                if let Some(checked) = extract_todo_checked(children) {
                    return Some(checked);
                }
            }
            _ => {}
        }
    }
    None
}

fn strip_todo_markers(nodes: &mut Vec<HtmlNode>) {
    let mut out = Vec::with_capacity(nodes.len());
    for node in nodes.drain(..) {
        match node {
            HtmlNode::Element {
                name,
                attrs: _,
                mut children,
            } if name == "en-todo-marker" => {
                strip_todo_markers(&mut children);
                out.extend(children);
            }
            HtmlNode::Element {
                name,
                attrs,
                mut children,
            } => {
                strip_todo_markers(&mut children);
                out.push(HtmlNode::Element {
                    name,
                    attrs,
                    children,
                });
            }
            other => out.push(other),
        }
    }
    *nodes = out;
}

fn set_attr(attrs: &mut Vec<(String, String)>, key: &str, value: &str) {
    if let Some(existing) = attrs.iter_mut().find(|(name, _)| name == key) {
        existing.1 = value.to_string();
    } else {
        attrs.push((key.to_string(), value.to_string()));
    }
}

fn has_attr(attrs: &[(String, String)], key: &str, value: &str) -> bool {
    attrs
        .iter()
        .any(|(name, current)| name == key && current == value)
}

fn write_html(out: &mut String, node: &HtmlNode) {
    match node {
        HtmlNode::Text(text) => out.push_str(&escape_html(text)),
        HtmlNode::Raw(raw) => out.push_str(raw),
        HtmlNode::Element {
            name,
            attrs,
            children,
        } if name == "en-todo-marker" => {
            let checked = has_attr(attrs, "checked", "true");
            out.push_str(if checked {
                r#"<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p></p></div></li></ul>"#
            } else {
                r#"<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><div><p></p></div></li></ul>"#
            });
            for child in children {
                write_html(out, child);
            }
        }
        HtmlNode::Element {
            name,
            attrs,
            children,
        } => {
            if (name == "br" || name == "hr") && children.is_empty() {
                out.push_str(if name == "br" { "<br/>" } else { "<hr/>" });
                return;
            }
            out.push('<');
            out.push_str(name);
            for (key, value) in attrs {
                out.push(' ');
                out.push_str(key);
                out.push_str("=\"");
                out.push_str(&escape_attr(value));
                out.push('"');
            }
            out.push('>');
            for child in children {
                write_html(out, child);
            }
            out.push_str("</");
            out.push_str(name);
            out.push('>');
        }
    }
}

fn render_en_media(
    out: &mut String,
    e: &quick_xml::events::BytesStart<'_>,
    resource_map: &HashMap<String, &EnexResource>,
) {
    let mut hash = None;
    let mut mime = None;
    let mut width: Option<i32> = None;
    let mut height: Option<i32> = None;
    let mut view_as_attachment = false;
    for attr in e.attributes().flatten() {
        match attr.key.as_ref() {
            b"hash" => hash = Some(String::from_utf8_lossy(&attr.value).to_string()),
            b"type" => mime = Some(String::from_utf8_lossy(&attr.value).to_string()),
            b"width" => width = String::from_utf8_lossy(&attr.value).parse().ok(),
            b"height" => height = String::from_utf8_lossy(&attr.value).parse().ok(),
            b"style" => {
                view_as_attachment =
                    style_has_en_view_as_attachment(&String::from_utf8_lossy(&attr.value));
            }
            _ => {}
        }
    }
    let resource = hash
        .as_deref()
        .and_then(|value| resource_map.get(&normalize_hash(value)).copied())
        .or_else(|| match_unique_resource(resource_map, mime.as_deref()));
    if let Some(resource) = resource {
        let use_mime = mime.unwrap_or_else(|| resource.mime.clone());
        let filename = resource
            .filename
            .as_deref()
            .filter(|name| !name.is_empty())
            .unwrap_or("attachment");
        if !view_as_attachment
            && is_inline_image(resource)
            && use_mime.to_ascii_lowercase().starts_with("image/")
            && !looks_like_pdf(&use_mime, resource.filename.as_deref(), &resource.data)
        {
            let width = width.or(resource.width);
            let height = height.or(resource.height);
            out.push_str("<img src=\"notebook-resource://");
            out.push_str(&escape_attr(&resource.hash));
            out.push_str("\" alt=\"");
            out.push_str(&escape_attr(filename));
            out.push('"');
            if let Some(width) = width {
                out.push_str(&format!(" width=\"{width}\""));
            }
            if let Some(height) = height {
                out.push_str(&format!(" height=\"{height}\""));
            }
            out.push_str(" />");
        } else {
            out.push_str(&file_attachment_html(
                &format!("notebook-resource://{}", resource.hash),
                filename,
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
            is_attachment: false,
        };
        let enml = format!(
            r#"<en-note><div>Before <en-media type="image/png" hash="{}"/> after</div></en-note>"#,
            hash
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(html.contains("<img"), "expected image tag, got: {html}");
        assert!(
            html.contains(&format!("notebook-resource://{hash}")),
            "expected resource placeholder, got: {html}"
        );
        assert!(!html.contains("data:image"), "got: {html}");
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
            is_attachment: false,
        };
        let enml = format!(
            r#"<en-note><en-media type="application/pdf" hash="{}"/></en-note>"#,
            hash.to_ascii_uppercase()
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(html.contains("data-notebook-file=\"true\""), "got: {html}");
        assert!(html.contains("data-expanded=\"true\""), "got: {html}");
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

    #[test]
    fn decodes_apos_entity_to_apostrophe() {
        assert_eq!(decode_xml_entities("John&apos;s note"), "John's note");
        assert_eq!(decode_xml_entities("a &amp;apos; b"), "a ' b");
        assert_eq!(decode_xml_entities("A &amp; B"), "A & B");
        assert_eq!(decode_xml_entities("&#39;&#x27;"), "''");

        let html = enml_to_html(
            r#"<en-note><div>It&apos;s Tom&apos;s &amp; Jerry&apos;s</div></en-note>"#,
            &[],
        )
        .unwrap();
        assert!(html.contains("It's Tom's"), "got: {html}");
        assert!(html.contains("Jerry's"), "got: {html}");
        assert!(!html.contains("&apos;"), "got: {html}");
        assert!(!html.contains("&amp;apos"), "got: {html}");
        assert!(
            html.contains("&amp;"),
            "ampersand should stay escaped, got: {html}"
        );
    }

    #[test]
    fn converts_self_closing_en_todo_list_to_task_list() {
        let enml = r#"<en-note><ul><li><div><en-todo checked="false"/>Milk</div></li><li><div><en-todo checked="true"/>Eggs</div></li></ul></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains("data-type=\"taskList\""), "got: {html}");
        assert!(html.contains("data-type=\"taskItem\""), "got: {html}");
        assert!(html.contains("data-checked=\"false\""), "got: {html}");
        assert!(html.contains("data-checked=\"true\""), "got: {html}");
        assert!(html.contains("Milk"), "got: {html}");
        assert!(html.contains("Eggs"), "got: {html}");
        assert!(
            html.contains("<ul data-type=\"taskList\"><li data-type=\"taskItem\""),
            "expected a task list, got: {html}"
        );
        assert!(
            !html.contains("<ul><li>"),
            "should not remain a bullet list: {html}"
        );
    }

    #[test]
    fn converts_div_en_todos_to_task_list() {
        let enml = r#"<en-note><div><en-todo checked="false"/>One</div><div><en-todo checked="true"/>Two</div></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains("data-type=\"taskList\""), "got: {html}");
        assert!(html.contains("data-checked=\"false\""), "got: {html}");
        assert!(html.contains("data-checked=\"true\""), "got: {html}");
        assert!(html.contains("One"), "got: {html}");
        assert!(html.contains("Two"), "got: {html}");
    }

    #[test]
    fn converts_wrapped_en_todo_with_text_content() {
        let enml =
            r#"<en-note><div><en-todo checked="false">Buy oat milk</en-todo></div></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains("data-type=\"taskList\""), "got: {html}");
        assert!(html.contains("Buy oat milk"), "got: {html}");
        assert!(html.contains("data-checked=\"false\""), "got: {html}");
    }

    #[test]
    fn parses_apostrophe_in_enex_title() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>John&apos;s grocery list</title>
    <content><![CDATA[<en-note><div>Don&apos;t forget</div></en-note>]]></content>
  </note>
</en-export>"#;
        let export = parse_enex(enex.as_bytes()).unwrap();
        assert_eq!(export.notes[0].title, "John's grocery list");
        let html = enml_to_html(&export.notes[0].content, &[]).unwrap();
        assert!(html.contains("Don't forget"), "got: {html}");
    }

    fn import_bytes(label: &str, enex: &[u8]) -> (crate::service::NotebookService, crate::models::EnexImportResult) {
        let dir = std::env::temp_dir().join(format!("notebook-{label}-import-test"));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let service = crate::service::NotebookService::new(
            crate::db::Database::open(dir.join("test.db")).unwrap(),
        );
        let result = service
            .import_enex(
                enex,
                crate::models::EnexImportRequest {
                    notebook_id: None,
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        (service, result)
    }

    fn imported_note(
        service: &crate::service::NotebookService,
        notebook_id: uuid::Uuid,
    ) -> crate::models::Note {
        service
            .list_notes(Some(notebook_id), None, false, None, Some(false))
            .unwrap()
            .pop()
            .and_then(|summary| service.get_note(summary.id).ok())
            .unwrap()
    }

    #[test]
    fn imports_inline_png_as_image_attachment() {
        let file_data = b"\x89PNG\r\n\x1a\nimage-bytes";
        let hash = format!("{:x}", md5::compute(file_data));
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Photo</title>
    <content><![CDATA[<en-note><div>Snap</div><en-media type="image/png" hash="{hash}" width="12" height="8"/></en-note>]]></content>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>image/png</mime>
      <width>12</width>
      <height>8</height>
      <resource-attributes><file-name>snap.png</file-name></resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let (service, result) = import_bytes("png-inline", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "snap.png");
        assert_eq!(attachments[0].mime_type, "image/png");
        assert_eq!(
            service.read_attachment_data(attachments[0].id).unwrap(),
            file_data
        );
        assert!(note.content.contains("<img"), "got: {}", note.content);
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
        assert!(note.content.contains("width=\"12\""));
        assert!(!note.content.contains("data:image"));
        assert!(!note.content.contains("notebook-resource://"));
    }

    #[test]
    fn imports_unreferenced_image_attachment() {
        let file_data = b"\x89PNG\r\n\x1a\nloose";
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Loose image</title>
    <content><![CDATA[<en-note><div>See attached</div></en-note>]]></content>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>image/png</mime>
      <resource-attributes>
        <file-name>C:\Users\x\photo.png</file-name>
        <attachment>true</attachment>
      </resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let (service, result) = import_bytes("png-unreferenced", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].filename, "photo.png");
        assert!(note.content.contains("data-notebook-file=\"true\""));
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
    }

    #[test]
    fn imports_audio_mpeg_resource() {
        let file_data = b"ID3\x03\x00\x00fake-mp3";
        let hash = format!("{:x}", md5::compute(file_data));
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Voice</title>
    <content><![CDATA[<en-note><en-media type="audio/mpeg" hash="{hash}"/></en-note>]]></content>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>audio/mpeg</mime>
      <resource-attributes><file-name>memo.mp3</file-name></resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let (service, result) = import_bytes("audio-mpeg", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments[0].filename, "memo.mp3");
        assert_eq!(attachments[0].mime_type, "audio/mpeg");
        assert_eq!(
            service.read_attachment_data(attachments[0].id).unwrap(),
            file_data
        );
        assert!(note.content.contains("data-notebook-file=\"true\""));
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
    }

    #[test]
    fn imports_docx_from_octet_stream() {
        let file_data = b"PK\x03\x04docx-bytes";
        let hash = format!("{:x}", md5::compute(file_data));
        let encoded = base64::engine::general_purpose::STANDARD.encode(file_data);
        let enex = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Brief</title>
    <content><![CDATA[<en-note><en-media type="application/octet-stream" hash="{hash}"/></en-note>]]></content>
    <resource>
      <data encoding="base64">{encoded}</data>
      <mime>application/octet-stream</mime>
      <resource-attributes><file-name>brief.docx</file-name></resource-attributes>
    </resource>
  </note>
</en-export>"#
        );
        let (service, result) = import_bytes("docx-octet", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        let attachments = service.list_attachments(note.id).unwrap();
        assert_eq!(attachments[0].filename, "brief.docx");
        assert_eq!(
            attachments[0].mime_type,
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        assert!(note
            .content
            .contains(&format!("notebook-attachment://{}", attachments[0].id)));
    }

    #[test]
    fn imports_utf16_le_enex() {
        let xml = r#"<?xml version="1.0" encoding="UTF-16"?>
<en-export>
  <note>
    <title>UTF16</title>
    <content><![CDATA[<en-note><div>Hello from UTF-16</div></en-note>]]></content>
  </note>
</en-export>"#;
        let mut bytes = vec![0xFF, 0xFE];
        for unit in xml.encode_utf16() {
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
        let (service, result) = import_bytes("utf16-le", &bytes);
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        assert_eq!(note.title, "UTF16");
        assert!(note.content.contains("Hello from UTF-16"));
    }

    #[test]
    fn converts_evernote_collapsed_heading_marker_to_data_collapsed() {
        let enml = r#"<en-note><h1 style="--en-isCollapsed:true; --en-nodeId:abc;"><b>Amps</b></h1></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains(r#"data-collapsed="true""#), "got: {html}");
        assert!(!html.contains("--en-"), "got: {html}");
    }

    #[test]
    fn drops_uncollapsed_heading_marker_without_data_collapsed() {
        let enml = r#"<en-note><h1 style="--en-isCollapsed:false; --en-nodeId:abc;"><b>Amps</b></h1></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(!html.contains("data-collapsed"), "got: {html}");
        assert!(!html.contains("--en-"), "got: {html}");
    }

    #[test]
    fn keeps_real_heading_style_declarations_while_dropping_en_properties() {
        let enml = r#"<en-note><h2 style="font-size: 25px; --en-nodeId:x;">Title</h2></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains("font-size: 25px"), "got: {html}");
        assert!(!html.contains("--en-"), "got: {html}");
    }

    #[test]
    fn leaves_checklist_en_todo_style_untouched_on_non_heading_elements() {
        // Regression guard: copy_heading_attrs must only apply to h1..h6.
        // checklist.rs's normalize_evernote_checklist_html reads --en-todo
        // and --en-checked straight off <ul>/<li> style text, so
        // enml_to_html must keep passing those through copy_html_attrs
        // verbatim rather than the new heading-only stripping helper.
        let enml = r#"<en-note><ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Done</div></li></ul></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains(r#"style="--en-todo:true;""#), "got: {html}");
        assert!(html.contains(r#"style="--en-checked:true;""#), "got: {html}");
        assert!(html.contains("Done"), "got: {html}");
    }

    #[test]
    fn converts_self_closing_hr_divider_between_blocks() {
        let enml =
            r#"<en-note><div>Ingredients</div><hr/><div>Directions</div></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains("<hr/>"), "got: {html}");
        let hr_pos = html.find("<hr/>").unwrap();
        assert!(
            html[..hr_pos].contains("Ingredients"),
            "expected Ingredients before <hr/>, got: {html}"
        );
        assert!(
            html[hr_pos..].contains("Directions"),
            "expected Directions after <hr/>, got: {html}"
        );
    }

    #[test]
    fn converts_open_close_hr_spelling_without_swallowing_content() {
        let enml = r#"<en-note><div>Before</div><hr></hr><div>After</div></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert_eq!(
            html.matches("<hr/>").count(),
            1,
            "expected exactly one <hr/>, got: {html}"
        );
        assert!(html.contains("Before"), "got: {html}");
        assert!(html.contains("After"), "got: {html}");
        assert!(
            !html.contains("<hr>Before</hr>") && !html.contains("<hr>After</hr>"),
            "hr should not have swallowed sibling content, got: {html}"
        );
    }

    #[test]
    fn keeps_strikethrough_s_tag() {
        let html = enml_to_html(r#"<en-note><s>gone</s></en-note>"#, &[]).unwrap();
        assert!(html.contains("<s>gone</s>"), "got: {html}");
    }

    #[test]
    fn converts_font_color_and_size_to_span_style() {
        let html = enml_to_html(
            r##"<en-note><font color="#ff0000" size="5">Red</font></en-note>"##,
            &[],
        )
        .unwrap();
        assert!(html.contains("<span"), "got: {html}");
        assert!(html.contains("color: #ff0000"), "got: {html}");
        assert!(html.contains("font-size: 24px"), "got: {html}");
        assert!(html.contains("Red"), "got: {html}");
        assert!(!html.contains("<font"), "got: {html}");
    }

    #[test]
    fn converts_font_face_to_font_family_style() {
        let html = enml_to_html(
            r#"<en-note><font face="Georgia">Serif</font></en-note>"#,
            &[],
        )
        .unwrap();
        assert!(html.contains("<span"), "got: {html}");
        assert!(html.contains("font-family: Georgia"), "got: {html}");
        assert!(html.contains("Serif"), "got: {html}");
    }

    #[test]
    fn font_with_no_recognized_attrs_keeps_text_without_corrupting_structure() {
        let html = enml_to_html(
            r#"<en-note><div>Before <font lang="en">Middle</font> After</div></en-note>"#,
            &[],
        )
        .unwrap();
        assert!(html.contains("Before"), "got: {html}");
        assert!(html.contains("Middle"), "got: {html}");
        assert!(html.contains("After"), "got: {html}");
        assert!(html.contains("<span>Middle</span>"), "got: {html}");
    }

    #[test]
    fn en_media_with_view_as_attachment_style_renders_as_file_not_image() {
        let hash = "f03c1c2d96bc67eda02968c8b5af9008";
        let resource = EnexResource {
            data: vec![0x89, 0x50, 0x4e, 0x47],
            mime: "image/png".to_string(),
            filename: Some("photo.png".to_string()),
            width: None,
            height: None,
            hash: hash.to_string(),
            is_attachment: false,
        };
        let enml = format!(
            r#"<en-note><en-media type="image/png" hash="{}" style="--en-viewAs:attachment;"/></en-note>"#,
            hash
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(
            html.contains("data-notebook-file=\"true\""),
            "expected a file attachment, got: {html}"
        );
        assert!(!html.contains("<img"), "got: {html}");
    }

    #[test]
    fn en_media_without_view_as_attachment_style_still_renders_inline_image() {
        let hash = "f03c1c2d96bc67eda02968c8b5af9008";
        let resource = EnexResource {
            data: vec![0x89, 0x50, 0x4e, 0x47],
            mime: "image/png".to_string(),
            filename: Some("photo.png".to_string()),
            width: None,
            height: None,
            hash: hash.to_string(),
            is_attachment: false,
        };
        let enml = format!(
            r#"<en-note><en-media type="image/png" hash="{}"/></en-note>"#,
            hash
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(html.contains("<img"), "expected inline image, got: {html}");
        assert!(!html.contains("data-notebook-file=\"true\""), "got: {html}");
    }

    #[test]
    fn en_media_with_other_view_as_value_still_renders_inline_image() {
        let hash = "f03c1c2d96bc67eda02968c8b5af9008";
        let resource = EnexResource {
            data: vec![0x89, 0x50, 0x4e, 0x47],
            mime: "image/png".to_string(),
            filename: Some("photo.png".to_string()),
            width: None,
            height: None,
            hash: hash.to_string(),
            is_attachment: false,
        };
        let enml = format!(
            r#"<en-note><en-media type="image/png" hash="{}" style="--en-viewAs:pdf-pageByPage;"/></en-note>"#,
            hash
        );
        let html = enml_to_html(&enml, &[resource]).unwrap();
        assert!(html.contains("<img"), "expected inline image, got: {html}");
        assert!(!html.contains("data-notebook-file=\"true\""), "got: {html}");
    }

    #[test]
    fn copy_html_attrs_keeps_colspan_rowspan_and_ordered_list_start() {
        let enml = r#"<en-note><table><tr><td colspan="2" rowspan="3">Cell</td></tr></table><ol start="5"><li>Five</li></ol></en-note>"#;
        let html = enml_to_html(enml, &[]).unwrap();
        assert!(html.contains(r#"colspan="2""#), "got: {html}");
        assert!(html.contains(r#"rowspan="3""#), "got: {html}");
        assert!(html.contains(r#"start="5""#), "got: {html}");
    }

    #[test]
    fn created_only_note_keeps_created_timestamp_instead_of_stamping_today() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Created Only</title>
    <content><![CDATA[<en-note><div>Hello</div></en-note>]]></content>
    <created>20200101T120000Z</created>
  </note>
</en-export>"#;
        let (service, result) = import_bytes("created-only", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        let expected = parse_evernote_datetime("20200101T120000Z").unwrap();
        assert_eq!(note.created_at, expected);
        assert_eq!(note.updated_at, expected);
    }

    #[test]
    fn updated_only_note_keeps_updated_timestamp_instead_of_stamping_today() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Updated Only</title>
    <content><![CDATA[<en-note><div>Hello</div></en-note>]]></content>
    <updated>20210605T083000Z</updated>
  </note>
</en-export>"#;
        let (service, result) = import_bytes("updated-only", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        let expected = parse_evernote_datetime("20210605T083000Z").unwrap();
        assert_eq!(note.created_at, expected);
        assert_eq!(note.updated_at, expected);
    }

    #[test]
    fn escaped_content_outside_cdata_imports_as_real_markup_with_single_decode() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Escaped</title>
    <content>&lt;en-note&gt;&lt;div&gt;Tom &amp;amp; Jerry&lt;/div&gt;&lt;/en-note&gt;</content>
    <created>20200101T120000Z</created>
  </note>
</en-export>"#;
        let (service, result) = import_bytes("escaped-content", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        assert!(
            note.content.contains("<div>Tom &amp; Jerry</div>"),
            "expected a real div with a single-decoded ampersand, got: {}",
            note.content
        );
        assert!(
            !note.content.contains("&lt;en-note&gt;"),
            "content should not still be escaped, got: {}",
            note.content
        );
    }

    #[test]
    fn cdata_content_is_unaffected_by_single_decode_change() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>CDATA</title>
    <content><![CDATA[<en-note><div>Tom &amp; Jerry</div></en-note>]]></content>
    <created>20200101T120000Z</created>
  </note>
</en-export>"#;
        let (service, result) = import_bytes("cdata-content", enex.as_bytes());
        assert_eq!(result.imported, 1, "errors: {:?}", result.errors);
        let note = imported_note(&service, result.notebook_id);
        assert!(
            note.content.contains("<div>Tom &amp; Jerry</div>"),
            "got: {}",
            note.content
        );
    }

    #[test]
    fn reimporting_the_same_enex_bytes_skips_as_duplicates() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Dup Note</title>
    <content><![CDATA[<en-note><div>Hello</div></en-note>]]></content>
    <created>20200101T120000Z</created>
    <updated>20200101T120000Z</updated>
  </note>
</en-export>"#;
        let (service, first) = import_bytes("dup-reimport", enex.as_bytes());
        assert_eq!(first.imported, 1, "errors: {:?}", first.errors);
        assert_eq!(first.duplicates, 0);

        let second = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: Some(first.notebook_id),
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(second.imported, 0, "errors: {:?}", second.errors);
        assert_eq!(second.duplicates, 1);

        let notes = service
            .list_notes(Some(first.notebook_id), None, false, None, Some(false))
            .unwrap();
        assert_eq!(notes.len(), 1, "note count should be unchanged after reimport");
    }

    #[test]
    fn notes_sharing_a_title_with_different_created_timestamps_both_import() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>Same Title</title>
    <content><![CDATA[<en-note><div>First</div></en-note>]]></content>
    <created>20200101T120000Z</created>
  </note>
  <note>
    <title>Same Title</title>
    <content><![CDATA[<en-note><div>Second</div></en-note>]]></content>
    <created>20210101T120000Z</created>
  </note>
</en-export>"#;
        let (service, result) = import_bytes("same-title-different-created", enex.as_bytes());
        assert_eq!(result.imported, 2, "errors: {:?}", result.errors);
        assert_eq!(result.duplicates, 0);
        let notes = service
            .list_notes(Some(result.notebook_id), None, false, None, Some(false))
            .unwrap();
        assert_eq!(notes.len(), 2);
    }

    #[test]
    fn note_with_no_created_timestamp_always_imports_since_it_cannot_be_keyed() {
        let enex = r#"<?xml version="1.0" encoding="UTF-8"?>
<en-export>
  <note>
    <title>No Created</title>
    <content><![CDATA[<en-note><div>Hello</div></en-note>]]></content>
  </note>
</en-export>"#;
        let (service, first) = import_bytes("no-created-reimport", enex.as_bytes());
        assert_eq!(first.imported, 1, "errors: {:?}", first.errors);
        assert_eq!(first.duplicates, 0);

        let second = service
            .import_enex(
                enex.as_bytes(),
                crate::models::EnexImportRequest {
                    notebook_id: Some(first.notebook_id),
                    notebook_name: Some("Imported".into()),
                    stack_id: None,
                },
            )
            .unwrap();
        assert_eq!(second.imported, 1, "errors: {:?}", second.errors);
        assert_eq!(second.duplicates, 0);

        let notes = service
            .list_notes(Some(first.notebook_id), None, false, None, Some(false))
            .unwrap();
        assert_eq!(notes.len(), 2, "both imports should have created a note");
    }
}
