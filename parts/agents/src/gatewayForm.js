'use strict';
// The page of Agents: Set Up a Gateway…: a small form for the gateway file (gateway.js). The host fills it in with
// formState (never the token, only whether there is one) and answers a save with the file read back, or what is wrong.
// The key is checked with the gateway before it is saved (gatewayCheck.checkKey): a verdict that is not "works" is
// shown, and Save anyway is offered only when the host says so (canForce). With a company gateway (state.preset, from
// company.json) the form is that gateway's: no base URL and no model names, a Get a key button, a Key.
// Messages, page to host: ready; getKey; save {baseUrl, token, models, force}; newTab; openFile. Host to page: state
// {state}; saved {state, answeredAt?}; error {text}; verdict {text, canForce}. No VS Code dependency. (Sean, 2026-11-24)

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
  #error { color: var(--vscode-errorForeground); margin-top: 10px; white-space: pre-wrap; }
  #saved { margin-top: 16px; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  [hidden] { display: none !important; }
  code { font-family: var(--vscode-editor-font-family); }
</style></head>
<body>
  <h1 id="title">Set up an LLM gateway</h1>
  <p class="muted" id="about">An Anthropic-compatible endpoint, such as a company's LLM proxy. Claude tabs on the gateway use it; Claude Code's own settings are not touched. The token is checked with the gateway, then kept only in <code id="file"></code>, readable by you alone.</p>
  <p class="muted" id="aboutPreset" hidden>Get a key from <span id="presetName"></span>'s page, paste it below, and it is checked with the gateway before it is saved, in <code id="presetFile"></code>, readable by you alone.</p>
  <div class="row" id="getKeyRow" hidden><button type="button" class="secondary" id="getKey">Get a key</button></div>
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
  let tokenSet = false, preset = null;
  function show(st) {
    preset = st.preset || null;
    $('title').textContent = preset ? 'Connect to ' + preset.name : 'Set up an LLM gateway';
    $('about').hidden = !!preset; $('aboutPreset').hidden = !preset; $('getKeyRow').hidden = !preset; $('getKey').hidden = !preset;
    $('presetName').textContent = preset ? preset.name : '';
    $('file').textContent = st.file || ''; $('presetFile').textContent = st.file || '';
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
  }
  $('replace').addEventListener('click', () => { $('tokenSet').hidden = true; $('token').hidden = false; $('token').focus(); });
  $('openFile').addEventListener('click', () => vscode.postMessage({ type: 'openFile' }));
  $('newTab').addEventListener('click', () => vscode.postMessage({ type: 'newTab' }));
  $('getKey').addEventListener('click', () => vscode.postMessage({ type: 'getKey' }));
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
    if (m.type === 'state') { show(m.state); $('saved').hidden = true; }
    else if (m.type === 'saved') { show(m.state); $('error').textContent = ''; $('answered').textContent = m.answeredAt ? 'Answered at ' + m.answeredAt + '.' : ''; $('saved').hidden = false; }
    else if (m.type === 'error') { $('error').textContent = m.text || ''; $('saved').hidden = true; $('force').hidden = true; }
    else if (m.type === 'verdict') { $('error').textContent = m.text || ''; $('saved').hidden = true; $('force').hidden = !m.canForce; }
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body></html>`;
}

module.exports = { getGatewayFormHtml };
