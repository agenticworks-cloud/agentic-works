'use strict';
// A fake vscode module, installed for require('vscode'), so Agentic Works' loader runs without VS Code. It records what
// Agentic Works does: context keys, error messages, the output channel, registered commands and webview serializers, setting
// writes; tests set ui.config (and ui.inspect for the scopes a value is set at) and call ui.changeConfig(keys) to fire
// onDidChangeConfiguration, and ui.restorePanel(viewType) to have VS Code bring back a tab of that type. Webview panels
// Agentic Works opens are in ui.panels (each with .posted, the messages sent to its page, and .receive(m), a message from the
// page, resolving once the host's listeners have); env.openExternal goes to ui.opened, the clipboard to ui.clipboard.
const Module = require('module');
const path = require('path');
const origLoad = Module._load;

class Emitter {
  constructor() { this.fns = []; this.event = (fn) => { this.fns.push(fn); return { dispose: () => { this.fns = this.fns.filter((f) => f !== fn); } }; }; }
  fire(x) { for (const f of [...this.fns]) f(x); }
}

function install() {
  process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH = '1';   // Agentic Works then refuses to start without a stubbed ghLogins (never this machine's gh)
  const ui = { config: {}, contexts: {}, errors: [], out: [], shown: 0, commands: {}, errorChoice: undefined, failSetContext: 0, serializers: {}, inspect: {}, updates: [], reads: [], failUpdate: null, sent: [], asyncSetContext: false, applied: Promise.resolve(), panels: [], opened: [], clipboard: [] };
  const configChange = new Emitter();
  const terminalClose = new Emitter();
  // a terminal closing, as when its shell exits; closeListeners: how many onDidCloseTerminal listeners are left
  ui.closeTerminal = (t) => terminalClose.fire(t);
  ui.closeListeners = () => terminalClose.fns.length;
  ui.changeConfig = (keys) => configChange.fire({ affectsConfiguration: (s) => keys.some((k) => k === s || k.startsWith(s + '.')) });
  const Uri = {
    parse: (s) => ({ scheme: String(s).split(':')[0], toString: () => String(s) }),
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => 'file://' + p }),
    // keeps the scheme and authority of `u`, as the real one does (a remote window's extension URI is no file: URI)
    joinPath: (u, ...parts) => {
      const p = path.posix.join(u.path, ...parts);
      return { ...u, path: p, fsPath: path.join(u.fsPath, ...parts), toString: () => `${u.scheme}://${u.authority || ''}${p}` };
    },
  };
  // a tab VS Code brings back: handed to the serializer registered for its type, as after a window reload
  ui.restorePanel = (viewType, state) => {
    const panel = { viewType, disposed: false, dispose() { this.disposed = true; } };
    const z = ui.serializers[viewType];
    if (z) z.deserializeWebviewPanel(panel, state);
    return panel;
  };
  const vscode = {
    Uri, EventEmitter: Emitter,
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    ViewColumn: { Active: -1, Beside: -2, One: 1 },
    env: {
      openExternal: async (uri) => { ui.opened.push(String(uri)); return true; },
      clipboard: { writeText: async (t) => { ui.clipboard.push(t); } },
    },
    window: {
      createWebviewPanel: (viewType, title, column, options) => {
        const received = [];
        const disposed = new Emitter();
        const panel = {
          viewType, title, column, options, disposed: false, revealed: 0, posted: [],
          webview: {
            html: '', cspSource: 'vscode-resource:',
            postMessage: async (m) => { panel.posted.push(JSON.parse(JSON.stringify(m))); return true; },
            onDidReceiveMessage: (fn) => { received.push(fn); return { dispose() { const i = received.indexOf(fn); if (i >= 0) received.splice(i, 1); } }; },
          },
          reveal() { panel.revealed++; },
          onDidDispose: disposed.event,
          dispose() { if (panel.disposed) return; panel.disposed = true; disposed.fire(); },
          receive: (m) => Promise.all(received.map((fn) => fn(m))),
        };
        ui.panels.push(panel);
        return panel;
      },
      createOutputChannel: (name) => ({ name, appendLine: (l) => ui.out.push(l), show() { ui.shown++; }, dispose() {} }),
      onDidCloseTerminal: terminalClose.event,
      createTerminal: (opts) => {
        const t = { ...opts, sent: [], shown: false, show() { t.shown = true; }, sendText(x) { t.sent.push(x); }, dispose() {} };
        (ui.terminals = ui.terminals || []).push(t);
        return t;
      },
      // ui.infoChoice: the button picked (or a function of the message and buttons); undefined, as dismissed
      showInformationMessage: (m, ...items) => {
        (ui.infos = ui.infos || []).push(m);
        return Promise.resolve(typeof ui.infoChoice === 'function' ? ui.infoChoice(m, items) : ui.infoChoice);
      },
      showErrorMessage: (m, ...items) => { ui.errors.push({ message: m, items }); return Promise.resolve(ui.errorChoice); },
      registerWebviewPanelSerializer: (viewType, z) => {
        if (ui.serializers[viewType]) throw new Error(`A serializer for '${viewType}' is already registered`);
        ui.serializers[viewType] = z;
        return { dispose() { if (ui.serializers[viewType] === z) delete ui.serializers[viewType]; } };
      },
    },
    commands: {
      registerCommand: (id, fn) => {
        if (ui.commands[id]) throw new Error(`command '${id}' already exists`);
        ui.commands[id] = fn;
        return { dispose() { if (ui.commands[id] === fn) delete ui.commands[id]; } };
      },
      executeCommand: async (id, ...a) => {
        if (id === 'setContext') {
          if (ui.failSetContext > 0) { ui.failSetContext--; throw new Error('setContext failed'); }
          ui.sent.push([a[0], a[1]]);
          if (!ui.asyncSetContext) { ui.contexts[a[0]] = a[1]; return undefined; }
          // as across the process boundary: applied a turn later, in the order sent
          ui.applied = ui.applied.then(() => new Promise((r) => setImmediate(r))).then(() => { ui.contexts[a[0]] = a[1]; });
          return ui.applied;
        }
        if (!ui.commands[id]) throw new Error(`command '${id}' not found`);
        return ui.commands[id](...a);
      },
    },
    workspace: {
      getConfiguration: (section) => ({
        get: (key, dflt) => {
          const full = section ? `${section}.${key}` : key;
          ui.reads.push(full);
          return full in ui.config ? ui.config[full] : dflt;
        },
        inspect: (key) => {
          const full = section ? `${section}.${key}` : key;
          ui.reads.push(full);
          return ui.inspect[full] || { globalValue: ui.config[full] };
        },
        // records the write, then changes the value and tells the listeners, as the real one does
        update: async (key, value, target) => {
          const full = section ? `${section}.${key}` : key;
          if (ui.failUpdate) throw new Error(ui.failUpdate);
          ui.updates.push([full, value, target]);
          delete ui.inspect[full];
          if (value === undefined) delete ui.config[full]; else ui.config[full] = value;   // undefined: the default holds
          ui.changeConfig([full]);
        },
      }),
      onDidChangeConfiguration: configChange.event,
    },
  };
  Module._load = function (request, ...rest) {
    if (request === 'vscode') return vscode;
    return origLoad.call(this, request, ...rest);
  };
  ui.vscode = vscode;
  return ui;
}

module.exports = { install, Emitter };
