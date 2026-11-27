'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Each folder under parts/, and the repo it was imported from (as parts/<repo>, then renamed).
const parts = {
  agents: { repo: 'perch', id: 'agents', title: 'Agents (Claude Code and Codex)', file: 'src/extension.js' },
  teams: { repo: 'chirp', id: 'teams', title: 'Teams', file: 'src/api.js' },
  jira: { repo: 'jay', id: 'jira', title: 'Jira & Confluence', file: 'src/api.js' },
  'pull-requests': { repo: 'kestrel', id: 'pullRequests', title: 'PRs', file: 'src/github.js' },
};

for (const [dir, want] of Object.entries(parts)) {
  const { repo } = want;
  assert.ok(fs.existsSync(path.join(root, 'parts', dir, 'package.json')), `${dir}: package.json`);
  const part = read(`parts/${dir}/part.json`);
  assert.deepStrictEqual(Object.keys(part).sort(), ['entry', 'id', 'needs', 'title']);
  assert.strictEqual(part.id, want.id);
  assert.strictEqual(part.title, want.title);
  assert.strictEqual(part.entry, 'src/extension.js');
  assert.deepStrictEqual(part.needs, []);

  // History kept: every commit of the source repo that touched the file (author date and subject), up to the commit
  // that was imported, is in Agentic Works' log of it; commits made in Agentic Works since are allowed. The imported commit is the
  // source commit matching the tip of the import merge's second parent (the imported history, its paths rewritten
  // under parts/<repo>/), so the source repo moving on since does not matter. --follow: the folder was renamed since.
  const log = (cwd, ...args) => git(cwd, 'log', '--format=%at %s', ...args).split('\n').filter(Boolean);
  const mine = new Set(log(root, '--follow', '--', `parts/${dir}/${want.file}`));
  if (!fs.existsSync(`/git/${repo}/.git`)) {
    console.log(`import.test.js: /git/${repo} is absent, skipping its history comparison`);
    continue;
  }
  const merge = git(root, 'log', '--format=%H', '-F', `--grep=as parts/${repo} (history kept)`, '-1');
  assert.ok(merge, `${dir}: import merge exists`);
  const identity = '%at %an %s';
  const imported = git(root, 'log', '-1', `--format=${identity}`, `${merge}^2`);
  const source = git(`/git/${repo}`, 'log', '--all', `--format=%H ${identity}`).split('\n').find((l) => l.slice(41) === imported);
  assert.ok(source, `${dir}: the imported commit (${imported}) is in /git/${repo}`);
  const orig = log(`/git/${repo}`, source.slice(0, 40), '--', want.file);
  assert.ok(orig.length > 1, `${dir}: source history exists`);
  const missing = orig.filter((c) => !mine.has(c));
  assert.deepStrictEqual(missing, [], `${dir}/${want.file}: source commits missing from Agentic Works`);
}

// Blame reaches back before the import.
const importCommit = git(root, 'log', '--format=%H', '--grep=^Import jay as parts/jay', '-1');
assert.ok(importCommit, 'jay import merge exists');
const blamed = git(root, 'blame', '-s', 'parts/jira/src/extension.js').split('\n')[0].split(' ')[0].replace('^', '');
const blamedFull = git(root, 'rev-parse', blamed);
assert.notStrictEqual(blamedFull, importCommit);
assert.strictEqual(git(root, 'merge-base', '--is-ancestor', blamedFull, `${importCommit}^2`) || 'ok', 'ok');

const agenticWorks = read('agentic-works.json');
assert.match(agenticWorks.version, /^\d+\.\d+\.\d+$/, 'a release version');
assert.deepStrictEqual({ ...agenticWorks, version: undefined }, {
  name: 'agentic-works',
  displayName: 'Agentic Works',
  publisher: 'agenticworks',
  version: undefined,
  description: 'Claude Code and Codex tabs, Teams, Jira & Confluence, pull requests and GitHub repos in one extension.',
  engines: { vscode: '^1.94.0' },
  license: 'MIT',
  repository: 'https://github.com/agenticworks-cloud/agentic-works',
  icon: 'parts/agents/media/icon.png',
  extensionKind: ['workspace'],
  categories: ['AI', 'Chat'],
});
assert.ok(fs.existsSync(path.join(root, agenticWorks.icon)), 'icon exists');

console.log('import.test.js passed');
