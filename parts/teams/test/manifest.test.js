'use strict';
// What ships: package.json for the Marketplace, and nothing in the package that names a company or a particular tool.
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const path = require('path'); const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

/** Files vsce would package: tracked files minus the .vscodeignore patterns (the simple forms chirp uses). */
function shipped() {
  const ignore = fs.readFileSync(path.join(root, '.vscodeignore'), 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
  const hit = (f, p) => (p.endsWith('/**') ? f.startsWith(p.slice(0, -2)) : p.startsWith('*.') ? f.endsWith(p.slice(1)) : f === p);
  return out.filter((f) => !ignore.some((p) => hit(f, p)));
}

test('package.json has the listing icon and the new settings', () => {
  assert.strictEqual(pkg.version, '0.2.5');
  assert.strictEqual(pkg.icon, 'media/listing-icon.png');
  const png = fs.readFileSync(path.join(root, pkg.icon));
  assert.deepStrictEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'a PNG');
  assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [128, 128], '128×128');
  const props = pkg.contributes.configuration.properties;
  assert.strictEqual(props['teams.signIn.method'].default, 'auto');
  assert.deepStrictEqual(props['teams.signIn.method'].enum, ['auto', 'editor', 'deviceCode', 'tokenFile']);
  assert.strictEqual(props['teams.signIn.tokenFile'].default, '');
  assert.strictEqual(props['teams.agentFiles'].default, true);
  for (const k of ['teams.signIn.clientId', 'teams.signIn.tenant']) {
    assert.strictEqual(props[k].type, 'string'); assert.strictEqual(props[k].default, '', `${k}: empty means chirp's own app`);
    assert.match(props[k].markdownDescription, /IT/);
  }
  assert.match(props['teams.signIn.clientId'].markdownDescription, /public client flows/);
  assert.match(props['teams.signIn.clientId'].markdownDescription, /redirect/);
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'chirp.useCompanyApp' && c.title === 'Teams: Use a Company Microsoft App…'));
  assert.match(pkg.description, /Not affiliated with Microsoft\.$/);
  assert.deepStrictEqual(pkg.keywords, ['teams', 'chat', 'microsoft 365', 'agent']);
});

test('no tool names ship (company names: Roost\'s test/noCompanyNames.test.js)', () => {
  const files = shipped();
  assert.ok(files.includes('src/extension.js') && files.includes('README.md'), 'the scan sees the shipped files');
  assert.ok(!files.some((f) => f.startsWith('test/') || f.startsWith('docs/')), 'tests and docs do not ship');
  const found = [];
  for (const f of files) {
    if (/\.(png)$/.test(f)) continue;
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    for (const m of text.matchAll(/ms365|zig/gi)) found.push(`${f}: …${text.slice(Math.max(0, m.index - 20), m.index + 20)}…`);
  }
  assert.deepStrictEqual(found, []);
});

test('the Activity Bar says Teams', () => {
  assert.strictEqual(pkg.contributes.viewsContainers.activitybar[0].title, 'Teams', 'the hover text on the icon');
  assert.strictEqual(pkg.contributes.views.chirp[0].name, 'Chats and Channels', 'so the heading reads "Teams: Chats and Channels"');
});
