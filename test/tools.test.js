'use strict';
// Tools: the company's MCP servers as rows, each signed in its own way (tokenPage, command, mcpTool, none), connected
// only once its check passes, then registered with Claude Code at user scope. The mail server is
// test/fixtures/fakeMcpServer.js through node; fetch, the command runner and the terminal are fakes.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Tools, promptOf, TOKEN_DIR } = require('../src/tools');
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
  assert.deepStrictEqual(s.tools.rows().map((r) => [r.id, r.kind, r.state, r.page, r.prompt, r.conflict]), [
    ['docs', 'tokenPage', 'unknown', 'https://mcp.example.com/token', null, false],
    ['mail', 'mcpTool', 'unknown', '', null, false],
    ['tickets', 'command', 'unknown', '', null, false],
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
  assert.strictEqual(row(s.tools, 'tickets').reason, 'not signed in', 'the command\'s last stderr line');
  assert.deepStrictEqual(s.runs[0], [path.join(s.home, '.local/bin/t-login'), '--status']);
  assert.strictEqual(row(s.tools, 'docs').state, 'notConnected');
  assert.strictEqual(s.fetches.length, 0, 'no request without a token');
  assert.ok(s.changes.some((rows) => rows.some((r) => r.state === 'checking')), 'checking is shown');
  assert.ok(!fs.existsSync(s.claude), 'nothing registered');
  await allGone(s.spawned);
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
  assert.strictEqual(r.state, 'connected');
  assert.strictEqual(r.conflict, true);
  assert.deepStrictEqual(readJson(s.claude).mcpServers.docs, mine, 'left as it was');
  const after = await s.tools.replaceRegistration('docs');
  assert.strictEqual(after.conflict, false);
  assert.strictEqual(readJson(s.claude).mcpServers.docs.headers.Authorization, 'Bearer tok');
});

test('a ~/.claude.json that does not parse: left alone, and the row says so', async () => {
  const s = setup({ claudeJson: '{' });
  const r = await s.tools.saveToken('docs', 'tok');
  assert.strictEqual(r.state, 'connected');
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

(async () => {
  for (const t of tests) {
    try { await t.fn(); } catch (e) { console.error(`FAIL ${t.name}\n`, e); process.exit(1); }
  }
  console.log('tools.test.js passed');
})();
