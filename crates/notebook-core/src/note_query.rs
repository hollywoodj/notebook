use std::collections::HashMap;

use rusqlite::{params, Connection, Row};
use uuid::Uuid;

use crate::datetime::{optional_dt, parse_dt};
use crate::error::Result;
use crate::models::NoteSummary;

const SUMMARY_SELECT: &str = "SELECT n.id, n.notebook_id, n.title, n.content_plain, n.is_pinned, n.is_archived, n.reminder_at, n.created_at, n.updated_at,
             (SELECT COUNT(*) FROM attachments a WHERE a.note_id = n.id) as attachment_count,
             n.is_template, n.template_category, nb.name, n.content,
             (SELECT a.id FROM attachments a WHERE a.note_id = n.id AND a.mime_type LIKE 'image/%' ORDER BY a.created_at LIMIT 1) as thumbnail_attachment_id
             FROM notes n JOIN notebooks nb ON nb.id = n.notebook_id";

pub struct NoteListFilter {
    pub user_id: Uuid,
    pub notebook_id: Option<Uuid>,
    pub tag_id: Option<Uuid>,
    pub trash: bool,
    pub archived: Option<bool>,
    pub templates: Option<bool>,
}

struct SummaryRow {
    id: Uuid,
    notebook_id: Uuid,
    title: String,
    snippet: String,
    is_pinned: bool,
    is_archived: bool,
    reminder: Option<String>,
    created: String,
    updated: String,
    attachment_count: i32,
    is_template: bool,
    template_category: Option<String>,
    notebook_name: String,
    thumbnail_url: Option<String>,
    checklist_done: i32,
    checklist_total: i32,
}

impl SummaryRow {
    fn from_sql(row: &Row<'_>) -> rusqlite::Result<Self> {
        let content_plain: String = row.get(3)?;
        let snippet: String = content_plain.chars().take(200).collect();
        let content: String = row.get(13)?;
        let (checklist_done, checklist_total) = checklist_progress(&content);
        Ok(Self {
            id: Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
            notebook_id: Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
            title: row.get(2)?,
            snippet,
            is_pinned: row.get::<_, i32>(4)? != 0,
            is_archived: row.get::<_, i32>(5)? != 0,
            reminder: row.get(6)?,
            created: row.get(7)?,
            updated: row.get(8)?,
            attachment_count: row.get(9)?,
            is_template: row.get::<_, i32>(10)? != 0,
            template_category: row.get(11)?,
            notebook_name: row.get(12)?,
            thumbnail_url: resolve_thumbnail(row.get::<_, Option<String>>(14)?, &content),
            checklist_done,
            checklist_total,
        })
    }
}

pub fn first_image_src(content: &str) -> Option<String> {
    let lower = content.to_ascii_lowercase();
    let mut from = 0;
    while let Some(rel) = lower[from..].find("<img") {
        let start = from + rel;
        let rest = &content[start..];
        let rest_lower = rest.to_ascii_lowercase();
        if let Some(src_rel) = rest_lower.find("src=") {
            let after = rest[src_rel + 4..].trim_start();
            let quote = after.chars().next().unwrap_or('\0');
            if quote == '"' || quote == '\'' {
                if let Some(end) = after[1..].find(quote) {
                    let src = after[1..1 + end].trim();
                    if !src.is_empty() {
                        return Some(src.to_string());
                    }
                }
            }
        }
        from = start + 4;
        if from >= content.len() {
            break;
        }
    }
    None
}

pub fn checklist_progress(content: &str) -> (i32, i32) {
    let task_total = content.matches("data-type=\"taskItem\"").count()
        + content.matches("data-type='taskItem'").count();
    let inline_total = content.matches("data-inline-checkbox").count();
    let total = (task_total + inline_total) as i32;
    if total == 0 {
        return (0, 0);
    }
    let done = (content.matches("data-checked=\"true\"").count()
        + content.matches("data-checked='true'").count()) as i32;
    (done.min(total), total)
}

fn resolve_thumbnail(attachment_id: Option<String>, content: &str) -> Option<String> {
    if let Some(id) = attachment_id.filter(|value| !value.is_empty()) {
        return Some(id);
    }
    first_image_src(content)
}

pub fn list_summaries(conn: &Connection, filter: NoteListFilter) -> Result<Vec<NoteSummary>> {
    let mut sql = String::from(SUMMARY_SELECT);
    let mut conditions = vec!["n.user_id = ?1".to_string()];
    if filter.trash {
        conditions.push("n.deleted_at IS NOT NULL".to_string());
    } else {
        conditions.push("n.deleted_at IS NULL".to_string());
    }
    if let Some(nb) = filter.notebook_id {
        conditions.push(format!("n.notebook_id = '{nb}'"));
    }
    if let Some(tag) = filter.tag_id {
        sql.push_str(" JOIN note_tags nt ON nt.note_id = n.id");
        conditions.push(format!("nt.tag_id = '{tag}'"));
    }
    if let Some(arch) = filter.archived {
        conditions.push(format!("n.is_archived = {}", if arch { 1 } else { 0 }));
    }
    match filter.templates {
        Some(is_template) => conditions.push(format!(
            "COALESCE(n.is_template, 0) = {}",
            if is_template { 1 } else { 0 }
        )),
        None if !filter.trash => {
            conditions.push("COALESCE(n.is_template, 0) = 0".to_string());
        }
        None => {}
    }
    sql.push_str(" WHERE ");
    sql.push_str(&conditions.join(" AND "));
    sql.push_str(" ORDER BY n.is_pinned DESC, n.updated_at DESC");

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![filter.user_id.to_string()], SummaryRow::from_sql)?;
    let collected = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    hydrate_summaries(conn, collected)
}

pub fn summaries_by_ids(
    conn: &Connection,
    ids: &[Uuid],
    exclude_deleted: bool,
) -> Result<Vec<NoteSummary>> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let deleted_clause = if exclude_deleted {
        " AND n.deleted_at IS NULL"
    } else {
        ""
    };
    let sql = format!("{SUMMARY_SELECT} WHERE n.id IN ({placeholders}){deleted_clause}");
    let params: Vec<String> = ids.iter().map(|id| id.to_string()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(params.iter()),
        SummaryRow::from_sql,
    )?;
    let collected = rows.collect::<std::result::Result<Vec<_>, _>>()?;
    let mut by_id = hydrate_summaries(conn, collected)?
        .into_iter()
        .map(|note| (note.id, note))
        .collect::<HashMap<_, _>>();

    Ok(ids.iter().filter_map(|id| by_id.remove(id)).collect())
}

pub fn tags_for_notes(
    conn: &Connection,
    note_ids: &[Uuid],
) -> Result<HashMap<Uuid, (Vec<Uuid>, Vec<String>)>> {
    let mut grouped: HashMap<Uuid, (Vec<Uuid>, Vec<String>)> = HashMap::new();
    if note_ids.is_empty() {
        return Ok(grouped);
    }

    let placeholders = note_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT nt.note_id, t.id, t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id IN ({placeholders}) ORDER BY t.name"
    );
    let params: Vec<String> = note_ids.iter().map(|id| id.to_string()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |row| {
        Ok((
            Uuid::parse_str(&row.get::<_, String>(0)?).unwrap(),
            Uuid::parse_str(&row.get::<_, String>(1)?).unwrap(),
            row.get::<_, String>(2)?,
        ))
    })?;
    for row in rows {
        let (note_id, tag_id, name) = row?;
        let entry = grouped.entry(note_id).or_default();
        entry.0.push(tag_id);
        entry.1.push(name);
    }
    Ok(grouped)
}

fn hydrate_summaries(conn: &Connection, rows: Vec<SummaryRow>) -> Result<Vec<NoteSummary>> {
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let mut tags = tags_for_notes(conn, &ids)?;
    rows.into_iter()
        .map(|row| {
            let (tag_ids, tag_names) = tags.remove(&row.id).unwrap_or_default();
            Ok(NoteSummary {
                id: row.id,
                notebook_id: row.notebook_id,
                title: row.title,
                snippet: row.snippet,
                is_pinned: row.is_pinned,
                is_archived: row.is_archived,
                reminder_at: optional_dt(row.reminder)?,
                tag_ids,
                tag_names,
                attachment_count: row.attachment_count,
                is_template: row.is_template,
                template_category: row.template_category,
                notebook_name: row.notebook_name,
                thumbnail_url: row.thumbnail_url,
                checklist_done: row.checklist_done,
                checklist_total: row.checklist_total,
                created_at: parse_dt(&row.created)?,
                updated_at: parse_dt(&row.updated)?,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{checklist_progress, first_image_src, resolve_thumbnail};

    #[test]
    fn first_image_src_reads_quoted_html() {
        assert_eq!(
            first_image_src(r#"<p>Hi</p><img alt="x" src="https://cdn.example/pic.png">"#)
                .as_deref(),
            Some("https://cdn.example/pic.png")
        );
        assert_eq!(first_image_src("<p>none</p>"), None);
    }

    #[test]
    fn checklist_progress_counts_task_items_and_inline_boxes() {
        let html = r#"<ul data-type="taskList"><li data-type="taskItem" data-checked="true">a</li><li data-type="taskItem" data-checked="false">b</li></ul><input data-inline-checkbox="true" data-checked="true">"#;
        assert_eq!(checklist_progress(html), (2, 3));
        assert_eq!(checklist_progress("<p>plain</p>"), (0, 0));
    }

    #[test]
    fn resolve_thumbnail_prefers_an_image_attachment() {
        assert_eq!(
            resolve_thumbnail(Some("att-1".into()), r#"<img src="https://x/y.png">"#).as_deref(),
            Some("att-1")
        );
        assert_eq!(
            resolve_thumbnail(None, r#"<img src="https://x/y.png">"#).as_deref(),
            Some("https://x/y.png")
        );
    }
}
