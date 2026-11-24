'use strict';
// A minimal MCP client over stdio: newline-delimited JSON-RPC 2.0 to a server process Roost starts, for a server's
// own sign-in tool and for checks. Lines on stdout that aren't JSON are skipped. The process exiting rejects every
// pending call; a call with no answer in time rejects and the process is closed (SIGTERM, then SIGKILL after 2 s),
// so a server that misbehaves is never left running.
const childProcess = require('node:child_process');

const PROTOCOL_VERSION = '2025-06-18';
const KILL_AFTER_MS = 2000;

const seconds = (ms) => `${Math.round(ms / 100) / 10}`;

class McpStdioClient {
  constructor({ command, args = [], env = {}, spawn = childProcess.spawn, startTimeoutMs = 30000 }) {
    this.command = command;
    this.args = args;
    this.env = env;
    this.spawn = spawn;
    this.startTimeoutMs = startTimeoutMs;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buf = '';
    this.exited = null;   // the Error every later call rejects with, once the process is gone
    this.killTimer = null;
  }

  start() {
    try {
      this.child = this.spawn(this.command, this.args, { env: { ...process.env, ...this.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return Promise.reject(this._spawnError(e));
    }
    const child = this.child;
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => this._data(chunk));
    child.stderr.on('data', () => { /* drained; never shown (it may hold a secret) */ });
    child.stdin.on('error', () => { /* the process is gone; 'exit' rejects the calls */ });
    child.on('error', (e) => this._gone(this._spawnError(e)));
    child.on('close', () => this._gone(new Error('the server exited')));   // after stdout is drained
    return this._request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'roost' },
    }, this.startTimeoutMs).then(() => { this._send({ jsonrpc: '2.0', method: 'notifications/initialized' }); }, (e) => {
      this.close();
      throw e;
    });
  }

  /** @returns {Promise<{ text: string, isError: boolean }>} the text contents, joined */
  callTool(name, args, { timeoutMs = 60000 } = {}) {
    return this._request('tools/call', { name, arguments: args || {} }, timeoutMs).then((result) => {
      const content = (result && Array.isArray(result.content)) ? result.content : [];
      const text = content.filter((c) => c && c.type === 'text' && typeof c.text === 'string').map((c) => c.text).join('\n');
      return { text, isError: !!(result && result.isError) };
    });
  }

  close() {
    const child = this.child;
    if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null || this.killTimer) return;
    try { child.stdin.end(); } catch (_) { /* gone */ }
    try { child.kill('SIGTERM'); } catch (_) { /* gone */ }
    this.killTimer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }
    }, KILL_AFTER_MS);
    child.once('exit', () => clearTimeout(this.killTimer));
  }

  _spawnError(e) {
    return e && e.code === 'ENOENT' ? new Error(`${this.command} not found`) : new Error(`${this.command} could not start: ${e && e.message}`);
  }

  _request(method, params, timeoutMs) {
    if (this.exited) return Promise.reject(this.exited);
    if (!this.child) return Promise.reject(new Error('the server is not started'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`no answer in ${seconds(timeoutMs)} s`));
        this.close();   // a server that doesn't answer is not trusted with another call
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this._send({ jsonrpc: '2.0', id, method, params });
    });
  }

  _send(msg) {
    if (this.exited || !this.child) return;
    try { this.child.stdin.write(JSON.stringify(msg) + '\n'); } catch (_) { /* gone */ }
  }

  _data(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch (_) { continue; }
      if (!msg || typeof msg !== 'object') continue;
      if (msg.method !== undefined) { this._serverRequest(msg); continue; }
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(String(msg.error.message || 'the server answered with an error')));
      else p.resolve(msg.result);
    }
  }

  // A request from the server: ping is answered; anything else is refused. Notifications are ignored.
  _serverRequest(msg) {
    if (msg.id === undefined || msg.id === null) return;
    if (msg.method === 'ping') this._send({ jsonrpc: '2.0', id: msg.id, result: {} });
    else this._send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `${msg.method} is not supported` } });
  }

  _gone(err) {
    if (this.exited) return;
    this.exited = err;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(err); }
    this.pending.clear();
  }
}

module.exports = { McpStdioClient, PROTOCOL_VERSION };
