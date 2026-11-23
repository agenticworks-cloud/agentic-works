'use strict';
// Roost with a real part: jay's saved tabs through Roost's switch-off and on, and a tab VS Code restores while jay is
// off, closed by Roost's serializer and opened by jay once it starts. Runs under jay's own vscode stub; HOME is a temp
// dir, so nothing reaches the real ~/.jay, and there is no sign-in, so jay makes no request.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-real-'));
process.on('exit', () => fs.rmSync(home, { recursive: true, force: true }));
process.env.HOME = home;
process.env.JAY_RESTORE_GRACE_MS = '150';
globalThis.fetch = async () => { throw new Error('no network in tests'); };

const root = path.join(__dirname, '..');
const { install, memento, secrets } = require(path.join(root, 'parts', 'jira', 'test', 'vscodeStub.js'));
const { ui, vscode } = install();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const open = () => ui.panels.filter((p) => !p.disposed && p.viewType === 'jay.ticket').map((p) => p.title);

const workspaceState = memento(), globalState = memento(), secretStore = secrets();
function boot() {
  for (const f of ['extension.js', 'parts.js']) delete require.cache[path.join(root, 'src', f)];
  const extension = require(path.join(root, 'src', 'extension.js'));
  const base = { subscriptions: [], extensionPath: root, extensionUri: vscode.Uri.file(root), asAbsolutePath: (r) => path.join(root, r),
    globalState, workspaceState, secrets: secretStore, globalStorageUri: vscode.Uri.file(path.join(home, 'g')), extensionMode: 3 };
  const roost = extension.activate(base);
  // VS Code calls deactivate, then disposes the context's subscriptions
  const stop = async () => { await extension.deactivate(); for (const d of base.subscriptions.splice(0)) d.dispose(); };
  return { roost, stop };
}
const restore = (key) => { const p = vscode.window.createWebviewPanel('jay.ticket', key, 1, {}); ui.serializers['jay.ticket'].deserializeWebviewPanel(p, { key }); return p; };
const setJira = async (on) => { ui.setConfig('roost.jira.enabled', on); await wait(30); };

(async () => {
  for (const id of ['agents', 'pullRequests', 'teams']) ui.config[`roost.${id}.enabled`] = false;   // only jay
  ui.config['jay.confluence.enabled'] = false;

  // window 1: jay on; VS Code restores a ticket tab, jay takes it and keeps it
  let w = boot(); await w.roost.ready;
  assert.strictEqual(w.roost.state('jira'), 'on');
  restore('DEMO-1');
  assert.deepStrictEqual(open(), ['DEMO-1']);

  // switched off and on in the window: the tab closes, and comes back at once
  await setJira(false);
  assert.strictEqual(w.roost.state('jira'), 'off');
  assert.deepStrictEqual(open(), [], 'closed with jay');
  assert.strictEqual(restore('DEMO-1').disposed, true, 'a tab restored while jay is off is closed');
  await setJira(true);
  assert.deepStrictEqual(open(), ['DEMO-1'], 'back, once');
  await wait(200);
  assert.deepStrictEqual(open(), ['DEMO-1'], 'and not twice');

  // the window closes; the next one starts with jay off
  await w.stop();
  for (const p of ui.panels) p.dispose();
  ui.config['roost.jira.enabled'] = false;
  w = boot(); await w.roost.ready;
  assert.strictEqual(restore('DEMO-1').disposed, true, "Roost's serializer closes the tab VS Code restores");
  await setJira(true);
  assert.deepStrictEqual(open(), [], 'not at once: VS Code may still bring it back');
  await wait(200);
  assert.deepStrictEqual(open(), ['DEMO-1'], 'jay opens it after the wait');
  await w.stop();
  console.log('realParts.test.js passed');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });
