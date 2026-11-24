'use strict';
// Signing in (design 201). Every way to sign in returns the same Auth object, which the rest of chirp uses for tokens:
//   { method, accessToken(), refresh(), tenantId(), account(), signIn(opts), hasChannels(), signOut() }
const { createTokenStore, SignInNeeded, Offline } = require('./tokenStore');

/** chirp's app registration in Microsoft Entra: multitenant, a public client. Not a secret. */
const CHIRP_CLIENT_ID = '5d0faf94-77bc-41c5-8c4f-73bacc2040ff';
const DEFAULT_TENANT = 'organizations';
const LOGIN = 'https://login.microsoftonline.com';
const authorityFor = (tenant) => `${LOGIN}/${tenant || DEFAULT_TENANT}/oauth2/v2.0`;
const AUTHORITY = authorityFor(DEFAULT_TENANT);
/** Microsoft's admin-consent page for an app: what IT opens to approve it for the whole company. */
const adminConsentLink = (clientId, tenant) => `${LOGIN}/${tenant || DEFAULT_TENANT}/adminconsent?client_id=${clientId}`;
const CHAT_SCOPES = ['User.Read', 'Chat.ReadWrite', 'ChatMessage.Send', 'Chat.Create', 'User.ReadBasic.All', 'offline_access'];
const CHANNEL_SCOPES = ['Team.ReadBasic.All', 'Channel.ReadBasic.All', 'ChannelMessage.Read.All', 'ChannelMessage.Send'];

class SignInCancelled extends Error { constructor() { super('Sign-in was cancelled'); this.name = 'SignInCancelled'; } }
/** kind: 'expired' | 'declined' | 'consent' | 'personal' | 'misconfigured' | 'unusable' | 'storage' | 'other' */
class SignInFailed extends Error { constructor(kind, message) { super(message || kind); this.name = 'SignInFailed'; this.kind = kind; } }

// ---- the app chirp signs in with: its own, or a company's (teams.signIn.clientId / teams.signIn.tenant)
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
/** Why a client id can't be used, or null when it can ('' is chirp's own app unless required). */
function clientIdProblem(value, { required = false } = {}) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return required ? 'Enter the Application (client) ID.' : null;
  return GUID.test(v) ? null : 'An Application (client) ID looks like 01234567-89ab-cdef-0123-456789abcdef.';
}
/** Why a tenant can't be used, or null: a Directory (tenant) ID, a domain such as contoso.onmicrosoft.com, or ''. */
function tenantProblem(value, { required = false } = {}) {
  const v = String(value == null ? '' : value).trim();
  if (!v) return required ? 'Enter the Directory (tenant) ID or domain.' : null;
  if (v.toLowerCase() === DEFAULT_TENANT || GUID.test(v) || DOMAIN.test(v)) return null;
  return 'A Directory (tenant) ID looks like 01234567-89ab-cdef-0123-456789abcdef; a domain, like contoso.onmicrosoft.com.';
}
/**
 * The app and tenant to sign in with, from the two settings. An invalid value is ignored (with a note), so a typo
 * never stops chirp signing in with its own app.
 * @returns { clientId, tenant, company: a company app is in use, notes: [string] }
 */
function signInApp({ clientId = '', tenant = '' } = {}, defaultClientId = CHIRP_CLIENT_ID) {
  const notes = [];
  const id = String(clientId || '').trim(), t = String(tenant || '').trim();
  let useId = defaultClientId, useTenant = DEFAULT_TENANT;
  if (id && clientIdProblem(id)) notes.push("teams.signIn.clientId isn't an Application (client) ID, so chirp's own app is used.");
  else if (id) useId = id.toLowerCase();
  if (t && tenantProblem(t)) notes.push("teams.signIn.tenant isn't a Directory (tenant) ID or domain, so it is ignored.");
  else if (t) useTenant = t.toLowerCase();
  return { clientId: useId, tenant: useTenant, company: useId !== defaultClientId, notes };
}

// A company's own app asks for what its admins already approved, all of it, and nothing more: Microsoft's `.default`
// scope never asks for consent. Listing chirp's own scopes stopped a company app at "Need admin approval" over one it
// lacked (User.ReadBasic.All, where it had User.Read.All), in a tenant that lets no user consent.
const GRANTED_SCOPE = 'https://graph.microsoft.com/.default';
const graphScope = (name) => (name === 'offline_access' ? name : 'https://graph.microsoft.com/' + name);

/** What a token says about itself. The signature is not checked: chirp only reads its own tokens. */
function claims(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    if (!p || typeof p !== 'object') return null;
    return { appid: p.appid || p.azp || null, tid: p.tid || null, oid: p.oid || null, upn: p.upn || p.preferred_username || null, name: p.name || null };
  } catch (_) { return null; }
}

const accountOf = (token, tenant) => { const c = claims(token); return c && c.oid ? { id: c.oid, username: c.upn, name: c.name, tenantId: c.tid || tenant || null } : null; };

/** The token file another tool keeps (design 101, "Signing in"), as an Auth. */
function createTokenFileAuth({ file, fetch }) {
  const store = createTokenStore({ file, fetch });
  let last = null;
  const keep = (t) => { last = t; return t; };
  return {
    method: 'tokenFile',
    accessToken: async () => keep(await store.accessToken()),
    refresh: async () => keep(await store.refresh()),
    tenantId: () => store.tenantId(),
    account: () => (last ? accountOf(last, store.tenantId()) : null),
    async signIn() { keep(await store.accessToken()); },
    hasChannels: () => true,   // whatever the other tool's token carries; a 403 turns channels off
    async signOut() { last = null; },   // never touches the file
  };
}

const FALLBACK_NOTE = "Your editor's Microsoft sign-in can't be used; using a sign-in code";
const CODE_FALLBACK_NOTE = "The app doesn't allow sign-in codes; using the editor's Microsoft sign-in";

/**
 * Picks the way to sign in (design 201, "Choosing a way"), building each method only when it's needed.
 * @param o.method   'auto' | 'editor' | 'deviceCode' | 'tokenFile'
 * @param o.tokenFile  the configured path, or ''
 * @param o.preferCode  auto tries the sign-in code first (a company's own app: it needs no redirect for the editor)
 * @param o.make*    build a method's Auth (makeEditor may return null: the editor has no Microsoft provider)
 * @param o.onNote   tells the user when auto moves on to a sign-in code
 * @returns an Auth that forwards to the method in use, plus current()
 */
function createAuth({ method = 'auto', tokenFile = '', preferCode = false, makeEditor, makeDeviceCode, makeTokenFile, onNote = () => {} }) {
  const makers = { editor: makeEditor, deviceCode: makeDeviceCode, tokenFile: makeTokenFile };
  const built = {};
  const get = (name) => { if (!(name in built)) built[name] = makers[name] ? makers[name]() : null; return built[name]; };
  const order = () => {
    if (tokenFile && (method === 'auto' || method === 'tokenFile')) return ['tokenFile'];
    if (method === 'auto') return preferCode ? ['deviceCode', 'editor'] : ['editor', 'deviceCode'];
    return [method];
  };
  let active = null;

  async function signIn(opts = {}) {
    if (active) return active.signIn(opts);   // the channel step, or signing in again: the same method
    const names = order();
    for (let i = 0; i < names.length; i++) {
      const m = get(names[i]);
      if (!m) continue;
      try { await m.signIn(opts); active = m; return; }
      catch (e) {
        const more = i < names.length - 1 && method === 'auto';
        if (more && e instanceof SignInFailed && e.kind === 'unusable') { onNote(FALLBACK_NOTE); continue; }
        // a company app without "allow public client flows" may still take the editor's sign-in
        if (more && e instanceof SignInFailed && e.kind === 'misconfigured' && names[i] === 'deviceCode') { onNote(CODE_FALLBACK_NOTE); continue; }
        throw e;   // cancelling never moves on to another method
      }
    }
    throw new SignInNeeded();
  }

  /** Before any sign-in in this window: a method that already holds a session (a restart) is used. */
  async function restore() {
    for (const name of order()) {
      const m = get(name);
      if (!m) continue;
      try { const t = await m.accessToken(); active = m; return t; }
      catch (e) { if (!(e instanceof SignInNeeded)) { active = m; throw e; } }
    }
    throw new SignInNeeded();
  }

  return {
    get method() { return active ? active.method : null; },
    current: () => active,
    signIn,
    accessToken: () => (active ? active.accessToken() : restore()),
    refresh: () => (active ? active.refresh() : restore()),
    tenantId: () => (active ? active.tenantId() : null),
    account: () => (active ? active.account() : null),
    hasChannels: () => (active ? active.hasChannels() : false),
    async signOut() { if (active) await active.signOut(); active = null; },
  };
}

module.exports = { GRANTED_SCOPE, CHIRP_CLIENT_ID, DEFAULT_TENANT, createAuth, FALLBACK_NOTE, CODE_FALLBACK_NOTE, AUTHORITY, authorityFor, adminConsentLink, signInApp, clientIdProblem, tenantProblem, CHAT_SCOPES, CHANNEL_SCOPES, graphScope, claims, accountOf, createTokenFileAuth, SignInNeeded, Offline, SignInCancelled, SignInFailed };
