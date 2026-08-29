use std::io::Cursor;

use quick_xml::events::Event;
use quick_xml::Reader;

use crate::error::{NotebookError, Result};

use super::attachment::looks_like_pdf;

pub fn file_attachment_html(href: &str, filename: &str, mime: &str) -> String {
    let pdf = looks_like_pdf(mime, Some(filename), &[]);
    let class_name = if pdf {
        "notebook-file is-pdf is-expanded"
    } else {
        "notebook-file is-title"
    };
    format!(
        "<div data-notebook-file=\"true\" data-href=\"{href}\" data-filename=\"{filename}\" data-mime=\"{mime}\" data-expanded=\"{expanded}\" class=\"{class_name}\"><a href=\"{href}\">{visible}</a></div>",
        href = escape_attr(href),
        filename = escape_attr(filename),
        mime = escape_attr(mime),
        expanded = if pdf { "true" } else { "false" },
        class_name = class_name,
        visible = escape_html(filename),
    )
}

pub(crate) fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

pub(crate) fn escape_attr(input: &str) -> String {
    escape_html(input).replace('"', "&quot;")
}

pub(crate) fn local_name(e: &quick_xml::events::BytesStart<'_>) -> String {
    String::from_utf8_lossy(e.name().as_ref()).to_ascii_lowercase()
}

/// Raw attribute bytes as text. Only used for the ASCII booleans on a checkbox,
/// so it deliberately skips entity decoding and the reader-bound decoder.
pub(crate) fn raw_attribute(e: &quick_xml::events::BytesStart<'_>, key: &str) -> Option<String> {
    e.attributes().flatten().find_map(|attr| {
        if !attr.key.as_ref().eq_ignore_ascii_case(key.as_bytes()) {
            return None;
        }
        Some(String::from_utf8_lossy(&attr.value).into_owned())
    })
}

pub(crate) fn has_attribute(e: &quick_xml::events::BytesStart<'_>, key: &str) -> bool {
    e.attributes()
        .flatten()
        .any(|attr| attr.key.as_ref().eq_ignore_ascii_case(key.as_bytes()))
}

pub(crate) fn attribute_equals(
    e: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<Cursor<&[u8]>>,
    key: &str,
    expected: &str,
) -> bool {
    decoded_attribute(e, reader, key).is_some_and(|value| value.eq_ignore_ascii_case(expected))
}

pub(crate) fn decoded_attribute(
    e: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<Cursor<&[u8]>>,
    key: &str,
) -> Option<String> {
    e.attributes().flatten().find_map(|attr| {
        if !attr.key.as_ref().eq_ignore_ascii_case(key.as_bytes()) {
            return None;
        }
        Some(
            attr.decode_and_unescape_value(reader.decoder())
                .map(|value| value.into_owned())
                .unwrap_or_else(|_| String::from_utf8_lossy(&attr.value).into_owned()),
        )
    })
}

pub(crate) fn style_flag(
    e: &quick_xml::events::BytesStart<'_>,
    reader: &Reader<Cursor<&[u8]>>,
    property: &str,
) -> Option<bool> {
    let style = decoded_attribute(e, reader, "style")?;
    style.split(';').find_map(|declaration| {
        let (name, value) = declaration.split_once(':')?;
        if !name.trim().eq_ignore_ascii_case(property) {
            return None;
        }
        Some(matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "true" | "1" | "yes"
        ))
    })
}

pub(crate) fn is_blank_text(event: &Event<'_>) -> bool {
    match event {
        Event::Text(text) => text.iter().all(u8::is_ascii_whitespace),
        _ => false,
    }
}

pub(crate) fn is_line_break(event: &Event<'_>) -> bool {
    match event {
        Event::Start(tag) | Event::Empty(tag) => local_name(tag) == "br",
        _ => false,
    }
}

pub(crate) fn read_all_events(html: &str) -> Result<Vec<Event<'static>>> {
    let mut reader = Reader::from_reader(Cursor::new(html.as_bytes()));
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;
    let mut buf = Vec::new();
    let mut events = Vec::new();
    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Eof) => break,
            Ok(event) => events.push(event.into_owned()),
            Err(err) => {
                return Err(NotebookError::Other(format!(
                    "could not parse checklist HTML: {err}"
                )))
            }
        }
        buf.clear();
    }
    Ok(events)
}

/// Index of the end tag closing the block opened at `start`, or `None` when the
/// document never closes it. Only tags sharing the block's own name move the
/// depth, so unclosed void elements such as `<br>` inside it are harmless.
pub(crate) fn matching_end(events: &[Event<'static>], start: usize) -> Option<usize> {
    let Event::Start(open) = &events[start] else {
        return None;
    };
    let name = local_name(open);
    let mut depth = 0usize;
    for (offset, event) in events.iter().enumerate().skip(start) {
        match event {
            Event::Start(tag) if local_name(tag) == name => depth += 1,
            Event::End(tag)
                if String::from_utf8_lossy(tag.name().as_ref()).to_ascii_lowercase() == name =>
            {
                depth -= 1;
                if depth == 0 {
                    return Some(offset);
                }
            }
            _ => {}
        }
    }
    None
}
