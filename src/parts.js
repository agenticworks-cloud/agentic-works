'use strict';
// The parts under parts/<name>/, read from their part.json files, and the context each part is started with.
const fs = require('node:fs');
const path = require('node:path');

// Every folder of <root>/parts that has a part.json, in folder-name order: { id, title, dir, entry, needs, webviews }.
// `entry` is as written in part.json, relative to `dir`; `webviews` are the webview types its package.json activates
// on (onWebviewPanel:<type>), the tabs VS Code may bring back for it.
function readParts(root) {
  const partsDir = path.join(root, 'parts');
  return fs
    .readdirSync(partsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(partsDir, d.name, 'part.json')))
    .map((d) => d.name)
    .sort()
    .map((name) => {
      const dir = path.join(partsDir, name);
      const { id, title, entry, needs } = JSON.parse(fs.readFileSync(path.join(dir, 'part.json'), 'utf8'));
      return { id, title, dir, entry, needs: needs || [], webviews: webviewTypes(dir) };
    });
}

function webviewTypes(dir) {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return [];
  const events = JSON.parse(fs.readFileSync(file, 'utf8')).activationEvents || [];
  return events.filter((e) => e.startsWith('onWebviewPanel:')).map((e) => e.slice('onWebviewPanel:'.length));
}

// Agentic Works' context as the part's own: everything of `base` (globalState, workspaceState, secrets, storage and log
// URIs, extension, extensionMode, environmentVariableCollection, ...) through the prototype, so getters are read
// only when the part reads them; its own `subscriptions`, and its folder as extensionUri/extensionPath.
function partContext(base, part) {
  const vscode = require('vscode');
  const ctx = Object.create(base);
  Object.defineProperties(ctx, {
    subscriptions: { value: [], enumerable: true },
    // joined onto Agentic Works' URI, which keeps its scheme in a remote window; extensionPath stays a filesystem path
    extensionUri: { value: vscode.Uri.joinPath(base.extensionUri, 'parts', path.basename(part.dir)), enumerable: true },
    extensionPath: { value: part.dir, enumerable: true },
    asAbsolutePath: { value: (rel) => path.join(part.dir, rel), enumerable: true },
  });
  return ctx;
}

module.exports = { readParts, partContext };
