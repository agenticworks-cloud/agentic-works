'use strict';
// Moving from the standalone Gannet extension (seanahn.gannet) to this part: its per-machine state is copied once, and
// its credential shim, which repos it checked out still name in their .git/config, is pointed at this part's helper.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { carryMachineState, repointOldShim, STANDALONE_ID } = require('../src/standalone.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'repos-standalone-'));
try {
  const globalStorage = path.join(tmp, 'globalStorage');
  const old = path.join(globalStorage, STANDALONE_ID);
  const store = path.join(globalStorage, 'agenticworks.agentic-works');
  assert.strictEqual(STANDALONE_ID, 'seanahn.gannet');

  // nothing to carry: nothing happens
  assert.strictEqual(carryMachineState(store), false);
  assert.strictEqual(repointOldShim({ store, execPath: '/node', script: '/new/bin/gannet-credential.js' }), '');
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

  // no old shim: none is made
  assert.strictEqual(repointOldShim({ store, execPath: '/node', script: '/new/bin/gannet-credential.js' }), '');
  assert.ok(!fs.existsSync(path.join(old, 'gannet-credential')));
  // an old shim (named by repos the standalone checked out): rewritten to run this part's helper on this store's sockets
  fs.writeFileSync(path.join(old, 'gannet-credential'), '#!/bin/sh\nexec "/old/seanahn.gannet-0.5.7/bin/gannet-credential.js"\n');
  const shim = repointOldShim({ store, execPath: '/node', script: '/new/bin/gannet-credential.js' });
  assert.strictEqual(shim, path.join(old, 'gannet-credential'));
  const text = fs.readFileSync(shim, 'utf8');
  assert.ok(text.includes('"/new/bin/gannet-credential.js"') && text.includes('"/node"') && !text.includes('/old/'), text);
  assert.ok(text.includes(path.join(store, 'sockets')) || text.includes('GANNET_SOCKET_DIR="'), text);
  const { socketDir } = require('../src/tokenServer.js');
  assert.ok(text.includes(`GANNET_SOCKET_DIR="${socketDir(store)}"`), 'this store\'s sockets');

  // running as the standalone itself: nothing to do
  assert.strictEqual(carryMachineState(old), false);
  assert.strictEqual(repointOldShim({ store: old, execPath: '/node', script: '/x.js' }), '');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log('STANDALONE OK');
