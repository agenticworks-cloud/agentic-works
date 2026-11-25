'use strict';
// The Get started page's step details (src/stepDetails.js): a file for every step, the small markdown renderer, the
// company file's words escaped as they go in, and links kept only when they are https.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = path.join(__dirname, '..', 'src');
const { stepDetails, renderDetails, detailsFile, httpsUrl, DETAILS_DIR } = require(path.join(src, 'stepDetails'));
const { STEP_IDS } = require(path.join(src, 'getStarted'));

// ---- every step id has a details file; the gateway step has both of its own; no file is left over
assert.deepStrictEqual([...STEP_IDS].sort(), ['agents', 'claude', 'codebase', 'email', 'github', 'jira', 'parts', 'teams', 'tools']);
const wanted = new Set();
for (const id of STEP_IDS) {
  for (const companyGateway of [false, true]) for (const autoTab of [false, true]) {
    const file = detailsFile(id, { companyGateway, autoTab });
    wanted.add(file);
    const text = fs.readFileSync(path.join(DETAILS_DIR, `${file}.md`), 'utf8');
    assert.ok(text.trim(), `${file}.md has text`);
    assert.ok(stepDetails(id, { companyGateway, autoTab, words: { gateway: 'Example Gateway', title: 'Example Works' } }).startsWith('<'), `${id} renders`);
  }
}
assert.deepStrictEqual([detailsFile('claude', { companyGateway: true }), detailsFile('claude')], ['claude-company-gateway', 'claude-every-way']);
// the talk step: a tab opening by itself (the company file's gateway.openTabOnTalk), or the two buttons
assert.deepStrictEqual([detailsFile('agents', { autoTab: true }), detailsFile('agents')], ['agents-auto', 'agents']);
const auto = stepDetails('agents', { autoTab: true, words: { gateway: 'Example Gateway' } });
assert.ok(auto.includes('Example Gateway') && auto.includes('Open Claude Tab') && !auto.includes('New Codex Tab</strong> or'), 'the auto text: no choice of tab');
assert.ok(stepDetails('agents').includes('<strong>New Codex Tab</strong>'), 'without it: the two buttons');
assert.deepStrictEqual(fs.readdirSync(DETAILS_DIR).sort(), [...wanted].map((f) => `${f}.md`).sort(), 'one file per step, and no other');
// a company's note goes first, rendered by the same rules: escaped, https links only
{
  const plain = stepDetails('github');
  const withNote = stepDetails('github', { note: 'Ask **IT** at [the desk](https://example.com/desk) <b>now</b> [x](http://example.com/x)' });
  assert.ok(withNote.startsWith('<p>Ask <strong>IT</strong> at <a href="https://example.com/desk">the desk</a> &lt;b&gt;now&lt;/b&gt; x</p>'), withNote.slice(0, 200));
  assert.ok(withNote.endsWith(plain), 'then the step\'s own text');
  assert.strictEqual(stepDetails('nope', { note: 'x' }), '', 'no step file: no details, note or not');
}
assert.strictEqual(stepDetails('../package'), '', 'only a step id names a file');
assert.strictEqual(stepDetails('nope'), '', 'no file: no details');

// the company gateway's text names it; every way's names each way
const company = stepDetails('claude', { companyGateway: true, words: { gateway: 'Example Gateway', title: 'Example Works' } });
assert.ok(company.includes('Example Gateway') && company.includes('Example Works') && company.includes('Get a key'));
assert.ok(!company.includes('{{'), 'every placeholder filled');
const every = stepDetails('claude');
for (const way of ['An LLM gateway', 'Claude subscription', 'Anthropic API key', 'AWS Bedrock']) assert.ok(every.includes(way), way);
// a company file without a title: the sentence still reads
assert.ok(stepDetails('tools', { words: {} }).includes('the tools your company has set up'));

// ---- the renderer: headings, paragraphs, lists, bold, inline code, links
assert.strictEqual(renderDetails('# Head\n\nOne\nline.\n\n- **a** `x`\n  more\n- b\n\n1. c\n2. d\n\nSee [it](https://example.com/p?q=1&r=2) or <https://example.com>.'),
  ['<h3>Head</h3>', '<p>One line.</p>', '<ul><li><strong>a</strong> <code>x</code> more</li><li>b</li></ul>', '<ol><li>c</li><li>d</li></ol>',
    '<p>See <a href="https://example.com/p?q=1&amp;r=2">it</a> or <a href="https://example.com/">https://example.com</a>.</p>'].join('\n'));
// the texts' own characters are escaped too
assert.strictEqual(renderDetails('<script>x</script> & "q" \'s'), '<p>&lt;script&gt;x&lt;/script&gt; &amp; &quot;q&quot; &#39;s</p>');
assert.strictEqual(renderDetails('`<b>`'), '<p><code>&lt;b&gt;</code></p>');

// ---- the placeholders: escaped for HTML, never read as markdown, never in an address
const evil = { gateway: '<img src=x onerror=alert(1)> **bold** [x](https://evil.example.com) `c` {{title}}', title: '"><script>alert(1)</script>' };
const out = renderDetails('Use **{{gateway}}** at [the page](https://example.com/{{gateway}}) for {{title}}; `{{title}}`.', evil);
assert.ok(!/<img|<script|<b>|evil\.example\.com"/.test(out), out);
assert.strictEqual((out.match(/<a /g) || []).length, 0, 'no link made from a value, nor one whose address holds a value');
assert.strictEqual((out.match(/<strong>/g) || []).length, 1, 'no bold made from a value');
assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt; **bold** [x](https://evil.example.com) `c` {{title}}'), 'the value as text');
assert.ok(out.includes('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
assert.ok(out.includes(' at the page for '), 'the link with a value in its address: its text');
// a value can't forge a marker, and the texts' markers are dropped
assert.strictEqual(renderDetails('{{gateway}}', { gateway: '1' }), '<p>1</p>');
assert.strictEqual(renderDetails('a0b {{title}}', { title: 'T' }), '<p>a0b T</p>');
// other {{…}} stay text; an empty or missing value says the default
assert.strictEqual(renderDetails('{{other}} {{gateway}} {{title}}', { gateway: '  ', title: 7 }), '<p>{{other}} the gateway your company</p>');

// ---- links: https only; any other is its text
for (const bad of ['javascript:alert.call', 'http://example.com', 'file:///etc/passwd', 'command:workbench.action.reloadWindow', 'vscode://x', 'data:text/html,x', '//example.com', 'example.com']) {
  assert.strictEqual(renderDetails(`[go](${bad})`), '<p>go</p>', bad);
  assert.strictEqual(httpsUrl(bad), '', bad);
}
assert.strictEqual(renderDetails('<http://example.com>'), '<p>&lt;http://example.com&gt;</p>');
assert.strictEqual(httpsUrl('https://example.com/a b'), 'https://example.com/a%20b');
for (const bad of [undefined, null, 7, {}, '']) assert.strictEqual(httpsUrl(bad), '');
// a link's text with a link in it: one link
assert.strictEqual(renderDetails('[a <https://b.example.com>](https://a.example.com)'), '<p><a href="https://a.example.com/">a https://b.example.com</a></p>');

console.log('stepDetails.test.js passed');
