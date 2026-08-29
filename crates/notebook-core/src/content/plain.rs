pub fn strip_html(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut in_tag = false;
    let mut tag = String::new();
    for ch in html.chars() {
        match ch {
            '<' => {
                in_tag = true;
                tag.clear();
            }
            '>' if in_tag => {
                in_tag = false;
                let name = tag
                    .trim_start_matches('/')
                    .split(|ch: char| ch.is_whitespace() || ch == '/')
                    .next()
                    .unwrap_or_default()
                    .to_ascii_lowercase();
                if matches!(
                    name.as_str(),
                    "address"
                        | "article"
                        | "aside"
                        | "blockquote"
                        | "br"
                        | "div"
                        | "figcaption"
                        | "figure"
                        | "footer"
                        | "h1"
                        | "h2"
                        | "h3"
                        | "h4"
                        | "h5"
                        | "h6"
                        | "header"
                        | "li"
                        | "main"
                        | "nav"
                        | "ol"
                        | "p"
                        | "pre"
                        | "section"
                        | "table"
                        | "td"
                        | "th"
                        | "tr"
                        | "ul"
                ) && out.chars().last().is_some_and(|last| !last.is_whitespace())
                {
                    out.push(' ');
                }
            }
            _ if in_tag => tag.push(ch),
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    let normalized = out.split_whitespace().collect::<Vec<_>>().join(" ");
    quick_xml::escape::unescape(&normalized)
        .map(|text| text.into_owned())
        .unwrap_or(normalized)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_text_keeps_rich_text_blocks_readable() {
        assert_eq!(
            strip_html(
                "<h2>Launch checklist</h2><p>James&apos;s notes.</p><ul><li>Confirm</li><li>Send</li></ul>"
            ),
            "Launch checklist James's notes. Confirm Send"
        );
        assert_eq!(
            strip_html("<p>Ever<b>note</b> &amp; Notebook</p>"),
            "Evernote & Notebook"
        );
    }
}
