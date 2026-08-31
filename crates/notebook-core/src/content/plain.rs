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
    // Decode before collapsing whitespace, not after: `&nbsp;` decodes to
    // U+00A0, which IS whitespace, so decoding second leaves it sitting in the
    // text. Not `quick_xml::escape::unescape` either - that returns Err for an
    // entity it does not know, and the old fallback then returned the string
    // with NOTHING decoded, so one `&nbsp;` left every `&amp;` in the note
    // untouched in the search index.
    let decoded = super::decode_xml_entities(&out);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
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

        // quick_xml's unescape fails the whole string on an entity it does not
        // know, and the old fallback then decoded nothing at all. Evernote HTML
        // is full of `&nbsp;`, so this case is the common one, not the edge.
        assert_eq!(
            strip_html("<p>Tasks&nbsp;&amp;&nbsp;notes</p>"),
            "Tasks & notes"
        );
        assert_eq!(strip_html("<p>50&#37; done &#x2713;</p>"), "50% done \u{2713}");
        assert_eq!(
            strip_html("<p>Bare &amp and &unknown; stay</p>"),
            "Bare &amp and &unknown; stay"
        );
    }
}
