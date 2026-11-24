'use strict';
// The page of Roost: Get started: one column of steps, each a section with its name and a tick once done; the first
// step shown that isn't done is open, the others closed, and a click on a step's name opens or closes it. Every step's
// controls are in place: no step opens another panel. The host (Task 7, src/extension.js) sends the state, answers the
// messages and calls the parts' commands; the page holds no saved key or token, and empties a typed one as it sends it.
// The words (the heading, the steps' names, the company gateway's name) come from the state, never from here.
//
// Host to page: state {state}, state = { title, steps: [{ id, name, done, waiting }], claude: { companyGateway },
//   github: { logins }, teams: { rowId }, jira: { rowId, site, form }, parts: [{ id, title, on }] }; rows {rows} (the
//   tools rows, src/toolsRows.js); agents {replies} (perch.connectClaude.request's replies) or agents {error}; jira
//   {error} (null once signed in).
// Page to host: ready; agents {request} (a Connect Claude or renamed gateway form message); github; newTab {kind};
//   notNow {step}; codebaseOn; teamsSignIn; jiraSignIn; jiraForm {site, email, token}; part {id, on}; partsDone;
//   openSettings; tool {message} (a tools row's message, {type, id, ...}). No VS Code dependency.

const { TOOLS_ROWS_CSS, toolsRowsScript } = require('./toolsRows');

const JIRA_TOKEN_PAGE = 'https://id.atlassian.com/manage-profile/security/api-tokens';

// Written as a real function (so it is linted and needs no escaping) and sent to the page as its source.
function GetStarted(vscode, ToolsList, JIRA_TOKEN_PAGE) {
  const post = (m) => vscode.postMessage(m);
  const agents = (request) => post({ type: 'agents', request });
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const button = (text, cls, onClick) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };
  const row = (...kids) => { const r = el('div', 'row'); r.append(...kids); return r; };
  const input = (type, name, placeholder) => {
    const i = el('input'); i.type = type; i.name = name; i.spellcheck = false; i.autocomplete = 'off';
    if (placeholder) i.placeholder = placeholder;
    return i;
  };
  const field = (label, inp) => { const l = el('label', '', label); const f = el('div', 'field'); f.append(l, inp); return f; };
  const onEnter = (inp, btn) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') btn.click(); });
  const toolPost = (type, id, extra) => post({ type: 'tool', message: Object.assign({ type, id }, extra || {}) });

  let state = null, rows = [];
  const views = new Map();     // step id → { root, body, update(state), ... }, kept across states
  const openIds = new Set();
  let auto = null;             // the step opened for being the first not done

  // ---- the steps' controls
  const BUILD = {
    github(v) {
      v.signedIn = el('p', '');
      v.signIn = button('Sign In to GitHub', '', () => post({ type: 'github' }));
      v.another = button('Add Another Account', 'secondary', () => post({ type: 'github' }));
      v.body.append(v.signedIn, row(v.signIn, v.another));
      v.update = (s) => {
        const logins = (s.github && Array.isArray(s.github.logins)) ? s.github.logins : [];
        v.signedIn.textContent = logins.length ? 'Signed in as ' + logins.join(', ') + '.' : '';
        v.signedIn.hidden = !logins.length;
        v.signIn.hidden = logins.length > 0;
        v.another.hidden = !logins.length;
      };
    },

    claude(v) { buildClaude(v); },

    agents(v) {
      v.body.append(el('p', 'muted', 'Open a tab and send a message.'),
        row(button('New Claude Tab', '', () => post({ type: 'newTab', kind: 'claude' })), button('New Codex Tab', 'secondary', () => post({ type: 'newTab', kind: 'codex' }))));
    },

    tools(v) {
      v.list = el('div', 'tools');
      v.tools = ToolsList(v.list, toolPost);
      v.body.append(v.list, row(button('Not Now', 'secondary', () => post({ type: 'notNow', step: 'tools' }))));
      v.rows = () => v.tools.show(rows);
    },

    teams(v) {
      v.list = el('div', 'tools');
      v.tools = ToolsList(v.list, toolPost);
      v.signIn = button('Sign In to Teams', '', () => post({ type: 'teamsSignIn' }));
      v.signInRow = row(v.signIn);
      v.body.append(v.list, v.signInRow);
      v.rows = () => { const id = state && state.teams ? state.teams.rowId : ''; v.tools.show(id ? rows.filter((r) => r.id === id) : []); };
      v.update = (s) => { v.signInRow.hidden = !!(s.teams && s.teams.rowId); v.rows(); };
    },

    jira(v) {
      v.list = el('div', 'tools');
      v.tools = ToolsList(v.list, toolPost);
      v.site = input('text', 'site', 'https://your-site.atlassian.net');
      v.email = input('text', 'email', 'you@example.com');
      v.token = input('password', 'token', 'The API token');
      const create = el('a', 'create', 'Create one'); create.href = JIRA_TOKEN_PAGE;
      const tokenField = field('API token', v.token);
      tokenField.querySelector('label').append(' ', create);
      v.submit = button('Sign in', '', () => {
        post({ type: 'jiraForm', site: v.site.value.trim(), email: v.email.value.trim(), token: v.token.value.trim() });
        v.token.value = '';
      });
      for (const i of [v.site, v.email, v.token]) onEnter(i, v.submit);
      v.error = el('p', 'error'); v.error.hidden = true; v.error.setAttribute('role', 'alert');
      v.form = el('div', 'form');
      v.form.append(field('Site URL', v.site), field('Email', v.email), tokenField, row(v.submit), v.error);
      v.signIn = button('Sign In', '', () => post({ type: 'jiraSignIn' }));
      v.signInRow = row(v.signIn);
      v.prefill = '';
      v.body.append(v.list, v.form, v.signInRow);
      v.rows = () => { const id = state && state.jira ? state.jira.rowId : ''; v.tools.show(id ? rows.filter((r) => r.id === id) : []); };
      v.update = (s) => {
        const j = s.jira || {};
        v.form.hidden = !!j.rowId || !j.form;
        v.signInRow.hidden = !!j.rowId || !!j.form;
        // the site from the state, unless the user has typed another
        const site = typeof j.site === 'string' ? j.site : '';
        if (v.site.value === '' || v.site.value === v.prefill) { v.site.value = site; v.prefill = site; }
        v.rows();
      };
      v.jiraError = (text) => { v.error.textContent = text || ''; v.error.hidden = !text; };
    },

    codebase(v) {
      v.body.append(el('p', 'muted', 'Give Claude and Codex tabs a tool that searches the workspace. Off unless you turn it on.'),
        row(button('Turn On', '', () => post({ type: 'codebaseOn' })), button('Not Now', 'secondary', () => post({ type: 'notNow', step: 'codebase' }))));
    },

    parts(v) {
      v.list = el('div', 'parts');
      v.boxes = new Map();
      v.body.append(v.list, row(button('Done', '', () => post({ type: 'partsDone' })), button('All settings', 'secondary', () => post({ type: 'openSettings' }))));
      v.update = (s) => {
        const parts = Array.isArray(s.parts) ? s.parts : [];
        const ids = new Set(parts.map((p) => p.id));
        for (const [id, b] of v.boxes) if (!ids.has(id)) { b.label.remove(); v.boxes.delete(id); }
        for (const p of parts) {
          let b = v.boxes.get(p.id);
          if (!b) {
            b = { label: el('label', 'check'), box: input('checkbox', 'part'), text: el('span') };
            b.box.addEventListener('change', () => post({ type: 'part', id: p.id, on: b.box.checked }));
            b.label.append(b.box, b.text);
            v.boxes.set(p.id, b);
          }
          b.text.textContent = p.title || p.id;
          b.box.checked = !!p.on;
          v.list.appendChild(b.label);
        }
      };
    },
  };

  // ---- Connect Claude, in place: the company gateway's form, or every way as the panel offers them
  function buildClaude(v) {
    let connect = {}, gateway = {}, conflictKeys = [], held = '';   // held: the gateway token while Save anyway is offered
    const verdicts = [];
    const verdict = (way) => { const d = el('div', 'verdict'); d.dataset.way = way; verdicts.push(d); return d; };
    const clearVerdicts = () => { for (const d of verdicts) { d.textContent = ''; d.className = 'verdict'; } v.gwForce.hidden = true; v.bdForce.hidden = true; };
    const way = (id, name, about) => {
      const s = el('section', 'way'); s.dataset.way = id;
      const h = el('h3'); const n = el('span', 'wayName', name); const inUse = el('span', 'inuse', 'in use'); inUse.hidden = true;
      h.append(n, inUse);
      s.append(h, el('p', 'muted', about));
      return s;
    };

    // the company's gateway: its name, Get a key, the Key
    v.company = el('div', 'company');
    v.companyAbout = el('p', 'muted');
    v.companyKeySet = el('p', '', 'A key is saved. Paste another to replace it.');
    v.companyKey = input('password', 'companyKey');
    v.companySave = button('Check and save', '', () => {
      clearVerdicts(); v.saved.hidden = true;
      agents({ type: 'gatewaySave', baseUrl: '', token: v.companyKey.value.trim(), models: {}, force: false });
      v.companyKey.value = '';
    });
    onEnter(v.companyKey, v.companySave);
    v.companyVerdict = verdict('gateway');
    v.company.append(v.companyAbout, row(button('Get a key', 'secondary', () => agents({ type: 'getKey' }))), v.companyKeySet,
      field('Key', v.companyKey), row(v.companySave), v.companyVerdict);

    // every way
    v.ways = el('div', 'ways');
    v.connected = el('p', '', 'Claude is connected. You can choose another way at any time.'); v.connected.hidden = true;
    const gw = way('gateway', 'An LLM gateway', 'An Anthropic-compatible endpoint, such as a company\'s LLM proxy: its address and a key.');
    v.baseUrl = input('text', 'baseUrl', 'https://llm-gateway.example.com');
    v.gwToken = input('password', 'gatewayToken', 'The gateway\'s token');
    const gwSave = (force) => {
      clearVerdicts(); v.saved.hidden = true;
      const token = force ? held : v.gwToken.value.trim();
      held = force ? '' : token;
      agents({ type: 'gatewaySave', baseUrl: v.baseUrl.value.trim(), token, models: {}, force: !!force });
      v.gwToken.value = '';
    };
    v.gwSave = button('Check and save', '', () => gwSave(false));
    v.gwForce = button('Save anyway', 'secondary', () => gwSave(true)); v.gwForce.hidden = true;
    onEnter(v.gwToken, v.gwSave);
    // anything typed after an unexpected answer is unchecked: Save anyway goes, and the held token with it
    gw.addEventListener('input', () => { v.gwForce.hidden = true; held = ''; });
    gw.append(field('Base URL', v.baseUrl), field('Token', v.gwToken), row(v.gwSave, v.gwForce), verdict('gateway'));

    const sub = way('subscription', 'Claude subscription', 'Your Claude plan, with Claude Code\'s own sign-in in a terminal.');
    v.logIn = button('Log In', '', () => { clearVerdicts(); v.saved.hidden = true; agents({ type: 'subscription' }); });
    sub.append(row(v.logIn), verdict('subscription'));

    const ak = way('apiKey', 'Anthropic API key', 'Billed per token. The key is checked with Anthropic before it is saved.');
    v.apiKeySet = el('p', '', 'A key is saved. Paste another to replace it.'); v.apiKeySet.hidden = true;
    v.apiKey = input('password', 'apiKey', 'sk-ant-…');
    const akSave = button('Check and save', '', () => {
      clearVerdicts(); v.saved.hidden = true;
      agents({ type: 'apiKey', key: v.apiKey.value.trim() });
      v.apiKey.value = '';
    });
    onEnter(v.apiKey, akSave);
    ak.append(v.apiKeySet, field('Key', v.apiKey), row(akSave), verdict('apiKey'));

    const bd = way('bedrock', 'AWS Bedrock', 'Claude through Amazon Bedrock, in a region you choose.');
    v.bdPick = button('Use Bedrock…', '', () => { clearVerdicts(); agents({ type: 'bedrockPick' }); });
    v.bdPickRow = row(v.bdPick);
    v.profile = el('select'); v.profile.name = 'profile';
    v.region = input('text', 'region');
    let profiles = [], defaultRegion = 'us-east-1';
    v.profile.addEventListener('change', () => { const p = profiles.find((x) => x.name === v.profile.value); v.region.value = (p && p.region) || defaultRegion; });
    const bdSave = (force) => { clearVerdicts(); v.saved.hidden = true; agents({ type: 'bedrock', profile: v.profile.value, region: v.region.value.trim(), force: !!force }); };
    v.bdForce = button('Save anyway', 'secondary', () => bdSave(true)); v.bdForce.hidden = true;
    v.bdForm = el('div', 'bedrockForm'); v.bdForm.hidden = true;
    v.bdForm.append(el('p', 'muted', 'An AWS profile or SSO sign-in already on this machine, and a region.'),
      field('Profile', v.profile), field('Region', v.region), row(button('Check and save', '', () => bdSave(false)), v.bdForce));
    bd.append(v.bdPickRow, v.bdForm, verdict('bedrock'));
    v.ways.append(v.connected, gw, sub, ak, bd);

    // the terminal box, the user's own values to replace or keep, saved, a part not running, Not Now
    v.terminal = input('checkbox', 'terminal');
    v.terminal.addEventListener('change', () => agents({ type: 'terminal', on: v.terminal.checked }));
    const term = el('label', 'check'); term.append(v.terminal, el('span', '', 'Use for claude in the terminal too (writes ~/.claude/settings.json)'));
    v.conflicts = el('div', 'box'); v.conflicts.hidden = true;
    v.conflictList = el('ul');
    v.conflicts.append(el('p', '', '~/.claude/settings.json already holds values of yours:'), v.conflictList,
      row(button('Replace', '', () => { v.conflicts.hidden = true; agents({ type: 'replace', keys: conflictKeys.slice() }); }),
        button('Keep Mine', 'secondary', () => { v.conflicts.hidden = true; agents({ type: 'keep' }); })));
    v.saved = el('div', 'box'); v.saved.hidden = true;
    v.savedNote = el('span');
    const strong = el('strong', '', 'Saved.');
    const savedP = el('p'); savedP.append(strong, ' ', v.savedNote); v.saved.append(savedP);
    v.error = el('p', 'error'); v.error.hidden = true; v.error.setAttribute('role', 'alert');
    v.body.append(v.company, v.ways, term, v.conflicts, v.saved, v.error, row(button('Not Now', 'secondary', () => post({ type: 'notNow', step: 'claude' }))));

    const companyName = () => (state && state.claude && state.claude.companyGateway) || '';
    function show() {
      const name = companyName();
      v.company.hidden = !name; v.ways.hidden = !!name;
      v.companyAbout.textContent = name ? 'Get a key from ' + name + '\'s page, paste it below, and it is checked with the gateway before it is saved.' : '';
      v.companyKeySet.hidden = !gateway.tokenSet;
      v.gwToken.placeholder = gateway.tokenSet ? 'A token is set: leave empty to keep it' : 'The gateway\'s token';
      v.connected.hidden = !connect.connected;
      for (const s of v.ways.querySelectorAll('.way')) {
        const cur = s.dataset.way === connect.connection;
        s.classList.toggle('current', cur);
        s.querySelector('.inuse').hidden = !cur;
      }
      v.logIn.textContent = connect.loggedIn ? 'Use the Subscription' : 'Log In';
      v.apiKeySet.hidden = !connect.apiKeySet;
      v.bdForm.hidden = !connect.bedrockOpen;
      v.bdPickRow.hidden = !!connect.bedrockOpen;
      v.terminal.checked = !!(connect.terminal && connect.terminal.on);
    }
    function setConnect(s) {
      connect = s || {};
      profiles = Array.isArray(connect.profiles) ? connect.profiles : [];
      const b = connect.bedrock || {};
      defaultRegion = b.region || 'us-east-1';
      v.profile.textContent = '';
      const opt = (value, text) => { const o = el('option', '', text); o.value = value; v.profile.append(o); };
      opt('', 'default credentials');
      for (const p of profiles) opt(p.name, p.name);
      v.profile.value = profiles.some((p) => p.name === b.profile) ? b.profile : '';
      v.region.value = defaultRegion;
      v.conflicts.hidden = true;
      show();
    }
    function setGateway(s) {
      const before = gateway.baseUrl || '';
      gateway = s || {};
      if (v.baseUrl.value === '' || v.baseUrl.value === before) v.baseUrl.value = gateway.baseUrl || '';
      show();
    }
    const gatewayText = (text, ok) => { for (const d of verdicts) if (d.dataset.way === 'gateway') { d.textContent = text || ''; d.className = 'verdict' + (ok ? ' ok' : ''); } };

    v.reply = (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'state') setConnect(m.state);
      else if (m.type === 'verdict') {
        clearVerdicts();
        const d = verdicts.find((x) => x.dataset.way === m.way);
        if (m.way === 'gateway') gatewayText(m.text, m.ok);   // the company's form and the gateway way both
        else if (d) { d.textContent = m.text || ''; d.className = 'verdict' + (m.ok ? ' ok' : ''); }
        v.bdForce.hidden = !(m.way === 'bedrock' && m.canForce);
        v.saved.hidden = true;
      } else if (m.type === 'conflicts') {
        const list = Array.isArray(m.list) ? m.list : [];
        conflictKeys = list.map((x) => x.key);
        v.conflictList.textContent = '';
        const val = (x, none) => (x === undefined || x === null ? none : String(x));
        for (const x of list) v.conflictList.append(el('li', '', x.key + ': ' + val(x.from, '') + ' → ' + val(x.to, '(removed)')));
        v.conflicts.hidden = false; v.saved.hidden = true;
      } else if (m.type === 'saved') {
        clearVerdicts(); v.conflicts.hidden = true;
        v.savedNote.textContent = m.terminalNote || '';
        v.saved.hidden = false;
      } else if (m.type === 'gatewayState') setGateway(m.state);
      else if (m.type === 'gatewayError') { clearVerdicts(); held = ''; gatewayText(m.text, false); v.saved.hidden = true; }
      else if (m.type === 'gatewayVerdict') {
        clearVerdicts(); gatewayText(m.text, false); v.saved.hidden = true;
        v.gwForce.hidden = !m.canForce || !!companyName();
        if (v.gwForce.hidden) held = '';
      } else if (m.type === 'gatewaySaved') { clearVerdicts(); held = ''; setGateway(m.state); }
    };
    v.agentsError = (text) => { v.error.textContent = text || ''; v.error.hidden = !text; };
    v.update = () => show();
    v.onFirstOpen = () => { agents({ type: 'gatewayReady' }); agents({ type: 'ready' }); };
  }

  // ---- the steps
  function make(id) {
    const v = { id, root: el('section', 'step'), asked: false };
    v.root.dataset.id = id;
    const head = el('h2', 'head');
    v.tick = el('span', 'tick', '✓');
    v.name = el('span', 'name');
    v.name.tabIndex = 0;
    v.name.setAttribute('role', 'button');
    head.append(v.tick, v.name);
    v.waiting = el('p', 'waiting');
    v.body = el('div', 'body');
    v.body.append(v.waiting);
    v.root.append(head, v.body);
    const toggle = () => { if (openIds.has(id)) openIds.delete(id); else openIds.add(id); paintOpen(); };
    v.name.addEventListener('click', toggle);
    v.name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    if (BUILD[id]) BUILD[id](v);
    return v;
  }

  function paintOpen() {
    for (const [id, v] of views) {
      const isOpen = openIds.has(id);
      v.root.classList.toggle('open', isOpen);
      v.body.hidden = !isOpen;
      v.name.setAttribute('aria-expanded', String(isOpen));
      if (isOpen && !v.asked) { v.asked = true; if (v.onFirstOpen) v.onFirstOpen(); }
    }
  }

  function showState(s) {
    state = s;
    document.querySelector('h1').textContent = s.title || '';
    const steps = Array.isArray(s.steps) ? s.steps.filter((x) => x && typeof x.id === 'string') : [];
    const ids = new Set(steps.map((x) => x.id));
    for (const [id, v] of views) if (!ids.has(id)) { v.root.remove(); views.delete(id); openIds.delete(id); }
    const list = document.getElementById('steps');
    for (const x of steps) {
      let v = views.get(x.id);
      if (!v) { v = make(x.id); views.set(x.id, v); if (v.rows) v.rows(); }
      v.name.textContent = x.name || x.id;
      v.root.classList.toggle('done', !!x.done);
      v.tick.hidden = !x.done;
      v.waiting.textContent = x.waiting || '';
      v.waiting.hidden = !x.waiting;
      if (v.update) v.update(s);
      list.appendChild(v.root);   // in the steps' order
    }
    // the first not done opens; the one opened for that closes once done; any opened by hand stays as it is
    const first = steps.find((x) => !x.done);
    const firstId = first ? first.id : null;
    if (firstId !== auto) {
      const was = steps.find((x) => x.id === auto);
      if (was && was.done) openIds.delete(auto);
      if (firstId) openIds.add(firstId);
      auto = firstId;
    }
    paintOpen();
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'state' && m.state && typeof m.state === 'object') showState(m.state);
    else if (m.type === 'rows' && Array.isArray(m.rows)) { rows = m.rows; for (const v of views.values()) if (v.rows) v.rows(); }
    else if (m.type === 'agents') {
      const v = views.get('claude');
      if (!v) return;
      if (Array.isArray(m.replies)) { v.agentsError(''); for (const r of m.replies) v.reply(r); }
      else if (m.error) v.agentsError(String(m.error));
    } else if (m.type === 'jira') {
      const v = views.get('jira');
      if (v) v.jiraError(m.error ? String(m.error) : '');
    }
  });
  post({ type: 'ready' });
}

function getStartedHtml({ nonce, cspSource }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Get started</title>
<style nonce="${nonce}">${TOOLS_ROWS_CSS}
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 24px; max-width: 680px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 12px; }
  p { line-height: 1.5; margin: 6px 0; }
  .muted { color: var(--vscode-descriptionForeground); }
  .step { margin: 10px 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .step.open { border-color: var(--vscode-focusBorder); }
  .step .head { font-size: 1.1em; font-weight: 600; margin: 0; display: flex; gap: 8px; align-items: center; }
  .step .name { cursor: pointer; flex: 1; }
  .step .name:focus { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  .step .tick { color: var(--vscode-testing-iconPassed, var(--vscode-foreground)); }
  .step.done .name { color: var(--vscode-descriptionForeground); }
  .step .body { margin-top: 8px; }
  .waiting { font-style: italic; color: var(--vscode-descriptionForeground); }
  .way { margin: 10px 0; padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .way.current { border-color: var(--vscode-focusBorder); }
  .way h3 { font-size: 1em; font-weight: 600; margin: 0 0 4px; display: flex; gap: 8px; align-items: center; }
  .inuse { font-size: 0.85em; font-weight: normal; color: var(--vscode-descriptionForeground); }
  label { display: block; margin: 8px 0 4px; }
  label.check { display: flex; gap: 6px; align-items: center; }
  input[type=text], input[type=password], select { width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; outline: none; }
  input:focus, select:focus { border-color: var(--vscode-focusBorder); }
  button { font: inherit; cursor: pointer; padding: 4px 14px; border-radius: 2px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .verdict { margin-top: 6px; white-space: pre-wrap; color: var(--vscode-errorForeground); }
  .verdict.ok { color: var(--vscode-foreground); }
  .error { margin-top: 6px; white-space: pre-wrap; color: var(--vscode-errorForeground); }
  .box { margin-top: 12px; padding: 8px 10px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .box ul { margin: 6px 0; padding-left: 20px; }
  a { color: var(--vscode-textLink-foreground); }
  [hidden] { display: none !important; }
</style></head>
<body>
  <h1>Get started</h1>
  <div id="steps"></div>
<script nonce="${nonce}">
${toolsRowsScript()}
${GetStarted.toString()}
GetStarted(acquireVsCodeApi(), ToolsList, ${JSON.stringify(JIRA_TOKEN_PAGE)});
</script>
</body></html>`;
}

module.exports = { getStartedHtml };
