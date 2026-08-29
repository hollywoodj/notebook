pub fn looks_like_pdf(mime: &str, filename: Option<&str>, data: &[u8]) -> bool {
    let mime = mime.to_ascii_lowercase();
    mime == "application/pdf"
        || mime == "application/x-pdf"
        || filename
            .map(|name| name.to_ascii_lowercase().ends_with(".pdf"))
            .unwrap_or(false)
        || data.starts_with(b"%PDF")
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
}
