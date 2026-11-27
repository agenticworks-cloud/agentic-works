'use strict';
// The page of Agentic Works: Connect Your Tools: one row per MCP server in the company file, with its name, what it is for,
// its state, and the button its sign-in needs (connect.kind): tokenPage, Open the page then a token and Check and
// save; command, mcpTool and none, Connect. A sign-in tool's prompt (mcpTool) shows its text and Copy code and open
// (Open with no code, Copy code with no link); a conflict with an entry Claude Code already has offers Replace. The
// host (src/extension.js) does the work through Tools (src/tools.js) and sends the rows after every change.
// A row whose download needs GitHub's sign-in (action 'githubSignIn') offers Sign In to GitHub.
// Messages, page to host: ready; connect {id}; token {id, token}; openPage {id}; copyAndOpen {id}; replace {id};
// githubSignIn {id}.
// Host to page: rows {rows}, which never hold a token. No VS Code dependency.

const { TOOLS_ROWS_CSS, toolsRowsScript } = require('./toolsRows');

function getToolsHtml({ nonce, cspSource }) {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Connect Your Tools</title>
<style nonce="${nonce}">${TOOLS_ROWS_CSS}
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); background: var(--vscode-editor-background); padding: 16px 24px; max-width: 640px; }
  h1 { font-size: 1.4em; font-weight: 600; margin: 0 0 6px; }
  p { line-height: 1.5; margin: 6px 0; }
  .muted { color: var(--vscode-descriptionForeground); }
  [hidden] { display: none !important; }
</style></head>
<body>
  <h1>Connect Your Tools</h1>
  <p class="muted">Sign in to the tools your company set up for Claude. Once a tool is connected, Claude Code has it, in Claude tabs and in <code>claude</code> in the terminal.</p>
  <p id="empty" class="muted" hidden>Your company file lists no tools.</p>
  <div id="tools"></div>
<script nonce="${nonce}">
${toolsRowsScript()}
(function () {
  const vscode = acquireVsCodeApi();
  const post = (type, id, extra) => vscode.postMessage(Object.assign({ type: type, id: id }, extra || {}));
  const tools = ToolsList(document.getElementById('tools'), post);
  const show = (rows) => { tools.show(rows); document.getElementById('empty').hidden = rows.length > 0; };

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
