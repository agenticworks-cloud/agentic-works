'use strict';
// Roost's loader: starts each enabled part with a context of its own, starts and stops parts as their
// roost.<id>.enabled setting changes, and isolates a part that throws. Fake parts live in temp dirs.
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
const FOLDERS = { chirp: ['teams', 'Teams'], jay: ['jira', 'Jira & Confluence'], kestrel: ['prs', 'PRs'], perch: ['perch', 'Perch'] };
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
  fs.writeFileSync(path.join(root, 'parts', 'jay', 'package.json'), JSON.stringify({
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
  return { ui, extension, root, base };
}

// Roost's activate returns before its parts have started; `ready` settles once every enabled part's start has.
async function activate(extension, base) {
  const roost = await extension.activate(base);
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
  assert.deepStrictEqual(activated(), ['jira', 'prs', 'perch']);
  assert.ok(fake.calls.every((c) => c[0] !== 'activate' || c[2] === undefined), 'no deps passed');
  assert.deepStrictEqual(ui.contexts, {
    'roost.teams.enabled': false,
    'roost.jira.enabled': true,
    'roost.prs.enabled': true,
    'roost.perch.enabled': true,
  });
  assert.strictEqual(roost.state('teams'), 'off');
  assert.strictEqual(roost.state('perch'), 'on');
  await extension.deactivate();
});

test('every context key is set before any part starts', async () => {
  const { ui, extension, base } = setup({ 'roost.prs.enabled': false });
  let seen = null;
  fake.parts.teams = { activate: () => { seen = { ...ui.contexts }; } };
  await activate(extension, base);
  assert.deepStrictEqual(seen, {
    'roost.teams.enabled': false,
    'roost.jira.enabled': false,
    'roost.prs.enabled': false,
    'roost.perch.enabled': false,
  });
  await extension.deactivate();
});

test('readParts lists parts in folder order', async () => {
  const { root } = setup();
  const { readParts } = require(path.join(src, 'parts.js'));
  const parts = readParts(root);
  assert.deepStrictEqual(parts.map((p) => p.id), ['teams', 'jira', 'prs', 'perch']);
  assert.deepStrictEqual(parts[1], {
    id: 'jira', title: 'Jira & Confluence', dir: path.join(root, 'parts', 'jay'), entry: 'src/extension.js', needs: [],
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
  const dir = path.join(root, 'parts', 'jay');
  assert.strictEqual(got.extensionUri.scheme, 'vscode-remote');
  assert.strictEqual(got.extensionUri.authority, 'ssh-remote+box');
  assert.strictEqual(got.extensionUri.path, `${root}/parts/jay`);
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
  assert.deepStrictEqual(activated(), ['teams', 'jira', 'prs', 'perch']);
  assert.strictEqual(roost.state('jira'), 'failed');
  for (const id of ['teams', 'prs', 'perch']) assert.strictEqual(roost.state(id), 'on', id);
  assert.strictEqual(ui.contexts['roost.jira.enabled'], false);
  assert.deepStrictEqual(ui.errors, [{ message: 'Roost: Jira & Confluence could not start.', items: ['Show Log'] }]);
  assert.ok(ui.out.some((l) => l.includes('boom')), 'error in the Roost output channel');

  fail = false;
  await setEnabled(ui, 'jira', false);
  assert.strictEqual(roost.state('jira'), 'off');
  await setEnabled(ui, 'jira', true);
  assert.deepStrictEqual(activated(), ['teams', 'jira', 'prs', 'perch', 'jira']);
  assert.strictEqual(roost.state('jira'), 'on');
  assert.strictEqual(ui.contexts['roost.jira.enabled'], true);
  assert.strictEqual(ui.errors.length, 1);
  await extension.deactivate();
});

test('"Show Log" shows the Roost output channel', async () => {
  const { ui, extension, base } = setup();
  ui.errorChoice = 'Show Log';
  fake.parts.prs = { activate: () => { throw new Error('nope'); } };
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
    assert.strictEqual(ui.contexts['roost.teams.enabled'], false);
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
  fake.parts.prs = {
    activate: (c) => {
      c.subscriptions.push({ dispose: () => disposed.push('a') });
      c.subscriptions.push({ dispose: () => { throw new Error('bad dispose'); } });
      c.subscriptions.push({ dispose: () => disposed.push('c') });
    },
    deactivate: () => { throw new Error('bad deactivate'); },
  };
  const roost = await activate(extension, base);
  await roost.stop('prs');
  assert.strictEqual(roost.state('prs'), 'off');
  assert.deepStrictEqual(disposed.sort(), ['a', 'c']);
  assert.strictEqual(ui.contexts['roost.prs.enabled'], false);
  assert.ok(ui.out.some((l) => l.includes('bad dispose')));
  await roost.start('prs');
  assert.strictEqual(roost.state('prs'), 'on');
  await extension.deactivate();
});

test('switching Perch off mid-turn asks first', async () => {
  const { ui, extension, base } = setup();
  let answer = false;
  fake.parts.perch = { confirmStop: async () => answer };
  const roost = await activate(extension, base);
  const asked = () => fake.calls.filter((c) => c[0] === 'confirmStop').map((c) => c[1]);

  ui.inspect['roost.perch.enabled'] = { globalValue: true, workspaceValue: false };   // switched off for this workspace
  await setEnabled(ui, 'perch', false);
  assert.deepStrictEqual(asked(), ['perch']);
  assert.strictEqual(roost.state('perch'), 'on', 'cancelled: still on');
  assert.deepStrictEqual(ui.updates, [['roost.perch.enabled', true, 2]], 'the switch is put back, in the workspace');
  assert.strictEqual(ui.contexts['roost.perch.enabled'], true);
  assert.ok(!fake.calls.some((c) => c[0] === 'deactivate'), 'not stopped');
  assert.deepStrictEqual(activated(), ['teams', 'jira', 'prs', 'perch'], 'and not started a second time');

  answer = true;
  await setEnabled(ui, 'perch', false);
  assert.strictEqual(roost.state('perch'), 'off');
  assert.strictEqual(ui.contexts['roost.perch.enabled'], false);
  assert.strictEqual(ui.updates.length, 1, 'nothing written back');

  await setEnabled(ui, 'perch', true);
  await extension.deactivate();                       // the window closing: nothing is asked
  assert.deepStrictEqual(asked(), ['perch', 'perch']);
  assert.strictEqual(roost.state('perch'), 'off');
});

test("a confirmStop that throws does not keep the part on", async () => {
  const { ui, extension, base } = setup();
  fake.parts.perch = { confirmStop: async () => { throw new Error('no dialog'); } };
  const roost = await activate(extension, base);
  await setEnabled(ui, 'perch', false);
  assert.strictEqual(roost.state('perch'), 'off');
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

test('a part whose activate never ends blocks neither Roost nor the others', async () => {
  const { extension, base } = setup();
  fake.parts.teams = { activate: () => new Promise(() => {}) };
  const roost = await within(extension.activate(base));
  assert.notStrictEqual(roost, 'timed out', "Roost's activate returned");
  for (let i = 0; i < 10; i++) await tick();
  assert.deepStrictEqual(activated(), ['teams', 'jira', 'prs', 'perch']);
  for (const id of ['jira', 'prs', 'perch']) assert.strictEqual(roost.state(id), 'on', id);
});

test('a failed start or stop does not block later ones', async () => {
  const { ui, extension, base } = setup();
  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on('unhandledRejection', onUnhandled);
  try {
    const roost = await activate(extension, base);
    ui.failSetContext = 1;
    await setEnabled(ui, 'prs', false);               // its stop rejects: the context key cannot be set
    assert.ok(ui.out.some((l) => l.includes('setContext failed')), 'the failure is in the Roost output channel');
    await setEnabled(ui, 'prs', true);
    await setEnabled(ui, 'prs', false);               // and the next stop still runs
    assert.strictEqual(roost.state('prs'), 'off');
    assert.strictEqual(ui.contexts['roost.prs.enabled'], false);
    await setEnabled(ui, 'prs', true);
    assert.strictEqual(roost.state('prs'), 'on');
    await tick();
    assert.deepStrictEqual(unhandled, [], 'no unhandled rejection');
    await extension.deactivate();
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
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
