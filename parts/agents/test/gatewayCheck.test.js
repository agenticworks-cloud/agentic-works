'use strict';
// The key check (GET <base>/v1/models) and the address probe at a tab's start, against a fake fetch keyed by URL.
const assert = require('assert');
const { probeBaseUrls, checkKey } = require('../src/gatewayCheck');

const A = 'https://a.example.com', B = 'https://b.example.com';
const answer = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
const hang = () => new Promise(() => {});
const down = () => { throw new TypeError('fetch failed'); };
/** A fetch whose answer for each URL is given by `by[base]`: a function of the request, run for each call. */
function fakeFetch(by) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, headers: Object.assign({}, init && init.headers) });
    const base = Object.keys(by).find((b) => url.startsWith(b));
    return by[base](init);
  };
  f.calls = calls;
  return f;
}

(async () => {
  // ---- probe
  {
    const f = fakeFetch({ [A]: down, [B]: () => answer(404, 'no') });
    assert.strictEqual(await probeBaseUrls([A, B], { key: 'k', fetch: f }), B, 'the first that answers at all, a 404 included');
    assert.deepStrictEqual(f.calls.map((c) => c.url), [A + '/v1/models', B + '/v1/models']);
    assert.strictEqual(await probeBaseUrls([A, B], { key: 'k', fetch: fakeFetch({ [A]: down, [B]: down }) }), null, 'none answers: null');
    assert.strictEqual(await probeBaseUrls([], { key: 'k', fetch: fakeFetch({}) }), null);
  }
  // probe gives up per address: both hang, and the fetch ignores its signal
  {
    const t0 = Date.now();
    const got = await probeBaseUrls([A, B], { key: 'k', fetch: fakeFetch({ [A]: hang, [B]: hang }), timeoutMs: 50 });
    assert.strictEqual(got, null);
    assert(Date.now() - t0 < 300, 'probe gives up per address: ' + (Date.now() - t0) + ' ms');
  }

  // ---- checkKey
  const models = (...ids) => ({ data: ids.map((id) => ({ id })) });
  {
    const f = fakeFetch({ [A]: () => answer(200, models('anthropic/router-auto')) });
    const r = await checkKey({ baseUrls: [A, B], key: ' sk-1\n', requiredModel: 'router-auto', name: 'Example Gateway', fetch: f });
    assert.strictEqual(f.calls[0].headers.Authorization, 'Bearer sk-1', 'the key is trimmed');
    assert.strictEqual(f.calls[0].headers['x-api-key'], 'sk-1');
    assert.deepStrictEqual([r.verdict, r.baseUrl, r.models, r.status, r.text], ['works', A, ['anthropic/router-auto'], 200, 'Works.']);
    assert.strictEqual(f.calls.length, 1, 'the first that answers decides');
  }
  {
    const r = await checkKey({ baseUrls: [A], key: 'k', requiredModel: 'anthropic/router-auto', name: 'Example Gateway', fetch: fakeFetch({ [A]: () => answer(200, models('router-auto')) }) });
    assert.strictEqual(r.verdict, 'works', 'anthropic/ is taken off both sides');
  }
  {
    const r = await checkKey({ baseUrls: [A], key: 'k', requiredModel: 'router-auto', name: 'Example Gateway', fetch: fakeFetch({ [A]: () => answer(200, models('opus')) }) });
    assert.deepStrictEqual([r.verdict, r.text], ['missingModel', 'The key works, but its scope lacks router-auto.']);
  }
  {
    const r = await checkKey({ baseUrls: [A], key: 'k', fetch: fakeFetch({ [A]: () => answer(200, models('opus')) }) });
    assert.strictEqual(r.verdict, 'works', 'no model required: any list works');
  }
  {
    const f = fakeFetch({ [A]: () => answer(401, { error: 'nope' }), [B]: () => answer(200, models('x')) });
    const r = await checkKey({ baseUrls: [A, B], key: 'k', name: 'Example Gateway', fetch: f });
    assert.deepStrictEqual([r.verdict, r.baseUrl, r.status, r.text], ['rejected', A, 401, 'Example Gateway rejected the key.']);
    assert.deepStrictEqual(f.calls.map((c) => c.url), [A + '/v1/models'], 'a 401 from the first is final: the second is never asked');
    const r3 = await checkKey({ baseUrls: [A], key: 'k', fetch: fakeFetch({ [A]: () => answer(403, '') }) });
    assert.deepStrictEqual([r3.verdict, r3.text], ['rejected', 'The gateway rejected the key.'], 'the default name, capitalised');
  }
  {
    const f = fakeFetch({ [A]: down, [B]: () => answer(200, models('x')) });
    const r = await checkKey({ baseUrls: [A, B], key: 'k', name: 'Example Gateway', fetch: f });
    assert.deepStrictEqual([r.verdict, r.baseUrl], ['works', B], 'one that does not answer is passed over');
  }
  {
    const two = await checkKey({ baseUrls: [A, B], key: 'k', name: 'Example Gateway', fetch: fakeFetch({ [A]: down, [B]: down }) });
    assert.deepStrictEqual([two.verdict, two.baseUrl, two.text], ['unreachable', '', "Can't reach Example Gateway: on the VPN?"]);
    const one = await checkKey({ baseUrls: [A], key: 'k', name: 'Example Gateway', fetch: fakeFetch({ [A]: down }) });
    assert.deepStrictEqual([one.verdict, one.text], ['unreachable', "Can't reach Example Gateway."]);
    const slow = await checkKey({ baseUrls: [A], key: 'k', name: 'Example Gateway', fetch: fakeFetch({ [A]: hang }), timeoutMs: 50 });
    assert.strictEqual(slow.verdict, 'unreachable', 'a request that times out is no answer');
  }
  {
    const r = await checkKey({ baseUrls: [A], key: 'k', name: 'Example Gateway', fetch: fakeFetch({ [A]: () => answer(404, 'not here') }) });
    assert.deepStrictEqual([r.verdict, r.status, r.text], ['unexpected', 404, 'Example Gateway gave an unexpected answer (HTTP 404).']);
    const x = await checkKey({ baseUrls: [A], key: 'k', name: 'Example Gateway', fetch: fakeFetch({ [A]: () => answer(200, 'x') }) });
    assert.deepStrictEqual([x.verdict, x.status, x.text], ['unexpected', 200, 'Example Gateway gave an unexpected answer (HTTP 200).']);
    const nodata = await checkKey({ baseUrls: [A], key: 'k', fetch: fakeFetch({ [A]: () => answer(200, { models: [] }) }) });
    assert.strictEqual(nodata.verdict, 'unexpected', 'a body without a data array');
  }
  {
    const f = fakeFetch({ [A]: () => answer(200, models('x')) });
    await checkKey({ baseUrls: [A + '/'], key: 'sk-a', style: 'anthropic', fetch: f });
    assert.deepStrictEqual(f.calls[0], { url: A + '/v1/models', headers: { 'x-api-key': 'sk-a', 'anthropic-version': '2023-06-01' } }, 'anthropic style: no Authorization; a trailing slash dropped');
  }
  console.log('gatewayCheck tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
