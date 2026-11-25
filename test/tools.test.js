'use strict';
// Tools: the company's MCP servers as rows, each signed in its own way (tokenPage, command, mcpTool, none), connected
// only once its check passes, then registered with Claude Code at user scope. The mail server is
// test/fixtures/fakeMcpServer.js through node; fetch, the command runner and the terminal are fakes.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Tools, promptOf, platformKey, scrub, TOKEN_DIR, GITHUB_FIRST, NOT_INSTALLED } = require('../src/tools');
const { readCompany } = require('../src/company');
const EXAMPLE = require('./fixtures/exampleCompany');

const FIXTURE = path.join(__dirname, 'fixtures', 'fakeMcpServer.js');
const temps = [];
const children = [];
process.on('exit', () => {
  children.forEach((c) => { if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL'); });
  temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
});

function setup({ claudeJson, run, fetch } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-tools-'));
  temps.push(home);
  const data = JSON.parse(JSON.stringify(EXAMPLE));
  data.mcpServers[1].register = { type: 'stdio', command: process.execPath, args: [FIXTURE],
    env: { FAKE_MCP_TOKEN_FILE: path.join(home, '.example-token.json') } };
  const file = path.join(home, 'company.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const company = readCompany(file, { home }).company;
  const claude = path.join(home, '.claude.json');
  if (claudeJson !== undefined) fs.writeFileSync(claude, claudeJson);
  const spawned = [];
  const spawn = (...a) => { const c = childProcess.spawn(...a); spawned.push(c); children.push(c); return c; };
  const changes = [];
  const fetches = [];
  const status = { code: 200 };
  const fakeFetch = fetch || (async (url, init) => { fetches.push({ url, init }); return { ok: status.code >= 200 && status.code < 300, status: status.code }; });
  const runs = [];
  const runResult = { code: 1, stderr: 'warming up\nnot signed in\n' };
  const fakeRun = run || (async (argv) => { runs.push(argv); return { ...runResult }; });
  const tools = new Tools({ company, home, fetch: fakeFetch, spawn, run: fakeRun, claudeJson: claude, onChange: (rows) => changes.push(rows) });
  return { home, company, tools, claude, spawned, changes, fetches, status, runs, runResult };
}
const row = (tools, id) => tools.rows().find((r) => r.id === id);
// the tickets row's sign-in file, as its sign-in command leaves it: before it, the row's check isn't run
function ticketsSignedIn(s) {
  const f = path.join(s.home, '.t', 'credentials.json');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '{}');
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
async function allGone(children) {
  const until = Date.now() + 3000;
  while (children.some((c) => c.exitCode === null && c.signalCode === null)) {
    if (Date.now() > until) assert.fail('a server process is still running 3 s later');
    await new Promise((r) => setTimeout(r, 20));
  }
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('promptOf picks the link and the code', () => {
  const t = 'To sign in, open https://login.example.com/device and enter code ABCD-1234.';
  assert.deepStrictEqual(promptOf(t), { text: t, url: 'https://login.example.com/device', code: 'ABCD-1234' });
  assert.deepStrictEqual(promptOf('Go to (https://a.example.com/x?y=1). Code: 9F2K'), { text: 'Go to (https://a.example.com/x?y=1). Code: 9F2K', url: 'https://a.example.com/x?y=1', code: '9F2K' });
  assert.deepStrictEqual(promptOf('nothing here'), { text: 'nothing here', url: '', code: '' });
  assert.strictEqual(TOKEN_DIR, '~/.config/roost/tokens');
});

test('rows: all unknown, nothing spawned, no check at construction', async () => {
  const s = setup();
  assert.deepStrictEqual(s.tools.rows().map((r) => [r.id, r.kind, r.state, r.page, r.prompt, r.conflict, r.signedIn]), [
    ['docs', 'tokenPage', 'unknown', 'https://mcp.example.com/token', null, false, false],
    ['mail', 'mcpTool', 'unknown', '', null, false, false],
    ['tickets', 'command', 'unknown', '', null, false, false],
  ]);
  assert.strictEqual(row(s.tools, 'mail').name, 'Example Mail');
  assert.strictEqual(row(s.tools, 'mail').about, 'mail');
  await new Promise((r) => setTimeout(r, 50));
  assert.strictEqual(s.spawned.length, 0);
  assert.strictEqual(s.fetches.length + s.runs.length, 0);
  assert.strictEqual(s.tools.allConnected(), false);
});

test('checkAll: each row says why it is not connected', async () => {
  const s = setup();
  await s.tools.checkAll();
  const mail = row(s.tools, 'mail');
  assert.strictEqual(mail.state, 'notConnected');
  assert.strictEqual(mail.reason, 'Not signed in. Call login first.');
  assert.strictEqual(row(s.tools, 'tickets').reason, 'Not signed in yet.', 'no sign-in file: the check is not run');
  assert.strictEqual(row(s.tools, 'tickets').notYet, true, 'nothing tried yet');
  assert.strictEqual(row(s.tools, 'docs').notYet, true, 'no token yet');
  assert.strictEqual(mail.notYet, false, 'a check that ran and failed');
  assert.ok(!s.runs.some((a) => a[0].endsWith('t-login')), 'its error would only say to run the sign-in command');
  assert.strictEqual(row(s.tools, 'docs').state, 'notConnected');
  assert.strictEqual(s.fetches.length, 0, 'no request without a token');
  assert.ok(s.changes.some((rows) => rows.some((r) => r.state === 'checking')), 'checking is shown');
  assert.ok(!fs.existsSync(s.claude), 'nothing registered');
  await allGone(s.spawned);
});

test('check: a command row signed in before runs its check; a failed check gives its last stderr line', async () => {
  const s = setup();
  ticketsSignedIn(s);
  await s.tools.check('tickets');
  assert.deepStrictEqual(s.runs[0], [path.join(s.home, '.local/bin/t-login'), '--status']);
  assert.strictEqual(row(s.tools, 'tickets').reason, 'not signed in', 'the command\'s last stderr line');
  assert.strictEqual(row(s.tools, 'tickets').notYet, false);
});

test('connect.button: the row carries the company file\'s label, else none', async () => {
  const s = setup();
  assert.strictEqual(row(s.tools, 'tickets').button, '');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-tools-'));
  temps.push(home);
  const data = JSON.parse(JSON.stringify(EXAMPLE));
  data.mcpServers.find((x) => x.id === 'tickets').connect.button = '  Sign in with Example  ';
  const file = path.join(home, 'company.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const t = new Tools({ company: readCompany(file, { home }).company, home, run: async () => ({ code: 0 }), claudeJson: path.join(home, '.claude.json') });
  assert.strictEqual(row(t, 'tickets').button, 'Sign in with Example');
});

test('connectMcpTool: the prompt, then connected and registered', async () => {
  const s = setup();
  const prompts = [];
  const r = await s.tools.connectMcpTool('mail', { onPrompt: (p) => prompts.push(p) });
  assert.strictEqual(prompts.length, 1);
  assert.strictEqual(prompts[0].url, 'https://login.example.com/device');
  assert.strictEqual(prompts[0].code, 'ABCD-1234');
  assert.ok(s.changes.some((rows) => rows.some((x) => x.id === 'mail' && x.state === 'connecting' && x.prompt && x.prompt.code === 'ABCD-1234')));
  assert.strictEqual(r.state, 'connected', r.reason);
  assert.strictEqual(r.reason, '');
  assert.strictEqual(r.prompt, null);
  assert.ok(fs.existsSync(path.join(s.home, '.example-token.json')));
  const j = readJson(s.claude);
  assert.strictEqual(j.mcpServers.mail.command, process.execPath);
  assert.deepStrictEqual(j.mcpServers.mail.args, [FIXTURE]);
  assert.strictEqual(s.spawned.length, 2, 'one process for both calls, one for the check');
  await allGone(s.spawned);
});

test('saveToken: trimmed, checked with that token, saved only on a pass', async () => {
  const s = setup();
  s.status.code = 401;
  let r = await s.tools.saveToken('docs', ' bad\n');
  assert.strictEqual(r.state, 'notConnected');
  assert.strictEqual(r.reason, 'HTTP 401');
  assert.ok(!fs.existsSync(path.join(s.home, '.config/roost/tokens/docs')), 'no token file');
  assert.ok(!fs.existsSync(s.claude));

  s.status.code = 200;
  r = await s.tools.saveToken('docs', ' tok\n');
  assert.strictEqual(r.state, 'connected');
  const f = path.join(s.home, '.config/roost/tokens/docs');
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'tok\n');
  if (process.platform !== 'win32') {
    assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.dirname(f)).mode & 0o777, 0o700);
  }
  const req = s.fetches[s.fetches.length - 1];
  assert.strictEqual(req.url, 'https://mcp.example.com/mcp');
  assert.strictEqual(req.init.method, 'POST');
  assert.strictEqual(req.init.headers.Authorization, 'Bearer tok');
  assert.strictEqual(req.init.headers['Content-Type'], 'application/json');
  assert.strictEqual(req.init.headers.Accept, 'application/json, text/event-stream');
  const body = JSON.parse(req.init.body);
  assert.strictEqual(body.method, 'initialize');
  assert.strictEqual(body.jsonrpc, '2.0');
  assert.strictEqual(body.params.protocolVersion, '2025-06-18');
  assert.deepStrictEqual(readJson(s.claude).mcpServers.docs, { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer tok' } });
  assert.ok(!/Bearer|"tok"|"bad"/.test(JSON.stringify(s.changes)), 'the token is never in a row');

  // a later check reads the saved token
  await s.tools.check('docs');
  assert.strictEqual(s.fetches[s.fetches.length - 1].init.headers.Authorization, 'Bearer tok');
  assert.strictEqual(row(s.tools, 'docs').state, 'connected');

  // a new token replaces Roost's own entry: no conflict
  r = await s.tools.saveToken('docs', 'tok2');
  assert.strictEqual(r.conflict, false);
  assert.strictEqual(readJson(s.claude).mcpServers.docs.headers.Authorization, 'Bearer tok2');
  // an empty token is never checked or saved
  const n = s.fetches.length;
  r = await s.tools.saveToken('docs', '  \n');
  assert.strictEqual(r.state, 'notConnected');
  assert.strictEqual(s.fetches.length, n);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), 'tok2\n');
});

test('a fetch that fails gives its message', async () => {
  const s = setup({ fetch: async () => { throw new Error('getaddrinfo ENOTFOUND mcp.example.com'); } });
  const r = await s.tools.saveToken('docs', 'tok');
  assert.strictEqual(r.state, 'notConnected');
  assert.ok(r.reason.includes('ENOTFOUND'), r.reason);
});

test('connectCommand: the terminal closing without the file, then the file appearing', async () => {
  const s = setup();
  const done = path.join(s.home, '.t', 'credentials.json');
  let argvs = [];
  let r = await s.tools.connectCommand('tickets', { runInTerminal: (argv) => { argvs.push(argv); return { closed: Promise.resolve() }; } });
  assert.deepStrictEqual(argvs, [[path.join(s.home, '.local/bin/t-login')]]);
  assert.strictEqual(r.state, 'notConnected');
  assert.ok(r.reason, 'it says why');
  assert.strictEqual(s.runs.length, 0, 'no check without the file');

  s.runResult.code = 0;
  r = await s.tools.connectCommand('tickets', { runInTerminal: () => {
    fs.mkdirSync(path.dirname(done), { recursive: true });
    fs.writeFileSync(done, '{}');
    return { closed: new Promise(() => {}) };
  } });
  assert.strictEqual(r.state, 'connected', r.reason);
  assert.strictEqual(s.runs.length, 1);
  assert.deepStrictEqual(readJson(s.claude).mcpServers.tickets, { type: 'stdio', command: '/opt/t/mcp', args: [], env: {} });
});

test('connectCommand, signing in again: an existing file is done only once it is rewritten, or the terminal closes', async () => {
  const s = setup();
  s.runResult.code = 0;
  s.tools.pollMs = 20;
  const done = path.join(s.home, '.t', 'credentials.json');
  fs.mkdirSync(path.dirname(done), { recursive: true });
  fs.writeFileSync(done, '{"old":1}');
  const old = new Date(Date.now() - 60000);
  fs.utimesSync(done, old, old);
  let rewritten = false;
  const p = s.tools.connectCommand('tickets', { runInTerminal: () => {
    setTimeout(() => { fs.writeFileSync(done, '{"new":1}'); rewritten = true; }, 150);
    return { closed: new Promise(() => {}) };
  } });
  await new Promise((r) => setTimeout(r, 80));
  assert.strictEqual(row(s.tools, 'tickets').state, 'connecting', 'still waiting: the file is the old one');
  assert.strictEqual(s.runs.length, 0);
  const r = await p;
  assert.ok(rewritten);
  assert.strictEqual(r.state, 'connected', r.reason);
  assert.strictEqual(s.runs.length, 1);

  // the terminal closes leaving the older file: it is checked, not taken as done
  fs.utimesSync(done, old, old);
  s.runResult.code = 1;
  let close;
  const q = s.tools.connectCommand('tickets', { runInTerminal: () => ({ closed: new Promise((res) => { close = res; }) }) });
  await new Promise((res) => setTimeout(res, 60));
  assert.strictEqual(row(s.tools, 'tickets').state, 'connecting');
  assert.strictEqual(row(s.tools, 'tickets').reason, 'If the sign-in failed, close its terminal to try again.', 'the waiting row says how to get out');
  close();
  const r2 = await q;
  assert.strictEqual(s.runs.length, 2, 'checked once the terminal closed');
  assert.strictEqual(r2.state, 'notConnected');
  assert.strictEqual(r2.reason, 'not signed in');
});

test('connectCommand: polls for the file until it appears', async () => {
  const s = setup();
  s.runResult.code = 0;
  s.tools.pollMs = 20;
  const done = path.join(s.home, '.t', 'credentials.json');
  const r = await s.tools.connectCommand('tickets', { runInTerminal: () => {
    setTimeout(() => { fs.mkdirSync(path.dirname(done), { recursive: true }); fs.writeFileSync(done, '{}'); }, 60);
    return { closed: new Promise(() => {}) };
  } });
  assert.strictEqual(r.state, 'connected', r.reason);
});

test('a check command that does not exist: "not found"', async () => {
  const s = setup();
  ticketsSignedIn(s);
  const tools = new Tools({ company: s.company, home: s.home, claudeJson: s.claude, onChange: () => {} });
  const r = await tools.check('tickets');
  assert.strictEqual(r.state, 'notConnected');
  assert.ok(r.reason.includes('not found'), r.reason);
  assert.ok(r.reason.includes('t-login'), r.reason);
});

test('the default runner: exit 0 passes, otherwise the last stderr line', async () => {
  const s = setup();
  const data = { name: 'R', mcpServers: [
    { id: 'ok', name: 'ok', about: '', register: { type: 'stdio', command: '/x' }, connect: { kind: 'none', check: { command: [process.execPath, '-e', '0'] } } },
    { id: 'no', name: 'no', about: '', register: { type: 'stdio', command: '/x' }, connect: { kind: 'none', check: { command: [process.execPath, '-e', 'console.error("one\\ntwo"); process.exit(2)'] } } },
  ] };
  const f = path.join(s.home, 'r.json');
  fs.writeFileSync(f, JSON.stringify(data));
  const tools = new Tools({ company: readCompany(f, { home: s.home }).company, home: s.home, claudeJson: s.claude, onChange: () => {} });
  assert.strictEqual((await tools.connectNone('ok')).state, 'connected');
  const no = await tools.connectNone('no');
  assert.strictEqual(no.state, 'notConnected');
  assert.strictEqual(no.reason, 'two');
});

test('none without a check: always connected; doneWhen without a check: the file', async () => {
  const s = setup();
  const data = { name: 'N', mcpServers: [
    { id: 'plain', name: 'p', about: '', register: { type: 'http', url: 'https://p.example.com/mcp' } },
    { id: 'filed', name: 'f', about: '', register: { type: 'stdio', command: '/x' }, connect: { kind: 'command', command: ['/x'], doneWhen: { file: '~/f' } } },
  ] };
  const f = path.join(s.home, 'n.json');
  fs.writeFileSync(f, JSON.stringify(data));
  const tools = new Tools({ company: readCompany(f, { home: s.home }).company, home: s.home, claudeJson: s.claude, onChange: () => {} });
  assert.strictEqual((await tools.connectNone('plain')).state, 'connected');
  assert.strictEqual((await tools.check('filed')).state, 'notConnected');
  fs.writeFileSync(path.join(s.home, 'f'), '');
  assert.strictEqual((await tools.check('filed')).state, 'connected');
  assert.deepStrictEqual(Object.keys(readJson(s.claude).mcpServers), ['plain', 'filed']);
});

test('a different entry already in ~/.claude.json: conflict until replaceRegistration', async () => {
  const mine = { type: 'http', url: 'https://other.example.com/mcp', headers: {} };
  const s = setup({ claudeJson: JSON.stringify({ mcpServers: { docs: mine } }) });
  const r = await s.tools.saveToken('docs', 'tok');
  assert.strictEqual(r.state, 'notConnected', 'not connected while Claude Code has another entry');
  assert.strictEqual(r.signedIn, true);
  assert.strictEqual(r.conflict, true);
  assert.ok(r.reason.includes('already has a different server named docs'), r.reason);
  assert.deepStrictEqual(readJson(s.claude).mcpServers.docs, mine, 'left as it was');
  assert.strictEqual(fs.readFileSync(path.join(s.home, '.config/roost/tokens/docs'), 'utf8'), 'tok\n', 'the token is kept for Replace');
  // the conflict stays across a later check, until Replace
  assert.strictEqual((await s.tools.check('docs')).conflict, true);
  const after = await s.tools.replaceRegistration('docs');
  assert.strictEqual(after.conflict, false);
  assert.strictEqual(after.state, 'connected');
  assert.strictEqual(after.reason, '');
  assert.strictEqual(readJson(s.claude).mcpServers.docs.headers.Authorization, 'Bearer tok');
});

test('allConnected: false while a signed-in row is in conflict or its registration failed', async () => {
  const s = setup({ claudeJson: JSON.stringify({ mcpServers: { tickets: { type: 'stdio', command: '/other', args: [], env: {} } } }) });
  s.runResult.code = 0;
  await s.tools.saveToken('docs', 'tok');
  await s.tools.connectMcpTool('mail', { onPrompt: () => {} });
  ticketsSignedIn(s);
  await s.tools.check('tickets');
  assert.strictEqual(row(s.tools, 'docs').state, 'connected');
  assert.strictEqual(row(s.tools, 'mail').state, 'connected');
  assert.strictEqual(row(s.tools, 'tickets').conflict, true);
  assert.strictEqual(s.tools.allConnected(), false);
  await s.tools.replaceRegistration('tickets');
  assert.strictEqual(s.tools.allConnected(), true);
  // a ~/.claude.json that stops parsing: the next check is not connected
  fs.writeFileSync(s.claude, '{');
  await s.tools.check('docs');
  assert.strictEqual(row(s.tools, 'docs').state, 'notConnected');
  assert.strictEqual(row(s.tools, 'docs').signedIn, true);
  assert.strictEqual(s.tools.allConnected(), false);
});

test('a ~/.claude.json that does not parse: left alone, and the row says so', async () => {
  const s = setup({ claudeJson: '{' });
  const r = await s.tools.saveToken('docs', 'tok');
  assert.strictEqual(r.state, 'notConnected');
  assert.strictEqual(r.signedIn, true);
  assert.ok(r.reason.includes('is not a JSON object; it was left alone'), r.reason);
  assert.strictEqual(fs.readFileSync(s.claude, 'utf8'), '{');
});

test('rowForTokenFile, and allConnected once all three pass', async () => {
  const s = setup();
  assert.strictEqual(s.tools.rowForTokenFile(path.join(s.home, '.example-token.json')), 'mail');
  assert.strictEqual(s.tools.rowForTokenFile(path.join(s.home, '.t', 'credentials.json')), 'tickets');
  assert.strictEqual(s.tools.rowForTokenFile(path.join(s.home, 'other')), null);
  assert.strictEqual(s.tools.allConnected(), false);
  await s.tools.saveToken('docs', 'tok');
  assert.strictEqual(s.tools.allConnected(), false);
  await s.tools.connectMcpTool('mail', { onPrompt: () => {} });
  assert.strictEqual(s.tools.allConnected(), false);
  s.runResult.code = 0;
  ticketsSignedIn(s);
  await s.tools.check('tickets');
  assert.strictEqual(s.tools.allConnected(), true);
  s.tools.dispose();
});

test('a server that exits at once: the row says why, nothing left running', async () => {
  const s = setup();
  s.company.mcpServers[1].register.env.FAKE_MCP_MODE = 'exit';
  const r = await s.tools.connectMcpTool('mail', { onPrompt: () => assert.fail('no prompt') });
  assert.strictEqual(r.state, 'notConnected');
  assert.strictEqual(r.reason, 'the server exited');
  await allGone(s.spawned);
});

// ---- install: a server's program from its GitHub release, through gh (a fake runner here: no gh, no network)
function installSetup({ tag, assets = { 'linux-x64': 'wiki-mcp-linux-x64', 'darwin-arm64': 'wiki-mcp-darwin-arm64' }, platform = 'linux-x64' } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-install-'));
  temps.push(home);
  const tmpDir = path.join(home, 'tmp'); fs.mkdirSync(tmpDir);
  const install = { github: { repo: 'example-org/wiki-mcp', assets }, to: '~/.local/bin/wiki-mcp' };
  if (tag) install.github.tag = tag;
  const data = { name: 'Example Co', mcpServers: [{ id: 'wiki', name: 'Example Wiki', about: 'the wiki',
    register: { type: 'stdio', command: '~/.local/bin/wiki-mcp' }, connect: { kind: 'none' }, install }] };
  const file = path.join(home, 'company.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const r = readCompany(file, { home });
  assert.ok(r.ok, r.error);
  const runs = [];
  const gh = { signedIn: true, download: { code: 0, stderr: '' }, bytes: '#!/bin/sh\necho wiki\n' };
  const run = async (argv) => {
    runs.push(argv);
    if (argv[0] !== 'gh') throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: 'ENOENT' });
    if (argv[1] === 'auth') return gh.signedIn ? { code: 0, stderr: '' } : { code: 1, stderr: 'You are not logged into any GitHub hosts. To log in, run: gh auth login\n' };
    if (argv[1] === 'release' && argv[2] === 'download') {
      if (gh.download.code === 0) fs.writeFileSync(argv[argv.indexOf('--output') + 1], gh.bytes);
      return { ...gh.download };
    }
    return { code: 1, stderr: 'unknown' };
  };
  const tools = new Tools({ company: r.company, home, run, platform, tmpDir, claudeJson: path.join(home, '.claude.json') });
  return { home, tools, runs, gh, tmpDir, to: path.join(home, '.local', 'bin', 'wiki-mcp') };
}

test('install: platformKey is process.platform-process.arch; a token-like text is scrubbed', () => {
  assert.strictEqual(platformKey('darwin', 'arm64'), 'darwin-arm64');
  assert.strictEqual(platformKey('linux', 'x64'), 'linux-x64');
  assert.strictEqual(platformKey(), `${process.platform}-${process.arch}`);
  assert.strictEqual(scrub('HTTP 401 for ghp_abcDEF123 and gho_x_y, github_pat_11AB_cd'), 'HTTP 401 for ghp_… and gho_…, github_pat_…');
});

test('install: already there, nothing downloaded and no gh run', async () => {
  const s = installSetup();
  fs.mkdirSync(path.dirname(s.to), { recursive: true });
  fs.writeFileSync(s.to, 'x');
  const r = await s.tools.connectNone('wiki');
  assert.strictEqual(r.state, 'connected', r.reason);
  assert.deepStrictEqual(s.runs, []);
});

test('install: downloaded from the latest release (no tag on argv), placed at `to` mode 0755, then connected', async () => {
  const s = installSetup();
  assert.strictEqual((await s.tools.check('wiki')).reason, NOT_INSTALLED, 'a check never downloads');
  assert.deepStrictEqual(s.runs, []);
  const r = await s.tools.connectNone('wiki');
  assert.strictEqual(r.state, 'connected', r.reason);
  assert.deepStrictEqual(s.runs[0], ['gh', 'auth', 'status']);
  const dl = s.runs[1];
  const out = dl[dl.indexOf('--output') + 1];
  assert.deepStrictEqual(dl, ['gh', 'release', 'download', '--repo', 'example-org/wiki-mcp', '--pattern', 'wiki-mcp-linux-x64', '--output', out]);
  assert.ok(out.startsWith(s.tmpDir + path.sep), 'to a temporary file first');
  assert.strictEqual(fs.readFileSync(s.to, 'utf8'), s.gh.bytes);
  if (process.platform !== 'win32') assert.strictEqual(fs.statSync(s.to).mode & 0o777, 0o755);
  assert.deepStrictEqual(fs.readdirSync(s.tmpDir), [], 'the temporary directory is gone');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(s.to)), ['wiki-mcp'], 'nothing else left beside it');
  // a tag: on argv, before the options
  const t = installSetup({ tag: 'v1.2.3', platform: 'darwin-arm64' });
  await t.tools.connectNone('wiki');
  assert.deepStrictEqual(t.runs[1].slice(0, 8), ['gh', 'release', 'download', 'v1.2.3', '--repo', 'example-org/wiki-mcp', '--pattern', 'wiki-mcp-darwin-arm64']);
});

test('install: gh not signed in: "Sign in to GitHub first", the row\'s action, and no download', async () => {
  const s = installSetup();
  s.gh.signedIn = false;
  const r = await s.tools.connectNone('wiki');
  assert.deepStrictEqual([r.state, r.reason, r.action], ['notConnected', GITHUB_FIRST, 'githubSignIn']);
  assert.deepStrictEqual(s.runs, [['gh', 'auth', 'status']]);
  assert.strictEqual(fs.existsSync(s.to), false);
  // signed in now: Connect again downloads, and the action is gone
  s.gh.signedIn = true;
  const again = await s.tools.connectNone('wiki');
  assert.deepStrictEqual([again.state, again.action], ['connected', '']);
});

test('install: no asset for this platform: said, with the platform, and gh never run', async () => {
  const s = installSetup({ platform: 'linux-arm64' });
  const r = await s.tools.connectNone('wiki');
  assert.deepStrictEqual([r.state, r.reason, r.action], ['notConnected', 'No download of Example Wiki for this computer (linux-arm64).', '']);
  assert.deepStrictEqual(s.runs, []);
});

test('install: a download that fails: a short reason, token-like text scrubbed, nothing placed', async () => {
  const s = installSetup();
  s.gh.download = { code: 1, stderr: 'some progress\nHTTP 404: Not Found (https://api.github.com/repos/example-org/wiki-mcp/releases/latest) token ghs_Secret123\n' };
  const r = await s.tools.connectNone('wiki');
  assert.strictEqual(r.state, 'notConnected');
  assert.strictEqual(r.reason, 'The download of Example Wiki failed: HTTP 404: Not Found (https://api.github.com/repos/example-org/wiki-mcp/releases/latest) token ghs_…');
  assert.ok(!JSON.stringify(s.tools.rows()).includes('Secret123'));
  assert.strictEqual(fs.existsSync(s.to), false);
  assert.deepStrictEqual(fs.readdirSync(s.tmpDir), [], 'the temporary directory is gone');
  // gh itself missing
  const m = installSetup();
  m.tools.run = async (argv) => { throw Object.assign(new Error(`spawn ${argv[0]} ENOENT`), { code: 'ENOENT' }); };
  const nogh = await m.tools.connectNone('wiki');
  assert.strictEqual(nogh.reason, "Example Wiki couldn't be downloaded: the GitHub CLI (gh) isn't installed; the Roost installer installs it.");
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); } catch (e) { console.error(`FAIL ${t.name}\n`, e); process.exit(1); }
  }
  console.log('tools.test.js passed');
})();
