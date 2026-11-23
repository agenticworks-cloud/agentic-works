'use strict';
// Each part carries its renamed settings over once with its own copy of src/settingsCarryOver.js (parts don't require
// Roost's src/). The copies, and the parts' tests of them, must stay the same; each part calls it with its own prefixes.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { readParts } = require(path.join(root, 'src', 'parts.js'));
const RENAMED = { agents: ['perch', 'agents'], teams: ['chirp', 'teams'], jira: ['jay', 'jira'], pullRequests: ['kestrel', 'pullRequests'] };
const read = (p) => fs.readFileSync(p, 'utf8');

const parts = readParts(root).filter((p) => RENAMED[p.id]);
assert.deepStrictEqual(parts.map((p) => p.id).sort(), Object.keys(RENAMED).sort(), 'the four renamed parts');

const helper = parts.map((p) => read(path.join(p.dir, 'src', 'settingsCarryOver.js')));
for (const [i, p] of parts.entries()) assert.strictEqual(helper[i], helper[0], `parts/${path.basename(p.dir)}/src/settingsCarryOver.js is the same as the others`);

const header = (from, to) => `const FROM = '${from}', TO = '${to}';`;
const tests = parts.map((p) => {
  const [from, to] = RENAMED[p.id];
  const t = read(path.join(p.dir, 'test', 'settingsCarryOver.test.js'));
  assert.ok(t.includes(header(from, to)), `parts/${path.basename(p.dir)}: its test is for ${from} → ${to}`);
  return t.replace(header(from, to), header('FROM', 'TO'));
});
for (const [i, p] of parts.entries()) assert.strictEqual(tests[i], tests[0], `parts/${path.basename(p.dir)}/test/settingsCarryOver.test.js is the same as the others`);

// Each part starts it at activation with its own prefixes and its own package.json's settings.
for (const p of parts) {
  const [from, to] = RENAMED[p.id];
  const src = read(path.join(p.dir, p.entry));
  const call = new RegExp(`carryOverSettings\\(vscode, [\\w.]+, \\{ from: '${from}', to: '${to}', keys: settingKeys\\(require\\('\\.\\./package\\.json'\\), '${to}'\\)`);
  assert.ok(call.test(src), `parts/${path.basename(p.dir)}/${p.entry} carries ${from}.* over to ${to}.*`);
}

console.log('settingsCarryOver.test.js passed');
