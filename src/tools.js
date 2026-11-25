'use strict';
// Connect your tools: the company file's MCP servers as rows, each signed in its own way (connect.kind) and connected
// only once its check passes, then registered with Claude Code at user scope (claudeMcp.js). No VS Code here: the
// panel (toolsPage.js) shows the rows and calls these methods; the terminal is given to it as runInTerminal.
//   tokenPage  the token is pasted: trimmed, checked with that token, and saved (TOKEN_DIR/<id>) only on a pass
//   command    a sign-in command in a terminal; done when doneWhen.file appears (or the terminal closes), then checked
//   mcpTool    the server's own sign-in tool, over stdio: called once (its text, a link and a code, is the prompt),
//              then again with `complete`, in one process; then checked
//   none       checked
// A check: `request` passes on 2xx, `mcpTool` when the call isn't an error, `command` on exit 0. With no check: the
// doneWhen file exists (command, mcpTool), a token is saved (tokenPage), always (none). No check runs at construction.
// A row is `connected` only when its check passed (`signedIn`) and Claude Code was given the server: a registration
// that failed, or a different entry of the same name waiting for Replace (`conflict`), leaves it `notConnected` with
// the reason.
// A server with `install` (company.js) whose program isn't there yet is first downloaded, when Connect is pressed (never
// by a check): gh release download, the asset for this platform, argv with no shell, to a temporary file that is then
// moved to `to`, mode 0755. gh not signed in: the row says so, with `action: 'githubSignIn'` for the page's button.
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { McpStdioClient, PROTOCOL_VERSION } = require('./mcpClient');
const { CLAUDE_JSON, registration, register } = require('./claudeMcp');

const TOKEN_DIR = '~/.config/roost/tokens';
const CHECK_MS = 30000;
const SIGN_IN_MS = 60000;
const COMPLETE_MS = 15 * 60000;
const POLL_MS = 2000;
/** A command sign-in's row, while its terminal is open. */
const COMMAND_WAIT_HINT = 'If the sign-in failed, close its terminal to try again.';
const DOWNLOAD_MS = 5 * 60000;
/** An install row's reason when gh has no login; the row's action then runs Roost: Sign In to GitHub. */
const GITHUB_FIRST = 'Sign in to GitHub first.';
/** A check's reason for a server whose program isn't downloaded yet (a check never downloads). */
const NOT_INSTALLED = 'Not installed yet: Connect downloads it.';
const NOT_SIGNED_IN = 'Not signed in yet.';
const NO_TOKEN = 'No token saved yet.';

/** process.platform and process.arch as the company file's asset keys: darwin-arm64, linux-x64, ... */
const platformKey = (platform = process.platform, arch = process.arch) => `${platform}-${arch}`;
/** Anything that looks like a GitHub token, out of a text that is shown or logged. */
const scrub = (t) => String(t || '').replace(/\b(gh[pousr]_|github_pat_)[A-Za-z0-9_]+/g, '$1…');

const expand = (p, home) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

/** The text a sign-in tool returned, with the first link and the first code in it ('' when absent). */
function promptOf(text) {
  const t = String(text || '');
  const u = t.match(/https?:\/\/[^\s)"'<>]+/);
  const c = t.match(/code[:\s]+([A-Z0-9][A-Z0-9-]{3,})/i);
  return { text: t, url: u ? u[0].replace(/[.,;:!?]+$/, '') : '', code: c ? c[1] : '' };
}

/** Run argv with no shell: resolves { code, stderr }; a command that isn't there rejects with code ENOENT. */
function defaultRun(argv, { timeoutMs = CHECK_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = childProcess.spawn(argv[0], argv.slice(1), { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (e) { reject(e); return; }
    let stderr = '';
    let timedOut = false;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-8192); });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 2000).unref();
    }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) { const e = new Error(`no answer in ${Math.round(timeoutMs / 1000)} s`); e.code = 'ETIMEDOUT'; reject(e); return; }
      resolve({ code, stderr });
    });
  });
}

// A file's modification time and inode, or null when it isn't there
const stamp = (file) => { try { const s = fs.statSync(file); return `${s.mtimeMs}:${s.ino}:${s.size}`; } catch (_) { return null; } };
const lastLine = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Tools {
  constructor({ company, home = os.homedir(), fetch = globalThis.fetch, spawn = childProcess.spawn, run = defaultRun, claudeJson, onChange = () => {}, platform = platformKey(), tmpDir = os.tmpdir() }) {
    this.home = home;
    this.platform = platform;
    this.tmpDir = tmpDir;
    this.fetch = fetch;
    this.spawn = spawn;
    this.run = run;
    this.claudeJson = claudeJson || expand(CLAUDE_JSON, home);
    this.tokenDir = expand(TOKEN_DIR, home);
    this.onChange = onChange;
    this.pollMs = POLL_MS;
    this.servers = new Map(((company && company.mcpServers) || []).map((s) => [s.id, s]));
    this.state = new Map([...this.servers.values()].map((s) => [s.id, {
      id: s.id, name: s.name, about: s.about, kind: s.connect.kind, page: s.connect.page || '', button: s.connect.button || '',
      state: 'unknown', reason: '', prompt: null, conflict: false, signedIn: false, action: '', notYet: false,
    }]));
    this.clients = new Set();
    this.disposed = false;
  }

  rows() { return [...this.state.values()].map((r) => ({ ...r })); }
  allConnected() { return this.state.size > 0 && [...this.state.values()].every((r) => r.state === 'connected'); }

  /** The id of the row whose doneWhen file is `file`, or null. */
  rowForTokenFile(file) {
    const want = path.resolve(expand(String(file || ''), this.home));
    for (const s of this.servers.values()) if (s.connect.doneWhen && path.resolve(s.connect.doneWhen.file) === want) return s.id;
    return null;
  }

  async checkAll() { await Promise.all([...this.servers.keys()].map((id) => this.check(id))); }

  async check(id) {
    if (this._busy(id)) return { ...this._row(id) };
    if (this._needsInstall(this._server(id))) return this._set(id, { state: 'notConnected', reason: NOT_INSTALLED, notYet: true });
    return this._checkAndRegister(id);
  }

  async saveToken(id, token) {
    const server = this._server(id);
    if (this._busy(id)) return { ...this._row(id) };
    const t = String(token || '').trim();
    if (!t) return this._set(id, { state: 'notConnected', reason: 'The token is empty.' });
    if (!(await this._install(server))) return { ...this._row(id) };
    this._set(id, { state: 'checking', reason: '' });
    const failed = server.connect.check ? await this._runCheck(server, t) : null;
    if (failed) return this._set(id, { state: 'notConnected', reason: failed });
    const before = this._readToken(id);
    try {
      this._writeToken(id, t);
    } catch (e) {
      return this._set(id, { state: 'notConnected', reason: `The token couldn't be saved: ${e.message}` });
    }
    return this._passed(server, t, before || undefined);
  }

  async connectCommand(id, { runInTerminal }) {
    const server = this._server(id);
    if (this._busy(id)) return { ...this._row(id) };
    if (!(await this._install(server))) return { ...this._row(id) };
    this._set(id, { state: 'connecting', reason: '', prompt: null });
    const file = server.connect.doneWhen && server.connect.doneWhen.file;
    const before = stamp(file);   // signing in again: the file is usually there already, and only a new one is done
    const fresh = () => { const now = stamp(file); return now !== null && now !== before; };
    let terminal;
    try {
      terminal = runInTerminal(server.connect.command.slice());
    } catch (e) {
      return this._set(id, { state: 'notConnected', reason: `The sign-in didn't start: ${e.message}` });
    }
    // a sign-in that fails leaves its terminal open (to be read), and the row waits for it to close: the row says so
    this._set(id, { reason: COMMAND_WAIT_HINT });
    let isClosed = false;
    const closed = Promise.resolve(terminal && terminal.closed).then(() => { isClosed = true; }, () => { isClosed = true; });
    while (!this.disposed && !isClosed && !fresh()) await Promise.race([sleep(this.pollMs), closed]);
    if (this.disposed) return { ...this._row(id) };
    if (!fs.existsSync(file)) {   // the terminal closed, and one last look found nothing (an older file is checked)
      return this._set(id, { state: 'notConnected', reason: "The sign-in didn't finish." });
    }
    return this._checkAndRegister(id);
  }

  async connectMcpTool(id, { onPrompt = () => {} } = {}) {
    const server = this._server(id);
    if (this._busy(id)) return { ...this._row(id) };
    if (!(await this._install(server))) return { ...this._row(id) };
    const c = server.connect;
    this._set(id, { state: 'connecting', reason: '', prompt: null });
    const client = this._client(server, SIGN_IN_MS);
    try {
      await client.start();
      const first = await client.callTool(c.tool, c.args, { timeoutMs: SIGN_IN_MS });
      if (first.isError) throw new Error(first.text.trim() || `${c.tool} failed`);
      const prompt = promptOf(first.text);
      this._set(id, { prompt });
      try { onPrompt(prompt); } catch (_) { /* the panel's problem, not the sign-in's */ }
      if (c.complete) {
        const done = await client.callTool(c.tool, c.complete, { timeoutMs: COMPLETE_MS });
        if (done.isError) throw new Error(done.text.trim() || `${c.tool} failed`);
      }
    } catch (e) {
      return this._set(id, { state: 'notConnected', reason: e.message, prompt: null });
    } finally {
      this._closeClient(client);
    }
    if (this.disposed) return { ...this._row(id) };
    return this._checkAndRegister(id);
  }

  async connectNone(id) { return this.connectChecked(id); }

  /** Connect for a row whose sign-in is a check (none, or a tokenPage row's saved token): installed first, then checked. */
  async connectChecked(id) {
    const server = this._server(id);
    if (this._busy(id)) return { ...this._row(id) };
    if (!(await this._install(server))) return { ...this._row(id) };
    return this._checkAndRegister(id);
  }

  async replaceRegistration(id) {
    const server = this._server(id);
    const row = this._row(id);
    try {
      register(this.claudeJson, id, registration(server, { token: this._readToken(id) }), { replace: true });
      return this._set(id, row.signedIn ? { state: 'connected', conflict: false, reason: '' } : { conflict: false });
    } catch (e) {
      return this._set(id, { reason: `Claude Code's settings weren't changed: ${e.message}` });
    }
  }

  dispose() {
    this.disposed = true;
    for (const c of this.clients) c.close();
    this.clients.clear();
  }

  // ---- internals

  _server(id) {
    const s = this.servers.get(id);
    if (!s) throw new Error(`no tool named ${id}`);
    return s;
  }

  _row(id) { this._server(id); return this.state.get(id); }

  // A check or a sign-in is under way: a second one returns the row rather than racing it.
  _busy(id) { const s = this._row(id).state; return s === 'checking' || s === 'connecting'; }

  _set(id, patch) {
    const row = this._row(id);
    if (patch.state === 'notConnected' && patch.signedIn === undefined) patch = { ...patch, signedIn: false };
    if (patch.state !== undefined && patch.action === undefined) patch = { ...patch, action: '' };
    // notYet: nothing has been tried yet (not installed, no token, not signed in): the row says so plainly, not as a fault
    if (patch.state !== undefined && patch.notYet === undefined) patch = { ...patch, notYet: false };
    Object.assign(row, patch);
    if (!this.disposed) { try { this.onChange(this.rows()); } catch (_) { /* a listener's error isn't ours */ } }
    return { ...row };
  }

  _client(server, startTimeoutMs) {
    const r = server.register;
    const client = new McpStdioClient({ command: r.command, args: r.args, env: r.env, spawn: this.spawn, startTimeoutMs });
    this.clients.add(client);
    return client;
  }

  _closeClient(client) {
    client.close();
    this.clients.delete(client);
  }

  _tokenFile(id) { return path.join(this.tokenDir, id); }

  _readToken(id) {
    try { return fs.readFileSync(this._tokenFile(id), 'utf8').trim(); } catch (_) { return ''; }
  }

  _writeToken(id, token) {
    fs.mkdirSync(this.tokenDir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') fs.chmodSync(this.tokenDir, 0o700);
    const file = this._tokenFile(id);
    const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmp, token + '\n', { mode: 0o600 });
      fs.renameSync(tmp, file);
    } catch (e) {
      try { fs.unlinkSync(tmp); } catch (_) { /* never made */ }
      throw e;
    }
  }

  // ---- install: the server's program, from its GitHub release, when it isn't there

  /** Whether the server has an install and its program (`to`, or a register.command that is a path) is missing. */
  _needsInstall(server) {
    const inst = server.install;
    if (!inst) return false;
    const files = [inst.to];
    const r = server.register;
    if (r.type === 'stdio' && r.command.includes('/')) files.push(r.command);
    return files.some((f) => !fs.existsSync(f));
  }

  /** true when there is nothing to install or the download landed; false with the row set to why not. */
  async _install(server) {
    if (!this._needsInstall(server)) return true;
    const id = server.id, inst = server.install, gh = inst.github;
    const asset = gh.assets[this.platform];
    if (!asset) { this._set(id, { state: 'notConnected', reason: `No download of ${server.name} for this computer (${this.platform}).` }); return false; }
    this._set(id, { state: 'connecting', reason: 'Checking the GitHub sign-in…', prompt: null });
    let auth;
    try {
      auth = await this.run(['gh', 'auth', 'status'], { timeoutMs: CHECK_MS });
    } catch (e) {
      const why = e && e.code === 'ENOENT' ? "the GitHub CLI (gh) isn't installed; the Roost installer installs it." : scrub(e && e.message);
      this._set(id, { state: 'notConnected', reason: `${server.name} couldn't be downloaded: ${why}` });
      return false;
    }
    if (this.disposed) return false;
    if (auth.code !== 0) { this._set(id, { state: 'notConnected', reason: GITHUB_FIRST, action: 'githubSignIn' }); return false; }
    this._set(id, { state: 'connecting', reason: `Downloading ${asset}…` });
    let dir = '';
    try {
      dir = fs.mkdtempSync(path.join(this.tmpDir, 'roost-install-'));
      const tmp = path.join(dir, asset);
      // no tag: gh downloads from the latest release (`gh release download --help`)
      const argv = ['gh', 'release', 'download', ...(gh.tag === 'latest' ? [] : [gh.tag]), '--repo', gh.repo, '--pattern', asset, '--output', tmp];
      let r;
      try {
        r = await this.run(argv, { timeoutMs: DOWNLOAD_MS });
      } catch (e) {
        throw new Error(scrub(e && e.message));
      }
      if (r.code !== 0) throw new Error(scrub(lastLine(r.stderr)) || `gh exited with code ${r.code}`);
      if (!fs.existsSync(tmp)) throw new Error('gh gave no file');
      this._place(tmp, inst.to);
    } catch (e) {
      if (!this.disposed) this._set(id, { state: 'notConnected', reason: `The download of ${server.name} failed: ${scrub(e && e.message)}` });
      return false;
    } finally {
      if (dir) fs.rmSync(dir, { recursive: true, force: true });
    }
    if (this.disposed) return false;
    this._set(id, { reason: '' });
    return true;
  }

  // The downloaded file to `to`: copied beside it first (the temp dir may be another disk), then renamed over it.
  _place(tmp, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    const next = `${to}.${process.pid}-${Date.now()}.tmp`;
    try {
      fs.copyFileSync(tmp, next);
      fs.chmodSync(next, 0o755);
      fs.renameSync(next, to);
    } catch (e) {
      try { fs.unlinkSync(next); } catch (_) { /* never made */ }
      throw e;
    }
  }

  async _checkAndRegister(id) {
    const server = this._server(id);
    this._set(id, { state: 'checking', reason: '', prompt: null });
    const c = server.connect;
    const token = c.kind === 'tokenPage' ? this._readToken(id) : '';
    let failed;
    if (c.kind === 'command' && c.doneWhen && !fs.existsSync(c.doneWhen.file)) {
      // nothing to check before the first sign-in: the check's own error would tell the user to run the sign-in
      // command, which this row's button does
      failed = NOT_SIGNED_IN;
    } else if (c.check) {
      failed = c.kind === 'tokenPage' && !token ? NO_TOKEN : await this._runCheck(server, token);
    } else if (c.kind === 'tokenPage') {
      failed = token ? null : NO_TOKEN;
    } else {
      failed = null;
    }
    if (this.disposed) return { ...this._row(id) };
    if (failed) return this._set(id, { state: 'notConnected', reason: failed, notYet: failed === NOT_SIGNED_IN || failed === NO_TOKEN });
    return this._passed(server, token);
  }

  // A row that passes is registered with Claude Code; a different entry of the same name waits for Replace, unless it
  // is the one Roost wrote with the token this one replaces.
  _passed(server, token, previousToken) {
    let outcome;
    try {
      const previous = previousToken === undefined ? undefined : registration(server, { token: previousToken });
      outcome = register(this.claudeJson, server.id, registration(server, { token }), { previous });
    } catch (e) {
      return this._set(server.id, { state: 'notConnected', signedIn: true, prompt: null, conflict: false,
        reason: `Signed in, but Claude Code wasn't given this server: ${e.message}` });
    }
    if (outcome === 'conflict') {
      return this._set(server.id, { state: 'notConnected', signedIn: true, prompt: null, conflict: true,
        reason: `Signed in, but Claude Code already has a different server named ${server.id}.` });
    }
    return this._set(server.id, { state: 'connected', signedIn: true, reason: '', prompt: null, conflict: false });
  }

  /** null when the check passes, else why it failed. */
  async _runCheck(server, token) {
    const check = server.connect.check;
    try {
      if (check.kind === 'request') return await this._request(server, check, token);
      if (check.kind === 'mcpTool') return await this._mcpCheck(server, check);
      if (check.kind === 'command') return await this._commandCheck(check);
      return `unknown check ${check.kind}`;
    } catch (e) {
      return e && e.message ? e.message : String(e);
    }
  }

  async _request(server, check, token) {
    const headers = server.register.type === 'http' ? { ...registration(server, { token }).headers } : {};
    let body;
    if (check.body === 'initialize') {
      headers['Content-Type'] = 'application/json';
      headers.Accept = 'application/json, text/event-stream';
      body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize',
        params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'roost' } } });
    } else if (check.body) {
      body = check.body;
    }
    const init = { method: check.method, headers };
    if (body !== undefined) init.body = body;
    if (typeof AbortSignal !== 'undefined' && AbortSignal.timeout) init.signal = AbortSignal.timeout(CHECK_MS);
    let res;
    try {
      res = await this.fetch(check.url, init);
    } catch (e) {
      if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) return `no answer in ${CHECK_MS / 1000} s`;
      const cause = e && e.cause && e.cause.message;
      return cause ? `${e.message}: ${cause}` : (e && e.message) || String(e);
    }
    if (res.body && typeof res.body.cancel === 'function') { try { res.body.cancel(); } catch (_) { /* done */ } }
    return res.status >= 200 && res.status < 300 ? null : `HTTP ${res.status}`;
  }

  async _mcpCheck(server, check) {
    if (server.register.type !== 'stdio') return `${check.tool} can't be called: the server isn't started by a command`;
    const client = this._client(server, CHECK_MS);
    try {
      await client.start();
      const r = await client.callTool(check.tool, check.args, { timeoutMs: CHECK_MS });
      return r.isError ? (r.text.trim() || `${check.tool} failed`) : null;
    } finally {
      this._closeClient(client);
    }
  }

  async _commandCheck(check) {
    let r;
    try {
      r = await this.run(check.argv.slice(), { timeoutMs: CHECK_MS });
    } catch (e) {
      if (e && e.code === 'ENOENT') return `${check.argv[0]} not found`;
      throw e;
    }
    if (r.code === 0) return null;
    return lastLine(r.stderr) || `${path.basename(check.argv[0])} exited with code ${r.code}`;
  }
}

module.exports = { Tools, promptOf, platformKey, scrub, TOKEN_DIR, COMMAND_WAIT_HINT, GITHUB_FIRST, NOT_INSTALLED };
