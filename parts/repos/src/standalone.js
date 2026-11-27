'use strict';
// From the standalone Gannet extension (seanahn.gannet) to Agentic Works' Repos part. VS Code gives each extension its
// own global storage folder, side by side, so the standalone's is a sibling of this part's store:
// - its machine.json (the directories, the checkouts it knows, new folders) is copied once, when this store has none;
// - its credential shim is rewritten, on every start, to run this part's helper on this store's sockets: repos it
//   checked out name that shim in their .git/config, and would stop pushing once the standalone is uninstalled.
const fs = require('fs');
const path = require('path');
const { writeShim, socketDir } = require('./tokenServer.js');

const STANDALONE_ID = 'seanahn.gannet';
const oldStore = (store) => path.join(path.dirname(store), STANDALONE_ID);

/** Copies the standalone's machine.json into `store` if `store` has none; true when it did. */
function carryMachineState(store) {
  const from = path.join(oldStore(store), 'machine.json'), to = path.join(store, 'machine.json');
  if (path.resolve(oldStore(store)) === path.resolve(store) || fs.existsSync(to) || !fs.existsSync(from)) return false;
  fs.mkdirSync(store, { recursive: true });
  fs.copyFileSync(from, to);
  return true;
}

/** Rewrites the standalone's shim, if there is one, to run `script` on `store`'s sockets; its path, or ''. */
function repointOldShim({ store, execPath, script }) {
  const dir = oldStore(store);
  if (path.resolve(dir) === path.resolve(store) || !fs.existsSync(path.join(dir, 'gannet-credential'))) return '';
  return writeShim({ dir, execPath, script, socketDir: socketDir(store) });
}

module.exports = { carryMachineState, repointOldShim, STANDALONE_ID };
