'use strict';
// The page of Agents: Connect Claude…, run in a DOM and driven as the host drives it.
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');
const { getConnectClaudeHtml } = require('../src/connectClaude');

const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', (e) => { console.error('PAGE SCRIPT ERROR:', (e.detail && e.detail.message) || e.message); process.exitCode = 1; });
const raw = getConnectClaudeHtml({ nonce: 'n', cspSource: 'x' });
assert(/Content-Security-Policy[^>]*script-src 'nonce-n'/.test(raw), 'its script runs by nonce only');
const html = raw.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
const out = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => out.push(JSON.parse(JSON.stringify(m))) }); } });
const w = dom.window, d = w.document, $ = (id) => d.getElementById(id);
const host = (m) => w.dispatchEvent(new w.MessageEvent('message', { data: m }));
const state = (o) => Object.assign({ company: null, connection: null, connected: false, terminal: { on: false, offered: true }, apiKeySet: false, bedrockOpen: false, profiles: [], bedrock: null, loggedIn: false }, o);
const shown = (el) => { for (let e = el; e && e !== d.body; e = e.parentElement) if (e.hidden) return false; return true; };
const ways = () => [...d.querySelectorAll('.way')].filter(shown).map((s) => s.dataset.way);
const names = () => [...d.querySelectorAll('.way')].filter(shown).map((s) => s.querySelector('.name').textContent);
const SWITCH = "Using your own Claude subscription, an API key or Bedrock, or Codex? Switch any tab's backend in its footer whenever you like; a Codex tab's footer offers ChatGPT login, an OpenAI API key or Bedrock.";
const awsShown = () => /AWS CLI|\.aws|aws sso|awscli/.test([...d.body.querySelectorAll('*')].filter((e) => shown(e) && !e.children.length).map((e) => e.textContent).join('\n'));

assert.deepStrictEqual(out, [{ type: 'ready' }], 'the page asks for its state');

// a company with a gateway: that gateway only, and the footer line for the other ways, Codex's too (Sean, 2026-11-24)
host({ type: 'state', state: state({ company: { gatewayName: 'Example Gateway' }, terminal: { on: true, offered: true } }) });
assert.deepStrictEqual(ways(), ['gateway']);
assert.deepStrictEqual(names(), ['Example Gateway']);
assert(shown($('recommended')) && $('recommended').textContent === 'Recommended', 'the company\'s gateway is recommended');
assert.deepStrictEqual([shown($('switchNote')), $('switchNote').textContent], [true, SWITCH], 'one line: a tab\'s footer switches backend');
assert.strictEqual($('gatewayBtn').textContent, 'Set Up…', 'the gateway form: Get a key, Check and save');
assert.strictEqual(awsShown(), false, 'nothing about AWS');
assert.deepStrictEqual([shown($('terminalRow')), $('terminal').checked], [true, true], 'the terminal box, on as the company says');

// no company: all five ways, an LLM gateway first and not recommended, no footer line, Bedrock's form closed
host({ type: 'state', state: state() });
assert.deepStrictEqual(ways(), ['gateway', 'subscription', 'apiKey', 'bedrock', 'codex']);
assert.deepStrictEqual(names(), ['An LLM gateway', 'Claude subscription', 'Anthropic API key', 'AWS Bedrock', 'Codex only']);
assert.strictEqual(shown($('recommended')), false);
assert.strictEqual(shown($('switchNote')), false);
assert.deepStrictEqual([shown($('bedrockPick')), shown($('bedrockForm')), awsShown()], [true, false, false], 'Bedrock not picked: no AWS text');
assert.strictEqual($('terminal').checked, false);
$('terminal').checked = true; $('terminal').dispatchEvent(new w.Event('change'));
assert.deepStrictEqual(out.pop(), { type: 'terminal', on: true });

// each way's button
$('gatewayBtn').click(); assert.deepStrictEqual(out.pop(), { type: 'gateway' });
$('subscriptionBtn').click(); assert.deepStrictEqual(out.pop(), { type: 'subscription' });
$('codexBtn').click(); assert.deepStrictEqual(out.pop(), { type: 'codex' });
$('apiKey').value = '  sk-ant-1\n'; $('apiKeyBtn').click();
assert.deepStrictEqual(out.pop(), { type: 'apiKey', key: 'sk-ant-1' }, 'the key trimmed');
assert.strictEqual($('apiKey').type, 'password');

// Bedrock picked: the host is asked, and opens its form with the profiles, plus default credentials
$('bedrockPick').click(); assert.deepStrictEqual(out.pop(), { type: 'bedrockPick' });
host({ type: 'state', state: state({ bedrockOpen: true, profiles: [{ name: 'ci', region: '' }, { name: 'dev', region: 'eu-west-1' }], bedrock: { profile: '', region: 'us-east-2' } }) });
assert.deepStrictEqual([shown($('bedrockPick')), shown($('bedrockForm'))], [false, true]);
assert.deepStrictEqual([...$('profile').options].map((o) => [o.value, o.textContent]), [['', 'default credentials'], ['ci', 'ci'], ['dev', 'dev']]);
assert.strictEqual($('region').value, 'us-east-2');
$('profile').value = 'dev'; $('profile').dispatchEvent(new w.Event('change'));
assert.strictEqual($('region').value, 'eu-west-1', 'the profile\'s region');
$('profile').value = 'ci'; $('profile').dispatchEvent(new w.Event('change'));
assert.strictEqual($('region').value, 'us-east-2', 'a profile without one: the default');
$('profile').value = 'dev'; $('region').value = ' eu-west-1 '; $('bedrockBtn').click();
assert.deepStrictEqual(out.pop(), { type: 'bedrock', profile: 'dev', region: 'eu-west-1', force: false });
assert.strictEqual(shown($('bedrockForce')), false, 'no Save anyway until the host offers it');
// no AWS CLI: what to do, not styled as an error
const NEEDS = 'Bedrock needs the AWS CLI: install it (on macOS: brew install awscli), then try again.';
host({ type: 'verdict', way: 'bedrock', text: NEEDS, ok: true, canForce: true });
assert.deepStrictEqual([$('verdict-bedrock').textContent, $('verdict-bedrock').className, shown($('bedrockForce'))], [NEEDS, 'verdict ok', true]);
$('bedrockForce').click();
assert.deepStrictEqual(out.pop(), { type: 'bedrock', profile: 'dev', region: 'eu-west-1', force: true }, 'Save anyway saves unchecked');
host({ type: 'verdict', way: 'apiKey', text: 'Anthropic rejected the key.', ok: false, canForce: false });
assert.deepStrictEqual([$('verdict-apiKey').textContent, shown($('bedrockForce'))], ['Anthropic rejected the key.', false]);

// conflicts: each key with what it holds and what it would hold; Replace names them, Keep keeps them
host({ type: 'conflicts', way: 'bedrock', list: [{ key: 'env.AWS_REGION', from: 'us-west-2', to: 'eu-west-1' }, { key: 'env.AWS_PROFILE', from: 'prod', to: 'dev' }] });
assert(shown($('conflicts')));
assert.deepStrictEqual([...$('conflictList').querySelectorAll('li')].map((li) => li.textContent), ['env.AWS_REGION: us-west-2 → eu-west-1', 'env.AWS_PROFILE: prod → dev']);
$('replace').click();
assert.deepStrictEqual(out.pop(), { type: 'replace', keys: ['env.AWS_REGION', 'env.AWS_PROFILE'] });
assert.strictEqual(shown($('conflicts')), false, 'answered: the box goes');
host({ type: 'conflicts', way: 'bedrock', list: [{ key: 'env.AWS_REGION', from: 'us-west-2', to: 'eu-west-1' }] });
$('keep').click(); assert.deepStrictEqual(out.pop(), { type: 'keep' });

// saved: the note about terminal claude, and New Claude Tab
assert.strictEqual(shown($('saved')), false);
host({ type: 'saved', way: 'bedrock', terminalNote: "~/.claude/settings.json isn't plain JSON, so it was left alone." });
assert.deepStrictEqual([shown($('saved')), $('terminalNote').textContent], [true, "~/.claude/settings.json isn't plain JSON, so it was left alone."]);
$('newTab').click(); assert.deepStrictEqual(out.pop(), { type: 'newTab' });

// Codex chosen: no terminal box; the way in use is marked
host({ type: 'state', state: state({ connection: 'codex', connected: true, terminal: { on: false, offered: false } }) });
assert.strictEqual(shown($('terminalRow')), false, 'Codex only: nothing for terminal claude');
assert.deepStrictEqual([...d.querySelectorAll('.way.current')].map((s) => s.dataset.way), ['codex']);
// a key saved, a login there: said, never shown
host({ type: 'state', state: state({ apiKeySet: true, loggedIn: true, connection: 'apiKey', connected: true }) });
assert(shown($('apiKeySet')));
assert.strictEqual($('apiKey').value, '', 'the key box is empty');
assert.strictEqual($('subscriptionBtn').textContent, 'Use the Subscription');
host({ type: 'state', state: state({ loggedIn: false }) });
assert.strictEqual($('subscriptionBtn').textContent, 'Log In');
assert.strictEqual(shown($('apiKeySet')), false);

console.log('connectClaude page tests passed');
