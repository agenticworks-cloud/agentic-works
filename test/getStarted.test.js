'use strict';
// Agentic Works' Get started host (src/getStarted.js): the page opened by first start and by Agentic Works: Get Started, its state
// (steps shown, named and ordered from the company file, ticked from the parts' context keys and kept done), and its
// answers to the page's messages through the parts' commands. The fixture, fake parts and fake Tools are
// test/loader.test.js's.
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

const FOLDERS = { agents: ['agents', 'Agents (Claude Code and Codex)'], jira: ['jira', 'Jira & Confluence'], 'pull-requests': ['pullRequests', 'PRs'], repos: ['repos', 'Repos'], teams: ['teams', 'Teams'] };
const fake = { parts: {}, calls: [] };
global.__agenticWorksFake = fake;

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-works-getstarted-'));
  temps.push(root);
  for (const [folder, [id, title]] of Object.entries(FOLDERS)) {
    const dir = path.join(root, 'parts', folder);
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'part.json'), JSON.stringify({ id, title, entry: 'src/extension.js', needs: [] }));
    fs.writeFileSync(
      path.join(dir, 'src', 'extension.js'),
      `const f = global.__agenticWorksFake;
module.exports = {
  activate: (context) => { f.calls.push(['activate', ${JSON.stringify(id)}]); const p = f.parts[${JSON.stringify(id)}]; return p && p.activate ? p.activate(context) : undefined; },
  deactivate: () => { f.calls.push(['deactivate', ${JSON.stringify(id)}]); const p = f.parts[${JSON.stringify(id)}]; return p && p.deactivate ? p.deactivate() : undefined; },
  confirmStop: () => { const p = f.parts[${JSON.stringify(id)}]; return p && p.confirmStop ? p.confirmStop() : Promise.resolve(true); },
};\n`,
    );
  }
  return root;
}

function setup(config = {}) {
  const ui = stub.install();
  ui.config = config;
  for (const f of ['extension.js', 'parts.js', 'getStarted.js']) delete require.cache[path.join(src, f)];
  const extension = require(path.join(src, 'extension.js'));
  const root = fixture();
  const base = {
    subscriptions: [],
    extensionPath: root,
    extensionUri: ui.vscode.Uri.file(root),
    asAbsolutePath: (rel) => path.join(root, rel),
    globalState: { get: () => undefined, update: async () => {} },
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
  process.env.AGENTIC_WORKS_COMPANY_FILE = path.join(root, 'no-company.json');
  return { ui, extension, root, base };
}

const tick = () => new Promise((r) => setImmediate(r));
async function setEnabled(ui, id, on) {
  ui.config[`agenticWorks.${id}.enabled`] = on;
  ui.changeConfig([`agenticWorks.${id}.enabled`]);
  for (let i = 0; i < 5; i++) await tick();
}

// A memento over a Map, as VS Code's globalState
function memento(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: (k) => m.get(k), update: async (k, v) => { m.set(k, v); }, map: m };
}

// First start: globalState shared by activations; the PRs view, the page and the Perch view recorded in order
function firstStartSetup(config) {
  const env = setup(config);
  env.store = memento();
  env.base.globalState = env.store;
  env.order = [];
  env.ui.commands['workbench.view.extension.kestrel'] = () => { env.order.push('prs'); };
  env.ui.commands['workbench.view.extension.perch'] = () => { env.order.push('perch'); };
  env.ui.commands['workbench.action.terminal.focus'] = () => { env.order.push('terminal'); };
  env.walkthroughs = [];
  env.ui.commands['workbench.action.openWalkthrough'] = (...a) => { env.order.push('walkthrough'); env.walkthroughs.push(a); };
  const create = env.ui.vscode.window.createWebviewPanel;
  env.ui.vscode.window.createWebviewPanel = (type, ...a) => { if (type === 'agenticWorks.getStarted') env.order.push('page'); return create(type, ...a); };
  return env;
}
async function activateFirst(env, options = {}) {
  const agenticWorks = await env.extension.activate(env.base, { ghLogins: async () => [], ...options });
  await agenticWorks.firstStarted;
  return agenticWorks;
}

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
        const s = company.mcpServers.find((x) => x.connect.doneWhen && path.resolve(expandHome(x.connect.doneWhen.file)) === want);
        return s ? s.id : null;
      },
      set: (id, patch) => { Object.assign(find(id), patch); onChange(t.rows()); return { ...find(id) }; },
      checkAll: async () => { t.calls.push(['checkAll']); },
      saveToken: async (id, token) => { t.calls.push(['saveToken', id, token]); return t.set(id, { state: 'connected', signedIn: true }); },
      connectCommand: async (id) => { t.calls.push(['connectCommand', id]); return { ...find(id) }; },
      connectMcpTool: async (id, opts) => { t.calls.push(['connectMcpTool', id, typeof opts.onPrompt]); t.onPrompt = opts.onPrompt; return { ...find(id) }; },
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

// Agentic Works activated (its first start already recorded), with a company file or none; Agentic Works: Get Started run and the
// page's ready sent. stateOf(): a tick later, the last state posted.
async function pageSetup(company, config = {}, saved = {}, options = {}) {
  const env = setup(config);
  if (company) {
    const file = path.join(env.root, 'company.json');
    fs.writeFileSync(file, JSON.stringify(company));
    process.env.AGENTIC_WORKS_COMPANY_FILE = file;
  }
  const store = memento({ 'agenticWorks.firstStart.done': true, ...saved });
  env.base.globalState = store;
  // an unfinished walkthrough opens the page and the Perch view at start
  env.ui.commands['workbench.view.extension.perch'] = () => {};
  const fakes = fakeTools();
  const agenticWorks = await env.extension.activate(env.base, { makeTools: fakes.makeTools, ghLogins: async () => [], ...options });
  await agenticWorks.ready;
  await agenticWorks.firstStarted;
  await env.ui.vscode.commands.executeCommand('agenticWorks.getStarted');
  const page = env.ui.panels.find((p) => p.viewType === 'agenticWorks.getStarted');
  await page.receive({ type: 'ready' });
  const stateOf = async () => {
    await tick();
    const m = page.posted.filter((x) => x.type === 'state').pop();
    return m && m.state;
  };
  const step = async (id) => (await stateOf()).steps.find((x) => x.id === id);
  return { ...env, agenticWorks, store, page, fakes, stateOf, step, run: (id, ...a) => env.ui.vscode.commands.executeCommand(id, ...a) };
}

test('first start opens the Get started page, not the walkthrough; Agentic Works: Get Started opens it again, one at a time', async () => {
  const env = firstStartSetup({}); await activateFirst(env);
  assert.deepStrictEqual(env.order, ['prs', 'terminal', 'page', 'perch']);   // 'page': a agenticWorks.getStarted panel was created
  assert.deepStrictEqual(env.walkthroughs, []);
  await env.ui.vscode.commands.executeCommand('agenticWorks.getStarted');
  const pages = env.ui.panels.filter((p) => p.viewType === 'agenticWorks.getStarted');
  assert.deepStrictEqual([pages.length, pages[0].title, pages[0].revealed, pages[0].options.retainContextWhenHidden], [1, 'Get started', 1, true]);
  assert.deepStrictEqual([pages[0].column, pages[0].options.enableScripts, pages[0].options.localResourceRoots], [-1, true, []]);
  assert.match(pages[0].webview.html, /script-src 'nonce-[0-9a-f]+'/);
  pages[0].dispose();
  await env.ui.vscode.commands.executeCommand('agenticWorks.getStarted');
  assert.strictEqual(env.ui.panels.filter((p) => p.viewType === 'agenticWorks.getStarted').length, 2, 'closed, then opened anew');
  await env.extension.deactivate();
  assert.ok(env.ui.panels.every((p) => p.disposed), 'the page closes when Agentic Works stops');
});

test('words and order from the company file; steps of a part that is off are hidden, at once', async () => {
  const s = await pageSetup({ ...EXAMPLE, title: 'Example Works', steps: { gateway: 'Connect Example Gateway' } });
  const st = await s.stateOf();   // the last state posted after ready
  assert.strictEqual(st.title, 'Get started with Example Works');
  assert.deepStrictEqual(st.steps.map((x) => x.id), ['github', 'claude', 'agents', 'tools', 'teams', 'jira', 'secrets', 'codebase', 'parts']);
  assert.deepStrictEqual(st.steps.slice(1, 4).map((x) => x.name), ['Connect Example Gateway', 'Talk to Claude or Codex', 'Connect your tools']);
  assert.deepStrictEqual(st.steps.map((x) => [x.done, x.waiting]), st.steps.map(() => [false, '']));
  assert.deepStrictEqual(st.claude, { companyGateway: 'Example Gateway', keyCommand: false, keyRunning: false, refused: null });
  assert.strictEqual(st.steps.find((x) => x.id === 'agents').name, 'Talk to Claude or Codex', 'no steps.talk: the default');
  assert.deepStrictEqual(st.parts.map((p) => [p.id, p.on]), [['agents', true], ['jira', true], ['pullRequests', true], ['repos', true], ['teams', true]]);
  assert.deepStrictEqual(st.parts[0].title, 'Agents (Claude Code and Codex)');
  await setEnabled(s.ui, 'teams', false);
  const after = await s.stateOf();
  assert.ok(!after.steps.some((x) => x.id === 'teams'));
  assert.strictEqual(after.parts.find((p) => p.id === 'teams').on, false, 'the parts step follows the setting');
  await s.extension.deactivate();
});

test('steps.talk names the talk step (Sean, 2026-11-24)', async () => {
  const s = await pageSetup({ ...EXAMPLE, steps: { talk: 'Talk to Example Gateway' } });
  const st = await s.stateOf();
  assert.strictEqual(st.steps.find((x) => x.id === 'agents').name, 'Talk to Example Gateway');
  assert.strictEqual(st.steps.find((x) => x.id === 'claude').name, 'Connect Claude', 'the others keep their defaults');
  await s.extension.deactivate();
});

test('email: a step of its own after GitHub when the company file asks; saved, kept for the tools, never logged', async () => {
  const company = { ...EXAMPLE, email: { domain: 'example.com', env: 'EXAMPLE_EMAIL', example: 'first.last' }, steps: { email: 'Your work email' }, jira: { email: 'old@example.com' } };
  const s = await pageSetup(company);
  let st = await s.stateOf();
  assert.deepStrictEqual(st.steps.map((x) => x.id), ['github', 'email', 'claude', 'agents', 'tools', 'teams', 'jira', 'secrets', 'codebase', 'parts']);
  const step = st.steps.find((x) => x.id === 'email');
  assert.deepStrictEqual([step.name, step.done], ['Your work email', false]);
  assert.ok(step.details, 'it has details');
  assert.deepStrictEqual(st.email, { domain: 'example.com', example: 'first.last', value: '' });
  assert.strictEqual(st.jira.email, 'old@example.com', 'nothing saved yet: the company file\'s');
  // not on the company's domain, or not an address: refused, nothing saved
  for (const bad of ['me@other.com', '@example.com', 'me', 'a b@example.com', 42]) {
    await s.page.receive({ type: 'emailSave', email: bad });
    assert.deepStrictEqual(s.page.posted.pop(), { type: 'email', error: 'Enter your address ending in @example.com.' }, String(bad));
  }
  assert.strictEqual(s.store.get('agenticWorks.email'), undefined);
  assert.strictEqual((await s.step('email')).done, false);
  await s.page.receive({ type: 'emailSave', email: '  Me.Name@Example.com ' });
  assert.ok(s.page.posted.some((m) => m.type === 'email' && m.error === null));
  assert.strictEqual(s.store.get('agenticWorks.email'), 'me.name@example.com');
  st = await s.stateOf();
  assert.strictEqual(st.steps.find((x) => x.id === 'email').done, true);
  assert.deepStrictEqual(st.email, { domain: 'example.com', example: 'first.last', value: 'me.name@example.com' });
  assert.strictEqual(st.jira.email, 'me.name@example.com', 'the saved address fills the Jira form');
  // still editable once done
  await s.page.receive({ type: 'emailSave', email: 'other.name@example.com' });
  assert.strictEqual(s.store.get('agenticWorks.email'), 'other.name@example.com');
  assert.ok(!s.ui.out.some((l) => /name@example\.com/i.test(l)), s.ui.out.join('\n'));
  await s.extension.deactivate();
  // Not Now ticks it with nothing saved
  const n = await pageSetup(company);
  await n.page.receive({ type: 'notNow', step: 'email' });
  assert.strictEqual((await n.step('email')).done, true);
  assert.strictEqual(n.store.get('agenticWorks.email'), undefined);
  await n.extension.deactivate();
  // no email section: no step, no state, and emailSave does nothing
  const x = await pageSetup(EXAMPLE);
  assert.ok(!(await x.stateOf()).steps.some((y) => y.id === 'email'));
  assert.strictEqual((await x.stateOf()).email, null);
  await x.page.receive({ type: 'emailSave', email: 'me@example.com' });
  assert.strictEqual(x.store.get('agenticWorks.email'), undefined);
  await x.extension.deactivate();
});

test('no company file: Agentic Works\' words and order', async () => {
  const s = await pageSetup(null);
  const st = await s.stateOf();
  assert.strictEqual(st.title, 'Get started with Agentic Works');
  assert.deepStrictEqual(st.steps.map((x) => x.id), ['claude', 'agents', 'teams', 'jira', 'github', 'secrets', 'codebase', 'parts']);
  assert.strictEqual(st.steps[0].name, 'Connect Claude');
  assert.deepStrictEqual(st.steps.slice(1).map((x) => x.name), ['Talk to Claude or Codex', 'Sign in to Teams', 'Connect Jira and Confluence', 'Sign in to GitHub', 'Check messages for secrets', 'Search your code by meaning', 'Choose your parts']);
  assert.deepStrictEqual([st.claude, st.github, st.teams, st.jira], [{ companyGateway: '', keyCommand: false, keyRunning: false, refused: null }, { logins: [], running: false, code: null, note: '' }, { rowId: '', note: '', code: null }, { rowId: '', site: '', email: '', form: true }]);
  await s.extension.deactivate();
});

test('a part that is off or failed hides its steps; Agents off hides Claude, Talk, secrets and codebase', async () => {
  fake.parts = {};
  const s = await pageSetup(null, { 'agenticWorks.agents.enabled': false, 'agenticWorks.pullRequests.enabled': false });
  assert.deepStrictEqual((await s.stateOf()).steps.map((x) => x.id), ['teams', 'jira', 'parts']);
  await s.extension.deactivate();
  const env = setup();
  env.base.globalState = memento({ 'agenticWorks.firstStart.done': true });
  fake.parts.jira = { activate: () => { throw new Error('boom'); } };
  const agenticWorks = await env.extension.activate(env.base, { ghLogins: async () => [] });
  await agenticWorks.ready;
  await env.ui.vscode.commands.executeCommand('agenticWorks.getStarted');
  const page = env.ui.panels.find((p) => p.viewType === 'agenticWorks.getStarted');
  await page.receive({ type: 'ready' });
  await tick();
  assert.ok(!page.posted.filter((m) => m.type === 'state').pop().state.steps.some((x) => x.id === 'jira'), 'failed: hidden');
  await env.extension.deactivate();
});

test('a step ticks from its part\'s context key, and stays ticked', async () => {
  const s = await pageSetup(null);
  await s.ui.vscode.commands.executeCommand('setContext', 'jay.signedIn', true);
  assert.strictEqual((await s.stateOf()).steps.find((x) => x.id === 'jira').done, true);
  await s.ui.vscode.commands.executeCommand('setContext', 'jay.signedIn', false);
  assert.strictEqual((await s.stateOf()).steps.find((x) => x.id === 'jira').done, true);
  assert.deepStrictEqual(s.store.get('agenticWorks.getStarted.done'), { jira: true });
  await s.extension.deactivate();
});

test('a step done on the page shows its part in the side bar, the page keeping the keyboard; the walkthrough done, Repos', async () => {
  const views = [];
  const record = (id) => () => { views.push(id); };
  const s = await pageSetup(null, {}, {}, {});
  for (const id of ['perch', 'gannet', 'chirp', 'jay', 'kestrel']) s.ui.commands[`workbench.view.extension.${id}`] = record(id);
  await s.stateOf();
  assert.deepStrictEqual(views, [], 'opening the page switches nothing');
  const back = () => s.page.reveals.at(-1);
  await s.run('setContext', 'kestrel.signedIn', true); await s.stateOf();
  assert.deepStrictEqual(views, ['gannet'], 'GitHub signed in: Repos');
  assert.deepStrictEqual(back(), [s.page.viewColumn, false], 'the page takes the keyboard back');
  await s.run('setContext', 'jay.signedIn', true); await s.stateOf();
  await s.run('setContext', 'chirp.signedIn', true); await s.stateOf();
  await s.run('setContext', 'perch.claudeConnected', true); await s.stateOf();
  assert.deepStrictEqual(views, ['gannet', 'jay', 'chirp', 'perch']);
  await s.run('setContext', 'jay.signedIn', true); await s.stateOf();
  assert.strictEqual(views.length, 4, 'a step already done switches nothing');
  // the last ones: Repos
  await s.run('setContext', 'perch.messageSent', true);
  s.ui.config['agents.codebaseIndex.enabled'] = true;
  s.ui.changeConfig(['agents.codebaseIndex.enabled']);
  await s.stateOf();
  await s.page.receive({ type: 'notNow', step: 'secrets' }); await s.stateOf();
  assert.notStrictEqual(views.at(-1), 'gannet', 'a step left: no switch yet');
  await s.page.receive({ type: 'partsDone' }); await s.stateOf();
  assert.strictEqual((await s.stateOf()).steps.every((x) => x.done), true, (await s.stateOf()).steps.filter((x) => !x.done).map((x) => x.id).join());
  assert.strictEqual(views.at(-1), 'gannet', 'the walkthrough done: Repos');
  await s.extension.deactivate();
});

test('Not Now on a step switches nothing; only a step really done does', async () => {
  const views = [];
  const s = await pageSetup(null);
  s.ui.commands['workbench.view.extension.perch'] = () => { views.push('perch'); };
  await s.stateOf();
  await s.page.receive({ type: 'notNow', step: 'claude' }); await s.stateOf();
  assert.strictEqual((await s.step('claude')).done, true);
  assert.deepStrictEqual(views, []);
  await s.extension.deactivate();
});

test('a part that is off: its step done switches nothing', async () => {
  const views = [];
  const s = await pageSetup(null, { 'agenticWorks.repos.enabled': false });
  s.ui.commands['workbench.view.extension.gannet'] = () => { views.push('gannet'); };
  await s.stateOf();
  await s.run('setContext', 'kestrel.signedIn', true); await s.stateOf();
  assert.deepStrictEqual(views, []);
  await s.extension.deactivate();
});

test('the other signals: claude by perch.claudeConnected (or perch.gatewayReady with a company gateway), agents, github, teams, codebase, tools', async () => {
  let s = await pageSetup(null);
  await s.run('setContext', 'perch.gatewayReady', true);
  assert.strictEqual((await s.step('claude')).done, false, 'no company gateway: the gateway alone is not it');
  for (const k of ['perch.claudeConnected', 'perch.messageSent', 'kestrel.signedIn', 'chirp.signedIn']) await s.run('setContext', k, true);
  s.ui.config['agents.codebaseIndex.enabled'] = true;
  s.ui.changeConfig(['agents.codebaseIndex.enabled']);
  const st = await s.stateOf();
  assert.deepStrictEqual(st.steps.filter((x) => x.done).map((x) => x.id), ['claude', 'agents', 'teams', 'github', 'codebase']);
  await s.extension.deactivate();

  s = await pageSetup(EXAMPLE);
  await s.run('setContext', 'perch.claudeConnected', true);
  assert.strictEqual((await s.step('claude')).done, false, 'a company gateway: connected some other way is not it');
  await s.run('setContext', 'perch.gatewayReady', true);
  assert.strictEqual((await s.step('claude')).done, true);
  const [t] = s.fakes.made;
  for (const id of ['docs', 'mail', 'tickets']) t.set(id, { state: 'connected' });
  assert.strictEqual((await s.step('tools')).done, true);
  assert.strictEqual(s.page.posted.filter((m) => m.type === 'rows').pop().rows.every((r) => r.state === 'connected'), true, 'each change of the rows posted');
  await s.extension.deactivate();
});

test('agents requests go to perch.connectClaude.request; a key never reaches the page or the log; Agents not running is said', async () => {
  const s = await pageSetup(null);
  const got = []; s.ui.commands['perch.connectClaude.request'] = async (m) => { got.push(m); return [{ type: 'saved', way: 'apiKey', terminalNote: '' }]; };
  await s.page.receive({ type: 'agents', request: { type: 'apiKey', key: 'sk-ant-9' } });
  assert.deepStrictEqual(got, [{ type: 'apiKey', key: 'sk-ant-9' }]);
  assert.deepStrictEqual(s.page.posted.filter((m) => m.type === 'agents').pop(), { type: 'agents', replies: [{ type: 'saved', way: 'apiKey', terminalNote: '' }], of: 'apiKey' });
  delete s.ui.commands['perch.connectClaude.request'];
  await s.page.receive({ type: 'agents', request: { type: 'ready' } });
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'agents', error: "Agents (Claude Code and Codex) isn't running." });
  assert.ok(!JSON.stringify(s.page.posted).includes('sk-ant-9') && !s.ui.out.some((l) => l.includes('sk-ant-9')));
  await s.extension.deactivate();
});

test('Claude\'s login: the step says it is waiting while the request is out, and not once the answer comes', async () => {
  const s = await pageSetup(null);
  let finish; const got = [];
  s.ui.commands['perch.connectClaude.request'] = (m) => { got.push(m.type); return m.type === 'subscription' ? new Promise((r) => { finish = r; }) : Promise.resolve([]); };
  const pending = s.page.receive({ type: 'agents', request: { type: 'subscription' } });
  assert.deepStrictEqual(got, ['subscription']);
  assert.strictEqual((await s.step('claude')).waiting, 'Signing in to Claude in the terminal…', 'as soon as the request is sent');
  await s.page.receive({ type: 'agents', request: { type: 'ready' } });
  assert.strictEqual((await s.step('claude')).waiting, 'Signing in to Claude in the terminal…', 'another request does not clear it');
  finish([{ type: 'state', state: {} }, { type: 'saved', way: 'subscription', terminalNote: '' }]);
  await pending;
  const n = s.page.posted.length;
  const lastTwo = s.page.posted.slice(n - 2);
  assert.deepStrictEqual(lastTwo.map((m) => m.type), ['agents', 'state'], 'the answer, then the state without the waiting line');
  assert.strictEqual(lastTwo[1].state.steps.find((x) => x.id === 'claude').waiting, '');
  // an error answer clears it too
  s.ui.commands['perch.connectClaude.request'] = async () => { throw new Error('gone'); };
  await s.page.receive({ type: 'agents', request: { type: 'subscription' } });
  assert.strictEqual((await s.step('claude')).waiting, '');
  // another way waits for nothing
  s.ui.commands['perch.connectClaude.request'] = async () => [];
  const before = s.page.posted.filter((m) => m.type === 'state').length;
  await s.page.receive({ type: 'agents', request: { type: 'apiKey', key: 'sk-ant-1' } });
  assert.strictEqual(s.page.posted.filter((m) => m.type === 'state').length, before, 'no state posted for an API key');
  await s.extension.deactivate();
});

test('Get a key with the company\'s key helper: the step says "Getting your <name> key…" until the answer; the key stays in Agents', async () => {
  const company = { ...EXAMPLE, gateway: { ...EXAMPLE.gateway, keyCommand: ['~/.local/bin/example-get-key'] } };
  const s = await pageSetup(company);
  assert.strictEqual((await s.stateOf()).claude.keyCommand, true, 'the page knows a helper is there');
  let finish; const got = [];
  s.ui.commands['perch.connectClaude.request'] = (m) => { got.push(m.type); return m.type === 'getKey' ? new Promise((r) => { finish = r; }) : Promise.resolve([]); };
  const pending = s.page.receive({ type: 'agents', request: { type: 'getKey' } });
  assert.deepStrictEqual(got, ['getKey'], 'the request goes to Agents as it is: no key command is run here');
  assert.strictEqual((await s.step('claude')).waiting, 'Getting your Example Gateway key…');
  assert.strictEqual((await s.stateOf()).claude.keyRunning, true, 'a page opened again mid-run knows one is running');
  // what the helper is doing, asked of Agents while it runs (Sean, 2026-11-27: a run on the saved sign-in showed no
  // window and seemed to do nothing)
  let progress = 'sign in to Example in the window that opens';
  s.ui.commands['perch.connectClaude.request'] = (m) => { got.push(m.type); return Promise.resolve(m.type === 'keyStatus' ? [{ type: 'gatewayKeyStatus', running: true, progress }] : []); };
  s.agenticWorks.getStarted.keyPollMs = 10;
  await s.agenticWorks.getStarted.pollKey();
  assert.strictEqual((await s.step('claude')).waiting, 'Getting your Example Gateway key… Sign in to Example in the window that opens.');
  progress = 'done.';
  await s.agenticWorks.getStarted.pollKey();
  assert.strictEqual((await s.step('claude')).waiting, 'Getting your Example Gateway key… Done.', 'one full stop');
  // Cancel goes to Agents like any other request; the run's own answer ends the wait
  await s.page.receive({ type: 'agents', request: { type: 'cancelKey' } });
  assert(got.includes('cancelKey'));
  finish([{ type: 'gatewayKeyFailed', text: "The sign-in wasn't completed." }]);
  await pending;
  assert.deepStrictEqual(s.page.posted.filter((m) => m.type === 'agents').pop(), { type: 'agents', replies: [{ type: 'gatewayKeyFailed', text: "The sign-in wasn't completed." }], of: 'getKey' });
  assert.strictEqual((await s.step('claude')).waiting, '', 'the waiting line goes with the answer');
  assert.strictEqual((await s.stateOf()).claude.keyRunning, false);
  const asked = got.length; await s.agenticWorks.getStarted.pollKey(); await new Promise((r) => setTimeout(r, 40));
  assert.strictEqual(got.length, asked, 'no asking once the run is over');
  // an error answer clears it too
  s.ui.commands['perch.connectClaude.request'] = async () => { throw new Error('gone'); };
  await s.page.receive({ type: 'agents', request: { type: 'getKey' } });
  assert.strictEqual((await s.step('claude')).waiting, '');
  await s.extension.deactivate();
  // without a key helper, Get a key opens the key page in Agents: nothing to wait for
  const t = await pageSetup(EXAMPLE);
  t.ui.commands['perch.connectClaude.request'] = async () => [];
  await t.stateOf();
  const before = t.page.posted.filter((m) => m.type === 'state').length;
  await t.page.receive({ type: 'agents', request: { type: 'getKey' } });
  assert.strictEqual(t.page.posted.filter((m) => m.type === 'state').length, before, 'no waiting line');
  await t.extension.deactivate();
});

test('a key or token is sent only to a part that is running: else "<part> isn\'t running." and no call', async () => {
  const s = await pageSetup(null);
  const calls = [];
  s.ui.commands['perch.connectClaude.request'] = async (m) => { calls.push(['agents', m]); return []; };
  s.ui.commands['jay.signInWith'] = async (m) => { calls.push(['jira', m]); return null; };
  await setEnabled(s.ui, 'agents', false);
  await setEnabled(s.ui, 'jira', false);
  assert.deepStrictEqual([s.agenticWorks.state('agents'), s.agenticWorks.state('jira')], ['off', 'off']);
  await s.page.receive({ type: 'agents', request: { type: 'apiKey', key: 'sk-ant-off' } });
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'agents', error: "Agents (Claude Code and Codex) isn't running." });
  await s.page.receive({ type: 'jiraForm', site: 'example.atlassian.net', email: 'a@example.com', token: 'tok-off' });
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'jira', error: "Jira & Confluence isn't running." });
  // still starting: switched on, its activate not done yet, so its commands may not be there
  let started;
  fake.parts.agents = { activate: () => new Promise((r) => { started = r; }) };
  await setEnabled(s.ui, 'agents', true);
  assert.strictEqual(s.agenticWorks.state('agents'), 'off', 'starting');
  await s.page.receive({ type: 'agents', request: { type: 'apiKey', key: 'sk-ant-starting' } });
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'agents', error: "Agents (Claude Code and Codex) isn't running." });
  assert.deepStrictEqual(calls, [], 'no command was called');
  started();
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual(s.agenticWorks.state('agents'), 'on');
  await s.page.receive({ type: 'agents', request: { type: 'apiKey', key: 'sk-ant-on' } });
  assert.deepStrictEqual(calls, [['agents', { type: 'apiKey', key: 'sk-ant-on' }]], 'running: the key goes to the command');
  const said = JSON.stringify(s.page.posted) + s.ui.out.join('\n');
  assert.ok(!['sk-ant-off', 'tok-off', 'sk-ant-starting', 'sk-ant-on'].some((k) => said.includes(k)), 'no key on the page or in the log');
  await s.extension.deactivate();
});

test('the gh guard reads AGENTIC_WORKS_TEST_HARNESS_STRICT_GH only: a AGENTIC_WORKS_TEST a user happens to have set is not it', async () => {
  const env = setup();
  const { AgenticWorks } = env.extension;
  const output = { appendLine: () => {} };
  assert.strictEqual(process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH, '1', 'the test stub sets it');
  try {
    delete process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH;
    process.env.AGENTIC_WORKS_TEST = '1';
    assert.doesNotThrow(() => new AgenticWorks(env.base, [], output));
    process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH = '1';
    assert.throws(() => new AgenticWorks(env.base, [], output), /tests must stub ghLogins/);
    assert.doesNotThrow(() => new AgenticWorks(env.base, [], output, { ghLogins: async () => [] }));
  } finally {
    delete process.env.AGENTIC_WORKS_TEST;
    process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH = '1';
  }
});

test('a reply after the page closed is dropped quietly', async () => {
  const s = await pageSetup(null); let finish;
  s.ui.commands['perch.connectClaude.request'] = () => new Promise((r) => { finish = r; });
  const pending = s.page.receive({ type: 'agents', request: { type: 'subscription' } });
  s.page.dispose(); finish([{ type: 'saved', way: 'subscription', terminalNote: '' }]);
  await pending;   // resolves, nothing thrown, nothing logged as an error
  const n = s.page.posted.length;
  await tick();
  assert.strictEqual(s.page.posted.length, n, 'nothing posted to the closed page');
  assert.deepStrictEqual(s.ui.out, []);
  await s.extension.deactivate();
});

test('the Jira form is filled from the company file: a user-level jira.site wins, a workspace one is ignored; never a token', async () => {
  const company = { ...EXAMPLE, jira: { site: 'https://example.atlassian.net', email: 'you@example.com', token: 'tok-company-1' } };
  let s = await pageSetup(company);
  assert.deepStrictEqual((await s.stateOf()).jira, { rowId: '', site: 'https://example.atlassian.net', email: 'you@example.com', form: true });
  assert.ok(!JSON.stringify(s.page.posted).includes('tok-company-1'), 'a token in the company file is never sent');
  // a workspace-level jira.site: get() would return it, but only the user's scope counts
  s.ui.config['jira.site'] = 'https://workspace.example.com';
  s.ui.inspect['jira.site'] = { workspaceValue: 'https://workspace.example.com' };
  s.ui.changeConfig(['jira.site']);
  assert.strictEqual((await s.stateOf()).jira.site, 'https://example.atlassian.net', 'a workspace value is ignored');
  // a user-level jira.site wins over the company file's
  s.ui.inspect['jira.site'] = { globalValue: 'https://mine.example.com', workspaceValue: 'https://workspace.example.com' };
  s.ui.changeConfig(['jira.site']);
  assert.deepStrictEqual((await s.stateOf()).jira, { rowId: '', site: 'https://mine.example.com', email: 'you@example.com', form: true });
  await s.extension.deactivate();
  // a bad site or email in the company file: dropped, with a note in the output; the rest of the file still loads
  s = await pageSetup({ ...EXAMPLE, jira: { site: 'http://example.atlassian.net', email: 'not an email' } });
  const st = await s.stateOf();
  assert.deepStrictEqual(st.jira, { rowId: '', site: '', email: '', form: true });
  assert.strictEqual(st.claude.companyGateway, 'Example Gateway');
  assert.ok(s.ui.out.some((l) => l.includes('jira.site: must be an https URL')), s.ui.out.join('\n'));
  assert.ok(s.ui.out.some((l) => l.includes('jira.email: must be an email address')));
  await s.extension.deactivate();
});

test('jiraForm goes to jay.signInWith; its answer comes back; the token is in neither the page\'s messages nor the output', async () => {
  const s = await pageSetup(null, { 'jira.site': 'example.atlassian.net' });
  assert.deepStrictEqual((await s.stateOf()).jira, { rowId: '', site: 'example.atlassian.net', email: '', form: true });
  const got = [];
  s.ui.commands['jay.signInWith'] = async (m) => { got.push(m); return 'That API token was not accepted.'; };
  const form = { type: 'jiraForm', site: 'example.atlassian.net', email: 'a@example.com', token: 'tok-secret-7' };
  await s.page.receive(form);
  assert.deepStrictEqual(got, [{ site: 'example.atlassian.net', email: 'a@example.com', token: 'tok-secret-7' }]);
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'jira', error: 'That API token was not accepted.' });
  s.ui.commands['jay.signInWith'] = async () => null;
  await s.page.receive(form);
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'jira', error: null });
  delete s.ui.commands['jay.signInWith'];
  await s.page.receive(form);
  assert.deepStrictEqual(s.page.posted.pop(), { type: 'jira', error: "Jira & Confluence isn't running." });
  assert.ok(!JSON.stringify(s.page.posted).includes('tok-secret-7') && !s.ui.out.some((l) => l.includes('tok-secret-7')));
  await s.extension.deactivate();
  const t = await pageSetup(null, { 'jira.signIn.tokenFile': '~/.other-token.json' });
  assert.strictEqual((await t.stateOf()).jira.form, false, 'a token file of its own: no form');
  await t.extension.deactivate();
});

test('teamsSignIn with a company row signs that row in without opening Connect Your Tools; without one, chirp.signIn and waiting until chirp.signedIn', async () => {
  let s = await pageSetup(EXAMPLE, { 'teams.signIn.tokenFile': '~/.example-token.json', 'jira.signIn.tokenFile': '~/.t/credentials.json' });
  const st = await s.stateOf();
  assert.deepStrictEqual([st.teams.rowId, st.jira.rowId], ['mail', 'tickets']);
  const [t] = s.fakes.made;
  assert.deepStrictEqual(t.calls, [['checkAll']], 'opening the page checks every row once');
  await s.page.receive({ type: 'teamsSignIn' });
  assert.deepStrictEqual(t.calls.slice(1), [['connectMcpTool', 'mail', 'function']]);
  assert.ok(!s.ui.panels.some((p) => p.viewType === 'agenticWorks.tools'), 'no Connect Your Tools panel');
  const revealed = s.page.revealed;
  t.onPrompt();
  assert.strictEqual(s.page.revealed, revealed + 1, 'a sign-in prompt shows the page');
  await s.extension.deactivate();

  s = await pageSetup(null);
  const signIns = []; let finish;
  s.ui.commands['chirp.signIn'] = () => { signIns.push('chirp'); return new Promise((r) => { finish = r; }); };
  const pending = s.page.receive({ type: 'teamsSignIn' });
  assert.deepStrictEqual(signIns, ['chirp']);
  assert.strictEqual((await s.step('teams')).waiting, 'Finish signing in in your browser.');
  await s.run('setContext', 'chirp.signedIn', true);
  finish(); await pending;
  assert.deepStrictEqual([(await s.step('teams')).waiting, (await s.step('teams')).done, (await s.stateOf()).teams.note], ['', true, '']);
  await s.extension.deactivate();
});

test('teamsSignIn that resolves without signing in (cancelled, failed, offline, admin approval): the waiting line goes and a note says so', async () => {
  const s = await pageSetup(null);
  let finish;
  s.ui.commands['chirp.signIn'] = () => new Promise((r) => { finish = r; });
  const pending = s.page.receive({ type: 'teamsSignIn' });
  assert.deepStrictEqual([(await s.step('teams')).waiting, (await s.stateOf()).teams.note], ['Finish signing in in your browser.', '']);
  finish(); await pending;
  const NOTE = "Teams isn't signed in. Try again, or see the Teams view for why.";
  assert.deepStrictEqual([(await s.step('teams')).waiting, (await s.step('teams')).done, (await s.stateOf()).teams.note], ['', false, NOTE]);
  // trying again: the note goes while it waits; signed in later: no note
  s.ui.commands['chirp.signIn'] = () => new Promise((r) => { finish = r; });
  const again = s.page.receive({ type: 'teamsSignIn' });
  assert.deepStrictEqual([(await s.step('teams')).waiting, (await s.stateOf()).teams.note], ['Finish signing in in your browser.', '']);
  finish(); await again;
  assert.strictEqual((await s.stateOf()).teams.note, NOTE);
  await s.run('setContext', 'chirp.signedIn', true);
  assert.deepStrictEqual([(await s.step('teams')).done, (await s.stateOf()).teams.note], [true, '']);
  await s.extension.deactivate();
});

test('the Teams sign-in from the page is in place: its code shows in the step, Copy code & open and Cancel go to Teams; never logged', async () => {
  const s = await pageSetup(null);
  const calls = []; let finish;
  s.ui.commands['chirp.signIn'] = (...a) => { calls.push(['signIn', ...a]); return new Promise((r) => { finish = r; }); };
  s.ui.commands['chirp.signInCode'] = async () => ({ userCode: 'WXYZ-9876', verificationUri: 'https://microsoft.com/devicelogin' });
  s.ui.commands['chirp.copyCode'] = async () => { calls.push(['copyCode']); };
  s.ui.commands['chirp.cancelSignIn'] = async () => { calls.push(['cancelSignIn']); finish(); };
  const pending = s.page.receive({ type: 'teamsSignIn' });
  assert.deepStrictEqual(calls, [['signIn', { inPlace: true }]], 'chirp.signIn in place');
  assert.strictEqual((await s.stateOf()).teams.code, null, 'no code yet');
  await s.run('setContext', 'chirp.signInCodeWaiting', true);
  await tick();
  const st = await s.stateOf();
  assert.deepStrictEqual(st.teams.code, { userCode: 'WXYZ-9876', verificationUri: 'https://microsoft.com/devicelogin' });
  assert.strictEqual(st.steps.find((x) => x.id === 'teams').waiting, 'Finish signing in in your browser.', 'the waiting line stays');
  await s.page.receive({ type: 'teamsCopyCode' });
  await s.page.receive({ type: 'teamsCancel' });
  assert.deepStrictEqual(calls.slice(1), [['copyCode'], ['cancelSignIn']]);
  await s.run('setContext', 'chirp.signInCodeWaiting', false);
  await pending;
  assert.strictEqual((await s.stateOf()).teams.code, null, 'cancelled: the code goes');
  assert.ok(!s.ui.out.some((l) => l.includes('WXYZ-9876')), 'the code is never logged');
  // signed in while the code still waits: it goes too
  const again = s.page.receive({ type: 'teamsSignIn' });
  await s.run('setContext', 'chirp.signInCodeWaiting', true);
  await tick();
  assert.strictEqual((await s.stateOf()).teams.code.userCode, 'WXYZ-9876');
  await s.run('setContext', 'chirp.signedIn', true);
  assert.strictEqual((await s.stateOf()).teams.code, null, 'signed in: no code');
  finish(); await again;
  // Agentic Works: Sign In to Teams elsewhere (the walkthrough, the palette): Teams' own, not in place
  calls.length = 0;
  const palette = s.run('agenticWorks.teamsSignIn');
  assert.deepStrictEqual(calls, [['signIn']], 'not in place');
  finish(); await palette;
  await s.extension.deactivate();
});

test('a code waiting for a sign-in the page did not start is not shown in it', async () => {
  const s = await pageSetup(null);
  s.ui.commands['chirp.signInCode'] = async () => ({ userCode: 'WXYZ-9876', verificationUri: 'https://microsoft.com/devicelogin' });
  await s.run('setContext', 'chirp.signInCodeWaiting', true);
  await tick();
  assert.strictEqual((await s.stateOf()).teams.code, null);
  await s.page.receive({ type: 'teamsCopyCode' });   // nothing waits for the page: no copy
  await s.extension.deactivate();
});

// ---- gateway.openTabOnTalk: the talk step's Claude tab opens by itself
const AUTO = { ...EXAMPLE, gateway: { ...EXAMPLE.gateway, openTabOnTalk: true } };
// perch.sessionCount and perch.openGatewayTab, faked: `count` and `answer` are what they say, each call recorded
function fakePerch(s, { count = 0, answer = 'opened' } = {}) {
  const f = { calls: [], args: [], count, answer };
  s.ui.commands['perch.sessionCount'] = () => { f.calls.push('sessionCount'); return typeof f.count === 'function' ? f.count() : f.count; };
  s.ui.commands['perch.openGatewayTab'] = (...a) => { f.calls.push('openGatewayTab'); f.args.push(a); return typeof f.answer === 'function' ? f.answer() : f.answer; };
  return f;
}
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };
// a tab 'opened' waits up to a second for its editor group (besideWalkthrough), which the stub never makes
const until = async (pred) => { for (let i = 0; i < 300 && !pred(); i++) await new Promise((r) => setTimeout(r, 10)); };

test('openTabOnTalk: no tab before the gateway is ready, nor after a Not Now; one once it is ready, then never again', async () => {
  const s = await pageSetup(AUTO);
  const f = fakePerch(s);
  let st = await s.stateOf();
  assert.deepStrictEqual(st.agents, { autoTab: true, openTab: false }, 'the step says a tab opens; not ready, so no Open Claude Tab');
  assert.ok(st.steps.find((x) => x.id === 'agents').details.includes('by itself'), 'the details say so too');
  await s.page.receive({ type: 'notNow', step: 'claude' });
  await settle();
  assert.strictEqual((await s.step('claude')).done, true);
  assert.deepStrictEqual(f.calls, [], 'skipped with Not Now: no tab');
  await s.run('setContext', 'perch.gatewayReady', true);
  await until(() => s.store.get('agenticWorks.getStarted.autoTabOpened'));
  assert.deepStrictEqual(f.calls, ['sessionCount', 'openGatewayTab'], 'the gateway ready: the tab opens');
  assert.strictEqual(s.store.get('agenticWorks.getStarted.autoTabOpened'), true, 'and that is recorded');
  await s.run('setContext', 'perch.sessionOpen', true);
  await s.run('setContext', 'perch.gatewayReady', true);
  await s.run('setContext', 'perch.sessionOpen', false);
  await settle();
  assert.deepStrictEqual(f.calls, ['sessionCount', 'openGatewayTab'], 'once only, even once it is closed');
  st = await s.stateOf();
  assert.strictEqual(st.agents.openTab, true, 'closed: Open Claude Tab');
  await s.page.receive({ type: 'openTab' });
  assert.deepStrictEqual(f.calls.slice(2), ['openGatewayTab'], 'Open Claude Tab: the same command');
  assert.deepStrictEqual(f.args, [[{ fill: 'Hello' }], [{ fill: 'Hello' }]], '"Hello" typed in the tab, by itself and with Open Claude Tab');
  await s.extension.deactivate();
});

// ---- the gateway's key checked with the gateway (Sean, 2026-11-27: the gateway steps were ticked with a blocked key)
test('a company gateway: talking to it is ticked by the gateway answering, not by a message sent', async () => {
  const s = await pageSetup(EXAMPLE);
  await s.run('setContext', 'perch.messageSent', true);
  assert.strictEqual((await s.step('agents')).done, false, 'a message sent may have been refused');
  await s.run('setContext', 'perch.gatewayAnswered', true);
  assert.strictEqual((await s.step('agents')).done, true, 'the gateway answered');
  await s.extension.deactivate();
});

test('a refused key: both gateway steps and the tab record cleared, the reason shown; a working key opens the tab again', async () => {
  const s = await pageSetup(AUTO, {}, { 'agenticWorks.getStarted.done': { github: true, claude: true, agents: true },
    'agenticWorks.getStarted.autoTabOpened': true });
  const f = fakePerch(s);
  let st = await s.stateOf();
  assert.strictEqual(st.claude.refused, null, 'nothing refused yet');
  await s.run('setContext', 'perch.gatewayRefused', 'Key is blocked');
  await settle();
  st = await s.stateOf();
  assert.deepStrictEqual(st.steps.filter((x) => x.done).map((x) => x.id), ['github'], 'Connect and Talk are not done any more');
  assert.deepStrictEqual(st.claude.refused, { reason: 'Key is blocked' }, 'the step says why');
  assert.strictEqual(s.store.get('agenticWorks.getStarted.autoTabOpened'), undefined, 'the tab may open again');
  assert.deepStrictEqual(s.store.get('agenticWorks.getStarted.done'), { github: true }, 'and that is kept');
  assert.deepStrictEqual(f.calls, [], 'no tab on a refused key');
  // a new key the gateway takes: ready, the step done again, and the tab opens with Hello typed in
  await s.run('setContext', 'perch.gatewayRefused', false);
  await s.run('setContext', 'perch.gatewayReady', true);
  await until(() => s.store.get('agenticWorks.getStarted.autoTabOpened'));
  assert.deepStrictEqual(f.calls, ['sessionCount', 'openGatewayTab']);
  st = await s.stateOf();
  assert.deepStrictEqual([st.claude.refused, (await s.step('claude')).done], [null, true]);
  // refused with no reason given
  await s.run('setContext', 'perch.gatewayRefused', true);
  assert.deepStrictEqual((await s.stateOf()).claude.refused, { reason: '' });
  await s.extension.deactivate();
});

test('openTabOnTalk: a Perch tab open already, the marker set, the step done, Agents off, or the page closed: no tab', async () => {
  let s = await pageSetup(AUTO);
  let f = fakePerch(s, { count: 1 });
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, ['sessionCount'], 'a tab is open (restored, the first start\'s, the side bar\'s): none opened');
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, ['sessionCount'], 'not asked again in this window');
  assert.strictEqual(s.store.get('agenticWorks.getStarted.autoTabOpened'), undefined, 'nothing opened, nothing recorded');
  await s.extension.deactivate();

  s = await pageSetup(AUTO, {}, { 'agenticWorks.getStarted.autoTabOpened': true });
  f = fakePerch(s);
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, [], 'opened once before (a reload since): none');
  await s.extension.deactivate();

  s = await pageSetup(AUTO, {}, { 'agenticWorks.getStarted.done': { agents: true } });
  f = fakePerch(s);
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, [], 'the talk step done: none');
  await s.extension.deactivate();

  s = await pageSetup(AUTO, { 'agenticWorks.agents.enabled': false });
  f = fakePerch(s);
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, [], 'Agents off: none');
  await s.extension.deactivate();

  s = await pageSetup(AUTO);
  f = fakePerch(s);
  s.page.dispose();
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, [], 'the page closed: none');
  await s.extension.deactivate();

  // without the opt-in: as before
  s = await pageSetup(EXAMPLE);
  f = fakePerch(s);
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual([f.calls, (await s.stateOf()).agents], [[], { autoTab: false, openTab: false }]);
  assert.ok(!(await s.step('agents')).details.includes('by itself'));
  await s.extension.deactivate();
});

test('openTabOnTalk: one open at a time; a failed one is tried again a few times, then Open Claude Tab is offered', async () => {
  let s = await pageSetup(AUTO);
  let f = fakePerch(s);
  let release;
  f.count = () => new Promise((r) => { release = r; });
  await s.run('setContext', 'perch.gatewayReady', true);
  await s.run('setContext', 'perch.claudeConnected', true);
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.deepStrictEqual(f.calls, ['sessionCount'], 'refreshes while one is out start no other');
  assert.strictEqual((await s.stateOf()).agents.openTab, false, 'no Open Claude Tab while it is out');
  release(0);
  await settle();
  assert.deepStrictEqual(f.calls, ['sessionCount', 'openGatewayTab']);
  await s.extension.deactivate();

  s = await pageSetup(AUTO);
  f = fakePerch(s, { answer: 'failed' });
  s.agenticWorks.getStarted.autoTabRetriesMs = [5, 5];
  await s.run('setContext', 'perch.gatewayReady', true);
  await settle();
  assert.strictEqual((await s.stateOf()).agents.openTab, false, 'a retry waits: no Open Claude Tab yet');
  await new Promise((r) => setTimeout(r, 60));
  await settle();
  assert.deepStrictEqual(f.calls.filter((c) => c === 'openGatewayTab').length, 3, 'tried, then tried again twice');
  assert.strictEqual(s.store.get('agenticWorks.getStarted.autoTabOpened'), undefined, 'a failed open records nothing');
  assert.strictEqual((await s.stateOf()).agents.openTab, true, 'Open Claude Tab');
  f.answer = () => { throw new Error('no Perch'); };
  await s.page.receive({ type: 'openTab' });
  assert.strictEqual(s.store.get('agenticWorks.getStarted.autoTabOpened'), undefined);
  f.answer = 'opened';
  await s.page.receive({ type: 'openTab' });
  assert.strictEqual(s.store.get('agenticWorks.getStarted.autoTabOpened'), true, 'Open Claude Tab opened it: recorded');
  await s.extension.deactivate();
});

test('jiraSignIn with a company row signs it in in place; tool messages go to Connect Your Tools\' host; rows are sent on ready', async () => {
  const s = await pageSetup(EXAMPLE, { 'jira.signIn.tokenFile': '~/.t/credentials.json' });
  assert.deepStrictEqual(s.page.posted.filter((m) => m.type === 'rows').pop().rows.map((r) => r.id), ['docs', 'mail', 'tickets']);
  const [t] = s.fakes.made;
  await s.page.receive({ type: 'jiraSignIn' });
  assert.deepStrictEqual(t.calls.pop(), ['connectCommand', 'tickets']);
  await s.page.receive({ type: 'tool', message: { type: 'token', id: 'docs', token: 'tool-secret-3' } });
  assert.deepStrictEqual(t.calls.pop(), ['saveToken', 'docs', 'tool-secret-3']);
  await s.page.receive({ type: 'tool', message: { type: 'connect', id: 'mail' } });
  assert.deepStrictEqual(t.calls.pop(), ['connectMcpTool', 'mail', 'function']);
  assert.ok(!s.ui.panels.some((p) => p.viewType === 'agenticWorks.tools'));
  assert.ok(!JSON.stringify(s.page.posted).includes('tool-secret-3') && !s.ui.out.some((l) => l.includes('tool-secret-3')));
  await s.extension.deactivate();
});

test('the secret check step: on by default, done only when pressed; Turn it on clears an off at the user or workspace level', async () => {
  const s = await pageSetup(null);
  let st = await s.stateOf();
  assert.deepStrictEqual(st.steps.find((x) => x.id === 'secrets'), { ...st.steps.find((x) => x.id === 'secrets'), name: 'Check messages for secrets', done: false });
  assert.ok(st.steps.find((x) => x.id === 'secrets').details.includes('Not a secret'), 'the details say how to let a test value through');
  assert.deepStrictEqual(st.secretCheck, { on: true, offHere: false }, 'unset: on (the default)');
  // Keep it on: done, nothing written
  await s.page.receive({ type: 'secretsOn' });
  assert.strictEqual((await s.step('secrets')).done, true);
  assert.deepStrictEqual(s.ui.updates.filter((u) => u[0].startsWith('agents.secretCheck')), []);
  await s.extension.deactivate();
  // off in the user's settings: Turn it on takes the off away, so the default (on) holds
  const g = await pageSetup(null, { 'agents.secretCheck.enabled': false });
  assert.deepStrictEqual((await g.stateOf()).secretCheck, { on: false, offHere: false });
  await g.page.receive({ type: 'secretsOn' });
  assert.deepStrictEqual(g.ui.updates.filter((u) => u[0] === 'agents.secretCheck.enabled'), [['agents.secretCheck.enabled', undefined, 1]]);
  st = await g.stateOf();
  assert.deepStrictEqual([st.secretCheck, st.steps.find((x) => x.id === 'secrets').done], [{ on: true, offHere: false }, true]);
  await g.extension.deactivate();
  // off for this workspace (Off for this repo): said, and Turn it on takes that off away too
  const w = await pageSetup(null, { 'agents.secretCheck.enabled': false });
  w.ui.inspect['agents.secretCheck.enabled'] = { workspaceValue: false };
  w.ui.changeConfig(['agents.secretCheck.enabled']);
  assert.deepStrictEqual((await w.stateOf()).secretCheck, { on: false, offHere: true });
  await w.page.receive({ type: 'secretsOn' });
  assert.deepStrictEqual(w.ui.updates.filter((u) => u[0] === 'agents.secretCheck.enabled'), [['agents.secretCheck.enabled', undefined, 2]]);
  await w.extension.deactivate();
  // Not Now leaves it as it is
  const n = await pageSetup(null, { 'agents.secretCheck.enabled': false });
  await n.page.receive({ type: 'notNow', step: 'secrets' });
  assert.deepStrictEqual([(await n.step('secrets')).done, n.ui.updates.length], [true, 0]);
  await n.extension.deactivate();
});

test('Not Now, Turn On, Done and All settings run the walkthrough\'s commands and tick their steps; New tab opens one', async () => {
  const s = await pageSetup(EXAMPLE);
  const ran = [];
  for (const id of ['agenticWorks.connectClaudeNotNow', 'agenticWorks.toolsNotNow', 'agenticWorks.codebaseSearchNotNow', 'agenticWorks.codebaseSearchOn', 'agenticWorks.openSettings', 'agenticWorks.newClaudeTab', 'agenticWorks.newCodexTab']) {
    s.ui.commands[id] = (...a) => { ran.push(id); if (id.startsWith('agenticWorks.new')) ran.push(a); };
  }
  await s.page.receive({ type: 'notNow', step: 'claude' });
  assert.deepStrictEqual(ran, ['agenticWorks.connectClaudeNotNow']);
  assert.strictEqual((await s.step('claude')).done, true);
  await s.page.receive({ type: 'notNow', step: 'tools' });
  await s.page.receive({ type: 'codebaseOn' });
  await s.page.receive({ type: 'openSettings' });
  await s.page.receive({ type: 'newTab', kind: 'claude' });
  await s.page.receive({ type: 'newTab', kind: 'codex' });
  await s.page.receive({ type: 'notNow', step: 'nope' });
  assert.deepStrictEqual(ran.slice(1), ['agenticWorks.toolsNotNow', 'agenticWorks.codebaseSearchOn', 'agenticWorks.openSettings', 'agenticWorks.newClaudeTab', [{ fill: 'Hello' }], 'agenticWorks.newCodexTab', [{ fill: 'Hello' }]], 'a new tab has "Hello" typed in it');
  assert.deepStrictEqual((await s.stateOf()).steps.filter((x) => x.done).map((x) => x.id), ['claude', 'tools', 'codebase', 'parts']);
  await s.extension.deactivate();
  const p = await pageSetup(null);
  await p.page.receive({ type: 'partsDone' });
  assert.strictEqual((await p.step('parts')).done, true);
  await p.extension.deactivate();
});

test('part {id, on} writes agenticWorks.<id>.enabled for the user; a stop that is refused puts it back and the page follows', async () => {
  const s = await pageSetup(null);
  await s.page.receive({ type: 'part', id: 'teams', on: false });
  for (let i = 0; i < 5; i++) await tick();
  assert.deepStrictEqual(s.ui.updates, [['agenticWorks.teams.enabled', false, 1]]);
  assert.strictEqual(s.agenticWorks.state('teams'), 'off');
  const st = await s.stateOf();
  assert.deepStrictEqual([st.parts.find((p) => p.id === 'teams').on, st.steps.some((x) => x.id === 'teams'), st.steps.find((x) => x.id === 'parts').done], [false, false, true]);
  await s.page.receive({ type: 'part', id: 'nope', on: false });
  await s.page.receive({ type: 'part', id: 'jira', on: 'no' });
  assert.strictEqual(s.ui.updates.length, 1, 'an unknown part or a value that is not a boolean: nothing written');
  fake.parts.agents = { confirmStop: async () => false };
  await s.page.receive({ type: 'part', id: 'agents', on: false });
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual(s.agenticWorks.state('agents'), 'on');
  assert.strictEqual((await s.stateOf()).parts.find((p) => p.id === 'agents').on, true, 'put back: the page follows');
  await s.extension.deactivate();
});

test('github signs in on the page: gh with no terminal, its code shown with Copy code & open, then git set up and the logins read', async () => {
  const gh = fakeSpawn();
  const s = await pageSetup(null, {}, {}, { spawnGh: gh.spawn });
  let logins = [];
  s.agenticWorks.getStarted.ghLogins = async () => logins;
  const refreshed = [];
  s.ui.commands['kestrel.refresh'] = () => { refreshed.push(1); };
  await s.page.receive({ type: 'github' });
  assert.deepStrictEqual(gh.calls.map((c) => c.args), [LOGIN_ARGS], 'gh auth login, once');
  assert.deepStrictEqual(s.ui.terminals || [], [], 'no terminal');
  let st = await s.stateOf();
  assert.strictEqual(st.steps.find((x) => x.id === 'github').waiting, "Starting GitHub's sign-in…");
  assert.deepStrictEqual([st.github.running, st.github.code], [true, null]);
  await s.page.receive({ type: 'github' });
  assert.strictEqual(gh.calls.length, 1, 'pressed again while it runs: the same sign-in');
  gh.calls[0].child.err(CODE_TEXT);
  st = await s.stateOf();
  assert.deepStrictEqual(st.github.code, { userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' });
  assert.strictEqual(st.steps.find((x) => x.id === 'github').waiting, 'Copy the code, then enter it on GitHub in your browser.');
  await s.page.receive({ type: 'githubCopyCode' });
  assert.deepStrictEqual(s.ui.clipboard, ['AB12-CD34']);
  assert.deepStrictEqual(s.ui.opened, ['https://github.com/login/device']);
  logins = ['octocat'];
  gh.calls[0].child.exit(0);
  await tick();
  assert.deepStrictEqual(gh.calls[1].args, SETUP_GIT_ARGS, 'then git is set up to use it');
  gh.calls[1].child.exit(0);
  for (let i = 0; i < 5; i++) await tick();
  st = await s.stateOf();
  assert.deepStrictEqual([st.steps.find((x) => x.id === 'github').waiting, st.github.logins, st.github.code, st.github.running, st.github.note],
    ['', ['octocat'], null, false, '']);
  assert.deepStrictEqual(refreshed, [1], 'the PRs look for the new login');
  assert.deepStrictEqual(s.ui.infos || [], [], 'the page says it all: no notifications');
  await s.extension.deactivate();
});

test('github: a failed sign-in leaves its reason on the step; Cancel stops gh and leaves none', async () => {
  const gh = fakeSpawn();
  const s = await pageSetup(null, {}, {}, { spawnGh: gh.spawn });
  await s.page.receive({ type: 'github' });
  gh.calls[0].child.err('error: failed to authenticate via web browser: access_denied\n');
  gh.calls[0].child.exit(1);
  for (let i = 0; i < 5; i++) await tick();
  let st = await s.stateOf();
  assert.strictEqual(st.github.note, "GitHub's sign-in didn't finish: error: failed to authenticate via web browser: access_denied");
  assert.strictEqual(st.github.running, false);
  await s.page.receive({ type: 'github' });
  st = await s.stateOf();
  assert.strictEqual(st.github.note, '', 'tried again: the old reason goes');
  gh.calls[1].child.err(CODE_TEXT);
  await s.page.receive({ type: 'githubCancel' });
  assert.strictEqual(gh.calls[1].child.killed, true);
  for (let i = 0; i < 5; i++) await tick();
  st = await s.stateOf();
  assert.deepStrictEqual([st.github.note, st.github.code, st.github.running, st.steps.find((x) => x.id === 'github').waiting], ['', null, false, '']);
  await s.page.receive({ type: 'githubCopyCode' });
  assert.deepStrictEqual(s.ui.clipboard, [], 'no code: nothing copied');
  await s.extension.deactivate();
});

test('github: signed in but git not set up: the step says how to set it up', async () => {
  const gh = fakeSpawn();
  const s = await pageSetup(null, {}, {}, { spawnGh: gh.spawn });
  await s.page.receive({ type: 'github' });
  gh.calls[0].child.exit(0);
  await tick();
  gh.calls[1].child.exit(1);
  for (let i = 0; i < 5; i++) await tick();
  assert.strictEqual((await s.stateOf()).github.note, "Signed in, but git isn't set up to use it: run gh auth setup-git in a terminal.");
  await s.extension.deactivate();
});

test('github: the window closing stops a sign-in that is waiting', async () => {
  const gh = fakeSpawn();
  const s = await pageSetup(null, {}, {}, { spawnGh: gh.spawn });
  await s.page.receive({ type: 'github' });
  await s.extension.deactivate();
  assert.strictEqual(gh.calls[0].child.killed, true);
});

test('Agentic Works: Sign In to GitHub still asks first when signed in', async () => {
  const env = setup();
  env.base.globalState = memento({ 'agenticWorks.firstStart.done': true });
  const agenticWorks = await env.extension.activate(env.base, { ghLogins: async () => ['octocat'] });
  await agenticWorks.ready;
  await env.ui.vscode.commands.executeCommand('agenticWorks.githubSignIn');
  assert.ok((env.ui.infos || []).some((m) => m.includes('signed in as octocat')));
  assert.strictEqual((env.ui.terminals || []).length, 0);
  await env.extension.deactivate();
});

test('each step carries its details, in the company file\'s words; the gateway step\'s follow the company gateway', async () => {
  let s = await pageSetup({ ...EXAMPLE, title: 'Example Works' });
  let st = await s.stateOf();
  assert.ok(st.steps.every((x) => typeof x.details === 'string' && x.details.startsWith('<')), 'every step has details');
  const claude = st.steps.find((x) => x.id === 'claude').details;
  assert.ok(claude.includes('Example Gateway') && claude.includes('Example Works') && !claude.includes('Claude subscription'));
  await s.extension.deactivate();
  s = await pageSetup(null);
  st = await s.stateOf();
  assert.ok(st.steps.every((x) => x.details.startsWith('<')));
  assert.ok(st.steps.find((x) => x.id === 'claude').details.includes('Claude subscription'), 'no company gateway: every way');
  await s.extension.deactivate();
  // a company file's note heads its step's details
  s = await pageSetup({ ...EXAMPLE, notes: { github: 'Create your own GitHub account first.' } });
  st = await s.stateOf();
  assert.ok(st.steps.find((x) => x.id === 'github').details.startsWith('<p>Create your own GitHub account first.</p>'));
  assert.ok(!st.steps.find((x) => x.id === 'teams').details.includes('Create your own'), 'only on its own step');
  await s.extension.deactivate();
  // a company file's words are escaped in them
  s = await pageSetup({ ...EXAMPLE, title: '<img src=x onerror=alert(1)>', gateway: { ...EXAMPLE.gateway, name: '**Gw** <b>x</b>' } });
  const html = (await s.stateOf()).steps.find((x) => x.id === 'claude').details;
  assert.ok(!/<img|<b>/.test(html) && html.includes('&lt;img src=x onerror=alert(1)&gt;') && html.includes('**Gw** &lt;b&gt;x&lt;/b&gt;'));
  await s.extension.deactivate();
});

test('openLink opens an https link in the browser; any other is ignored', async () => {
  const s = await pageSetup(null);
  await s.page.receive({ type: 'openLink', url: 'https://cli.github.com' });
  for (const url of ['http://example.com', 'javascript:alert(1)', 'file:///etc/passwd', 'command:workbench.action.reloadWindow', 'vscode://x', '/relative', '', 7, null]) {
    await s.page.receive({ type: 'openLink', url });
  }
  await s.page.receive({ type: 'openLink' });
  assert.deepStrictEqual(s.ui.opened, ['https://cli.github.com/']);
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
  console.log(failed ? `${failed} of ${tests.length} failed` : `getStarted.test.js passed (${tests.length})`);
  process.exitCode = failed ? 1 : 0;
})();
