'use strict';
// The company's key helper (src/keyCommand.js), run for real against a fake one (test/fixtures/fakeKeyCommand.js).
const assert = require('assert');
const path = require('path');
const { runKeyCommand, maskReason, TEXT, TIMEOUT_MS } = require('../src/keyCommand');

const FAKE = path.join(__dirname, 'fixtures', 'fakeKeyCommand.js');
const fake = (...a) => [process.execPath, FAKE, ...a];
const KEY = 'sk-example-0123456789abcdefghijklmnop';

(async () => {
  assert.strictEqual(TIMEOUT_MS, 12 * 60e3, 'twelve minutes: a sign-in window may be open');
  // exit 0: the key, trimmed (its newline gone)
  assert.deepStrictEqual(await runKeyCommand(fake('ok', KEY)), { ok: true, key: KEY });
  // each failure, in the page's words
  assert.deepStrictEqual(await runKeyCommand(fake('fail')), { ok: false, text: "Couldn't get a key automatically: You have reached the key limit." }, 'the last non-empty stderr line');
  assert.deepStrictEqual(await runKeyCommand(fake('signin')), { ok: false, text: TEXT.signIn });
  assert.strictEqual(TEXT.signIn, "The sign-in wasn't completed.");
  assert.deepStrictEqual(await runKeyCommand(['/nonexistent/roost-test/get-key']), { ok: false, text: "The key helper isn't installed." }, 'ENOENT');
  const t0 = Date.now();
  assert.deepStrictEqual(await runKeyCommand(fake('sleep'), { timeoutMs: 200 }), { ok: false, text: 'That took too long.' });
  assert(Date.now() - t0 < 5000, 'stopped at the timeout');
  assert.deepStrictEqual(await runKeyCommand(fake('empty')), { ok: false, text: "Couldn't get a key automatically: the key helper printed no key." });
  const big = await runKeyCommand(fake('big'));
  assert.deepStrictEqual(big, { ok: false, text: "Couldn't get a key automatically: the key helper printed more than a key." }, 'stdout capped');
  assert.deepStrictEqual(await runKeyCommand(fake('stdin')), { ok: true, key: 'closed' }, 'stdin is closed');
  assert.deepStrictEqual(await runKeyCommand(fake('env', 'EXAMPLE_EMAIL'), { env: { ...process.env, EXAMPLE_EMAIL: 'me@example.com' } }), { ok: true, key: 'me@example.com' }, 'the env given');
  // a helper that leaves a child behind (a browser, a refresher) holding its pipes: answered at its exit, the child stopped
  if (process.platform !== 'win32') {
    const fs = require('fs'), os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-keycmd-'));
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (_) { return false; } };
    const gone = async (pid) => { for (let i = 0; i < 100 && alive(pid); i++) await new Promise((r) => setTimeout(r, 50)); return !alive(pid); };
    try {
      const pidOk = path.join(tmp, 'ok.pid');
      let t = Date.now();
      assert.deepStrictEqual(await runKeyCommand(fake('bgok', KEY, pidOk)), { ok: true, key: KEY }, 'exit 0 with a key, a child left behind');
      assert(Date.now() - t < 3000, `answered promptly (${Date.now() - t} ms)`);
      const p1 = Number(fs.readFileSync(pidOk, 'utf8'));
      assert(await gone(p1), 'the child left behind is stopped');
      const pidSleep = path.join(tmp, 'sleep.pid');
      t = Date.now();
      assert.deepStrictEqual(await runKeyCommand(fake('bgsleep', pidSleep), { timeoutMs: 300 }), { ok: false, text: 'That took too long.' });
      assert(Date.now() - t < 4000, `the timeout answers promptly (${Date.now() - t} ms)`);
      const p2 = Number(fs.readFileSync(pidSleep, 'utf8'));
      assert(await gone(p2), 'the whole group is stopped at the timeout');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  // a key-shaped string in stderr never reaches the reason
  const leaked = await runKeyCommand(fake('fail', `refused ${KEY} and token=abcdefghijklmnopqrstuvwxyz0123 for task-runner`));
  assert.strictEqual(leaked.ok, false);
  assert(!leaked.text.includes('sk-example') && !leaked.text.includes('abcdefghijklmnopqrstuvwxyz'), leaked.text);
  assert.strictEqual(leaked.text, "Couldn't get a key automatically: refused … and … for task-runner");
  // the reason: one line, at most 200 characters
  const long = maskReason('word '.repeat(100));
  assert(long.length <= 200 && !long.includes('\n'), long);
  assert.strictEqual(maskReason('a\tb\r\nc'), 'a b c');
  assert.strictEqual(maskReason('see "sk-ant-abc"'), 'see "…"');
  console.log('keyCommand tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
