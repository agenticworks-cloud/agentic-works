'use strict';
// GitHub's sign-in without a terminal (0.5.18; Sean, 2026-11-25: "do we have to use the terminal?"). gh's own device
// sign-in, run with no terminal and no input, asks nothing: it prints a one-time code and GitHub's device page, then
// waits until the code is approved there. The code is read from its output for the page (Copy code & open), and once
// gh is done `gh auth setup-git` makes git use the sign-in over HTTPS (the "Authenticate Git with your GitHub
// credentials?" question, answered yes). gh keeps the token; it is never read, logged or shown here.
//
// run() resolves to { ok: true, gitSetUp }, { ok: false, error } or { ok: false, cancelled: true }; state.phase is
// starting → code → finishing → done (or failed, cancelled), and onUpdate hears each change.

const DEVICE_URL = 'https://github.com/login/device';
const LOGIN_ARGS = ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'];
const SETUP_GIT_ARGS = ['auth', 'setup-git', '--hostname', 'github.com'];
const LIMIT_MS = 16 * 60 * 1000;   // GitHub's device codes last 15 minutes
const OUTPUT_MAX = 64 * 1024;
const CODE = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/;
const PAGE = /https:\/\/github\.com\/login\/device\b[^\s]*/;
const NO_GH = "gh isn't installed. Install it from https://cli.github.com, or let the Roost installer install it.";

// gh's output → { userCode, verificationUri } once the code is in it; only GitHub's own device page is taken
function parseDevice(text) {
  const c = CODE.exec(text || '');
  if (!c) return null;
  const p = PAGE.exec(text);
  return { userCode: c[1], verificationUri: p ? p[0] : DEVICE_URL };
}

// gh's last line worth showing: not the code's lines, not blank
function lastLine(text) {
  const lines = String(text || '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !CODE.test(l) && !/github\.com\/login\/device/.test(l));
  return lines.length ? lines[lines.length - 1].slice(0, 300) : '';
}

class GithubSignIn {
  // `spawn`: child_process.spawn (a fake in tests); `onUpdate(state)`: each phase change; `limitMs`: the code's life
  constructor({ spawn, onUpdate = () => {}, limitMs = LIMIT_MS, env = process.env } = {}) {
    this.spawn = spawn;
    this.onUpdate = onUpdate;
    this.limitMs = limitMs;
    this.env = env;
    this.state = { phase: 'starting', code: null };
    this.done = null;
    this.child = null;
    this.cancelled = false;
    this.expired = false;
  }

  set(phase, code = null) {
    this.state = { phase, code };
    try { this.onUpdate(this.state); } catch { /* a listener's error is its own */ }
  }

  run() {
    if (!this.done) this.done = this.signIn();
    return this.done;
  }

  cancel() {
    if (this.cancelled || !this.child || ['done', 'failed', 'cancelled'].includes(this.state.phase)) return;
    this.cancelled = true;
    this.child.kill();
  }

  // gh with argv (no shell), no terminal and no input; resolves to { code, signal, output, error }
  exec(args) {
    return new Promise((resolve) => {
      let child;
      try {
        // GH_PROMPT_DISABLED: gh never waits on a question; GH_BROWSER: gh opens nothing itself (the page's button does)
        child = this.spawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...this.env, GH_PROMPT_DISABLED: '1', GH_BROWSER: 'true' } });
      } catch (err) {
        resolve({ code: null, output: '', error: err });
        return;
      }
      this.child = child;
      let output = '';
      let error = null;
      const read = (b) => {
        if (output.length < OUTPUT_MAX) output += String(b);
        if (args === LOGIN_ARGS && this.state.phase === 'starting') {
          const code = parseDevice(output);
          if (code) this.set('code', code);
        }
      };
      if (child.stdout) child.stdout.on('data', read);
      if (child.stderr) child.stderr.on('data', read);
      child.on('error', (err) => { error = err; });
      child.on('close', (code, signal) => resolve({ code, signal, output, error }));
    });
  }

  async signIn() {
    const timer = setTimeout(() => { this.expired = true; if (this.child) this.child.kill(); }, this.limitMs);
    if (timer.unref) timer.unref();   // nothing else waits on it: it never keeps a process alive by itself
    let r;
    try {
      r = await this.exec(LOGIN_ARGS);
    } finally {
      clearTimeout(timer);
    }
    if (this.cancelled) { this.set('cancelled'); return { ok: false, cancelled: true }; }
    if (r.code !== 0) {
      let error;
      if (this.expired) error = 'The code expired before GitHub had it. Try again.';
      else if (r.error && r.error.code === 'ENOENT') error = NO_GH;
      else if (r.error && r.code === null && !r.output) error = `GitHub's sign-in couldn't start: ${r.error.message}`;
      else {
        const why = lastLine(r.output);
        error = why ? `GitHub's sign-in didn't finish: ${why}` : `GitHub's sign-in didn't finish (gh exited with ${r.code}).`;
      }
      this.set('failed');
      return { ok: false, error };
    }
    this.set('finishing');
    const git = await this.exec(SETUP_GIT_ARGS);
    this.set('done');
    return { ok: true, gitSetUp: git.code === 0 };
  }
}

module.exports = { GithubSignIn, parseDevice, LOGIN_ARGS, SETUP_GIT_ARGS, DEVICE_URL, NO_GH };
