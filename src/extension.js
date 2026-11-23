'use strict';
// Roost's entry point: starts each part under parts/ whose roost.<id>.enabled setting is on, with a context of its
// own; starts or stops a part when its setting changes; a part that throws at start is reported once and left off.
// Before a part is switched off it may say no (its confirmStop), which puts the switch back on. While a part is off,
// tabs VS Code brings back for it are closed, so they do not hang without a page; the part's own saved tab list,
// which it restores from when it starts, is left as it is. A part's views and commands show while its setting is on
// and its context key roost.<id>.failed is not set; Roost sets that key from a failed start until the next good one.
const path = require('node:path');
const vscode = require('vscode');
const { readParts, partContext } = require('./parts');

const settingKey = (id) => `roost.${id}.enabled`;
const failedKey = (id) => `roost.${id}.failed`;
const FIRST_START_KEY = 'roost.firstStart.done';
const PRS_VIEW_COMMAND = 'workbench.view.extension.kestrel';   // kestrel's panel view container id
const isEnabled = (id) => vscode.workspace.getConfiguration('roost').get(`${id}.enabled`, true);
const errorText = (e) => (e && e.stack) || String(e);

class Roost {
  constructor(base, parts, output) {
    this.base = base;
    this.output = output;
    // id → { part, state: 'on'|'off'|'failed', failed, context, module, queue, closers, serializers }
    // `failed`: what roost.<id>.failed was last set to; `serializers`: the part's own, however it registered them
    this.parts = new Map(parts.map((part) => [part.id, {
      part, state: 'off', failed: false, context: null, module: null, queue: Promise.resolve(), closers: null, serializers: new Set(),
    }]));
    this.owners = new Map();           // webview type → its part's entry
    for (const e of this.parts.values()) for (const type of e.part.webviews) this.owners.set(type, e);
  }

  state(id) { return this.entry(id).state; }

  entry(id) {
    const e = this.parts.get(id);
    if (!e) throw new Error(`Roost: no part ${id}`);
    return e;
  }

  // Starts and stops of one part run one after another, in the order asked; one that fails is logged and does not
  // hold up the next.
  queue(id, op) {
    const e = this.entry(id);
    const p = e.queue.then(() => op(e));
    e.queue = p.catch((err) => this.log(`${e.part.title}: a start or stop failed: ${errorText(err)}`));
    return p;
  }

  log(line) { this.output.appendLine(line); }

  start(id) {
    return this.queue(id, async (e) => {
      if (e.state === 'on') return;
      const { part } = e;
      this.stopClosingTabs(e);           // the part registers its own serializers
      const context = partContext(this.base, part);
      e.context = context;
      try {
        e.module = require(path.join(part.dir, part.entry));
        await e.module.activate(context);
      } catch (err) {
        e.state = 'failed';
        this.log(`${part.title} could not start: ${errorText(err)}`);
        await this.release(e);
        this.closeRestoredTabs(e);
        await this.setFailed(e, true);
        vscode.window.showErrorMessage(`Roost: ${part.title} could not start.`, 'Show Log').then((choice) => {
          if (choice === 'Show Log') this.output.show();
        });
        return;
      }
      e.state = 'on';
      if (e.failed) await this.setFailed(e, false);
    });
  }

  // `ask`: the user switched it off, so the part may say no first (the window closing asks nothing). No context key
  // is set: the setting itself hides the part's views, and a failed part stays marked until it starts.
  stop(id, { ask = false } = {}) {
    return this.queue(id, async (e) => {
      if (e.state === 'off') return;
      if (ask && e.state === 'on' && !(await this.confirmStop(e))) {
        await this.keepOn(e.part.id);
        return;
      }
      if (e.state === 'on') await this.release(e);
      e.state = 'off';
      this.closeRestoredTabs(e);
    });
  }

  // The part's confirmStop, if it has one; one that throws is logged and does not keep the part on.
  async confirmStop(e) {
    if (!e.module || typeof e.module.confirmStop !== 'function') return true;
    try {
      return (await e.module.confirmStop()) !== false;
    } catch (err) {
      this.log(`${e.part.title}: confirmStop threw, stopping anyway: ${errorText(err)}`);
      return true;
    }
  }

  // Puts roost.<id>.enabled back on at the scope where it was set to false (the workspace's, else the user's): the
  // value there is removed when the wider one (the user's, else the default) is already true, else set to true.
  async keepOn(id) {
    const config = vscode.workspace.getConfiguration('roost');
    const key = `${id}.enabled`;
    const set = config.inspect(key) || {};
    const T = vscode.ConfigurationTarget;
    const inWorkspace = set.workspaceValue !== undefined;
    const wider = inWorkspace && set.globalValue !== undefined ? set.globalValue : set.defaultValue;
    await config.update(key, wider === true ? undefined : true, inWorkspace ? T.Workspace : T.Global);
  }

  // While a part is off: a serializer for each of its webview types, closing a tab VS Code restores for it.
  closeRestoredTabs(e) {
    if (e.closers || this.closed) return;
    e.closers = [];
    for (const type of e.part.webviews) {
      try {
        e.closers.push(this.registerSerializer(type, { deserializeWebviewPanel: async (panel) => panel.dispose() }));
      } catch (err) {   // the part left one of its own registered
        this.log(`${e.part.title}: tabs of ${type} cannot be closed while it is off: ${errorText(err)}`);
      }
    }
  }

  stopClosingTabs(e) {
    for (const d of e.closers || []) d.dispose();
    e.closers = null;
  }

  // Every serializer a part registers is noted against the part that owns its webview type, so one it keeps
  // outside its subscriptions (or leaves behind when it throws) is still removed when it stops or fails. Roost's own
  // tab closers go through VS Code's function directly. Where the function cannot be replaced, nothing is noted.
  trackSerializers() {
    const w = vscode.window;
    const register = w.registerWebviewPanelSerializer;
    this.registerSerializer = (type, s) => register.call(w, type, s);
    const tracked = (type, s) => {
      const d = register.call(w, type, s);
      const e = this.owners.get(type);
      if (e) e.serializers.add(d);
      return d;
    };
    try {
      w.registerWebviewPanelSerializer = tracked;
      this.untrackSerializers = () => { if (w.registerWebviewPanelSerializer === tracked) w.registerWebviewPanelSerializer = register; };
    } catch (err) {
      this.log(`Roost cannot note the parts' webview serializers: ${errorText(err)}`);
    }
  }

  // Disposes the part's subscriptions and serializers, each on its own, then calls its deactivate.
  async release(e) {
    const { part, context } = e;
    const serializers = [...e.serializers];
    e.serializers.clear();
    for (const d of [...(context ? context.subscriptions.splice(0) : []), ...serializers]) {
      try {
        if (d && typeof d.dispose === 'function') d.dispose();
      } catch (err) {
        this.log(`${part.title}: a disposable threw while stopping: ${errorText(err)}`);
      }
    }
    e.context = null;
    try {
      if (e.module && typeof e.module.deactivate === 'function') await e.module.deactivate();
    } catch (err) {
      this.log(`${part.title}: deactivate threw: ${errorText(err)}`);
    }
  }

  // A key that cannot be set is logged; what the part does goes on.
  setFailed(e, failed) {
    e.failed = failed;
    const key = failedKey(e.part.id);
    return Promise.resolve(vscode.commands.executeCommand('setContext', key, failed))
      .catch((err) => this.log(`${key} could not be set: ${errorText(err)}`));
  }

  // Every failed key false first (one can be left from before an extension host restart); a part that fails sets
  // its own true after that. The parts start side by side: one whose activate never ends holds up none of the
  // others. Nothing here is awaited before the parts' activate calls, so each part registers its serializers before
  // VS Code restores its tabs, as it does when it is an extension of its own.
  async startAll() {
    this.trackSerializers();
    const keys = [...this.parts.values()].map((e) => this.setFailed(e, false));
    const starts = [];
    for (const [id, e] of this.parts) {
      if (isEnabled(id)) starts.push(this.start(id));
      else this.closeRestoredTabs(e);
    }
    await Promise.allSettled([...keys, ...starts]);
  }

  // Roost's very first activation: once the parts have started, the bottom panel opens on the PRs tab (it is closed
  // on a fresh profile), then roost.firstStart.done is recorded, whatever happened: a PRs part that is off or failed,
  // or a command that fails, is not retried later.
  async firstStart() {
    if (this.base.globalState.get(FIRST_START_KEY)) return;
    if (this.parts.has('pullRequests') && this.state('pullRequests') === 'on') {
      try {
        await vscode.commands.executeCommand(PRS_VIEW_COMMAND);
      } catch (err) {
        this.log(`Roost could not open the PRs tab on its first start: ${errorText(err)}`);
      }
    }
    try {
      await this.base.globalState.update(FIRST_START_KEY, true);
    } catch (err) {
      this.log(`Roost could not record its first start: ${errorText(err)}`);
    }
  }

  onConfigChange(event) {
    if (this.closed) return;           // Roost is stopping: a change now starts nothing
    for (const id of this.parts.keys()) {
      if (!event.affectsConfiguration(settingKey(id))) continue;
      // a failure is already in the output channel (queue)
      (isEnabled(id) ? this.start(id) : this.stop(id, { ask: true })).catch(() => {});
    }
  }

  // The window closing: every part is released (a stop sets no context key, so nothing waits on VS Code's main
  // thread), and no serializer is left behind.
  async stopAll() {
    this.closed = true;
    await Promise.all([...this.parts.keys()].map((id) => this.stop(id)));
    for (const e of this.parts.values()) this.stopClosingTabs(e);
    if (this.untrackSerializers) this.untrackSerializers();
  }
}

let roost = null;

function activate(context) {
  const output = vscode.window.createOutputChannel('Roost');
  context.subscriptions.push(output);
  const r = new Roost(context, readParts(context.extensionPath), output);
  roost = r;
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => r.onConfigChange(e)));
  // Roost's own, whatever parts are on: the Settings page filtered to this extension's switches and the parts' settings
  context.subscriptions.push(vscode.commands.registerCommand('roost.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:seanahn.roost')));
  // not awaited: Roost is active at once, whatever its parts do; `ready` is for tests
  r.ready = r.startAll().catch((err) => r.log(`Roost could not start its parts: ${errorText(err)}`));
  // after the parts have started, and not awaited here: activation does not wait for it
  r.firstStarted = r.ready.then(() => r.firstStart()).catch((err) => r.log(`Roost first start failed: ${errorText(err)}`));
  return r;
}

async function deactivate() {
  if (!roost) return;
  const r = roost;
  roost = null;
  await r.stopAll();
}

module.exports = { activate, deactivate, Roost };
