'use strict';
// Roost's entry point: starts each part under parts/ whose roost.<id>.enabled setting is on, with a context of its
// own; starts or stops a part when its setting changes; a part that throws at start is reported once and left off.
const path = require('node:path');
const vscode = require('vscode');
const { readParts, partContext } = require('./parts');

const contextKey = (id) => `roost.${id}.enabled`;
const isEnabled = (id) => vscode.workspace.getConfiguration('roost').get(`${id}.enabled`, true);
const errorText = (e) => (e && e.stack) || String(e);

class Roost {
  constructor(base, parts, output) {
    this.base = base;
    this.output = output;
    // id → { part, state: 'on'|'off'|'failed', context, module, queue }
    this.parts = new Map(parts.map((part) => [part.id, { part, state: 'off', context: null, module: null, queue: Promise.resolve() }]));
  }

  state(id) { return this.entry(id).state; }

  entry(id) {
    const e = this.parts.get(id);
    if (!e) throw new Error(`Roost: no part ${id}`);
    return e;
  }

  // Starts and stops of one part run one after another, in the order asked.
  queue(id, op) {
    const e = this.entry(id);
    e.queue = e.queue.then(() => op(e));
    return e.queue;
  }

  log(line) { this.output.appendLine(line); }

  start(id) {
    return this.queue(id, async (e) => {
      if (e.state === 'on') return;
      const { part } = e;
      const context = partContext(this.base, part);
      e.context = context;
      try {
        e.module = require(path.join(part.dir, part.entry));
        await e.module.activate(context);
      } catch (err) {
        e.state = 'failed';
        this.log(`${part.title} could not start: ${errorText(err)}`);
        await this.release(e);
        await this.setKey(part.id, false);
        vscode.window.showErrorMessage(`Roost: ${part.title} could not start.`, 'Show Log').then((choice) => {
          if (choice === 'Show Log') this.output.show();
        });
        return;
      }
      e.state = 'on';
      await this.setKey(part.id, true);
    });
  }

  stop(id) {
    return this.queue(id, async (e) => {
      if (e.state === 'off') return;
      await this.setKey(e.part.id, false);
      if (e.state === 'on') await this.release(e);
      e.state = 'off';
    });
  }

  // Disposes the part's subscriptions, each on its own, then calls its deactivate.
  async release(e) {
    const { part, context } = e;
    for (const d of context ? context.subscriptions.splice(0) : []) {
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

  setKey(id, on) { return vscode.commands.executeCommand('setContext', contextKey(id), on); }

  async startAll() {
    // Every key false first, so nothing shows for a part that is off or fails; each turns true as its part starts.
    for (const id of this.parts.keys()) await this.setKey(id, false);
    for (const id of this.parts.keys()) if (isEnabled(id)) await this.start(id);
  }

  onConfigChange(event) {
    for (const id of this.parts.keys()) {
      if (!event.affectsConfiguration(contextKey(id))) continue;
      if (isEnabled(id)) this.start(id);
      else this.stop(id);
    }
  }

  async stopAll() {
    await Promise.all([...this.parts.keys()].map((id) => this.stop(id)));
  }
}

let roost = null;

async function activate(context) {
  const output = vscode.window.createOutputChannel('Roost');
  context.subscriptions.push(output);
  roost = new Roost(context, readParts(context.extensionPath), output);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => roost.onConfigChange(e)));
  await roost.startAll();
  return roost;
}

async function deactivate() {
  if (!roost) return;
  const r = roost;
  roost = null;
  await r.stopAll();
}

module.exports = { activate, deactivate, Roost };
