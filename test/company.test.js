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

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-works-company-'));
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

assert.strictEqual(companyFile({ env: { AGENTIC_WORKS_COMPANY_FILE: '/x/c.json' }, home: '/h' }), '/x/c.json');
assert.strictEqual(companyFile({ env: {}, home: '/h' }), '/h/.config/agentic-works/company.json');

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
assert.deepStrictEqual(min.company, { name: 'Min', title: '', steps: { email: '', gateway: '', tools: '', talk: '' }, email: null, gateway: null, mcpServers: [], jira: { site: '', email: '' }, skills: [], notes: {}, icons: {} });
assert.deepStrictEqual(min.notes, []);
// email: the Get started page asks for the user's address on the company's domain; tools get it in the env named
{
  const em = read({ name: 'E', email: { domain: 'Example.com', env: 'EXAMPLE_EMAIL' }, steps: { email: 'Your work email' } });
  assert.strictEqual(em.ok, true, em.error);
  assert.deepStrictEqual(em.company.email, { domain: 'example.com', env: 'EXAMPLE_EMAIL', example: '' });
  assert.strictEqual(em.company.steps.email, 'Your work email');
  assert.deepStrictEqual(em.notes, []);
  assert.deepStrictEqual(read({ name: 'E', email: { domain: 'example.com' } }).company.email, { domain: 'example.com', env: '', example: '' });
  // example: the name part the box shows in grey before @<domain> (the company's own format, such as first.last)
  assert.deepStrictEqual(read({ name: 'E', email: { domain: 'example.com', example: 'first.last' } }).company.email, { domain: 'example.com', env: '', example: 'first.last' });
  for (const example of ['', 'a@b', 'has space', 'x'.repeat(65), 7]) {
    const r = read({ name: 'E', email: { domain: 'example.com', example } });
    assert.deepStrictEqual([r.company.email, r.notes.length], [{ domain: 'example.com', env: '', example: '' }, 1], JSON.stringify(example));
    assert.ok(r.notes[0].startsWith('email.example:'), r.notes[0]);
  }
  invalid({ name: 'E', steps: { email: '' } }, 'steps.email');
  // a bad section is dropped with a note: no email step
  for (const [email, note] of [
    ['example.com', 'email:'],
    [{}, 'email.domain:'],
    [{ domain: 'example' }, 'email.domain:'],
    [{ domain: 'ex ample.com' }, 'email.domain:'],
    [{ domain: '@example.com' }, 'email.domain:'],
    [{ domain: 'example.com', env: 'lower' }, 'email.env:'],
    [{ domain: 'example.com', env: '1X' }, 'email.env:'],
    [{ domain: 'example.com', env: 'PATH' }, 'email.env:'],
  ]) {
    const r = read({ ...EXAMPLE, email });
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.company.email, null, JSON.stringify(email));
    assert.strictEqual(r.notes.length, 1, JSON.stringify(r.notes));
    assert.ok(r.notes[0].startsWith(note), r.notes[0]);
  }
}
// notes: the company's own text at the top of a step's details, keyed as steps is (gateway, talk) or by step id
{
  const r = read({ name: 'N', notes: { github: 'Create your own account.\n\nThen ask for access.', gateway: 'Ask IT.', talk: 'Say hi.', secrets: 'Report a leaked key to security.' } });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.company.notes, { github: 'Create your own account.\n\nThen ask for access.', claude: 'Ask IT.', agents: 'Say hi.', secrets: 'Report a leaked key to security.' });
  assert.deepStrictEqual(r.notes, []);
  // a bad note is dropped with a note; the rest stay
  const bad = read({ name: 'N', notes: { github: 'ok', nope: 'x', jira: '', teams: 7, parts: 'x'.repeat(2001), codebase: 'a\u0007b' } });
  assert.deepStrictEqual(bad.company.notes, { github: 'ok' });
  assert.strictEqual(bad.notes.length, 5, JSON.stringify(bad.notes));
  assert.ok(bad.notes.every((x) => x.startsWith('notes.')), JSON.stringify(bad.notes));
  const notObj = read({ name: 'N', notes: 'x' });
  assert.deepStrictEqual([notObj.ok, notObj.company.notes, notObj.notes.length], [true, {}, 1]);
}
// icons: the company's own mark in place of a vendor's, a file beside the company file; one file, or light and dark
{
  for (const f of ['mark-black.svg', 'mark-white.svg', 'mark.png', 'mark.txt']) fs.writeFileSync(path.join(dir, f), '<svg/>');
  const r = read({ name: 'I', icons: { claude: { light: 'mark-black.svg', dark: 'mark-white.svg' }, codex: 'mark.png' } });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.company.icons, {
    claude: { light: path.join(dir, 'mark-black.svg'), dark: path.join(dir, 'mark-white.svg') },
    codex: { light: path.join(dir, 'mark.png'), dark: path.join(dir, 'mark.png') },
  });
  assert.deepStrictEqual(r.notes, []);
  assert.deepStrictEqual(read({ name: 'I' }).company.icons, {});
  // a bad entry is dropped with a note; the rest stay
  for (const [icons, note, kept] of [
    ['mark.png', 'icons:', {}],
    [{ gemini: 'mark.png' }, 'icons.gemini:', {}],
    [{ claude: 'missing.svg' }, 'icons.claude:', {}],
    [{ claude: 'mark.txt' }, 'icons.claude:', {}],
    [{ claude: { light: 'mark-black.svg' } }, 'icons.claude:', {}],
    [{ claude: 7, codex: 'mark.png' }, 'icons.claude:', { codex: { light: path.join(dir, 'mark.png'), dark: path.join(dir, 'mark.png') } }],
  ]) {
    const b = read({ name: 'I', icons });
    assert.strictEqual(b.ok, true, b.error);
    assert.deepStrictEqual(b.company.icons, kept, JSON.stringify(icons));
    assert.strictEqual(b.notes.length, 1, JSON.stringify(b.notes));
    assert.ok(b.notes[0].startsWith(note), b.notes[0]);
  }
}
// jira: the site and email the Get started page fills in; never a token (one there is ignored)
const jr = read({ name: 'J', jira: { site: 'https://example.atlassian.net', email: 'you@example.com', token: 'tok-1' } });
assert.strictEqual(jr.ok, true, jr.error);
assert.deepStrictEqual(jr.company.jira, { site: 'https://example.atlassian.net', email: 'you@example.com' });
assert.deepStrictEqual(jr.notes, []);
assert.ok(!JSON.stringify(jr.company).includes('tok-1'));
assert.deepStrictEqual(read({ name: 'J', jira: { site: 'https://example.atlassian.net' } }).company.jira, { site: 'https://example.atlassian.net', email: '' });
// a bad site or email is dropped with a note; the rest of the file still loads
for (const [jira, want, note] of [
  [{ site: 'http://example.atlassian.net', email: 'you@example.com' }, { site: '', email: 'you@example.com' }, 'jira.site:'],
  [{ site: 'example.atlassian.net' }, { site: '', email: '' }, 'jira.site:'],
  [{ site: 42 }, { site: '', email: '' }, 'jira.site:'],
  [{ site: 'https://example.atlassian.net', email: 'you' }, { site: 'https://example.atlassian.net', email: '' }, 'jira.email:'],
  [{ email: 'you@example' }, { site: '', email: '' }, 'jira.email:'],
  [{ email: 'a b@example.com' }, { site: '', email: '' }, 'jira.email:'],
  ['https://example.atlassian.net', { site: '', email: '' }, 'jira:'],
]) {
  const r = read({ ...EXAMPLE, jira });
  assert.strictEqual(r.ok, true, r.error);
  assert.deepStrictEqual(r.company.jira, want, JSON.stringify(jira));
  assert.strictEqual(r.notes.length, 1);
  assert.ok(r.notes[0].startsWith(note), r.notes[0]);
  assert.strictEqual(r.company.gateway.name, 'Example Gateway', 'the rest still loads');
}
// connect.button: a command or mcpTool row's Connect label; a bad one is dropped with a note
{
  const withButton = (button, id = 'tickets') => { const d = clone(EXAMPLE); d.mcpServers.find((x) => x.id === id).connect.button = button; return read(d); };
  const btn = (r, id = 'tickets') => r.company.mcpServers.find((x) => x.id === id).connect.button;
  assert.strictEqual(btn(read(EXAMPLE)), '');
  const ok = withButton('  Sign in with Example  ');
  assert.deepStrictEqual([ok.ok, btn(ok), ok.notes], [true, 'Sign in with Example', []]);
  assert.strictEqual(btn(withButton('Sign in', 'mail'), 'mail'), 'Sign in');
  for (const [b, id] of [['x'.repeat(41)], [''], ['  '], [42], ['a\nb'], ['Sign in', 'docs']]) {
    const r = withButton(b, id);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(btn(r, id || 'tickets'), '', JSON.stringify(b));
    assert.strictEqual(r.notes.length, 1);
    assert.ok(r.notes[0].startsWith(`mcpServers[${id === 'docs' ? 0 : 2}].connect.button:`), r.notes[0]);
  }
}
// skills: id and source; ~ expands, a relative source is from the company file's folder; a bad one makes the file invalid
{
  assert.deepStrictEqual(read(EXAMPLE).company.skills, []);
  const sk = read({ name: 'S', skills: [{ id: 'ms-teams', source: '~/pkg/ms-teams' }, { id: 'b2', source: 'skills/b2' }, { id: 'c', source: '/abs/c' }] });
  assert.strictEqual(sk.ok, true, sk.error);
  assert.deepStrictEqual(sk.company.skills, [{ id: 'ms-teams', source: '/h/pkg/ms-teams' }, { id: 'b2', source: path.join(dir, 'skills/b2') }, { id: 'c', source: '/abs/c' }]);
  for (const [skills, at] of [['x', 'skills:'], [[1], 'skills[0]:'], [[{ id: 'Teams', source: 'a' }], 'skills[0].id:'], [[{ id: 'a--b', source: 'a' }], 'skills[0].id:'],
    [[{ id: '../x', source: 'a' }], 'skills[0].id:'], [[{ id: 'a', source: '' }], 'skills[0].source:'], [[{ id: 'a', source: 'x' }, { id: 'a', source: 'y' }], 'skills[1].id:']]) {
    const r = read({ name: 'S', skills });
    assert.strictEqual(r.ok, false, JSON.stringify(skills));
    assert.ok(r.error.startsWith(at), r.error);
  }
}
// steps.talk: the Talk to Claude or Codex step's name (Sean, 2026-11-24)
assert.deepStrictEqual(read({ name: 'T', steps: { talk: 'Talk to Example Gateway' } }).company.steps, { email: '', gateway: '', tools: '', talk: 'Talk to Example Gateway' });
const g = read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k' } }).company.gateway;
assert.deepStrictEqual(g, { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', requiredModel: '', env: {}, keyFiles: [], terminal: false, openTabOnTalk: false, routerPrefixes: [], keyCommand: null });
// gateway.openTabOnTalk: Get started's Talk step opens a Claude tab on the gateway itself; off unless true
const ot = (openTabOnTalk) => read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', openTabOnTalk } });
assert.strictEqual(ot(true).company.gateway.openTabOnTalk, true);
assert.strictEqual(ot(false).company.gateway.openTabOnTalk, false);
// router prefixes: optional, non-empty strings
const rp = read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', routerPrefixes: ['example-router'] } });
assert.deepStrictEqual(rp.company.gateway.routerPrefixes, ['example-router']);
// a key command: argv, its first word absolute or ~/ (expanded)
const kc = (keyCommand) => read({ name: 'G', gateway: { name: 'g', baseUrls: ['http://a.example.com'], keyPage: 'https://a.example.com/k', keyCommand } });
assert.deepStrictEqual(kc(['~/.local/bin/get-key', '--gateway', 'g']).company.gateway.keyCommand, ['/h/.local/bin/get-key', '--gateway', 'g']);
assert.deepStrictEqual(kc(['/usr/local/bin/get-key']).company.gateway.keyCommand, ['/usr/local/bin/get-key']);
assert.strictEqual(kc(null).company.gateway.keyCommand, null);

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
invalid(mut((d) => { d.gateway.openTabOnTalk = 'yes'; }), 'gateway.openTabOnTalk');
invalid(mut((d) => { d.gateway.routerPrefixes = ['ok', 3]; }), 'gateway.routerPrefixes[1]');
invalid(mut((d) => { d.gateway.routerPrefixes = ['']; }), 'gateway.routerPrefixes[0]');
invalid(mut((d) => { d.mcpServers[1].id = 'docs'; }), 'mcpServers[1].id');
invalid(mut((d) => { d.mcpServers[0].connect.kind = 'oauth'; }), 'mcpServers[0].connect.kind');
invalid(mut((d) => { delete d.mcpServers[2].connect.doneWhen; }), 'mcpServers[2].connect.doneWhen');
invalid(mut((d) => { d.mcpServers[1].register = { type: 'http', url: 'https://mcp.example.com/mcp' }; }), 'mcpServers[1].register.type');
invalid(mut((d) => { d.mcpServers[1].register.env.X = 'a ${token}'; }), 'mcpServers[1].register');
invalid(mut((d) => { d.gateway.keyPage = 'nope'; }), 'gateway.keyPage');
invalid(mut((d) => { d.gateway.keyCommand = '/usr/local/bin/get-key'; }), 'gateway.keyCommand');
invalid(mut((d) => { d.steps = { talk: '' }; }), 'steps.talk');
invalid(mut((d) => { d.steps = { talk: 3 }; }), 'steps.talk');
invalid(mut((d) => { d.gateway.keyCommand = []; }), 'gateway.keyCommand');
invalid(mut((d) => { d.gateway.keyCommand = ['/x', 3]; }), 'gateway.keyCommand[1]');
invalid(mut((d) => { d.gateway.keyCommand = ['get-key']; }), 'gateway.keyCommand[0]');
invalid(mut((d) => { d.gateway.keyCommand = ['./get-key']; }), 'gateway.keyCommand[0]');
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
{ const r = read(EXAMPLE); assert.strictEqual(r.company.title, ''); assert.deepStrictEqual(r.company.steps, { email: '', gateway: '', tools: '', talk: '' }); }
{ const r = read({ ...clone(EXAMPLE), title: 'Example Works', steps: { gateway: 'Connect Example Gateway', tools: 'Connect Example tools', other: 1 } });
  assert.strictEqual(r.company.title, 'Example Works');
  assert.deepStrictEqual(r.company.steps, { email: '', gateway: 'Connect Example Gateway', tools: 'Connect Example tools', talk: '' }); }
invalid({ ...clone(EXAMPLE), title: '' }, 'title');
invalid({ ...clone(EXAMPLE), title: 3 }, 'title');
invalid({ ...clone(EXAMPLE), steps: [] }, 'steps');
invalid({ ...clone(EXAMPLE), steps: { gateway: '' } }, 'steps.gateway');
invalid({ ...clone(EXAMPLE), steps: { tools: 5 } }, 'steps.tools');

// the two copies are identical
const root = path.join(__dirname, '..');
assert.strictEqual(fs.readFileSync(path.join(root, 'src', 'company.js'), 'utf8'), fs.readFileSync(path.join(root, 'parts', 'agents', 'src', 'company.js'), 'utf8'), 'parts/agents/src/company.js is a copy of src/company.js');

console.log('company.test.js passed');
