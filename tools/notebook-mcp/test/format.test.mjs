import { test } from "node:test";
import assert from "node:assert/strict";
import { htmlToMarkdown, markdownToHtml, parseTaskListItems, renderTaskList } from "../format.mjs";

test("markdown -> html -> markdown round-trips headings, formatting, links, lists, code, hr", () => {
  const md = `## Section

Some *text* with **bold** and \`code\` and a [link](https://example.com).

- [ ] todo one
- [x] done one

- bullet one
- bullet two

1. first
2. second

\`\`\`
const x = 1;
console.log(x);
\`\`\`

---

Escaped: <div>hack</div>`;

  const html = markdownToHtml(md);
  assert.match(html, /<h2>Section<\/h2>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<em>text<\/em>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<a href="https:\/\/example\.com">link<\/a>/);
  assert.match(html, /<ul data-type="taskList">/);
  assert.match(html, /data-checked="false"/);
  assert.match(html, /data-checked="true"/);
  assert.match(html, /<pre><code>/);
  assert.match(html, /<hr>/);
  // user text containing markup must be escaped, not injected
  assert.match(html, /&lt;div&gt;hack&lt;\/div&gt;/);
  assert.doesNotMatch(html, /<div>hack<\/div>/);

  const back = htmlToMarkdown(html);
  assert.match(back, /^## Section/m);
  assert.match(back, /\*\*bold\*\*/);
  assert.match(back, /\*text\*/);
  assert.match(back, /`code`/);
  assert.match(back, /\[link\]\(https:\/\/example\.com\)/);
  assert.match(back, /- \[ \] todo one/);
  assert.match(back, /- \[x\] done one/);
  assert.match(back, /- bullet one/);
  assert.match(back, /1\. first/);
  assert.match(back, /```\nconst x = 1;\nconsole\.log\(x\);\n```/);
  assert.match(back, /^---$/m);
  assert.match(back, /Escaped: <div>hack<\/div>/); // decoded back to literal text
});

test("task item HTML matches the desktop editor's exact TipTap shape", () => {
  const html = markdownToHtml("- [x] done\n- [ ] not done");
  assert.equal(
    html,
    '<ul data-type="taskList">' +
      '<li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked><span></span></label><div><p>done</p></div></li>' +
      '<li data-type="taskItem" data-checked="false"><label><input type="checkbox"><span></span></label><div><p>not done</p></div></li>' +
      "</ul>"
  );
});

test("htmlToMarkdown tolerates TipTap attribute/whitespace variations on task items", () => {
  const variants = [
    '<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><label><input type="checkbox" checked="checked"><span></span></label><div><p>done</p></div></li></ul>',
    "<ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked='true'><label><input type=\"checkbox\" checked><span></span></label><div><p>done</p></div></li></ul>",
    '<ul data-type="taskList">\n  <li data-type="taskItem" data-checked="true">\n    <label><input type="checkbox" checked><span></span></label>\n    <div><p>done</p></div>\n  </li>\n</ul>',
  ];
  for (const html of variants) {
    const items = parseTaskListItems(html);
    assert.equal(items.length, 1);
    assert.equal(items[0].text, "done");
    assert.equal(items[0].checked, true);
  }
});

test("parseTaskListItems / renderTaskList round-trip", () => {
  const items = [
    { text: "first item", checked: false },
    { text: "second item", checked: true },
  ];
  const html = renderTaskList(items);
  const parsed = parseTaskListItems(html);
  assert.deepEqual(parsed, items);
});

// ---------------------------------------------------------------------------
// GFM tables
// ---------------------------------------------------------------------------

test("markdown table -> TipTap-shaped HTML -> markdown round-trips headers, rows, and inline formatting", () => {
  const md = `| Project | What | Last touched |
| --- | --- | ---: |
| notebook | **Notes** app | 2026-09-04 |
| BBC | Casting \`show\` | 2026-08-18 |`;

  const html = markdownToHtml(md);
  // Exact TipTap shape: <table><tbody><tr><th><p>..</p></th>...<tr><td><p>..</p></td>...
  assert.match(html, /^<table><tbody>/);
  assert.match(html, /<\/tbody><\/table>$/);
  assert.match(html, /<tr><th><p>Project<\/p><\/th><th><p>What<\/p><\/th><th><p>Last touched<\/p><\/th><\/tr>/);
  assert.match(html, /<td><p><strong>Notes<\/strong> app<\/p><\/td>/);
  assert.match(html, /<td><p>Casting <code>show<\/code><\/p><\/td>/);
  // alignment row must never become a data row
  assert.doesNotMatch(html, /---/);

  const back = htmlToMarkdown(html);
  assert.match(back, /^\| Project \| What \| Last touched \|$/m);
  assert.match(back, /^\| --- \| --- \| --- \|$/m);
  assert.match(back, /\*\*Notes\*\* app/);
  assert.match(back, /Casting `show`/);
  assert.match(back, /notebook/);
  assert.match(back, /BBC/);
});

test("table cells handle escaped pipes and never break table syntax round-trip", () => {
  const md = `| A | B |
| --- | --- |
| pipe \\| here | plain |`;
  const html = markdownToHtml(md);
  assert.match(html, /<td><p>pipe \| here<\/p><\/td>/);
  const back = htmlToMarkdown(html);
  assert.match(back, /pipe \\\| here/);
});

test("a ragged table (mismatched row widths) degrades to a readable padded table instead of throwing", () => {
  const md = `| A | B | C |
| --- | --- | --- |
| short |
| exact | row | here |
| too | many | cells | overflow |`;
  assert.doesNotThrow(() => markdownToHtml(md));
  const html = markdownToHtml(md);
  const back = htmlToMarkdown(html);
  assert.doesNotThrow(() => htmlToMarkdown(html));
  // every row padded/normalized to the widest row seen (4 columns)
  for (const line of back.split("\n")) {
    if (!line.startsWith("|")) continue;
    assert.equal((line.match(/\|/g) || []).length, 5); // 4 cells -> 5 pipes
  }
});

test("htmlToMarkdown never throws on a malformed table (no <tr> rows) - degrades to plain text", () => {
  assert.doesNotThrow(() => htmlToMarkdown("<table><p>not really a table</p></table>"));
  const back = htmlToMarkdown("<table><p>not really a table</p></table>");
  assert.match(back, /not really a table/);
});

test("HTML entity decoding", () => {
  const html = "<p>Tom &amp; Jerry say &quot;hi&nbsp;there&quot; &lt;3 &gt; &#39;ok&#39;</p>";
  const md = htmlToMarkdown(html);
  assert.equal(md, `Tom & Jerry say "hi there" <3 > 'ok'`);
});
