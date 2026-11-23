'use strict';
// One-time carry-over of a part's settings renamed from `<from>.*` to `<to>.*` (Roost, 2026-11-23). The same file is
// in every part (Roost's tests check the copies match), so a part keeps working on its own, without Roost's src/.
//
// For each key, at each scope (user, workspace, each workspace folder): if the new key has no value there and the old
// key has one, the old value is written to the new key at that scope. The old key is left as it is. When done, the
// part's globalState records `<to>.settingsCarriedOver`, so this runs once; a write that fails is logged and skipped.

/** The part's own setting keys without `<prefix>.`, from its package.json's contributes.configuration. */
function settingKeys(pkg, prefix) {
  const blocks = [].concat((pkg.contributes || {}).configuration || []);
  return blocks.flatMap((b) => Object.keys(b.properties || {})).filter((k) => k.startsWith(prefix + '.')).map((k) => k.slice(prefix.length + 1));
}

/**
 * @param vscode  the vscode module
 * @param state   the part's globalState (a Memento); without one nothing runs
 * @param o.from  the old prefix, e.g. 'chirp'
 * @param o.to    the new prefix, e.g. 'teams'
 * @param o.keys  the keys without a prefix (settingKeys)
 * @param o.log   (line) => void, for writes that fail
 * @returns the writes made, as '<key> (<scope>)'
 */
async function carryOverSettings(vscode, state, { from, to, keys, log = () => {} }) {
  const done = `${to}.settingsCarriedOver`;
  if (!state || state.get(done)) return [];
  const ws = vscode.workspace;
  const root = ws && ws.getConfiguration && ws.getConfiguration();
  if (!root || typeof root.inspect !== 'function' || typeof root.update !== 'function') return [];
  const T = vscode.ConfigurationTarget || { Global: 1, Workspace: 2, WorkspaceFolder: 3 };
  const scopes = [
    { name: 'user', field: 'globalValue', target: T.Global, config: root },
    { name: 'workspace', field: 'workspaceValue', target: T.Workspace, config: root },
    ...(ws.workspaceFolders || []).map((f) => ({ name: `folder ${f.name}`, field: 'workspaceFolderValue', target: T.WorkspaceFolder, config: ws.getConfiguration(undefined, f.uri) })),
  ];
  const moved = [];
  for (const s of scopes) {
    for (const k of keys) {
      const was = s.config.inspect(`${from}.${k}`), now = s.config.inspect(`${to}.${k}`);
      if (!was || was[s.field] === undefined || (now && now[s.field] !== undefined)) continue;
      try {
        await s.config.update(`${to}.${k}`, was[s.field], s.target);
        moved.push(`${to}.${k} (${s.name})`);
      } catch (e) {
        log(`settings: could not carry ${from}.${k} over to ${to}.${k} (${s.name}): ${(e && e.message) || e}`);
      }
    }
  }
  await state.update(done, true);
  return moved;
}

module.exports = { carryOverSettings, settingKeys };
