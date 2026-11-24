'use strict';
// Device-code sign-in against a fake Microsoft and a fake secret storage. No network.
const test = require('node:test'); const assert = require('node:assert');
const { createDeviceCodeAuth, KEY } = require('../src/deviceCode');
const { SignInFailed, SignInCancelled, SignInNeeded, Offline, CHAT_SCOPES, CHANNEL_SCOPES, graphScope } = require('../src/auth');

const NOW = Date.parse('2026-11-18T16:00:00Z');
const jwt = (payload) => ['{"alg":"none"}', JSON.stringify(payload), 's'].map((x, i) => (i < 2 ? Buffer.from(x).toString('base64url') : x)).join('.');
const TOKEN = jwt({ oid: 'u1', tid: 'tenant1', upn: 'alex@contoso.com', name: 'Alex', appid: 'cid' });
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const CODE = { device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5 };

function fakeSecrets(initial) {
  const m = new Map(Object.entries(initial || {})); const fns = []; const stored = [];
  return { m, stored, get: async (k) => m.get(k), store: async (k, v) => { stored.push(k); m.set(k, v); }, delete: async (k) => { m.delete(k); }, onDidChange: (fn) => { fns.push(fn); return { dispose() {} }; }, fire: (key) => fns.forEach((f) => f({ key })) };
}
/** answers: list of responses for the token endpoint, in order; devicecode always answers CODE */
function fakeFetch(tokenAnswers) {
  const calls = [];
  const f = async (url, init) => {
    const body = new URLSearchParams(String(init.body));
    calls.push({ url, body });
    if (url.endsWith('/devicecode')) return json(200, CODE);
    const a = tokenAnswers.shift();
    if (typeof a === 'function') return a();
    return a;
  };
  f.calls = calls; return f;
}
const pending = () => json(400, { error: 'authorization_pending' });
const tokens = (o) => json(200, Object.assign({ access_token: TOKEN, refresh_token: 'r1', expires_in: 3600, scope: 'x' }, o));
function make(o) {
  const slept = [];
  const auth = createDeviceCodeAuth(Object.assign({ secrets: fakeSecrets(), clientId: 'cid', onCode: () => {}, now: () => NOW, sleep: async (ms) => { slept.push(ms); } }, o));
  return { auth, slept };
}

test('sign-in polls until tokens arrive', async () => {
  const codes = []; const secrets = fakeSecrets();
  const fetch = fakeFetch([pending(), pending(), tokens()]);
  const { auth } = make({ secrets, fetch, onCode: (c) => codes.push(c) });
  await auth.signIn({});
  assert.deepStrictEqual(codes, [{ userCode: 'ABCD-1234', verificationUri: 'https://microsoft.com/devicelogin', expiresAt: NOW + 900000 }]);
  assert.strictEqual(fetch.calls[0].url, 'https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode');
  assert.strictEqual(fetch.calls[0].body.get('client_id'), 'cid');
  assert.strictEqual(fetch.calls[0].body.get('scope'), CHAT_SCOPES.map(graphScope).join(' '));
  assert.strictEqual(fetch.calls.filter((c) => c.url.endsWith('/token')).length, 3);
  assert.strictEqual(fetch.calls[1].body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
  assert.strictEqual(fetch.calls[1].body.get('device_code'), 'dc');
  const saved = JSON.parse(secrets.m.get(KEY));
  assert.strictEqual(KEY, 'chirp.deviceCode.tokens');
  assert.deepStrictEqual([saved.access_token, saved.refresh_token, saved.expires_at, saved.tenant_id, saved.channels], [TOKEN, 'r1', NOW / 1000 + 3600, 'tenant1', false]);
  assert.deepStrictEqual(auth.account(), { id: 'u1', username: 'alex@contoso.com', name: 'Alex', tenantId: 'tenant1' });
  assert.strictEqual(auth.method, 'deviceCode');
  assert.strictEqual(auth.hasChannels(), false);
  assert.strictEqual(await auth.accessToken(), TOKEN);
});

test('slow_down adds five seconds', async () => {
  const { auth, slept } = make({ fetch: fakeFetch([json(400, { error: 'slow_down' }), tokens()]) });
  await auth.signIn({});
  assert.deepStrictEqual(slept, [5000, 10000]);
});

test('expired, declined, personal, misconfigured and consent map to SignInFailed kinds', async () => {
  const cases = [
    [json(400, { error: 'expired_token' }), 'expired', 'Sign-in code expired.'],
    [json(400, { error: 'authorization_declined' }), 'declined', 'Sign-in was declined.'],
    [json(401, { error: 'invalid_client', error_description: 'AADSTS7000218: The request body must contain client_assertion' }), 'misconfigured', 'The app\'s registration doesn\'t allow sign-in codes (AADSTS7000218): it needs "Allow public client flows".'],
    [json(400, { error: 'invalid_grant', error_description: 'AADSTS65001: The user or administrator has not consented to use the application' }), 'consent', 'Microsoft says your company has to approve the app first.'],
    [json(400, { error: 'access_denied', error_description: 'AADSTS90094: The grant requires admin permission.' }), 'consent', 'Microsoft says your company has to approve the app first.'],
    [json(400, { error: 'invalid_request', error_description: 'AADSTS50020: User account from identity provider live.com does not exist in tenant' }), 'personal', 'chirp needs a work or school Microsoft 365 account.'],
  ];
  for (const [answer, kind, message] of cases) {
    const { auth } = make({ fetch: fakeFetch([answer]) });
    await assert.rejects(auth.signIn({}), (e) => e instanceof SignInFailed && e.kind === kind && e.message === message, kind);
  }
});

test('the code running out while pending is expired', async () => {
  let t = NOW;
  const { auth } = make({ now: () => t, fetch: fakeFetch([() => { t += 901000; return pending(); }]) });
  await assert.rejects(auth.signIn({}), (e) => e instanceof SignInFailed && e.kind === 'expired');
});

test('cancel stops polling', async () => {
  const cancel = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const fetch = fakeFetch([() => { cancel.isCancellationRequested = true; return pending(); }, tokens()]);
  const { auth } = make({ fetch });
  await assert.rejects(auth.signIn({ cancel }), SignInCancelled);
  assert.strictEqual(fetch.calls.filter((c) => c.url.endsWith('/token')).length, 1);
});

test('a network blip while polling keeps polling', async () => {
  const { auth } = make({ fetch: fakeFetch([() => { throw new TypeError('fetch failed'); }, tokens()]) });
  await auth.signIn({});
  assert.strictEqual(await auth.accessToken(), TOKEN);
});

test('channels sign-in asks for both scope sets', async () => {
  const secrets = fakeSecrets();
  const fetch = fakeFetch([tokens()]);
  const { auth } = make({ secrets, fetch });
  await auth.signIn({ channels: true });
  assert.strictEqual(fetch.calls[0].body.get('scope'), CHAT_SCOPES.concat(CHANNEL_SCOPES).map(graphScope).join(' '));
  assert.strictEqual(auth.hasChannels(), true);
  assert.strictEqual(JSON.parse(secrets.m.get(KEY)).channels, true);
});

const stored = (o) => JSON.stringify(Object.assign({ access_token: TOKEN, refresh_token: 'r1', expires_at: NOW / 1000 + 30, tenant_id: 'tenant1', scope: 'User.Read offline_access', channels: false }, o));

test('refresh near expiry updates secret storage', async () => {
  const secrets = fakeSecrets({ [KEY]: stored() });
  const fresh = jwt({ oid: 'u1', tid: 'tenant1', appid: 'cid' });
  const fetch = fakeFetch([json(200, { access_token: fresh, refresh_token: 'r2', expires_in: 3600 })]);
  const { auth } = make({ secrets, fetch });
  assert.strictEqual(await auth.accessToken(), fresh);
  const body = fetch.calls[0].body;
  assert.deepStrictEqual([body.get('grant_type'), body.get('refresh_token'), body.get('client_id'), body.get('scope')], ['refresh_token', 'r1', 'cid', 'User.Read offline_access']);
  assert.deepStrictEqual([JSON.parse(secrets.m.get(KEY)).refresh_token, JSON.parse(secrets.m.get(KEY)).expires_at], ['r2', NOW / 1000 + 3600]);
});

test('one refresh at a time', async () => {
  const secrets = fakeSecrets({ [KEY]: stored() });
  const fetch = fakeFetch([async () => { await new Promise((r) => setTimeout(r, 10)); return json(200, { access_token: TOKEN, refresh_token: 'r2', expires_in: 3600 }); }]);
  const { auth } = make({ secrets, fetch });
  await Promise.all([auth.accessToken(), auth.accessToken(), auth.refresh()]);
  assert.strictEqual(fetch.calls.length, 1);
});

test('invalid_grant on refresh signs out', async () => {
  const secrets = fakeSecrets({ [KEY]: stored() });
  const { auth } = make({ secrets, fetch: fakeFetch([json(400, { error: 'invalid_grant' })]) });
  await assert.rejects(auth.accessToken(), SignInNeeded);
  assert.strictEqual(secrets.m.has(KEY), false);
});

test('network error on refresh is Offline and keeps tokens', async () => {
  const secrets = fakeSecrets({ [KEY]: stored() });
  const { auth } = make({ secrets, fetch: fakeFetch([() => { throw new TypeError('fetch failed'); }]) });
  await assert.rejects(auth.accessToken(), Offline);
  assert.ok(secrets.m.has(KEY));
});

test('no stored tokens means sign-in needed', async () => {
  const { auth } = make({ fetch: fakeFetch([]) });
  await assert.rejects(auth.accessToken(), SignInNeeded);
  assert.strictEqual(auth.account(), null);
});

test('a refresh in another window is picked up', async () => {
  const secrets = fakeSecrets({ [KEY]: stored({ expires_at: NOW / 1000 + 3600 }) });
  const { auth } = make({ secrets, fetch: fakeFetch([]) });
  assert.strictEqual(await auth.accessToken(), TOKEN);
  const other = jwt({ oid: 'u1', tid: 'tenant1', appid: 'cid', n: 2 });
  secrets.m.set(KEY, stored({ access_token: other, expires_at: NOW / 1000 + 7200 }));
  secrets.fire(KEY);
  assert.strictEqual(await auth.accessToken(), other);
});

test('secret storage failing is reported', async () => {
  const secrets = fakeSecrets(); secrets.store = async () => { throw new Error('No keyring'); };
  const { auth } = make({ secrets, fetch: fakeFetch([tokens()]) });
  await assert.rejects(auth.signIn({}), (e) => e instanceof SignInFailed && e.kind === 'storage' && /secret storage isn't available/.test(e.message));
});

test('signOut deletes the tokens', async () => {
  const secrets = fakeSecrets({ [KEY]: stored({ expires_at: NOW / 1000 + 3600 }) });
  const { auth } = make({ secrets, fetch: fakeFetch([]) });
  await auth.accessToken();
  await auth.signOut();
  assert.strictEqual(secrets.m.has(KEY), false);
  await assert.rejects(auth.accessToken(), SignInNeeded);
});

// ---- from the final review
test('Cancel ends the wait at once, and a late token is not kept', async () => {
  const secrets = fakeSecrets();
  let fire; const cancel = { isCancellationRequested: false, onCancellationRequested: (fn) => { fire = fn; return { dispose() {} }; } };
  const { auth } = make({ secrets, fetch: fakeFetch([tokens()]), sleep: () => new Promise(() => {}) });
  const p = auth.signIn({ cancel });
  await new Promise((r) => setTimeout(r, 5));
  cancel.isCancellationRequested = true; fire();
  await assert.rejects(p, SignInCancelled);
  const late = make({ secrets, fetch: fakeFetch([async () => { cancel2.isCancellationRequested = true; return tokens(); }]) });
  const cancel2 = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  await assert.rejects(late.auth.signIn({ cancel: cancel2 }), SignInCancelled);
  assert.strictEqual(secrets.m.has(KEY), false, 'tokens that arrive after Cancel are dropped');
});

test('a server error or garbage while polling keeps polling', async () => {
  const { auth } = make({ fetch: fakeFetch([new Response('oops', { status: 502 }), json(500, { error: 'server_error' }), tokens()]) });
  await auth.signIn({});
  assert.strictEqual(await auth.accessToken(), TOKEN);
});

test('a refused refresh signs out, so windows stop retrying it', async () => {
  const secrets = fakeSecrets({ [KEY]: stored() });
  const { auth } = make({ secrets, fetch: fakeFetch([json(400, { error: 'invalid_request' })]) });
  await assert.rejects(auth.accessToken(), SignInNeeded);
  assert.strictEqual(secrets.m.has(KEY), false);
});

// ---- a company app: its tenant and client id, and tokens kept to the app that got them
const CO = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

test('a company app signs in and refreshes at its tenant, with its client id', async () => {
  const secrets = fakeSecrets();
  const fetch = fakeFetch([tokens(), tokens()]);
  const { auth } = make({ secrets, fetch, clientId: CO, tenant: 'contoso.onmicrosoft.com' });
  await auth.signIn({});
  assert.strictEqual(JSON.parse(secrets.m.get(KEY)).client_id, CO, 'the tokens say which app got them');
  await auth.refresh();
  assert.deepStrictEqual(fetch.calls.map((c) => c.url.replace('https://login.microsoftonline.com/', '')), ['contoso.onmicrosoft.com/oauth2/v2.0/devicecode', 'contoso.onmicrosoft.com/oauth2/v2.0/token', 'contoso.onmicrosoft.com/oauth2/v2.0/token']);
  assert.ok(fetch.calls.every((c) => c.body.get('client_id') === CO));
  assert.strictEqual(fetch.calls[2].body.get('grant_type'), 'refresh_token');
});

test("another app's stored tokens are not used, nor deleted", async () => {
  for (const [label, record] of [['recorded', stored({ client_id: 'cid', expires_at: NOW / 1000 + 3600 })], ['from the token (before 0.3)', stored({ expires_at: NOW / 1000 + 3600 })]]) {
    const secrets = fakeSecrets({ [KEY]: record });
    const fetch = fakeFetch([]);
    const { auth } = make({ secrets, fetch, clientId: CO });
    await assert.rejects(auth.accessToken(), SignInNeeded, label);
    await assert.rejects(auth.refresh(), SignInNeeded, label);
    assert.deepStrictEqual(fetch.calls, [], 'never refreshed with the wrong app');
    assert.strictEqual(secrets.m.get(KEY), record, 'left for the app that got them');
    const own = make({ secrets, fetch, clientId: 'cid' }).auth;
    assert.strictEqual(await own.accessToken(), TOKEN, 'still good for its own app');
  }
});
