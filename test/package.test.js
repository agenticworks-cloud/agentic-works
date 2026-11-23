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
  // licences: Roost's own (vsce renames LICENSE), and the dependencies' that are .md files
  'extension/LICENSE.txt',
  'extension/node_modules/@anthropic-ai/claude-agent-sdk/LICENSE.md',
  'extension/node_modules/ms/license.md',
  'extension/node_modules/qs/LICENSE.md',
  'extension/node_modules/jose/LICENSE.md',
  'extension/node_modules/json-schema-typed/LICENSE.md',
]) assert.ok(has(f), `${f} is in the package`);

const { readParts } = require(path.join(root, 'src', 'parts.js'));
for (const { dir } of readParts(root).filter((p) => fs.existsSync(path.join(p.dir, 'media')))) {
  const part = path.basename(dir);
  assert.ok(files.some((f) => f.startsWith(`extension/parts/${part}/media/`)), `parts/${part}/media is in the package`);
}

const unwanted = [
  /\/test\//, /\/docs\//, /^extension\/parts\/[^/]+\/node_modules\//, /\.vsix$/,
  // the agents' programs: Perch runs the ones inside the vendors' own extensions
  /^extension\/node_modules\/@anthropic-ai\/claude-agent-sdk-/, /^extension\/node_modules\/@openai\/codex-(linux|darwin|win32)-/,
  /^extension\/node_modules\/.*\.map$/, /^extension\/node_modules\/(?!.*\/licen[cs]e[^/]*$).*\.md$/i, /^extension\/node_modules\/.*\/\.github\//,
  /(^|\/)package-lock\.json$/, /(^|\/)\.env$/, /__pycache__\//,
  /^extension\/parts\/[^/]+\/\.gitignore$/, /^extension\/parts\/[^/]+\/\.vscodeignore$/,
  // read by the manifest build only
  /^extension\/\.gitignore$/, /^extension\/roost\.json$/, /^extension\/roost\.contributes\.json$/,
];
const bad = files.filter((f) => unwanted.some((re) => re.test(f)));
assert.deepStrictEqual(bad.slice(0, 20), [], 'files that stay out of the package');

const mb = fs.statSync(vsix).size / 1048576;
assert.ok(mb < 20, `the package is ${mb.toFixed(1)} MB, over 20 MB`);

console.log('package.test.js passed');
