'use strict';
// The rows of Connect Your Tools, as page-side source shared by every page that shows them (the tools page and the
// Get started page). toolsRowsScript() defines `function ToolsList(container, post)` returning { show(rows) }; each
// row is drawn once and kept across updates, so a token being typed survives. post(type, id, extra) sends a row's
// message: connect, token {token}, openPage, copyAndOpen, replace, githubSignIn. The rows never hold a token.
// No VS Code dependency.

const TOOLS_ROWS_CSS = `
  .tool h2 { font-size: 1.05em; font-weight: 600; margin: 0 0 4px; }
  .tool p { line-height: 1.5; margin: 6px 0; }
  .about { color: var(--vscode-descriptionForeground); }
  .tool { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--vscode-panel-border); border-radius: 4px; }
  .tool.connected { border-color: var(--vscode-focusBorder); }
  .state { margin: 6px 0; white-space: pre-wrap; }
  .state.bad { color: var(--vscode-errorForeground); }
  .prompt { margin: 8px 0; padding: 6px 8px; white-space: pre-wrap; font-family: var(--vscode-editor-font-family); background: var(--vscode-textCodeBlock-background); border-radius: 2px; }
  .tool input[type=password] { flex: 1; box-sizing: border-box; padding: 4px 6px; font: inherit; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border, var(--vscode-panel-border)); border-radius: 2px; outline: none; }
  .tool input:focus { border-color: var(--vscode-focusBorder); }
  .tool button { font: inherit; cursor: pointer; padding: 4px 14px; border-radius: 2px; border: 1px solid var(--vscode-button-border, transparent); background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .tool button:hover { background: var(--vscode-button-hoverBackground); }
  .tool button:disabled { opacity: 0.5; cursor: default; }
  .tool button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  .tool .row { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .conflict { margin-top: 8px; }
  .tool [hidden] { display: none !important; }
  .tool[hidden] { display: none !important; }
`;

// Written as a real function (so it is linted and needs no escaping) and sent to the page as its source.
function ToolsList(container, post) {
  const views = new Map();   // id → the row's elements, kept across updates
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
  const button = (text, cls, onClick) => { const b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', onClick); return b; };

  function stateText(r) {
    if (r.state === 'connected') return 'Connected';
    if (r.state === 'checking') return 'Checking…';
    if (r.state === 'connecting') return r.reason ? 'Connecting… ' + r.reason : 'Connecting…';
    if (r.state === 'unknown') return 'Not checked yet';
    if (r.signedIn) {
      // signed in, but Claude Code wasn't given the server: Tools' reasons for that already start "Signed in, but"
      if (/^Signed in\b/.test(r.reason)) return r.reason;
      return 'Signed in, but couldn\'t register' + (r.reason ? ': ' + r.reason : '');
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
      v.connect = button(r.button || 'Connect', '', () => post('connect', r.id));
      const a = el('div', 'row'); a.append(v.connect);
      v.root.append(a);
      v.buttons.push(v.connect);
    }
    v.prompt = el('div');
    v.promptText = el('div', 'prompt');
    v.copy = button('Copy code and open', '', () => post('copyAndOpen', r.id));
    const p = el('div', 'row'); p.append(v.copy);
    v.prompt.append(v.promptText, p);
    v.github = button('Sign In to GitHub', '', () => post('githubSignIn', r.id));
    v.githubRow = el('div', 'row'); v.githubRow.append(v.github);
    v.conflict = el('div', 'conflict');
    v.conflictText = el('p');
    v.replace = button('Replace', '', () => post('replace', r.id));
    v.conflict.append(v.conflictText, v.replace);
    v.root.append(v.githubRow, v.prompt, v.conflict);
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
    v.githubRow.hidden = r.action !== 'githubSignIn';
    v.github.disabled = busy;
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
      container.appendChild(v.root);   // in the rows' order
    }
  }

  return { show };
}

const toolsRowsScript = () => ToolsList.toString();

module.exports = { TOOLS_ROWS_CSS, toolsRowsScript };
