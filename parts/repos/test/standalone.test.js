'use strict';
// Moving from the standalone Gannet extension (seanahn.gannet) to this part: its per-machine state is copied once, and
// the repos it checked out, whose .git/config names its credential shim, are pointed at this part's shim.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { carryMachineState, repointCheckouts, STANDALONE_ID } = require('../src/standalone.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-standalone-'));
(async () => {
try {
  const globalStorage = path.join(tmp, 'globalStorage');
  const old = path.join(globalStorage, STANDALONE_ID);
  const store = path.join(globalStorage, 'agenticworks.agentic-works');
  assert.strictEqual(STANDALONE_ID, 'seanahn.gannet');

  // nothing to carry: nothing happens
  assert.strictEqual(carryMachineState(store), false);
  assert.ok(!fs.existsSync(store), 'nothing written');

  // the standalone's machine.json is copied when this store has none
  fs.mkdirSync(old, { recursive: true });
  fs.writeFileSync(path.join(old, 'machine.json'), '{"gannet.workspaces":["/git"]}');
  assert.strictEqual(carryMachineState(store), true);
  assert.strictEqual(fs.readFileSync(path.join(store, 'machine.json'), 'utf8'), '{"gannet.workspaces":["/git"]}');
  // once only: this store's own is never replaced
  fs.writeFileSync(path.join(store, 'machine.json'), '{"gannet.workspaces":["/mine"]}');
  assert.strictEqual(carryMachineState(store), false);
  assert.strictEqual(fs.readFileSync(path.join(store, 'machine.json'), 'utf8'), '{"gannet.workspaces":["/mine"]}');

  // repos the standalone checked out name its shim, which VS Code deletes with its storage: they are pointed at ours
  {
    const { runProcess } = require('../src/accounts.js');
    const { createLocalRepos } = require('../src/localRepos.js');
    const memo = () => { const m = {}; return { get: (k, d) => (k in m ? m[k] : d), update: async (k, v) => { m[k] = v; } }; };
    const git = (dir, ...a) => require('node:child_process').execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8' });
    const repo = (name, helper) => {
      const d = path.join(tmp, name);
      fs.mkdirSync(d); git(d, 'init', '-q');
      if (helper) { git(d, 'config', '--local', 'credential.https://github.com.helper', ''); git(d, 'config', '--local', '--add', 'credential.https://github.com.helper', helper); }
      return d;
    };
    const ours = repo('ours', `!"${path.join(old, 'gannet-credential')}" co-sahn`);
    const gh = repo('gh', '!f() { echo gh; }; f');
    const plain = repo('plain');
    const memento = memo();
    const local = createLocalRepos({ memento });
    await local.remember('co-e/ours', { path: ours, login: 'co-sahn', byGannet: true });
    await local.remember('co-e/gh', { path: gh, login: 'co-sahn', byGannet: true });
    await local.remember('co-e/plain', { path: plain, login: null, byGannet: false });
    const shim = path.join(store, 'gannet-credential');
    assert.strictEqual(await repointCheckouts({ run: runProcess, local, shim }), 1, 'only the one naming the old shim');
    assert.deepStrictEqual(git(ours, 'config', '--local', '--get-all', 'credential.https://github.com.helper').split('\n').filter(Boolean), [`!"${shim}" co-sahn`]);
    assert.strictEqual(git(ours, 'config', '--local', 'credential.https://github.com.username').trim(), 'co-sahn');
    assert.ok(git(gh, 'config', '--local', '--get-all', 'credential.https://github.com.helper').includes('echo gh'), 'a gh helper is left');
    assert.strictEqual(await repointCheckouts({ run: runProcess, local, shim }), 0, 'nothing left to do');
  }

  // running as the standalone itself: nothing to do
  assert.strictEqual(carryMachineState(old), false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('STANDALONE OK');
})().catch((e) => { console.error(e); process.exit(1); });
