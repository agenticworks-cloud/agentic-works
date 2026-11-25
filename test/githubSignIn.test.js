'use strict';
// GitHub's sign-in without a terminal (src/githubSignIn.js): gh's device sign-in run with no terminal, its one-time
// code read from its output for the page, then `gh auth setup-git`. Driven here by a fake gh; nothing runs the real one.
const assert = require('node:assert');
const path = require('node:path');

const { GithubSignIn, parseDevice, LOGIN_ARGS, SETUP_GIT_ARGS, DEVICE_URL } = require(path.join(__dirname, '..', 'src', 'githubSignIn'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tick = () => new Promise((r) => setImmediate(r));

const { fakeSpawn, CODE_TEXT } = require('./fakeGh');

test('parseDevice reads the code and the page; none without a code; the page defaults to GitHub\'s', () => {
  assert.deepStrictEqual(parseDevice(CODE_TEXT), { userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' });
  assert.deepStrictEqual(parseDevice('! First copy your one-time code: AB12-CD34\n'), { userCode: 'AB12-CD34', verificationUri: DEVICE_URL });
  assert.strictEqual(parseDevice('Open this URL: https://github.com/login/device'), null);
  assert.strictEqual(parseDevice(''), null);
  // a page that isn't GitHub's device page is not taken
  assert.deepStrictEqual(parseDevice('one-time code: AB12-CD34\nhttps://evil.example.com/login/device\n').verificationUri, DEVICE_URL);
});

test('signs in: gh login without a terminal, the code shown, then git set up; ok', async () => {
  const { spawn, calls } = fakeSpawn();
  const states = [];
  const s = new GithubSignIn({ spawn, onUpdate: (st) => states.push(st.phase) });
  const done = s.run();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].cmd, 'gh');
  assert.deepStrictEqual(calls[0].args, LOGIN_ARGS);
  assert.deepStrictEqual(LOGIN_ARGS, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web']);
  assert.deepStrictEqual(calls[0].opts.stdio, ['ignore', 'pipe', 'pipe'], 'no terminal, no input: gh asks nothing');
  assert.strictEqual(calls[0].opts.env.GH_PROMPT_DISABLED, '1');
  assert.strictEqual(s.state.phase, 'starting');
  calls[0].child.err(CODE_TEXT.slice(0, 20));
  calls[0].child.err(CODE_TEXT.slice(20));   // the code split across two reads
  assert.strictEqual(s.state.phase, 'code');
  assert.deepStrictEqual(s.state.code, { userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' });
  calls[0].child.err('✓ Authentication complete.\n');
  calls[0].child.exit(0);
  await tick();
  assert.strictEqual(s.state.phase, 'finishing');
  assert.strictEqual(s.state.code, null, 'the code goes once GitHub has it');
  assert.deepStrictEqual(calls[1].args, SETUP_GIT_ARGS);
  assert.deepStrictEqual(SETUP_GIT_ARGS, ['auth', 'setup-git', '--hostname', 'github.com']);
  calls[1].child.exit(0);
  assert.deepStrictEqual(await done, { ok: true, gitSetUp: true });
  assert.strictEqual(s.state.phase, 'done');
  assert.deepStrictEqual(states, ['code', 'finishing', 'done']);
});

test('signed in but git not set up: still ok, and says so', async () => {
  const { spawn, calls } = fakeSpawn();
  const s = new GithubSignIn({ spawn });
  const done = s.run();
  calls[0].child.err(CODE_TEXT);
  calls[0].child.exit(0);
  await tick();
  calls[1].child.exit(1);
  assert.deepStrictEqual(await done, { ok: true, gitSetUp: false });
});

test('gh fails: the reason is gh\'s last line, never the code', async () => {
  const { spawn, calls } = fakeSpawn();
  const s = new GithubSignIn({ spawn });
  const done = s.run();
  calls[0].child.err(CODE_TEXT);
  calls[0].child.err('error: failed to authenticate via web browser: slow_down\n');
  calls[0].child.exit(1);
  const r = await done;
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error, 'GitHub\'s sign-in didn\'t finish: error: failed to authenticate via web browser: slow_down');
  assert.ok(!r.error.includes('AB12-CD34'));
  assert.strictEqual(s.state.phase, 'failed');
  assert.strictEqual(s.state.code, null);
  assert.strictEqual(calls.length, 1, 'git is not set up');
});

test('gh fails with nothing to say: a plain reason', async () => {
  const { spawn, calls } = fakeSpawn();
  const done = new GithubSignIn({ spawn }).run();
  calls[0].child.exit(1);
  assert.deepStrictEqual(await done, { ok: false, error: 'GitHub\'s sign-in didn\'t finish (gh exited with 1).' });
});

test('no gh: says how to get it', async () => {
  const { spawn, calls } = fakeSpawn();
  const done = new GithubSignIn({ spawn }).run();
  calls[0].child.fail('ENOENT');
  calls[0].child.exit(-2);
  const r = await done;
  assert.strictEqual(r.ok, false);
  assert.match(r.error, /gh isn't installed.*cli\.github\.com/);
});

test('a spawn that throws is a failure, not an exception', async () => {
  const r = await new GithubSignIn({ spawn: () => { throw new Error('nope'); } }).run();
  assert.deepStrictEqual([r.ok, r.error], [false, 'GitHub\'s sign-in couldn\'t start: nope']);
});

test('cancel stops gh: cancelled, no error, git not set up', async () => {
  const { spawn, calls } = fakeSpawn();
  const s = new GithubSignIn({ spawn });
  const done = s.run();
  calls[0].child.err(CODE_TEXT);
  s.cancel();
  assert.strictEqual(calls[0].child.killed, true);
  assert.deepStrictEqual(await done, { ok: false, cancelled: true });
  assert.strictEqual(s.state.phase, 'cancelled');
  assert.strictEqual(calls.length, 1);
  s.cancel();   // again, or after the end: nothing
});

test('the code expires: gh is stopped and the step says to try again', async () => {
  const { spawn, calls } = fakeSpawn();
  const s = new GithubSignIn({ spawn, limitMs: 20 });
  const done = s.run();
  calls[0].child.err(CODE_TEXT);
  const r = await done;
  assert.strictEqual(calls[0].child.killed, true);
  assert.deepStrictEqual(r, { ok: false, error: 'The code expired before GitHub had it. Try again.' });
});

test('run twice: the same sign-in', async () => {
  const { spawn, calls } = fakeSpawn();
  const s = new GithubSignIn({ spawn });
  const a = s.run();
  assert.strictEqual(s.run(), a);
  assert.strictEqual(calls.length, 1);
  s.cancel();
  await a;
});

(async () => {
  for (const t of tests) {
    try { await t.fn(); console.log(`ok - ${t.name}`); } catch (err) { console.error(`not ok - ${t.name}`); throw err; }
  }
  console.log(`githubSignIn.test.js passed (${tests.length})`);
})().catch((err) => { console.error(err); process.exit(1); });
