'use strict';
// Checking a key with a gateway, and finding which of a company's addresses answers. Both ask GET <base>/v1/models,
// which any Anthropic-compatible gateway serves and which costs nothing. A request that throws or does not answer
// within its time counts as no answer; one AbortController per request, and a timer of its own besides, so a fetch
// that ignores its signal cannot hold the caller. The key goes in a header only, never in a URL. No VS Code dependency.

const PROBE_MS = 3000;
const CHECK_MS = 10000;

const headersFor = (key, style) => (style === 'anthropic'
  ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
  : { Authorization: 'Bearer ' + key, 'x-api-key': key });

const modelsUrl = (base) => String(base || '').replace(/\/+$/, '') + '/v1/models';

/**
 * One GET of <base>/v1/models: { status, body } once an HTTP answer has come, its body read within the same time, or
 * null when none came (the request threw, or timed out).
 */
async function ask(base, { key, style, fetch, timeoutMs }) {
  const doFetch = fetch || globalThis.fetch;
  if (typeof doFetch !== 'function') return null;
  const ctl = new AbortController();
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => { ctl.abort(); resolve(null); }, timeoutMs); });
  const answer = (async () => {
    const res = await doFetch(modelsUrl(base), { headers: headersFor(key, style), signal: ctl.signal });
    if (!res) return null;
    const status = typeof res.status === 'number' ? res.status : (res.ok ? 200 : 0);
    let body = '';
    try { body = typeof res.text === 'function' ? await res.text() : typeof res.json === 'function' ? JSON.stringify(await res.json()) : ''; } catch (_) { body = ''; }
    return { status, body };
  })().catch(() => null);
  try { return await Promise.race([answer, late]); } finally { clearTimeout(timer); }
}

/**
 * The first of `baseUrls` that gives any HTTP answer, in order; null when none does. At most `timeoutMs` per address.
 * @param {string[]} baseUrls
 * @param {{ key: string, fetch?: Function, timeoutMs?: number }} opts
 * @returns {Promise<string|null>}
 */
async function probeBaseUrls(baseUrls, { key, fetch, timeoutMs = PROBE_MS } = {}) {
  for (const base of Array.isArray(baseUrls) ? baseUrls : []) {
    if (await ask(base, { key: String(key || '').trim(), style: 'gateway', fetch, timeoutMs })) return base;
  }
  return null;
}

const bare = (id) => String(id || '').replace(/^anthropic\//, '');
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Whether a key works with a gateway. The addresses are asked in order; the first that answers decides (a 401 from the
 * first is final). A 2xx with a `data` array of model ids works, unless `requiredModel` is not among them (compared
 * with a leading `anthropic/` taken off both); 401 or 403 is the key rejected; any other answer, or body, unexpected.
 * @param {{ baseUrls: string[], key: string, requiredModel?: string, name?: string, style?: 'gateway'|'anthropic', fetch?: Function, timeoutMs?: number }} o
 * @returns {Promise<{ verdict: 'works'|'missingModel'|'rejected'|'unreachable'|'unexpected', baseUrl: string, models: string[], status: number, text: string }>}
 */
async function checkKey({ baseUrls, key, requiredModel = '', name = 'the gateway', style = 'gateway', fetch, timeoutMs = CHECK_MS } = {}) {
  const urls = Array.isArray(baseUrls) ? baseUrls : [];
  const k = String(key || '').trim();
  const Name = capital(name);
  for (const base of urls) {
    const got = await ask(base, { key: k, style, fetch, timeoutMs });
    if (!got) continue;
    const out = { baseUrl: base, models: [], status: got.status };
    if (got.status === 401 || got.status === 403) return Object.assign(out, { verdict: 'rejected', text: `${Name} rejected the key.` });
    if (got.status >= 200 && got.status < 300) {
      let body = null;
      try { body = JSON.parse(got.body); } catch (_) { body = null; }
      if (body && Array.isArray(body.data)) {
        out.models = body.data.map((m) => m && m.id).filter((x) => typeof x === 'string');
        if (requiredModel && !out.models.some((id) => bare(id) === bare(requiredModel))) {
          return Object.assign(out, { verdict: 'missingModel', text: `The key works, but its scope lacks ${requiredModel}.` });
        }
        return Object.assign(out, { verdict: 'works', text: 'Works.' });
      }
    }
    return Object.assign(out, { verdict: 'unexpected', text: `${Name} gave an unexpected answer (HTTP ${got.status}).` });
  }
  return { verdict: 'unreachable', baseUrl: '', models: [], status: 0, text: urls.length > 1 ? `Can't reach ${name}: on the VPN?` : `Can't reach ${name}.` };
}

module.exports = { probeBaseUrls, checkKey, PROBE_MS, CHECK_MS };
