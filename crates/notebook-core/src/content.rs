//! Note content: the HTML a note is stored as, its plain-text projection, and
//! the attachments embedded in it.
//!
//! Split out of `import::enex` so the note read path (`service`, `note_query`,
//! `templates`) no longer depends on the Evernote importer. The dependency now
//! runs the other way: `import::enex` builds on this module.

pub mod attachment;
pub mod checklist;
pub mod entities;
pub mod html;
pub mod plain;

pub use attachment::{basename, default_attachment_name, looks_like_pdf, sniff_mime};
pub use checklist::normalize_evernote_checklist_html;
pub use entities::{decode_xml_entities, decode_xml_entities_once};
pub use html::file_attachment_html;
pub use plain::strip_html;
