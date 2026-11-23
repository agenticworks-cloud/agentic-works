'use strict';
// The one-time carry-over of this part's settings from their old prefix to the new one (src/settingsCarryOver.js, the
// same file in every part). FROM and TO are this part's; everything below them is the same in every part's copy.
const FROM = 'jay', TO = 'jira';

const assert = require('node:assert');
const path = require('node:path');
const { carryOverSettings, settingKeys } = require('../src/settingsCarryOver');
const pkg = require('../package.json');

const T = { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
// A vscode with settings at three scopes: user, workspace and each folder's (folders: { fsPath: { key: value } }).
function fake({ user = {}, workspace = {}, folders = {}, failOn = null } = {}) {
  const writes = [];
  const config = (uri) => ({
    inspect: (key) => ({ key, globalValue: user[key], workspaceValue: workspace[key], workspaceFolderValue: uri ? (folders[uri.fsPath] || {})[key] : undefined }),
    update: async (key, value, target) => {
      if (key === failOn) throw new Error(`cannot write ${key}`);
      writes.push([key, value, target, ...(target === T.WorkspaceFolder ? [uri.fsPath] : [])]);
      const at = target === T.Global ? user : target === T.Workspace ? workspace : (folders[uri.fsPath] = folders[uri.fsPath] || {});
      at[key] = value;
    },
  });
  const vscode = {
    ConfigurationTarget: T,
    workspace: {
      workspaceFolders: Object.keys(folders).map((f) => ({ uri: { fsPath: f }, name: path.basename(f) })),
      getConfiguration: (section, uri) => { assert.strictEqual(section, undefined, 'full keys, from the root'); return config(uri); },
    },
  };
  return { vscode, user, workspace, folders, writes };
}
function memento() {
  const m = new Map();
  return { get: (k) => m.get(k), update: async (k, v) => { m.set(k, v); }, map: m };
}

const keys = settingKeys(pkg, TO);
const [a, b] = keys;
const logs = [];
const log = (l) => logs.push(l);

(async () => {
  // this part's own settings, without the prefix: every one of them, and nothing else
  const props = [].concat(pkg.contributes.configuration).flatMap((c) => Object.keys(c.properties || {}));
  assert.ok(keys.length >= 2 && props.length === keys.length, 'one key per setting');
  assert.deepStrictEqual(keys.map((k) => `${TO}.${k}`), props);

  // a user value under the old key moves to the new key, at the user scope; the old key stays
  {
    const f = fake({ user: { [`${FROM}.${a}`]: 'old-a' } });
    const state = memento();
    await carryOverSettings(f.vscode, state, { from: FROM, to: TO, keys, log });
    assert.deepStrictEqual(f.writes, [[`${TO}.${a}`, 'old-a', T.Global]]);
    assert.strictEqual(f.user[`${FROM}.${a}`], 'old-a', 'the old key is left');
    assert.strictEqual(state.get(`${TO}.settingsCarriedOver`), true, 'recorded in the part\'s globalState');
  }

  // a value already under the new key wins, scope by scope
  {
    const f = fake({
      user: { [`${FROM}.${a}`]: 'old-a', [`${TO}.${a}`]: 'new-a', [`${FROM}.${b}`]: 'old-b' },
      workspace: { [`${FROM}.${a}`]: 'ws-old-a' },
    });
    await carryOverSettings(f.vscode, memento(), { from: FROM, to: TO, keys, log });
    assert.deepStrictEqual(f.writes, [[`${TO}.${b}`, 'old-b', T.Global], [`${TO}.${a}`, 'ws-old-a', T.Workspace]]);
    assert.strictEqual(f.user[`${TO}.${a}`], 'new-a');
  }

  // workspace and folder values move at their own scopes; a falsy value is a value
  {
    const f = fake({ workspace: { [`${FROM}.${a}`]: false }, folders: { '/w/one': { [`${FROM}.${b}`]: 0 }, '/w/two': {} } });
    await carryOverSettings(f.vscode, memento(), { from: FROM, to: TO, keys, log });
    assert.deepStrictEqual(f.writes, [[`${TO}.${a}`, false, T.Workspace], [`${TO}.${b}`, 0, T.WorkspaceFolder, '/w/one']]);
  }

  // runs once: recorded, a later call reads and writes nothing
  {
    const f = fake({ user: { [`${FROM}.${a}`]: 'old-a' } });
    const state = memento();
    await carryOverSettings(f.vscode, state, { from: FROM, to: TO, keys, log });
    f.user[`${FROM}.${b}`] = 'set later';
    delete f.user[`${TO}.${a}`];
    f.writes.length = 0;
    await carryOverSettings(f.vscode, state, { from: FROM, to: TO, keys, log });
    assert.deepStrictEqual(f.writes, [], 'not again');
  }

  // a write that fails is logged; the others still go, and the run is still recorded
  {
    logs.length = 0;
    const f = fake({ user: { [`${FROM}.${a}`]: 1, [`${FROM}.${b}`]: 2 }, failOn: `${TO}.${a}` });
    const state = memento();
    await carryOverSettings(f.vscode, state, { from: FROM, to: TO, keys, log });
    assert.deepStrictEqual(f.writes, [[`${TO}.${b}`, 2, T.Global]]);
    assert.ok(logs.some((l) => l.includes(`${TO}.${a}`) && l.includes(`cannot write ${TO}.${a}`)), logs.join('\n'));
    assert.strictEqual(state.get(`${TO}.settingsCarriedOver`), true);
  }

  // no globalState, or a vscode without inspect (a test stub): nothing happens, nothing throws
  {
    const f = fake({ user: { [`${FROM}.${a}`]: 1 } });
    await carryOverSettings(f.vscode, undefined, { from: FROM, to: TO, keys, log });
    assert.deepStrictEqual(f.writes, []);
    const state = memento();
    await carryOverSettings({ workspace: { getConfiguration: () => ({ get: () => undefined }) } }, state, { from: FROM, to: TO, keys, log });
    assert.strictEqual(state.get(`${TO}.settingsCarriedOver`), undefined, 'not recorded: it did not run');
  }

  console.log('settingsCarryOver.test.js passed');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
