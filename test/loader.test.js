'use strict';
// Agentic Works' loader: starts each enabled part with a context of its own, starts and stops parts as their
// agenticWorks.<id>.enabled setting changes, and isolates a part that throws, marking it with the context key
// agenticWorks.<id>.failed (its views and commands are gated on the setting and that key). Fake parts live in temp dirs.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const stub = require('./vscodeStub');
const { fakeSpawn, CODE_TEXT } = require('./fakeGh');
const { LOGIN_ARGS, SETUP_GIT_ARGS } = require('../src/githubSignIn');

const src = path.join(__dirname, '..', 'src');
const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const temps = [];
process.on('exit', () => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// The four folders and ids of the real parts; a fake part's activate/deactivate call into `fake.parts[id]`.
const FOLDERS = { agents: ['agents', 'Agents (Claude Code and Codex)'], jira: ['jira', 'Jira & Confluence'], 'pull-requests': ['pullRequests', 'PRs'], teams: ['teams', 'Teams'] };
const fake = { parts: {}, calls: [] };
global.__agenticWorksFake = fake;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-works-loader-'));
  temps.push(root);
  for (const [folder, [id, title]] of Object.entries(FOLDERS)) {
    const dir = path.join(root, 'parts', folder);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'part.json'), JSON.stringify({ id, title, entry: 'src/extension.js', needs: [] }));
    fs.writeFileSync(
      path.join(dir, 'src', 'extension.js'),
      `const f = global.__agenticWorksFake;
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

// A fresh vscode stub, a fresh copy of Agentic Works, and a base context rooted at a fresh fixture.
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
    extension: { id: 'agenticworks.agentic-works' },
  };
  fake.parts = {};
  fake.calls = [];
  process.env.AGENTIC_WORKS_COMPANY_FILE = path.join(root, 'no-company.json');   // none, unless a test writes one
  return { ui, extension, root, base };
}

// Agentic Works' activate returns before its parts have started; `ready` settles once every enabled part's start has.
async function activate(extension, base, options = { ghLogins: async () => [] }) {   // never the machine's own gh
  const agenticWorks = await extension.activate(base, options);
  await agenticWorks.ready;
  return agenticWorks;
}
const activated = () => fake.calls.filter((c) => c[0] === 'activate').map((c) => c[1]);
const tick = () => new Promise((r) => setImmediate(r));
/** `p`, or 'timed out' if it has not settled within `ms`. */
const within = (p, ms = 1000) => Promise.race([p, new Promise((r) => setTimeout(() => r('timed out'), ms))]);
// Fires a change of agenticWorks.<id>.enabled and lets the start or stop it causes finish.
async function setEnabled(ui, id, on) {
  ui.config[`agenticWorks.${id}.enabled`] = on;
  ui.changeConfig([`agenticWorks.${id}.enabled`]);
  for (let i = 0; i < 5; i++) await tick();
}

test('enabled parts start, disabled do not', async () => {
  const { ui, extension, base } = setup({ 'agenticWorks.teams.enabled': false });
  const agenticWorks = await activate(extension, base);
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests']);
  assert.ok(fake.calls.every((c) => c[0] !== 'activate' || c[2] === undefined), 'no deps passed');
  assert.deepStrictEqual(ui.contexts, {
    'agenticWorks.teams.failed': false,
    'agenticWorks.jira.failed': false,
    'agenticWorks.pullRequests.failed': false,
    'agenticWorks.agents.failed': false,
    'agenticWorks.company': false,
    'agenticWorks.companyTools': false,
  });
  assert.strictEqual(agenticWorks.state('teams'), 'off');
  assert.strictEqual(agenticWorks.state('agents'), 'on');
  await extension.deactivate();
});

// Agentic Works' own settings are its parts' switches and nothing else: a read of any other agenticWorks.* key is a
// setting the manifest never declares (the manifest test checks the switches are declared).
test('every agenticWorks setting the host reads is a part switch', async () => {
  const { ui, extension, base, root } = setup();
  await activate(extension, base);
  const ids = fs.readdirSync(path.join(root, 'parts')).map((d) => JSON.parse(fs.readFileSync(path.join(root, 'parts', d, 'part.json'), 'utf8')).id);
  const switches = new Set(ids.map((id) => `agenticWorks.${id}.enabled`));
  const reads = [...new Set(ui.reads)].filter((k) => k.startsWith('agenticWorks.'));
  assert.ok(reads.some((k) => switches.has(k)), `the switches are read (${reads})`);
  assert.deepStrictEqual(reads.filter((k) => !switches.has(k)), [], 'undeclared agenticWorks settings read');
  await extension.deactivate();
});

test('a setting the manifest does not declare decides nothing: agenticWorks.perch.enabled leaves Agents on', async () => {
  const { extension, base } = setup({ 'agenticWorks.perch.enabled': false });
  await activate(extension, base);
  assert.ok(activated().includes('agents'), 'Agents on, by its own switch');
  await extension.deactivate();
});

test('agenticWorks.openSettings is registered with every part off and opens Agentic Works\' settings', async () => {
  const { ui, extension, base } = setup({ 'agenticWorks.teams.enabled': false, 'agenticWorks.jira.enabled': false, 'agenticWorks.pullRequests.enabled': false, 'agenticWorks.agents.enabled': false });
  await activate(extension, base);
  assert.deepStrictEqual(activated(), []);
  const opened = [];
  ui.commands['workbench.action.openSettings'] = (...a) => opened.push(a);
  await ui.vscode.commands.executeCommand('agenticWorks.openSettings');
  assert.deepStrictEqual(opened, [['@ext:agenticworks.agentic-works']]);
  await extension.deactivate();
});

test('every failed key is cleared before any part starts', async () => {
  const { ui, extension, base } = setup({ 'agenticWorks.teams.enabled': false });
  ui.asyncSetContext = true;                          // applied later, in the order sent, as VS Code applies them
  let sentBefore = null;
  fake.parts.jira = { activate: () => { sentBefore = ui.sent.slice(); } };
  fake.parts.pullRequests = { activate: () => { throw new Error('boom'); } };
  await activate(extension, base);
  await ui.applied;
  assert.deepStrictEqual(sentBefore.filter(([k]) => k.endsWith('.failed')), [
    ['agenticWorks.agents.failed', false],
    ['agenticWorks.jira.failed', false],
    ['agenticWorks.pullRequests.failed', false],
    ['agenticWorks.teams.failed', false],
  ], 'every key false is sent before the first part starts (a key left from before an extension host restart)');
  assert.deepStrictEqual(ui.contexts, {
    'agenticWorks.teams.failed': false,
    'agenticWorks.jira.failed': false,
    'agenticWorks.pullRequests.failed': true,
    'agenticWorks.agents.failed': false,
    'agenticWorks.company': false,
    'agenticWorks.companyTools': false,
  }, 'and none of those lands after its part was marked failed');
  await extension.deactivate();
});

test('a context key that cannot be set is logged', async () => {
  const { ui, extension, base } = setup();
  ui.failSetContext = 1;
  const agenticWorks = await activate(extension, base);
  assert.ok(ui.out.some((l) => l.includes('setContext failed')));
  for (const id of ['agents', 'jira', 'pullRequests', 'teams']) assert.strictEqual(agenticWorks.state(id), 'on', id);
  await extension.deactivate();
});

test('switching a part off or on sets no context key: the setting gates its views', async () => {
  const { ui, extension, base } = setup();
  const agenticWorks = await activate(extension, base);
  ui.sent.length = 0;
  await setEnabled(ui, 'agents', false);
  assert.strictEqual(agenticWorks.state('agents'), 'off');
  assert.ok(fake.calls.some((c) => c[0] === 'deactivate' && c[1] === 'agents'));
  await setEnabled(ui, 'agents', true);
  assert.strictEqual(agenticWorks.state('agents'), 'on');
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
  const agenticWorks = await activate(extension, base);
  assert.strictEqual(agenticWorks.state('jira'), 'failed');
  assert.strictEqual(ui.contexts['agenticWorks.jira.failed'], true);
  assert.deepStrictEqual(ui.errors, [{ message: 'Agentic Works: Jira & Confluence could not start.', items: ['Show Log'] }]);
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
  const agenticWorks = await activate(extension, base);
  assert.strictEqual(agenticWorks.state('jira'), 'failed');
  fail = false;
  await setEnabled(ui, 'jira', false);
  await setEnabled(ui, 'jira', true);
  assert.strictEqual(agenticWorks.state('jira'), 'on', ui.out.join('\n'));
  assert.strictEqual(ui.contexts['agenticWorks.jira.failed'], false);
  assert.strictEqual(ui.restorePanel('jay.ticket').restoredBy, 'jay');
  // a normal stop removes it too, and the part starts again
  await setEnabled(ui, 'jira', false);
  assert.strictEqual(ui.restorePanel('jay.ticket').disposed, true, 'closed while off');
  await setEnabled(ui, 'jira', true);
  assert.strictEqual(agenticWorks.state('jira'), 'on', ui.out.join('\n'));
  await extension.deactivate();
  assert.deepStrictEqual(Object.keys(ui.serializers), [], 'none left once Agentic Works stops');
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
  const agenticWorks = await activate(extension, base);
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams']);
  assert.strictEqual(agenticWorks.state('jira'), 'failed');
  for (const id of ['agents', 'pullRequests', 'teams']) assert.strictEqual(agenticWorks.state(id), 'on', id);
  assert.strictEqual(ui.contexts['agenticWorks.jira.failed'], true);
  assert.deepStrictEqual(ui.errors, [{ message: 'Agentic Works: Jira & Confluence could not start.', items: ['Show Log'] }]);
  assert.ok(ui.out.some((l) => l.includes('boom')), 'error in the Agentic Works output channel');

  fail = false;
  await setEnabled(ui, 'jira', false);
  assert.strictEqual(agenticWorks.state('jira'), 'off');
  assert.strictEqual(ui.contexts['agenticWorks.jira.failed'], true, 'off but failed: still marked until it starts');
  await setEnabled(ui, 'jira', true);
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams', 'jira']);
  assert.strictEqual(agenticWorks.state('jira'), 'on');
  assert.strictEqual(ui.contexts['agenticWorks.jira.failed'], false);
  assert.strictEqual(ui.errors.length, 1);
  await extension.deactivate();
});

test('"Show Log" shows the Agentic Works output channel', async () => {
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
    const agenticWorks = await activate(extension, base);
    assert.ok(ui.commands['chirp.refresh']);
    assert.strictEqual(live.size, 1);

    await setEnabled(ui, 'teams', false);
    assert.strictEqual(agenticWorks.state('teams'), 'off');
    assert.strictEqual(live.size, 0, 'timer cleared');
    assert.strictEqual(ui.commands['chirp.refresh'], undefined, 'command unregistered');
    assert.strictEqual(ui.contexts['agenticWorks.teams.failed'], false);
    assert.ok(fake.calls.some((c) => c[0] === 'deactivate' && c[1] === 'teams'));

    await setEnabled(ui, 'teams', true);
    assert.strictEqual(agenticWorks.state('teams'), 'on');
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
  const agenticWorks = await activate(extension, base);
  await agenticWorks.stop('pullRequests');
  assert.strictEqual(agenticWorks.state('pullRequests'), 'off');
  assert.deepStrictEqual(disposed.sort(), ['a', 'c']);
  assert.strictEqual(ui.contexts['agenticWorks.pullRequests.failed'], false);
  assert.ok(ui.out.some((l) => l.includes('bad dispose')));
  await agenticWorks.start('pullRequests');
  assert.strictEqual(agenticWorks.state('pullRequests'), 'on');
  await extension.deactivate();
});

test('switching Agents off mid-turn asks first', async () => {
  const { ui, extension, base } = setup();
  let answer = false;
  fake.parts.agents = { confirmStop: async () => answer };
  const agenticWorks = await activate(extension, base);
  const asked = () => fake.calls.filter((c) => c[0] === 'confirmStop').map((c) => c[1]);

  ui.inspect['agenticWorks.agents.enabled'] = { defaultValue: true, globalValue: true, workspaceValue: false };   // switched off for this workspace
  await setEnabled(ui, 'agents', false);
  assert.deepStrictEqual(asked(), ['agents']);
  assert.strictEqual(agenticWorks.state('agents'), 'on', 'cancelled: still on');
  assert.deepStrictEqual(ui.updates, [['agenticWorks.agents.enabled', undefined, 2]], 'the switch is put back, in the workspace: its value there removed, as the user setting is on');
  assert.strictEqual(ui.contexts['agenticWorks.agents.failed'], false);
  assert.ok(!fake.calls.some((c) => c[0] === 'deactivate'), 'not stopped');
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams'], 'and not started a second time');

  answer = true;
  await setEnabled(ui, 'agents', false);
  assert.strictEqual(agenticWorks.state('agents'), 'off');
  assert.strictEqual(ui.contexts['agenticWorks.agents.failed'], false);
  assert.strictEqual(ui.updates.length, 1, 'nothing written back');

  await setEnabled(ui, 'agents', true);
  await extension.deactivate();                       // the window closing: nothing is asked
  assert.deepStrictEqual(asked(), ['agents', 'agents']);
  assert.strictEqual(agenticWorks.state('agents'), 'off');
});

test('the switch is put back as it was at that scope', async () => {
  const { ui, extension, base } = setup();
  fake.parts.agents = { confirmStop: async () => false };
  await activate(extension, base);
  const cases = [
    [{ defaultValue: true, globalValue: false }, ['agenticWorks.agents.enabled', undefined, 1], 'user setting off: removed, the default is on'],
    [{ defaultValue: true, globalValue: false, workspaceValue: false }, ['agenticWorks.agents.enabled', true, 2], 'off for the user too: true in the workspace'],
    [{ defaultValue: false }, ['agenticWorks.agents.enabled', true, 1], 'a default that is off: true for the user'],
  ];
  for (const [inspect, want, why] of cases) {
    ui.updates.length = 0;
    ui.inspect['agenticWorks.agents.enabled'] = inspect;
    await setEnabled(ui, 'agents', false);
    assert.deepStrictEqual(ui.updates, [want], why);
  }
  await extension.deactivate();
});

test("a confirmStop that throws does not keep the part on", async () => {
  const { ui, extension, base } = setup();
  fake.parts.agents = { confirmStop: async () => { throw new Error('no dialog'); } };
  const agenticWorks = await activate(extension, base);
  await setEnabled(ui, 'agents', false);
  assert.strictEqual(agenticWorks.state('agents'), 'off');
  assert.ok(ui.out.some((l) => l.includes('no dialog')));
  await extension.deactivate();
});

test("off part's restored panel is closed", async () => {
  const { ui, extension, base } = setup({ 'agenticWorks.jira.enabled': false });
  fake.parts.jira = {
    activate: (c) => {
      for (const t of ['jay.ticket', 'jay.page']) {
        c.subscriptions.push(ui.vscode.window.registerWebviewPanelSerializer(t, { deserializeWebviewPanel: async (p) => { p.restoredBy = 'jay'; } }));
      }
    },
  };
  const agenticWorks = await activate(extension, base);
  for (const t of ['jay.ticket', 'jay.page']) assert.strictEqual(ui.restorePanel(t).disposed, true, `${t} closed while jira is off`);
  assert.deepStrictEqual(Object.keys(ui.serializers).sort(), ['jay.page', 'jay.ticket'], 'only the off part has serializers');

  await setEnabled(ui, 'jira', true);
  assert.strictEqual(agenticWorks.state('jira'), 'on');
  assert.deepStrictEqual(ui.errors, [], 'no duplicate-serializer error');
  const p = ui.restorePanel('jay.ticket');
  assert.deepStrictEqual([p.disposed, p.restoredBy], [false, 'jay'], 'the part restores its own tabs once on');

  await setEnabled(ui, 'jira', false);
  assert.strictEqual(ui.restorePanel('jay.page').disposed, true, 'closed again once off');
  await setEnabled(ui, 'jira', true);
  assert.strictEqual(agenticWorks.state('jira'), 'on');
  await extension.deactivate();
  assert.deepStrictEqual(Object.keys(ui.serializers), [], 'none left once Agentic Works stops');
});

test("a part that fails to start closes its restored panels", async () => {
  const { ui, extension, base } = setup();
  fake.parts.jira = {
    activate: (c) => {
      c.subscriptions.push(ui.vscode.window.registerWebviewPanelSerializer('jay.ticket', { deserializeWebviewPanel: async () => {} }));
      throw new Error('boom');
    },
  };
  const agenticWorks = await activate(extension, base);
  assert.strictEqual(agenticWorks.state('jira'), 'failed');
  assert.strictEqual(ui.restorePanel('jay.ticket').disposed, true);
  assert.strictEqual(ui.restorePanel('jay.page').disposed, true);
  await extension.deactivate();
});

test('a setting change after Agentic Works has stopped starts nothing', async () => {
  const { ui, extension, base } = setup({ 'agenticWorks.pullRequests.enabled': false });
  const agenticWorks = await activate(extension, base);
  await extension.deactivate();
  const n = activated().length;
  await setEnabled(ui, 'pullRequests', true);
  assert.strictEqual(activated().length, n);
  assert.strictEqual(agenticWorks.state('pullRequests'), 'off');
});

test('a part whose activate never ends blocks neither Agentic Works nor the others', async () => {
  const { extension, base } = setup();
  fake.parts.teams = { activate: () => new Promise(() => {}) };
  const agenticWorks = await within(extension.activate(base, { ghLogins: async () => [] }));
  assert.notStrictEqual(agenticWorks, 'timed out', "Agentic Works' activate returned");
  for (let i = 0; i < 10; i++) await tick();
  assert.deepStrictEqual(activated(), ['agents', 'jira', 'pullRequests', 'teams']);
  for (const id of ['agents', 'jira', 'pullRequests']) assert.strictEqual(agenticWorks.state(id), 'on', id);
});

test('a failed start or stop does not block later ones', async () => {
  const { ui, extension, base } = setup();
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    let answer = false;
    fake.parts.pullRequests = { confirmStop: async () => answer };
    const agenticWorks = await activate(extension, base);
    ui.failUpdate = 'settings are read-only';
    await setEnabled(ui, 'pullRequests', false);               // its stop rejects: the switch cannot be put back
    assert.ok(ui.out.some((l) => l.includes('settings are read-only')), 'the failure is in the Agentic Works output channel');
    ui.failUpdate = null; answer = true;
    await setEnabled(ui, 'pullRequests', true);
    await setEnabled(ui, 'pullRequests', false);               // and the next stop still runs
    assert.strictEqual(agenticWorks.state('pullRequests'), 'off');
    assert.strictEqual(ui.contexts['agenticWorks.pullRequests.failed'], false);
    await setEnabled(ui, 'pullRequests', true);
    assert.strictEqual(agenticWorks.state('pullRequests'), 'on');
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
  env.ui.commands['workbench.action.terminal.focus'] = () => { env.order.push('terminal'); };
  const prs = env.ui.commands['workbench.view.extension.kestrel'];
  env.ui.commands['workbench.view.extension.kestrel'] = () => { env.order.push('prs'); prs(); };
  env.walkthroughs = [];
  env.ui.commands['workbench.action.openWalkthrough'] = (...a) => { env.order.push('walkthrough'); env.walkthroughs.push(a); };
  // the Get started page: a agenticWorks.getStarted panel
  env.pages = () => env.ui.panels.filter((p) => p.viewType === 'agenticWorks.getStarted');
  const create = env.ui.vscode.window.createWebviewPanel;
  env.ui.vscode.window.createWebviewPanel = (type, ...a) => { if (type === 'agenticWorks.getStarted') env.order.push('page'); return create(type, ...a); };
  return env;
}
async function activateFirst(env) {
  const agenticWorks = await env.extension.activate(env.base, { ghLogins: async () => [] });
  await agenticWorks.firstStarted;
  return agenticWorks;
}

test('first start: PRs on opens the PRs tab once and records it', async () => {
  const env = firstStartSetup({});
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 1);
  assert.strictEqual(env.store.get('agenticWorks.firstStart.done'), true);
  await env.extension.deactivate();
  env.base.subscriptions.splice(0).forEach((d) => d.dispose());
  env.ui.commands = { 'workbench.view.extension.kestrel': env.ui.commands['workbench.view.extension.kestrel'], 'workbench.action.openWalkthrough': env.ui.commands['workbench.action.openWalkthrough'] };
  env.order = [];
  env.ui.commands['workbench.view.extension.perch'] = () => { env.order.push('perch'); };
  env.ui.commands['workbench.action.terminal.focus'] = () => { env.order.push('terminal'); };
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 1, 'a second activation does not open it');
  assert.deepStrictEqual(env.order, ['page', 'perch'], 'the walkthrough is unfinished: Get started and the Perch view again');
  assert.deepStrictEqual(env.walkthroughs, [], 'and the walkthrough never');
  await env.extension.deactivate();
});

test('a later start with every step done or Not Now opens nothing', async () => {
  const env = firstStartSetup({});
  await activateFirst(env);
  await env.extension.deactivate();
  env.base.subscriptions.splice(0).forEach((d) => d.dispose());
  const all = ['github', 'email', 'claude', 'agents', 'tools', 'teams', 'jira', 'secrets', 'codebase', 'parts'];
  env.store.set('agenticWorks.getStarted.done', Object.fromEntries(all.map((id) => [id, true])));
  env.order = [];
  env.ui.commands['workbench.view.extension.perch'] = () => { env.order.push('perch'); };
  await activateFirst(env);
  assert.deepStrictEqual(env.order, []);
  await env.extension.deactivate();
});

// A company's installer can ask for Get started once, whatever the steps' state, with a request file: its first run on a
// laptop opens a new window for it (Sean, 2026-11-27: a new user goes through the walkthrough). The first window to start
// claims the file, so only one window shows it; it is gone afterwards.
test('a request file opens Get started once, even with every step done', async () => {
  const fs = require('fs'); const os = require('os'); const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aw-request-'));
  const file = path.join(dir, 'open-get-started');
  process.env.AGENTIC_WORKS_GET_STARTED_REQUEST = file;
  try {
    const env = firstStartSetup({});
    await activateFirst(env);
    await env.extension.deactivate();
    env.base.subscriptions.splice(0).forEach((d) => d.dispose());
    const all = ['github', 'email', 'claude', 'agents', 'tools', 'teams', 'jira', 'secrets', 'codebase', 'parts'];
    env.store.set('agenticWorks.getStarted.done', Object.fromEntries(all.map((id) => [id, true])));
    fs.writeFileSync(file, '');
    env.order = [];
    env.ui.commands['workbench.view.extension.perch'] = () => { env.order.push('perch'); };
    await activateFirst(env);
    assert.deepStrictEqual(env.order, ['page', 'perch'], 'asked for: Get started and the Perch view');
    assert.strictEqual(fs.existsSync(file), false, 'the request is used up');
    await env.extension.deactivate();
    env.base.subscriptions.splice(0).forEach((d) => d.dispose());
    env.order = [];
    await activateFirst(env);
    assert.deepStrictEqual(env.order, [], 'the next start, with no request, opens nothing');
    await env.extension.deactivate();
    assert.deepStrictEqual(fs.readdirSync(dir), [], 'nothing left behind');
  } finally {
    delete process.env.AGENTIC_WORKS_GET_STARTED_REQUEST;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a later start with one step left opens Get started and the Perch view', async () => {
  const env = firstStartSetup({});
  await activateFirst(env);
  await env.extension.deactivate();
  env.base.subscriptions.splice(0).forEach((d) => d.dispose());
  const all = ['github', 'email', 'claude', 'agents', 'tools', 'teams', 'jira', 'codebase'];
  env.store.set('agenticWorks.getStarted.done', Object.fromEntries(all.map((id) => [id, true])));   // parts left
  env.order = [];
  env.ui.commands['workbench.view.extension.perch'] = () => { env.order.push('perch'); };
  await activateFirst(env);
  assert.deepStrictEqual(env.order, ['page', 'perch']);
  await env.extension.deactivate();
});

test('first start: PRs off opens nothing and still records', async () => {
  const env = firstStartSetup({ 'agenticWorks.pullRequests.enabled': false });
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 0);
  assert.strictEqual(env.pages().length, 1, 'the Get started page still opens');
  assert.strictEqual(env.store.get('agenticWorks.firstStart.done'), true);
  await env.extension.deactivate();
});

test('first start: a failing command is logged and still recorded', async () => {
  const env = firstStartSetup({});
  env.ui.commands['workbench.view.extension.kestrel'] = () => { throw new Error('no such view'); };
  await activateFirst(env);
  assert.ok(env.ui.out.some((l) => l.includes('PRs tab') && l.includes('no such view')));
  assert.strictEqual(env.store.get('agenticWorks.firstStart.done'), true);
  await env.extension.deactivate();
});

test('first start: the PRs tab, a terminal, the Get started page in the editor, then the Perch view; Perch only while Agents is on', async () => {
  let env = firstStartSetup({});
  await activateFirst(env);
  assert.deepStrictEqual(env.order, ['prs', 'terminal', 'page', 'perch']);
  await env.extension.deactivate();
  env = firstStartSetup({ 'agenticWorks.agents.enabled': false });
  await activateFirst(env);
  assert.deepStrictEqual(env.order, ['prs', 'terminal', 'page']);
  await env.extension.deactivate();
  env = firstStartSetup({});
  env.ui.commands['workbench.view.extension.perch'] = () => { throw new Error('no perch'); };
  await activateFirst(env);
  assert.ok(env.ui.out.some((l) => l.includes('Perch view') && l.includes('no perch')));
  assert.deepStrictEqual(env.order, ['prs', 'terminal', 'page'], 'the rest still opens');
  await env.extension.deactivate();
  env = firstStartSetup({ 'agenticWorks.pullRequests.enabled': false });
  env.ui.commands['workbench.action.terminal.focus'] = () => { throw new Error('no terminal'); };
  await activateFirst(env);
  assert.ok(env.ui.out.some((l) => l.includes('a terminal') && l.includes('no terminal')));
  assert.deepStrictEqual(env.order, ['page', 'perch'], 'PRs off: no PRs tab; a terminal that fails is logged');
  assert.strictEqual(env.store.get('agenticWorks.firstStart.done'), true);
  await env.extension.deactivate();
});

test('first start: a Get started page that fails to open is logged and still recorded', async () => {
  const env = firstStartSetup({});
  env.ui.vscode.window.createWebviewPanel = () => { throw new Error('no page'); };
  await activateFirst(env);
  assert.strictEqual(env.opened.length, 1, 'the PRs tab opened first');
  assert.ok(env.ui.out.some((l) => l.includes('its Get started page') && l.includes('no page')), env.ui.out.join('\n'));
  assert.strictEqual(env.store.get('agenticWorks.firstStart.done'), true);
  await env.extension.deactivate();
});

test('Agentic Works: Get Started opens the Get started page; Agentic Works: Sign In to GitHub signs in without a terminal, the code in a notification', async () => {
  const { ui, extension, base } = setup({});
  const gh = fakeSpawn();
  await (await activate(extension, base, { ghLogins: async () => [], spawnGh: gh.spawn })).firstStarted;   // its own page opened first
  ui.panels.forEach((p) => p.dispose());
  const opened = [];
  ui.commands['workbench.action.openWalkthrough'] = (...a) => opened.push(a);
  await ui.vscode.commands.executeCommand('agenticWorks.getStarted');
  assert.deepStrictEqual(opened, [], 'not the walkthrough');
  assert.deepStrictEqual(ui.panels.filter((p) => !p.disposed).map((p) => [p.viewType, p.title]), [['agenticWorks.getStarted', 'Get started']]);
  const refreshed = [];
  ui.commands['kestrel.refresh'] = () => { refreshed.push(1); };
  ui.infos = [];
  ui.infoChoice = (m, items) => (items.includes('Copy Code & Open GitHub') ? 'Copy Code & Open GitHub' : undefined);
  const command = ui.vscode.commands.executeCommand('agenticWorks.githubSignIn');
  await tick();
  assert.deepStrictEqual(gh.calls.map((c) => c.args), [LOGIN_ARGS]);
  assert.deepStrictEqual(ui.terminals || [], [], 'no terminal');
  gh.calls[0].child.err(CODE_TEXT);
  await tick();
  assert.ok(ui.infos.some((m) => m.includes('AB12-CD34')), 'the code in a notification');
  assert.deepStrictEqual([ui.clipboard, ui.opened], [['AB12-CD34'], ['https://github.com/login/device']], 'Copy Code & Open GitHub');
  gh.calls[0].child.exit(0);
  await tick();
  assert.deepStrictEqual(gh.calls[1].args, SETUP_GIT_ARGS);
  gh.calls[1].child.exit(0);
  await within(command);
  assert.deepStrictEqual(refreshed, [1], 'the PRs look for the new login');
  assert.ok(ui.infos.includes('Signed in to GitHub.'));
  // the PRs part off: kestrel.refresh is not found, and that is ignored; a failure is said as an error
  delete ui.commands['kestrel.refresh'];
  const again = ui.vscode.commands.executeCommand('agenticWorks.githubSignIn');
  await tick();
  gh.calls[2].child.err('error: access_denied\n');
  gh.calls[2].child.exit(1);
  await within(again);
  assert.ok(ui.errors.some((e) => e.message === "GitHub's sign-in didn't finish: error: access_denied"));
  // Cancel in the notification stops gh, and nothing more is said
  ui.infoChoice = (m, items) => (items.includes('Cancel') ? 'Cancel' : undefined);
  const errors = ui.errors.length, infos = ui.infos.length;
  const cancelled = ui.vscode.commands.executeCommand('agenticWorks.githubSignIn');
  await tick();
  gh.calls[3].child.err(CODE_TEXT);
  await within(cancelled);
  assert.strictEqual(gh.calls[3].child.killed, true);
  assert.deepStrictEqual([ui.errors.length, ui.infos.length], [errors, infos + 1], 'only the code\'s notification');
  await extension.deactivate();
});

test('Agentic Works: Sign In to GitHub, already signed in: says who, opens no terminal unless another account is asked for', async () => {
  const { ui, extension, base } = setup({});
  await (await activate(extension, base, { ghLogins: async () => ['octocat'] })).firstStarted;
  ui.infos = [];
  await ui.vscode.commands.executeCommand('agenticWorks.githubSignIn');
  assert.ok(ui.infos.some((m) => m.includes('signed in as octocat')), 'says who is signed in');
  assert.strictEqual((ui.terminals || []).length, 0, 'no sign-in terminal');
  assert.ok(!ui.infos.some((m) => m.includes('code')), 'and no sign-in');
  await extension.deactivate();
});

test('Agentic Works: Turn On Codebase Search turns it on through Perch\'s toggle, never off; Not Now does nothing; so does Connect Claude\'s Not Now', async () => {
  const { ui, extension, base } = setup({});
  await (await activate(extension, base)).firstStarted;
  const toggled = [];
  ui.commands['perch.codebaseIndex.toggle'] = () => toggled.push(1);
  await ui.vscode.commands.executeCommand('agenticWorks.codebaseSearchOn');
  assert.strictEqual(toggled.length, 1, 'off: turned on');
  ui.config['agents.codebaseIndex.enabled'] = true;
  await ui.vscode.commands.executeCommand('agenticWorks.codebaseSearchOn');
  assert.strictEqual(toggled.length, 1, 'already on: not toggled off');
  await ui.vscode.commands.executeCommand('agenticWorks.codebaseSearchNotNow');
  assert.strictEqual(toggled.length, 1);
  await ui.vscode.commands.executeCommand('agenticWorks.connectClaudeNotNow');   // Connect Claude's Not Now: registered, and does nothing
  await assert.rejects(() => ui.vscode.commands.executeCommand('agenticWorks.gatewayNotNow'), /not found|gatewayNotNow/, 'the gateway step\'s Not Now is gone');
  assert.strictEqual(toggled.length, 1);
  const opened = [];
  ui.commands['perch.open'] = () => opened.push(1);
  await ui.vscode.commands.executeCommand('agenticWorks.goToClaude');
  assert.strictEqual(opened.length, 1, 'Go to Your Agent Tab is Agents: Open');
  const made = [];
  ui.commands['perch.newClaude'] = () => made.push('claude');
  ui.commands['perch.newCodex'] = () => made.push('codex');
  await ui.vscode.commands.executeCommand('agenticWorks.newClaudeTab');
  await ui.vscode.commands.executeCommand('agenticWorks.newCodexTab');
  assert.deepStrictEqual(made, ['claude', 'codex'], 'the step opens either agent');
  await extension.deactivate();
});

test('first start: does not hold up activation or the parts', async () => {
  const env = firstStartSetup({});
  env.ui.commands['workbench.view.extension.kestrel'] = () => new Promise(() => {});
  const agenticWorks = await within(env.extension.activate(env.base, { ghLogins: async () => [] }));
  assert.notStrictEqual(agenticWorks, 'timed out');
  assert.strictEqual(await within(agenticWorks.ready), undefined, 'the parts start');
  await env.extension.deactivate();
});

const COMPANY = { name: 'Example Co', mcpServers: [{ id: 'docs', name: 'Example Docs', about: 'the docs', register: { type: 'http', url: 'https://mcp.example.com/mcp' }, connect: { kind: 'none' } }] };
function withCompanyFile(content) {
  const env = setup();
  const file = path.join(env.root, 'company.json');
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  process.env.AGENTIC_WORKS_COMPANY_FILE = file;
  return { ...env, file };
}

test('agenticWorks.company and agenticWorks.companyTools follow the company file', async () => {
  let env = withCompanyFile(COMPANY);
  let agenticWorks = await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['agenticWorks.company'], true);
  assert.strictEqual(env.ui.contexts['agenticWorks.companyTools'], true);
  assert.strictEqual(agenticWorks.company.ok, true);
  assert.strictEqual(agenticWorks.company.company.name, 'Example Co');
  await env.extension.deactivate();

  env = withCompanyFile({ ...COMPANY, mcpServers: [] });
  await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['agenticWorks.company'], true);
  assert.strictEqual(env.ui.contexts['agenticWorks.companyTools'], false);
  await env.extension.deactivate();
});

test('an invalid company file is logged once and both keys are false', async () => {
  const env = withCompanyFile({ name: '' });
  await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['agenticWorks.company'], false);
  assert.strictEqual(env.ui.contexts['agenticWorks.companyTools'], false);
  const lines = env.ui.out.filter((l) => l.includes('not a valid company file'));
  assert.strictEqual(lines.length, 1, env.ui.out.join('\n'));
  assert.ok(lines[0].includes(env.file));
  await env.extension.deactivate();
});

test('no company file: both keys false and nothing logged', async () => {
  const env = setup();
  const agenticWorks = await activate(env.extension, env.base);
  assert.strictEqual(env.ui.contexts['agenticWorks.company'], false);
  assert.strictEqual(env.ui.contexts['agenticWorks.companyTools'], false);
  assert.strictEqual(agenticWorks.company.missing, true);
  assert.ok(!env.ui.out.some((l) => l.includes('not a valid company file')));
  await env.extension.deactivate();
});

test('a company context key that cannot be set is logged', async () => {
  const env = withCompanyFile(COMPANY);
  env.ui.failSetContext = 100;
  await activate(env.extension, env.base);
  assert.ok(env.ui.out.some((l) => l.includes('agenticWorks.company could not be set')), env.ui.out.join('\n'));
  await env.extension.deactivate();
});

// Connect Your Tools: a fake Tools (makeTools, Agentic Works' constructor option) whose rows follow the company file's servers
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
async function toolsSetup(company = EXAMPLE, config = {}, saved = {}, gh = fakeSpawn()) {
  const env = company ? withCompanyFile(company) : setup();
  Object.assign(env.ui.config, config);
  // first start already recorded and every step done: the Get started page would open a panel of its own
  const allDone = Object.fromEntries(['github', 'email', 'claude', 'agents', 'tools', 'teams', 'jira', 'secrets', 'codebase', 'parts'].map((id) => [id, true]));
  const state = { 'agenticWorks.firstStart.done': true, 'agenticWorks.getStarted.done': allDone, ...saved };
  env.base.globalState = { get: (k) => state[k], update: async () => {} };
  const fakes = fakeTools();
  const agenticWorks = await env.extension.activate(env.base, { makeTools: fakes.makeTools, ghLogins: async () => [], spawnGh: gh.spawn });
  await agenticWorks.ready;
  await agenticWorks.firstStarted;
  env.gh = gh;
  const signIns = [];
  env.ui.commands['chirp.signIn'] = () => signIns.push('chirp');
  env.ui.commands['jay.signIn'] = () => signIns.push('jay');
  return { ...env, agenticWorks, fakes, signIns, run: (id, ...a) => env.ui.vscode.commands.executeCommand(id, ...a) };
}

test('Agentic Works: Connect Your Tools opens one agenticWorks.tools panel, checks every row once, and sends the rows', async () => {
  const s = await toolsSetup();
  await s.run('agenticWorks.connectTools');
  await s.run('agenticWorks.connectTools');
  assert.strictEqual(s.ui.panels.length, 1, 'one at a time');
  const [panel] = s.ui.panels;
  assert.deepStrictEqual([panel.viewType, panel.title, panel.options.enableScripts], ['agenticWorks.tools', 'Connect Your Tools', true]);
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
  await s.run('agenticWorks.connectTools');
  assert.strictEqual(s.ui.panels.length, 2);
  assert.strictEqual(s.fakes.made.length, 1);
  assert.deepStrictEqual(t.calls, [['checkAll'], ['checkAll']]);
  await s.extension.deactivate();
  assert.ok(t.calls.some((c) => c[0] === 'dispose'), 'Tools disposed when Agentic Works stops');
});

test('agenticWorks.toolsConnected follows allConnected after each change', async () => {
  const s = await toolsSetup();
  await s.run('agenticWorks.connectTools');
  const [t] = s.fakes.made;
  t.set('docs', { state: 'connected' });
  assert.strictEqual(s.ui.contexts['agenticWorks.toolsConnected'], false);
  t.set('mail', { state: 'connected' });
  t.set('tickets', { state: 'connected' });
  await tick();
  assert.strictEqual(s.ui.contexts['agenticWorks.toolsConnected'], true);
  const [panel] = s.ui.panels;
  assert.strictEqual(panel.posted.filter((m) => m.type === 'rows').pop().rows.every((r) => r.state === 'connected'), true, 'each change sent to the page');
  await s.extension.deactivate();
});

test('the page\'s messages: connect by kind, the token, the page, Copy code and open, Replace; no token sent back', async () => {
  const s = await toolsSetup();
  await s.run('agenticWorks.connectTools');
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
  // a download that needs GitHub's sign-in: the row's button runs Agentic Works: Sign In to GitHub, and only then
  await panel.receive({ type: 'githubSignIn', id: 'mail' });
  assert.strictEqual(s.gh.calls.length, 0, 'no action on the row: nothing');
  t.set('mail', { state: 'notConnected', reason: 'Sign in to GitHub first.', action: 'githubSignIn' });
  assert.notStrictEqual(await within(panel.receive({ type: 'githubSignIn', id: 'mail' }), 200), 'timed out', 'the page is not held while GitHub waits');
  await tick();
  assert.deepStrictEqual(s.gh.calls.map((c) => c.args), [LOGIN_ARGS], 'GitHub\'s sign-in, with no terminal');
  assert.deepStrictEqual(s.ui.terminals || [], []);
  await s.extension.deactivate();
});

test('a command sign-in runs in a terminal named after the server, argv shell-quoted, and its closed promise follows the terminal', async () => {
  const s = await toolsSetup();
  await s.run('agenticWorks.connectTools');
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

test('a command sign-in that exits with an error resolves failed with its code; a retry replaces its terminal', async () => {
  const s = await toolsSetup();
  await s.run('agenticWorks.connectTools');
  const [t] = s.fakes.made;
  await s.ui.panels[0].receive({ type: 'connect', id: 'tickets' });
  const handle = t.runInTerminal(['/opt/t/login']);
  const [term] = s.ui.terminals;
  let failed;
  handle.failed.then((code) => { failed = code; });
  s.ui.endExecution({ name: 'another' }, 1);
  s.ui.endExecution(term, 0);
  s.ui.endExecution(term, undefined);
  await tick();
  assert.strictEqual(failed, undefined, 'another terminal, a success, or an unknown code: not a failure');
  s.ui.endExecution(term, 3);
  await tick();
  assert.strictEqual(failed, 3);
  assert.strictEqual(term.disposed, false, 'left open, to be read');
  t.runInTerminal(['/opt/t/login']);
  assert.strictEqual(s.ui.terminals.length, 2);
  assert.strictEqual(term.disposed, true, 'the failed terminal goes when the sign-in is tried again');
  s.ui.closeTerminal(term);
  s.ui.closeTerminal(s.ui.terminals[1]);
  await tick();
  assert.strictEqual(s.ui.endListeners(), 0, 'its listeners are disposed with the terminal');
  await s.extension.deactivate();
});

test('a command sign-in gets the address the email step saved in email.env, in its terminal\'s environment only', async () => {
  const company = { ...EXAMPLE, email: { domain: 'example.com', env: 'EXAMPLE_EMAIL' } };
  for (const [saved, want] of [
    [{ 'agenticWorks.email': 'me.name@example.com' }, { EXAMPLE_EMAIL: 'me.name@example.com' }],
    [{ 'agenticWorks.email': 'me@other.com' }, undefined],
    [{}, undefined],
  ]) {
    const s = await toolsSetup(company, {}, saved);
    await s.run('agenticWorks.connectTools');
    const [t] = s.fakes.made;
    await s.ui.panels[0].receive({ type: 'connect', id: 'tickets' });
    t.runInTerminal(['/opt/t/login']);
    const [term] = s.ui.terminals;
    assert.deepStrictEqual(term.env, want, JSON.stringify(saved));
    assert.deepStrictEqual(term.sent, ['/opt/t/login && exit'], 'never on the command line');
    assert.ok(!s.ui.out.some((l) => l.includes('me.name@example.com')));
    await s.extension.deactivate();
  }
  // no email.env: nothing passed
  const s = await toolsSetup({ ...EXAMPLE, email: { domain: 'example.com' } }, {}, { 'agenticWorks.email': 'me.name@example.com' });
  await s.run('agenticWorks.connectTools');
  await s.ui.panels[0].receive({ type: 'connect', id: 'tickets' });
  s.fakes.made[0].runInTerminal(['/opt/t/login']);
  assert.strictEqual(s.ui.terminals[0].env, undefined);
  await s.extension.deactivate();
});

test('no company tools: Agentic Works: Connect Your Tools says so and opens nothing', async () => {
  for (const company of [null, { ...EXAMPLE, mcpServers: [] }]) {
    const s = await toolsSetup(company);
    await s.run('agenticWorks.connectTools');
    assert.deepStrictEqual(s.ui.panels, []);
    assert.deepStrictEqual(s.ui.infos, ['Your company file lists no tools.']);
    assert.deepStrictEqual(s.fakes.made, []);
    await s.extension.deactivate();
  }
});

test('agenticWorks.teamsSignIn runs the tools row whose doneWhen file is teams.signIn.tokenFile, else chirp.signIn', async () => {
  let s = await toolsSetup(EXAMPLE, { 'teams.signIn.tokenFile': '~/.example-token.json' });
  await s.run('agenticWorks.teamsSignIn');
  assert.strictEqual(s.ui.panels.length, 1, 'the panel opens');
  const [t] = s.fakes.made;
  assert.deepStrictEqual(t.calls, [['checkAll'], ['connectMcpTool', 'mail', 'function']], 'checked, then the mail row signs in');
  assert.deepStrictEqual(s.signIns, [], 'not chirp.signIn');
  await s.extension.deactivate();

  s = await toolsSetup(EXAMPLE, { 'teams.signIn.tokenFile': '~/.example-token.json' });
  await s.run('agenticWorks.connectTools');
  s.fakes.made[0].set('mail', { state: 'connected' });
  await s.run('agenticWorks.teamsSignIn');
  assert.deepStrictEqual(s.fakes.made[0].calls, [['checkAll']], 'already connected: shown, not signed in again');
  assert.deepStrictEqual(s.signIns, []);
  await s.extension.deactivate();

  for (const [company, config, why] of [
    [null, { 'teams.signIn.tokenFile': '~/.example-token.json' }, 'no company file'],
    [EXAMPLE, {}, 'no token file set'],
    [EXAMPLE, { 'teams.signIn.tokenFile': '~/.other-token.json' }, 'a token file no row writes'],
  ]) {
    s = await toolsSetup(company, config);
    await s.run('agenticWorks.teamsSignIn');
    assert.deepStrictEqual(s.signIns, ['chirp'], why);
    assert.deepStrictEqual(s.ui.panels, [], why);
    await s.extension.deactivate();
  }
});

test('agenticWorks.jiraSignIn likewise, with jira.signIn.tokenFile, else jay.signIn', async () => {
  let s = await toolsSetup(EXAMPLE, { 'jira.signIn.tokenFile': '~/.t/credentials.json' });
  await s.run('agenticWorks.jiraSignIn');
  assert.deepStrictEqual(s.fakes.made[0].calls, [['checkAll'], ['connectCommand', 'tickets']]);
  assert.deepStrictEqual(s.signIns, []);
  await s.extension.deactivate();
  s = await toolsSetup(null, { 'jira.signIn.tokenFile': '~/.t/credentials.json' });
  await s.run('agenticWorks.jiraSignIn');
  assert.deepStrictEqual(s.signIns, ['jay']);
  await s.extension.deactivate();
});

test("Agentic Works notes a part's setContext for a watched key, and puts VS Code's executeCommand back when it stops", async () => {
  const { ui, extension, base } = setup();
  const own = ui.vscode.commands.executeCommand;
  fake.parts.teams = { activate: () => require('vscode').commands.executeCommand('setContext', 'chirp.signedIn', true) };
  const agenticWorks = await activate(extension, base);
  assert.strictEqual(agenticWorks.contexts.get('chirp.signedIn'), true);
  assert.strictEqual(ui.contexts['chirp.signedIn'], true, 'and it still reached VS Code');
  await extension.deactivate();
  assert.strictEqual(ui.vscode.commands.executeCommand, own, "the stub's own is back");
});

test('agenticWorks.toolsNotNow is registered and does nothing', async () => {
  const s = await toolsSetup();
  await s.run('agenticWorks.toolsNotNow');
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
