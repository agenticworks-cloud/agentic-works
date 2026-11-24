'use strict';
const test = require('node:test'); const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const A = require('../src/auth');

/** A JWT-shaped token with the given payload; the signature is never checked. */
const jwt = (payload) => ['{"alg":"none"}', JSON.stringify(payload), 'sig'].map((x, i) => (i < 2 ? Buffer.from(x).toString('base64url') : x)).join('.');

test('scopes are exactly the design\'s', () => {
  assert.deepStrictEqual(A.CHAT_SCOPES, ['User.Read', 'Chat.ReadWrite', 'ChatMessage.Send', 'Chat.Create', 'User.ReadBasic.All', 'offline_access']);
  assert.deepStrictEqual(A.CHANNEL_SCOPES, ['Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send']);
  assert.strictEqual(A.AUTHORITY, 'https://login.microsoftonline.com/organizations/oauth2/v2.0');
  assert.match(A.CHIRP_CLIENT_ID, /^[0-9a-f-]{36}$/);
});

test('graph scopes are prefixed, offline_access is not', () => {
  assert.strictEqual(A.graphScope('Chat.ReadWrite'), 'https://graph.microsoft.com/Chat.ReadWrite');
  assert.strictEqual(A.graphScope('offline_access'), 'offline_access');
});

test('claims reads appid, falling back to azp', () => {
  assert.deepStrictEqual(A.claims(jwt({ appid: 'app', tid: 't', oid: 'o', upn: 'u@x.com', name: 'U' })), { appid: 'app', tid: 't', oid: 'o', upn: 'u@x.com', name: 'U' });
  assert.strictEqual(A.claims(jwt({ azp: 'app2', tid: 't', oid: 'o', preferred_username: 'p@x.com' })).appid, 'app2');
  assert.strictEqual(A.claims(jwt({ azp: 'a', preferred_username: 'p@x.com' })).upn, 'p@x.com', 'upn falls back to preferred_username');
});

test('claims of garbage is null', () => {
  for (const bad of ['', 'nope', 'a.b', null, undefined, 'a.!!!.c']) assert.strictEqual(A.claims(bad), null);
});

test('the error kinds', () => {
  const e = new A.SignInFailed('expired', 'Sign-in code expired.');
  assert.ok(e instanceof Error); assert.strictEqual(e.kind, 'expired'); assert.strictEqual(e.message, 'Sign-in code expired.');
  assert.ok(new A.SignInCancelled() instanceof Error);
  assert.ok(A.SignInNeeded && A.Offline);
});

function tokenFile(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chirp-auth-'));
  const file = path.join(dir, 't.json');
  fs.writeFileSync(file, JSON.stringify({ access_token: jwt(payload), refresh_token: 'r', client_id: 'c', tenant_id: 'tid', expires_at: Date.now() / 1000 + 3600 }));
  return file;
}

test('token-file auth reads the account from the token', async () => {
  const a = A.createTokenFileAuth({ file: tokenFile({ appid: 'x', tid: 'tid', oid: 'me', upn: 'alex@contoso.com', name: 'Alex' }), fetch: async () => { throw new Error('no'); } });
  assert.strictEqual(a.method, 'tokenFile');
  assert.strictEqual(a.account(), null, 'unknown until the token is read');
  await a.signIn({});
  assert.deepStrictEqual(a.account(), { id: 'me', username: 'alex@contoso.com', name: 'Alex', tenantId: 'tid' });
  assert.strictEqual(a.hasChannels(), true);
  assert.strictEqual(a.tenantId(), 'tid');
});

test('token-file signIn without a file is SignInNeeded', async () => {
  const a = A.createTokenFileAuth({ file: path.join(os.tmpdir(), 'no-such-chirp-file.json'), fetch: async () => null });
  await assert.rejects(a.signIn({}), A.SignInNeeded);
});

test('token-file signOut leaves the file alone', async () => {
  const file = tokenFile({ oid: 'me' });
  const before = fs.readFileSync(file, 'utf8');
  const a = A.createTokenFileAuth({ file, fetch: async () => null });
  await a.signOut();
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
});

// ---- choosing the method (Task 4)
function fakeMethod(method, o = {}) {
  const m = { method, calls: [], signedIn: !!o.session,
    async signIn(opts) { m.calls.push(['signIn', opts]); if (o.signIn) return o.signIn(opts); m.signedIn = true; },
    async accessToken() { m.calls.push(['accessToken']); if (!m.signedIn) throw new A.SignInNeeded(); return method + '-token'; },
    async refresh() { return method + '-token'; }, tenantId: () => 't', account: () => ({ id: method }), hasChannels: () => false,
    async signOut() { m.calls.push(['signOut']); m.signedIn = false; } };
  return m;
}
function chooser(o) {
  const made = {}; const notes = [];
  const mk = (name) => () => { made[name] = made[name] || (o[name] === null ? null : fakeMethod(name, o[name] || {})); return made[name]; };
  const auth = A.createAuth({ method: o.method || 'auto', tokenFile: o.tokenFile || '', makeEditor: mk('editor'), makeDeviceCode: mk('deviceCode'), makeTokenFile: mk('tokenFile'), onNote: (t) => notes.push(t) });
  return { auth, made, notes };
}

test('auto prefers a configured token file', async () => {
  const { auth, made } = chooser({ tokenFile: '/x/t.json' });
  await auth.signIn({});
  assert.strictEqual(auth.current().method, 'tokenFile');
  assert.strictEqual(made.editor, undefined, 'the editor is never asked');
});

test('auto falls back to device code when the editor is unusable, with the note', async () => {
  const { auth, notes } = chooser({ editor: { signIn: async () => { throw new A.SignInFailed('unusable', 'nope'); } } });
  await auth.signIn({});
  assert.strictEqual(auth.current().method, 'deviceCode');
  assert.deepStrictEqual(notes, ["Your editor's Microsoft sign-in can't be used; using a sign-in code"]);
  assert.strictEqual(await auth.accessToken(), 'deviceCode-token');
  assert.deepStrictEqual(auth.account(), { id: 'deviceCode' });
});

test('auto with no editor provider uses device code without a note', async () => {
  const { auth, notes } = chooser({ editor: null });
  await auth.signIn({});
  assert.strictEqual(auth.current().method, 'deviceCode');
  assert.deepStrictEqual(notes, []);
});

test('cancel does not fall back', async () => {
  const { auth, made } = chooser({ editor: { signIn: async () => { throw new A.SignInCancelled(); } } });
  await assert.rejects(auth.signIn({}), A.SignInCancelled);
  assert.strictEqual(made.deviceCode, undefined);
  assert.strictEqual(auth.current(), null);
});

test('explicit deviceCode never touches the editor', async () => {
  const { auth, made } = chooser({ method: 'deviceCode' });
  await auth.signIn({});
  assert.strictEqual(auth.current().method, 'deviceCode');
  assert.strictEqual(made.editor, undefined);
});

test('explicit editor does not fall back', async () => {
  const { auth, made } = chooser({ method: 'editor', editor: { signIn: async () => { throw new A.SignInFailed('unusable', 'x'); } } });
  await assert.rejects(auth.signIn({}), (e) => e.kind === 'unusable');
  assert.strictEqual(made.deviceCode, undefined);
});

test('a restart finds the existing device-code session', async () => {
  const { auth } = chooser({ deviceCode: { session: true } });
  assert.strictEqual(auth.current(), null);
  assert.strictEqual(await auth.accessToken(), 'deviceCode-token', 'the editor has none; device code does');
  assert.strictEqual(auth.current().method, 'deviceCode');
});

test('no session anywhere is sign-in needed', async () => {
  const { auth } = chooser({});
  await assert.rejects(auth.accessToken(), A.SignInNeeded);
  assert.strictEqual(auth.account(), null);
  assert.strictEqual(auth.hasChannels(), false);
});

test('the channel step uses the method that signed in', async () => {
  const { auth, made } = chooser({ editor: { signIn: async () => { throw new A.SignInFailed('unusable', 'x'); } } });
  await auth.signIn({});
  await auth.signIn({ channels: true });
  assert.deepStrictEqual(made.deviceCode.calls.filter((c) => c[0] === 'signIn').map((c) => c[1].channels), [undefined, true]);
});

test('sign out forgets the method', async () => {
  const { auth, made } = chooser({ method: 'deviceCode' });
  await auth.signIn({});
  await auth.signOut();
  assert.ok(made.deviceCode.calls.some((c) => c[0] === 'signOut'));
  assert.strictEqual(auth.current(), null);
});

// ---- the app chirp signs in with (teams.signIn.clientId / teams.signIn.tenant)
const CO = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('no settings: chirp\'s own app, any work or school account', () => {
  assert.deepStrictEqual(A.signInApp({}), { clientId: A.CHIRP_CLIENT_ID, tenant: 'organizations', company: false, notes: [] });
  assert.deepStrictEqual(A.signInApp({ clientId: '', tenant: '' }, 'cid'), { clientId: 'cid', tenant: 'organizations', company: false, notes: [] });
});

test('a company app and tenant, trimmed and lower-cased', () => {
  assert.deepStrictEqual(A.signInApp({ clientId: ` ${CO.toUpperCase()} `, tenant: 'Contoso.onmicrosoft.com' }), { clientId: CO, tenant: 'contoso.onmicrosoft.com', company: true, notes: [] });
  assert.deepStrictEqual(A.signInApp({ clientId: CO, tenant: '4A2B8C1D-0E3F-4A5B-9C6D-7E8F9A0B1C2D' }).tenant, '4a2b8c1d-0e3f-4a5b-9c6d-7e8f9a0b1c2d');
  assert.strictEqual(A.signInApp({ tenant: 'contoso.com' }).company, false, "a tenant alone keeps chirp's app");
  assert.strictEqual(A.signInApp({ clientId: A.CHIRP_CLIENT_ID }).company, false, "chirp's own id is not a company app");
});

test('invalid values are ignored, each with a note', () => {
  const a = A.signInApp({ clientId: 'my-app', tenant: 'https://login.microsoftonline.com/x' }, 'cid');
  assert.deepStrictEqual([a.clientId, a.tenant, a.company], ['cid', 'organizations', false]);
  assert.strictEqual(a.notes.length, 2);
  assert.match(a.notes[0], /teams\.signIn\.clientId/); assert.match(a.notes[1], /teams\.signIn\.tenant/);
});

test('the checks: GUIDs, domains, organizations', () => {
  for (const ok of [CO, CO.toUpperCase(), '']) assert.strictEqual(A.clientIdProblem(ok), null, ok);
  for (const bad of ['x', CO + '0', CO.replace(/-/g, ''), '{' + CO + '}']) assert.ok(A.clientIdProblem(bad), bad);
  assert.ok(A.clientIdProblem('', { required: true }), 'the command needs one');
  for (const ok of [CO, 'contoso.onmicrosoft.com', 'contoso.com', 'organizations', '']) assert.strictEqual(A.tenantProblem(ok), null, ok);
  for (const bad of ['contoso', 'common', 'consumers', 'a b.com', 'contoso.onmicrosoft.com/x', '-x.com']) assert.ok(A.tenantProblem(bad), bad);
  assert.ok(A.tenantProblem(' ', { required: true }));
});

test('authority and admin link follow the tenant', () => {
  assert.strictEqual(A.authorityFor('contoso.com'), 'https://login.microsoftonline.com/contoso.com/oauth2/v2.0');
  assert.strictEqual(A.authorityFor(''), A.AUTHORITY);
  assert.strictEqual(A.adminConsentLink('cid'), 'https://login.microsoftonline.com/organizations/adminconsent?client_id=cid');
  assert.strictEqual(A.adminConsentLink(CO, 'contoso.com'), `https://login.microsoftonline.com/contoso.com/adminconsent?client_id=${CO}`);
});

function companyChooser(o) {
  const made = {}; const notes = [];
  const mk = (name) => () => { made[name] = made[name] || (o[name] === null ? null : fakeMethod(name, o[name] || {})); return made[name]; };
  const auth = A.createAuth({ method: o.method || 'auto', tokenFile: o.tokenFile || '', preferCode: true, makeEditor: mk('editor'), makeDeviceCode: mk('deviceCode'), makeTokenFile: mk('tokenFile'), onNote: (t) => notes.push(t) });
  return { auth, made, notes };
}

test('auto with a company app: the sign-in code first, the editor never asked', async () => {
  const { auth, made } = companyChooser({});
  await auth.signIn({});
  assert.strictEqual(auth.current().method, 'deviceCode');
  assert.strictEqual(made.editor, undefined);
});

test('auto with a company app: no public client flows moves on to the editor, with a note', async () => {
  const { auth, notes } = companyChooser({ deviceCode: { signIn: async () => { throw new A.SignInFailed('misconfigured', 'x'); } } });
  await auth.signIn({});
  assert.strictEqual(auth.current().method, 'editor');
  assert.deepStrictEqual(notes, [A.CODE_FALLBACK_NOTE]);
});

test('auto with a company app: an expired code does not move on', async () => {
  const { auth, made } = companyChooser({ deviceCode: { signIn: async () => { throw new A.SignInFailed('expired', 'x'); } } });
  await assert.rejects(auth.signIn({}), (e) => e.kind === 'expired');
  assert.strictEqual(made.editor, undefined);
});

test('a company app: explicit methods and the token file are honoured', async () => {
  let c = companyChooser({ method: 'editor' }); await c.auth.signIn({});
  assert.strictEqual(c.auth.current().method, 'editor'); assert.strictEqual(c.made.deviceCode, undefined);
  c = companyChooser({ method: 'deviceCode' }); await c.auth.signIn({});
  assert.strictEqual(c.auth.current().method, 'deviceCode'); assert.strictEqual(c.made.editor, undefined);
  c = companyChooser({ tokenFile: '/x/t.json' }); await c.auth.signIn({});
  assert.strictEqual(c.auth.current().method, 'tokenFile');
});

test('a company app: a restart finds the editor session too', async () => {
  const { auth } = companyChooser({ editor: { session: true } });
  assert.strictEqual(await auth.accessToken(), 'editor-token');
  assert.strictEqual(auth.current().method, 'editor');
});
