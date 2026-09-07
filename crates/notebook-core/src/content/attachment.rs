pub fn normalize_mime(mime: &str) -> String {
    mime.split(';')
        .next()
        .unwrap_or(mime)
        .trim()
        .to_ascii_lowercase()
}

pub fn looks_like_pdf(mime: &str, filename: Option<&str>, data: &[u8]) -> bool {
    let mime = normalize_mime(mime);
    mime == "application/pdf"
        || mime == "application/x-pdf"
        || filename
            .map(|name| basename(name).to_ascii_lowercase().ends_with(".pdf"))
            .unwrap_or(false)
        || data.starts_with(b"%PDF")
}

/// Pick a usable MIME type from the ENEX resource: declared type, then magic
/// bytes, then filename extension. Evernote often ships files as
/// `application/octet-stream` with the real type only in the name or bytes.
pub fn sniff_mime(mime: &str, filename: Option<&str>, data: &[u8]) -> String {
    if looks_like_pdf(mime, filename, data) {
        return "application/pdf".into();
    }
    let mime = normalize_mime(mime);
    if !mime.is_empty() && mime != "application/octet-stream" {
        return mime;
    }
    if let Some(from_bytes) = mime_from_magic(data, filename) {
        return from_bytes;
    }
    if let Some(from_name) = filename.and_then(mime_from_filename) {
        return from_name;
    }
    if mime.is_empty() {
        "application/octet-stream".into()
    } else {
        mime
    }
}

pub fn basename(name: &str) -> &str {
    name.rsplit(['/', '\\'])
        .next()
        .map(str::trim)
        .filter(|part| !part.is_empty() && *part != "." && *part != "..")
        .unwrap_or(name)
}

pub fn default_attachment_name(mime: &str) -> String {
    let mime = normalize_mime(mime);
    match mime.as_str() {
        "image/png" => "image.png".into(),
        "image/jpeg" | "image/jpg" => "image.jpeg".into(),
        "image/gif" => "image.gif".into(),
        "image/webp" => "image.webp".into(),
        "image/svg+xml" => "image.svg".into(),
        "image/heic" | "image/heif" => "image.heic".into(),
        "audio/mpeg" | "audio/mp3" => "audio.mp3".into(),
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" => "audio.m4a".into(),
        "audio/wav" | "audio/x-wav" | "audio/wave" => "audio.wav".into(),
        "audio/amr" => "audio.amr".into(),
        "audio/ogg" => "audio.ogg".into(),
        "video/mp4" => "video.mp4".into(),
        "video/quicktime" => "video.mov".into(),
        "video/webm" => "video.webm".into(),
        "application/pdf" | "application/x-pdf" => "document.pdf".into(),
        "application/msword" => "document.doc".into(),
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => {
            "document.docx".into()
        }
        "application/vnd.ms-excel" => "spreadsheet.xls".into(),
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" => {
            "spreadsheet.xlsx".into()
        }
        "application/vnd.ms-powerpoint" => "presentation.ppt".into(),
        "application/vnd.openxmlformats-officedocument.presentationml.presentation" => {
            "presentation.pptx".into()
        }
        "application/zip" => "archive.zip".into(),
        "text/plain" => "note.txt".into(),
        "text/html" => "page.html".into(),
        "text/csv" => "data.csv".into(),
        _ if mime.starts_with("image/") => "image".into(),
        _ if mime.starts_with("audio/") => "audio".into(),
        _ if mime.starts_with("video/") => "video".into(),
        _ => "attachment".into(),
    }
}

fn mime_from_magic(data: &[u8], filename: Option<&str>) -> Option<String> {
    if data.starts_with(b"\x89PNG") {
        return Some("image/png".into());
    }
    if data.len() >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF {
        return Some("image/jpeg".into());
    }
    if data.starts_with(b"GIF8") {
        return Some("image/gif".into());
    }
    if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
        return Some("image/webp".into());
    }
    if data.starts_with(b"%PDF") {
        return Some("application/pdf".into());
    }
    if data.starts_with(b"ID3")
        || (data.len() >= 2 && data[0] == 0xFF && (data[1] == 0xFB || data[1] == 0xF3 || data[1] == 0xF2))
    {
        return Some("audio/mpeg".into());
    }
    if data.len() >= 12 && &data[4..8] == b"ftyp" {
        let brand = &data[8..12];
        if brand.starts_with(b"M4A") || brand == b"M4B " {
            return Some("audio/mp4".into());
        }
        if brand == b"qt  " {
            return Some("video/quicktime".into());
        }
        return Some("video/mp4".into());
    }
    if data.starts_with(b"PK") {
        if let Some(mime) = filename.and_then(office_mime_from_filename) {
            return Some(mime);
        }
        return Some("application/zip".into());
    }
    None
}

fn mime_from_filename(name: &str) -> Option<String> {
    let ext = basename(name)
        .rsplit('.')
        .next()?
        .to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png".into(),
        "jpg" | "jpeg" => "image/jpeg".into(),
        "gif" => "image/gif".into(),
        "webp" => "image/webp".into(),
        "svg" => "image/svg+xml".into(),
        "heic" | "heif" => "image/heic".into(),
        "mp3" => "audio/mpeg".into(),
        "wav" => "audio/wav".into(),
        "m4a" => "audio/mp4".into(),
        "aac" => "audio/aac".into(),
        "ogg" => "audio/ogg".into(),
        "amr" => "audio/amr".into(),
        "mp4" => "video/mp4".into(),
        "mov" => "video/quicktime".into(),
        "webm" => "video/webm".into(),
        "mkv" => "video/x-matroska".into(),
        "pdf" => "application/pdf".into(),
        "doc" => "application/msword".into(),
        "docx" => {
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into()
        }
        "xls" => "application/vnd.ms-excel".into(),
        "xlsx" => "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(),
        "ppt" => "application/vnd.ms-powerpoint".into(),
        "pptx" => {
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into()
        }
        "zip" => "application/zip".into(),
        "txt" => "text/plain".into(),
        "html" | "htm" => "text/html".into(),
        "csv" => "text/csv".into(),
        _ => return None,
    })
}

fn office_mime_from_filename(name: &str) -> Option<String> {
    let ext = basename(name).rsplit('.').next()?.to_ascii_lowercase();
    match ext.as_str() {
        "docx" => Some(
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document".into(),
        ),
        "xlsx" => Some("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into()),
        "pptx" => Some(
            "application/vnd.openxmlformats-officedocument.presentationml.presentation".into(),
        ),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_pdf_mime_type() {
        assert!(looks_like_pdf("application/pdf", None, &[]));
    }

    #[test]
    fn recognizes_x_pdf_mime_type() {
        assert!(looks_like_pdf("application/x-pdf", None, &[]));
    }

    #[test]
    fn recognizes_pdf_filename_extension_case_insensitively() {
        assert!(looks_like_pdf(
            "application/octet-stream",
            Some("scan.PDF"),
            &[]
        ));
    }

    #[test]
    fn recognizes_pdf_magic_bytes_with_empty_mime() {
        assert!(looks_like_pdf("", None, b"%PDF-1.4"));
    }

    #[test]
    fn handles_missing_filename() {
        assert!(looks_like_pdf("application/pdf", None, &[]));
    }

    #[test]
    fn rejects_non_pdf_image() {
        assert!(!looks_like_pdf("image/png", Some("a.png"), b"\x89PNG"));
    }

    #[test]
    fn strips_mime_parameters_before_matching_pdf() {
        assert!(looks_like_pdf("application/pdf; charset=binary", None, &[]));
        assert_eq!(
            sniff_mime("application/pdf; charset=binary", None, &[]),
            "application/pdf"
        );
    }

    #[test]
    fn sniffs_png_magic_when_mime_is_octet_stream() {
        let mut data = b"\x89PNG\r\n\x1a\n".to_vec();
        data.extend_from_slice(&[0; 8]);
        assert_eq!(
            sniff_mime("application/octet-stream", None, &data),
            "image/png"
        );
    }

    #[test]
    fn sniffs_docx_from_zip_magic_and_filename() {
        assert_eq!(
            sniff_mime("application/octet-stream", Some("brief.docx"), b"PK\x03\x04rest"),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
    }

    #[test]
    fn takes_basename_from_windows_path() {
        assert_eq!(basename(r"C:\Users\x\photo.png"), "photo.png");
        assert_eq!(basename("/tmp/audio.m4a"), "audio.m4a");
    }

    #[test]
    fn default_names_follow_mime() {
        assert_eq!(default_attachment_name("audio/mpeg"), "audio.mp3");
        assert_eq!(default_attachment_name("image/png"), "image.png");
        assert_eq!(default_attachment_name("application/pdf"), "document.pdf");
        assert_eq!(default_attachment_name("text/plain"), "note.txt");
    }
}
