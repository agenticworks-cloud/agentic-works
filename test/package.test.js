'use strict';
// Checks the .vsix that `make package` builds. Run it through `make test-package`.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'roost.json'), 'utf8'));
const vsix = path.join(root, `roost-${version}.vsix`);
assert.ok(fs.existsSync(vsix), `${path.basename(vsix)} missing: run make package first`);

const files = execFileSync('unzip', ['-Z1', vsix], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n').filter(Boolean);
const has = (f) => files.includes(f);

for (const f of [
  'extension/package.json',
  'extension/src/extension.js',
  'extension/parts/perch/src/extension.js',
  'extension/node_modules/@anthropic-ai/claude-agent-sdk/package.json',
]) assert.ok(has(f), `${f} is in the package`);

for (const part of ['perch', 'chirp', 'jay', 'kestrel']) {
  assert.ok(files.some((f) => f.startsWith(`extension/parts/${part}/media/`)), `parts/${part}/media is in the package`);
}

const bad = files.filter((f) => /\/test\//.test(f) || /\/docs\//.test(f) || /^extension\/parts\/[^/]+\/node_modules\//.test(f) || /\.vsix$/.test(f));
assert.deepStrictEqual(bad, [], 'test, docs, part node_modules and .vsix files stay out of the package');

console.log('package.test.js passed');
