'use strict';
// The page of Agents: Set Up a Gateway…: a small form for the gateway file (gateway.js). The host fills it in with
// formState (never the token, only whether there is one) and answers a save with the file read back, or what is wrong.
// The key is checked with the gateway before it is saved (gatewayCheck.checkKey): a verdict that is not "works" is
// shown, and Save anyway is offered only when the host says so (canForce). With a company gateway (state.preset, from
// company.json) the form is that gateway's: no base URL and no model names, a Get a key button, a Key. With the
// company's key helper (preset.keyCommand), Get a key runs it in the host and the key it prints is checked and saved
// there; the page says "Getting your <name> key…" until the answer, and when it can't, the reason, Try again and the
// manual way (Open the key page, the Key, Check and save), which "Paste a key instead" also shows.
// Messages, page to host: ready; getKey; keyPage; save {baseUrl, token, models, force}; newTab; openFile. Host to page:
// state {state}; saved {state, answeredAt?}; error {text}; verdict {text, canForce}; keyFailed {text}. No VS Code
// dependency. (Sean, 2026-11-24)

const { MODEL_VARS } = require('./gateway');

const MODEL_LABELS = {
  ANTHROPIC_MODEL: 'Default model (ANTHROPIC_MODEL)',
  ANTHROPIC_DEFAULT_OPUS_MODEL: 'Opus (ANTHROPIC_DEFAULT_OPUS_MODEL)',
  ANTHROPIC_DEFAULT_SONNET_MODEL: 'Sonnet (ANTHROPIC_DEFAULT_SONNET_MODEL)',
  ANTHROPIC_DEFAULT_HAIKU_MODEL: 'Haiku (ANTHROPIC_DEFAULT_HAIKU_MODEL)',
};

function getGatewayFormHtml({ nonce, cspSource }) {
  const models = MODEL_VARS.map((k) => `<label for="${k}">${MODEL_LABELS[k]}</label><input id="${k}" type="text" spellcheck="false" autocomplete="off">`).join('\n      ');
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 24px; max-width: 560px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 6px; }
  p { line-height: 1.5; margin: 6px 0; }
  .muted { color: var(--vscode-descriptionForeground); }
  label { display: block; margin: 12px 0 4px; font-weight: 600; }
  details label { font-weight: normal; }
  input { width: 100%; box-sizing: border-box; padding: 4px 6px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; outline: none; }
  input:focus { border-color: var(--vscode-focusBorder); }
  details { margin-top: 14px; } summary { cursor: pointer; }
  button { font: inherit; cursor: pointer; padding: 4px 14px; border-radius: 2px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button.link { background: none; border: none; padding: 0; color: var(--vscode-textLink-foreground); }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 16px; }
  #tokenSet { display: flex; gap: 8px; align-items: center; }
  #error, #keyError { color: var(--vscode-errorForeground); margin-top: 10px; white-space: pre-wrap; }
  #waiting { font-style: italic; }
  #saved { margin-top: 16px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  [hidden] { display: none !important; }
  code { font-family: var(--vscode-editor-font-family); }
</style></head>
<body>
  <h1 id="title">Set up an LLM gateway</h1>
  <p class="muted" id="about">An Anthropic-compatible endpoint, such as a company's LLM proxy. Claude tabs on the gateway use it; Claude Code's own settings are not touched. The token is checked with the gateway, then kept only in <code id="file"></code>, readable by you alone.</p>
  <p class="muted" id="aboutPreset" hidden>Get a key from <span id="presetName"></span>'s page, paste it below, and it is checked with the gateway before it is saved, in <code id="presetFile"></code>, readable by you alone.</p>
  <p class="muted" id="aboutCommand" hidden>Get a key signs you in to <span id="commandName"></span> and gets your key; it is checked with the gateway before it is saved, in <code id="commandFile"></code>, readable by you alone.</p>
  <div class="row" id="getKeyRow" hidden><button type="button" class="secondary" id="getKey">Get a key</button><button type="button" class="secondary" id="keyPage" hidden>Open the key page</button><button type="button" class="link" id="paste" hidden>Paste a key instead</button></div>
  <p class="muted" id="waiting" hidden></p>
  <div id="keyError" role="alert" hidden></div>
  <form id="form" autocomplete="off">
    <label for="baseUrl" id="baseUrlLabel">Base URL</label>
    <input id="baseUrl" type="text" placeholder="https://llm-gateway.example.com" spellcheck="false">
    <label for="token" id="tokenLabel">Token</label>
    <div id="tokenSet" hidden><span>A token is set.</span><button type="button" class="link" id="replace">Replace</button></div>
    <input id="token" type="password" placeholder="The gateway's token" spellcheck="false">
    <details id="models">
      <summary>Model names (optional)</summary>
      <p class="muted">The gateway's names for Claude Code's models, if they differ. Leave empty for Claude Code's own.</p>
      ${models}
    </details>
    <div id="error" role="alert"></div>
    <div class="row"><button type="submit" id="save">Check and save</button><button type="button" class="secondary" id="force" hidden>Save anyway</button><button type="button" class="link" id="openFile">Open the file</button></div>
  </form>
  <div id="saved" hidden>
    <p><strong>Saved.</strong> <span id="answered"></span> <span class="muted">Claude tabs on the gateway use it from their next message.</span></p>
    <div class="row"><button type="button" id="newTab">New Claude Tab on the Gateway</button></div>
  </div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const MODELS = ${JSON.stringify(MODEL_VARS)};
  let tokenSet = false, preset = null, manual = false, running = false, failed = false;
  const helper = () => !!(preset && preset.keyCommand);
  // the key helper's controls: Get a key (Try again once it failed), the manual way behind a failure or Paste a key instead
  function showHelper() {
    const h = helper();
    $('aboutPreset').hidden = !preset || h; $('aboutCommand').hidden = !h;
    $('form').hidden = h && !manual;
    $('getKey').textContent = h && failed ? 'Try again' : 'Get a key';
    $('getKey').disabled = running;
    $('keyPage').hidden = !h || !manual;
    $('paste').hidden = !h || manual;
    $('waiting').hidden = !running;
    $('waiting').textContent = running && preset ? 'Getting your ' + preset.name + ' key…' : '';
  }
  function keyFailed(text) {
    running = false; failed = true; manual = true;
    $('keyError').textContent = text || ''; $('keyError').hidden = !text;
    showHelper();
  }
  function show(st) {
    preset = st.preset || null;
    $('title').textContent = preset ? 'Connect to ' + preset.name : 'Set up an LLM gateway';
    $('about').hidden = !!preset; $('getKeyRow').hidden = !preset; $('getKey').hidden = !preset;
    $('presetName').textContent = preset ? preset.name : ''; $('commandName').textContent = preset ? preset.name : '';
    $('file').textContent = st.file || ''; $('presetFile').textContent = st.file || ''; $('commandFile').textContent = st.file || '';
    for (const id of ['baseUrl', 'baseUrlLabel', 'models']) $(id).hidden = !!preset;
    $('tokenLabel').textContent = preset ? 'Key' : 'Token';
    $('token').placeholder = preset ? 'The key from ' + preset.name : "The gateway's token";
    $('force').hidden = true;
    $('baseUrl').value = st.baseUrl || '';
    tokenSet = !!st.tokenSet;
    $('tokenSet').hidden = !tokenSet;
    $('token').hidden = tokenSet;
    $('token').value = '';
    for (const k of MODELS) $(k).value = (st.models && st.models[k]) || '';
    showHelper();
  }
  $('replace').addEventListener('click', () => { $('tokenSet').hidden = true; $('token').hidden = false; $('token').focus(); });
  $('openFile').addEventListener('click', () => vscode.postMessage({ type: 'openFile' }));
  $('newTab').addEventListener('click', () => vscode.postMessage({ type: 'newTab' }));
  $('getKey').addEventListener('click', () => {
    if (helper()) {
      if (running) return;
      running = true; $('keyError').textContent = ''; $('keyError').hidden = true; $('error').textContent = ''; $('saved').hidden = true;
      showHelper();
    }
    vscode.postMessage({ type: 'getKey' });
  });
  $('keyPage').addEventListener('click', () => vscode.postMessage({ type: 'keyPage' }));
  $('paste').addEventListener('click', () => { manual = true; showHelper(); $('token').focus(); });
  $('form').addEventListener('input', () => { $('saved').hidden = true; $('force').hidden = true; });
  function save(force) {
    $('error').textContent = '';
    $('force').hidden = true;
    const models = {};
    if (!preset) for (const k of MODELS) models[k] = $(k).value.trim();
    vscode.postMessage({ type: 'save', baseUrl: preset ? '' : $('baseUrl').value.trim(), token: $('token').hidden ? '' : $('token').value.trim(), models, force: !!force });
  }
  $('form').addEventListener('submit', (e) => { e.preventDefault(); save(false); });
  $('force').addEventListener('click', () => save(true));
  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'state') { manual = false; failed = false; running = false; $('keyError').hidden = true; show(m.state); $('saved').hidden = true; }
    else if (m.type === 'saved') { running = false; failed = false; $('keyError').hidden = true; show(m.state); $('error').textContent = ''; $('answered').textContent = m.answeredAt ? 'Answered at ' + m.answeredAt + '.' : ''; $('saved').hidden = false; }
    else if (m.type === 'keyFailed') { $('saved').hidden = true; keyFailed(m.text); }
    else if (m.type === 'error' || m.type === 'verdict') {
      // a key from the helper that the check refuses: Try again and the manual way, as for a helper that can't
      if (running) keyFailed('');
      $('error').textContent = m.text || ''; $('saved').hidden = true; $('force').hidden = m.type === 'error' || !m.canForce;
    }
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body></html>`;
}

module.exports = { getGatewayFormHtml };
