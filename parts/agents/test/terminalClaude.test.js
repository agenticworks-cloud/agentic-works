'use strict';
// Terminal `claude`'s settings (~/.claude/settings.json): what each way wants there, the plan against what is there and
// what Roost wrote before, the write, and the gateway address kept current. Throwaway home directories only.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const T = require('../src/terminalClaude');

const home = () => fs.mkdtempSync(path.join(os.tmpdir(), 'roost-terminal-'));
const settingsIn = (h) => path.join(h, '.claude', 'settings.json');
const put = (file, v) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof v === 'string' ? v : JSON.stringify(v, null, 2)); };
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const BASE = 'env.ANTHROPIC_BASE_URL';
const A = 'https://a.example.com/llm-api', B = 'https://b.example.com/llm-api';

// ---- desiredSettings
assert.deepStrictEqual(T.desiredSettings('gateway', { env: { ANTHROPIC_MODEL: 'router-auto' }, keyFile: '/h/k', baseUrl: A }),
  { 'env.ANTHROPIC_MODEL': 'router-auto', apiKeyHelper: "cat '/h/k'", [BASE]: A, 'env.CLAUDE_CODE_USE_BEDROCK': '0' }, 'gateway: the env, the key helper, the address, off Bedrock');
assert.deepStrictEqual(T.desiredSettings('gateway', { keyFile: "/h/it's" }).apiKeyHelper, "cat '/h/it'\\''s'", 'a quote in the key file path is quoted for sh');
assert.deepStrictEqual(T.desiredSettings('apiKey', { keyFile: '/h/a' }), { apiKeyHelper: "cat '/h/a'", 'env.CLAUDE_CODE_USE_BEDROCK': '0' });
assert.deepStrictEqual(T.desiredSettings('bedrock', { region: 'us-west-2', profile: '' }), { 'env.CLAUDE_CODE_USE_BEDROCK': '1', 'env.AWS_REGION': 'us-west-2' });
assert.deepStrictEqual(T.desiredSettings('bedrock', { region: 'us-west-2', profile: 'dev' }), { 'env.CLAUDE_CODE_USE_BEDROCK': '1', 'env.AWS_REGION': 'us-west-2', 'env.AWS_PROFILE': 'dev' });
assert.deepStrictEqual(T.desiredSettings('subscription'), {});
assert.throws(() => T.desiredSettings('nope', {}), /nope/);

// ---- readSettings
{
  const h = home(), f = settingsIn(h);
  assert.deepStrictEqual(T.readSettings(f), { ok: true, json: {} }, 'a missing file is an empty object');
  put(f, { a: 1 }); assert.deepStrictEqual(T.readSettings(f), { ok: true, json: { a: 1 } });
  for (const bad of ['// x\n{}', '[1]', '"s"', 'null', '{ "a": ']) {
    put(f, bad); const r = T.readSettings(f);
    assert.deepStrictEqual([r.ok, r.missing, typeof r.error], [false, false, 'string'], bad);
  }
}

// ---- planSettings
{
  const want = T.desiredSettings('gateway', { env: {}, keyFile: '/h/k', baseUrl: A });
  let p = T.planSettings({ apiKeyHelper: 'my-helper' }, { apiKeyHelper: "cat '/h/k'" }, {});
  assert.deepStrictEqual([p.changes, p.conflicts], [[], [{ key: 'apiKeyHelper', from: 'my-helper', to: "cat '/h/k'" }]], 'the user\'s own value is a conflict');
  p = T.planSettings({ apiKeyHelper: "cat '/h/k'" }, {}, { apiKeyHelper: "cat '/h/k'" });
  assert.deepStrictEqual([p.changes, p.conflicts], [[{ key: 'apiKeyHelper', from: "cat '/h/k'", to: null }], []], 'Roost\'s own value, no longer wanted: removed');
  p = T.planSettings({ apiKeyHelper: 'mine' }, {}, { apiKeyHelper: "cat '/h/k'" });
  assert.deepStrictEqual([p.changes, p.conflicts], [[], []], 'changed by the user since: left alone');
  p = T.planSettings({ env: { [BASE.slice(4)]: A, CLAUDE_CODE_USE_BEDROCK: '1' } }, want, { [BASE]: A, 'env.CLAUDE_CODE_USE_BEDROCK': '1' });
  assert.deepStrictEqual([p.changes, p.conflicts], [[{ key: 'apiKeyHelper', from: undefined, to: "cat '/h/k'" }, { key: 'env.CLAUDE_CODE_USE_BEDROCK', from: '1', to: '0' }], []],
    'absent is a change, Roost\'s earlier value is a change, the same value is none');
  assert.deepStrictEqual(p.kept, { [BASE]: A }, 'what Roost wrote and still wants, unchanged, stays in its record');
}

// ---- writeSettings
{
  const h = home(), f = settingsIn(h);
  put(f, { permissions: { allow: ['Bash(ls)'] }, env: { OTHER: 'x', AWS_REGION: 'eu-west-1' }, apiKeyHelper: 'my-helper' });
  const want = T.desiredSettings('gateway', { env: { ANTHROPIC_MODEL: 'router-auto' }, keyFile: '/h/k', baseUrl: A });
  const plan = T.planSettings(T.readSettings(f).json, want, {});
  assert.deepStrictEqual(plan.conflicts.map((c) => c.key), ['apiKeyHelper']);
  let r = T.writeSettings(f, plan, { replace: [] });
  let j = read(f);
  assert.deepStrictEqual([j.permissions, j.env.OTHER, j.env.AWS_REGION, j.apiKeyHelper, j.env.ANTHROPIC_MODEL, j.env.ANTHROPIC_BASE_URL], [{ allow: ['Bash(ls)'] }, 'x', 'eu-west-1', 'my-helper', 'router-auto', A], 'other keys kept; a conflict kept unless named');
  assert.deepStrictEqual(r.written, { 'env.ANTHROPIC_MODEL': 'router-auto', [BASE]: A, 'env.CLAUDE_CODE_USE_BEDROCK': '0' }, 'the record: what was written, not the user\'s value left');
  r = T.writeSettings(f, T.planSettings(read(f), want, r.written), { replace: ['apiKeyHelper'] });
  assert.deepStrictEqual([read(f).apiKeyHelper, r.written.apiKeyHelper, r.written[BASE]], ["cat '/h/k'", "cat '/h/k'", A], 'named in replace: replaced; the unchanged keys stay recorded');
  // a later choice: Roost's own values go, the user's stay
  r = T.writeSettings(f, T.planSettings(read(f), T.desiredSettings('subscription'), r.written), { replace: [] });
  j = read(f);
  assert.deepStrictEqual([j.apiKeyHelper, j.env, j.permissions, r.written], [undefined, { OTHER: 'x', AWS_REGION: 'eu-west-1' }, { allow: ['Bash(ls)'] }, {}]);
  // re-read first: a key written between the plan and the write is kept
  const p2 = T.planSettings(read(f), T.desiredSettings('apiKey', { keyFile: '/h/a' }), {});
  put(f, Object.assign(read(f), { model: 'opus' }));
  T.writeSettings(f, p2, { replace: [] });
  assert.deepStrictEqual([read(f).model, read(f).apiKeyHelper], ['opus', "cat '/h/a'"]);
  assert(!fs.readdirSync(path.dirname(f)).some((n) => n !== 'settings.json'), 'no temp file left');
  // a fresh home: the file and its folder are made
  const h2 = home(), f2 = settingsIn(h2);
  T.writeSettings(f2, T.planSettings({}, T.desiredSettings('bedrock', { region: 'us-east-1' }), {}), { replace: [] });
  assert.deepStrictEqual(read(f2), { env: { CLAUDE_CODE_USE_BEDROCK: '1', AWS_REGION: 'us-east-1' } });
}

// ---- an unparsable settings file is never rewritten
{
  const h = home(), f = settingsIn(h);
  for (const bad of ['// x\n{}', '[]']) {
    put(f, bad);
    assert.strictEqual(T.readSettings(f).ok, false);
    assert.throws(() => T.writeSettings(f, T.planSettings({}, T.desiredSettings('apiKey', { keyFile: '/h/a' }), {}), { replace: [] }), /settings/);
    assert.strictEqual(fs.readFileSync(f, 'utf8'), bad, 'bytes unchanged');
  }
}

// ---- maskValue
assert.strictEqual(T.maskValue('env.ANTHROPIC_AUTH_TOKEN', 'sk-abcdef'), 'sk-a…');
assert.strictEqual(T.maskValue('env.MY_SECRET', 'hunter22'), 'hunt…');
assert.strictEqual(T.maskValue('env.ANTHROPIC_API_KEY', 'sk-ant-xyz'), 'sk-a…');
assert.strictEqual(T.maskValue('apiKeyHelper', "cat '/h/k'"), "cat '/h/k'");
assert.strictEqual(T.maskValue('env.AWS_REGION', 'us-west-2'), 'us-west-2');

// ---- syncTerminalBaseUrl
{
  const h = home(), f = settingsIn(h);
  put(f, { env: { ANTHROPIC_BASE_URL: A, OTHER: 'x' }, permissions: { allow: [] } });
  let r = T.syncTerminalBaseUrl(f, B, { [BASE]: A, apiKeyHelper: "cat '/h/k'" });
  assert.deepStrictEqual([r.changed, r.written, read(f)], [true, { [BASE]: B, apiKeyHelper: "cat '/h/k'" }, { env: { ANTHROPIC_BASE_URL: B, OTHER: 'x' }, permissions: { allow: [] } }], 'Roost\'s address: changed, the record with it');
  assert(!fs.readdirSync(path.dirname(f)).some((n) => n !== 'settings.json'), 'no temp file left');
  r = T.syncTerminalBaseUrl(f, B, r.written);
  assert.deepStrictEqual([r.changed, r.written[BASE]], [false, B], 'already there: nothing to do');
  // the user's own value since: left alone
  put(f, { env: { ANTHROPIC_BASE_URL: 'https://mine.example.com' } });
  r = T.syncTerminalBaseUrl(f, A, { [BASE]: B });
  assert.deepStrictEqual([r.changed, read(f).env.ANTHROPIC_BASE_URL], [false, 'https://mine.example.com'], 'a user-changed value is left');
  // never added when Roost hadn't written it
  put(f, { env: { OTHER: 'x' } });
  for (const w of [{}, { apiKeyHelper: "cat '/h/k'" }, undefined]) {
    r = T.syncTerminalBaseUrl(f, A, w);
    assert.deepStrictEqual([r.changed, read(f)], [false, { env: { OTHER: 'x' } }], 'never added');
  }
  put(f, { env: { ANTHROPIC_BASE_URL: 'https://mine.example.com' } });
  r = T.syncTerminalBaseUrl(f, A, {});
  assert.deepStrictEqual([r.changed, read(f).env.ANTHROPIC_BASE_URL], [false, 'https://mine.example.com'], 'the user\'s, with no record: left');
  // an unparsable file is left alone
  for (const bad of ['// x\n{ "env": { "ANTHROPIC_BASE_URL": "' + A + '" } }', '[]']) {
    put(f, bad);
    r = T.syncTerminalBaseUrl(f, B, { [BASE]: A });
    assert.deepStrictEqual([r.changed, r.written, fs.readFileSync(f, 'utf8')], [false, { [BASE]: A }, bad], 'unparsable: bytes unchanged');
  }
  // a missing file: nothing written
  const f3 = settingsIn(home());
  r = T.syncTerminalBaseUrl(f3, B, { [BASE]: A });
  assert.deepStrictEqual([r.changed, fs.existsSync(f3)], [false, false]);
}

console.log('terminalClaude.test.js: ok');
