'use strict';
// The host of Roost's Get started page (src/getStartedPage.js): one editor tab at a time, kept alive while hidden and
// not brought back after a reload. It sends the page its state (the steps shown for the parts that are on, in the
// company file's words and order, each ticked once its signal is true and kept done in globalState) and answers the
// page's messages through the parts' own commands (perch.connectClaude.request, jay.signInWith, chirp.signIn, ...)
// and Roost's (the walkthrough's commands, Connect Your Tools' host). A key or token the page sends goes to the
// command only: nothing posted holds one, and only a message's type and an error's text are logged. A reply that
// comes after the page closed is dropped. Each step carries its details, rendered here (src/stepDetails.js); a link
// clicked in them is opened in the browser when it is https, and ignored otherwise. (Design: docs/notes/101-roost.md,
// "Settled while planning 0.5", and the 0.5.2 bullet.)
const { randomBytes } = require('node:crypto');
const { getStartedHtml } = require('./getStartedPage');
const { stepDetails, httpsUrl } = require('./stepDetails');

const VIEW_TYPE = 'roost.getStarted';
const DONE_KEY = 'roost.getStarted.done';
const ORDER_COMPANY = ['github', 'claude', 'agents', 'tools', 'teams', 'jira', 'codebase', 'parts'];
const ORDER_ROOST = ['claude', 'agents', 'teams', 'jira', 'github', 'codebase', 'parts'];
const STEP_IDS = [...new Set([...ORDER_COMPANY, ...ORDER_ROOST])];
const NAMES = {
  github: 'Sign in to GitHub', agents: 'Talk to Claude or Codex', teams: 'Sign in to Teams', jira: 'Connect Jira and Confluence',
  codebase: 'Search your code by meaning', parts: 'Choose your parts',
};
// the part a step belongs to: shown while that part is on and not failed
const PART_OF = { github: 'pullRequests', claude: 'agents', agents: 'agents', codebase: 'agents', teams: 'teams', jira: 'jira' };
const NOT_NOW = { claude: 'roost.connectClaudeNotNow', tools: 'roost.toolsNotNow', codebase: 'roost.codebaseSearchNotNow' };
const NEW_TAB = { claude: 'roost.newClaudeTab', codex: 'roost.newCodexTab' };
const WAIT_TERMINAL = 'Finish signing in in the terminal.';
const WAIT_BROWSER = 'Finish signing in in your browser.';
const WAIT_CLAUDE = 'Signing in to Claude in the terminal…';
// the company's key helper is running (Get a key, with gateway.keyCommand): in the Agents part, which keeps the key
const waitKey = (name) => `Getting your ${name} key…`;
// chirp.signIn resolved but chirp.signedIn isn't true: cancelled, failed, offline, or the admin-approval wall
const TEAMS_NOT_SIGNED_IN = "Teams isn't signed in. Try again, or see the Teams view for why.";
// a configuration change of these refreshes the page
const WATCHED_SETTINGS = ['roost', 'agents.codebaseIndex.enabled', 'jira', 'teams.signIn.tokenFile'];

const errorMessage = (e) => (e && e.message) || String(e);
const str = (v) => (typeof v === 'string' ? v : '');

class GetStarted {
  // `roost`: Roost (src/extension.js); `store`: its globalState; `ghLogins`: the accounts gh is signed in to
  constructor({ roost, vscode, store, ghLogins, log }) {
    this.roost = roost;
    this.vscode = vscode;
    this.store = store;
    this.ghLogins = ghLogins;
    this.log = log;
    this.panel = null;
    this.logins = [];
    // claude: how many subscription logins are out (perch.connectClaude.request answers only once one ends)
    // key: how many Get a key requests with the company's key helper are out
    this.waiting = { github: false, teams: false, claude: 0, key: 0 };
    this.notes = { teams: '' };
    this.subs = [];
    if (roost.contexts) this.subs.push(roost.contexts.onChange(() => this.refresh()));
    this.subs.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (WATCHED_SETTINGS.some((k) => e.affectsConfiguration(k))) this.refresh();
    }));
  }

  open() {
    if (this.panel) {
      this.panel.reveal();
      return this.panel;
    }
    const vscode = this.vscode;
    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'Get started', vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [] });
    this.panel = panel;
    const messages = panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    panel.onDidDispose(() => {
      messages.dispose();
      if (this.panel === panel) this.panel = null;
    });
    panel.webview.html = getStartedHtml({ nonce: randomBytes(16).toString('hex'), cspSource: panel.webview.cspSource });
    // every row checked once, as Connect Your Tools' panel does when it opens
    if (this.roost.hasTools()) {
      const tools = this.roost.toolsNow();
      Promise.resolve().then(() => tools.checkAll())
        .catch((err) => this.log(`Get started: the tools check failed: ${errorMessage(err)}`));
    }
    this.readLogins();
    return panel;
  }

  reveal() { if (this.panel) this.panel.reveal(); }

  readLogins() {
    Promise.resolve().then(() => this.ghLogins()).catch(() => []).then((logins) => {
      this.logins = Array.isArray(logins) ? logins : [];
      this.refresh();
    });
  }

  // ---- state

  company() { const c = this.roost.company; return c && c.ok ? c.company : null; }

  // a part is "on" while its switch is on and it has not failed
  on(id) { return this.roost.parts.has(id) && this.roost.isEnabled(id) && !this.roost.entry(id).failed; }

  // a part has started (its commands are registered): a key or token is sent to its command only then, so it never
  // leaves the extension host for a command that isn't there yet
  running(id) { return this.roost.parts.has(id) && this.roost.state(id) === 'on'; }

  title(id, dflt) { return this.roost.parts.has(id) ? this.roost.entry(id).part.title : dflt; }

  rowFor(section) {
    if (!this.roost.hasTools()) return '';
    const file = this.vscode.workspace.getConfiguration(section).get('signIn.tokenFile', '');
    return (typeof file === 'string' && file && this.roost.toolsNow().rowForTokenFile(file)) || '';
  }

  // Each step's signal now
  signals() {
    const ctx = (k) => !!(this.roost.contexts && this.roost.contexts.get(k) === true);
    const c = this.company();
    const tools = this.roost.tools;
    return {
      github: ctx('kestrel.signedIn'),
      claude: c && c.gateway ? ctx('perch.gatewayReady') : ctx('perch.claudeConnected'),
      agents: ctx('perch.messageSent'),
      tools: !!(tools && tools.allConnected()),
      teams: ctx('chirp.signedIn'),
      jira: ctx('jay.signedIn'),
      codebase: this.vscode.workspace.getConfiguration('agents').get('codebaseIndex.enabled') === true,
      parts: false,
    };
  }

  done() { return { ...(this.store.get(DONE_KEY) || {}) }; }

  markDone(...ids) {
    const done = this.done();
    const fresh = ids.filter((id) => !done[id]);
    if (!fresh.length) return done;
    for (const id of fresh) done[id] = true;
    Promise.resolve(this.store.update(DONE_KEY, done)).catch((err) => this.log(`Get started: could not record a step: ${errorMessage(err)}`));
    return done;
  }

  // Every step whose signal is true is recorded done; done is never cleared
  noteDone() {
    const s = this.signals();
    return this.markDone(...Object.keys(s).filter((id) => s[id]));
  }

  shown(id) {
    if (id === 'tools') return this.roost.hasTools();
    if (id === 'parts') return true;
    return this.on(PART_OF[id]);
  }

  state() {
    const c = this.company();
    const done = this.noteDone();
    const teamsSigned = !!(this.roost.contexts && this.roost.contexts.get('chirp.signedIn') === true);
    if (teamsSigned) this.waiting.teams = false;
    const names = {
      ...NAMES,
      claude: (c && c.steps.gateway) || 'Connect Claude',
      tools: (c && c.steps.tools) || 'Connect your tools',
      agents: (c && c.steps.talk) || NAMES.agents,
    };
    const gwName = (c && c.gateway && c.gateway.name) || '';
    const waiting = { github: this.waiting.github ? WAIT_TERMINAL : '', teams: this.waiting.teams ? WAIT_BROWSER : '',
      claude: this.waiting.claude > 0 ? WAIT_CLAUDE : this.waiting.key > 0 && gwName ? waitKey(gwName) : '' };
    // the details in the company file's words; the gateway step's are the company gateway's while one is named
    const words = { gateway: gwName, title: str(c && c.title) };
    const steps = (c ? ORDER_COMPANY : ORDER_ROOST).filter((id) => this.shown(id))
      .map((id) => ({ id, name: names[id], done: !!done[id], waiting: waiting[id] || '',
        details: stepDetails(id, { companyGateway: !!gwName, words }) }));
    const jira = this.vscode.workspace.getConfiguration('jira');
    const jiraFile = jira.get('signIn.tokenFile', '');
    // the site the user set (user scope only, as the Jira part reads it: never a workspace's), else the company file's;
    // the email is the company file's. The page fills both in unless the user has typed another.
    const userSite = (jira.inspect('site') || {}).globalValue;
    const jiraSite = str(userSite) || str(c && c.jira && c.jira.site);
    return {
      title: `Get started with ${(c && c.title) || 'Roost'}`,
      steps,
      claude: { companyGateway: gwName, keyCommand: !!(c && c.gateway && c.gateway.keyCommand) },
      github: { logins: [...this.logins] },
      teams: { rowId: this.rowFor('teams'), note: teamsSigned ? '' : this.notes.teams },
      jira: { rowId: this.rowFor('jira'), site: jiraSite, email: str(c && c.jira && c.jira.email), form: !(typeof jiraFile === 'string' && jiraFile) },
      parts: [...this.roost.parts.values()].map((e) => ({ id: e.part.id, title: e.part.title, on: this.roost.isEnabled(e.part.id) })),
    };
  }

  // ---- to the page: a post to a page that has closed (or been replaced) is dropped

  post(m, panel = this.panel) {
    if (!panel || panel !== this.panel) return;
    Promise.resolve(panel.webview.postMessage(m)).catch(() => { /* the page just closed */ });
  }

  refresh() {
    if (this.disposed) return;
    try {
      if (!this.panel) { this.noteDone(); return; }
      this.post({ type: 'state', state: this.state() });
    } catch (err) {
      this.log(`Get started: the state could not be sent: ${errorMessage(err)}`);
    }
  }

  rows(rows) { this.post({ type: 'rows', rows }); }

  // ---- from the page

  async onMessage(m) {
    if (!m || typeof m.type !== 'string') return;
    const panel = this.panel;
    const run = (id, ...a) => this.vscode.commands.executeCommand(id, ...a);
    try {
      switch (m.type) {
        case 'ready':
          this.post({ type: 'state', state: this.state() }, panel);
          if (this.roost.hasTools()) this.post({ type: 'rows', rows: this.roost.toolsNow().rows() }, panel);
          break;
        case 'agents': {
          const notRunning = { type: 'agents', error: `${this.title('agents', 'Agents')} isn't running.` };
          if (!this.running('agents')) { this.post(notRunning, panel); break; }
          // Claude's login answers only once it ends: the step says it is waiting until then
          const of = m.request && typeof m.request.type === 'string' ? m.request.type : '';
          const login = of === 'subscription';
          // Get a key with the company's key helper: the step says so until it ends (the key stays in the Agents part)
          const c = this.company();
          const keyRun = of === 'getKey' && !!(c && c.gateway && c.gateway.keyCommand);
          const waits = login ? 'claude' : keyRun ? 'key' : '';
          if (waits) { this.waiting[waits]++; this.refresh(); }
          let reply;
          try {
            const replies = await run('perch.connectClaude.request', m.request);
            reply = { type: 'agents', replies: Array.isArray(replies) ? replies : [], of };
          } catch (err) {
            this.log(`Get started: agents: ${errorMessage(err)}`);
            reply = notRunning;
          } finally {
            if (waits) this.waiting[waits]--;
          }
          this.post(reply, panel);
          if (waits) this.refresh();
          break;
        }
        case 'jiraForm': {
          const notRunning = { type: 'jira', error: `${this.title('jira', 'Jira')} isn't running.` };
          if (!this.running('jira')) { this.post(notRunning, panel); break; }
          let reply;
          try {
            const error = await run('jay.signInWith', { site: str(m.site), email: str(m.email), token: str(m.token) });
            reply = { type: 'jira', error: typeof error === 'string' && error ? error : null };
          } catch (err) {
            this.log(`Get started: jiraForm: ${errorMessage(err)}`);
            reply = notRunning;
          }
          this.post(reply, panel);
          break;
        }
        case 'github': this.githubSignIn(); break;
        case 'newTab': if (NEW_TAB[m.kind]) await run(NEW_TAB[m.kind]); break;
        case 'notNow':
          if (!NOT_NOW[m.step]) break;
          this.markDone(m.step);
          this.refresh();
          await run(NOT_NOW[m.step]);
          break;
        case 'codebaseOn':
          this.markDone('codebase');
          this.refresh();
          await run('roost.codebaseSearchOn');
          break;
        case 'partsDone': this.markDone('parts'); this.refresh(); break;
        case 'openSettings':
          this.markDone('parts');
          this.refresh();
          await run('roost.openSettings');
          break;
        case 'teamsSignIn': await this.teamsSignIn(); break;
        case 'jiraSignIn': await this.roost.toolSignIn('jira', 'jay.signIn', { panel: false }); break;
        case 'part': {
          if (!this.roost.parts.has(m.id) || typeof m.on !== 'boolean') break;
          this.markDone('parts');
          const T = this.vscode.ConfigurationTarget;
          // the configuration change starts or stops the part (and refreshes the page); a refused stop puts it back
          await this.vscode.workspace.getConfiguration('roost').update(`${m.id}.enabled`, m.on, T.Global);
          break;
        }
        case 'tool':
          if (m.message && typeof m.message === 'object') await this.roost.onToolsMessage(m.message, { reveal: () => this.reveal() });
          break;
        case 'openLink': {
          // a link in a step's details: https only, opened in the browser; any other is ignored
          const url = httpsUrl(m.url);
          if (url) await this.vscode.env.openExternal(this.vscode.Uri.parse(url));
          break;
        }
        default: break;
      }
    } catch (err) {
      this.log(`Get started: ${m.type}: ${errorMessage(err)}`);
    }
  }

  // gh's sign-in in its terminal: the step waits while it is open, and the logins are read again once it closes
  githubSignIn() {
    const { closed } = this.roost.startGithubSignIn();
    this.waiting.github = true;
    this.refresh();
    Promise.resolve(closed).then(() => {
      this.waiting.github = false;
      this.refresh();
      this.readLogins();
    });
  }

  // With a tools row for teams.signIn.tokenFile, that row signs in in the page; else Teams' own sign-in in the
  // browser, and the step waits until chirp.signedIn. chirp.signIn resolves quietly when the sign-in doesn't finish
  // (cancelled, failed, offline, admin approval needed): then the waiting line goes and a short note says so.
  async teamsSignIn() {
    const viaRow = !!this.rowFor('teams');
    if (!viaRow) {
      this.waiting.teams = true;
      this.notes.teams = '';
      this.refresh();
    }
    try {
      await this.roost.toolSignIn('teams', 'chirp.signIn', { panel: false });
    } catch (err) {
      this.waiting.teams = false;
      this.refresh();
      throw err;
    }
    if (viaRow) return;
    if (!(this.roost.contexts && this.roost.contexts.get('chirp.signedIn') === true)) {
      this.waiting.teams = false;
      this.notes.teams = TEAMS_NOT_SIGNED_IN;
    }
    this.refresh();
  }

  dispose() {
    this.disposed = true;
    for (const d of this.subs.splice(0)) d.dispose();
    if (this.panel) this.panel.dispose();
  }
}

module.exports = { GetStarted, VIEW_TYPE, STEP_IDS };
