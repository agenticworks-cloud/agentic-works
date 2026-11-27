'use strict';
// The extension is Agentic Works. Its earlier working name appears in no tracked file: not in a path, not in a line.
// The name is kept encoded here so this file does not say it either. .superpowers/ (working notes, not shipped),
// node_modules and docs/superpowers/plans/ (plans are deleted when their work merges) are left out.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const OLD = Buffer.from('cm9vc3Q=', 'base64').toString('utf8');
const PATTERN = new RegExp(OLD, 'gi');

/** Line numbers (1-based) in `text` where the old name appears. */
function lines(text) {
  const out = [];
  for (const m of text.matchAll(PATTERN)) out.push(text.slice(0, m.index).split('\n').length);
  return out;
}

// the pattern finds what it is meant to (or the scan below proves nothing)
assert.deepStrictEqual(lines(`a\n${OLD.toUpperCase()}`), [2], 'any case');
assert.deepStrictEqual(lines(`x ${OLD[0].toUpperCase()}${OLD.slice(1)}.json`), [1], 'capitalised, in a file name');
assert.deepStrictEqual(lines('Agentic Works, agenticWorks.getStarted, AGENTIC_WORKS_VERSION'), [], 'no false alarms');

const ls = spawnSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' });
assert.strictEqual(ls.status, 0, `git ls-files failed: ${ls.stderr}`);
const files = ls.stdout.split('\0').filter(Boolean)
  .filter((f) => !f.startsWith('.superpowers/') && !f.startsWith('docs/superpowers/plans/') && !f.split('/').includes('node_modules'));
assert.ok(files.includes('README.md') && files.includes('Makefile'), 'the scan sees the tracked files');

const found = [];
for (const f of files) {
  if (lines(f).length) found.push(f);
  let buf;
  try { buf = fs.readFileSync(path.join(root, f)); } catch (_) { continue; }   // tracked, but deleted in the tree
  if (buf.includes(0)) continue;                                              // binary (an icon)
  for (const n of lines(buf.toString('utf8'))) found.push(`${f}:${n}`);
}
assert.deepStrictEqual(found, [], 'the old name in tracked files');
console.log(`noOldName.test.js passed (${files.length} files)`);
