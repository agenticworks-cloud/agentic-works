'use strict';
// The Get started page, run in a DOM (jsdom from parts/agents) and driven as the host drives it.
const assert = require('node:assert');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { JSDOM, VirtualConsole } = require(require.resolve('jsdom', { paths: [path.join(root, 'parts', 'agents')] }));
const { getStartedHtml } = require(path.join(root, 'src', 'getStartedPage'));

const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => { console.error('PAGE SCRIPT ERROR:', (e.detail && e.detail.message) || e.message); process.exitCode = 1; });
const raw = getStartedHtml({ nonce: 'n', cspSource: 'x' });
assert(/Content-Security-Policy[^>]*script-src 'nonce-n';/.test(raw), 'its script runs by nonce only');
assert(!/script-src[^;]*unsafe-inline/.test(raw), 'no inline scripts allowed');
assert(!/\son[a-z]+=/i.test(raw), 'no inline handlers');
const html = raw.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
const out = [];
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole, beforeParse(w) { w.acquireVsCodeApi = () => ({ postMessage: (m) => out.push(JSON.parse(JSON.stringify(m))) }); } });
const w = dom.window, d = w.document;
const host = (m) => w.dispatchEvent(new w.MessageEvent('message', { data: m }));
const shown = (el) => { for (let e = el; e && e !== d.body; e = e.parentElement) if (e.hidden) return false; return true; };
const step = (id) => d.querySelector(`.step[data-id="${id}"]`);
const open = () => [...d.querySelectorAll('.step.open')].map((s) => s.dataset.id);
const button = (el, text) => [...el.querySelectorAll('button')].find((b) => b.textContent === text && shown(b));
const st = (o) => Object.assign({ title: 'Get started with Roost', steps: [], claude: { companyGateway: '' }, github: { logins: [] }, teams: { rowId: '' }, jira: { rowId: '', site: '', form: true }, parts: [] }, o);
const S = (id, name, done = false, waiting = '') => ({ id, name, done, waiting });

assert.deepStrictEqual(out, [{ type: 'ready' }], 'the page asks for its state');
assert.strictEqual(d.title, 'Get started');

// ---- a company gateway
host({ type: 'state', state: st({ title: 'Get started with Example Works', claude: { companyGateway: 'Example Gateway' },
  steps: [S('github', 'Sign in to GitHub', true), S('claude', 'Connect Example Gateway'), S('parts', 'Choose your parts')] }) });
assert.strictEqual(d.querySelector('h1').textContent, 'Get started with Example Works');
assert.deepStrictEqual([...d.querySelectorAll('.step')].map((s) => s.querySelector('.name').textContent), ['Sign in to GitHub', 'Connect Example Gateway', 'Choose your parts']);
assert.deepStrictEqual(open(), ['claude'], 'the first step not done is open');
assert.ok(step('github').classList.contains('done'));
assert.ok(!step('claude').classList.contains('done'));
assert.ok(shown(step('github').querySelector('.tick')), 'a done step has its tick');
assert.ok(!shown(step('claude').querySelector('.tick')));
assert.ok(!shown(step('github').querySelector('.body')), 'a closed step hides its controls');
// the company gateway in place: no Base URL, a Key; Check and save posts and empties the field
assert.ok(out.some((m) => m.type === 'agents' && m.request.type === 'gatewayReady'));
assert.ok(out.some((m) => m.type === 'agents' && m.request.type === 'ready'));
const claude = step('claude');
assert.ok(claude.textContent.includes('Example Gateway'));
assert.strictEqual([...claude.querySelectorAll('input')].filter(shown).some((i) => /base url/i.test(i.placeholder || '') || i.id === 'baseUrl'), false, 'no Base URL');
assert.ok(!button(claude, 'Log In'), 'the other ways are not offered');
button(claude, 'Get a key').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'getKey' } });
const key = claude.querySelector('input[type=password]');
assert.ok(shown(key));
key.value = ' k-1 '; [...claude.querySelectorAll('button')].find((b) => b.textContent === 'Check and save').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'gatewaySave', baseUrl: '', token: 'k-1', models: {}, force: false } });
assert.strictEqual(key.value, '');
host({ type: 'agents', replies: [{ type: 'gatewayVerdict', text: 'Example Gateway rejected the key.', canForce: false }] });
assert.ok(claude.textContent.includes('Example Gateway rejected the key.'));
host({ type: 'agents', error: "Agents (Claude Code and Codex) isn't running." });
assert.ok(claude.textContent.includes("isn't running."));
// the terminal box is there too
const terminal = [...claude.querySelectorAll('input[type=checkbox]')].find(shown);
assert.ok(terminal, 'the terminal box');
terminal.checked = true; terminal.dispatchEvent(new w.Event('change'));
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'terminal', on: true } });
host({ type: 'agents', replies: [{ type: 'state', state: { company: { gatewayName: 'Example Gateway' }, connection: 'gateway', connected: true, terminal: { on: false } } }] });
assert.strictEqual(terminal.checked, false, 'the box follows the state');
// a step's name toggles it
step('github').querySelector('.name').click(); assert.deepStrictEqual(open().sort(), ['claude', 'github']);
step('github').querySelector('.name').click(); assert.deepStrictEqual(open(), ['claude']);
assert.strictEqual(out.filter((m) => m.type === 'agents' && m.request.type === 'gatewayReady').length, 1, 'asked once, when the step first opened');

// github: signed in as, Add Another Account
host({ type: 'state', state: st({ github: { logins: ['a', 'b'] }, steps: [S('github', 'Sign in to GitHub', true)] }) });
assert.ok(step('github').textContent.includes('Signed in as a, b.'));
assert.ok(!step('claude'), 'steps not shown are gone');
assert.deepStrictEqual(open(), [], 'every step done: none opens by itself');
step('github').querySelector('.name').click();
button(step('github'), 'Add Another Account').click();
assert.deepStrictEqual(out.pop(), { type: 'github' });
host({ type: 'state', state: st({ steps: [S('github', 'Sign in to GitHub', false, 'Waiting for the sign-in in the terminal…')] }) });
assert.ok(!step('github').textContent.includes('Signed in as'));
button(step('github'), 'Sign In to GitHub').click();
assert.deepStrictEqual(out.pop(), { type: 'github' });
// a waiting line in its step
const waiting = step('github').querySelector('.waiting');
assert.strictEqual(waiting.textContent, 'Waiting for the sign-in in the terminal…');
assert.ok(shown(waiting));
host({ type: 'state', state: st({ steps: [S('github', 'Sign in to GitHub')] }) });
assert.ok(!shown(step('github').querySelector('.waiting')));

// ---- no company gateway: the four ways inline
out.length = 0;
host({ type: 'state', state: st({ steps: [S('claude', 'Connect Claude'), S('agents', 'Talk to Claude or Codex'), S('tools', 'Connect your tools'), S('codebase', 'Search your code')] }) });
const c = step('claude');
assert.deepStrictEqual(open(), ['claude']);
for (const name of ['An LLM gateway', 'Claude subscription', 'Anthropic API key', 'AWS Bedrock']) assert.ok(c.textContent.includes(name), name);
host({ type: 'agents', replies: [{ type: 'gatewayState', state: { baseUrl: 'https://gw.example.com', tokenSet: true, models: {} } },
  { type: 'state', state: { company: null, connection: null, connected: false, terminal: { on: false }, apiKeySet: false, bedrockOpen: false, profiles: [], loggedIn: false } }] });
const baseUrl = c.querySelector('input[name=baseUrl]');
assert.strictEqual(baseUrl.value, 'https://gw.example.com');
assert.ok(shown(baseUrl));
const gwToken = c.querySelector('input[name=gatewayToken]');
assert.strictEqual(gwToken.type, 'password');
gwToken.value = ' t-1 ';
const gwSection = c.querySelector('.way[data-way="gateway"]');
button(gwSection, 'Check and save').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'gatewaySave', baseUrl: 'https://gw.example.com', token: 't-1', models: {}, force: false } });
assert.strictEqual(gwToken.value, '');
assert.ok(!button(gwSection, 'Save anyway'));
host({ type: 'agents', replies: [{ type: 'gatewayVerdict', text: 'The gateway answered oddly.', canForce: true }] });
assert.ok(gwSection.textContent.includes('The gateway answered oddly.'));
button(gwSection, 'Save anyway').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'gatewaySave', baseUrl: 'https://gw.example.com', token: 't-1', models: {}, force: true } });
assert.ok(!button(gwSection, 'Save anyway'));
// typing after an unexpected answer: Save anyway goes, and the held token with it
for (const edit of [() => { baseUrl.value = 'https://other.example.com'; baseUrl.dispatchEvent(new w.Event('input', { bubbles: true })); },
  () => { gwToken.value = 't-2'; gwToken.dispatchEvent(new w.Event('input', { bubbles: true })); }]) {
  gwToken.value = ' t-1 ';
  button(gwSection, 'Check and save').click(); out.pop();
  host({ type: 'agents', replies: [{ type: 'gatewayVerdict', text: 'The gateway answered oddly.', canForce: true }] });
  assert.ok(button(gwSection, 'Save anyway'));
  edit();
  assert.ok(!button(gwSection, 'Save anyway'), 'an edit hides Save anyway');
  button(gwSection, 'Check and save').click();
  assert.strictEqual(out.pop().request.force, false, 'the edit is checked');
  assert.strictEqual(gwToken.value, '');
}
baseUrl.value = 'https://gw.example.com';
// subscription
button(c, 'Log In').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'subscription' } });
// API key
const apiKey = c.querySelector('input[name=apiKey]');
assert.strictEqual(apiKey.type, 'password');
apiKey.value = ' sk-ant-x ';
button(c.querySelector('.way[data-way="apiKey"]'), 'Check and save').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'apiKey', key: 'sk-ant-x' } });
assert.strictEqual(apiKey.value, '');
host({ type: 'agents', replies: [{ type: 'verdict', way: 'apiKey', text: 'Anthropic rejected the key.', ok: false, canForce: false }] });
assert.ok(c.querySelector('.way[data-way="apiKey"]').textContent.includes('Anthropic rejected the key.'));
// Bedrock: Use Bedrock…, then Profile, Region, Check and save, Save anyway
const bedrock = c.querySelector('.way[data-way="bedrock"]');
assert.ok(!shown(bedrock.querySelector('select')), 'Bedrock\'s form waits until it is picked');
button(bedrock, 'Use Bedrock…').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'bedrockPick' } });
host({ type: 'agents', replies: [{ type: 'state', state: { company: null, connection: null, connected: false, terminal: { on: false }, apiKeySet: false, bedrockOpen: true,
  profiles: [{ name: 'default', region: 'us-west-2' }, { name: 'work', region: 'eu-west-1' }], bedrock: { profile: 'work', region: 'eu-west-1' }, loggedIn: true } }] });
assert.ok(shown(bedrock.querySelector('select')));
assert.ok(!button(bedrock, 'Use Bedrock…'));
assert.strictEqual(bedrock.querySelector('select').value, 'work');
assert.strictEqual(bedrock.querySelector('input[name=region]').value, 'eu-west-1');
assert.ok(button(c, 'Use the Subscription'), 'logged in: the subscription is used, not logged in to');
button(bedrock, 'Check and save').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'bedrock', profile: 'work', region: 'eu-west-1', force: false } });
host({ type: 'agents', replies: [{ type: 'verdict', way: 'bedrock', text: 'No AWS CLI here.', ok: false, canForce: true }] });
button(bedrock, 'Save anyway').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'bedrock', profile: 'work', region: 'eu-west-1', force: true } });
// conflicts: the list, Replace, Keep Mine
host({ type: 'agents', replies: [{ type: 'conflicts', way: 'bedrock', list: [{ key: 'AWS_REGION', from: 'us-east-1', to: 'eu-west-1' }, { key: 'ANTHROPIC_API_KEY', from: 'sk-…ab', to: null }] }] });
assert.ok(c.textContent.includes('AWS_REGION: us-east-1'));
assert.ok(c.textContent.includes('ANTHROPIC_API_KEY: sk-…ab'));
button(c, 'Replace').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'replace', keys: ['AWS_REGION', 'ANTHROPIC_API_KEY'] } });
assert.ok(!button(c, 'Replace'), 'answered: the list goes');
host({ type: 'agents', replies: [{ type: 'conflicts', way: 'bedrock', list: [{ key: 'AWS_REGION', from: 'us-east-1', to: 'eu-west-1' }] }] });
button(c, 'Keep Mine').click();
assert.deepStrictEqual(out.pop(), { type: 'agents', request: { type: 'keep' } });
host({ type: 'agents', replies: [{ type: 'saved', way: 'bedrock', terminalNote: 'Terminal claude uses it too.' }] });
assert.ok(c.textContent.includes('Terminal claude uses it too.'));
// Not Now
button(c, 'Not Now').click();
assert.deepStrictEqual(out.pop(), { type: 'notNow', step: 'claude' });
// agents: new tabs
step('agents').querySelector('.name').click();
button(step('agents'), 'New Claude Tab').click();
assert.deepStrictEqual(out.pop(), { type: 'newTab', kind: 'claude' });
button(step('agents'), 'New Codex Tab').click();
assert.deepStrictEqual(out.pop(), { type: 'newTab', kind: 'codex' });
// codebase: Turn On, Not Now
step('codebase').querySelector('.name').click();
button(step('codebase'), 'Turn On').click();
assert.deepStrictEqual(out.pop(), { type: 'codebaseOn' });
button(step('codebase'), 'Not Now').click();
assert.deepStrictEqual(out.pop(), { type: 'notNow', step: 'codebase' });
// tools: every row, Not Now
const row = (o) => Object.assign({ id: 'x', name: 'X', about: '', kind: 'none', page: '', state: 'notConnected', reason: '', prompt: null, conflict: false, signedIn: false }, o);
const mail = row({ id: 'mail', name: 'Example Mail', kind: 'mcpTool', state: 'connecting', prompt: { text: 'Enter code ABCD', url: 'https://login.example.com/device', code: 'ABCD' } });
const docs = row({ id: 'docs', name: 'Example Docs', kind: 'tokenPage' });
host({ type: 'rows', rows: [mail, docs] });
step('tools').querySelector('.name').click();
assert.deepStrictEqual([...step('tools').querySelectorAll('.tool')].map((t) => t.dataset.id), ['mail', 'docs']);
const docsToken = step('tools').querySelector('.tool[data-id="docs"] input[type=password]');
docsToken.value = ' tok ';
button(step('tools').querySelector('.tool[data-id="docs"]'), 'Check and save').click();
assert.deepStrictEqual(out.pop(), { type: 'tool', message: { type: 'token', id: 'docs', token: 'tok' } });
assert.strictEqual(docsToken.value, '');
button(step('tools'), 'Not Now').click();
assert.deepStrictEqual(out.pop(), { type: 'notNow', step: 'tools' });
// a step done moves the open one on; one opened by hand stays open
host({ type: 'state', state: st({ steps: [S('claude', 'Connect Claude', true), S('agents', 'Talk to Claude or Codex'), S('tools', 'Connect your tools'), S('codebase', 'Search your code')] }) });
assert.ok(!open().includes('claude'), 'done: it closes');
assert.ok(open().includes('agents'), 'the next not done opens');
assert.ok(open().includes('tools') && open().includes('codebase'), 'opened by hand: kept');

// ---- teams and jira
out.length = 0;
host({ type: 'state', state: st({ teams: { rowId: 'mail' }, jira: { rowId: '', site: 'https://example.atlassian.net', form: true },
  steps: [S('teams', 'Sign in to Teams'), S('jira', 'Sign in to Jira'), S('parts', 'Choose your parts')],
  parts: [{ id: 'teams', title: 'Teams', on: true }, { id: 'jira', title: 'Jira & Confluence', on: false }] }) });
host({ type: 'rows', rows: [mail] });
assert.deepStrictEqual([...step('teams').querySelectorAll('.tool')].map((t) => t.dataset.id), ['mail'], 'the teams row, in its step');
assert.ok(!button(step('teams'), 'Sign In to Teams'));
button(step('teams'), 'Copy code and open').click();
assert.deepStrictEqual(out.pop(), { type: 'tool', message: { type: 'copyAndOpen', id: 'mail' } });
host({ type: 'state', state: st({ teams: { rowId: '' }, steps: [S('teams', 'Sign in to Teams')] }) });
assert.strictEqual([...step('teams').querySelectorAll('.tool')].filter(shown).length, 0);
button(step('teams'), 'Sign In to Teams').click();
assert.deepStrictEqual(out.pop(), { type: 'teamsSignIn' });
// jira: the form, prefilled site
host({ type: 'state', state: st({ jira: { rowId: '', site: 'https://example.atlassian.net', form: true }, steps: [S('jira', 'Sign in to Jira')] }) });
const j = step('jira');
assert.deepStrictEqual(open(), ['jira']);
assert.strictEqual(j.querySelector('input[name=site]').value, 'https://example.atlassian.net');
assert.strictEqual(j.querySelector('a').href, 'https://id.atlassian.com/manage-profile/security/api-tokens');
assert.strictEqual(j.querySelector('a').textContent, 'Create one');
j.querySelector('input[name=site]').value = ' https://example.atlassian.net/ ';
j.querySelector('input[name=email]').value = ' me@example.com ';
const jt = j.querySelector('input[name=token]');
assert.strictEqual(jt.type, 'password');
jt.value = ' jt-1 ';
button(j, 'Sign in').click();
assert.deepStrictEqual(out.pop(), { type: 'jiraForm', site: 'https://example.atlassian.net/', email: 'me@example.com', token: 'jt-1' });
assert.strictEqual(jt.value, '');
host({ type: 'jira', error: 'the email or API token was rejected' });
assert.ok(shown(j.querySelector('.error')));
assert.strictEqual(j.querySelector('.error').textContent, 'the email or API token was rejected');
host({ type: 'jira', error: null });
assert.ok(!shown(j.querySelector('.error')));
host({ type: 'state', state: st({ jira: { rowId: '', site: 'https://example.atlassian.net', form: true }, steps: [S('jira', 'Sign in to Jira')] }) });
assert.strictEqual(j.querySelector('input[name=email]').value, ' me@example.com ', 'a later state keeps what is typed');
assert.strictEqual(j.querySelector('input[name=site]').value, ' https://example.atlassian.net/ ', 'a site typed over the prefill is kept');
host({ type: 'state', state: st({ jira: { rowId: '', site: '', form: false }, steps: [S('jira', 'Sign in to Jira')] }) });
assert.ok(!shown(j.querySelector('input[name=site]')));
button(j, 'Sign In').click();
assert.deepStrictEqual(out.pop(), { type: 'jiraSignIn' });
host({ type: 'state', state: st({ jira: { rowId: 'mail', site: '', form: true }, steps: [S('jira', 'Sign in to Jira')] }) });
assert.ok(!shown(j.querySelector('input[name=site]')));
assert.ok(!button(j, 'Sign In'));
assert.deepStrictEqual([...j.querySelectorAll('.tool')].map((t) => t.dataset.id), ['mail']);

// parts: a switch each, Done, All settings
host({ type: 'state', state: st({ steps: [S('parts', 'Choose your parts')], parts: [{ id: 'teams', title: 'Teams', on: true }, { id: 'jira', title: 'Jira & Confluence', on: false }] }) });
const p = step('parts');
const boxes = [...p.querySelectorAll('input[type=checkbox]')];
assert.deepStrictEqual(boxes.map((b) => b.checked), [true, false]);
assert.ok(p.textContent.includes('Jira & Confluence'));
boxes[0].checked = false; boxes[0].dispatchEvent(new w.Event('change'));
assert.deepStrictEqual(out.pop(), { type: 'part', id: 'teams', on: false });
host({ type: 'state', state: st({ steps: [S('parts', 'Choose your parts')], parts: [{ id: 'teams', title: 'Teams', on: true }, { id: 'jira', title: 'Jira & Confluence', on: false }] }) });
assert.strictEqual(p.querySelectorAll('input[type=checkbox]')[0].checked, true, 'the page follows the setting');
button(p, 'Done').click();
assert.deepStrictEqual(out.pop(), { type: 'partsDone' });
button(p, 'All settings').click();
assert.deepStrictEqual(out.pop(), { type: 'openSettings' });

// words from the company file are text, never markup
host({ type: 'state', state: st({ title: '<img src=x onerror=alert(1)>', steps: [S('parts', '<b>x</b>')], parts: [{ id: 'odd', title: '<i>odd</i>', on: true }] }) });
assert.strictEqual(d.querySelector('img'), null);
assert.strictEqual(d.querySelector('b'), null);
assert.strictEqual(d.querySelector('h1').textContent, '<img src=x onerror=alert(1)>');

// nothing posted ever held a secret it was not sent to hold, and no reply put one in a field
assert.ok(!d.querySelectorAll('input[type=password]').length || [...d.querySelectorAll('input[type=password]')].every((i) => i.value === ''));

console.log('getStartedPage.test.js passed');
