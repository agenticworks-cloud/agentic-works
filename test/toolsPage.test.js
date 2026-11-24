'use strict';
// The Connect Your Tools page, run in a DOM (jsdom from parts/agents) and driven as the host drives it.
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require(require.resolve('jsdom', { paths: [path.join(root, 'parts', 'agents')] }));
const { getToolsHtml } = require(path.join(root, 'src', 'toolsPage'));

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => { console.error('PAGE SCRIPT ERROR:', (e.detail && e.detail.message) || e.message); process.exitCode = 1; });
const raw = getToolsHtml({ nonce: 'n', cspSource: 'x' });
assert(/Content-Security-Policy[^>]*script-src 'nonce-n'/.test(raw), 'its script runs by nonce only');
const html = raw.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
const out = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => out.push(JSON.parse(JSON.stringify(m))) }); } });
const w = dom.window, d = w.document;
const host = (m) => w.dispatchEvent(new w.MessageEvent('message', { data: m }));
const tool = (id) => d.querySelector(`.tool[data-id="${id}"]`);
const shown = (el) => { for (let e = el; e && e !== d.body; e = e.parentElement) if (e.hidden) return false; return true; };
const button = (id, text) => [...tool(id).querySelectorAll('button')].find((b) => b.textContent === text && shown(b));
const stateOf = (id) => tool(id).querySelector('.state').textContent;
const row = (o) => Object.assign({ id: 'x', name: 'X', about: '', kind: 'none', page: '', state: 'unknown', reason: '', prompt: null, conflict: false, signedIn: false }, o);

assert.deepStrictEqual(out, [{ type: 'ready' }], 'the page asks for its rows');
assert.strictEqual(d.title, 'Connect Your Tools');

const docs = row({ id: 'docs', name: 'Example Docs', about: 'the docs', kind: 'tokenPage', page: 'https://mcp.example.com/token', state: 'notConnected', reason: 'HTTP 401' });
const mail = row({ id: 'mail', name: 'Example Mail', about: 'mail', kind: 'mcpTool', state: 'connecting',
  prompt: { text: 'Open https://login.example.com/device and enter code: ABCD-1234', url: 'https://login.example.com/device', code: 'ABCD-1234' } });
const tickets = row({ id: 'tickets', name: 'Example Tickets', about: 'tickets', kind: 'command', state: 'connected', signedIn: true });
host({ type: 'rows', rows: [docs, mail, tickets] });

// one row per server: its name, about and state
assert.deepStrictEqual([...d.querySelectorAll('.tool')].map((t) => t.dataset.id), ['docs', 'mail', 'tickets']);
assert.strictEqual(tool('docs').querySelector('.name').textContent, 'Example Docs');
assert.strictEqual(tool('docs').querySelector('.about').textContent, 'the docs');
assert.strictEqual(stateOf('docs'), 'Not connected: HTTP 401');
assert.strictEqual(stateOf('tickets'), 'Connected');
assert.strictEqual(stateOf('mail'), 'Connecting…');

// tokenPage: Open the page, then the token and Check and save (trimmed); no Connect
assert.ok(button('docs', 'Open the page'));
assert.strictEqual(button('docs', 'Connect'), undefined, 'a tokenPage row has no Connect');
button('docs', 'Open the page').click();
assert.deepStrictEqual(out.pop(), { type: 'openPage', id: 'docs' });
const field = tool('docs').querySelector('input');
assert.strictEqual(field.type, 'password');
field.value = ' t ';
button('docs', 'Check and save').click();
assert.deepStrictEqual(out.pop(), { type: 'token', id: 'docs', token: 't' });
assert.strictEqual(field.value, '', 'the field is cleared once sent');

// a token being typed survives another row's update
field.value = 'half';
host({ type: 'rows', rows: [docs, { ...mail, state: 'checking', prompt: null }, tickets] });
assert.strictEqual(tool('docs').querySelector('input').value, 'half');
assert.strictEqual(stateOf('mail'), 'Checking…');
field.value = '';

// mcpTool with a prompt: its text and Copy code and open
host({ type: 'rows', rows: [docs, mail, tickets] });
assert.strictEqual(tool('mail').querySelector('.prompt').textContent, mail.prompt.text);
assert.ok(shown(tool('mail').querySelector('.prompt')));
button('mail', 'Copy code and open').click();
assert.deepStrictEqual(out.pop(), { type: 'copyAndOpen', id: 'mail' });
// a URL alone: Open; a code alone: Copy code
host({ type: 'rows', rows: [{ ...mail, prompt: { text: 'Go to https://login.example.com/device', url: 'https://login.example.com/device', code: '' } }] });
assert.ok(button('mail', 'Open'));
assert.strictEqual(button('mail', 'Copy code and open'), undefined);
host({ type: 'rows', rows: [{ ...mail, prompt: { text: 'Enter code: ABCD-1234', url: '', code: 'ABCD-1234' } }] });
assert.ok(button('mail', 'Copy code'));
button('mail', 'Copy code').click();
assert.deepStrictEqual(out.pop(), { type: 'copyAndOpen', id: 'mail' });
assert.deepStrictEqual([...d.querySelectorAll('.tool')].map((t) => t.dataset.id), ['mail'], 'rows gone from the list are removed');

// command, mcpTool and none: Connect (not while busy)
host({ type: 'rows', rows: [{ ...mail, state: 'notConnected', reason: 'login failed', prompt: null }, { ...tickets, state: 'notConnected', reason: "The sign-in didn't finish." }, row({ id: 'wiki', kind: 'none' })] });
assert.strictEqual(shown(tool('mail').querySelector('.prompt')), false, 'no prompt: none shown');
for (const id of ['mail', 'tickets', 'wiki']) {
  button(id, 'Connect').click();
  assert.deepStrictEqual(out.pop(), { type: 'connect', id });
}
host({ type: 'rows', rows: [{ ...tickets, state: 'connecting' }] });
assert.strictEqual(button('tickets', 'Connect').disabled, true, 'busy: the button waits');
assert.strictEqual(stateOf('tickets'), 'Connecting…');
host({ type: 'rows', rows: [{ ...tickets, state: 'connecting', reason: 'If the sign-in failed, close its terminal to try again.' }] });
assert.strictEqual(stateOf('tickets'), 'Connecting… If the sign-in failed, close its terminal to try again.', 'a command sign-in waiting: the hint on the row');

// signed in, but not registered: said so, distinctly
host({ type: 'rows', rows: [{ ...tickets, state: 'notConnected', signedIn: true, reason: "Claude Code's settings weren't changed: EACCES" }] });
assert.strictEqual(stateOf('tickets'), "Signed in, but couldn't register: Claude Code's settings weren't changed: EACCES");

// a conflict: the note and Replace
assert.strictEqual(button('tickets', 'Replace'), undefined, 'no conflict: no Replace');
host({ type: 'rows', rows: [{ ...tickets, state: 'notConnected', signedIn: true, conflict: true, reason: 'Signed in, but Claude Code already has a different server named tickets.' }] });
assert.ok(tool('tickets').textContent.includes('Claude Code already has a server named tickets'));
assert.ok(stateOf('tickets').startsWith('Signed in, but'), stateOf('tickets'));
button('tickets', 'Replace').click();
assert.deepStrictEqual(out.pop(), { type: 'replace', id: 'tickets' });

// a download that needs GitHub's sign-in: said on the row, with Sign In to GitHub; no button otherwise
assert.strictEqual(button('tickets', 'Sign In to GitHub'), undefined);
host({ type: 'rows', rows: [{ ...tickets, state: 'notConnected', signedIn: false, reason: 'Sign in to GitHub first.', action: 'githubSignIn' }] });
assert.strictEqual(stateOf('tickets'), 'Not connected: Sign in to GitHub first.');
button('tickets', 'Sign In to GitHub').click();
assert.deepStrictEqual(out.pop(), { type: 'githubSignIn', id: 'tickets' });
host({ type: 'rows', rows: [{ ...tickets, state: 'connecting', reason: 'Downloading example-mcp…', action: '' }] });
assert.strictEqual(button('tickets', 'Sign In to GitHub'), undefined, 'gone once the row moves on');
assert.strictEqual(stateOf('tickets'), 'Connecting… Downloading example-mcp…');

// names from the company file are text, never markup
host({ type: 'rows', rows: [row({ id: 'odd', name: '<img src=x onerror=alert(1)>', about: '<b>bold</b>' })] });
assert.strictEqual(tool('odd').querySelector('img'), null);
assert.strictEqual(tool('odd').querySelector('.name').textContent, '<img src=x onerror=alert(1)>');

// no rows
host({ type: 'rows', rows: [] });
assert.ok(shown(d.getElementById('empty')));

console.log('toolsPage.test.js passed');
