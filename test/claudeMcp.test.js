'use strict';
// Registering an MCP server with Claude Code at user scope: ~/.claude.json's top-level mcpServers[id], re-read just
// before each write (Claude Code rewrites the file while it runs), written atomically, never over a file that isn't a
// JSON object.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CLAUDE_JSON, registration, register } = require('../src/claudeMcp');
const { readCompany } = require('../src/company');
const EXAMPLE = require('./fixtures/exampleCompany');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-claudemcp-'));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
fs.writeFileSync(path.join(dir, 'company.json'), JSON.stringify(EXAMPLE));
const company = readCompany(path.join(dir, 'company.json'), { home: '/h' }).company;
const [docs, mail] = company.mcpServers;
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

assert.strictEqual(CLAUDE_JSON, '~/.claude.json');

// registration: what Claude Code is given, ${token} replaced
const d = registration(docs, { token: 't' });
assert.deepStrictEqual(d, { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer t' } });
assert.deepStrictEqual(registration(mail), { type: 'stdio', command: '/h/.local/bin/example-mcp', args: [], env: { EXAMPLE_ID: '00000000-0000-0000-0000-000000000000' } });
assert.deepStrictEqual(registration(docs).headers, { Authorization: 'Bearer ' });
// a token never on a command line, nor in a URL
const withToken = (register) => ({ ...docs, register });
assert.throws(() => registration(withToken({ type: 'stdio', command: '/x', args: ['--token', '${token}'], env: {} }), { token: 't' }), /may appear only in headers or env/);
assert.throws(() => registration(withToken({ type: 'stdio', command: '/x/${token}', args: [], env: {} })), /may appear only in headers or env/);
assert.throws(() => registration(withToken({ type: 'http', url: 'https://mcp.example.com/mcp?key=${token}', headers: {} })), /may appear only in headers or env/);
assert.deepStrictEqual(registration(withToken({ type: 'stdio', command: '/x', args: [], env: { TOKEN: '${token}' } }), { token: 't' }).env, { TOKEN: 't' });

// added, same, conflict, replaced
const f = path.join(dir, 'sub', '.claude.json');
assert.strictEqual(register(f, 'docs', d), 'added');
assert.deepStrictEqual(read(f), { mcpServers: { docs: d } });
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
assert.strictEqual(register(f, 'docs', d), 'same');
const other = registration(docs, { token: 'u' });
const before = fs.readFileSync(f);
assert.strictEqual(register(f, 'docs', other), 'conflict');
assert.deepStrictEqual(fs.readFileSync(f), before, 'a conflict leaves the file unchanged');
assert.strictEqual(register(f, 'docs', other, { replace: true }), 'replaced');
assert.deepStrictEqual(read(f).mcpServers.docs, other);
assert.deepStrictEqual(fs.readdirSync(path.dirname(f)), ['.claude.json'], 'no temp file left behind');
// the entry Roost registered before (an older token) is replaced without asking
const newer = registration(docs, { token: 'v' });
assert.strictEqual(register(f, 'docs', newer, { previous: d }), 'conflict', 'previous must match what is there');
assert.strictEqual(register(f, 'docs', newer, { previous: other }), 'replaced');
assert.deepStrictEqual(read(f).mcpServers.docs, newer);

// keeps keys written after the first read: Claude Code rewrote the file between two registrations
const g = path.join(dir, 'keep.json');
fs.writeFileSync(g, JSON.stringify({ userID: 'abc', mcpServers: { mine: { type: 'stdio', command: '/x', args: [], env: {} } } }), { mode: 0o644 });
assert.strictEqual(register(g, 'docs', d), 'added');
const now = read(g);
fs.writeFileSync(g, JSON.stringify({ ...now, projects: { '/w': { allowedTools: [] } }, numStartups: 5 }));
assert.strictEqual(register(g, 'mail', registration(mail)), 'added');
const after = read(g);
assert.deepStrictEqual(after.projects, { '/w': { allowedTools: [] } });
assert.strictEqual(after.numStartups, 5);
assert.strictEqual(after.userID, 'abc');
assert.deepStrictEqual(Object.keys(after.mcpServers), ['mine', 'docs', 'mail']);
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(g).mode & 0o777, 0o600, 'a 0644 file ends up 0600: it can hold a token');

// a file that is not a JSON object is left alone
for (const [name, bytes] of [['brace.json', '{'], ['array.json', '[]'], ['comment.json', '// x\n{}']]) {
  const h = path.join(dir, name);
  fs.writeFileSync(h, bytes);
  assert.throws(() => register(h, 'docs', d), (e) => e.message === `${h} is not a JSON object; it was left alone`);
  assert.strictEqual(fs.readFileSync(h, 'utf8'), bytes);
}
// mcpServers that isn't an object: also left alone
const m = path.join(dir, 'mcp.json');
fs.writeFileSync(m, '{"mcpServers":[]}');
assert.throws(() => register(m, 'docs', d), /mcpServers/);
assert.strictEqual(fs.readFileSync(m, 'utf8'), '{"mcpServers":[]}');

console.log('claudeMcp.test.js passed');
