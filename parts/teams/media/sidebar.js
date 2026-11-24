// The chirp sidebar: a filter box, Chats, then Teams and Channels. Rows are built with textContent only.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const d = document;
  const saved = vscode.getState() || { expanded: {} };
  let state = { chats: [], teams: [], status: null, meName: '' };
  // the highlighted row, by what it is (a chat, a channel, a team, a person), not by its position: the list reorders
  let selectedKey = null;
  const keyOf = (r) => r.dataset.ref || (r.dataset.team ? 'team:' + r.dataset.team : r.dataset.person ? 'person:' + r.dataset.person : '');
  const refKey = (ref) => JSON.stringify(ref.kind === 'channel' ? { kind: 'channel', teamId: ref.teamId, id: ref.id } : { kind: 'chat', id: ref.id });
  const selectedIndex = () => allRows().findIndex((r) => keyOf(r) === selectedKey);

  const el = (tag, cls, text) => { const e = d.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
  const filter = el('input', 'filter'); filter.type = 'text'; filter.placeholder = 'Filter chats and channels'; filter.setAttribute('aria-label', 'Filter chats and channels');
  const status = el('div', 'status'); status.hidden = true;
  const chatsHead = el('div', 'section', 'Chats');
  const chats = el('div', 'list chats'); chats.setAttribute('role', 'listbox');
  const teamsHead = el('div', 'section', 'Teams and Channels');
  const teams = el('div', 'list teams'); teams.setAttribute('role', 'listbox');
  const account = el('div', 'account'); account.hidden = true;
  const signin = el('div', 'signin'); signin.hidden = true;
  const channelsNote = el('div', 'channels-note'); channelsNote.hidden = true;
  d.body.append(filter, account, status, signin, chatsHead, chats, teamsHead, channelsNote, teams);
  const button = (label, type, cls) => { const b = el('button', cls || '', label); b.addEventListener('click', () => vscode.postMessage({ type })); return b; };
  const local = (label, fn, cls) => { const b = el('button', cls || '', label); b.addEventListener('click', fn); return b; };
  // the signed-out page: the sign-in (or its wait, or its code), then the company-app section, built once so what is
  // typed and where the focus is survive every update
  const signinMain = el('div', 'signin-main');
  const company = el('div', 'company'); company.hidden = true;
  signin.append(signinMain, company);
  const METHOD = { editor: 'editor', deviceCode: 'sign-in code', tokenFile: 'token file' };

  /** Signing in: the button, the wait, or the code. While signed out the lists are hidden. */
  function renderSignIn() {
    const si = state.signIn;
    const out = !state.account && !!si;
    for (const x of [chatsHead, chats, teamsHead, teams, channelsNote]) if (out) x.hidden = true;
    if (!out) { chatsHead.hidden = false; chats.hidden = false; teamsHead.hidden = false; teams.hidden = false; }
    signin.hidden = !si;
    if (state.account) formOpen = false;
    renderCompany(signedOutPage());
    if (!si) { signinMain.replaceChildren(); return; }
    if (si.stage === 'signedOut') {
      signinMain.replaceChildren(button('Sign in to Microsoft', 'signIn', 'primary'));
      // after a sign-in that ended without one: Microsoft may have said the app needs approval, which chirp can't see
      if (si.hint) {
        const hint = el('div', 'hint');
        hint.append(el('div', null, 'If Microsoft said Need admin approval, your company has to approve the app first:'), button('Copy admin link', 'copyAdminLink'), local('Use a company app…', openForm));
        signinMain.append(hint);
      }
    }
    else if (si.stage === 'waiting') signinMain.replaceChildren(el('div', 'wait', 'Waiting for sign-in in the browser…'), button('Cancel', 'cancelSignIn'));
    else if (si.stage === 'code') signinMain.replaceChildren(el('div', 'code', si.userCode || ''), button('Copy code & open', 'copyCode', 'primary'), el('div', 'where', `Enter it at ${si.verificationUri || ''}`), button('Cancel', 'cancelSignIn'));
  }

  // ---- a company's own app: the two IDs from IT (Sean, 2026-11-24: a form here, not input boxes at the top of the
  // window). Collapsed unless opened; the host checks what is typed and sends back what is wrong, by field.
  let formOpen = false;
  const companyLine = el('div', 'company-line');
  const companyText = el('span');
  const changeLink = local('Change', () => openForm(), 'link');
  changeLink.setAttribute('aria-label', "Change your company's app");
  companyLine.append(companyText, d.createTextNode(' · '), changeLink);
  const companyToggle = local("Use your company's app", () => (formOpen ? closeForm() : openForm()), 'link company-toggle');
  const form = el('div', 'app-form'); form.id = 'chirp-app-form'; form.hidden = true;
  form.setAttribute('role', 'group'); form.setAttribute('aria-label', "Use your company's app");
  companyToggle.setAttribute('aria-controls', form.id);
  function field(id, label, placeholder) {
    const l = el('label', null, label); l.htmlFor = id;
    const input = el('input', 'field'); input.type = 'text'; input.id = id; input.placeholder = placeholder;
    input.spellcheck = false; input.autocomplete = 'off';
    const err = el('div', 'field-error'); err.id = id + '-error'; err.hidden = true;
    input.setAttribute('aria-describedby', err.id + ' chirp-app-note');
    form.append(l, input, err);
    return { input, err };
  }
  const fClient = field('chirp-app-client', 'Application (client) ID', '01234567-89ab-cdef-0123-456789abcdef');
  const fTenant = field('chirp-app-tenant', 'Directory (tenant) ID or domain', 'e.g. contoso.onmicrosoft.com');
  const formNote = el('div', 'note', 'Your IT team provides both.'); formNote.id = 'chirp-app-note';
  const formError = el('div', 'form-error'); formError.hidden = true; formError.setAttribute('role', 'alert');
  const actions = el('div', 'actions');
  actions.append(local('Save and sign in', submit, 'primary'), local('Cancel', () => closeForm(), 'link'));
  form.append(formNote, formError, actions);
  company.append(companyLine, companyToggle, form);

  const signedOutPage = () => !state.account && !!state.signIn && state.signIn.stage === 'signedOut';
  function renderCompany(show) {
    company.hidden = !show;
    const id = state.companyApp;
    companyLine.hidden = !id;
    companyText.textContent = id ? `Signing in with your company's app (${String(id).slice(0, 8)}…)` : '';
    companyToggle.hidden = !!id;   // set: the line's Change opens the form instead
    companyToggle.setAttribute('aria-expanded', String(formOpen));
    form.hidden = !formOpen;
  }
  function setErrors(errors) {
    for (const [f, msg] of [[fClient, errors.clientId], [fTenant, errors.tenant]]) {
      f.err.textContent = msg || ''; f.err.hidden = !msg;
      if (msg) f.input.setAttribute('aria-invalid', 'true'); else f.input.removeAttribute('aria-invalid');
    }
    formError.textContent = errors.save || ''; formError.hidden = !errors.save;
  }
  /** Opens the form with the settings as they are, and puts the cursor in the first field. */
  function openForm() {
    const a = state.appSettings || {};
    fClient.input.value = a.clientId || ''; fTenant.input.value = a.tenant || '';
    setErrors({}); formOpen = true;
    renderCompany(signedOutPage());
    fClient.input.focus();
  }
  function closeForm() { formOpen = false; setErrors({}); renderCompany(signedOutPage()); }
  function submit() { vscode.postMessage({ type: 'useCompanyApp', clientId: fClient.input.value, tenant: fTenant.input.value }); }
  function formResult(m) {
    if (m.ok) { closeForm(); return; }
    const errors = m.errors || {};
    setErrors(errors);
    if (errors.clientId) fClient.input.focus(); else if (errors.tenant) fTenant.input.focus();
  }
  function renderAccount() {
    const a = state.account;
    account.hidden = !a;
    account.textContent = a ? `Signed in as ${a.username} (${METHOD[a.method] || a.method})` : '';
  }
  /** The Teams section before channels are enabled, or when they can't be. */
  function renderChannels() {
    const c = state.channels;
    if (!state.account || c === 'enabled' || !c || (state.signIn && c === 'off')) { channelsNote.hidden = true; channelsNote.replaceChildren(); return; }
    channelsNote.hidden = false;
    if (c === 'off') channelsNote.replaceChildren(button('Enable channels', 'enableChannels'));
    else if (c === 'failed') channelsNote.replaceChildren(el('div', null, "Channels weren't enabled. If your company requires an admin to approve chirp, send them this link."), button('Copy admin link', 'copyAdminLink'), button('Try again', 'enableChannels'));
    else if (c === 'forbidden') { channelsNote.replaceChildren(); channelsNote.textContent = "Channels need permissions this login doesn't have."; }
  }

  const matches = (name) => !filter.value.trim() || String(name).toLowerCase().includes(filter.value.trim().toLowerCase());

  /** The preview, with Sean's name marked wherever it appears. */
  function preview(text) {
    const p = el('div', 'preview');
    const name = state.meName;
    if (!name) { p.textContent = text; return p; }
    const parts = String(text).split(name);
    parts.forEach((part, i) => { if (i) p.append(el('mark', null, name)); if (part) p.append(d.createTextNode(part)); });
    return p;
  }

  function chatRow(r) {
    const row = el('div', 'row chat'); row.setAttribute('role', 'option');
    if (r.unread) row.classList.add('unread');
    if (r.mention) row.classList.add('mention');
    row.dataset.ref = JSON.stringify({ kind: 'chat', id: r.id });
    if (r.tooltip) row.title = r.tooltip;   // the whole last message on hover; an attribute, so plain text
    const line = el('div', 'line');
    if (r.mention) line.append(el('span', 'at', '@'));
    line.append(el('span', 'name', r.name));
    if (r.unread && r.unreadCount != null) line.append(el('span', 'count', String(r.unreadCount)));
    row.append(line);
    if (r.preview) row.append(preview(r.preview));
    return row;
  }

  function render() {
    d.body.classList.toggle('reduce-motion', !!state.reduceMotion);
    status.hidden = !state.status;
    status.className = 'status' + (state.status ? ' ' + state.status.kind : '');
    status.textContent = state.status ? state.status.text : '';
    chats.replaceChildren(...state.chats.filter((r) => matches(r.name)).map(chatRow));
    teams.replaceChildren(...renderTeams());
    // never just blank: loading on a first run (nothing cached yet), then a plain empty state
    const filtering = !!filter.value.trim();
    if (!chats.children.length) chats.append(el('div', 'empty', filtering ? 'No matches' : state.chatsLoaded === false ? 'Loading chats…' : 'No chats yet'));
    // no chat matches the filter: people from the directory, to start (or reopen) a 1:1 with
    const pe = state.people;
    if (filtering && pe && pe.query === filter.value.trim() && !state.chats.some((r) => matches(r.name))) {
      if (pe.error) chats.append(el('div', 'empty', pe.error));
      else if (pe.results && pe.results.length) {
        chats.append(el('div', 'people-head', 'Start a chat with:'));
        for (const x of pe.results) {
          const row = el('div', 'row person');
          row.dataset.person = JSON.stringify({ userId: x.id, name: x.name });
          row.append(el('div', 'line'), el('div', 'preview', x.mail || ''));
          row.firstChild.append(el('span', 'name', x.name));
          chats.append(row);
        }
      }
    }
    if (!teams.children.length && state.channels === 'enabled') teams.append(el('div', 'empty', filtering ? 'No matches' : state.teamsLoaded === false ? 'Loading teams…' : 'No teams'));
    renderAccount(); renderSignIn(); renderChannels();
    const rows = allRows();
    mark();
  }

  function renderTeams() {
    const out = [];
    for (const t of state.teams || []) {
      const chans = (t.channels || []).filter((c) => matches(c.name) || matches(t.name));
      if (!chans.length && !matches(t.name)) continue;
      const open = !!saved.expanded[t.id] || !!filter.value.trim();
      const head = el('div', 'row team' + (open ? ' open' : ''));
      head.dataset.team = t.id;
      head.append(el('span', 'twisty', open ? '⌄' : '›'), el('span', 'name', t.name));
      if (!open && chans.some((c) => c.mention)) { head.classList.add('mention'); head.prepend(el('span', 'at', '@')); }
      out.push(head);
      if (!open) continue;
      for (const c of chans) {
        const row = el('div', 'row channel');
        if (c.mention) row.classList.add('mention');
        row.dataset.ref = JSON.stringify({ kind: 'channel', teamId: t.id, id: c.id });
        const line = el('div', 'line');
        if (c.mention) line.append(el('span', 'at', '@'));
        line.append(el('span', 'name', c.name));
        row.append(line);
        out.push(row);
      }
    }
    return out;
  }

  const allRows = () => [...d.querySelectorAll('.list .row')];
  function mark() { allRows().forEach((r) => r.classList.toggle('selected', keyOf(r) === selectedKey)); }

  function activate(row) {
    if (!row) return;
    if (row.dataset.person) { const x = JSON.parse(row.dataset.person); vscode.postMessage({ type: 'startChat', userId: x.userId, name: x.name }); return; }
    if (row.dataset.team) { const id = row.dataset.team; saved.expanded[id] = !saved.expanded[id]; vscode.setState(saved); render(); return; }
    vscode.postMessage({ type: 'open', ref: JSON.parse(row.dataset.ref) });
  }

  // when no chat matches, ask the host for people, once typing pauses
  let peopleTimer = null;
  filter.addEventListener('input', () => {
    selectedKey = null; render();
    clearTimeout(peopleTimer);
    const q = filter.value.trim();
    if (q.length >= 2 && !state.chats.some((r) => matches(r.name))) peopleTimer = setTimeout(() => vscode.postMessage({ type: 'findPeople', query: q }), 300);
  });
  d.addEventListener('click', (e) => {
    const row = e.target.closest && e.target.closest('.row');
    if (!row) return;
    selectedKey = keyOf(row); mark(); activate(row);
  });
  d.addEventListener('keydown', (e) => {
    // in the company-app form: Enter saves, Escape cancels; the list's keys stay out of it
    if (company.contains(e.target)) {
      if (e.key === 'Enter' && (e.target === fClient.input || e.target === fTenant.input)) { e.preventDefault(); submit(); }
      else if (e.key === 'Escape' && formOpen) { e.preventDefault(); closeForm(); (state.companyApp ? changeLink : companyToggle).focus(); }
      return;
    }
    const rows = allRows();
    if (e.key === 'Escape' && e.target === filter) { filter.value = ''; render(); return; }
    if (e.key === '/' && e.target !== filter) { e.preventDefault(); filter.focus(); return; }
    const at = selectedIndex();
    const go = (i) => { if (rows[i]) { selectedKey = keyOf(rows[i]); mark(); scroll(); } };
    if (e.key === 'ArrowDown') { e.preventDefault(); go(Math.min(rows.length - 1, at + 1)); return; }
    if (e.key === 'ArrowUp') { e.preventDefault(); go(Math.max(0, at - 1)); return; }
    if (e.key === 'Enter' && at >= 0) { e.preventDefault(); activate(rows[at]); }
  });
  function scroll() { const r = allRows()[selectedIndex()]; if (r && r.scrollIntoView) r.scrollIntoView({ block: 'nearest' }); }

  window.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.type === 'state') { state = m; render(); }
    else if (m.type === 'focusFilter') filter.focus();
    else if (m.type === 'openAppForm') openForm();
    else if (m.type === 'appFormResult') formResult(m);
    else if (m.type === 'front' && m.ref) { selectedKey = refKey(m.ref); mark(); scroll(); }   // the chirp tab in front; a file in front changes nothing
  });
  vscode.postMessage({ type: 'ready' });
})();
