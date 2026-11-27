'use strict';
// A fake child_process.spawn for gh (Agentic Works' spawnGh option): each call makes a child the test drives (out, err,
// exit, fail); every call is recorded. Nothing runs the machine's own gh.
const { EventEmitter } = require('node:events');

function fakeSpawn() {
  const calls = [];
  const spawn = (cmd, args, opts) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.killed = false;
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    child.out = (t) => child.stdout.emit('data', Buffer.from(t));
    child.err = (t) => child.stderr.emit('data', Buffer.from(t));
    child.exit = (code) => child.emit('close', code, null);
    child.fail = (code) => { const e = new Error(`spawn ${cmd} ${code}`); e.code = code; child.emit('error', e); };
    calls.push({ cmd, args, opts, child });
    return child;
  };
  return { spawn, calls };
}

const CODE_TEXT = '\n! First copy your one-time code: AB12-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n';

module.exports = { fakeSpawn, CODE_TEXT };
