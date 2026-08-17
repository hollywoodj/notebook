use chrono::{DateTime, Utc};

use crate::error::{NotebookError, Result};

pub fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

pub fn parse_dt(s: &str) -> Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s)
        .map(|dt| dt.with_timezone(&Utc))
        .map_err(|e| NotebookError::Other(e.to_string()))
}

pub fn optional_dt(s: Option<String>) -> Result<Option<DateTime<Utc>>> {
    s.map(|v| parse_dt(&v)).transpose()
}
