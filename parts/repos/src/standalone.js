'use strict';
// From the standalone Gannet extension (seanahn.gannet) to Agentic Works' Repos part. VS Code gives each extension its
// own global storage folder, side by side, so the standalone's is a sibling of this part's store:
// - its machine.json (the directories, the checkouts it knows, new folders) is copied once, when this store has none;
// - repos it checked out name its credential shim in their .git/config, and VS Code deletes that shim with the rest
//   of its storage when it is uninstalled: those it knew of are pointed at this part's shim instead.
const fs = require('fs');
const path = require('path');
const { configurePush } = require('./checkout.js');

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

const HELPER = 'credential.https://github.com.helper';
const OLD_SHIM = `${path.sep}${STANDALONE_ID}${path.sep}gannet-credential"`;

/** Points the checkouts `local` knows whose helper is the standalone's shim at `shim`; how many it changed. */
async function repointCheckouts({ run, local, shim }) {
  let n = 0;
  for (const list of local.all().values()) {
    for (const c of list) {
      if (!c.byGannet || !c.login) continue;
      const r = await run('git', ['-C', c.path, 'config', '--local', '--get-all', HELPER]).catch(() => ({ code: -1 }));
      if (r.code !== 0 || !String(r.stdout).includes(OLD_SHIM)) continue;
      await configurePush(run, c.path, c.login, `!"${shim}" ${c.login}`);
      n++;
    }
  }
  return n;
}

module.exports = { carryMachineState, repointCheckouts, STANDALONE_ID };
