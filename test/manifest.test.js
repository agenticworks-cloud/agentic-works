'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'build-manifest.js');
const { buildManifest } = require(script);

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const temps = [];
process.on('exit', () => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// A temp tree with roost.json and two small parts, a (id a) and b (id b).
function fixture(edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-manifest-'));
  temps.push(dir);
  const tree = {
    'roost.json': { name: 'fixture', publisher: 'me', version: '0.0.1', engines: { vscode: '^1.90.0' } },
    'parts/a/part.json': { id: 'a', title: 'Part A', entry: 'src/extension.js', needs: [] },
    'parts/a/package.json': {
      name: 'a',
      activationEvents: ['onStartupFinished', 'onWebviewPanel:a.panel'],
      dependencies: { left: '^1.0.0' },
      extensionPack: ['x.one'],
      contributes: {
        commands: [{ command: 'a.x', title: 'X', icon: '$(gear)' }],
        viewsContainers: { activitybar: [{ id: 'a', title: 'A', icon: 'media/a.svg' }] },
        views: { a: [{ type: 'webview', id: 'a.view', name: 'A' }] },
        menus: {
          'view/title': [
            { command: 'a.x', when: 'view == a.view', group: 'navigation' },
            { command: 'a.x', when: 'view == a.view' },
          ],
        },
        configuration: { title: 'a', properties: { 'a.size': { type: 'number', default: 1 } } },
        keybindings: [
          { command: 'a.x', key: 'ctrl+alt+x' },
          { command: 'a.x', key: 'ctrl+alt+y', when: 'editorFocus' },
        ],
      },
    },
    'parts/b/part.json': { id: 'b', title: 'Part B', entry: 'src/extension.js', needs: ['a'] },
    'parts/b/package.json': {
      name: 'b',
      activationEvents: ['onStartupFinished', 'onCommand:b.y'],
      dependencies: { left: '^1.0.0', right: '^2.0.0' },
      extensionPack: ['x.one', 'x.two'],
      contributes: {
        commands: [{ command: 'b.y', title: 'Y', icon: { light: 'media/l.svg', dark: 'media/d.svg' } }],
        viewsContainers: { panel: [{ id: 'b', title: 'B', icon: 'media/b.svg' }] },
        views: {
          b: [
            { type: 'webview', id: 'b.view', name: 'B', when: 'foo' },
            { id: 'b.plain', name: 'Plain' },
          ],
        },
        menus: { commandPalette: [{ command: 'b.y' }] },
        configuration: [
          { title: 'b one', properties: { 'b.one': { type: 'string', default: '' } } },
          { title: 'b two', properties: { 'b.two': { type: 'boolean', default: false } } },
        ],
      },
    },
  };
  edit(tree);
  for (const [file, value] of Object.entries(tree)) {
    if (value === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
  }
  return dir;
}

const pkg = (tree, part) => tree[`parts/${part}/package.json`];

test('union keeps every id', () => {
  const m = buildManifest(fixture());
  assert.deepStrictEqual(m.contributes.commands.map((c) => c.command), ['a.x', 'b.y']);
  assert.deepStrictEqual(m.contributes.views.a.map((v) => v.id), ['a.view']);
  assert.deepStrictEqual(m.contributes.views.b.map((v) => v.id), ['b.view', 'b.plain']);
  assert.deepStrictEqual(m.contributes.viewsContainers.activitybar.map((v) => v.id), ['a']);
  assert.deepStrictEqual(m.contributes.viewsContainers.panel.map((v) => v.id), ['b']);
  assert.strictEqual(m.name, 'fixture');
  assert.strictEqual(m.main, './src/extension.js');
});

test('when added', () => {
  const m = buildManifest(fixture());
  const views = m.contributes.views.b;
  assert.strictEqual(views[0].when, 'roost.b.enabled && (foo)');
  assert.strictEqual(views[1].when, 'roost.b.enabled');
  assert.strictEqual(m.contributes.views.a[0].when, 'roost.a.enabled');
  assert.deepStrictEqual(
    m.contributes.menus['view/title'].map((e) => e.when),
    ['roost.a.enabled && (view == a.view)', 'roost.a.enabled && (view == a.view)'],
  );
  assert.deepStrictEqual(m.contributes.keybindings.map((k) => k.when), ['roost.a.enabled', 'roost.a.enabled && (editorFocus)']);
  // VS Code ignores `when` on view containers; they hide when all their views are hidden.
  assert.strictEqual(m.contributes.viewsContainers.panel[0].when, undefined);
});

test('every part command is gated in the Command Palette', () => {
  const m = buildManifest(fixture());
  assert.deepStrictEqual(m.contributes.menus.commandPalette, [
    { command: 'a.x', when: 'roost.a.enabled' },
    { command: 'b.y', when: 'roost.b.enabled' },
  ]);
});

test('switch settings first, default true', () => {
  const m = buildManifest(fixture());
  const cfg = m.contributes.configuration;
  assert.strictEqual(Array.isArray(cfg), false);
  assert.strictEqual(cfg.title, 'Roost');
  assert.deepStrictEqual(Object.keys(cfg.properties), ['roost.a.enabled', 'roost.b.enabled', 'a.size', 'b.one', 'b.two']);
  assert.deepStrictEqual(cfg.properties['roost.a.enabled'], {
    type: 'boolean',
    default: true,
    description: 'Part A: switch this part on or off.',
  });
  assert.deepStrictEqual(cfg.properties['b.one'], { type: 'string', default: '' });
});

test('paths rewritten relative to the root', () => {
  const m = buildManifest(fixture());
  assert.strictEqual(m.contributes.viewsContainers.activitybar[0].icon, 'parts/a/media/a.svg');
  assert.strictEqual(m.contributes.viewsContainers.panel[0].icon, 'parts/b/media/b.svg');
  assert.deepStrictEqual(m.contributes.commands[1].icon, { light: 'parts/b/media/l.svg', dark: 'parts/b/media/d.svg' });
  assert.strictEqual(m.contributes.commands[0].icon, '$(gear)');
});

test('activation events, dependencies and extensionPack are unions', () => {
  const m = buildManifest(fixture());
  assert.deepStrictEqual(m.activationEvents, ['onStartupFinished', 'onWebviewPanel:a.panel', 'onCommand:b.y']);
  assert.deepStrictEqual(m.dependencies, { left: '^1.0.0', right: '^2.0.0' });
  assert.deepStrictEqual(m.extensionPack, ['x.one', 'x.two']);
});

test('duplicate command id throws', () => {
  const dir = fixture((t) => pkg(t, 'b').contributes.commands.push({ command: 'a.x', title: 'again' }));
  assert.throws(() => buildManifest(dir), (e) => /a\.x/.test(e.message) && /\ba\b/.test(e.message) && /\bb\b/.test(e.message));
});

test('duplicate view, container, setting and webview ids throw', () => {
  const cases = [
    [(t) => pkg(t, 'b').contributes.views.b.push({ id: 'a.view', name: 'dup' }), /a\.view/],
    [(t) => pkg(t, 'b').contributes.viewsContainers.panel.push({ id: 'a', title: 'dup' }), /container/],
    [(t) => (pkg(t, 'b').contributes.configuration[0].properties['a.size'] = { type: 'number' }), /a\.size/],
    [(t) => (pkg(t, 'b').contributes.configuration[0].properties['roost.a.enabled'] = { type: 'boolean' }), /roost\.a\.enabled/],
    [(t) => pkg(t, 'b').activationEvents.push('onWebviewPanel:a.panel'), /a\.panel/],
  ];
  for (const [edit, re] of cases) assert.throws(() => buildManifest(fixture(edit)), re);
});

test('missing part.json throws', () => {
  const dir = fixture((t) => (t['parts/b/part.json'] = undefined));
  assert.throws(() => buildManifest(dir), /part\.json/);
});

test('unknown needs throws', () => {
  const dir = fixture((t) => (t['parts/b/part.json'].needs = ['nope']));
  assert.throws(() => buildManifest(dir), /nope/);
});

test('two parts with the same id throw', () => {
  const dir = fixture((t) => (t['parts/b/part.json'].id = 'a'));
  assert.throws(() => buildManifest(dir), /parts\/a and parts\/b have the same id a/);
});

test('unknown contribution point throws', () => {
  const dir = fixture((t) => (pkg(t, 'b').contributes.grammars = [{ language: 'x', path: 'syntaxes/x.json' }]));
  assert.throws(() => buildManifest(dir), /parts\/b.*grammars/);
});

test('roost.json may not set generated fields', () => {
  for (const field of ['main', 'activationEvents', 'contributes', 'dependencies', 'extensionPack']) {
    const dir = fixture((t) => (t['roost.json'][field] = field === 'main' ? './x.js' : []));
    assert.throws(() => buildManifest(dir), new RegExp(`roost\\.json.*${field}`), field);
  }
});

test('dependency version conflict throws', () => {
  const dir = fixture((t) => (pkg(t, 'b').dependencies.left = '^9.0.0'));
  assert.throws(() => buildManifest(dir), /left/);
});

test('real tree builds', () => {
  const m = buildManifest(root);
  assert.strictEqual(m.name, 'roost');
  assert.strictEqual(m.version, '0.1.0');
  const containers = Object.values(m.contributes.viewsContainers).flat().map((c) => c.id);
  for (const id of ['perch', 'chirp', 'jay', 'kestrel']) assert.ok(containers.includes(id), `container ${id}`);
  assert.deepStrictEqual(m.contributes.viewsContainers.panel.map((c) => c.id), ['kestrel']);
  assert.ok(m.dependencies['@anthropic-ai/claude-agent-sdk'], 'Claude Agent SDK');
  assert.ok(m.dependencies['@openai/codex-sdk'], 'Codex SDK');
  assert.deepStrictEqual(m.extensionPack, ['seanahn.perch-audio', 'anthropic.claude-code', 'openai.chatgpt']);
  assert.deepStrictEqual(
    Object.keys(m.contributes.configuration.properties).slice(0, 4),
    ['roost.teams.enabled', 'roost.jira.enabled', 'roost.prs.enabled', 'roost.perch.enabled'],
  );
  for (const type of ['perch.session', 'chirp.conversation', 'jay.ticket', 'jay.page']) {
    assert.ok(m.activationEvents.includes(`onWebviewPanel:${type}`), type);
  }
  // Every view and menu entry carries its part's switch; every icon path exists.
  const ids = { chirp: 'teams', jay: 'jira', kestrel: 'prs', perch: 'perch' };
  const switches = Object.values(ids).map((id) => `roost.${id}.enabled`);
  // (roost.openSettings is Roost's own, in no part's switch: asserted in its own test)
  const entries = [...Object.values(m.contributes.views).flat(), ...Object.values(m.contributes.menus).flat()].filter((e) => e.command !== 'roost.openSettings');
  for (const e of entries) assert.ok(switches.some((s) => e.when.startsWith(s)), JSON.stringify(e));
  // Every command of a part is gated in the Command Palette by that part's switch.
  const owner = { perch: 'perch', chirp: 'teams', jay: 'jira', kestrel: 'prs' };
  for (const { command } of m.contributes.commands.filter((c) => c.command !== 'roost.openSettings')) {
    const want = `roost.${owner[command.split('.')[0]]}.enabled`;
    const entries = m.contributes.menus.commandPalette.filter((e) => e.command === command);
    assert.ok(entries.length && entries.every((e) => e.when.startsWith(want)), `${command} gated by ${want}`);
  }
  for (const k of m.contributes.keybindings) assert.ok(switches.some((s) => k.when.startsWith(s)), JSON.stringify(k));
  // Every path in contributes points into a part and exists on disk.
  const pathKeys = new Set(['icon', 'path', 'image', 'markdown', 'svg', 'light', 'dark']);
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (pathKeys.has(k) && typeof x === 'string' && !x.startsWith('$(')) {
        assert.ok(x.startsWith('parts/'), `${k}: ${x} is inside a part`);
        assert.ok(fs.existsSync(path.join(root, x)), `${x} exists`);
      } else walk(x);
    }
  };
  const { configuration, configurationDefaults, ...withPaths } = m.contributes;
  walk(withPaths);
  assert.deepStrictEqual(m.extensionKind, ['workspace']);
  assert.deepStrictEqual(m.categories, ['AI', 'Chat']);
});

test('roost.openSettings is Roost\'s own: in no part\'s switch, on the Perch view\'s title bar', () => {
  const m = buildManifest(root);
  const cmd = m.contributes.commands.find((c) => c.command === 'roost.openSettings');
  assert.deepStrictEqual([cmd.title, cmd.icon], ['Roost: Settings', '$(gear)']);
  assert.deepStrictEqual(m.contributes.menus['view/title'].filter((e) => e.command === 'roost.openSettings'), [
    { command: 'roost.openSettings', when: 'view == perch.main', group: 'navigation@99' },
  ]);
  assert.deepStrictEqual(m.contributes.menus.commandPalette.filter((e) => e.command === 'roost.openSettings'), [], 'always in the Command Palette');
});

test('roost.contributes.json merges without a part switch and may not clash with a part', () => {
  const dir = fixture((t) => (t['roost.contributes.json'] = {
    commands: [{ command: 'roost.x', title: 'Roost: X' }],
    menus: { 'view/title': [{ command: 'roost.x', when: 'view == a.view' }] },
  }));
  const m = buildManifest(dir);
  assert.ok(m.contributes.commands.some((c) => c.command === 'roost.x'));
  assert.ok(m.contributes.menus['view/title'].some((e) => e.command === 'roost.x' && e.when === 'view == a.view'));
  const clash = fixture((t) => (t['roost.contributes.json'] = { commands: [{ command: 'a.x', title: 'again' }] }));
  assert.throws(() => buildManifest(clash), /duplicate command id a\.x/);
  const odd = fixture((t) => (t['roost.contributes.json'] = { grammars: [] }));
  assert.throws(() => buildManifest(odd), /roost\.contributes\.json.*grammars/);
});

test('checked-in manifest equals a fresh build', () => {
  const r = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
if (failed) {
  console.log(`manifest.test.js: ${failed}/${tests.length} failed`);
  process.exit(1);
}
console.log(`manifest.test.js passed (${tests.length} tests)`);
