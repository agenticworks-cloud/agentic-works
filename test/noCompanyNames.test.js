'use strict';
// Roost is public and generic: no tracked file names the company whose installer layers on top of it (its name, its
// hosts, its repos, its models, its app ids). The terms are kept encoded here so this file does not name them either.
// .superpowers/ (working notes, not shipped) and node_modules are left out.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const decode = (b) => Buffer.from(b, 'base64').toString('utf8');
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// anywhere, in any case
const TERMS = ['YzNjaQ==', 'YzNlbmVyZ3k=', 'YzNzZWN1cml0eXRvb2xz', 'YzMuYWk=', 'YWdlbnQtY29ubmVjdA==', 'bmV4dXM=', 'NDUyOGY1NGE=', 'NTNhZDc3OWE=']
  .map(decode);
const PATTERNS = [
  new RegExp(TERMS.map(escape).join('|'), 'gi'),
  new RegExp('\\b' + decode('YzM=') + '-[a-z]', 'gi'),     // the company's repo and skill names
  new RegExp('\\b' + decode('QzM=') + '\\b', 'g'),          // its name, as a word (c1, c2, c3 as names in tests are not it)
];

/** Each hit in `text`: where, and a little around it. */
function hits(text) {
  const out = [];
  for (const re of PATTERNS) {
    for (const m of text.matchAll(re)) out.push({ at: m.index, around: text.slice(Math.max(0, m.index - 20), m.index + 20).replace(/\s+/g, ' ') });
  }
  return out;
}

// the patterns find what they are meant to (or the scan below proves nothing)
for (const t of TERMS) assert.ok(hits(`see ${t.toUpperCase()} here`).length >= 1, 'a term, in any case');
assert.strictEqual(hits(`skill ${decode('YzM=')}-acls`).length, 1);
assert.strictEqual(hits(`at ${decode('QzM=')}'s`).length, 1);
assert.deepStrictEqual(hits('const c3 = tabs[2]; c1, c2, c3; 0a1b2c3d; example-router; gateway.example.com'), [], 'no false alarms');

const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
assert.strictEqual(ls.status, 0, `git ls-files failed: ${ls.stderr}`);
const files = ls.stdout.split('\0').filter(Boolean)
  .filter((f) => !f.startsWith('.superpowers/') && !f.split('/').includes('node_modules'));
assert.ok(files.includes('README.md') && files.includes('parts/agents/src/gateway.js'), 'the scan sees the tracked files');

const found = [];
for (const f of files) {
  let buf;
  try { buf = fs.readFileSync(path.join(root, f)); } catch (_) { continue; }   // tracked, but deleted in the tree
  if (buf.includes(0)) continue;                                              // binary (an icon)
  const text = buf.toString('utf8');
  for (const h of hits(text)) found.push(`${f}:${text.slice(0, h.at).split('\n').length}: …${h.around}…`);
}
assert.deepStrictEqual(found, [], 'company-specific mentions in tracked files');
console.log(`noCompanyNames.test.js passed (${files.length} files)`);
