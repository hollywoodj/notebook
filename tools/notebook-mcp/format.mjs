// Small, predictable, pure HTML <-> Markdown conversion tailored to the subset
// of HTML that Notebook's TipTap editor produces/consumes. No dependencies.
//
// Supported: h1-h4, p, br, ul/ol/li, TipTap task-list items
// (`<ul data-type="taskList">` / `<li data-type="taskItem" data-checked="...">`),
// strong/b, em/i, code, pre, a, hr, and HTML entity decoding.
//
// These are intentionally simple regex/scan based converters, not a general
// HTML parser - they only need to round-trip the shapes this integration
// itself produces (plus tolerate the minor attribute variations TipTap emits).

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

const ENTITY_DECODE = [
  [/&nbsp;/g, " "],
  [/&quot;/g, '"'],
  [/&#39;/g, "'"],
  [/&apos;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&amp;/g, "&"], // must be last
];

export function decodeEntities(str) {
  let out = str;
  for (const [re, repl] of ENTITY_DECODE) out = out.replace(re, repl);
  return out;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// HTML -> Markdown
// ---------------------------------------------------------------------------

/** Depth-aware extraction of the first top-level <tag>...</tag> at/after `pos`. */
function findBalancedBlock(html, pos, tag) {
  const openRe = new RegExp(`<${tag}(\\s[^>]*)?>`, "gi");
  const closeRe = new RegExp(`</${tag}>`, "gi");
  openRe.lastIndex = pos;
  const openMatch = openRe.exec(html);
  if (!openMatch || openMatch.index < pos) return null;
  // Re-anchor: only accept if this is genuinely the next occurrence at/after pos.
  const start = openMatch.index;
  let depth = 1;
  let scanPos = openRe.lastIndex;
  const combinedRe = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, "gi");
  combinedRe.lastIndex = scanPos;
  let m;
  while ((m = combinedRe.exec(html))) {
    if (m[0].toLowerCase().startsWith("</")) {
      depth--;
      if (depth === 0) {
        return {
          start,
          end: m.index + m[0].length,
          attrs: openMatch[1] || "",
          inner: html.slice(scanPos, m.index),
        };
      }
    } else {
      depth++;
    }
  }
  return null; // unclosed - malformed input, bail
}

const BLOCK_TAGS = ["h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "pre", "p", "table"];

function nextBlockOpen(html, pos) {
  let best = null;
  for (const tag of BLOCK_TAGS) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "gi");
    re.lastIndex = pos;
    const m = re.exec(html);
    if (m && (!best || m.index < best.index)) {
      best = { index: m.index, tag };
    }
  }
  // hr is self-closing, handle separately
  const hrRe = /<hr(?:\s[^>]*)?\/?>/gi;
  hrRe.lastIndex = pos;
  const hrMatch = hrRe.exec(html);
  if (hrMatch && (!best || hrMatch.index < best.index)) {
    best = { index: hrMatch.index, tag: "hr", raw: hrMatch[0] };
  }
  return best;
}

function inlineToMarkdown(html) {
  let s = html;
  // links
  s = s.replace(/<a\s+[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => {
    return `[${inlineToMarkdown(text)}](${decodeEntities(href)})`;
  });
  // bold
  s = s.replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _t, text) => `**${inlineToMarkdown(text)}**`);
  // italics
  s = s.replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _t, text) => `*${inlineToMarkdown(text)}*`);
  // inline code
  s = s.replace(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/gi, (_, text) => `\`${decodeEntities(text.replace(/<[^>]+>/g, ""))}\``);
  // line breaks
  s = s.replace(/<br\s*\/?>/gi, "\n");
  // strip any remaining tags
  s = s.replace(/<[^>]+>/g, "");
  return decodeEntities(s).trim();
}

function taskItemsToMarkdown(ulInner, indent) {
  const lines = [];
  let pos = 0;
  while (pos < ulInner.length) {
    const li = findBalancedBlock(ulInner, pos, "li");
    if (!li) break;
    const checkedAttr = /data-checked\s*=\s*"?(true|false)"?/i.exec(li.attrs);
    const inputChecked = /<input[^>]*\schecked(?:="[^"]*")?[^>]*>/i.test(li.inner);
    const isChecked = checkedAttr ? checkedAttr[1].toLowerCase() === "true" : inputChecked;
    // Text lives in a trailing <div>...</div> (may itself contain <p> and a nested list).
    const div = findBalancedBlock(li.inner, 0, "div");
    let text = "";
    let nested = "";
    if (div) {
      const p = findBalancedBlock(div.inner, 0, "p");
      text = inlineToMarkdown(p ? p.inner : div.inner.replace(/<p[^>]*>|<\/p>/gi, ""));
      const restAfterP = p ? div.inner.slice(p.end) : "";
      const nestedUl = findBalancedBlock(restAfterP || div.inner, 0, "ul");
      if (nestedUl) nested = taskItemsToMarkdown(nestedUl.inner, indent + "  ");
    } else {
      text = inlineToMarkdown(li.inner.replace(/<label[\s\S]*?<\/label>/i, ""));
    }
    lines.push(`${indent}- [${isChecked ? "x" : " "}] ${text}`);
    if (nested) lines.push(nested);
    pos = li.end;
  }
  return lines.join("\n");
}

function listToMarkdown(ulInner, ordered, indent) {
  const lines = [];
  let pos = 0;
  let n = 1;
  while (pos < ulInner.length) {
    const li = findBalancedBlock(ulInner, pos, "li");
    if (!li) break;
    const p = findBalancedBlock(li.inner, 0, "p");
    const text = inlineToMarkdown(p ? p.inner : li.inner);
    const marker = ordered ? `${n}.` : "-";
    lines.push(`${indent}${marker} ${text}`);
    // nested list support
    const restAfterP = p ? li.inner.slice(p.end) : "";
    const nestedUl = findBalancedBlock(restAfterP, 0, "ul");
    const nestedOl = findBalancedBlock(restAfterP, 0, "ol");
    if (nestedUl) lines.push(listToMarkdown(nestedUl.inner, false, indent + "  "));
    if (nestedOl) lines.push(listToMarkdown(nestedOl.inner, true, indent + "  "));
    n++;
    pos = li.end;
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// GFM tables (HTML -> Markdown)
// ---------------------------------------------------------------------------

/** Text content of one <td>/<th> cell: joins multiple <p> paragraphs (a cell's
 * content model allows block+) with a space; falls back to stripping tags
 * directly when there's no <p> wrapper. */
function cellInnerToMarkdown(inner) {
  const paragraphs = findAllBalancedBlocks(inner, "p");
  if (paragraphs.length) return paragraphs.map((p) => inlineToMarkdown(p.inner)).join(" ");
  return inlineToMarkdown(inner);
}

/** Pipe- and newline-escape a cell's Markdown text so it can't break table syntax. */
function escapeTableCellText(text) {
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|");
}

/** <td>/<th> cells of one <tr>, in document order (regardless of thead/tbody wrapping). */
function extractRowCells(trInner) {
  const tds = findAllBalancedBlocks(trInner, "td").map((b) => ({ ...b, header: false }));
  const ths = findAllBalancedBlocks(trInner, "th").map((b) => ({ ...b, header: true }));
  return [...tds, ...ths]
    .sort((a, b) => a.start - b.start)
    .map((c) => ({ text: escapeTableCellText(cellInnerToMarkdown(c.inner)), header: c.header }));
}

/** A <table> (inner HTML - whatever's between <table> and </table>, thead/tbody/colgroup
 * and all) to a GFM pipe table. Ragged rows are padded (never truncated) to the widest
 * row seen, so a malformed/ragged table degrades to readable text instead of throwing. */
function tableToMarkdown(tableInner) {
  const trs = findAllBalancedBlocks(tableInner, "tr");
  if (!trs.length) return "";
  const rows = trs.map((tr) => extractRowCells(tr.inner));
  const columnCount = Math.max(1, ...rows.map((r) => r.length));
  const padded = rows.map((r) => {
    const cells = r.map((c) => c.text);
    while (cells.length < columnCount) cells.push("");
    return cells;
  });
  const lines = [`| ${padded[0].join(" | ")} |`, `| ${Array(columnCount).fill("---").join(" | ")} |`];
  for (let i = 1; i < padded.length; i++) lines.push(`| ${padded[i].join(" | ")} |`);
  return lines.join("\n");
}

export function htmlToMarkdown(html) {
  if (!html) return "";
  const out = [];
  let pos = 0;
  const src = html.trim();
  while (pos < src.length) {
    const next = nextBlockOpen(src, pos);
    if (!next) break;
    if (next.tag === "hr") {
      out.push("---");
      pos = next.index + next.raw.length;
      continue;
    }
    const block = findBalancedBlock(src, next.index, next.tag);
    if (!block) break;
    switch (next.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(next.tag[1]);
        out.push(`${"#".repeat(level)} ${inlineToMarkdown(block.inner)}`);
        break;
      }
      case "p": {
        const text = inlineToMarkdown(block.inner);
        if (text) out.push(text);
        break;
      }
      case "pre": {
        const codeMatch = /<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/i.exec(block.inner);
        const raw = codeMatch ? codeMatch[1] : block.inner;
        const text = decodeEntities(raw.replace(/<[^>]+>/g, ""));
        out.push("```\n" + text.replace(/\n$/, "") + "\n```");
        break;
      }
      case "ul": {
        const isTaskList = /data-type\s*=\s*"taskList"/i.test(block.attrs);
        out.push(isTaskList ? taskItemsToMarkdown(block.inner, "") : listToMarkdown(block.inner, false, ""));
        break;
      }
      case "ol": {
        out.push(listToMarkdown(block.inner, true, ""));
        break;
      }
      case "table": {
        // Never let a malformed table abort the whole conversion - degrade to
        // plain text (tags stripped) instead of throwing.
        let text;
        try {
          text = tableToMarkdown(block.inner);
        } catch {
          text = "";
        }
        if (!text) text = inlineToMarkdown(block.inner);
        if (text) out.push(text);
        break;
      }
      default:
        break;
    }
    pos = block.end;
  }
  return out.join("\n\n").trim();
}

// ---------------------------------------------------------------------------
// Structural helpers shared with server.mjs (backlog/report note editing)
// ---------------------------------------------------------------------------

/** All top-level (outermost) <tag>...</tag> blocks in `html`, depth-aware. */
export function findAllBalancedBlocks(html, tag) {
  const results = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>|</${tag}>`, "gi");
  const stack = [];
  let m;
  while ((m = re.exec(html))) {
    const isClose = m[0].toLowerCase().startsWith("</");
    if (!isClose) {
      const attrsMatch = /^<[a-zA-Z0-9]+(\s[^>]*)?>$/.exec(m[0]);
      const attrs = (attrsMatch && attrsMatch[1]) || "";
      stack.push({ start: m.index, contentStart: m.index + m[0].length, attrs });
    } else {
      const open = stack.pop();
      if (open && stack.length === 0) {
        results.push({ attrs: open.attrs, inner: html.slice(open.contentStart, m.index), start: open.start, end: m.index + m[0].length });
      }
    }
  }
  return results;
}

/** Parse a TipTap task-list (`<ul data-type="taskList">...</ul>`) found anywhere at
 * top level in `html` into `[{ text, checked }]`. Tolerant of attribute-order /
 * quoting variations TipTap emits. Returns [] if no task list is present. */
export function parseTaskListItems(html) {
  const uls = findAllBalancedBlocks(html, "ul").filter((b) => /data-type\s*=\s*"taskList"/i.test(b.attrs));
  if (uls.length === 0) return [];
  const items = [];
  for (const ul of uls) {
    for (const li of findAllBalancedBlocks(ul.inner, "li")) {
      const checkedAttr = /data-checked\s*=\s*"?(true|false)"?/i.exec(li.attrs);
      const inputChecked = /<input[^>]*\schecked(?:="[^"]*")?[^>]*>/i.test(li.inner);
      const checked = checkedAttr ? checkedAttr[1].toLowerCase() === "true" : inputChecked;
      const div = findAllBalancedBlocks(li.inner, "div")[0];
      const inner = div ? div.inner : li.inner.replace(/<label[\s\S]*?<\/label>/i, "");
      const p = div ? findAllBalancedBlocks(div.inner, "p")[0] : null;
      const text = decodeEntities((p ? p.inner : inner).replace(/<[^>]+>/g, "")).trim();
      items.push({ text, checked });
    }
  }
  return items;
}

/** Render `[{ text, checked }]` as a TipTap task list matching the desktop editor's shape. */
export function renderTaskList(items) {
  const lis = items
    .map(
      (it) =>
        `<li data-type="taskItem" data-checked="${it.checked ? "true" : "false"}"><label><input type="checkbox"${
          it.checked ? " checked" : ""
        }><span></span></label><div><p>${escapeHtml(it.text)}</p></div></li>`
    )
    .join("");
  return `<ul data-type="taskList">${lis}</ul>`;
}

// ---------------------------------------------------------------------------
// Markdown -> HTML
// ---------------------------------------------------------------------------

function inlineToHtml(text) {
  let s = escapeHtml(text);
  // links: [text](url)
  s = s.replace(/\[([^\]]*)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${escapeAttr(u)}">${inlineToHtml(t)}</a>`);
  // bold
  s = s.replace(/\*\*([^*]+)\*\*/g, (_, t) => `<strong>${t}</strong>`);
  // italics (single asterisk, not adjacent to another asterisk)
  s = s.replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, (_, pre, t) => `${pre}<em>${t}</em>`);
  // inline code
  s = s.replace(/`([^`]+)`/g, (_, t) => `<code>${t}</code>`);
  return s;
}

function isTaskLine(line) {
  return /^\s*[-*]\s+\[( |x|X)\]\s+/.test(line);
}
function isBulletLine(line) {
  return /^\s*[-*]\s+/.test(line) && !isTaskLine(line);
}
function isOrderedLine(line) {
  return /^\s*\d+\.\s+/.test(line);
}

// ---------------------------------------------------------------------------
// GFM tables (Markdown -> HTML)
// ---------------------------------------------------------------------------

/** Split one pipe-table row into trimmed cell strings, honoring `\|` as a
 * literal pipe rather than a delimiter and tolerating optional outer pipes. */
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (s[i] === "|") {
      cells.push(cur);
      cur = "";
      continue;
    }
    cur += s[i];
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

/** True if `line` is a GFM alignment row (`| --- | :---: | ---: |`, etc). */
function isTableSeparatorLine(line) {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.includes("-")) return false;
  const cells = splitTableRow(trimmed);
  if (!cells.length) return false;
  return cells.every((c) => /^:?-{1,}:?$/.test(c));
}

/** Header line + separator line + data lines -> a real `<table>`. Ragged rows
 * (and a ragged header) are padded to the widest row, never truncated, so a
 * malformed/ragged table degrades to a readable table instead of throwing. */
function tableLinesToHtml(headerLine, dataLines) {
  const headerCells = splitTableRow(headerLine);
  const dataRows = dataLines.map(splitTableRow);
  const columnCount = Math.max(1, headerCells.length, ...dataRows.map((r) => r.length));

  const pad = (cells) => {
    const out = cells.slice(0, columnCount);
    while (out.length < columnCount) out.push("");
    return out;
  };

  const headerHtml = pad(headerCells)
    .map((c) => `<th><p>${inlineToHtml(c)}</p></th>`)
    .join("");
  const bodyHtml = dataRows
    .map((row) => `<tr>${pad(row).map((c) => `<td><p>${inlineToHtml(c)}</p></td>`).join("")}</tr>`)
    .join("");
  return `<table><tbody><tr>${headerHtml}</tr>${bodyHtml}</tbody></table>`;
}

function taskLinesToHtml(lines) {
  const items = lines.map((line) => {
    const m = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line);
    const checked = m[1].toLowerCase() === "x";
    const text = inlineToHtml(m[2]);
    return `<li data-type="taskItem" data-checked="${checked ? "true" : "false"}"><label><input type="checkbox"${checked ? " checked" : ""}><span></span></label><div><p>${text}</p></div></li>`;
  });
  return `<ul data-type="taskList">${items.join("")}</ul>`;
}

function bulletLinesToHtml(lines) {
  const items = lines.map((line) => {
    const text = inlineToHtml(line.replace(/^\s*[-*]\s+/, ""));
    return `<li><p>${text}</p></li>`;
  });
  return `<ul>${items.join("")}</ul>`;
}

function orderedLinesToHtml(lines) {
  const items = lines.map((line) => {
    const text = inlineToHtml(line.replace(/^\s*\d+\.\s+/, ""));
    return `<li><p>${text}</p></li>`;
  });
  return `<ol>${items.join("")}</ol>`;
}

export function markdownToHtml(md) {
  if (!md) return "";
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    // fenced code block
    if (/^```/.test(line.trim())) {
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      out.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // hr
    if (/^(---|\*\*\*)\s*$/.test(line.trim())) {
      out.push("<hr>");
      i++;
      continue;
    }

    // headings
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length;
      out.push(`<h${level}>${inlineToHtml(headingMatch[2].trim())}</h${level}>`);
      i++;
      continue;
    }

    // task list
    if (isTaskLine(line)) {
      const group = [];
      while (i < lines.length && isTaskLine(lines[i])) {
        group.push(lines[i]);
        i++;
      }
      out.push(taskLinesToHtml(group));
      continue;
    }

    // bullet list
    if (isBulletLine(line)) {
      const group = [];
      while (i < lines.length && isBulletLine(lines[i])) {
        group.push(lines[i]);
        i++;
      }
      out.push(bulletLinesToHtml(group));
      continue;
    }

    // ordered list
    if (isOrderedLine(line)) {
      const group = [];
      while (i < lines.length && isOrderedLine(lines[i])) {
        group.push(lines[i]);
        i++;
      }
      out.push(orderedLinesToHtml(group));
      continue;
    }

    // GFM table: a header row immediately followed by a valid alignment row
    if (line.includes("|") && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
      const headerLine = line;
      i += 2; // skip header + separator
      const dataLines = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        dataLines.push(lines[i]);
        i++;
      }
      out.push(tableLinesToHtml(headerLine, dataLines));
      continue;
    }

    // paragraph (collect until blank line or a line starting a new block type)
    const paraLines = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^```/.test(lines[i].trim()) &&
      !/^(---|\*\*\*)\s*$/.test(lines[i].trim()) &&
      !/^#{1,6}\s+/.test(lines[i]) &&
      !isTaskLine(lines[i]) &&
      !isBulletLine(lines[i]) &&
      !isOrderedLine(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${paraLines.map((l) => inlineToHtml(l)).join("<br>")}</p>`);
  }
  return out.join("");
}
