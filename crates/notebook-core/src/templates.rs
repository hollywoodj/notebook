use rusqlite::{params, Connection};
use uuid::Uuid;

use crate::error::Result;

struct BuiltinTemplate {
    key: &'static str,
    title: &'static str,
    category: &'static str,
    description: &'static str,
    content: &'static str,
}

const BUILTINS: &[BuiltinTemplate] = &[
    BuiltinTemplate {
        key: "meeting-notes",
        title: "Meeting notes",
        category: "Meetings",
        description: "Agenda, attendees, notes, and action items",
        content: r#"<h2>Meeting details</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Date:</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Time:</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Location / link:</p></div></li></ul><h2>Attendees</h2><ul><li></li></ul><h2>Agenda</h2><ol><li></li></ol><h2>Notes</h2><p></p><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
    BuiltinTemplate {
        key: "one-on-one",
        title: "1:1 meeting",
        category: "Meetings",
        description: "Talking points, feedback, and follow-ups",
        content: r#"<h2>1:1</h2><p><strong>With:</strong></p><p><strong>Date:</strong></p><h2>Wins since last time</h2><ul><li></li></ul><h2>Talking points</h2><ul><li></li></ul><h2>Feedback</h2><h3>For them</h3><ul><li></li></ul><h3>For me</h3><ul><li></li></ul><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
    BuiltinTemplate {
        key: "weekly-planner",
        title: "Weekly planner",
        category: "Work",
        description: "Priorities, schedule, and weekly review",
        content: r#"<h2>Week of</h2><p></p><h2>Top 3 priorities</h2><ol><li></li><li></li><li></li></ol><h2>Monday</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Tuesday</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Wednesday</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Thursday</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Friday</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Review</h2><p>What went well?</p><p>What could improve?</p>"#,
    },
    BuiltinTemplate {
        key: "project-tracker",
        title: "Project tracker",
        category: "Project management",
        description: "Goals, milestones, risks, and status",
        content: r#"<h2>Project</h2><p><strong>Owner:</strong></p><p><strong>Status:</strong> Not started</p><p><strong>Target date:</strong></p><h2>Goal</h2><p></p><h2>Milestones</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Tasks</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Risks &amp; blockers</h2><ul><li></li></ul><h2>Notes</h2><p></p>"#,
    },
    BuiltinTemplate {
        key: "todo-list",
        title: "To-do list",
        category: "Work",
        description: "Simple checklist with must-do and later",
        content: r#"<h2>Must do today</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>If there's time</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>Waiting on</h2><ul><li></li></ul>"#,
    },
    BuiltinTemplate {
        key: "brainstorm",
        title: "Brainstorm",
        category: "Work",
        description: "Capture ideas, then sort and decide",
        content: r#"<h2>Prompt</h2><p></p><h2>Wild ideas</h2><ul><li></li></ul><h2>Promising</h2><ul><li></li></ul><h2>Next steps</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
    BuiltinTemplate {
        key: "decision-log",
        title: "Decision log",
        category: "Work",
        description: "Context, options, decision, and follow-up",
        content: r#"<h2>Decision</h2><p></p><h2>Context</h2><p></p><h2>Options considered</h2><ol><li></li></ol><h2>Decision</h2><p></p><h2>Why</h2><p></p><h2>Follow-up</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
    BuiltinTemplate {
        key: "daily-journal",
        title: "Daily journal",
        category: "Personal",
        description: "Gratitude, highlights, and reflection",
        content: r#"<h2>Today</h2><p></p><h2>Grateful for</h2><ul><li></li></ul><h2>Highlights</h2><ul><li></li></ul><h2>What was hard</h2><p></p><h2>Tomorrow</h2><ul><li></li></ul>"#,
    },
    BuiltinTemplate {
        key: "habit-tracker",
        title: "Habit tracker",
        category: "Personal",
        description: "Weekly habits and notes",
        content: r#"<h2>Week of</h2><p></p><h2>Habits</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Move / exercise</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Read</p></div></li><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>Sleep by 11</p></div></li></ul><h2>Notes</h2><p></p>"#,
    },
    BuiltinTemplate {
        key: "recipe",
        title: "Recipe",
        category: "Personal",
        description: "Ingredients, steps, and notes",
        content: r#"<h2>Recipe</h2><p><strong>Servings:</strong></p><p><strong>Time:</strong></p><h2>Ingredients</h2><ul><li></li></ul><h2>Steps</h2><ol><li></li></ol><h2>Notes</h2><p></p>"#,
    },
    BuiltinTemplate {
        key: "travel-itinerary",
        title: "Travel itinerary",
        category: "Personal",
        description: "Flights, stays, and a day-by-day plan",
        content: r#"<h2>Trip</h2><p><strong>Dates:</strong></p><p><strong>Destination:</strong></p><h2>Bookings</h2><ul><li>Flights:</li><li>Stay:</li></ul><h2>Day 1</h2><ul><li></li></ul><h2>Packing</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
    BuiltinTemplate {
        key: "cornell-notes",
        title: "Cornell notes",
        category: "Education",
        description: "Cues, notes, and summary",
        content: r#"<h2>Topic</h2><p></p><h2>Cues</h2><ul><li></li></ul><h2>Notes</h2><p></p><h2>Summary</h2><p></p>"#,
    },
    BuiltinTemplate {
        key: "class-notes",
        title: "Class notes",
        category: "Education",
        description: "Lecture notes with questions and homework",
        content: r#"<h2>Class</h2><p><strong>Date:</strong></p><p><strong>Topic:</strong></p><h2>Notes</h2><p></p><h2>Questions</h2><ul><li></li></ul><h2>Homework</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
    BuiltinTemplate {
        key: "book-notes",
        title: "Book notes",
        category: "Education",
        description: "Highlights, quotes, and takeaways",
        content: r#"<h2>Book</h2><p><strong>Author:</strong></p><p><strong>Finished:</strong></p><h2>Summary</h2><p></p><h2>Highlights</h2><blockquote><p></p></blockquote><h2>Takeaways</h2><ul><li></li></ul>"#,
    },
    BuiltinTemplate {
        key: "goal-tracker",
        title: "Goal tracker",
        category: "Personal",
        description: "Outcome, milestones, and weekly check-in",
        content: r#"<h2>Goal</h2><p></p><h2>Why it matters</h2><p></p><h2>Milestones</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul><h2>This week</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p></p></div></li></ul>"#,
    },
];

pub fn builtin_template_catalog() -> Vec<serde_json::Value> {
    BUILTINS
        .iter()
        .map(|t| {
            serde_json::json!({
                "key": t.key,
                "title": t.title,
                "category": t.category,
                "description": t.description,
            })
        })
        .collect()
}

pub fn seed_builtin_templates(
    conn: &Connection,
    user_id: Uuid,
    notebook_id: Uuid,
) -> Result<u32> {
    let mut inserted = 0u32;
    let now = chrono::Utc::now().to_rfc3339();
    for tmpl in BUILTINS {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM notes WHERE user_id = ?1 AND template_key = ?2",
            params![user_id.to_string(), tmpl.key],
            |row| row.get(0),
        )?;
        if exists > 0 {
            continue;
        }
        let id = Uuid::new_v4();
        let plain = strip_html(tmpl.content);
        conn.execute(
            "INSERT INTO notes (id, user_id, notebook_id, title, content, content_plain, is_pinned, is_archived, is_template, template_category, template_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0, 0, 1, ?7, ?8, ?9, ?10)",
            params![
                id.to_string(),
                user_id.to_string(),
                notebook_id.to_string(),
                tmpl.title,
                tmpl.content,
                plain,
                tmpl.category,
                tmpl.key,
                now,
                now
            ],
        )?;
        inserted += 1;
    }
    Ok(inserted)
}

fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn default_preferences() -> serde_json::Value {
    serde_json::json!({
        "theme": "light",
        "startup_view": "all",
        "confirm_delete": true,
        "spell_check": true,
        "date_format": "medium",
        "week_starts_on": "sunday",
        "note_width": "readable",
        "font_family": "default",
        "font_size": 16,
        "show_snippets": true,
        "list_density": "comfortable",
        "sort_by": "updated",
        "new_note_behavior": "blank",
        "auto_save_ms": 600,
        "show_shortcuts": true,
        "show_notebooks": true,
        "show_tags": true,
        "show_templates": true,
        "show_trash": true,
        "show_import": true,
        "default_notebook_id": null
    })
}
