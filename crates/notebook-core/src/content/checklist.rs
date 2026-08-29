use std::io::Cursor;

use quick_xml::events::{BytesEnd, Event};
use quick_xml::{Reader, Writer};

use crate::error::{NotebookError, Result};

use super::html::{
    attribute_equals, has_attribute, is_blank_text, is_line_break, local_name, matching_end,
    raw_attribute, read_all_events, style_flag,
};

/// Converts the checklist representation used by current Evernote ENEX files
/// into the semantic attributes consumed by TipTap. This is also used when a
/// note is read so imports made by older Notebook builds are repaired without
/// requiring another import.
pub fn normalize_evernote_checklist_html(html: &str) -> String {
    // Only `<div>` rows are promoted here: the editor always writes paragraphs
    // as `<p>`, so a `<div>` opening with an inline checkbox can only be an
    // untouched Evernote import, never a checkbox the user inserted by hand.
    let repaired = promote_checkbox_blocks(html, &["div"]).unwrap_or_else(|_| html.to_string());

    if !repaired.contains("--en-todo") {
        return repaired;
    }

    try_normalize_evernote_checklist_html(&repaired).unwrap_or(repaired)
}

fn try_normalize_evernote_checklist_html(html: &str) -> Result<String> {
    let mut reader = Reader::from_reader(Cursor::new(html.as_bytes()));
    reader.config_mut().trim_text(false);
    let mut writer = Writer::new(Vec::with_capacity(html.len() + 128));
    let mut buf = Vec::new();
    let mut list_stack = Vec::<bool>::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_ascii_lowercase();
                if name == "ul" || name == "ol" {
                    let is_task = style_flag(&e, &reader, "--en-todo").unwrap_or(false)
                        || attribute_equals(&e, &reader, "data-type", "taskList");
                    list_stack.push(is_task);
                    let mut tag = e.to_owned();
                    if is_task {
                        tag.set_name(b"ul");
                        if !has_attribute(&tag, "data-type") {
                            tag.push_attribute(("data-type", "taskList"));
                        }
                    }
                    writer.write_event(Event::Start(tag)).map_err(|err| {
                        NotebookError::Other(format!("could not normalize checklist: {err}"))
                    })?;
                } else if name == "li" && list_stack.last().copied().unwrap_or(false) {
                    let mut tag = e.to_owned();
                    if !has_attribute(&tag, "data-type") {
                        tag.push_attribute(("data-type", "taskItem"));
                    }
                    if !has_attribute(&tag, "data-checked") {
                        let checked = style_flag(&tag, &reader, "--en-checked").unwrap_or(false);
                        tag.push_attribute((
                            "data-checked",
                            if checked { "true" } else { "false" },
                        ));
                    }
                    writer.write_event(Event::Start(tag)).map_err(|err| {
                        NotebookError::Other(format!("could not normalize checklist: {err}"))
                    })?;
                } else {
                    writer.write_event(Event::Start(e)).map_err(|err| {
                        NotebookError::Other(format!("could not normalize checklist: {err}"))
                    })?;
                }
            }
            Ok(Event::Empty(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_ascii_lowercase();
                let mut tag = e.to_owned();
                if name == "ul" || name == "ol" {
                    let is_task = style_flag(&tag, &reader, "--en-todo").unwrap_or(false)
                        || attribute_equals(&tag, &reader, "data-type", "taskList");
                    if is_task {
                        tag.set_name(b"ul");
                        if !has_attribute(&tag, "data-type") {
                            tag.push_attribute(("data-type", "taskList"));
                        }
                    }
                } else if name == "li" && list_stack.last().copied().unwrap_or(false) {
                    if !has_attribute(&tag, "data-type") {
                        tag.push_attribute(("data-type", "taskItem"));
                    }
                    if !has_attribute(&tag, "data-checked") {
                        let checked = style_flag(&tag, &reader, "--en-checked").unwrap_or(false);
                        tag.push_attribute((
                            "data-checked",
                            if checked { "true" } else { "false" },
                        ));
                    }
                }
                writer.write_event(Event::Empty(tag)).map_err(|err| {
                    NotebookError::Other(format!("could not normalize checklist: {err}"))
                })?;
            }
            Ok(Event::End(e)) => {
                let name = String::from_utf8_lossy(e.name().as_ref()).to_ascii_lowercase();
                if name == "ul" || name == "ol" {
                    let is_task = list_stack.pop().unwrap_or(false);
                    if is_task {
                        writer
                            .write_event(Event::End(BytesEnd::new("ul")))
                            .map_err(|err| {
                                NotebookError::Other(format!(
                                    "could not normalize checklist: {err}"
                                ))
                            })?;
                    } else {
                        writer.write_event(Event::End(e)).map_err(|err| {
                            NotebookError::Other(format!("could not normalize checklist: {err}"))
                        })?;
                    }
                } else {
                    writer.write_event(Event::End(e)).map_err(|err| {
                        NotebookError::Other(format!("could not normalize checklist: {err}"))
                    })?;
                }
            }
            Ok(Event::Eof) => break,
            Ok(event) => writer.write_event(event).map_err(|err| {
                NotebookError::Other(format!("could not normalize checklist: {err}"))
            })?,
            Err(err) => {
                return Err(NotebookError::Other(format!(
                    "could not parse imported checklist HTML: {err}"
                )))
            }
        }
        buf.clear();
    }

    String::from_utf8(writer.into_inner())
        .map_err(|err| NotebookError::Other(format!("invalid normalized checklist HTML: {err}")))
}

struct CheckboxBlock {
    checked: bool,
    content: Vec<Event<'static>>,
    next_index: usize,
}

fn is_inline_checkbox(event: &Event<'_>) -> Option<bool> {
    let tag = match event {
        Event::Start(tag) | Event::Empty(tag) => tag,
        _ => return None,
    };
    if local_name(tag) != "input" || !has_attribute(tag, "data-inline-checkbox") {
        return None;
    }
    Some(
        raw_attribute(tag, "data-checked")
            .map(|value| value.eq_ignore_ascii_case("true"))
            .unwrap_or(false),
    )
}

/// Reads one `<div><en-todo/>text</div>`-shaped checklist row starting at
/// `start`, returning its checked state and the row's content events.
fn parse_checkbox_block(
    events: &[Event<'static>],
    start: usize,
    block_tags: &[&str],
) -> Option<CheckboxBlock> {
    let Event::Start(open) = events.get(start)? else {
        return None;
    };
    if !block_tags.contains(&local_name(open).as_str()) {
        return None;
    }

    let end = matching_end(events, start)?;
    let mut cursor = start + 1;
    while cursor < end && is_blank_text(&events[cursor]) {
        cursor += 1;
    }
    let checked = is_inline_checkbox(events.get(cursor)?)?;

    let mut content_end = end;
    // Evernote pads each row with a trailing <br/>; keeping it would add an
    // empty second line inside the task item.
    while content_end > cursor + 1
        && (is_blank_text(&events[content_end - 1]) || is_line_break(&events[content_end - 1]))
    {
        content_end -= 1;
    }

    Some(CheckboxBlock {
        checked,
        content: events[cursor + 1..content_end].to_vec(),
        next_index: end + 1,
    })
}

/// Evernote's classic checklists are exported as a run of sibling blocks that
/// each open with an `<en-todo/>`, not as a list. Imported literally they become
/// inline checkboxes inside paragraphs, which sit at a different indent from
/// real checklists and lose the hanging indent on wrapped rows. Promote each run
/// into a single task list so it matches checklists made in the app.
pub(crate) fn promote_checkbox_blocks(html: &str, block_tags: &[&str]) -> Result<String> {
    if !html.contains("data-inline-checkbox") {
        return Ok(html.to_string());
    }

    let events = read_all_events(html)?;
    let mut writer = Writer::new(Vec::with_capacity(html.len()));
    let mut index = 0usize;

    let write = |writer: &mut Writer<Vec<u8>>, event: &Event<'static>| -> Result<()> {
        writer
            .write_event(event.clone())
            .map_err(|err| NotebookError::Other(format!("could not rewrite checklist HTML: {err}")))
    };

    while index < events.len() {
        let Some(first) = parse_checkbox_block(&events, index, block_tags) else {
            write(&mut writer, &events[index])?;
            index += 1;
            continue;
        };

        let mut rows = vec![first];
        loop {
            let mut cursor = rows[rows.len() - 1].next_index;
            while cursor < events.len() && is_blank_text(&events[cursor]) {
                cursor += 1;
            }
            match parse_checkbox_block(&events, cursor, block_tags) {
                Some(row) => rows.push(row),
                None => break,
            }
        }

        index = rows[rows.len() - 1].next_index;
        let mut list = quick_xml::events::BytesStart::new("ul");
        list.push_attribute(("data-type", "taskList"));
        write(&mut writer, &Event::Start(list.into_owned()))?;
        for row in &rows {
            let mut item = quick_xml::events::BytesStart::new("li");
            item.push_attribute(("data-type", "taskItem"));
            item.push_attribute(("data-checked", if row.checked { "true" } else { "false" }));
            write(&mut writer, &Event::Start(item.into_owned()))?;
            for event in &row.content {
                write(&mut writer, event)?;
            }
            write(&mut writer, &Event::End(BytesEnd::new("li")))?;
        }
        write(&mut writer, &Event::End(BytesEnd::new("ul")))?;
    }

    String::from_utf8(writer.into_inner())
        .map_err(|err| NotebookError::Other(format!("invalid rewritten checklist HTML: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repairs_inline_checkbox_divs_from_older_imports() {
        let stored = r#"<div><div><input type="checkbox" data-inline-checkbox="true" data-checked="false" />Wetsuit<br/></div><div><input type="checkbox" data-inline-checkbox="true" data-checked="true" checked="checked" />Boots</div></div>"#;
        let repaired = normalize_evernote_checklist_html(stored);
        assert_eq!(
            repaired.matches("<ul data-type=\"taskList\">").count(),
            1,
            "got: {repaired}"
        );
        assert!(
            repaired.contains("<li data-type=\"taskItem\" data-checked=\"true\">Boots</li>"),
            "got: {repaired}"
        );
        assert_eq!(normalize_evernote_checklist_html(&repaired), repaired);
    }

    #[test]
    fn read_time_repair_leaves_ordinary_notes_byte_identical() {
        // The repair now runs over any note holding an inline checkbox, so its
        // XML round-trip must not disturb void tags, entities, or block wrappers.
        for case in [
            r#"<p>Line one<br>Line two</p><p><img src="notebook-attachment://a.png"></p><p>A &amp; B &lt;tag&gt; &quot;q&quot;</p><p>Deposit <input type="checkbox" data-inline-checkbox="true" data-checked="true" checked="checked"> cleared</p><hr><table><tr><td>x</td></tr></table>"#,
            r#"<div data-notebook-file="true" data-href="x" class="notebook-file is-title"><a href="x">f.pdf</a></div><p><input type="checkbox" data-inline-checkbox="true" data-checked="false">a</p>"#,
            r#"<ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Native</p></li></ul><p>x <input type="checkbox" data-inline-checkbox="true" data-checked="false"> y</p>"#,
        ] {
            assert_eq!(normalize_evernote_checklist_html(case), case);
        }
    }

    #[test]
    fn leaves_editor_authored_inline_checkboxes_alone() {
        // The editor only ever writes paragraphs as <p>, so a leading inline
        // checkbox there was inserted by hand and must not become a task list.
        let authored = r#"<p><input type="checkbox" data-inline-checkbox="true" data-checked="false">Hand written</p>"#;
        assert_eq!(normalize_evernote_checklist_html(authored), authored);
    }

    #[test]
    fn normalizes_style_checklists_from_older_imports_without_losing_html() {
        let legacy = r#"<div><ul style="--en-todo:true;"><li style="--en-checked:true;"><div>Done</div></li><li style="--en-checked:false;"><div>Next</div></li></ul><ul><li>Real bullet</li></ul><img src="data:image/png;base64,AA==" /></div>"#;
        let normalized = normalize_evernote_checklist_html(legacy);
        assert!(normalized.contains("<ul style=\"--en-todo:true;\" data-type=\"taskList\">"));
        assert!(normalized.contains("data-type=\"taskItem\" data-checked=\"true\""));
        assert!(normalized.contains("data-type=\"taskItem\" data-checked=\"false\""));
        assert!(normalized.contains("<ul><li>Real bullet</li></ul>"));
        assert!(normalized.contains("<img src=\"data:image/png;base64,AA==\""));
        assert_eq!(normalize_evernote_checklist_html(&normalized), normalized);
    }
}
