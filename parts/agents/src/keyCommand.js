'use strict';
// A company gateway's key helper (company.json's gateway.keyCommand): a program that prints a fresh key on stdout and
// nothing else, progress and errors on stderr; exit 0 with a key, 2 when the person didn't finish signing in, anything
// else a failure. It is run here, in the process that checks and saves the key, so the key never leaves it: argv and
// no shell, stdin closed, a timeout (a sign-in window may be open), stdout capped. The answer is the key, or a reason
// fit for the page: the helper's last stderr line with anything key-shaped masked, one line, at most 200 characters.
// Neither the key nor stdout is ever in a reason. (Design: docs/notes/101-agentic-works.md, "A key helper for the company
// gateway".)
const { spawn } = require('node:child_process');

const TIMEOUT_MS = 12 * 60e3;
const MAX_STDOUT = 64 * 1024;
const MAX_STDERR = 64 * 1024;
const MAX_REASON = 200;
const DRAIN_MS = 200;        // after the helper exits, how long its output may still arrive
const KILL_GRACE_MS = 2000;  // from SIGTERM to SIGKILL
const PREFIX = "Couldn't get a key automatically:";
const TEXT = {
  signIn: "The sign-in wasn't completed.",
  missing: "The key helper isn't installed.",
  timeout: 'That took too long.',
  cancelled: 'Cancelled.',
};

/** A stderr line made safe for the page: key-shaped words masked (sk-…, any run of 20 or more), one line, ≤200. */
function maskReason(line) {
  let s = String(line || '').replace(/[\r\n\t]+/g, ' ').trim();
  s = s.replace(/(?<![A-Za-z0-9])sk-[^\s"'`()<>[\]{},;]*/g, '…').replace(/[^\s"'`()<>[\]{},;]{20,}/g, '…');
  return s.length > MAX_REASON ? s.slice(0, MAX_REASON - 1) + '…' : s;
}

/** The last non-empty line of stderr. */
function lastLine(stderr) {
  const lines = String(stderr || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length ? lines[lines.length - 1] : '';
}

const failed = (reason) => ({ ok: false, text: `${PREFIX} ${maskReason(reason) || 'the key helper gave no reason.'}` });

/**
 * Run the key helper. Resolves `{ ok: true, key }` or `{ ok: false, text }` (with `cancelled: true` when `signal` was
 * aborted); never rejects. `onProgress` gets each line the helper writes to stderr as it comes, without a leading
 * `name: ` and masked as a reason is, so a page can say what the helper is doing (signing in, a window open).
 * @param {string[]} argv the program (absolute) and its arguments
 * @param {{ timeoutMs?: number, env?: object, cwd?: string, drainMs?: number, killGraceMs?: number, signal?: AbortSignal, onProgress?: (line: string) => void }} [o]
 */
function runKeyCommand(argv, { timeoutMs = TIMEOUT_MS, env = process.env, cwd, drainMs = DRAIN_MS, killGraceMs = KILL_GRACE_MS, signal, onProgress } = {}) {
  return new Promise((resolve) => {
    let child, done = false, out = [], outLen = 0, err = '', partial = '', timedOut = false, tooMuch = false, exited = false;
    const timers = [];
    const later = (ms, f) => { const t = setTimeout(f, ms); timers.push(t); return t; };
    // the helper's whole process group (it runs detached, as a group of its own): a browser or a refresher it left
    // behind goes with it. Windows has no process groups: the helper alone.
    const signalGroup = (sig) => {
      if (!child || !child.pid) return;
      try {
        if (process.platform === 'win32') child.kill(sig);
        else process.kill(-child.pid, sig);
      } catch (_) { /* gone */ }
    };
    const finish = (r) => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', cancelled);
      for (const t of timers) clearTimeout(t);
      out = [];   // stdout is held no longer than needed
      // a leftover child may hold the pipes open: they are let go, and what is left of the group is stopped
      if (child) {
        for (const p of [child.stdout, child.stderr]) { try { p.destroy(); } catch (_) { /* gone */ } }
        signalGroup('SIGTERM');
        const k = setTimeout(() => signalGroup('SIGKILL'), killGraceMs);
        if (k.unref) k.unref();
        if (child.unref) child.unref();
      }
      resolve(r);
    };
    const stop = () => {
      signalGroup('SIGTERM');
      later(killGraceMs, () => {
        signalGroup('SIGKILL');
        // a helper that does not end even then: answered anyway
        later(drainMs, () => settle(null, 'SIGKILL'));
      });
    };
    const settle = (code, signal) => {
      if (timedOut) { finish({ ok: false, text: TEXT.timeout }); return; }
      if (tooMuch) { finish(failed('the key helper printed more than a key.')); return; }
      if (code === 0) {
        const key = Buffer.concat(out).toString('utf8').trim();
        if (!key) { finish(failed(lastLine(err) || 'the key helper printed no key.')); return; }
        finish({ ok: true, key });
        return;
      }
      if (code === 2) { finish({ ok: false, text: TEXT.signIn }); return; }
      finish(failed(lastLine(err) || (signal ? `the key helper was stopped (${signal}).` : `the key helper exited with code ${code}.`)));
    };
    const cancelled = () => finish({ ok: false, cancelled: true, text: TEXT.cancelled });
    if (signal && signal.aborted) { cancelled(); return; }
    if (signal) signal.addEventListener('abort', cancelled, { once: true });
    if (!Array.isArray(argv) || !argv.length || typeof argv[0] !== 'string' || !argv[0]) { finish({ ok: false, text: TEXT.missing }); return; }
    try {
      child = spawn(argv[0], argv.slice(1), { shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env, cwd, windowsHide: true });
    } catch (e) {
      finish(e && e.code === 'ENOENT' ? { ok: false, text: TEXT.missing } : failed(e && e.code ? `the key helper could not be started (${e.code}).` : 'the key helper could not be started.'));
      return;
    }
    child.stdout.on('data', (b) => {
      if (tooMuch) return;
      outLen += b.length;
      if (outLen > MAX_STDOUT) { tooMuch = true; out = []; stop(); return; }
      out.push(b);
    });
    child.stderr.on('data', (b) => {
      const text = b.toString('utf8');
      err = (err + text).slice(-MAX_STDERR);
      if (!onProgress) return;
      const lines = (partial + text).split(/\r?\n/);
      partial = lines.pop().slice(-MAX_STDERR);
      for (const l of lines) {
        const line = maskReason(l.replace(/^\s*[A-Za-z0-9._-]+:\s+(?=\S)/, ''));
        if (line && !done) { try { onProgress(line); } catch (_) { /* the page's trouble, not the run's */ } }
      }
    });
    child.on('error', (e) => {
      // only the code: a spawn error's message names the program, nothing else, but keep to the known words
      if (e && e.code === 'ENOENT') finish({ ok: false, text: TEXT.missing });
      else finish(failed(e && e.code ? `the key helper could not be started (${e.code}).` : 'the key helper could not be started.'));
    });
    // the answer is the helper's exit, not its pipes' close (a child it left may hold them): its output is drained for
    // a moment, or until the pipes close if that is sooner
    child.on('exit', (code, signal) => {
      exited = true;
      later(drainMs, () => settle(code, signal));
      child.on('close', () => settle(code, signal));
    });
    later(timeoutMs, () => { if (!exited) { timedOut = true; stop(); } });
  });
}

module.exports = { runKeyCommand, maskReason, TIMEOUT_MS, TEXT, PREFIX };
