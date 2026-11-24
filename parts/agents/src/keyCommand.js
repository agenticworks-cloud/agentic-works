'use strict';
// A company gateway's key helper (company.json's gateway.keyCommand): a program that prints a fresh key on stdout and
// nothing else, progress and errors on stderr; exit 0 with a key, 2 when the person didn't finish signing in, anything
// else a failure. It is run here, in the process that checks and saves the key, so the key never leaves it: argv and
// no shell, stdin closed, a timeout (a sign-in window may be open), stdout capped. The answer is the key, or a reason
// fit for the page: the helper's last stderr line with anything key-shaped masked, one line, at most 200 characters.
// Neither the key nor stdout is ever in a reason. (Design: docs/notes/101-roost.md, "A key helper for the company
// gateway".)
const { spawn } = require('node:child_process');

const TIMEOUT_MS = 12 * 60e3;
const MAX_STDOUT = 64 * 1024;
const MAX_STDERR = 64 * 1024;
const MAX_REASON = 200;
const PREFIX = "Couldn't get a key automatically:";
const TEXT = {
  signIn: "The sign-in wasn't completed.",
  missing: "The key helper isn't installed.",
  timeout: 'That took too long.',
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
 * Run the key helper. Resolves `{ ok: true, key }` or `{ ok: false, text }`; never rejects.
 * @param {string[]} argv the program (absolute) and its arguments
 * @param {{ timeoutMs?: number, env?: object, cwd?: string }} [o]
 */
function runKeyCommand(argv, { timeoutMs = TIMEOUT_MS, env = process.env, cwd } = {}) {
  return new Promise((resolve) => {
    let child, done = false, out = [], outLen = 0, err = '', timedOut = false, tooMuch = false, timer = null, killer = null;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer); clearTimeout(killer);
      out = [];   // stdout is held no longer than needed
      resolve(r);
    };
    const stop = () => {
      try { child.kill('SIGTERM'); } catch (_) { /* gone */ }
      killer = setTimeout(() => { try { child.kill('SIGKILL'); } catch (_) { /* gone */ } }, 2000);
      if (killer.unref) killer.unref();
    };
    if (!Array.isArray(argv) || !argv.length || typeof argv[0] !== 'string' || !argv[0]) { finish({ ok: false, text: TEXT.missing }); return; }
    try {
      child = spawn(argv[0], argv.slice(1), { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env, cwd, windowsHide: true });
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
    child.stderr.on('data', (b) => { err = (err + b.toString('utf8')).slice(-MAX_STDERR); });
    child.on('error', (e) => {
      // only the code: a spawn error's message names the program, nothing else, but keep to the known words
      if (e && e.code === 'ENOENT') finish({ ok: false, text: TEXT.missing });
      else finish(failed(e && e.code ? `the key helper could not be started (${e.code}).` : 'the key helper could not be started.'));
    });
    child.on('close', (code, signal) => {
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
    });
    timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
  });
}

module.exports = { runKeyCommand, maskReason, TIMEOUT_MS, TEXT, PREFIX };
