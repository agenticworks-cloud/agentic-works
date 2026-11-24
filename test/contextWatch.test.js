'use strict';
// Roost's watch on the parts' context keys: VS Code cannot read a context key back, so Roost wraps
// commands.executeCommand and notes the setContext calls for the keys its Get started page ticks on.
const assert = require('node:assert');
const { watchContexts } = require('../src/contextWatch');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('a watched setContext is noted and told, and every call is passed on; dispose puts the original back', async () => {
  const calls = [];
  const original = async (id, ...a) => { calls.push([id, ...a]); return 'r'; };
  const commands = { executeCommand: original };
  const w = watchContexts(commands, ['jay.signedIn'], { log: () => {} });
  const seen = [];
  const sub = w.onChange((k, v) => seen.push([k, v]));
  assert.strictEqual(await commands.executeCommand('setContext', 'jay.signedIn', true), 'r');
  await commands.executeCommand('setContext', 'other.key', 1);
  await commands.executeCommand('jay.refresh');
  assert.deepStrictEqual([w.get('jay.signedIn'), w.get('other.key'), seen], [true, undefined, [['jay.signedIn', true]]]);
  assert.strictEqual(calls.length, 3, 'every call passed on');
  sub.dispose(); await commands.executeCommand('setContext', 'jay.signedIn', false);
  assert.deepStrictEqual([w.get('jay.signedIn'), seen.length], [false, 1]);
  w.dispose(); assert.strictEqual(commands.executeCommand, original, 'the original is back');
  const frozen = Object.freeze({ executeCommand: async () => {} }); const logs = [];
  assert.strictEqual(watchContexts(frozen, ['x'], { log: (l) => logs.push(l) }).get('x'), undefined);
  assert.ok(logs[0].startsWith("Roost cannot watch the parts' context keys"));
});

test('a rejection is passed on unchanged, and the original is called with its own this and arguments', async () => {
  const err = new Error('setContext failed');
  const commands = {
    executeCommand(id, ...a) { this.got = [this, id, ...a]; return Promise.reject(err); },
  };
  const w = watchContexts(commands, ['chirp.signedIn'], { log: () => {} });
  await assert.rejects(commands.executeCommand('setContext', 'chirp.signedIn', true), (e) => e === err);
  assert.deepStrictEqual(commands.got, [commands, 'setContext', 'chirp.signedIn', true]);
  assert.strictEqual(w.get('chirp.signedIn'), true, 'noted as sent');
  w.dispose();
});

test('a listener that throws is logged and the call still goes through; dispose leaves a later wrapper in place', async () => {
  const logs = [];
  const commands = { executeCommand: async () => 'ok' };
  const w = watchContexts(commands, ['perch.messageSent'], { log: (l) => logs.push(l) });
  w.onChange(() => { throw new Error('bad listener'); });
  const after = [];
  w.onChange((k, v) => after.push([k, v]));
  assert.strictEqual(await commands.executeCommand('setContext', 'perch.messageSent', true), 'ok');
  assert.deepStrictEqual(after, [['perch.messageSent', true]], 'the other listeners are still told');
  assert.ok(logs.some((l) => l.includes('bad listener')), JSON.stringify(logs));
  const later = async () => 'later';
  commands.executeCommand = later;
  w.dispose();
  assert.strictEqual(commands.executeCommand, later, 'not the wrapper any more: left as it is');
});

test('a watcher that cannot wrap still answers onChange and dispose', () => {
  const frozen = Object.freeze({ executeCommand: async () => {} });
  const w = watchContexts(frozen, ['x'], { log: () => {} });
  const sub = w.onChange(() => {});
  sub.dispose();
  w.dispose();
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`ok - ${name}`);
    } catch (e) {
      failed++;
      console.log(`not ok - ${name}\n${e.stack}`);
    }
  }
  console.log(failed ? `${failed} of ${tests.length} failed` : `contextWatch.test.js passed (${tests.length})`);
  process.exitCode = failed ? 1 : 0;
})();
