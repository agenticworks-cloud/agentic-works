'use strict';
// The host of Agentic Works' Get started page (src/getStartedPage.js): one editor tab at a time, kept alive while hidden and
// not brought back after a reload. It sends the page its state (the steps shown for the parts that are on, in the
// company file's words and order, each ticked once its signal is true and kept done in globalState) and answers the
// page's messages through the parts' own commands (perch.connectClaude.request, jay.signInWith, chirp.signIn, ...)
// and Agentic Works' (the walkthrough's commands, Connect Your Tools' host). A key or token the page sends goes to the
// command only: nothing posted holds one, and only a message's type and an error's text are logged. A reply that
// comes after the page closed is dropped. Each step carries its details, rendered here (src/stepDetails.js); a link
// clicked in them is opened in the browser when it is https, and ignored otherwise. (Design: docs/notes/101-agentic-works.md,
// "Settled while planning 0.5", and the 0.5.2 bullet.)
//
// With the company file's gateway.openTabOnTalk (0.5.4), the talk step has no New Claude Tab / New Codex Tab: once
// the gateway is ready (perch.gatewayReady now, not a Not Now), while this page is open, the step not done and the
// Agents part running, a Claude tab on the gateway opens by itself beside the page (agenticWorks.newClaudeGatewayTab), unless
// a Perch tab is already open (perch.sessionCount, which counts the tabs a reload brings back). One open at a time,
// at most once per window, and never again once one has opened (AUTO_TAB_KEY); a failed open is tried again a few
// times while the page is open. With no Perch tab open, the step offers Open Claude Tab.
// The Teams step's own sign-in is started in place ({ inPlace: true }): the device code (chirp.signInCode, read
// while chirp.signInCodeWaiting) shows in the step with Copy code & open (chirp.copyCode) and Cancel
// (chirp.cancelSignIn), and is never logged.
// With the company file's email section (0.5.7), the email step after GitHub asks for the user's address on the
// company's domain (emailSave), kept in globalState EMAIL_KEY, which Agentic Works' parts share: the Agents part gives it to
// the gateway's key helper and Connect Your Tools to its sign-in commands, in the environment variable email.env. It
// fills the Jira form's email too. It is never logged. Not Now ticks the step with nothing saved.
const { randomBytes } = require('node:crypto');
const { getStartedHtml } = require('./getStartedPage');
const { stepDetails, httpsUrl } = require('./stepDetails');
const { companyEmail, EMAIL_KEY } = require('./company');

const VIEW_TYPE = 'agenticWorks.getStarted';
const DONE_KEY = 'agenticWorks.getStarted.done';
// a Claude tab was opened by itself for the talk step (gateway.openTabOnTalk): never again, after a reload too
const AUTO_TAB_KEY = 'agenticWorks.getStarted.autoTabOpened';
// a failed open is tried again after these waits, while the page stays open
const AUTO_TAB_RETRIES_MS = [1000, 3000, 10000];
const OPEN_GATEWAY_TAB = 'agenticWorks.newClaudeGatewayTab';
const TAB_OPEN = ['opened', 'revealed'];   // perch.openGatewayTab's answers when a tab is there
const ORDER_COMPANY = ['github', 'email', 'claude', 'agents', 'tools', 'teams', 'jira', 'secrets', 'codebase', 'parts'];
const ORDER_AGENTIC_WORKS = ['claude', 'agents', 'teams', 'jira', 'github', 'secrets', 'codebase', 'parts'];
const STEP_IDS = [...new Set([...ORDER_COMPANY, ...ORDER_AGENTIC_WORKS])];
const NAMES = {
  github: 'Sign in to GitHub', agents: 'Talk to Claude or Codex', teams: 'Sign in to Teams', jira: 'Connect Jira and Confluence',
  secrets: 'Check messages for secrets', codebase: 'Search your code by meaning', parts: 'Choose your parts',
};
// the part a step belongs to: shown while that part is on and not failed
const PART_OF = { github: 'pullRequests', claude: 'agents', agents: 'agents', secrets: 'agents', codebase: 'agents', teams: 'teams', jira: 'jira' };
const NOT_NOW = { claude: 'agenticWorks.connectClaudeNotNow', tools: 'agenticWorks.toolsNotNow', codebase: 'agenticWorks.codebaseSearchNotNow' };
const NEW_TAB = { claude: 'agenticWorks.newClaudeTab', codex: 'agenticWorks.newCodexTab' };
const GREETING = { fill: 'Hello' };   // typed in the talk step's new tab, whose box takes the focus: Enter sends it
// GitHub's sign-in, by its phase (src/githubSignIn.js)
const WAIT_GITHUB = { starting: "Starting GitHub's sign-in…", code: 'Copy the code, then enter it on GitHub in your browser.',
  finishing: 'Setting up git to use your sign-in…' };
const GIT_NOT_SET_UP = "Signed in, but git isn't set up to use it: run gh auth setup-git in a terminal.";
const WAIT_BROWSER = 'Finish signing in in your browser.';
const WAIT_CLAUDE = 'Signing in to Claude in the terminal…';
// the company's key helper is running (Get a key, with gateway.keyCommand): in the Agents part, which keeps the key
const waitKey = (name) => `Getting your ${name} key…`;
// the helper's last line, as a sentence after it: what it is doing (signing in, a window open)
const asSentence = (line) => { const t = str(line).trim(); return t ? t[0].toUpperCase() + t.slice(1) + (/[.!?…]$/.test(t) ? '' : '.') : ''; };
// chirp.signIn resolved but chirp.signedIn isn't true: cancelled, failed, offline, or the admin-approval wall
const TEAMS_NOT_SIGNED_IN = "Teams isn't signed in. Try again, or see the Teams view for why.";
// a configuration change of these refreshes the page
const WATCHED_SETTINGS = ['agenticWorks', 'agents.codebaseIndex.enabled', 'agents.secretCheck.enabled', 'jira', 'teams.signIn.tokenFile'];

const errorMessage = (e) => (e && e.message) || String(e);
const str = (v) => (typeof v === 'string' ? v : '');

class GetStarted {
  // `agenticWorks`: Agentic Works (src/extension.js); `store`: its globalState; `ghLogins`: the accounts gh is signed in to
  constructor({ agenticWorks, vscode, store, ghLogins, log }) {
    this.agenticWorks = agenticWorks;
    this.vscode = vscode;
    this.store = store;
    this.ghLogins = ghLogins;
    this.log = log;
    this.panel = null;
    this.logins = [];
    // claude: how many subscription logins are out (perch.connectClaude.request answers only once one ends)
    // key: how many Get a key requests with the company's key helper are out
    this.waiting = { teams: false, claude: 0, key: 0 };
    // while a key is being fetched, Agents is asked what its helper is doing (keyStatus) every keyPollMs
    this.keyProgress = '';
    this.keyPollMs = 1000;
    this.keyPollTimer = null;
    this.notes = { teams: '', github: '' };
    // the talk step's tab (gateway.openTabOnTalk): an open out, a retry's timer, how many tried, done for this window
    this.autoTab = { inFlight: false, timer: null, tries: 0, settled: false };
    this.autoTabRetriesMs = AUTO_TAB_RETRIES_MS;   // a test makes them short
    // Teams' device code while the page's sign-in waits on it (chirp.signInCode); gen drops an answer that is stale
    this.teamsCode = null;
    this.teamsCodeGen = 0;
    this.subs = [];
    if (agenticWorks.contexts) this.subs.push(agenticWorks.contexts.onChange((key) => {
      if (key === 'chirp.signInCodeWaiting') this.readTeamsCode();
      this.refresh();
    }));
    this.subs.push(vscode.workspace.onDidChangeConfiguration((e) => {
      if (WATCHED_SETTINGS.some((k) => e.affectsConfiguration(k))) this.refresh();
    }));
  }

  /** While a key is being fetched: ask Agents what its helper is doing, and again in keyPollMs. */
  schedulePoll() {
    if (this.disposed || this.keyPollTimer || this.waiting.key <= 0) return;
    this.keyPollTimer = setTimeout(() => { this.keyPollTimer = null; this.pollKey(); }, this.keyPollMs);
    if (this.keyPollTimer.unref) this.keyPollTimer.unref();
  }
  async pollKey() {
    if (this.waiting.key <= 0) return;
    try {
      const replies = await this.vscode.commands.executeCommand('perch.connectClaude.request', { type: 'keyStatus' });
      const st = Array.isArray(replies) ? replies.find((r) => r && r.type === 'gatewayKeyStatus') : null;
      const progress = st && st.running ? str(st.progress) : '';
      if (this.waiting.key > 0 && progress !== this.keyProgress) { this.keyProgress = progress; this.refresh(); }
    } catch (_) { /* Agents went away: its answer to getKey ends the wait */ }
    this.schedulePoll();
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
      if (this.panel === panel) { this.panel = null; this.stopAutoTabRetry(); }
    });
    panel.webview.html = getStartedHtml({ nonce: randomBytes(16).toString('hex'), cspSource: panel.webview.cspSource });
    // every row checked once, as Connect Your Tools' panel does when it opens
    if (this.agenticWorks.hasTools()) {
      const tools = this.agenticWorks.toolsNow();
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

  company() { const c = this.agenticWorks.company; return c && c.ok ? c.company : null; }

  // a part is "on" while its switch is on and it has not failed
  on(id) { return this.agenticWorks.parts.has(id) && this.agenticWorks.isEnabled(id) && !this.agenticWorks.entry(id).failed; }

  // a part has started (its commands are registered): a key or token is sent to its command only then, so it never
  // leaves the extension host for a command that isn't there yet
  running(id) { return this.agenticWorks.parts.has(id) && this.agenticWorks.state(id) === 'on'; }

  title(id, dflt) { return this.agenticWorks.parts.has(id) ? this.agenticWorks.entry(id).part.title : dflt; }

  rowFor(section) {
    if (!this.agenticWorks.hasTools()) return '';
    const file = this.vscode.workspace.getConfiguration(section).get('signIn.tokenFile', '');
    return (typeof file === 'string' && file && this.agenticWorks.toolsNow().rowForTokenFile(file)) || '';
  }

  ctx(k) { return !!(this.agenticWorks.contexts && this.agenticWorks.contexts.get(k) === true); }

  // the company file's gateway.openTabOnTalk: the talk step's tab opens by itself
  autoTabOn() { const c = this.company(); return !!(c && c.gateway && c.gateway.openTabOnTalk); }

  // Each step's signal now
  signals() {
    const ctx = (k) => this.ctx(k);
    const c = this.company();
    const tools = this.agenticWorks.tools;
    return {
      github: ctx('kestrel.signedIn'),
      claude: c && c.gateway ? ctx('perch.gatewayReady') : ctx('perch.claudeConnected'),
      agents: ctx('perch.messageSent'),
      tools: !!(tools && tools.allConnected()),
      teams: ctx('chirp.signedIn'),
      jira: ctx('jay.signedIn'),
      codebase: this.vscode.workspace.getConfiguration('agents').get('codebaseIndex.enabled') === true,
      email: !!this.email(),
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

  // the Agents part's secret check (on by default): on in this window, and whether this workspace's settings turned it off
  secretCheck() {
    const cfg = this.vscode.workspace.getConfiguration('agents');
    const at = cfg.inspect('secretCheck.enabled') || {};
    return { on: cfg.get('secretCheck.enabled') !== false, offHere: at.workspaceValue === false };
  }

  // the address the email step saved, while it is still one on the company's domain
  email() { return companyEmail(this.company(), this.store.get(EMAIL_KEY)); }

  shown(id) {
    if (id === 'tools') return this.agenticWorks.hasTools();
    if (id === 'email') { const c = this.company(); return !!(c && c.email); }
    if (id === 'parts') return true;
    return this.on(PART_OF[id]);
  }

  // a step shown and neither done nor Not Now'd: Agentic Works reopens the page at each start until there is none
  unfinished() {
    const done = this.noteDone();
    return (this.company() ? ORDER_COMPANY : ORDER_AGENTIC_WORKS).some((id) => this.shown(id) && !done[id]);
  }

  state() {
    const c = this.company();
    const done = this.noteDone();
    const teamsSigned = !!(this.agenticWorks.contexts && this.agenticWorks.contexts.get('chirp.signedIn') === true);
    if (teamsSigned) this.waiting.teams = false;
    const names = {
      ...NAMES,
      email: (c && c.steps.email) || 'Your email',
      claude: (c && c.steps.gateway) || 'Connect Claude',
      tools: (c && c.steps.tools) || 'Connect your tools',
      agents: (c && c.steps.talk) || NAMES.agents,
    };
    const gwName = (c && c.gateway && c.gateway.name) || '';
    const autoTab = this.autoTabOn();
    // the code shows while the page's own sign-in waits on it, and goes once signed in or cancelled
    const teamsCode = !teamsSigned && this.waiting.teams && this.ctx('chirp.signInCodeWaiting') ? this.teamsCode : null;
    const gh = this.agenticWorks.github ? this.agenticWorks.github.flow.state : null;
    const waiting = { github: gh ? WAIT_GITHUB[gh.phase] || '' : '', teams: this.waiting.teams ? WAIT_BROWSER : '',
      claude: this.waiting.claude > 0 ? WAIT_CLAUDE : this.waiting.key > 0 && gwName ? [waitKey(gwName), asSentence(this.keyProgress)].filter(Boolean).join(' ') : '' };
    // the details in the company file's words; the gateway step's are the company gateway's while one is named
    const words = { gateway: gwName, title: str(c && c.title) };
    const steps = (c ? ORDER_COMPANY : ORDER_AGENTIC_WORKS).filter((id) => this.shown(id))
      .map((id) => ({ id, name: names[id], done: !!done[id], waiting: waiting[id] || '',
        details: stepDetails(id, { companyGateway: !!gwName, autoTab, words, note: c && c.notes ? c.notes[id] : '' }) }));
    const jira = this.vscode.workspace.getConfiguration('jira');
    const jiraFile = jira.get('signIn.tokenFile', '');
    // the site the user set (user scope only, as the Jira part reads it: never a workspace's), else the company file's;
    // the email is the one the email step saved, else the company file's. The page fills both in unless the user has
    // typed another.
    const userSite = (jira.inspect('site') || {}).globalValue;
    const jiraSite = str(userSite) || str(c && c.jira && c.jira.site);
    const saved = this.email();
    return {
      title: `Get started with ${(c && c.title) || 'Agentic Works'}`,
      steps,
      email: c && c.email ? { domain: c.email.domain, example: c.email.example, value: saved } : null,
      claude: { companyGateway: gwName, keyCommand: !!(c && c.gateway && c.gateway.keyCommand), keyRunning: this.waiting.key > 0 },
      agents: { autoTab, openTab: autoTab && this.offerTab() },
      github: { logins: [...this.logins], running: !!gh, code: gh && gh.code ? { ...gh.code } : null, note: this.notes.github },
      teams: { rowId: this.rowFor('teams'), note: teamsSigned ? '' : this.notes.teams, code: teamsCode ? { ...teamsCode } : null },
      secretCheck: this.secretCheck(),
      jira: { rowId: this.rowFor('jira'), site: jiraSite, email: saved || str(c && c.jira && c.jira.email), form: !(typeof jiraFile === 'string' && jiraFile) },
      parts: [...this.agenticWorks.parts.values()].map((e) => ({ id: e.part.id, title: e.part.title, on: this.agenticWorks.isEnabled(e.part.id) })),
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
      this.maybeOpenTab();
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
          if (this.agenticWorks.hasTools()) this.post({ type: 'rows', rows: this.agenticWorks.toolsNow().rows() }, panel);
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
          if (waits === 'key') this.schedulePoll();
          let reply;
          try {
            const replies = await run('perch.connectClaude.request', m.request);
            reply = { type: 'agents', replies: Array.isArray(replies) ? replies : [], of };
          } catch (err) {
            this.log(`Get started: agents: ${errorMessage(err)}`);
            reply = notRunning;
          } finally {
            if (waits) this.waiting[waits]--;
            if (waits === 'key' && this.waiting.key <= 0) { clearTimeout(this.keyPollTimer); this.keyPollTimer = null; this.keyProgress = ''; }
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
        case 'githubCopyCode': await this.agenticWorks.copyGithubCode(); break;
        case 'githubCancel': this.agenticWorks.cancelGithubSignIn(); break;
        case 'newTab': if (NEW_TAB[m.kind]) await run(NEW_TAB[m.kind], GREETING); break;
        case 'openTab': if (this.autoTabOn() && this.running('agents')) await this.openTabNow(); break;
        case 'teamsCopyCode':
          // chirp.copyCode copies the code and opens the page itself: only while a code with an https page waits
          if (this.teamsCode && httpsUrl(this.teamsCode.verificationUri) && this.running('teams')) await run('chirp.copyCode');
          break;
        case 'teamsCancel': if (this.running('teams')) await run('chirp.cancelSignIn'); break;
        case 'emailSave': {
          const c = this.company();
          if (!c || !c.email) break;
          const value = companyEmail(c, m.email);
          if (!value) { this.post({ type: 'email', error: `Enter your address ending in @${c.email.domain}.` }, panel); break; }
          await this.store.update(EMAIL_KEY, value);
          this.markDone('email');
          this.post({ type: 'email', error: null }, panel);
          this.refresh();
          break;
        }
        case 'notNow':
          if ((m.step === 'email' || m.step === 'secrets') && this.shown(m.step)) { this.markDone(m.step); this.refresh(); break; }
          if (!NOT_NOW[m.step]) break;
          this.markDone(m.step);
          this.refresh();
          await run(NOT_NOW[m.step]);
          break;
        case 'secretsOn': {
          // Keep it on, or Turn it on: an off at the user or workspace level is taken away, so the default (on) holds
          const cfg = this.vscode.workspace.getConfiguration('agents');
          const at = cfg.inspect('secretCheck.enabled') || {};
          const T = this.vscode.ConfigurationTarget;
          this.markDone('secrets');
          try {
            if (at.globalValue === false) await cfg.update('secretCheck.enabled', undefined, T.Global);
            if (at.workspaceValue === false) await cfg.update('secretCheck.enabled', undefined, T.Workspace);
          } catch (err) { this.log(`Get started: could not turn the secret check on: ${errorMessage(err)}`); }
          this.refresh();
          break;
        }
        case 'codebaseOn':
          this.markDone('codebase');
          this.refresh();
          await run('agenticWorks.codebaseSearchOn');
          break;
        case 'partsDone': this.markDone('parts'); this.refresh(); break;
        case 'openSettings':
          this.markDone('parts');
          this.refresh();
          await run('agenticWorks.openSettings');
          break;
        case 'teamsSignIn': await this.teamsSignIn(); break;
        case 'jiraSignIn': await this.agenticWorks.toolSignIn('jira', 'jay.signIn', { panel: false }); break;
        case 'part': {
          if (!this.agenticWorks.parts.has(m.id) || typeof m.on !== 'boolean') break;
          this.markDone('parts');
          const T = this.vscode.ConfigurationTarget;
          // the configuration change starts or stops the part (and refreshes the page); a refused stop puts it back
          await this.vscode.workspace.getConfiguration('agenticWorks').update(`${m.id}.enabled`, m.on, T.Global);
          break;
        }
        case 'tool':
          if (m.message && typeof m.message === 'object') await this.agenticWorks.onToolsMessage(m.message, { reveal: () => this.reveal() });
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

  // GitHub's sign-in on the page (Agentic Works' startGithubSignIn): the step shows its phase and code while it runs
  githubSignIn() {
    if (!this.agenticWorks.github) this.notes.github = '';
    this.agenticWorks.startGithubSignIn();
    this.refresh();
  }

  // How it went, from Agentic Works, whoever started it: a reason left on the step, unless cancelled; the logins read again
  githubDone(r) {
    this.notes.github = r.ok ? (r.gitSetUp ? '' : GIT_NOT_SET_UP) : r.cancelled ? '' : r.error || '';
    this.refresh();
    this.readLogins();
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
      await this.agenticWorks.toolSignIn('teams', 'chirp.signIn', { panel: false, args: [{ inPlace: true }] });
    } catch (err) {
      this.waiting.teams = false;
      this.refresh();
      throw err;
    }
    if (viaRow) return;
    if (!(this.agenticWorks.contexts && this.agenticWorks.contexts.get('chirp.signedIn') === true)) {
      this.waiting.teams = false;
      this.notes.teams = TEAMS_NOT_SIGNED_IN;
    }
    this.refresh();
  }

  // ---- the talk step's tab (gateway.openTabOnTalk)

  // Open Claude Tab is offered while no Perch tab is open, the gateway is ready and no open is out or waiting
  offerTab() {
    const a = this.autoTab;
    return this.running('agents') && this.ctx('perch.gatewayReady') && !this.ctx('perch.sessionOpen') && !a.inFlight && !a.timer;
  }

  // Called with each refresh while the page is open: opens the tab when every condition holds (the header above)
  maybeOpenTab() {
    const a = this.autoTab;
    if (!this.autoTabOn() || !this.panel || a.inFlight || a.timer || a.settled) return;
    if (this.store.get(AUTO_TAB_KEY)) { a.settled = true; return; }
    // the gateway ready now: the claude step done by Not Now alone is not it
    if (!this.ctx('perch.gatewayReady') || !this.running('agents')) return;
    if (this.done().agents || this.ctx('perch.messageSent')) return;
    a.inFlight = true;
    const panel = this.panel;
    this.autoOpen(panel).catch((err) => this.log(`Get started: the Claude tab could not be opened: ${errorMessage(err)}`));
  }

  async autoOpen(panel) {
    const a = this.autoTab;
    const run = (id, ...args) => this.vscode.commands.executeCommand(id, ...args);
    let result = 'failed';
    try {
      // a Perch tab open already (one the window brought back, one first start opened, one in the side bar): none opened
      const count = await run('perch.sessionCount');
      if (this.disposed || this.panel !== panel) return;
      if (typeof count === 'number' && count > 0) { a.settled = true; return; }
      result = await run(OPEN_GATEWAY_TAB, GREETING);
    } catch (err) {
      this.log(`Get started: the Claude tab could not be opened: ${errorMessage(err)}`);
      result = 'failed';
    } finally {
      a.inFlight = false;
    }
    if (this.disposed) return;
    if (TAB_OPEN.includes(result)) this.tabOpened();
    else if (this.panel === panel && a.tries < this.autoTabRetriesMs.length) {
      a.timer = setTimeout(() => { a.timer = null; this.refresh(); }, this.autoTabRetriesMs[a.tries++]);
      if (a.timer.unref) a.timer.unref();
    } else a.settled = true;   // tried enough for this window: Open Claude Tab stays
    this.refresh();
  }

  // Open Claude Tab: the same command, which shows a tab already open rather than opening another
  async openTabNow() {
    const result = await this.vscode.commands.executeCommand(OPEN_GATEWAY_TAB, GREETING);
    if (TAB_OPEN.includes(result)) this.tabOpened();
    this.refresh();
  }

  tabOpened() {
    this.autoTab.settled = true;
    this.stopAutoTabRetry();
    Promise.resolve(this.store.update(AUTO_TAB_KEY, true)).catch((err) => this.log(`Get started: could not record the Claude tab: ${errorMessage(err)}`));
  }

  stopAutoTabRetry() {
    const a = this.autoTab;
    clearTimeout(a.timer);
    a.timer = null;
    a.tries = 0;
  }

  // ---- Teams' device code, for the page's own sign-in

  readTeamsCode() {
    const gen = ++this.teamsCodeGen;
    if (!this.ctx('chirp.signInCodeWaiting') || !this.running('teams')) { this.teamsCode = null; return; }
    Promise.resolve().then(() => this.vscode.commands.executeCommand('chirp.signInCode')).then((c) => {
      if (gen !== this.teamsCodeGen) return;
      const ok = c && typeof c.userCode === 'string' && c.userCode && typeof c.verificationUri === 'string';
      this.teamsCode = ok ? { userCode: c.userCode, verificationUri: c.verificationUri } : null;
      this.refresh();
    }, (err) => { if (gen === this.teamsCodeGen) { this.teamsCode = null; this.log(`Get started: the Teams code could not be read: ${errorMessage(err)}`); } });
  }

  dispose() {
    this.disposed = true;
    this.stopAutoTabRetry();
    clearTimeout(this.keyPollTimer); this.keyPollTimer = null;
    for (const d of this.subs.splice(0)) d.dispose();
    if (this.panel) this.panel.dispose();
  }
}

module.exports = { GetStarted, VIEW_TYPE, STEP_IDS };
