'use strict';
// Roost's entry point: starts each part under parts/ whose roost.<id>.enabled setting is on, with a context of its
// own; starts or stops a part when its setting changes; a part that throws at start is reported once and left off.
// Before a part is switched off it may say no (its confirmStop), which puts the switch back on. While a part is off,
// tabs VS Code brings back for it are closed, so they do not hang without a page; the part's own saved tab list,
// which it restores from when it starts, is left as it is. A part's views and commands show while its setting is on
// and its context key roost.<id>.failed is not set; Roost sets that key from a failed start until the next good one.
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const vscode = require('vscode');
const { readParts, partContext } = require('./parts');
const { companyFile, readCompany } = require('./company');
const { Tools } = require('./tools');
const { getToolsHtml } = require('./toolsPage');
const { watchContexts } = require('./contextWatch');
const { GetStarted } = require('./getStarted');

const settingKey = (id) => `roost.${id}.enabled`;
const failedKey = (id) => `roost.${id}.failed`;
const FIRST_START_KEY = 'roost.firstStart.done';
// The parts' context keys the Get started page ticks on: VS Code cannot read one back, so Roost notes their setContext
const WATCHED_CONTEXTS = ['kestrel.signedIn', 'perch.gatewayReady', 'perch.claudeConnected', 'perch.messageSent', 'chirp.signedIn', 'jay.signedIn'];
const PRS_VIEW_COMMAND = 'workbench.view.extension.kestrel';   // kestrel's panel view container id
const AGENTS_VIEW_COMMAND = 'workbench.view.extension.perch';  // Perch's activity-bar container id: opens the side bar on it
// The Agents part was called perch in 0.1.0: while roost.agents.enabled is set nowhere, a roost.perch.enabled the
// user set then still decides (read only, never written or removed).
const OLD_SWITCH = { agents: 'perch' };
const isEnabled = (id) => {
  const config = vscode.workspace.getConfiguration('roost');
  const old = OLD_SWITCH[id];
  if (old) {
    const now = config.inspect(`${id}.enabled`) || {};
    const setNow = [now.globalValue, now.workspaceValue, now.workspaceFolderValue].some((v) => v !== undefined);
    const before = config.get(`${old}.enabled`);
    if (!setNow && typeof before === 'boolean') return before;
  }
  return config.get(`${id}.enabled`, true);
};
const errorText = (e) => (e && e.stack) || String(e);
const TOOLS_PANEL_TYPE = 'roost.tools';
const NO_TOOLS = 'Your company file lists no tools.';
// One argument for a POSIX shell: as it is when it is plainly safe, else in single quotes
const shellQuote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);
const isWeb = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

class Roost {
  // `makeTools`: for tests, a stand-in for Connect Your Tools' Tools (src/tools.js); `ghLogins`: the accounts gh is
  // signed in to (tests never run this machine's gh)
  constructor(base, parts, output, { makeTools = (opts) => new Tools(opts), ghLogins = defaultGhLogins } = {}) {
    this.base = base;
    this.output = output;
    this.makeTools = makeTools;
    this.ghLogins = ghLogins;
    this.getStarted = null;            // the Get started page's host (src/getStarted.js), made once startAll has begun
    this.tools = null;                 // made the first time Connect Your Tools (or a sign-in that uses it) needs it
    this.toolsPanel = null;
    this.toolsChecked = Promise.resolve();
    // id → { part, state: 'on'|'off'|'failed', failed, context, module, queue, closers, serializers }
    // `failed`: what roost.<id>.failed was last set to; `serializers`: the part's own, however it registered them
    this.parts = new Map(parts.map((part) => [part.id, {
      part, state: 'off', failed: false, context: null, module: null, queue: Promise.resolve(), closers: null, serializers: new Set(),
    }]));
    this.owners = new Map();           // webview type → its part's entry
    for (const e of this.parts.values()) for (const type of e.part.webviews) this.owners.set(type, e);
  }

  state(id) { return this.entry(id).state; }

  isEnabled(id) { return isEnabled(id); }

  entry(id) {
    const e = this.parts.get(id);
    if (!e) throw new Error(`Roost: no part ${id}`);
    return e;
  }

  // Starts and stops of one part run one after another, in the order asked; one that fails is logged and does not
  // hold up the next. Once each has settled, onPartsChanged.
  queue(id, op) {
    const e = this.entry(id);
    const p = e.queue.then(() => op(e));
    e.queue = p.catch((err) => this.log(`${e.part.title}: a start or stop failed: ${errorText(err)}`))
      .then(() => this.onPartsChanged());
    return p;
  }

  // A part started, stopped or failed: the Get started page shows its steps or hides them
  onPartsChanged() {
    try {
      if (this.getStarted) this.getStarted.refresh();
    } catch (err) {
      this.log(`Roost could not refresh its Get started page: ${errorText(err)}`);
    }
  }

  log(line) { this.output.appendLine(line); }

  start(id) {
    return this.queue(id, async (e) => {
      if (e.state === 'on') return;
      const { part } = e;
      this.stopClosingTabs(e);           // the part registers its own serializers
      const context = partContext(this.base, part);
      e.context = context;
      try {
        e.module = require(path.join(part.dir, part.entry));
        await e.module.activate(context);
      } catch (err) {
        e.state = 'failed';
        this.log(`${part.title} could not start: ${errorText(err)}`);
        await this.release(e);
        this.closeRestoredTabs(e);
        await this.setFailed(e, true);
        vscode.window.showErrorMessage(`Roost: ${part.title} could not start.`, 'Show Log').then((choice) => {
          if (choice === 'Show Log') this.output.show();
        });
        return;
      }
      e.state = 'on';
      if (e.failed) await this.setFailed(e, false);
    });
  }

  // `ask`: the user switched it off, so the part may say no first (the window closing asks nothing). No context key
  // is set: the setting itself hides the part's views, and a failed part stays marked until it starts.
  stop(id, { ask = false } = {}) {
    return this.queue(id, async (e) => {
      if (e.state === 'off') return;
      if (ask && e.state === 'on' && !(await this.confirmStop(e))) {
        await this.keepOn(e.part.id);
        return;
      }
      if (e.state === 'on') await this.release(e);
      e.state = 'off';
      this.closeRestoredTabs(e);
    });
  }

  // The part's confirmStop, if it has one; one that throws is logged and does not keep the part on.
  async confirmStop(e) {
    if (!e.module || typeof e.module.confirmStop !== 'function') return true;
    try {
      return (await e.module.confirmStop()) !== false;
    } catch (err) {
      this.log(`${e.part.title}: confirmStop threw, stopping anyway: ${errorText(err)}`);
      return true;
    }
  }

  // Puts roost.<id>.enabled back on at the scope where it was set to false (the workspace's, else the user's): the
  // value there is removed when the wider one (the user's, else the default) is already true, else set to true.
  async keepOn(id) {
    const config = vscode.workspace.getConfiguration('roost');
    const key = `${id}.enabled`;
    const set = config.inspect(key) || {};
    const T = vscode.ConfigurationTarget;
    const inWorkspace = set.workspaceValue !== undefined;
    const wider = inWorkspace && set.globalValue !== undefined ? set.globalValue : set.defaultValue;
    await config.update(key, wider === true ? undefined : true, inWorkspace ? T.Workspace : T.Global);
  }

  // While a part is off: a serializer for each of its webview types, closing a tab VS Code restores for it.
  closeRestoredTabs(e) {
    if (e.closers || this.closed) return;
    e.closers = [];
    for (const type of e.part.webviews) {
      try {
        e.closers.push(this.registerSerializer(type, { deserializeWebviewPanel: async (panel) => panel.dispose() }));
      } catch (err) {   // the part left one of its own registered
        this.log(`${e.part.title}: tabs of ${type} cannot be closed while it is off: ${errorText(err)}`);
      }
    }
  }

  stopClosingTabs(e) {
    for (const d of e.closers || []) d.dispose();
    e.closers = null;
  }

  // Every serializer a part registers is noted against the part that owns its webview type, so one it keeps
  // outside its subscriptions (or leaves behind when it throws) is still removed when it stops or fails. Roost's own
  // tab closers go through VS Code's function directly. Where the function cannot be replaced, nothing is noted.
  trackSerializers() {
    const w = vscode.window;
    const register = w.registerWebviewPanelSerializer;
    this.registerSerializer = (type, s) => register.call(w, type, s);
    const tracked = (type, s) => {
      const d = register.call(w, type, s);
      const e = this.owners.get(type);
      if (e) e.serializers.add(d);
      return d;
    };
    try {
      w.registerWebviewPanelSerializer = tracked;
      this.untrackSerializers = () => { if (w.registerWebviewPanelSerializer === tracked) w.registerWebviewPanelSerializer = register; };
    } catch (err) {
      this.log(`Roost cannot note the parts' webview serializers: ${errorText(err)}`);
    }
  }

  // Disposes the part's subscriptions and serializers, each on its own, then calls its deactivate.
  async release(e) {
    const { part, context } = e;
    const serializers = [...e.serializers];
    e.serializers.clear();
    for (const d of [...(context ? context.subscriptions.splice(0) : []), ...serializers]) {
      try {
        if (d && typeof d.dispose === 'function') d.dispose();
      } catch (err) {
        this.log(`${part.title}: a disposable threw while stopping: ${errorText(err)}`);
      }
    }
    e.context = null;
    try {
      if (e.module && typeof e.module.deactivate === 'function') await e.module.deactivate();
    } catch (err) {
      this.log(`${part.title}: deactivate threw: ${errorText(err)}`);
    }
  }

  // A key that cannot be set is logged; what the part does goes on.
  setFailed(e, failed) {
    e.failed = failed;
    const key = failedKey(e.part.id);
    return Promise.resolve(vscode.commands.executeCommand('setContext', key, failed))
      .catch((err) => this.log(`${key} could not be set: ${errorText(err)}`));
  }

  // roost.company: a valid company file; roost.companyTools: valid, with at least one MCP server. A key that cannot
  // be set is logged, as setFailed does.
  setCompanyContexts() {
    const c = this.company;
    const keys = { 'roost.company': c.ok, 'roost.companyTools': c.ok && c.company.mcpServers.length > 0 };
    return Promise.all(Object.entries(keys).map(([key, value]) => Promise.resolve(vscode.commands.executeCommand('setContext', key, value))
      .catch((err) => this.log(`${key} could not be set: ${errorText(err)}`))));
  }

  // ---- Connect Your Tools: the company file's MCP servers, in a panel (src/toolsPage.js) driven through Tools

  hasTools() { return !!(this.company && this.company.ok && this.company.company.mcpServers.length > 0); }

  toolsNow() {
    if (!this.tools) this.tools = this.makeTools({ company: this.company.company, onChange: (rows) => this.toolsChanged(rows) });
    return this.tools;
  }

  // Every change: the rows to the pages, and roost.toolsConnected (the walkthrough step) to whether all are connected
  toolsChanged(rows) {
    this.postRows(rows);
    if (this.getStarted) {
      this.getStarted.rows(rows);
      this.getStarted.refresh();
    }
    const value = !!(this.tools && this.tools.allConnected());
    Promise.resolve(vscode.commands.executeCommand('setContext', 'roost.toolsConnected', value))
      .catch((err) => this.log(`roost.toolsConnected could not be set: ${errorText(err)}`));
  }

  postRows(rows) {
    if (!this.toolsPanel) return;
    Promise.resolve(this.toolsPanel.webview.postMessage({ type: 'rows', rows })).catch(() => { /* the panel just closed */ });
  }

  // One panel at a time; each time one opens, every row is checked. Resolves once that check is done.
  openTools() {
    const tools = this.toolsNow();
    if (this.toolsPanel) {
      this.toolsPanel.reveal();
      return this.toolsChecked;
    }
    const panel = vscode.window.createWebviewPanel(TOOLS_PANEL_TYPE, 'Connect Your Tools', vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
    this.toolsPanel = panel;
    const messages = panel.webview.onDidReceiveMessage((m) => this.onToolsMessage(m));
    panel.onDidDispose(() => {
      messages.dispose();
      if (this.toolsPanel === panel) this.toolsPanel = null;
    });
    panel.webview.html = getToolsHtml({ nonce: randomBytes(16).toString('hex'), cspSource: panel.webview.cspSource });
    this.toolsChecked = Promise.resolve().then(() => tools.checkAll())
      .catch((err) => this.log(`Connect Your Tools: the check failed: ${err && err.message}`));
    return this.toolsChecked;
  }

  // A message from the page (Connect Your Tools', or a row on Get started's, whose `reveal` shows that page for a
  // sign-in prompt). A row the page names that is no longer there is ignored. A token is handed to Tools only: never
  // logged, never sent back (the rows hold none).
  async onToolsMessage(m, { reveal } = {}) {
    const tools = this.tools;
    if (!tools || !m || typeof m.type !== 'string') return;
    if (m.type === 'ready') { this.postRows(tools.rows()); return; }
    const row = tools.rows().find((r) => r.id === m.id);
    if (!row) return;
    try {
      if (m.type === 'connect') await this.connectTool(row, { reveal });
      else if (m.type === 'token') await tools.saveToken(row.id, typeof m.token === 'string' ? m.token : '');
      else if (m.type === 'openPage') { if (isWeb(row.page)) await vscode.env.openExternal(vscode.Uri.parse(row.page)); }
      else if (m.type === 'copyAndOpen') await this.copyAndOpen(row);
      else if (m.type === 'replace') await tools.replaceRegistration(row.id);
      else if (m.type === 'githubSignIn') { if (row.action === 'githubSignIn') await vscode.commands.executeCommand('roost.githubSignIn'); }
    } catch (err) {
      this.log(`Connect Your Tools: ${row.name || row.id}: ${err && err.message}`);
    }
  }

  // The row's sign-in, by kind (each downloads the server's program first when it has an install and it's missing); a
  // tokenPage row's Connect checks the token already saved. An mcpTool row's prompt shows the page it is on: `reveal`,
  // else Connect Your Tools' panel.
  connectTool(row, { reveal } = {}) {
    const tools = this.tools;
    const show = reveal || (() => { if (this.toolsPanel) this.toolsPanel.reveal(); });
    if (row.kind === 'command') return tools.connectCommand(row.id, { runInTerminal: (argv) => this.runInTerminal(row.name || row.id, argv) });
    if (row.kind === 'mcpTool') return tools.connectMcpTool(row.id, { onPrompt: () => show() });
    if (row.kind === 'none') return tools.connectNone(row.id);
    return tools.connectChecked(row.id);
  }

  // A command sign-in, in a VS Code terminal named after the server; `closed` resolves when that terminal closes
  // (the shell exits once the command succeeds; one that fails stays open, to be read, until it is closed).
  runInTerminal(name, argv) {
    const terminal = vscode.window.createTerminal({ name });
    const closed = new Promise((resolve) => {
      const listener = vscode.window.onDidCloseTerminal((t) => {
        if (t !== terminal) return;
        listener.dispose();
        resolve();
      });
    });
    terminal.show();
    terminal.sendText(`${argv.map(shellQuote).join(' ')} && exit`);
    return { terminal, closed };
  }

  // A sign-in tool's prompt: the code to the clipboard, the link opened (either alone when that is all there is)
  async copyAndOpen(row) {
    const p = row.prompt;
    if (!p) return;
    if (p.code) await vscode.env.clipboard.writeText(p.code);
    if (isWeb(p.url)) await vscode.env.openExternal(vscode.Uri.parse(p.url));
  }

  // The walkthrough's Teams and Jira buttons: with a company file, a tools row that writes the part's token file
  // (<part>.signIn.tokenFile) signs in in the panel, and the part picks the file up; else the part's own sign-in.
  // `panel: false` (the Get started page, which shows the row itself): the row signs in without opening the panel.
  async toolSignIn(section, fallback, { panel = true } = {}) {
    const file = vscode.workspace.getConfiguration(section).get('signIn.tokenFile', '');
    const id = this.hasTools() && typeof file === 'string' && file ? this.toolsNow().rowForTokenFile(file) : null;
    if (!id) return vscode.commands.executeCommand(fallback);
    if (panel) await this.openTools();
    const row = this.tools.rows().find((r) => r.id === id);
    if (!row || row.state === 'connected') return undefined;
    try {
      await this.connectTool(row, panel ? {} : { reveal: () => { if (this.getStarted) this.getStarted.reveal(); } });
    } catch (err) {
      this.log(`Connect Your Tools: ${row.name || row.id}: ${err && err.message}`);
    }
    return undefined;
  }

  // gh's sign-in, in a terminal: straight to the browser over HTTPS, without gh's protocol and SSH-key questions
  // (Sean's first-time run, 2026-11-24). The terminal closes once gh is done; then the PRs part looks for the new
  // login (not at its next 30 s retry), and `closed` resolves.
  startGithubSignIn() {
    const terminal = vscode.window.createTerminal({ name: 'GitHub sign-in' });
    let listener;
    const closed = new Promise((resolve) => {
      listener = vscode.window.onDidCloseTerminal((t) => {
        if (t !== terminal) return;
        listener.dispose();
        Promise.resolve(vscode.commands.executeCommand('kestrel.refresh')).catch(() => { /* the PRs part is off */ });
        resolve();
      });
    });
    this.base.subscriptions.push(listener);
    terminal.show();
    terminal.sendText('gh auth login --hostname github.com --git-protocol https --web && exit');
    return { terminal, closed };
  }

  // Every failed key false first (one can be left from before an extension host restart); a part that fails sets
  // its own true after that. The parts start side by side: one whose activate never ends holds up none of the
  // others. The parts' setContext calls for WATCHED_CONTEXTS are noted from before the first starts (this.contexts).
  // Nothing here is awaited before the parts' activate calls, so each part registers its serializers before
  // VS Code restores its tabs, as it does when it is an extension of its own.
  async startAll() {
    this.trackSerializers();
    this.contexts = watchContexts(vscode.commands, WATCHED_CONTEXTS, { log: (l) => this.log(l) });
    const keys = [...this.parts.values()].map((e) => this.setFailed(e, false));
    const starts = [];
    for (const [id, e] of this.parts) {
      if (isEnabled(id)) starts.push(this.start(id));
      else this.closeRestoredTabs(e);
    }
    await Promise.allSettled([...keys, ...starts]);
  }

  // Roost's very first activation: once the parts have started, the bottom panel opens on the PRs tab (closed on a
  // fresh profile), the Get started page in the editor, and last the side bar on Perch's view (a fresh window
  // may have it closed, and with the activity bar on top its icons go with it). Then roost.firstStart.done is recorded,
  // whatever happened: a part that is off or failed, or a command that fails, is not retried later.
  async firstStart() {
    if (this.base.globalState.get(FIRST_START_KEY)) return;
    const open = async (what, run) => {
      try {
        await run();
      } catch (err) {
        this.log(`Roost could not open ${what} on its first start: ${errorText(err)}`);
      }
    };
    const on = (id) => this.parts.has(id) && this.state(id) === 'on';
    if (on('pullRequests')) await open('the PRs tab', () => vscode.commands.executeCommand(PRS_VIEW_COMMAND));
    await open('its Get started page', () => this.getStarted.open());
    // last: opened first, the side bar ended on Explorer in a fresh window (installer run, 2026-11-24)
    if (on('agents')) await open('the Perch view', () => vscode.commands.executeCommand(AGENTS_VIEW_COMMAND));
    try {
      await this.base.globalState.update(FIRST_START_KEY, true);
    } catch (err) {
      this.log(`Roost could not record its first start: ${errorText(err)}`);
    }
  }

  onConfigChange(event) {
    if (this.closed) return;           // Roost is stopping: a change now starts nothing
    for (const id of this.parts.keys()) {
      if (!event.affectsConfiguration(settingKey(id))) continue;
      // a failure is already in the output channel (queue)
      (isEnabled(id) ? this.start(id) : this.stop(id, { ask: true })).catch(() => {});
    }
  }

  // The window closing: every part is released (a stop sets no context key, so nothing waits on VS Code's main
  // thread), and no serializer is left behind.
  async stopAll() {
    this.closed = true;
    if (this.getStarted) this.getStarted.dispose();
    if (this.tools) this.tools.dispose();
    if (this.toolsPanel) this.toolsPanel.dispose();
    await Promise.all([...this.parts.keys()].map((id) => this.stop(id)));
    for (const e of this.parts.values()) this.stopClosingTabs(e);
    if (this.untrackSerializers) this.untrackSerializers();
    if (this.contexts) this.contexts.dispose();
  }
}

let roost = null;

// `options`: for tests, Roost's constructor options (VS Code passes the context alone)
// The accounts gh is signed in to on github.com, from `gh auth status` (argv, no shell); [] when none or no gh.
function defaultGhLogins() {
  return new Promise((resolve) => {
    require('node:child_process').execFile('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 10000 }, (err, stdout, stderr) => {
      const text = `${stdout || ''}\n${stderr || ''}`;
      const logins = [...text.matchAll(/Logged in to github\.com (?:account|as) ([\w-]+)/g)].map((m) => m[1]);
      resolve(err && !logins.length ? [] : [...new Set(logins)]);
    });
  });
}

function activate(context, options = {}) {
  const output = vscode.window.createOutputChannel('Roost');
  context.subscriptions.push(output);
  const r = new Roost(context, readParts(context.extensionPath), output, options);
  roost = r;
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => r.onConfigChange(e)));
  // Roost's own, whatever parts are on: the Settings page filtered to this extension's switches and the parts' settings
  context.subscriptions.push(vscode.commands.registerCommand('roost.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:seanahn.roost')));
  // the Get started page (the walkthrough stays on VS Code's Welcome page)
  context.subscriptions.push(vscode.commands.registerCommand('roost.getStarted', () => { r.getStarted.open(); }));
  // the walkthrough's codebase-search step: on (never off, unlike Agents: Toggle Codebase Search), or left off
  context.subscriptions.push(vscode.commands.registerCommand('roost.codebaseSearchOn', async () => {
    if (vscode.workspace.getConfiguration('agents').get('codebaseIndex.enabled') === true) {
      vscode.window.showInformationMessage('Codebase search is already on.');
      return;
    }
    // Perch's toggle also checks for a Python that can run it, and says so
    await vscode.commands.executeCommand('perch.codebaseIndex.toggle');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('roost.codebaseSearchNotNow', () => {}));
  // the walkthrough's Connect Claude step, left for now: its completion event; the step is also done once Claude is connected (perch.claudeConnected)
  context.subscriptions.push(vscode.commands.registerCommand('roost.connectClaudeNotNow', () => {}));
  // Connect your tools (the walkthrough's step, shown with a company file that lists servers): the panel, or a note
  context.subscriptions.push(vscode.commands.registerCommand('roost.connectTools', () => {
    if (!r.hasTools()) return vscode.window.showInformationMessage(NO_TOOLS);
    r.openTools();
    return undefined;
  }));
  context.subscriptions.push(vscode.commands.registerCommand('roost.toolsNotNow', () => {}));
  context.subscriptions.push(vscode.commands.registerCommand('roost.teamsSignIn', () => r.toolSignIn('teams', 'chirp.signIn')));
  context.subscriptions.push(vscode.commands.registerCommand('roost.jiraSignIn', () => r.toolSignIn('jira', 'jay.signIn')));
  // the walkthrough's first step: the Claude tab first start opened (Agents' own Open: the last tab, or a picker)
  context.subscriptions.push(vscode.commands.registerCommand('roost.goToClaude', () => vscode.commands.executeCommand('perch.open')));
  // the walkthrough's first step opens the tab, Claude or Codex, beside the walkthrough, which keeps most of the width
  // (no tab is opened on first start: Sean, 2026-11-24)
  const besideWalkthrough = async (command) => {
    const groups = () => (vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
    const before = groups().length;
    await vscode.commands.executeCommand(command);
    for (let n = 0; n < 20 && groups().length === before; n++) await new Promise((r) => setTimeout(r, 50));
    if (before === 1 && groups().length === 2) {
      await Promise.resolve(vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.7 }, { size: 0.3 }] })).catch(() => {});
    }
  };
  context.subscriptions.push(vscode.commands.registerCommand('roost.newClaudeTab', () => besideWalkthrough('perch.newClaude')));
  context.subscriptions.push(vscode.commands.registerCommand('roost.newCodexTab', () => besideWalkthrough('perch.newCodex')));
  // the PRs part reads the logins the GitHub CLI holds; signing in is gh's own, in a terminal (startGithubSignIn).
  // Already signed in, it says so first and offers another account.
  context.subscriptions.push(vscode.commands.registerCommand('roost.githubSignIn', async () => {
    const logins = await Promise.resolve().then(() => r.ghLogins()).catch(() => []);
    if (logins.length) {
      const ANOTHER = 'Add Another Account';
      const pick = await vscode.window.showInformationMessage(`GitHub is signed in as ${logins.join(', ')}.`, ANOTHER);
      if (pick !== ANOTHER) return;
    }
    r.startGithubSignIn();
  }));
  // the company file, read before the parts start; a file that is there but invalid is logged once
  const file = companyFile();
  r.company = readCompany(file);
  if (!r.company.ok && !r.company.missing) r.log(`${file} is not a valid company file: ${r.company.error}`);
  const companyKeys = r.setCompanyContexts();
  // not awaited: Roost is active at once, whatever its parts do; `ready` is for tests
  const started = r.startAll();
  // made once startAll has begun: the watch on the parts' context keys (r.contexts) is in place from its first line
  r.getStarted = new GetStarted({ roost: r, vscode, store: context.globalState, ghLogins: () => r.ghLogins(), log: (l) => r.log(l) });
  r.ready = Promise.all([companyKeys, started]).then(() => undefined).catch((err) => r.log(`Roost could not start its parts: ${errorText(err)}`));
  // after the parts have started, and not awaited here: activation does not wait for it
  r.firstStarted = r.ready.then(() => r.firstStart()).catch((err) => r.log(`Roost first start failed: ${errorText(err)}`));
  return r;
}

async function deactivate() {
  if (!roost) return;
  const r = roost;
  roost = null;
  await r.stopAll();
}

module.exports = { activate, deactivate, Roost };
