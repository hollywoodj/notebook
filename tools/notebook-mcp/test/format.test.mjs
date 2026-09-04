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

test("HTML entity decoding", () => {
  const html = "<p>Tom &amp; Jerry say &quot;hi&nbsp;there&quot; &lt;3 &gt; &#39;ok&#39;</p>";
  const md = htmlToMarkdown(html);
  assert.equal(md, `Tom & Jerry say "hi there" <3 > 'ok'`);
});
