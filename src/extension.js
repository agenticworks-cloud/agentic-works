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

  // Every key false first, so nothing shows for a part that is off or fails; each turns true as its part starts.
  // The parts start side by side: one whose activate never ends holds up none of the others.
  async startAll() {
    for (const id of this.parts.keys()) await this.setKey(id, false);
    await Promise.allSettled([...this.parts.keys()].filter(isEnabled).map((id) => this.start(id)));
  }

  onConfigChange(event) {
    for (const id of this.parts.keys()) {
      if (!event.affectsConfiguration(contextKey(id))) continue;
      // a failure is already in the output channel (queue)
      (isEnabled(id) ? this.start(id) : this.stop(id)).catch(() => {});
    }
  }

  async stopAll() {
    await Promise.all([...this.parts.keys()].map((id) => this.stop(id)));
  }
}

let roost = null;

function activate(context) {
  const output = vscode.window.createOutputChannel('Roost');
  context.subscriptions.push(output);
  roost = new Roost(context, readParts(context.extensionPath), output);
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => roost.onConfigChange(e)));
  // not awaited: Roost is active at once, whatever its parts do; `ready` is for tests
  const r = roost;
  r.ready = r.startAll().catch((err) => r.log(`Roost could not start its parts: ${errorText(err)}`));
  return r;
}

async function deactivate() {
  if (!roost) return;
  const r = roost;
  roost = null;
  await r.stopAll();
}

module.exports = { activate, deactivate, Roost };
