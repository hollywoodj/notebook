//! XML/HTML character entity decoding.
//!
//! Lifted out of `import::enex` so the plain-text projection can decode
//! entities without the note read path depending on the Evernote importer -
//! the same one-way rule the rest of this module follows.
//!
//! This is deliberately not `quick_xml::escape::unescape`, which fails the
//! whole string on an entity it does not know. Evernote HTML is full of
//! `&nbsp;`, and an all-or-nothing decoder means one `&nbsp;` leaves every
//! other entity in the note undecoded.

/// Decode XML/HTML named and numeric character entities.
///
/// Evernote ENML is XML, so an apostrophe is often stored as `&apos;`
/// (`apos` is short for "apostrophe"). If we keep that entity and then
/// HTML-escape the `&`, the note shows the literal `&apos;` instead of `'`.
pub fn decode_xml_entities(input: &str) -> String {
    let once = decode_xml_entities_once(input);
    if once.contains('&') {
        decode_xml_entities_once(&once)
    } else {
        once
    }
}

fn decode_xml_entities_once(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        match rest.find(';') {
            Some(end) => {
                let body = &rest[1..end];
                if let Some(decoded) = entity_to_char(body) {
                    out.push(decoded);
                    rest = &rest[end + 1..];
                } else {
                    out.push('&');
                    rest = &rest[1..];
                }
            }
            None => {
                out.push_str(rest);
                return out;
            }
        }
    }
    out.push_str(rest);
    out
}

fn entity_to_char(body: &str) -> Option<char> {
    match body {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{00a0}'),
        other => {
            let digits = other.strip_prefix('#')?;
            let code = if let Some(hex) = digits
                .strip_prefix('x')
                .or_else(|| digits.strip_prefix('X'))
            {
                u32::from_str_radix(hex, 16).ok()?
            } else {
                digits.parse().ok()?
            };
            char::from_u32(code)
        }
    }
}
