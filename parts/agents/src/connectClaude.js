'use strict';
// The page of Agents: Connect Claude…: the ways Claude can run, one section each, in order: an LLM gateway, the Claude
// subscription, an Anthropic API key, AWS Bedrock, Codex only. With a company gateway (state.company) the page offers
// that gateway only, and a line on switching a tab's backend in its footer instead, Codex's too. (Sean, 2026-11-24.)
// Bedrock's form, and anything about AWS, shows only once Bedrock is picked (state.bedrockOpen). The host does each
// way's work (the gateway form, the login, the checks, the saves) and answers; the page never holds a saved key, only
// whether there is one. The terminal box asks for terminal claude's settings too, for every way but Codex only.
// Messages, page to host: ready; gateway; subscription; apiKey {key}; bedrockPick; bedrock {profile, region, force};
// codex; terminal {on}; replace {keys}; keep; newTab. Host to page: state {state}; verdict {way, text, ok, canForce};
// conflicts {way, list: [{key, from, to}]} (masked); saved {way, terminalNote}. No VS Code dependency. (Sean, 2026-11-24)

function getConnectClaudeHtml({ nonce, cspSource }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 24px; max-width: 600px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 1.05em; font-weight: 600; margin: 0 0 4px; display: flex; gap: 8px; align-items: center; }
  p { line-height: 1.5; margin: 6px 0; }
  .muted { color: var(--vscode-descriptionForeground); }
  .way { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .way.current { border-color: var(--vscode-focusBorder); }
  .badge { font-size: 0.8em; font-weight: normal; padding: 1px 6px; border-radius: 8px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .inuse { font-size: 0.85em; font-weight: normal; color: var(--vscode-descriptionForeground); }
  label { display: block; margin: 8px 0 4px; }
  input[type=text], input[type=password], select { width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; outline: none; }
  input:focus, select:focus { border-color: var(--vscode-focusBorder); }
  #terminalRow { display: flex; gap: 6px; align-items: center; margin: 14px 0 0; }
  button { font: inherit; cursor: pointer; padding: 4px 14px; border-radius: 2px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .verdict { margin-top: 6px; white-space: pre-wrap; color: var(--vscode-errorForeground); }
  .verdict.ok { color: var(--vscode-foreground); }
  #conflicts, #saved { margin-top: 16px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  #conflictList { margin: 6px 0; padding-left: 20px; }
  [hidden] { display: none !important; }
  code { font-family: var(--vscode-editor-font-family); }
</style></head>
<body>
  <h1>Connect Claude</h1>
  <p class="muted">Choose how Claude tabs run. Only Claude tabs use the choice, unless the terminal box below is ticked.</p>
  <p id="connected" hidden><strong>Claude is connected.</strong> <span class="muted">You can choose another way at any time.</span></p>

  <section class="way" data-way="gateway">
    <h2><span class="name">An LLM gateway</span><span class="badge" id="recommended" hidden>Recommended</span><span class="inuse" hidden>in use</span></h2>
    <p class="muted" id="gatewayAbout">An Anthropic-compatible endpoint, such as a company's LLM proxy: its address and a key, in a short form.</p>
    <div class="row"><button type="button" id="gatewayBtn">Set Up…</button></div>
    <div class="verdict" id="verdict-gateway"></div>
  </section>

  <section class="way" data-way="subscription">
    <h2><span class="name">Claude subscription</span><span class="inuse" hidden>in use</span></h2>
    <p class="muted">Your Claude plan, with Claude Code's own sign-in in a terminal.</p>
    <div class="row"><button type="button" id="subscriptionBtn">Log In</button></div>
    <div class="verdict" id="verdict-subscription"></div>
  </section>

  <section class="way" data-way="apiKey">
    <h2><span class="name">Anthropic API key</span><span class="inuse" hidden>in use</span></h2>
    <p class="muted">Billed per token. The key is checked with Anthropic, then kept in <code>~/.config/roost/anthropic-key</code>, readable by you alone.</p>
    <p id="apiKeySet" hidden>A key is saved. Paste another to replace it.</p>
    <label for="apiKey">Key</label>
    <input id="apiKey" type="password" placeholder="sk-ant-…" spellcheck="false" autocomplete="off">
    <div class="row"><button type="button" id="apiKeyBtn">Check and save</button></div>
    <div class="verdict" id="verdict-apiKey"></div>
  </section>

  <section class="way" data-way="bedrock">
    <h2><span class="name">AWS Bedrock</span><span class="inuse" hidden>in use</span></h2>
    <p class="muted">Claude through Amazon Bedrock, in a region you choose.</p>
    <div class="row" id="bedrockPickRow"><button type="button" id="bedrockPick">Use Bedrock…</button></div>
    <div id="bedrockForm" hidden>
      <p class="muted">An AWS profile or SSO sign-in already on this machine, and a region. Checked with the AWS CLI's model list.</p>
      <label for="profile">Profile</label>
      <select id="profile"></select>
      <label for="region">Region</label>
      <input id="region" type="text" spellcheck="false" autocomplete="off">
      <div class="row"><button type="button" id="bedrockBtn">Check and save</button><button type="button" class="secondary" id="bedrockForce" hidden>Save anyway</button></div>
    </div>
    <div class="verdict" id="verdict-bedrock"></div>
  </section>

  <section class="way" data-way="codex">
    <h2><span class="name">Codex only</span><span class="inuse" hidden>in use</span></h2>
    <p class="muted">No Claude: use Codex tabs.</p>
    <div class="row"><button type="button" id="codexBtn">Use Codex Only</button></div>
    <div class="verdict" id="verdict-codex"></div>
  </section>

  <p class="muted" id="switchNote" hidden>Using your own Claude subscription, an API key or Bedrock, or Codex? Switch any tab's backend in its footer whenever you like; a Codex tab's footer offers ChatGPT login, an OpenAI API key or Bedrock.</p>

  <label id="terminalRow"><input type="checkbox" id="terminal"> <span>Use for <code>claude</code> in the terminal too (writes <code>~/.claude/settings.json</code>)</span></label>

  <div id="conflicts" hidden>
    <p><code>~/.claude/settings.json</code> already holds values of yours:</p>
    <ul id="conflictList"></ul>
    <div class="row"><button type="button" id="replace">Replace</button><button type="button" class="secondary" id="keep">Keep Mine</button></div>
  </div>

  <div id="saved" hidden>
    <p><strong>Saved.</strong> <span id="terminalNote"></span></p>
    <div class="row"><button type="button" id="newTab">New Claude Tab</button></div>
  </div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const WAYS = ['gateway', 'subscription', 'apiKey', 'bedrock', 'codex'], COMPANY_WAYS = ['gateway'];
  let profiles = [], defaultRegion = 'us-east-1', conflictKeys = [];
  const post = (m) => vscode.postMessage(m);
  function clearVerdicts() { for (const w of WAYS) { $('verdict-' + w).textContent = ''; $('verdict-' + w).className = 'verdict'; } $('bedrockForce').hidden = true; }
  function show(st) {
    const company = st.company || null;
    document.querySelector('.way[data-way="gateway"] .name').textContent = company ? company.gatewayName : 'An LLM gateway';
    $('recommended').hidden = !company;
    $('gatewayAbout').textContent = company ? 'Your company\\'s gateway: get a key from its page, and it is checked before it is saved.' : 'An Anthropic-compatible endpoint, such as a company\\'s LLM proxy: its address and a key, in a short form.';
    // a company gateway: that gateway only; the other ways, Codex's too, are a tab footer's
    for (const sec of document.querySelectorAll('.way')) sec.hidden = !!company && !COMPANY_WAYS.includes(sec.dataset.way);
    $('switchNote').hidden = !company;
    $('bedrockForm').hidden = !st.bedrockOpen;
    $('bedrockPickRow').hidden = !!st.bedrockOpen;
    for (const sec of document.querySelectorAll('.way')) {
      const cur = sec.dataset.way === st.connection;
      sec.classList.toggle('current', cur);
      sec.querySelector('.inuse').hidden = !cur;
    }
    $('connected').hidden = !st.connected;
    $('subscriptionBtn').textContent = st.loggedIn ? 'Use the Subscription' : 'Log In';
    $('apiKeySet').hidden = !st.apiKeySet;
    $('apiKey').value = '';
    profiles = Array.isArray(st.profiles) ? st.profiles : [];
    const b = st.bedrock || {};
    defaultRegion = b.region || 'us-east-1';
    const sel = $('profile');
    sel.textContent = '';
    const opt = (value, text) => { const o = document.createElement('option'); o.value = value; o.textContent = text; sel.append(o); };
    opt('', 'default credentials');
    for (const p of profiles) opt(p.name, p.name);
    sel.value = profiles.some((p) => p.name === b.profile) ? b.profile : '';
    $('region').value = defaultRegion;
    const t = st.terminal || {};
    $('terminalRow').hidden = !t.offered;
    $('terminal').checked = !!t.on;
  }
  $('profile').addEventListener('change', () => {
    const p = profiles.find((x) => x.name === $('profile').value);
    $('region').value = (p && p.region) || defaultRegion;
  });
  $('terminal').addEventListener('change', () => post({ type: 'terminal', on: $('terminal').checked }));
  $('gatewayBtn').addEventListener('click', () => { clearVerdicts(); post({ type: 'gateway' }); });
  $('subscriptionBtn').addEventListener('click', () => { clearVerdicts(); post({ type: 'subscription' }); });
  $('bedrockPick').addEventListener('click', () => { clearVerdicts(); post({ type: 'bedrockPick' }); });
  $('codexBtn').addEventListener('click', () => { clearVerdicts(); post({ type: 'codex' }); });
  $('apiKeyBtn').addEventListener('click', () => { clearVerdicts(); $('saved').hidden = true; post({ type: 'apiKey', key: $('apiKey').value.trim() }); });
  const bedrock = (force) => { clearVerdicts(); $('saved').hidden = true; post({ type: 'bedrock', profile: $('profile').value, region: $('region').value.trim(), force: !!force }); };
  $('bedrockBtn').addEventListener('click', () => bedrock(false));
  $('bedrockForce').addEventListener('click', () => bedrock(true));
  $('replace').addEventListener('click', () => { $('conflicts').hidden = true; post({ type: 'replace', keys: conflictKeys.slice() }); });
  $('keep').addEventListener('click', () => { $('conflicts').hidden = true; post({ type: 'keep' }); });
  $('newTab').addEventListener('click', () => post({ type: 'newTab' }));
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'state') { show(m.state || {}); $('conflicts').hidden = true; }
    else if (m.type === 'verdict') {
      clearVerdicts();
      const v = $('verdict-' + m.way);
      if (v) { v.textContent = m.text || ''; v.className = 'verdict' + (m.ok ? ' ok' : ''); }
      $('bedrockForce').hidden = !(m.way === 'bedrock' && m.canForce);
      $('saved').hidden = true;
    } else if (m.type === 'conflicts') {
      const list = Array.isArray(m.list) ? m.list : [];
      conflictKeys = list.map((c) => c.key);
      const ul = $('conflictList'); ul.textContent = '';
      for (const c of list) { const li = document.createElement('li'); li.textContent = c.key + ': ' + (c.from === undefined || c.from === null ? '' : c.from) + ' \\u2192 ' + (c.to === undefined || c.to === null ? '(removed)' : c.to); ul.append(li); }
      $('conflicts').hidden = false; $('saved').hidden = true;
    } else if (m.type === 'saved') {
      clearVerdicts();
      $('conflicts').hidden = true;
      $('terminalNote').textContent = m.terminalNote || '';
      $('saved').hidden = false;
    }
  });
  post({ type: 'ready' });
})();
</script>
</body></html>`;
}

module.exports = { getConnectClaudeHtml };
