'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const lines = (s) => (s ? s.split('\n').length : 0);

const parts = {
  perch: { id: 'perch', title: 'Perch', branch: 'main', file: 'src/extension.js' },
  chirp: { id: 'teams', title: 'Teams', branch: 'main', file: 'src/api.js' },
  jay: { id: 'jira', title: 'Jira & Confluence', branch: 'main', file: 'src/api.js' },
  kestrel: { id: 'prs', title: 'PRs', branch: 'master', file: 'src/github.js' },
};

for (const [dir, want] of Object.entries(parts)) {
  assert.ok(fs.existsSync(path.join(root, 'parts', dir, 'package.json')), `${dir}: package.json`);
  const part = read(`parts/${dir}/part.json`);
  assert.deepStrictEqual(Object.keys(part).sort(), ['entry', 'id', 'needs', 'title']);
  assert.strictEqual(part.id, want.id);
  assert.strictEqual(part.title, want.title);
  assert.strictEqual(part.entry, 'src/extension.js');
  assert.deepStrictEqual(part.needs, []);

  // History kept: file log in Roost matches the source repo's.
  const mine = lines(git(root, 'log', '--oneline', '--', `parts/${dir}/${want.file}`));
  const orig = lines(git(`/git/${dir}`, 'log', '--oneline', want.branch, '--', want.file));
  assert.ok(orig > 1, `${dir}: source history exists`);
  assert.strictEqual(mine, orig, `${dir}/${want.file}: ${mine} commits in Roost, ${orig} in source`);
}

// Blame reaches back before the import.
const importCommit = git(root, 'log', '--format=%H', '--grep=^Import jay as parts/jay', '-1');
assert.ok(importCommit, 'jay import merge exists');
const blamed = git(root, 'blame', '-s', 'parts/jay/src/extension.js').split('\n')[0].split(' ')[0].replace('^', '');
const blamedFull = git(root, 'rev-parse', blamed);
assert.notStrictEqual(blamedFull, importCommit);
assert.strictEqual(git(root, 'merge-base', '--is-ancestor', blamedFull, `${importCommit}^2`) || 'ok', 'ok');

const roost = read('roost.json');
assert.deepStrictEqual(roost, {
  name: 'roost',
  displayName: 'Roost',
  publisher: 'seanahn',
  version: '0.1.0',
  description: 'Claude Code and Codex tabs, Teams, Jira & Confluence and pull requests in one extension.',
  engines: { vscode: '^1.90.0' },
  license: 'MIT',
  repository: 'https://github.com/seanahn/roost',
  icon: 'parts/perch/media/icon.png',
});
assert.ok(fs.existsSync(path.join(root, roost.icon)), 'icon exists');

console.log('import.test.js passed');
