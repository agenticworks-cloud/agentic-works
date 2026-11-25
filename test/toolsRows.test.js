'use strict';
// The tools rows script alone, two lists on one page (as the Get started page and the tools page will each hold one).
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require(require.resolve('jsdom', { paths: [path.join(root, 'parts', 'agents')] }));
const { TOOLS_ROWS_CSS, toolsRowsScript } = require(path.join(root, 'src', 'toolsRows'));

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => { console.error('PAGE SCRIPT ERROR:', (e.detail && e.detail.message) || e.message); process.exitCode = 1; });
const html = `<!DOCTYPE html><html><head><style>${TOOLS_ROWS_CSS}</style></head><body><div id="a"></div><div id="b"></div><script>${toolsRowsScript()}</script></body></html>`;
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole });
const w = dom.window, d = w.document;
const row = (o) => Object.assign({ id: 'x', name: 'X', about: '', kind: 'none', page: '', state: 'unknown', reason: '', prompt: null, conflict: false, signedIn: false }, o);
const docs = row({ id: 'docs', name: 'Example Docs', kind: 'tokenPage', state: 'notConnected' });
const mail = row({ id: 'mail', name: 'Example Mail', kind: 'mcpTool', state: 'connecting',
  prompt: { text: 'Enter code: ABCD-1234', url: 'https://login.example.com/device', code: 'ABCD-1234' } });

const out = [];
const post = (type, id, extra) => out.push([type, id, extra]);
const a = new w.ToolsList(d.getElementById('a'), post);
const b = new w.ToolsList(d.getElementById('b'), post);
a.show([docs, mail]);
b.show([mail]);

assert.strictEqual(d.querySelectorAll('#a .tool').length, 2);
assert.strictEqual(d.querySelectorAll('#b .tool').length, 1);

[...d.querySelectorAll('#b button')].find((x) => x.textContent === 'Copy code and open').click();
assert.deepStrictEqual(out.pop(), ['copyAndOpen', 'mail', undefined]);

const field = d.querySelector('#a .tool[data-id="docs"] input');
field.value = 'half';
a.show([docs, mail]);
assert.strictEqual(d.querySelector('#a .tool[data-id="docs"] input').value, 'half', 'a token being typed survives');
assert.strictEqual(d.querySelector('#a .tool[data-id="docs"] input'), field, 'the same element');

// a command row's button: the company file's label, else Connect
{
  const c = d.createElement('div'); d.body.appendChild(c);
  const l = new w.ToolsList(c, post);
  l.show([row({ id: 't1', kind: 'command', button: 'Sign in with Example' }), row({ id: 't2', kind: 'command' })]);
  const label = (id) => [...c.querySelectorAll(`.tool[data-id="${id}"] button`)].map((x) => x.textContent);
  assert.ok(label('t1').includes('Sign in with Example') && !label('t1').includes('Connect'));
  assert.ok(label('t2').includes('Connect'));
  [...c.querySelectorAll('.tool[data-id="t1"] button')].find((x) => x.textContent === 'Sign in with Example').click();
  assert.deepStrictEqual(out.pop(), ['connect', 't1', undefined]);
}

// nothing tried yet: the reason alone, not shown as a fault; a failed check: "Not connected: ..." in red
{
  const c = d.createElement('div'); d.body.appendChild(c);
  const l = new w.ToolsList(c, post);
  l.show([row({ id: 'n1', kind: 'command', state: 'notConnected', reason: 'Not signed in yet.', notYet: true }),
    row({ id: 'n2', kind: 'command', state: 'notConnected', reason: 'token expired' })]);
  const st = (id) => c.querySelector(`.tool[data-id="${id}"] .state`);
  assert.strictEqual(st('n1').textContent, 'Not signed in yet.');
  assert.ok(!st('n1').classList.contains('bad'));
  assert.strictEqual(st('n2').textContent, 'Not connected: token expired');
  assert.ok(st('n2').classList.contains('bad'));
}

console.log('toolsRows.test.js passed');
