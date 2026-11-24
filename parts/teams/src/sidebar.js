'use strict';
// The chirp sidebar: a webview view, because the built-in tree can't bold or animate a row (design 101, "The chirp sidebar").
const vscode = require('vscode');
const crypto = require('crypto');

// the page's buttons, and the commands they run
const ACTIONS = { signIn: 'chirp.signIn', cancelSignIn: 'chirp.cancelSignIn', copyCode: 'chirp.copyCode', enableChannels: 'chirp.enableChannels', copyAdminLink: 'chirp.copyAdminLink' };

class Sidebar {
  constructor(extensionUri, { meName = () => '' } = {}) {
    this.extensionUri = extensionUri;
    this.meName = meName;
    this.view = null;
    this.state = { chats: [], teams: [], status: null };
    this.openers = [];
    this.companyAppHandlers = [];
    this.ready = false; this.formPending = false;
  }

  resolveWebviewView(view) {
    this.view = view;
    this.ready = false;
    const media = vscode.Uri.joinPath(this.extensionUri, 'media');
    view.webview.options = { enableScripts: true, localResourceRoots: [media] };
    const nonce = crypto.randomBytes(16).toString('base64');
    const css = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.css'));
    const js = view.webview.asWebviewUri(vscode.Uri.joinPath(media, 'sidebar.js'));
    const csp = view.webview.cspSource;
    view.webview.html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp}; img-src ${csp} https: data:; script-src 'nonce-${nonce}';">
<link rel="stylesheet" href="${css}"></head><body><script nonce="${nonce}" src="${js}"></script></body></html>`;
    view.webview.onDidReceiveMessage((m) => {
      if (m && m.type === 'ready') {
        this.ready = true;
        this.post();
        if (this.frontRef) this.view.webview.postMessage({ type: 'front', ref: this.frontRef });
        if (this.formPending) { this.formPending = false; this.view.webview.postMessage({ type: 'openAppForm' }); }
      }
      // the company-app form's Save and sign in: the two IDs as typed; the host checks them
      else if (m && m.type === 'useCompanyApp') for (const fn of this.companyAppHandlers) fn({ clientId: String(m.clientId == null ? '' : m.clientId), tenant: String(m.tenant == null ? '' : m.tenant) });
      else if (m && m.type === 'open' && m.ref) for (const fn of this.openers) fn(m.ref);
      else if (m && m.type === 'findPeople') vscode.commands.executeCommand('chirp.findPeople', String(m.query || ''));
      else if (m && m.type === 'startChat') vscode.commands.executeCommand('chirp.startChat', String(m.userId || ''), String(m.name || ''));
      else if (m && Object.prototype.hasOwnProperty.call(ACTIONS, m.type)) vscode.commands.executeCommand(ACTIONS[m.type]);
    });
    this.post();
  }

  /** New rows or status. Unset keys keep their last value. */
  update(next) {
    Object.assign(this.state, next);
    this.post();
  }

  post() {
    if (!this.view) return;
    const reduceMotion = vscode.workspace.getConfiguration('workbench').get('reduceMotion') === 'on';
    this.view.webview.postMessage(Object.assign({ type: 'state', reduceMotion, meName: this.meName() }, this.state));
    // only mentions Sean hasn't read: a chat that mentions him and is still unread, a channel mention not yet opened
    const names = this.state.chats.filter((r) => r.mention && r.unread).map((r) => r.name)
      .concat(...this.state.teams.map((t) => (t.channels || []).filter((c) => c.mention).map((c) => `${t.name} › ${c.name}`)));
    // a 0 badge is hidden; setting undefined may leave the last badge on screen
    this.view.badge = { value: names.length, tooltip: names.length ? `Mentions you: ${names.join(', ')}` : '' };
  }

  onOpen(fn) { this.openers.push(fn); }
  onUseCompanyApp(fn) { this.companyAppHandlers.push(fn); }

  /** Opens the company-app form, prefilled, and focuses it; a page not loaded yet gets it once it is. */
  openAppForm() {
    if (!this.ready) this.formPending = true;
    if (!this.view) return;
    if (this.view.show) this.view.show(false);
    this.view.webview.postMessage({ type: 'openAppForm' });
  }
  /** The form's outcome: { ok: true } closes it; { ok: false, errors: { clientId?, tenant?, save? } } shows why, inline. */
  appFormResult(r) { if (this.view) this.view.webview.postMessage(Object.assign({ type: 'appFormResult' }, r)); }

  /** The chirp tab in front: its row is highlighted. Kept, so a sidebar shown later gets it too. */
  front(ref) {
    this.frontRef = ref ? { kind: ref.kind, id: ref.id, teamId: ref.teamId } : null;
    if (this.view && this.frontRef) this.view.webview.postMessage({ type: 'front', ref: this.frontRef });
  }

  focusFilter() {
    if (this.view && this.view.show) this.view.show(false);
    if (this.view) this.view.webview.postMessage({ type: 'focusFilter' });
  }
}

module.exports = { Sidebar };
