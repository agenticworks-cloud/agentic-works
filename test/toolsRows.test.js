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

console.log('toolsRows.test.js passed');
