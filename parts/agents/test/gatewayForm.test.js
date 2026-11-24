'use strict';
// The page of Agents: Set Up a Gateway…, run in a DOM and driven as the host drives it.
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { getGatewayFormHtml } = require('../src/gatewayForm');

const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', (e) => { console.error('PAGE SCRIPT ERROR:', (e.detail && e.detail.message) || e.message); process.exitCode = 1; });
const html = getGatewayFormHtml({ nonce: 'n', cspSource: 'x' }).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
const out = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => out.push(JSON.parse(JSON.stringify(m))) }); } });
const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);
const host = (m) => w.dispatchEvent(new w.MessageEvent('message', { data: m }));
const submit = () => $('form').dispatchEvent(new w.Event('submit', { cancelable: true }));
const models = (o) => Object.assign({ ANTHROPIC_MODEL: '', ANTHROPIC_DEFAULT_OPUS_MODEL: '', ANTHROPIC_DEFAULT_SONNET_MODEL: '', ANTHROPIC_DEFAULT_HAIKU_MODEL: '' }, o);

assert.deepStrictEqual(out, [{ type: 'ready' }], 'the page asks for the file');
assert.strictEqual($('models').open, false, 'the model names start collapsed');

// no file: a token box to fill in
host({ type: 'state', state: { file: '/home/u/.config/gateway-claude/env', exists: false, ok: false, baseUrl: '', tokenSet: false, models: models() } });
assert.deepStrictEqual([$('file').textContent, $('tokenSet').hidden, $('token').hidden, $('saved').hidden], ['/home/u/.config/gateway-claude/env', true, false, true]);
$('baseUrl').value = ' https://gw.example.com '; $('token').value = 'sk-1'; $('ANTHROPIC_MODEL').value = 'router[1m]';
submit();
assert.deepStrictEqual(out.pop(), { type: 'save', baseUrl: 'https://gw.example.com', token: 'sk-1', models: models({ ANTHROPIC_MODEL: 'router[1m]' }), force: false });
assert.deepStrictEqual([d.querySelector('h1').textContent, $('save').textContent, $('baseUrl').hidden, $('models').hidden, $('getKey').hidden], ['Set up an LLM gateway', 'Check and save', false, false, true], 'no company gateway: today\'s fields');
host({ type: 'error', text: 'A token is needed.' });
assert.deepStrictEqual([$('error').textContent, $('saved').hidden], ['A token is needed.', true], 'what is wrong, on the page');

// saved: the box with its button; the token box empties, and shows the token as set
host({ type: 'saved', state: { file: '/f', exists: true, ok: true, baseUrl: 'https://gw.example.com', tokenSet: true, models: models({ ANTHROPIC_MODEL: 'router[1m]' }) } });
assert.deepStrictEqual([$('error').textContent, $('saved').hidden, $('tokenSet').hidden, $('token').hidden, $('token').value, $('ANTHROPIC_MODEL').value], ['', false, false, true, '', 'router[1m]']);
$('newTab').click(); assert.deepStrictEqual(out.pop(), { type: 'newTab' });
$('openFile').click(); assert.deepStrictEqual(out.pop(), { type: 'openFile' });

// a token set: saving sends none, unless Replace was pressed
submit();
assert.strictEqual(out.pop().token, '', 'the token kept');
$('replace').click();
assert.deepStrictEqual([$('tokenSet').hidden, $('token').hidden], [true, false], 'Replace shows the box');
$('token').value = 'sk-2'; submit();
assert.strictEqual(out.pop().token, 'sk-2');
// a change hides Saved
host({ type: 'saved', state: { file: '/f', exists: true, ok: true, baseUrl: 'https://gw.example.com', tokenSet: true, models: models() } });
$('baseUrl').dispatchEvent(new w.Event('input', { bubbles: true }));
assert.strictEqual($('saved').hidden, true);


// a verdict: its text; Save anyway only when the host allows it, and it saves unchecked
host({ type: 'verdict', text: 'x', canForce: true });
assert.deepStrictEqual([$('error').textContent, $('force').hidden], ['x', false]);
$('force').click();
assert.deepStrictEqual([out.length && out[out.length - 1].type, out[out.length - 1].force], ['save', true], 'Save anyway saves unchecked');
host({ type: 'verdict', text: 'y', canForce: false });
assert.deepStrictEqual([$('error').textContent, $('force').hidden], ['y', true]);
submit(); assert.strictEqual(out.pop().force, false);

// a company's gateway: no base URL, no model names; Get a key, a Key, Check and save
host({ type: 'state', state: { file: '/f', exists: false, ok: false, baseUrl: '', tokenSet: false, models: models(), preset: { name: 'Example Gateway', keyPage: 'https://ai.example.com/api-access', baseUrl: '' } } });
assert.deepStrictEqual([$('baseUrl').hidden, $('models').hidden, d.querySelector('h1').textContent, $('save').textContent, $('getKey').hidden, $('force').hidden, $('token').type],
  [true, true, 'Connect to Example Gateway', 'Check and save', false, true, 'password']);
assert(!d.querySelector('label[for="baseUrl"]') || d.querySelector('label[for="baseUrl"]').hidden, 'nor its label');
$('getKey').click(); assert.deepStrictEqual(out.pop(), { type: 'getKey' });
$('token').value = ' sk-c '; submit();
assert.deepStrictEqual(out.pop(), { type: 'save', baseUrl: '', token: 'sk-c', models: {}, force: false });
host({ type: 'saved', state: { file: '/f', exists: true, ok: true, baseUrl: 'https://b.example.com', tokenSet: true, models: models(), preset: { name: 'Example Gateway', keyPage: 'https://ai.example.com/api-access', baseUrl: 'https://b.example.com' } }, answeredAt: 'https://b.example.com' });
assert.deepStrictEqual([$('saved').hidden, $('answered').textContent, $('tokenSet').hidden], [false, 'Answered at https://b.example.com.', false]);
// the company's key helper: Get a key runs it in the host; the page waits, and when it can't, Try again and the manual way
const PRESET_CMD = { name: 'Example Gateway', keyPage: 'https://ai.example.com/api-access', baseUrl: '', keyCommand: true };
host({ type: 'state', state: { file: '/f', exists: false, ok: false, baseUrl: '', tokenSet: false, models: models(), preset: PRESET_CMD } });
assert.deepStrictEqual([$('form').hidden, $('paste').hidden, $('keyPage').hidden, $('aboutCommand').hidden, $('aboutPreset').hidden, $('getKey').textContent],
  [true, false, true, false, true, 'Get a key'], 'the key helper: Get a key, and Paste a key instead; the field behind it');
$('getKey').click(); assert.deepStrictEqual(out.pop(), { type: 'getKey' });
assert.deepStrictEqual([$('waiting').hidden, $('waiting').textContent, $('getKey').disabled], [false, 'Getting your Example Gateway key…', true]);
const n = out.length; $('getKey').click(); assert.strictEqual(out.length, n, 'not twice while it runs');
host({ type: 'keyFailed', text: "The sign-in wasn't completed." });
assert.deepStrictEqual([$('waiting').hidden, $('keyError').textContent, $('keyError').hidden, $('getKey').textContent, $('getKey').disabled, $('keyPage').hidden, $('form').hidden, $('token').hidden, $('paste').hidden],
  [true, "The sign-in wasn't completed.", false, 'Try again', false, false, false, false, true], 'the reason, Try again, Open the key page, the Key and Check and save');
$('keyPage').click(); assert.deepStrictEqual(out.pop(), { type: 'keyPage' });
$('token').value = 'sk-m'; submit(); assert.deepStrictEqual(out.pop(), { type: 'save', baseUrl: '', token: 'sk-m', models: {}, force: false });
// Try again; the helper's key refused by the gateway: the verdict, and the manual way stays
$('getKey').click(); assert.deepStrictEqual(out.pop(), { type: 'getKey' });
assert.deepStrictEqual([$('keyError').hidden, $('waiting').hidden], [true, false]);
host({ type: 'verdict', text: 'Example Gateway rejected the key.', canForce: false });
assert.deepStrictEqual([$('waiting').hidden, $('error').textContent, $('form').hidden, $('getKey').textContent, $('force').hidden], [true, 'Example Gateway rejected the key.', false, 'Try again', true]);
$('getKey').click(); out.pop();
host({ type: 'saved', state: { file: '/f', exists: true, ok: true, baseUrl: 'https://b.example.com', tokenSet: true, models: models(), preset: Object.assign({}, PRESET_CMD, { baseUrl: 'https://b.example.com' }) }, answeredAt: 'https://b.example.com' });
assert.deepStrictEqual([$('saved').hidden, $('waiting').hidden, $('getKey').textContent], [false, true, 'Get a key'], 'saved');
// Paste a key instead, from the start
host({ type: 'state', state: { file: '/f', exists: false, ok: false, baseUrl: '', tokenSet: false, models: models(), preset: PRESET_CMD } });
assert.deepStrictEqual([$('form').hidden, $('paste').hidden, $('keyError').hidden], [true, false, true], 'a fresh state: the helper first again');
$('paste').click();
assert.deepStrictEqual([$('form').hidden, $('keyPage').hidden, $('paste').hidden], [false, false, true]);
// back to no company: the fields return
host({ type: 'state', state: { file: '/f', exists: true, ok: true, baseUrl: 'https://gw.example.com', tokenSet: true, models: models(), preset: null } });
assert.deepStrictEqual([$('baseUrl').hidden, $('models').hidden, d.querySelector('h1').textContent, $('getKey').hidden, $('form').hidden, $('aboutCommand').hidden], [false, false, 'Set up an LLM gateway', true, false, true]);

console.log('gatewayForm tests passed');
