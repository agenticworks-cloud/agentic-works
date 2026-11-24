'use strict';
// McpStdioClient: an MCP server over stdio (newline-delimited JSON-RPC 2.0), against test/fixtures/fakeMcpServer.js.
// A server that exits at once, prints only non-JSON, or never answers rejects start() and is left not running.
const assert = require('node:assert');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { McpStdioClient } = require('../src/mcpClient');

const FIXTURE = path.join(__dirname, 'fixtures', 'fakeMcpServer.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-mcp-'));
const children = [];
process.on('exit', () => {
  children.forEach((c) => { if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL'); });
  fs.rmSync(dir, { recursive: true, force: true });
});

function client(env, opts = {}) {
  const spawn = (...a) => { const c = childProcess.spawn(...a); children.push(c); return c; };
  return new McpStdioClient({ command: process.execPath, args: [FIXTURE], env, spawn, ...opts });
}

async function gone(child) {
  const until = Date.now() + 3000;
  while (Date.now() < until) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('the server process is still running 3 s later');
}

async function rejects(p, text) {
  await assert.rejects(p, (e) => { assert.ok(e.message.includes(text), `"${e.message}" should include "${text}"`); return true; });
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('start, then a tool call that needs the sign-in', async () => {
  const tokenFile = path.join(dir, 't1.json');
  const c = client({ FAKE_MCP_TOKEN_FILE: tokenFile });
  await c.start();
  const r = await c.callTool('whoami', {});
  assert.strictEqual(r.isError, true);
  assert.ok(r.text.includes('Not signed in'));
  c.close();
  await gone(children[children.length - 1]);
});

test('login: the prompt, then complete writes the file, and whoami passes', async () => {
  const tokenFile = path.join(dir, 't2.json');
  const c = client({ FAKE_MCP_TOKEN_FILE: tokenFile });
  await c.start();
  const p = await c.callTool('login', {});
  assert.deepStrictEqual(p, { text: 'To sign in, open https://login.example.com/device and enter code ABCD-1234.', isError: false });
  const done = await c.callTool('login', { complete: true });
  assert.deepStrictEqual(done, { text: 'Login successful', isError: false });
  assert.ok(fs.existsSync(tokenFile));
  assert.strictEqual((await c.callTool('whoami', {})).isError, false);
  c.close();
  await gone(children[children.length - 1]);
});

// A child that answers initialize (after a line that isn't JSON) and nothing else.
function fakeChild(sent) {
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const child = new EventEmitter();
  child.pid = 1;
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.exitCode = null;
  child.signalCode = null;
  child.kill = (sig) => {
    child.signalCode = sig;
    setImmediate(() => { child.emit('exit', null, sig); child.emit('close', null, sig); });
    return true;
  };
  child.stdin.on('data', (d) => {
    for (const line of String(d).split('\n').filter(Boolean)) {
      const m = JSON.parse(line);
      sent.push(m);
      if (m.method === 'initialize') child.stdout.write('not json\n' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: {} }) + '\n');
    }
  });
  return child;
}

test('the initialize request', async () => {
  const sent = [];
  const child = fakeChild(sent);
  let spawned;
  const c = new McpStdioClient({ command: '/bin/x', args: ['a'], env: { A: '1' }, spawn: (cmd, args, o) => { spawned = { cmd, args, o }; return child; } });
  await c.start();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(spawned.cmd, '/bin/x');
  assert.deepStrictEqual(spawned.args, ['a']);
  assert.strictEqual(spawned.o.env.A, '1');
  assert.strictEqual(spawned.o.env.PATH, process.env.PATH);
  assert.strictEqual(sent[0].jsonrpc, '2.0');
  assert.strictEqual(sent[0].method, 'initialize');
  assert.strictEqual(sent[0].params.protocolVersion, '2025-06-18');
  assert.deepStrictEqual(sent[0].params.clientInfo, { name: 'roost' });
  assert.strictEqual(sent[1].method, 'notifications/initialized');
  assert.strictEqual(sent[1].id, undefined);
  c.close();
  assert.strictEqual(child.signalCode, 'SIGTERM');
});

test('a call that times out rejects "no answer in N s", and the process is closed', async () => {
  const child = fakeChild([]);
  const c = new McpStdioClient({ command: '/bin/x', spawn: () => child });
  await c.start();
  await rejects(c.callTool('whoami', {}, { timeoutMs: 50 }), 'no answer in 0.1 s');
  assert.strictEqual(child.signalCode, 'SIGTERM');
  await rejects(c.callTool('whoami', {}), 'the server exited');
});

test('mode exit: start rejects "the server exited"', async () => {
  const c = client({ FAKE_MCP_MODE: 'exit' });
  await rejects(c.start(), 'the server exited');
  await gone(children[children.length - 1]);
});

test('mode garbage: start rejects "no answer in", and the process is killed', async () => {
  const c = client({ FAKE_MCP_MODE: 'garbage' }, { startTimeoutMs: 200 });
  await rejects(c.start(), 'no answer in');
  await gone(children[children.length - 1]);
});

test('mode silent: start rejects "no answer in", and the process is killed', async () => {
  const c = client({ FAKE_MCP_MODE: 'silent' }, { startTimeoutMs: 200 });
  await rejects(c.start(), 'no answer in');
  await gone(children[children.length - 1]);
});

test('a command that does not exist rejects "<command> not found"', async () => {
  const c = new McpStdioClient({ command: path.join(dir, 'no-such-server') });
  await rejects(c.start(), `${path.join(dir, 'no-such-server')} not found`);
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); } catch (e) { console.error(`FAIL ${t.name}\n`, e); process.exit(1); }
  }
  console.log('mcpClient.test.js passed');
})();
