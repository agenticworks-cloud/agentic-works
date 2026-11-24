'use strict';
// Roost's loader: starts each enabled part with a context of its own, starts and stops parts as their
// roost.<id>.enabled setting changes, and isolates a part that throws, marking it with the context key
// roost.<id>.failed (its views and commands are gated on the setting and that key). Fake parts live in temp dirs.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stub = require('./vscodeStub');

const src = path.join(__dirname, '..', 'src');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const temps = [];
process.on('exit', () => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// The four folders and ids of the real parts; a fake part's activate/deactivate call into `fake.parts[id]`.
const FOLDERS = { agents: ['agents', 'Agents (Claude Code and Codex)'], jira: ['jira', 'Jira & Confluence'], 'pull-requests': ['pullRequests', 'PRs'], teams: ['teams', 'Teams'] };
const fake = { parts: {}, calls: [] };
global.__roostFake = fake;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-loader-'));
  temps.push(root);
  for (const [folder, [id, title]] of Object.entries(FOLDERS)) {
    const dir = path.join(root, 'parts', folder);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'part.json'), JSON.stringify({ id, title, entry: 'src/extension.js', needs: [] }));
    fs.writeFileSync(
      path.join(dir, 'src', 'extension.js'),
      `const f = global.__roostFake;
module.exports = {
  activate: (context, deps) => { f.calls.push(['activate', ${JSON.stringify(id)}, deps]); const p = f.parts[${JSON.stringify(id)}]; return p && p.activate ? p.activate(context) : undefined; },
  deactivate: () => { f.calls.push(['deactivate', ${JSON.stringify(id)}]); const p = f.parts[${JSON.stringify(id)}]; return p && p.deactivate ? p.deactivate() : undefined; },
  confirmStop: () => { f.calls.push(['confirmStop', ${JSON.stringify(id)}]); const p = f.parts[${JSON.stringify(id)}]; return p && p.confirmStop ? p.confirmStop() : Promise.resolve(true); },
};\n`,
    );
  }
  // jay's webview types, as its package.json names them
  fs.writeFileSync(path.join(root, 'parts', 'jira', 'package.json'), JSON.stringify({
    activationEvents: ['onStartupFinished', 'onWebviewPanel:jay.ticket', 'onCommand:jay.open', 'onWebviewPanel:jay.page'],
  }));
  return root;
}

// A fresh vscode stub, a fresh copy of Roost, and a base context rooted at a fresh fixture.
function setup(config = {}) {
  const ui = stub.install();
  ui.config = config;
  for (const f of ['extension.js', 'parts.js']) delete require.cache[path.join(src, f)];
  const extension = require(path.join(src, 'extension.js'));
  const root = fixture();
  const globalState = { get: () => undefined, update: async () => {} };
  const base = {
    subscriptions: [],
    extensionPath: root,
    extensionUri: ui.vscode.Uri.file(root),
    asAbsolutePath: (rel) => path.join(root, rel),
    globalState,
    workspaceState: { get: () => undefined, update: async () => {} },
    secrets: { get: async () => undefined, store: async () => {} },
    globalStorageUri: ui.vscode.Uri.file(path.join(root, 'global')),
    storageUri: ui.vscode.Uri.file(path.join(root, 'ws')),
    logUri: ui.vscode.Uri.file(path.join(root, 'log')),
    extensionMode: 1,
    extension: { id: 'seanahn.roost' },
  };
  fake.parts = {};
  fake.calls = [];
  process.env.ROOST_COMPANY_FILE = path.join(root, 'no-company.json');   // none, unless a test writes one
  return { ui, extension, root, base };
}

// Roost's activate returns before its parts have started; `ready` settles once every enabled part's start has.
async function activate(extension, base, options = { ghLogins: async () => [] }) {   // never the machine's own gh
  const roost = await extension.activate(base, options);
  await roost.ready;
  return roost;
}
const activated = () => fake.calls.filter((c) => c[0] === 'activate').map((c) => c[1]);
const tick = () => new Promise((r) => setImmediate(r));
/** `p`, or 'timed out' if it has not settled within `ms`. */
const within = (p, ms = 1000) => Promise.race([p, new Promise((r) => setTimeout(() => r('timed out'), ms))]);
// Fires a change of roost.<id>.enabled and lets the start or stop it causes finish.
async function setEnabled(ui, id, on) {
  ui.config[`roost.${id}.enabled`] = on;
  ui.changeConfig([`roost.${id}.enabled`]);
  for (let i = 0; i < 5; i++) await tick();
}

test('enabled parts start, disabled do not', async () => {
  const { ui, extension, base } = setup({ 'roost.teams.enabled': false });
  const roost = await activate(extension, base);
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests']);
  assert.ok(fake.calls.every((c) => c[0] !== 'activate' || c[2] === undefined), 'no deps passed');
  assert.deepStrictEqual(ui.contexts, {
    'roost.teams.failed': false,
    'roost.jira.failed': false,
    'roost.pullRequests.failed': false,
    'roost.agents.failed': false,
    'roost.company': false,
    'roost.companyTools': false,
  });
  assert.strictEqual(roost.state('teams'), 'off');
  assert.strictEqual(roost.state('agents'), 'on');
  await extension.deactivate();
});

test('0.1.0\'s roost.perch.enabled still decides Agents until roost.agents.enabled is set', async () => {
  let { extension, base } = setup({ 'roost.perch.enabled': false });
  await activate(extension, base);
  assert.deepStrictEqual([...activated()].sort(), ['jira', 'pullRequests', 'teams'], 'Agents off, as Perch was');
  await extension.deactivate();
  ({ extension, base } = setup({ 'roost.perch.enabled': false, 'roost.agents.enabled': true }));
  await activate(extension, base);
  assert.ok(activated().includes('agents'), 'the new switch wins once set');
  await extension.deactivate();
});

test('roost.openSettings is registered with every part off and opens Roost\'s settings', async () => {
  const { ui, extension, base } = setup({ 'roost.teams.enabled': false, 'roost.jira.enabled': false, 'roost.pullRequests.enabled': false, 'roost.agents.enabled': false });
  await activate(extension, base);
  assert.deepStrictEqual(activated(), []);
  const opened = [];
  ui.commands['workbench.action.openSettings'] = (...a) => opened.push(a);
  await ui.vscode.commands.executeCommand('roost.openSettings');
  assert.deepStrictEqual(opened, [['@ext:seanahn.roost']]);
  await extension.deactivate();
});

test('every failed key is cleared before any part starts', async () => {
  const { ui, extension, base } = setup({ 'roost.teams.enabled': false });
  ui.asyncSetContext = true;                          // applied later, in the order sent, as VS Code applies them
  let sentBefore = null;
  fake.parts.jira = { activate: () => { sentBefore = ui.sent.slice(); } };
  fake.parts.pullRequests = { activate: () => { throw new Error('boom'); } };
  await activate(extension, base);
  await ui.applied;
  assert.deepStrictEqual(sentBefore.filter(([k]) => k.endsWith('.failed')), [
    ['roost.agents.failed', false],
    ['roost.jira.failed', false],
    ['roost.pullRequests.failed', false],
    ['roost.teams.failed', false],
  ], 'every key false is sent before the first part starts (a key left from before an extension host restart)');
  assert.deepStrictEqual(ui.contexts, {
    'roost.teams.failed': false,
    'roost.jira.failed': false,
    'roost.pullRequests.failed': true,
    'roost.agents.failed': false,
    'roost.company': false,
    'roost.companyTools': false,
  }, 'and none of those lands after its part was marked failed');
  await extension.deactivate();
});

test('a context key that cannot be set is logged', async () => {
  const { ui, extension, base } = setup();
  ui.failSetContext = 1;
  const roost = await activate(extension, base);
  assert.ok(ui.out.some((l) => l.includes('setContext failed')));
  for (const id of ['agents', 'jira', 'pullRequests', 'teams']) assert.strictEqual(roost.state(id), 'on', id);
  await extension.deactivate();
});

test('switching a part off or on sets no context key: the setting gates its views', async () => {
  const { ui, extension, base } = setup();
  const roost = await activate(extension, base);
  ui.sent.length = 0;
  await setEnabled(ui, 'agents', false);
  assert.strictEqual(roost.state('agents'), 'off');
  assert.ok(fake.calls.some((c) => c[0] === 'deactivate' && c[1] === 'agents'));
  await setEnabled(ui, 'agents', true);
  assert.strictEqual(roost.state('agents'), 'on');
  assert.deepStrictEqual(ui.sent, []);
  await extension.deactivate();
});

test('the window closing releases every part without waiting on a context key', async () => {
  const { ui, extension, base } = setup();
  fake.parts.pullRequests = { activate: () => { throw new Error('boom'); } };   // failed: its key is true
  await activate(extension, base);
  ui.sent.length = 0;
  fake.calls.length = 0;
  const run = ui.vscode.commands.executeCommand;
  ui.vscode.commands.executeCommand = (id, ...a) => (id === 'setContext' ? new Promise(() => {}) : run(id, ...a));   // never answered
  assert.notStrictEqual(await within(extension.deactivate()), 'timed out', 'deactivate returned');
  assert.deepStrictEqual(fake.calls.filter((c) => c[0] === 'deactivate').map((c) => c[1]).sort(), ['agents', 'jira', 'teams']);
  assert.deepStrictEqual(ui.sent, [], 'no context key set while closing');
});

test('a part that throws after registering its own serializer still fails cleanly', async () => {
  const { ui, extension, base } = setup();
  fake.parts.jira = {
    activate: () => {
      ui.vscode.window.registerWebviewPanelSerializer('jay.ticket', { deserializeWebviewPanel: async () => {} });   // not in its subscriptions
      throw new Error('boom');
    },
  };
  const roost = await activate(extension, base);
  assert.strictEqual(roost.state('jira'), 'failed');
  assert.strictEqual(ui.contexts['roost.jira.failed'], true);
  assert.deepStrictEqual(ui.errors, [{ message: 'Roost: Jira & Confluence could not start.', items: ['Show Log'] }]);
  assert.strictEqual(ui.restorePanel('jay.ticket').disposed, true, 'its leftover serializer is removed, so its tabs close too');
  assert.strictEqual(ui.restorePanel('jay.page').disposed, true, 'its other type is still closed while it is off');
  assert.ok(!ui.out.some((l) => l.includes('cannot be closed')), JSON.stringify(ui.out));
  await extension.deactivate();
});

test('a part that left a serializer outside its subscriptions can be retried', async () => {
  const { ui, extension, base } = setup();
  const original = ui.vscode.window.registerWebviewPanelSerializer;
  let fail = true;
  fake.parts.jira = {
    activate: () => {
      ui.vscode.window.registerWebviewPanelSerializer('jay.ticket', { deserializeWebviewPanel: async (p) => { p.restoredBy = 'jay'; } });   // not in its subscriptions
      if (fail) throw new Error('boom');
    },
  };
  const roost = await activate(extension, base);
  assert.strictEqual(roost.state('jira'), 'failed');
  fail = false;
  await setEnabled(ui, 'jira', false);
  await setEnabled(ui, 'jira', true);
  assert.strictEqual(roost.state('jira'), 'on', ui.out.join('\n'));
  assert.strictEqual(ui.contexts['roost.jira.failed'], false);
  assert.strictEqual(ui.restorePanel('jay.ticket').restoredBy, 'jay');
  // a normal stop removes it too, and the part starts again
  await setEnabled(ui, 'jira', false);
  assert.strictEqual(ui.restorePanel('jay.ticket').disposed, true, 'closed while off');
  await setEnabled(ui, 'jira', true);
  assert.strictEqual(roost.state('jira'), 'on', ui.out.join('\n'));
  await extension.deactivate();
  assert.deepStrictEqual(Object.keys(ui.serializers), [], 'none left once Roost stops');
  assert.strictEqual(ui.vscode.window.registerWebviewPanelSerializer, original, "VS Code's own function is put back");
});

test('readParts lists parts in folder order', async () => {
  const { root } = setup();
  const { readParts } = require(path.join(src, 'parts.js'));
  const parts = readParts(root);
  assert.deepStrictEqual(parts.map((p) => p.id), ['agents', 'jira', 'pullRequests', 'teams']);
  assert.deepStrictEqual(parts[1], {
    id: 'jira', title: 'Jira & Confluence', dir: path.join(root, 'parts', 'jira'), entry: 'src/extension.js', needs: [],
    webviews: ['jay.ticket', 'jay.page'],
  });
  assert.deepStrictEqual(parts[0].webviews, [], 'a part without a package.json has none');
});

test('part context points at the part folder', async () => {
  const { extension, root, base } = setup();
  // a remote window's extension URI: the part's keeps its scheme and authority
  base.extensionUri = { scheme: 'vscode-remote', authority: 'ssh-remote+box', path: root, fsPath: root };
  let got = null;
  fake.parts.jira = { activate: (c) => { got = c; } };
  await activate(extension, base);
  const dir = path.join(root, 'parts', 'jira');
  assert.strictEqual(got.extensionUri.scheme, 'vscode-remote');
  assert.strictEqual(got.extensionUri.authority, 'ssh-remote+box');
  assert.strictEqual(got.extensionUri.path, `${root}/parts/jira`);
  assert.strictEqual(got.extensionUri.fsPath, dir);
  assert.strictEqual(got.extensionPath, dir);
  assert.strictEqual(got.asAbsolutePath('media/x.svg'), path.join(dir, 'media/x.svg'));
  for (const k of ['globalState', 'workspaceState', 'secrets', 'storageUri', 'globalStorageUri', 'logUri', 'extensionMode', 'extension']) {
    assert.strictEqual(got[k], base[k], k);
  }
  assert.deepStrictEqual(got.subscriptions, []);
  assert.notStrictEqual(got.subscriptions, base.subscriptions);
  await extension.deactivate();
});

test('part context reads getters of a frozen base lazily', async () => {
  const { base } = setup();
  const { partContext } = require(path.join(src, 'parts.js'));
  let reads = 0;
  const frozen = Object.freeze({
    ...base,
    get environmentVariableCollection() { reads++; return 'evc'; },
  });
  const ctx = partContext(frozen, { id: 'x', title: 'X', dir: '/tmp/x', entry: 'src/extension.js', needs: [] });
  assert.strictEqual(reads, 0, 'no getter read while building the context');
  assert.strictEqual(ctx.environmentVariableCollection, 'evc');
  assert.strictEqual(ctx.extensionPath, '/tmp/x');
  assert.deepStrictEqual(ctx.subscriptions, []);
});

test('a throwing part leaves the others running', async () => {
  const { ui, extension, base } = setup();
  let fail = true;
  fake.parts.jira = { activate: async () => { if (fail) throw new Error('boom'); } };
  const roost = await activate(extension, base);
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams']);
  assert.strictEqual(roost.state('jira'), 'failed');
  for (const id of ['agents', 'pullRequests', 'teams']) assert.strictEqual(roost.state(id), 'on', id);
  assert.strictEqual(ui.contexts['roost.jira.failed'], true);
  assert.deepStrictEqual(ui.errors, [{ message: 'Roost: Jira & Confluence could not start.', items: ['Show Log'] }]);
  assert.ok(ui.out.some((l) => l.includes('boom')), 'error in the Roost output channel');

  fail = false;
  await setEnabled(ui, 'jira', false);
  assert.strictEqual(roost.state('jira'), 'off');
  assert.strictEqual(ui.contexts['roost.jira.failed'], true, 'off but failed: still marked until it starts');
  await setEnabled(ui, 'jira', true);
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams', 'jira']);
  assert.strictEqual(roost.state('jira'), 'on');
  assert.strictEqual(ui.contexts['roost.jira.failed'], false);
  assert.strictEqual(ui.errors.length, 1);
  await extension.deactivate();
});

test('"Show Log" shows the Roost output channel', async () => {
  const { ui, extension, base } = setup();
  ui.errorChoice = 'Show Log';
  fake.parts.pullRequests = { activate: () => { throw new Error('nope'); } };
  await activate(extension, base);
  await tick();
  assert.strictEqual(ui.shown, 1);
  await extension.deactivate();
});

test('off then on registers cleanly and leaves no timer', async () => {
  const { ui, extension, base } = setup();
  const live = new Set();
  const realSet = global.setInterval, realClear = global.clearInterval;
  global.setInterval = (fn, ms) => { const t = realSet(fn, ms); t.unref(); live.add(t); return t; };
  global.clearInterval = (t) => { live.delete(t); realClear(t); };
  try {
    fake.parts.teams = {
      activate: (c) => {
        c.subscriptions.push(ui.vscode.commands.registerCommand('chirp.refresh', () => {}));
        const t = setInterval(() => {}, 60000);
        c.subscriptions.push({ dispose: () => clearInterval(t) });
      },
    };
    const roost = await activate(extension, base);
    assert.ok(ui.commands['chirp.refresh']);
    assert.strictEqual(live.size, 1);

    await setEnabled(ui, 'teams', false);
    assert.strictEqual(roost.state('teams'), 'off');
    assert.strictEqual(live.size, 0, 'timer cleared');
    assert.strictEqual(ui.commands['chirp.refresh'], undefined, 'command unregistered');
    assert.strictEqual(ui.contexts['roost.teams.failed'], false);
    assert.ok(fake.calls.some((c) => c[0] === 'deactivate' && c[1] === 'teams'));

    await setEnabled(ui, 'teams', true);
    assert.strictEqual(roost.state('teams'), 'on');
    assert.deepStrictEqual(ui.errors, [], 'no duplicate-command error');
    assert.ok(ui.commands['chirp.refresh']);
    await extension.deactivate();
    assert.strictEqual(live.size, 0, 'deactivate stops the part too');
  } finally {
    global.setInterval = realSet;
    global.clearInterval = realClear;
  }
});

test('stop survives a throwing dispose', async () => {
  const { ui, extension, base } = setup();
  const disposed = [];
  fake.parts.pullRequests = {
    activate: (c) => {
      c.subscriptions.push({ dispose: () => disposed.push('a') });
      c.subscriptions.push({ dispose: () => { throw new Error('bad dispose'); } });
      c.subscriptions.push({ dispose: () => disposed.push('c') });
    },
    deactivate: () => { throw new Error('bad deactivate'); },
  };
  const roost = await activate(extension, base);
  await roost.stop('pullRequests');
  assert.strictEqual(roost.state('pullRequests'), 'off');
  assert.deepStrictEqual(disposed.sort(), ['a', 'c']);
  assert.strictEqual(ui.contexts['roost.pullRequests.failed'], false);
  assert.ok(ui.out.some((l) => l.includes('bad dispose')));
  await roost.start('pullRequests');
  assert.strictEqual(roost.state('pullRequests'), 'on');
  await extension.deactivate();
});

test('switching Agents off mid-turn asks first', async () => {
  const { ui, extension, base } = setup();
  let answer = false;
  fake.parts.agents = { confirmStop: async () => answer };
  const roost = await activate(extension, base);
  const asked = () => fake.calls.filter((c) => c[0] === 'confirmStop').map((c) => c[1]);

  ui.inspect['roost.agents.enabled'] = { defaultValue: true, globalValue: true, workspaceValue: false };   // switched off for this workspace
  await setEnabled(ui, 'agents', false);
  assert.deepStrictEqual(asked(), ['agents']);
  assert.strictEqual(roost.state('agents'), 'on', 'cancelled: still on');
  assert.deepStrictEqual(ui.updates, [['roost.agents.enabled', undefined, 2]], 'the switch is put back, in the workspace: its value there removed, as the user setting is on');
  assert.strictEqual(ui.contexts['roost.agents.failed'], false);
  assert.ok(!fake.calls.some((c) => c[0] === 'deactivate'), 'not stopped');
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams'], 'and not started a second time');

  answer = true;
  await setEnabled(ui, 'agents', false);
  assert.strictEqual(roost.state('agents'), 'off');
  assert.strictEqual(ui.contexts['roost.agents.failed'], false);
  assert.strictEqual(ui.updates.length, 1, 'nothing written back');

  await setEnabled(ui, 'agents', true);
  await extension.deactivate();                       // the window closing: nothing is asked
  assert.deepStrictEqual(asked(), ['agents', 'agents']);
  assert.strictEqual(roost.state('agents'), 'off');
});

test('the switch is put back as it was at that scope', async () => {
  const { ui, extension, base } = setup();
  fake.parts.agents = { confirmStop: async () => false };
  await activate(extension, base);
  const cases = [
    [{ defaultValue: true, globalValue: false }, ['roost.agents.enabled', undefined, 1], 'user setting off: removed, the default is on'],
    [{ defaultValue: true, globalValue: false, workspaceValue: false }, ['roost.agents.enabled', true, 2], 'off for the user too: true in the workspace'],
    [{ defaultValue: false }, ['roost.agents.enabled', true, 1], 'a default that is off: true for the user'],
  ];
  for (const [inspect, want, why] of cases) {
    ui.updates.length = 0;
    ui.inspect['roost.agents.enabled'] = inspect;
    await setEnabled(ui, 'agents', false);
    assert.deepStrictEqual(ui.updates, [want], why);
  }
  await extension.deactivate();
});

test("a confirmStop that throws does not keep the part on", async () => {
  const { ui, extension, base } = setup();
  fake.parts.agents = { confirmStop: async () => { throw new Error('no dialog'); } };
  const roost = await activate(extension, base);
  await setEnabled(ui, 'agents', false);
  assert.strictEqual(roost.state('agents'), 'off');
  assert.ok(ui.out.some((l) => l.includes('no dialog')));
  await extension.deactivate();
});

test("off part's restored panel is closed", async () => {
  const { ui, extension, base } = setup({ 'roost.jira.enabled': false });
  fake.parts.jira = {
    activate: (c) => {
      for (const t of ['jay.ticket', 'jay.page']) {
        c.subscriptions.push(ui.vscode.window.registerWebviewPanelSerializer(t, { deserializeWebviewPanel: async (p) => { p.restoredBy = 'jay'; } }));
      }
    },
  };
  const roost = await activate(extension, base);
  for (const t of ['jay.ticket', 'jay.page']) assert.strictEqual(ui.restorePanel(t).disposed, true, `${t} closed while jira is off`);
  assert.deepStrictEqual(Object.keys(ui.serializers).sort(), ['jay.page', 'jay.ticket'], 'only the off part has serializers');

  await setEnabled(ui, 'jira', true);
  assert.strictEqual(roost.state('jira'), 'on');
  assert.deepStrictEqual(ui.errors, [], 'no duplicate-serializer error');
  const p = ui.restorePanel('jay.ticket');
  assert.deepStrictEqual([p.disposed, p.restoredBy], [false, 'jay'], 'the part restores its own tabs once on');

  await setEnabled(ui, 'jira', false);
  assert.strictEqual(ui.restorePanel('jay.page').disposed, true, 'closed again once off');
  await setEnabled(ui, 'jira', true);
  assert.strictEqual(roost.state('jira'), 'on');
  await extension.deactivate();
  assert.deepStrictEqual(Object.keys(ui.serializers), [], 'none left once Roost stops');
});

test("a part that fails to start closes its restored panels", async () => {
  const { ui, extension, base } = setup();
  fake.parts.jira = {
    activate: (c) => {
      c.subscriptions.push(ui.vscode.window.registerWebviewPanelSerializer('jay.ticket', { deserializeWebviewPanel: async () => {} }));
      throw new Error('boom');
    },
  };
  const roost = await activate(extension, base);
  assert.strictEqual(roost.state('jira'), 'failed');
  assert.strictEqual(ui.restorePanel('jay.ticket').disposed, true);
  assert.strictEqual(ui.restorePanel('jay.page').disposed, true);
  await extension.deactivate();
});

test('a setting change after Roost has stopped starts nothing', async () => {
  const { ui, extension, base } = setup({ 'roost.pullRequests.enabled': false });
  const roost = await activate(extension, base);
  await extension.deactivate();
  const n = activated().length;
  await setEnabled(ui, 'pullRequests', true);
  assert.strictEqual(activated().length, n);
  assert.strictEqual(roost.state('pullRequests'), 'off');
});

test('a part whose activate never ends blocks neither Roost nor the others', async () => {
  const { extension, base } = setup();
  fake.parts.teams = { activate: () => new Promise(() => {}) };
  const roost = await within(extension.activate(base, { ghLogins: async () => [] }));
  assert.notStrictEqual(roost, 'timed out', "Roost's activate returned");
  for (let i = 0; i < 10; i++) await tick();
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams']);
  for (const id of ['agents', 'jira', 'pullRequests']) assert.strictEqual(roost.state(id), 'on', id);
});

test('a failed start or stop does not block later ones', async () => {
  const { ui, extension, base } = setup();
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let answer = false;
    fake.parts.pullRequests = { confirmStop: async () => answer };
    const roost = await activate(extension, base);
    ui.failUpdate = 'settings are read-only';
    await setEnabled(ui, 'pullRequests', false);               // its stop rejects: the switch cannot be put back
    assert.ok(ui.out.some((l) => l.includes('settings are read-only')), 'the failure is in the Roost output channel');
    ui.failUpdate = null; answer = true;
    await setEnabled(ui, 'pullRequests', true);
    await setEnabled(ui, 'pullRequests', false);               // and the next stop still runs
    assert.strictEqual(roost.state('pullRequests'), 'off');
    assert.strictEqual(ui.contexts['roost.pullRequests.failed'], false);
    await setEnabled(ui, 'pullRequests', true);
    assert.strictEqual(roost.state('pullRequests'), 'on');
    await tick();
    assert.deepStrictEqual(unhandled, [], 'no unhandled rejection');
    await extension.deactivate();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
});

// First start: a memento for globalState shared by two activations; the PRs view command is recorded.
function firstStartSetup(config) {
  const env = setup(config);
  const store = new Map();
  env.base.globalState = { get: (k) => store.get(k), update: async (k, v) => { store.set(k, v); } };
  env.store = store;
  env.opened = [];
  env.ui.commands['workbench.view.extension.kestrel'] = () => { env.opened.push(1); };
  env.order = [];
  env.ui.commands['workbench.view.extension.perch'] = () => { env.order.push('perch'); };
  const prs = env.ui.commands['workbench.view.extension.kestrel'];
  env.ui.commands['workbench.view.extension.kestrel'] = () => { env.order.push('prs'); prs(); };
  env.walkthroughs = [];
  env.ui.commands['workbench.action.openWalkthrough'] = (...a) => { env.order.push('walkthrough'); env.walkthroughs.push(a); };
  return env;
}
async function activateFirst(env) {
  const roost = await env.extension.activate(env.base, { ghLogins: async () => [] });
  await roost.firstStarted;
  return roost;
}

test('first start: PRs on opens the PRs tab once and records it', async () => {
  const env = firstStartSetup({});
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 1);
  assert.strictEqual(env.store.get('roost.firstStart.done'), true);
  await env.extension.deactivate();
  env.base.subscriptions.splice(0).forEach((d) => d.dispose());
  env.ui.commands = { 'workbench.view.extension.kestrel': env.ui.commands['workbench.view.extension.kestrel'], 'workbench.action.openWalkthrough': env.ui.commands['workbench.action.openWalkthrough'] };
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 1, 'a second activation does not open it');
  assert.strictEqual(env.walkthroughs.length, 1, 'nor the walkthrough');
  await env.extension.deactivate();
});

test('first start: PRs off opens nothing and still records', async () => {
  const env = firstStartSetup({ 'roost.pullRequests.enabled': false });
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 0);
  assert.deepStrictEqual(env.walkthroughs, [['seanahn.roost#roost.getStarted', false]], 'the walkthrough still opens');
  assert.strictEqual(env.store.get('roost.firstStart.done'), true);
  await env.extension.deactivate();
});

test('first start: a failing command is logged and still recorded', async () => {
  const env = firstStartSetup({});
  env.ui.commands['workbench.view.extension.kestrel'] = () => { throw new Error('no such view'); };
  await activateFirst(env);
  assert.ok(env.ui.out.some((l) => l.includes('PRs tab') && l.includes('no such view')));
  assert.strictEqual(env.store.get('roost.firstStart.done'), true);
  await env.extension.deactivate();
});

test('first start: the PRs tab, the walkthrough in the editor, then the Perch view; Perch only while Agents is on', async () => {
  let env = firstStartSetup({});
  await activateFirst(env);
  assert.deepStrictEqual(env.order, ['prs', 'walkthrough', 'perch']);
  await env.extension.deactivate();
  env = firstStartSetup({ 'roost.agents.enabled': false });
  await activateFirst(env);
  assert.deepStrictEqual(env.order, ['prs', 'walkthrough']);
  await env.extension.deactivate();
  env = firstStartSetup({});
  env.ui.commands['workbench.view.extension.perch'] = () => { throw new Error('no perch'); };
  await activateFirst(env);
  assert.ok(env.ui.out.some((l) => l.includes('Perch view') && l.includes('no perch')));
  assert.deepStrictEqual(env.order, ['prs', 'walkthrough'], 'the rest still opens');
  assert.strictEqual(env.store.get('roost.firstStart.done'), true);
  await env.extension.deactivate();
});

test('first start: a walkthrough that fails to open is logged and still recorded', async () => {
  const env = firstStartSetup({});
  env.ui.commands['workbench.action.openWalkthrough'] = () => { throw new Error('no walkthrough'); };
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 1, 'the PRs tab opened first');
  assert.ok(env.ui.out.some((l) => l.includes('walkthrough') && l.includes('no walkthrough')));
  assert.strictEqual(env.store.get('roost.firstStart.done'), true);
  await env.extension.deactivate();
});

test('Roost: Get Started opens the walkthrough; Roost: Sign In to GitHub runs gh auth login in a terminal, and refreshes the PRs when it closes', async () => {
  const { ui, extension, base } = setup({});
  await (await activate(extension, base)).firstStarted;   // its own walkthrough call done first
  const opened = [];
  ui.commands['workbench.action.openWalkthrough'] = (...a) => opened.push(a);
  await ui.vscode.commands.executeCommand('roost.getStarted');
  assert.deepStrictEqual(opened, [['seanahn.roost#roost.getStarted', false]]);
  await ui.vscode.commands.executeCommand('roost.githubSignIn');
  assert.strictEqual(ui.terminals.length, 1);
  assert.ok(ui.terminals[0].shown);
  assert.deepStrictEqual(ui.terminals[0].sent, ['gh auth login --hostname github.com --git-protocol https --web && exit']);
  const refreshed = [];
  ui.commands['kestrel.refresh'] = () => { refreshed.push(1); };
  ui.closeTerminal({ name: 'another terminal' });
  assert.deepStrictEqual(refreshed, [], 'another terminal closing does nothing');
  ui.closeTerminal(ui.terminals[0]);
  assert.deepStrictEqual(refreshed, [1], 'the sign-in terminal closing refreshes the PRs');
  assert.strictEqual(ui.closeListeners(), 0, 'the listener is disposed');
  ui.closeTerminal(ui.terminals[0]);
  assert.deepStrictEqual(refreshed, [1]);
  delete ui.commands['kestrel.refresh'];
  await ui.vscode.commands.executeCommand('roost.githubSignIn');
  ui.closeTerminal(ui.terminals[1]);   // the PRs part off: kestrel.refresh is not found, and that is ignored
  await new Promise((r) => setImmediate(r));
  await extension.deactivate();
});

test('Roost: Sign In to GitHub, already signed in: says who, opens no terminal unless another account is asked for', async () => {
  const { ui, extension, base } = setup({});
  await (await activate(extension, base, { ghLogins: async () => ['octocat'] })).firstStarted;
  ui.infos = [];
  await ui.vscode.commands.executeCommand('roost.githubSignIn');
  assert.ok(ui.infos.some((m) => m.includes('signed in as octocat')), 'says who is signed in');
  assert.strictEqual((ui.terminals || []).length, 0, 'no sign-in terminal');
  await extension.deactivate();
});

test('Roost: Turn On Codebase Search turns it on through Perch\'s toggle, never off; Not Now does nothing; so does Connect Claude\'s Not Now', async () => {
  const { ui, extension, base } = setup({});
  await (await activate(extension, base)).firstStarted;
  const toggled = [];
  ui.commands['perch.codebaseIndex.toggle'] = () => toggled.push(1);
  await ui.vscode.commands.executeCommand('roost.codebaseSearchOn');
  assert.strictEqual(toggled.length, 1, 'off: turned on');
  ui.config['agents.codebaseIndex.enabled'] = true;
  await ui.vscode.commands.executeCommand('roost.codebaseSearchOn');
  assert.strictEqual(toggled.length, 1, 'already on: not toggled off');
  await ui.vscode.commands.executeCommand('roost.codebaseSearchNotNow');
  assert.strictEqual(toggled.length, 1);
  await ui.vscode.commands.executeCommand('roost.connectClaudeNotNow');   // Connect Claude's Not Now: registered, and does nothing
  await assert.rejects(() => ui.vscode.commands.executeCommand('roost.gatewayNotNow'), /not found|gatewayNotNow/, 'the gateway step\'s Not Now is gone');
  assert.strictEqual(toggled.length, 1);
  const opened = [];
  ui.commands['perch.open'] = () => opened.push(1);
  await ui.vscode.commands.executeCommand('roost.goToClaude');
  assert.strictEqual(opened.length, 1, 'Go to Your Agent Tab is Agents: Open');
  const made = [];
  ui.commands['perch.newClaude'] = () => made.push('claude');
  ui.commands['perch.newCodex'] = () => made.push('codex');
  await ui.vscode.commands.executeCommand('roost.newClaudeTab');
  await ui.vscode.commands.executeCommand('roost.newCodexTab');
  assert.deepStrictEqual(made, ['claude', 'codex'], 'the step opens either agent');
  await extension.deactivate();
});

test('first start: does not hold up activation or the parts', async () => {
  const env = firstStartSetup({});
  env.ui.commands['workbench.view.extension.kestrel'] = () => new Promise(() => {});
  const roost = await within(env.extension.activate(env.base, { ghLogins: async () => [] }));
  assert.notStrictEqual(roost, 'timed out');
  assert.strictEqual(await within(roost.ready), undefined, 'the parts start');
  await env.extension.deactivate();
});

const COMPANY = { name: 'Example Co', mcpServers: [{ id: 'docs', name: 'Example Docs', about: 'the docs', register: { type: 'http', url: 'https://mcp.example.com/mcp' }, connect: { kind: 'none' } }] };
function withCompanyFile(content) {
  const env = setup();
  const file = path.join(env.root, 'company.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  process.env.ROOST_COMPANY_FILE = file;
  return { ...env, file };
}

test('roost.company and roost.companyTools follow the company file', async () => {
  let env = withCompanyFile(COMPANY);
  let roost = await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['roost.company'], true);
  assert.strictEqual(env.ui.contexts['roost.companyTools'], true);
  assert.strictEqual(roost.company.ok, true);
  assert.strictEqual(roost.company.company.name, 'Example Co');
  await env.extension.deactivate();

  env = withCompanyFile({ ...COMPANY, mcpServers: [] });
  await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['roost.company'], true);
  assert.strictEqual(env.ui.contexts['roost.companyTools'], false);
  await env.extension.deactivate();
});

test('an invalid company file is logged once and both keys are false', async () => {
  const env = withCompanyFile({ name: '' });
  await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['roost.company'], false);
  assert.strictEqual(env.ui.contexts['roost.companyTools'], false);
  const lines = env.ui.out.filter((l) => l.includes('not a valid company file'));
  assert.strictEqual(lines.length, 1, env.ui.out.join('\n'));
  assert.ok(lines[0].includes(env.file));
  await env.extension.deactivate();
});

test('no company file: both keys false and nothing logged', async () => {
  const env = setup();
  const roost = await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['roost.company'], false);
  assert.strictEqual(env.ui.contexts['roost.companyTools'], false);
  assert.strictEqual(roost.company.missing, true);
  assert.ok(!env.ui.out.some((l) => l.includes('not a valid company file')));
  await env.extension.deactivate();
});

test('a company context key that cannot be set is logged', async () => {
  const env = withCompanyFile(COMPANY);
  env.ui.failSetContext = 100;
  await activate(env.extension, env.base);
  assert.ok(env.ui.out.some((l) => l.includes('roost.company could not be set')), env.ui.out.join('\n'));
  await env.extension.deactivate();
});

// Connect Your Tools: a fake Tools (makeTools, Roost's constructor option) whose rows follow the company file's servers
const EXAMPLE = require('./fixtures/exampleCompany');
const expandHome = (p) => (p === '~' ? os.homedir() : p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p);
function fakeTools() {
  const made = [];
  const makeTools = ({ company, onChange }) => {
    const rows = company.mcpServers.map((s) => ({ id: s.id, name: s.name, about: s.about, kind: s.connect.kind, page: s.connect.page || '',
      state: 'notConnected', reason: 'Not signed in yet.', prompt: null, conflict: false, signedIn: false }));
    const find = (id) => rows.find((r) => r.id === id);
    const t = {
      calls: [], company,
      rows: () => rows.map((r) => ({ ...r })),
      allConnected: () => rows.length > 0 && rows.every((r) => r.state === 'connected'),
      rowForTokenFile: (file) => {
        const want = path.resolve(expandHome(String(file || '')));
        const s = company.mcpServers.find((x) => x.connect.doneWhen && path.resolve(x.connect.doneWhen.file) === want);
        return s ? s.id : null;
      },
      set: (id, patch) => { Object.assign(find(id), patch); onChange(t.rows()); return { ...find(id) }; },
      checkAll: async () => { t.calls.push(['checkAll']); },
      check: async (id) => { t.calls.push(['check', id]); return { ...find(id) }; },
      saveToken: async (id, token) => { t.calls.push(['saveToken', id, token]); return t.set(id, { state: 'connected', signedIn: true }); },
      connectCommand: async (id, opts) => { t.calls.push(['connectCommand', id]); t.runInTerminal = opts.runInTerminal; return { ...find(id) }; },
      connectMcpTool: async (id, opts) => { t.calls.push(['connectMcpTool', id, typeof opts.onPrompt]); return { ...find(id) }; },
      connectNone: async (id) => { t.calls.push(['connectNone', id]); return { ...find(id) }; },
      connectChecked: async (id) => { t.calls.push(['connectChecked', id]); return { ...find(id) }; },
      replaceRegistration: async (id) => { t.calls.push(['replaceRegistration', id]); return t.set(id, { conflict: false }); },
      dispose: () => { t.calls.push(['dispose']); },
    };
    made.push(t);
    return t;
  };
  return { made, makeTools };
}
async function toolsSetup(company = EXAMPLE, config = {}) {
  const env = company ? withCompanyFile(company) : setup();
  Object.assign(env.ui.config, config);
  const fakes = fakeTools();
  const roost = await env.extension.activate(env.base, { makeTools: fakes.makeTools, ghLogins: async () => [] });
  await roost.ready;
  const signIns = [];
  env.ui.commands['chirp.signIn'] = () => signIns.push('chirp');
  env.ui.commands['jay.signIn'] = () => signIns.push('jay');
  return { ...env, roost, fakes, signIns, run: (id, ...a) => env.ui.vscode.commands.executeCommand(id, ...a) };
}

test('Roost: Connect Your Tools opens one roost.tools panel, checks every row once, and sends the rows', async () => {
  const s = await toolsSetup();
  await s.run('roost.connectTools');
  await s.run('roost.connectTools');
  assert.strictEqual(s.ui.panels.length, 1, 'one at a time');
  const [panel] = s.ui.panels;
  assert.deepStrictEqual([panel.viewType, panel.title, panel.options.enableScripts], ['roost.tools', 'Connect Your Tools', true]);
  assert.strictEqual(panel.revealed, 1, 'the second time, the open one is shown');
  assert.match(panel.webview.html, /script-src 'nonce-[0-9a-f]+'/);
  assert.strictEqual(s.fakes.made.length, 1);
  const [t] = s.fakes.made;
  assert.deepStrictEqual(t.calls, [['checkAll']], 'checkAll once, when it opens');
  assert.strictEqual(t.company.name, 'Example Co', "the company's servers");
  await panel.receive({ type: 'ready' });
  const sent = panel.posted.filter((m) => m.type === 'rows').pop();
  assert.deepStrictEqual(sent.rows.map((r) => r.id), ['docs', 'mail', 'tickets']);
  // the panel closed and opened again: a new panel, the same Tools, checked again
  panel.dispose();
  await s.run('roost.connectTools');
  assert.strictEqual(s.ui.panels.length, 2);
  assert.strictEqual(s.fakes.made.length, 1);
  assert.deepStrictEqual(t.calls, [['checkAll'], ['checkAll']]);
  await s.extension.deactivate();
  assert.ok(t.calls.some((c) => c[0] === 'dispose'), 'Tools disposed when Roost stops');
});

test('roost.toolsConnected follows allConnected after each change', async () => {
  const s = await toolsSetup();
  await s.run('roost.connectTools');
  const [t] = s.fakes.made;
  t.set('docs', { state: 'connected' });
  assert.strictEqual(s.ui.contexts['roost.toolsConnected'], false);
  t.set('mail', { state: 'connected' });
  t.set('tickets', { state: 'connected' });
  await tick();
  assert.strictEqual(s.ui.contexts['roost.toolsConnected'], true);
  const [panel] = s.ui.panels;
  assert.strictEqual(panel.posted.filter((m) => m.type === 'rows').pop().rows.every((r) => r.state === 'connected'), true, 'each change sent to the page');
  await s.extension.deactivate();
});

test('the page\'s messages: connect by kind, the token, the page, Copy code and open, Replace; no token sent back', async () => {
  const s = await toolsSetup();
  await s.run('roost.connectTools');
  const [t] = s.fakes.made;
  const [panel] = s.ui.panels;
  t.calls.length = 0;
  for (const id of ['docs', 'mail', 'tickets']) await panel.receive({ type: 'connect', id });
  assert.deepStrictEqual(t.calls, [['connectChecked', 'docs'], ['connectMcpTool', 'mail', 'function'], ['connectCommand', 'tickets']]);
  t.calls.length = 0;
  await panel.receive({ type: 'token', id: 'docs', token: 'secret-token-1' });
  assert.deepStrictEqual(t.calls, [['saveToken', 'docs', 'secret-token-1']]);
  assert.ok(!JSON.stringify(panel.posted).includes('secret-token-1'), 'the token never goes to the page');
  assert.ok(!s.ui.out.some((l) => l.includes('secret-token-1')), 'nor to the output channel');
  await panel.receive({ type: 'openPage', id: 'docs' });
  assert.deepStrictEqual(s.ui.opened, ['https://mcp.example.com/token']);
  t.set('mail', { prompt: { text: 'Open https://login.example.com/device and enter code: ABCD-1234', url: 'https://login.example.com/device', code: 'ABCD-1234' } });
  await panel.receive({ type: 'copyAndOpen', id: 'mail' });
  assert.deepStrictEqual(s.ui.clipboard, ['ABCD-1234']);
  assert.deepStrictEqual(s.ui.opened, ['https://mcp.example.com/token', 'https://login.example.com/device']);
  t.set('mail', { prompt: { text: 'Enter code: WXYZ-9876', url: '', code: 'WXYZ-9876' } });
  await panel.receive({ type: 'copyAndOpen', id: 'mail' });
  assert.deepStrictEqual([s.ui.clipboard.length, s.ui.opened.length], [2, 2], 'a code alone: copied, nothing opened');
  await panel.receive({ type: 'replace', id: 'tickets' });
  assert.deepStrictEqual(t.calls.pop(), ['replaceRegistration', 'tickets']);
  await panel.receive({ type: 'connect', id: 'nope' });   // a stale page: nothing happens, nothing thrown
  // a download that needs GitHub's sign-in: the row's button runs Roost: Sign In to GitHub, and only then
  const terminals = () => s.ui.terminals || [];
  const ran = terminals().length;
  await panel.receive({ type: 'githubSignIn', id: 'mail' });
  assert.strictEqual(terminals().length, ran, 'no action on the row: nothing');
  t.set('mail', { state: 'notConnected', reason: 'Sign in to GitHub first.', action: 'githubSignIn' });
  await panel.receive({ type: 'githubSignIn', id: 'mail' });
  assert.deepStrictEqual(terminals().slice(ran).map((x) => [x.name, x.sent]), [['GitHub sign-in', ['gh auth login --hostname github.com --git-protocol https --web && exit']]]);
  await s.extension.deactivate();
});

test('a command sign-in runs in a terminal named after the server, argv shell-quoted, and its closed promise follows the terminal', async () => {
  const s = await toolsSetup();
  await s.run('roost.connectTools');
  const [t] = s.fakes.made;
  await s.ui.panels[0].receive({ type: 'connect', id: 'tickets' });
  const listeners = s.ui.closeListeners();
  const handle = t.runInTerminal(['/opt/t/login', '--site', "it's here", 'plain-arg_1.2']);
  assert.strictEqual(s.ui.terminals.length, 1);
  const [term] = s.ui.terminals;
  assert.strictEqual(term.name, 'Example Tickets');
  assert.ok(term.shown);
  assert.deepStrictEqual(term.sent, ["/opt/t/login --site 'it'\\''s here' plain-arg_1.2 && exit"]);
  let closed = false;
  handle.closed.then(() => { closed = true; });
  s.ui.closeTerminal({ name: 'another' });
  await tick();
  assert.strictEqual(closed, false, 'another terminal closing does nothing');
  s.ui.closeTerminal(term);
  await tick();
  assert.strictEqual(closed, true);
  assert.strictEqual(s.ui.closeListeners(), listeners, 'the listener is disposed');
  await s.extension.deactivate();
});

test('no company tools: Roost: Connect Your Tools says so and opens nothing', async () => {
  for (const company of [null, { ...EXAMPLE, mcpServers: [] }]) {
    const s = await toolsSetup(company);
    await s.run('roost.connectTools');
    assert.deepStrictEqual(s.ui.panels, []);
    assert.deepStrictEqual(s.ui.infos, ['Your company file lists no tools.']);
    assert.deepStrictEqual(s.fakes.made, []);
    await s.extension.deactivate();
  }
});

test('roost.teamsSignIn runs the tools row whose doneWhen file is teams.signIn.tokenFile, else chirp.signIn', async () => {
  let s = await toolsSetup(EXAMPLE, { 'teams.signIn.tokenFile': '~/.example-token.json' });
  await s.run('roost.teamsSignIn');
  assert.strictEqual(s.ui.panels.length, 1, 'the panel opens');
  const [t] = s.fakes.made;
  assert.deepStrictEqual(t.calls, [['checkAll'], ['connectMcpTool', 'mail', 'function']], 'checked, then the mail row signs in');
  assert.deepStrictEqual(s.signIns, [], 'not chirp.signIn');
  await s.extension.deactivate();

  s = await toolsSetup(EXAMPLE, { 'teams.signIn.tokenFile': '~/.example-token.json' });
  await s.run('roost.connectTools');
  s.fakes.made[0].set('mail', { state: 'connected' });
  await s.run('roost.teamsSignIn');
  assert.deepStrictEqual(s.fakes.made[0].calls, [['checkAll']], 'already connected: shown, not signed in again');
  assert.deepStrictEqual(s.signIns, []);
  await s.extension.deactivate();

  for (const [company, config, why] of [
    [null, { 'teams.signIn.tokenFile': '~/.example-token.json' }, 'no company file'],
    [EXAMPLE, {}, 'no token file set'],
    [EXAMPLE, { 'teams.signIn.tokenFile': '~/.other-token.json' }, 'a token file no row writes'],
  ]) {
    s = await toolsSetup(company, config);
    await s.run('roost.teamsSignIn');
    assert.deepStrictEqual(s.signIns, ['chirp'], why);
    assert.deepStrictEqual(s.ui.panels, [], why);
    await s.extension.deactivate();
  }
});

test('roost.jiraSignIn likewise, with jira.signIn.tokenFile, else jay.signIn', async () => {
  let s = await toolsSetup(EXAMPLE, { 'jira.signIn.tokenFile': '~/.t/credentials.json' });
  await s.run('roost.jiraSignIn');
  assert.deepStrictEqual(s.fakes.made[0].calls, [['checkAll'], ['connectCommand', 'tickets']]);
  assert.deepStrictEqual(s.signIns, []);
  await s.extension.deactivate();
  s = await toolsSetup(null, { 'jira.signIn.tokenFile': '~/.t/credentials.json' });
  await s.run('roost.jiraSignIn');
  assert.deepStrictEqual(s.signIns, ['jay']);
  await s.extension.deactivate();
});

test("Roost notes a part's setContext for a watched key, and puts VS Code's executeCommand back when it stops", async () => {
  const { ui, extension, base } = setup();
  const own = ui.vscode.commands.executeCommand;
  fake.parts.teams = { activate: () => require('vscode').commands.executeCommand('setContext', 'chirp.signedIn', true) };
  const roost = await activate(extension, base);
  assert.strictEqual(roost.contexts.get('chirp.signedIn'), true);
  assert.strictEqual(ui.contexts['chirp.signedIn'], true, 'and it still reached VS Code');
  await extension.deactivate();
  assert.strictEqual(ui.vscode.commands.executeCommand, own, "the stub's own is back");
});

test('roost.toolsNotNow is registered and does nothing', async () => {
  const s = await toolsSetup();
  await s.run('roost.toolsNotNow');
  assert.deepStrictEqual([s.ui.panels.length, s.fakes.made.length], [0, 0]);
  await s.extension.deactivate();
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failed++;
      console.log(`not ok - ${name}\n${e.stack}`);
    }
  }
  console.log(failed ? `${failed} of ${tests.length} failed` : `loader.test.js passed (${tests.length})`);
  process.exitCode = failed ? 1 : 0;
})();
