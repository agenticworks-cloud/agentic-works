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
assert.deepStrictEqual(min.company, { name: 'Min', title: '', steps: { gateway: '', tools: '' }, gateway: null, mcpServers: [] });
const g = read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k' } }).company.gateway;
assert.deepStrictEqual(g, { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', requiredModel: '', env: {}, keyFiles: [], terminal: false, routerPrefixes: [] });
// router prefixes: optional, non-empty strings
const rp = read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', routerPrefixes: ['example-router'] } });
assert.deepStrictEqual(rp.company.gateway.routerPrefixes, ['example-router']);

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
invalid(mut((d) => { d.gateway.routerPrefixes = 'example-router'; }), 'gateway.routerPrefixes');
invalid(mut((d) => { d.gateway.routerPrefixes = ['ok', 3]; }), 'gateway.routerPrefixes[1]');
invalid(mut((d) => { d.gateway.routerPrefixes = ['']; }), 'gateway.routerPrefixes[0]');
invalid(mut((d) => { d.mcpServers[1].id = 'docs'; }), 'mcpServers[1].id');
invalid(mut((d) => { d.mcpServers[0].connect.kind = 'oauth'; }), 'mcpServers[0].connect.kind');
invalid(mut((d) => { delete d.mcpServers[2].connect.doneWhen; }), 'mcpServers[2].connect.doneWhen');
invalid(mut((d) => { d.mcpServers[1].register = { type: 'http', url: 'https://mcp.example.com/mcp' }; }), 'mcpServers[1].register.type');
invalid(mut((d) => { d.mcpServers[1].register.env.X = 'a ${token}'; }), 'mcpServers[1].register');
invalid(mut((d) => { d.gateway.keyPage = 'nope'; }), 'gateway.keyPage');
// ${token} only in a tokenPage server's headers or env: never on argv, nor in a URL
invalid(mut((d) => { d.mcpServers[0].register.url = 'https://mcp.example.com/mcp?key=${token}'; }), 'mcpServers[0].register.url');
const stdioToken = (reg) => mut((d) => { d.mcpServers[0].register = reg; });
invalid(stdioToken({ type: 'stdio', command: '/x', args: ['--token', '${token}'] }), 'mcpServers[0].register.args[1]');
invalid(stdioToken({ type: 'stdio', command: '/x/${token}' }), 'mcpServers[0].register.command');
assert.strictEqual(read(stdioToken({ type: 'stdio', command: '/x', env: { TOKEN: '${token}' } })).ok, true, 'a stdio env may hold the token');
invalid(mut((d) => { d.gateway.env.A = 1; }), 'gateway.env.A');
invalid(mut((d) => { d.mcpServers = {}; }), 'mcpServers');
invalid(mut((d) => { d.mcpServers[0].id = 'a b'; }), 'mcpServers[0].id');
invalid(mut((d) => { delete d.mcpServers[0].connect.page; }), 'mcpServers[0].connect.page');
invalid([], 'the file');

// install: a GitHub release's asset per platform, put at `to` (~ expanded); every value that reaches gh's argv checked
const INSTALL = { github: { repo: 'example-org/example-mcp', assets: { 'darwin-arm64': 'example-mcp-darwin-arm64', 'linux-x64': 'example-mcp-linux-x64', 'windows-x64': 'ignored.exe' } }, to: '~/.local/bin/example-mcp' };
const withInstall = (fn) => mut((d) => { d.mcpServers[1].install = clone(INSTALL); if (fn) fn(d.mcpServers[1].install); });
assert.strictEqual(c.mcpServers[1].install, null, 'none by default');
const inst = read(withInstall());
assert.strictEqual(inst.ok, true, inst.error);
assert.deepStrictEqual(inst.company.mcpServers[1].install, { github: { repo: 'example-org/example-mcp', tag: 'latest', assets: { 'darwin-arm64': 'example-mcp-darwin-arm64', 'linux-x64': 'example-mcp-linux-x64' } }, to: '/h/.local/bin/example-mcp' }, 'tag latest by default; an unknown platform ignored');
assert.strictEqual(read(withInstall((i) => { i.github.tag = 'v1.2.3'; })).company.mcpServers[1].install.github.tag, 'v1.2.3');
invalid(withInstall((i) => { i.github.repo = 'example-mcp'; }), 'mcpServers[1].install.github.repo');
invalid(withInstall((i) => { i.github.repo = 'a/b/c'; }), 'mcpServers[1].install.github.repo');
invalid(withInstall((i) => { i.github.repo = '--repo=x/y'; }), 'mcpServers[1].install.github.repo');
invalid(withInstall((i) => { i.github.tag = '--clobber'; }), 'mcpServers[1].install.github.tag');
invalid(withInstall((i) => { i.github.tag = ''; }), 'mcpServers[1].install.github.tag');
invalid(withInstall((i) => { i.github.assets['linux-x64'] = '../x'; }), 'mcpServers[1].install.github.assets.linux-x64');
invalid(withInstall((i) => { i.github.assets['linux-x64'] = '-x'; }), 'mcpServers[1].install.github.assets.linux-x64');
invalid(withInstall((i) => { i.github.assets = []; }), 'mcpServers[1].install.github.assets');
invalid(withInstall((i) => { delete i.github; }), 'mcpServers[1].install.github');
invalid(withInstall((i) => { delete i.to; }), 'mcpServers[1].install.to');
invalid(withInstall((i) => { i.to = 'bin/example-mcp'; }), 'mcpServers[1].install.to');

// unknown keys are ignored
const extra = mut((d) => { d.future = 1; d.mcpServers[0].extra = { a: 1 }; });
assert.strictEqual(read(extra).ok, true);

// title and steps: optional wording for the Get started page
{ const r = read(EXAMPLE); assert.strictEqual(r.company.title, ''); assert.deepStrictEqual(r.company.steps, { gateway: '', tools: '' }); }
{ const r = read({ ...clone(EXAMPLE), title: 'Example Works', steps: { gateway: 'Connect Example Gateway', tools: 'Connect Example tools', other: 1 } });
  assert.strictEqual(r.company.title, 'Example Works');
  assert.deepStrictEqual(r.company.steps, { gateway: 'Connect Example Gateway', tools: 'Connect Example tools' }); }
invalid({ ...clone(EXAMPLE), title: '' }, 'title');
invalid({ ...clone(EXAMPLE), title: 3 }, 'title');
invalid({ ...clone(EXAMPLE), steps: [] }, 'steps');
invalid({ ...clone(EXAMPLE), steps: { gateway: '' } }, 'steps.gateway');
invalid({ ...clone(EXAMPLE), steps: { tools: 5 } }, 'steps.tools');

// the two copies are identical
const root = path.join(__dirname, '..');
assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'company.js'), 'utf8'), fs.readFileSync(path.join(root, 'parts', 'agents', 'src', 'company.js'), 'utf8'), 'parts/agents/src/company.js is a copy of src/company.js');

console.log('company.test.js passed');
