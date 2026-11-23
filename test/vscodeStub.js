'use strict';
// A fake vscode module, installed for require('vscode'), so Roost's loader runs without VS Code. It records what
// Roost does: context keys, error messages, the output channel, registered commands; tests set ui.config and call
// ui.changeConfig(keys) to fire onDidChangeConfiguration.
const Module = require('module');
const path = require('path');
const origLoad = Module._load;

class Emitter {
  constructor() { this.fns = []; this.event = (fn) => { this.fns.push(fn); return { dispose: () => { this.fns = this.fns.filter((f) => f !== fn); } }; }; }
  fire(x) { for (const f of [...this.fns]) f(x); }
}

function install() {
  const ui = { config: {}, contexts: {}, errors: [], out: [], shown: 0, commands: {}, errorChoice: undefined };
  const configChange = new Emitter();
  ui.changeConfig = (keys) => configChange.fire({ affectsConfiguration: (s) => keys.some((k) => k === s || k.startsWith(s + '.')) });
  const Uri = {
    file: (p) => ({ fsPath: p, path: p, scheme: 'file', toString: () => 'file://' + p }),
    joinPath: (u, ...parts) => Uri.file(path.join(u.fsPath, ...parts)),
  };
  const vscode = {
    Uri, EventEmitter: Emitter,
    window: {
      createOutputChannel: (name) => ({ name, appendLine: (l) => ui.out.push(l), show() { ui.shown++; }, dispose() {} }),
      showErrorMessage: (m, ...items) => { ui.errors.push({ message: m, items }); return Promise.resolve(ui.errorChoice); },
    },
    commands: {
      registerCommand: (id, fn) => {
        if (ui.commands[id]) throw new Error(`command '${id}' already exists`);
        ui.commands[id] = fn;
        return { dispose() { if (ui.commands[id] === fn) delete ui.commands[id]; } };
      },
      executeCommand: async (id, ...a) => {
        if (id === 'setContext') { ui.contexts[a[0]] = a[1]; return undefined; }
        if (!ui.commands[id]) throw new Error(`command '${id}' not found`);
        return ui.commands[id](...a);
      },
    },
    workspace: {
      getConfiguration: (section) => ({
        get: (key, dflt) => {
          const full = section ? `${section}.${key}` : key;
          return full in ui.config ? ui.config[full] : dflt;
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
