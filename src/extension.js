'use strict';
// Agentic Works' entry point: starts each part under parts/ whose agenticWorks.<id>.enabled setting is on, with a context of its
// own; starts or stops a part when its setting changes; a part that throws at start is reported once and left off.
// Before a part is switched off it may say no (its confirmStop), which puts the switch back on. While a part is off,
// tabs VS Code brings back for it are closed, so they do not hang without a page; the part's own saved tab list,
// which it restores from when it starts, is left as it is. A part's views and commands show while its setting is on
// and its context key agenticWorks.<id>.failed is not set; Agentic Works sets that key from a failed start until the next good one.
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const vscode = require('vscode');
const { readParts, partContext } = require('./parts');
const { companyFile, readCompany, companyEmailEnv, EMAIL_KEY } = require('./company');
const { syncSkills } = require('./skills');
const { Tools } = require('./tools');
const { getToolsHtml } = require('./toolsPage');
const { watchContexts } = require('./contextWatch');
const { GetStarted } = require('./getStarted');
const { GithubSignIn, DEVICE_URL } = require('./githubSignIn');

const settingKey = (id) => `agenticWorks.${id}.enabled`;
const failedKey = (id) => `agenticWorks.${id}.failed`;
const FIRST_START_KEY = 'agenticWorks.firstStart.done';
// The parts' context keys the Get started page ticks on: VS Code cannot read one back, so Agentic Works notes their setContext
// (and perch.sessionOpen, whether a Perch tab is open, and chirp.signInCodeWaiting, a Teams code waiting, which it shows)
const WATCHED_CONTEXTS = ['kestrel.signedIn', 'perch.gatewayReady', 'perch.claudeConnected', 'perch.messageSent', 'chirp.signedIn', 'jay.signedIn',
  'perch.sessionOpen', 'chirp.signInCodeWaiting'];
const PRS_VIEW_COMMAND = 'workbench.view.extension.kestrel';   // kestrel's panel view container id
const AGENTS_VIEW_COMMAND = 'workbench.view.extension.perch';  // Perch's activity-bar container id: opens the side bar on it
const isEnabled = (id) => vscode.workspace.getConfiguration('agenticWorks').get(`${id}.enabled`, true);
const errorText = (e) => (e && e.stack) || String(e);
const TOOLS_PANEL_TYPE = 'agenticWorks.tools';
const NO_TOOLS = 'Your company file lists no tools.';
// One argument for a POSIX shell: as it is when it is plainly safe, else in single quotes
const shellQuote = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${String(a).replace(/'/g, "'\\''")}'`);
const isWeb = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

class AgenticWorks {
  // `makeTools`: for tests, a stand-in for Connect Your Tools' Tools (src/tools.js); `ghLogins`: the accounts gh is
  // signed in to (tests never run this machine's gh: under AGENTIC_WORKS_TEST_HARNESS_STRICT_GH, set by the test stubs and
  // `make test`, an Agentic Works made without one throws; the name is one nobody sets by accident)
  // `spawnGh`: child_process.spawn for GitHub's sign-in (a fake in tests; under the same flag, the real one throws)
  constructor(base, parts, output, { makeTools = (opts) => new Tools(opts), ghLogins, spawnGh } = {}) {
    if (!ghLogins && process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH) throw new Error("Agentic Works: tests must stub ghLogins (activate(base, { ghLogins }))");
    this.base = base;
    this.output = output;
    this.makeTools = makeTools;
    this.ghLogins = ghLogins || defaultGhLogins;
    this.spawnGh = spawnGh || (process.env.AGENTIC_WORKS_TEST_HARNESS_STRICT_GH
      ? () => { throw new Error('Agentic Works: tests must stub spawnGh (activate(base, { spawnGh }))'); }
      : require('node:child_process').spawn);
    this.github = null;                // GitHub's sign-in while it runs: { flow, done, codeShown } (startGithubSignIn)
    this.getStarted = null;            // the Get started page's host (src/getStarted.js), made once startAll has begun
    this.tools = null;                 // made the first time Connect Your Tools (or a sign-in that uses it) needs it
    this.toolsPanel = null;
    this.toolsChecked = Promise.resolve();
    // id → { part, state: 'on'|'off'|'failed', failed, context, module, queue, closers, serializers }
    // `failed`: what agenticWorks.<id>.failed was last set to; `serializers`: the part's own, however it registered them
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
    if (!e) throw new Error(`Agentic Works: no part ${id}`);
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
      this.log(`Agentic Works could not refresh its Get started page: ${errorText(err)}`);
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
        vscode.window.showErrorMessage(`Agentic Works: ${part.title} could not start.`, 'Show Log').then((choice) => {
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

  // Puts agenticWorks.<id>.enabled back on at the scope where it was set to false (the workspace's, else the user's): the
  // value there is removed when the wider one (the user's, else the default) is already true, else set to true.
  async keepOn(id) {
    const config = vscode.workspace.getConfiguration('agenticWorks');
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
  // outside its subscriptions (or leaves behind when it throws) is still removed when it stops or fails. Agentic Works' own
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
      this.log(`Agentic Works cannot note the parts' webview serializers: ${errorText(err)}`);
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

  // agenticWorks.company: a valid company file; agenticWorks.companyTools: valid, with at least one MCP server. A key that cannot
  // be set is logged, as setFailed does.
  setCompanyContexts() {
    const c = this.company;
    const keys = { 'agenticWorks.company': c.ok, 'agenticWorks.companyTools': c.ok && c.company.mcpServers.length > 0 };
    return Promise.all(Object.entries(keys).map(([key, value]) => Promise.resolve(vscode.commands.executeCommand('setContext', key, value))
      .catch((err) => this.log(`${key} could not be set: ${errorText(err)}`))));
  }

  // ---- Connect Your Tools: the company file's MCP servers, in a panel (src/toolsPage.js) driven through Tools

  hasTools() { return !!(this.company && this.company.ok && this.company.company.mcpServers.length > 0); }

  toolsNow() {
    if (!this.tools) this.tools = this.makeTools({ company: this.company.company, onChange: (rows) => this.toolsChanged(rows) });
    return this.tools;
  }

  // Every change: the rows to the pages, and agenticWorks.toolsConnected (the walkthrough step) to whether all are connected
  toolsChanged(rows) {
    this.postRows(rows);
    if (this.getStarted) {
      this.getStarted.rows(rows);
      this.getStarted.refresh();
    }
    const value = !!(this.tools && this.tools.allConnected());
    Promise.resolve(vscode.commands.executeCommand('setContext', 'agenticWorks.toolsConnected', value))
      .catch((err) => this.log(`agenticWorks.toolsConnected could not be set: ${errorText(err)}`));
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
      // not awaited: the sign-in waits on GitHub, up to the code's 15 minutes; it says how it went itself
      else if (m.type === 'githubSignIn') {
        if (row.action === 'githubSignIn') Promise.resolve(vscode.commands.executeCommand('agenticWorks.githubSignIn')).catch((err) => this.log(`GitHub sign-in: ${errorText(err)}`));
      }
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
  // (the shell exits once the command succeeds; one that fails stays open, to be read). `failed` resolves with the
  // exit code when the command exits with an error, where shell integration can tell; otherwise it never resolves
  // and closing the terminal ends the wait. Trying the sign-in again replaces the terminal of the last try. With the
  // company file's email section, the address the Get started page saved is in the terminal's environment (email.env),
  // never on its command line.
  runInTerminal(name, argv) {
    const c = this.company;
    const env = c && c.ok ? companyEmailEnv(c.company, this.base.globalState.get(EMAIL_KEY)) : {};
    this.signInTerminals = this.signInTerminals || new Map();
    const last = this.signInTerminals.get(name);
    if (last) last.dispose();
    const terminal = vscode.window.createTerminal(Object.keys(env).length ? { name, env } : { name });
    this.signInTerminals.set(name, terminal);
    let onFail = () => {};
    const failed = new Promise((resolve) => { onFail = resolve; });
    const ended = vscode.window.onDidEndTerminalShellExecution
      ? vscode.window.onDidEndTerminalShellExecution((e) => {
        if (e.terminal === terminal && typeof e.exitCode === 'number' && e.exitCode !== 0) onFail(e.exitCode);
      })
      : { dispose() {} };
    const closed = new Promise((resolve) => {
      const listener = vscode.window.onDidCloseTerminal((t) => {
        if (t !== terminal) return;
        listener.dispose();
        ended.dispose();
        if (this.signInTerminals.get(name) === terminal) this.signInTerminals.delete(name);
        resolve();
      });
    });
    terminal.show();
    terminal.sendText(`${argv.map(shellQuote).join(' ')} && exit`);
    return { terminal, closed, failed };
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
  // `args`: for the part's own sign-in (the Get started page's { inPlace: true } for chirp.signIn).
  async toolSignIn(section, fallback, { panel = true, args = [] } = {}) {
    const file = vscode.workspace.getConfiguration(section).get('signIn.tokenFile', '');
    const id = this.hasTools() && typeof file === 'string' && file ? this.toolsNow().rowForTokenFile(file) : null;
    if (!id) return vscode.commands.executeCommand(fallback, ...args);
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

  // GitHub's sign-in, with no terminal (src/githubSignIn.js): gh's device sign-in over HTTPS, its one-time code for
  // the Get started page (or, from the command, a notification), then git set up to use it. One at a time: asked
  // again while it runs, the same one. Once it ends the PRs part looks for the new login (not at its next 30 s retry)
  // and the page hears how it went.
  startGithubSignIn() {
    if (this.github) return this.github;
    let shown;
    const codeShown = new Promise((resolve) => { shown = resolve; });
    const flow = new GithubSignIn({
      spawn: this.spawnGh,
      onUpdate: (st) => {
        if (st.phase === 'code') shown(st.code);
        if (this.getStarted) this.getStarted.refresh();
      },
    });
    const g = { flow, codeShown };
    this.github = g;
    g.done = flow.run().then((r) => {
      shown(null);
      if (this.github === g) this.github = null;
      if (r.ok) this.log(`GitHub sign-in: done${r.gitSetUp ? '' : '; gh auth setup-git failed'}`);
      else if (!r.cancelled) this.log(`GitHub sign-in: ${r.error}`);
      Promise.resolve(vscode.commands.executeCommand('kestrel.refresh')).catch(() => { /* the PRs part is off */ });
      if (this.getStarted) this.getStarted.githubDone(r);
      return r;
    });
    if (this.getStarted) this.getStarted.refresh();
    return g;
  }

  // The code to the clipboard and GitHub's device page in the browser (only GitHub's own page)
  async copyGithubCode() {
    const c = this.github && this.github.flow.state.code;
    if (!c) return;
    await vscode.env.clipboard.writeText(c.userCode);
    const url = c.verificationUri.startsWith(DEVICE_URL) ? c.verificationUri : DEVICE_URL;
    await vscode.env.openExternal(vscode.Uri.parse(url));
  }

  cancelGithubSignIn() { if (this.github) this.github.flow.cancel(); }

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

  // Agentic Works' very first activation: once the parts have started, the bottom panel opens on the PRs tab (closed on a
  // fresh profile), the Get started page in the editor, and last the side bar on Perch's view (a fresh window
  // may have it closed, and with the activity bar on top its icons go with it). Then agenticWorks.firstStart.done is recorded,
  // whatever happened: a part that is off or failed, or a command that fails, is not retried later.
  // Later starts, while the walkthrough has a step neither done nor Not Now'd, open the page and the Perch view again:
  // the page isn't restored when VS Code restarts, and an empty window starts with the side bar hidden (Sean, 0.5.8).
  async firstStart() {
    const first = !this.base.globalState.get(FIRST_START_KEY);
    if (!first) {
      let left = false;
      try { left = this.getStarted.unfinished(); } catch (err) { this.log(`Agentic Works could not read the Get started steps: ${errorText(err)}`); }
      if (!left) return;
    }
    const open = async (what, run) => {
      try {
        await run();
      } catch (err) {
        this.log(`Agentic Works could not open ${what} ${first ? 'on its first start' : 'to finish Get started'}: ${errorText(err)}`);
      }
    };
    const on = (id) => this.parts.has(id) && this.state(id) === 'on';
    if (first && on('pullRequests')) await open('the PRs tab', () => vscode.commands.executeCommand(PRS_VIEW_COMMAND));
    await open('its Get started page', () => this.getStarted.open());
    // last: opened first, the side bar ended on Explorer in a fresh window (installer run, 2026-11-24)
    if (on('agents')) await open('the Perch view', () => vscode.commands.executeCommand(AGENTS_VIEW_COMMAND));
    if (!first) return;
    try {
      await this.base.globalState.update(FIRST_START_KEY, true);
    } catch (err) {
      this.log(`Agentic Works could not record its first start: ${errorText(err)}`);
    }
  }

  onConfigChange(event) {
    if (this.closed) return;           // Agentic Works is stopping: a change now starts nothing
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
    this.cancelGithubSignIn();
    if (this.getStarted) this.getStarted.dispose();
    if (this.tools) this.tools.dispose();
    if (this.toolsPanel) this.toolsPanel.dispose();
    await Promise.all([...this.parts.keys()].map((id) => this.stop(id)));
    for (const e of this.parts.values()) this.stopClosingTabs(e);
    if (this.untrackSerializers) this.untrackSerializers();
    if (this.contexts) this.contexts.dispose();
  }
}

let agenticWorks = null;

// `options`: for tests, Agentic Works' constructor options (VS Code passes the context alone)
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
  const output = vscode.window.createOutputChannel('Agentic Works');
  context.subscriptions.push(output);
  const r = new AgenticWorks(context, readParts(context.extensionPath), output, options);
  agenticWorks = r;
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => r.onConfigChange(e)));
  // Agentic Works' own, whatever parts are on: the Settings page filtered to this extension's switches and the parts' settings
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.openSettings', () => vscode.commands.executeCommand('workbench.action.openSettings', '@ext:agenticworks.agentic-works')));
  // the Get started page (the walkthrough stays on VS Code's Welcome page)
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.getStarted', () => { r.getStarted.open(); }));
  // the walkthrough's codebase-search step: on (never off, unlike Agents: Toggle Codebase Search), or left off
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.codebaseSearchOn', async () => {
    if (vscode.workspace.getConfiguration('agents').get('codebaseIndex.enabled') === true) {
      vscode.window.showInformationMessage('Codebase search is already on.');
      return;
    }
    // Perch's toggle also checks for a Python that can run it, and says so
    await vscode.commands.executeCommand('perch.codebaseIndex.toggle');
  }));
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.codebaseSearchNotNow', () => {}));
  // the walkthrough's Connect Claude step, left for now: its completion event; the step is also done once Claude is connected (perch.claudeConnected)
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.connectClaudeNotNow', () => {}));
  // Connect your tools (the walkthrough's step, shown with a company file that lists servers): the panel, or a note
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.connectTools', () => {
    if (!r.hasTools()) return vscode.window.showInformationMessage(NO_TOOLS);
    r.openTools();
    return undefined;
  }));
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.toolsNotNow', () => {}));
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.teamsSignIn', () => r.toolSignIn('teams', 'chirp.signIn')));
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.jiraSignIn', () => r.toolSignIn('jira', 'jay.signIn')));
  // the walkthrough's first step: the Claude tab first start opened (Agents' own Open: the last tab, or a picker)
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.goToClaude', () => vscode.commands.executeCommand('perch.open')));
  // the walkthrough's first step opens the tab, Claude or Codex, beside the walkthrough, which keeps most of the width
  // (no tab is opened on first start: Sean, 2026-11-24). Resolves to the command's answer; one that says no new tab
  // opened (perch.openGatewayTab's 'revealed', 'notReady', 'failed') waits for no new group.
  // Its argument, Get started's { fill: 'Hello' }, goes to the Agents command, which types it in the new tab.
  const besideWalkthrough = async (command, spec) => {
    const groups = () => (vscode.window.tabGroups && vscode.window.tabGroups.all) || [];
    const before = groups().length;
    const result = await (spec === undefined ? vscode.commands.executeCommand(command) : vscode.commands.executeCommand(command, spec));
    if (typeof result === 'string' && result !== 'opened') return result;
    for (let n = 0; n < 20 && groups().length === before; n++) await new Promise((r) => setTimeout(r, 50));
    if (before === 1 && groups().length === 2) {
      await Promise.resolve(vscode.commands.executeCommand('vscode.setEditorLayout', { orientation: 0, groups: [{ size: 0.7 }, { size: 0.3 }] })).catch(() => {});
    }
    return result;
  };
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.newClaudeTab', (spec) => besideWalkthrough('perch.newClaude', spec)));
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.newCodexTab', (spec) => besideWalkthrough('perch.newCodex', spec)));
  // the Get started talk step with gateway.openTabOnTalk: a Claude tab on the gateway, an open one shown rather than
  // another opened (perch.openGatewayTab), not perch.newClaude, whose saved backend may lag a gateway just saved
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.newClaudeGatewayTab', (spec) => besideWalkthrough('perch.openGatewayTab', spec)));
  // the PRs part reads the logins the GitHub CLI holds; signing in is gh's own, without a terminal (startGithubSignIn).
  // Already signed in, it says so first and offers another account. From here (the Command Palette, Connect Your
  // Tools) the code comes in a notification with Copy Code & Open GitHub; the Get started page shows its own.
  context.subscriptions.push(vscode.commands.registerCommand('agenticWorks.githubSignIn', async () => {
    if (!r.github) {
      const logins = await Promise.resolve().then(() => r.ghLogins()).catch(() => []);
      if (logins.length) {
        const ANOTHER = 'Add Another Account';
        const pick = await vscode.window.showInformationMessage(`GitHub is signed in as ${logins.join(', ')}.`, ANOTHER);
        if (pick !== ANOTHER) return;
      }
    }
    const g = r.startGithubSignIn();
    const code = await g.codeShown;
    if (code) {
      const COPY = 'Copy Code & Open GitHub', CANCEL = 'Cancel';
      const pick = await vscode.window.showInformationMessage(`Your GitHub sign-in code is ${code.userCode}. Enter it on GitHub in your browser.`, COPY, CANCEL);
      if (pick === COPY) await r.copyGithubCode();
      else if (pick === CANCEL) r.cancelGithubSignIn();
    }
    const result = await g.done;
    if (result.ok) {
      vscode.window.showInformationMessage(result.gitSetUp ? 'Signed in to GitHub.' : "Signed in to GitHub, but git isn't set up to use it: run gh auth setup-git in a terminal.");
    } else if (!result.cancelled) {
      vscode.window.showErrorMessage(result.error);
    }
  }));
  // the company file, read before the parts start; a file that is there but invalid is logged once, as is each value
  // it drops (its notes)
  const file = companyFile();
  r.company = readCompany(file);
  if (!r.company.ok && !r.company.missing) r.log(`${file} is not a valid company file: ${r.company.error}`);
  if (r.company.ok) for (const note of r.company.notes || []) r.log(`${file}: ${note}`);
  // the company's skills, copied (or, once dropped from the file, removed) at each start; a missing or invalid file
  // changes none (one briefly absent mustn't remove them)
  if (r.company.ok) {
    try {
      r.skills = syncSkills(r.company.company.skills, { log: (l) => r.log(l) });
    } catch (err) {
      r.log(`Skills: the pass failed: ${errorText(err)}`);
    }
  }
  const companyKeys = r.setCompanyContexts();
  // not awaited: Agentic Works is active at once, whatever its parts do; `ready` is for tests
  const started = r.startAll();
  // made once startAll has begun: the watch on the parts' context keys (r.contexts) is in place from its first line
  r.getStarted = new GetStarted({ agenticWorks: r, vscode, store: context.globalState, ghLogins: () => r.ghLogins(), log: (l) => r.log(l) });
  r.ready = Promise.all([companyKeys, started]).then(() => undefined).catch((err) => r.log(`Agentic Works could not start its parts: ${errorText(err)}`));
  // after the parts have started, and not awaited here: activation does not wait for it
  r.firstStarted = r.ready.then(() => r.firstStart()).catch((err) => r.log(`Agentic Works first start failed: ${errorText(err)}`));
  return r;
}

async function deactivate() {
  if (!agenticWorks) return;
  const r = agenticWorks;
  agenticWorks = null;
  await r.stopAll();
}

module.exports = { activate, deactivate, AgenticWorks };
