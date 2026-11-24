'use strict';
// The company file loader (src/company.js, copied byte for byte to parts/agents/src/company.js).
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { companyFile, readCompany } = require('../src/company');

const EXAMPLE = { name: 'Example Co',
  gateway: { name: 'Example Gateway', baseUrls: ['https://ai.example.com/llm-api', 'https://public.example.com/llm-api'],
             keyPage: 'https://ai.example.com/api-access', requiredModel: 'router-auto', env: { ANTHROPIC_MODEL: 'router-auto' },
             keyFiles: ['~/.config/example-gateway/token'], terminal: true },
  mcpServers: [
    { id: 'docs', name: 'Example Docs', about: 'the docs', register: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${token}' } },
      connect: { kind: 'tokenPage', page: 'https://mcp.example.com/token', check: { method: 'POST', url: 'https://mcp.example.com/mcp', body: 'initialize' } } },
    { id: 'mail', name: 'Example Mail', about: 'mail', register: { type: 'stdio', command: '~/.local/bin/example-mcp', env: { EXAMPLE_ID: '00000000-0000-0000-0000-000000000000' } },
      connect: { kind: 'mcpTool', tool: 'login', args: {}, complete: { complete: true }, doneWhen: { file: '~/.example-token.json' }, check: { mcpTool: 'whoami' } } },
    { id: 'tickets', name: 'Example Tickets', about: 'tickets', register: { type: 'stdio', command: '/opt/t/mcp' },
      connect: { kind: 'command', command: ['~/.local/bin/t-login'], doneWhen: { file: '~/.t/credentials.json' }, check: { command: ['~/.local/bin/t-login', '--status'] } } },
  ] };
const clone = (o) => JSON.parse(JSON.stringify(o));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-company-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
let n = 0;
function read(data) {
  const f = path.join(dir, `c${n++}.json`);
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
  return readCompany(f, { home: '/h' });
}
function invalid(data, at) {
  const r = read(data);
  assert.strictEqual(r.ok, false, `${at} should be invalid`);
  assert.strictEqual(r.missing, false);
  assert.ok(r.error.startsWith(at), `${r.error} should start with ${at}`);
}

assert.strictEqual(companyFile({ env: { ROOST_COMPANY_FILE: '/x/c.json' }, home: '/h' }), '/x/c.json');
assert.strictEqual(companyFile({ env: {}, home: '/h' }), '/h/.config/roost/company.json');

const ok = read(EXAMPLE);
assert.strictEqual(ok.ok, true, ok.error);
const c = ok.company;
assert.strictEqual(c.name, 'Example Co');
assert.deepStrictEqual(c.gateway.keyFiles, ['/h/.config/example-gateway/token']);
assert.strictEqual(c.gateway.requiredModel, 'router-auto');
assert.strictEqual(c.gateway.terminal, true);
assert.strictEqual(c.mcpServers[1].register.command, '/h/.local/bin/example-mcp');
assert.deepStrictEqual(c.mcpServers[1].connect.check, { kind: 'mcpTool', tool: 'whoami', args: {} });
assert.strictEqual(c.mcpServers[1].connect.doneWhen.file, '/h/.example-token.json');
assert.deepStrictEqual(c.mcpServers[0].connect.check, { kind: 'request', method: 'POST', url: 'https://mcp.example.com/mcp', body: 'initialize' });
assert.deepStrictEqual(c.mcpServers[2].connect.check, { kind: 'command', argv: ['/h/.local/bin/t-login', '--status'] });
assert.deepStrictEqual(c.mcpServers[2].connect.command, ['/h/.local/bin/t-login']);

// a minimal file, and defaults
const min = read({ name: 'Min' });
assert.deepStrictEqual(min.company, { name: 'Min', gateway: null, mcpServers: [] });
const g = read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k' } }).company.gateway;
assert.deepStrictEqual(g, { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', requiredModel: '', env: {}, keyFiles: [], terminal: false });

// missing and unreadable JSON
assert.deepStrictEqual({ ...readCompany(path.join(dir, 'nope.json')), error: undefined }, { ok: false, missing: true, error: undefined });
const bad = read('{');
assert.strictEqual(bad.ok, false);
assert.strictEqual(bad.missing, false);
assert.ok(/JSON/.test(bad.error), bad.error);

// each is invalid, naming the path
const mut = (fn) => { const d = clone(EXAMPLE); fn(d); return d; };
invalid(mut((d) => { delete d.name; }), 'name');
invalid(mut((d) => { d.gateway.baseUrls = []; }), 'gateway.baseUrls');
invalid(mut((d) => { d.gateway.baseUrls = ['ftp://x']; }), 'gateway.baseUrls[0]');
invalid(mut((d) => { d.mcpServers[1].id = 'docs'; }), 'mcpServers[1].id');
invalid(mut((d) => { d.mcpServers[0].connect.kind = 'oauth'; }), 'mcpServers[0].connect.kind');
invalid(mut((d) => { delete d.mcpServers[2].connect.doneWhen; }), 'mcpServers[2].connect.doneWhen');
invalid(mut((d) => { d.mcpServers[1].register = { type: 'http', url: 'https://mcp.example.com/mcp' }; }), 'mcpServers[1].register.type');
invalid(mut((d) => { d.mcpServers[1].register.env.X = 'a ${token}'; }), 'mcpServers[1].register');
invalid(mut((d) => { d.gateway.keyPage = 'nope'; }), 'gateway.keyPage');
invalid(mut((d) => { d.gateway.env.A = 1; }), 'gateway.env.A');
invalid(mut((d) => { d.mcpServers = {}; }), 'mcpServers');
invalid(mut((d) => { d.mcpServers[0].id = 'a b'; }), 'mcpServers[0].id');
invalid(mut((d) => { delete d.mcpServers[0].connect.page; }), 'mcpServers[0].connect.page');
invalid([], 'the file');

// unknown keys are ignored
const extra = mut((d) => { d.future = 1; d.mcpServers[0].extra = { a: 1 }; });
assert.strictEqual(read(extra).ok, true);

// the two copies are identical
const root = path.join(__dirname, '..');
assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'company.js'), 'utf8'), fs.readFileSync(path.join(root, 'parts', 'agents', 'src', 'company.js'), 'utf8'), 'parts/agents/src/company.js is a copy of src/company.js');

console.log('company.test.js passed');
