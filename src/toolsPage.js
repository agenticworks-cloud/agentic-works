'use strict';
// The page of Roost: Connect Your Tools: one row per MCP server in the company file, with its name, what it is for,
// its state, and the button its sign-in needs (connect.kind): tokenPage, Open the page then a token and Check and
// save; command, mcpTool and none, Connect. A sign-in tool's prompt (mcpTool) shows its text and Copy code and open
// (Open with no code, Copy code with no link); a conflict with an entry Claude Code already has offers Replace. The
// host (src/extension.js) does the work through Tools (src/tools.js) and sends the rows after every change.
// Messages, page to host: ready; connect {id}; token {id, token}; openPage {id}; copyAndOpen {id}; replace {id}.
// Host to page: rows {rows}, which never hold a token. No VS Code dependency.

function getToolsHtml({ nonce, cspSource }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connect Your Tools</title>
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 24px; max-width: 640px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 6px; }
  h2 { font-size: 1.05em; font-weight: 600; margin: 0 0 4px; }
  p { line-height: 1.5; margin: 6px 0; }
  .muted, .about { color: var(--vscode-descriptionForeground); }
  .tool { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .tool.connected { border-color: var(--vscode-focusBorder); }
  .state { margin: 6px 0; white-space: pre-wrap; }
  .state.bad { color: var(--vscode-errorForeground); }
  .prompt { margin: 8px 0; padding: 6px 8px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); border-radius: 2px; }
  input[type=password] { flex: 1; box-sizing: border-box; padding: 4px 6px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; outline: none; }
  input:focus { border-color: var(--vscode-focusBorder); }
  button { font: inherit; cursor: pointer; padding: 4px 14px; border-radius: 2px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  button:disabled { opacity: 0.5; cursor: default; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .conflict { margin-top: 8px; }
  [hidden] { display: none !important; }
</style></head>
<body>
  <h1>Connect Your Tools</h1>
  <p class="muted">Sign in to the tools your company set up for Claude. Once a tool is connected, Claude Code has it, in Claude tabs and in <code>claude</code> in the terminal.</p>
  <p id="empty" class="muted" hidden>Your company file lists no tools.</p>
  <div id="tools"></div>
<script nonce="${nonce}">
(function () {
  const vscode = acquireVsCodeApi();
  const list = document.getElementById('tools');
  const views = new Map();   // id → the row's elements, kept across updates so a token being typed survives
  const post = (type, id, extra) => vscode.postMessage(Object.assign({ type: type, id: id }, extra || {}));
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const button = (text, cls, onClick) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

  function stateText(r) {
    if (r.state === 'connected') return 'Connected';
    if (r.state === 'checking') return 'Checking…';
    if (r.state === 'connecting') return r.reason ? 'Connecting… ' + r.reason : 'Connecting…';
    if (r.state === 'unknown') return 'Not checked yet';
    if (r.signedIn) {
      // signed in, but Claude Code wasn't given the server: Tools' reasons for that already start "Signed in, but"
      if (/^Signed in\\b/.test(r.reason)) return r.reason;
      return 'Signed in, but couldn\\'t register' + (r.reason ? ': ' + r.reason : '');
    }
    return r.reason ? 'Not connected: ' + r.reason : 'Not connected';
  }

  function make(r) {
    const v = { id: r.id, root: el('section', 'tool') };
    v.root.dataset.id = r.id;
    v.name = el('h2', 'name');
    v.about = el('p', 'about');
    v.state = el('p', 'state');
    v.root.append(v.name, v.about, v.state);
    v.buttons = [];
    if (r.kind === 'tokenPage') {
      v.open = button('Open the page', 'secondary', () => post('openPage', r.id));
      v.token = el('input');
      v.token.type = 'password';
      v.token.placeholder = 'Paste the token';
      v.token.spellcheck = false;
      v.token.autocomplete = 'off';
      v.save = button('Check and save', '', () => {
        post('token', r.id, { token: v.token.value.trim() });
        v.token.value = '';
      });
      v.token.addEventListener('keydown', (e) => { if (e.key === 'Enter') v.save.click(); });
      const a = el('div', 'row'); a.append(v.open);
      const b = el('div', 'row'); b.append(v.token, v.save);
      v.root.append(a, b);
      v.buttons.push(v.open, v.save);
    } else {
      v.connect = button('Connect', '', () => post('connect', r.id));
      const a = el('div', 'row'); a.append(v.connect);
      v.root.append(a);
      v.buttons.push(v.connect);
    }
    v.prompt = el('div');
    v.promptText = el('div', 'prompt');
    v.copy = button('Copy code and open', '', () => post('copyAndOpen', r.id));
    const p = el('div', 'row'); p.append(v.copy);
    v.prompt.append(v.promptText, p);
    v.conflict = el('div', 'conflict');
    v.conflictText = el('p');
    v.replace = button('Replace', '', () => post('replace', r.id));
    v.conflict.append(v.conflictText, v.replace);
    v.root.append(v.prompt, v.conflict);
    return v;
  }

  function update(v, r) {
    v.name.textContent = r.name || r.id;
    v.about.textContent = r.about || '';
    v.about.hidden = !r.about;
    v.state.textContent = stateText(r);
    v.state.className = 'state' + (r.state === 'notConnected' ? ' bad' : '');
    v.root.className = 'tool' + (r.state === 'connected' ? ' connected' : '');
    const busy = r.state === 'checking' || r.state === 'connecting';
    for (const b of v.buttons) b.disabled = busy;
    const pr = r.prompt;
    v.prompt.hidden = !pr;
    if (pr) {
      v.promptText.textContent = pr.text || '';
      v.copy.textContent = pr.url && pr.code ? 'Copy code and open' : pr.url ? 'Open' : 'Copy code';
      v.copy.hidden = !pr.url && !pr.code;
    }
    v.conflict.hidden = !r.conflict;
    v.conflictText.textContent = 'Claude Code already has a server named ' + r.id + '. Replace it with this one?';
    v.replace.disabled = busy;
  }

  function show(rows) {
    const ids = new Set(rows.map((r) => r.id));
    for (const [id, v] of views) if (!ids.has(id)) { v.root.remove(); views.delete(id); }
    for (const r of rows) {
      let v = views.get(r.id);
      if (!v || v.kind !== r.kind) {
        if (v) v.root.remove();
        v = make(r);
        v.kind = r.kind;
        views.set(r.id, v);
      }
      update(v, r);
      list.appendChild(v.root);   // in the rows' order
    }
    document.getElementById('empty').hidden = rows.length > 0;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (m && m.type === 'rows' && Array.isArray(m.rows)) show(m.rows);
  });
  vscode.postMessage({ type: 'ready' });
})();
</script>
</body></html>`;
}

module.exports = { getToolsHtml };
