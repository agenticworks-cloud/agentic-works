'use strict';
// VS Code has no way to read a context key back, so Roost watches the parts' setContext calls: it wraps
// commands.executeCommand (the parts share Roost's vscode object) and, for a setContext of one of `keys`, records the
// value and tells the listeners, then passes the call on unchanged, its result or rejection included. Every other
// call goes straight through. The value is the one sent, whether or not VS Code then applies it. dispose puts the
// original back only if the wrapper is still in place (something wrapped after it is left as it is). Where the
// function cannot be replaced, that is logged and the watcher knows no key.
const errorText = (e) => (e && e.stack) || String(e);

function watchContexts(commands, keys, { log = () => {} } = {}) {
  const watched = new Set(keys);
  const values = new Map();
  const listeners = new Set();
  const original = commands.executeCommand;
  const note = (key, value) => {
    values.set(key, value);
    for (const fn of [...listeners]) {
      try {
        fn(key, value);
      } catch (err) {
        log(`Roost: a listener on context key ${key} threw: ${errorText(err)}`);
      }
    }
  };
  function wrapper(id, ...args) {
    if (id === 'setContext' && watched.has(args[0])) note(args[0], args[1]);
    return original.call(this, id, ...args);
  }
  let wrapped = false;   // false: nothing is ever noted, so get is always undefined
  try {
    commands.executeCommand = wrapper;
    wrapped = commands.executeCommand === wrapper;
    if (!wrapped) throw new Error('executeCommand could not be replaced');
  } catch (err) {
    log(`Roost cannot watch the parts' context keys: ${errorText(err)}`);
  }
  return {
    get: (key) => values.get(key),
    onChange(fn) {
      listeners.add(fn);
      return { dispose: () => { listeners.delete(fn); } };
    },
    dispose() {
      listeners.clear();
      if (wrapped && commands.executeCommand === wrapper) commands.executeCommand = original;
    },
  };
}

module.exports = { watchContexts };
