'use strict';
// Terminal `claude`: what ~/.claude/settings.json should hold for each way Claude can run, the plan against what the
// file holds and what Roost wrote there before, and the write. A value the user put there is replaced only when they
// agree (the plan's conflicts, named in `replace`); a file that is not a plain JSON object (comments, an array) is never
// rewritten. Keys are `apiKeyHelper` or `env.<NAME>`; a desired null removes the key. Claude Code's own CLI, at
// ~/.local/bin/claude, reads the file: there is no launcher, so the gateway's address is written there and kept to
// the one of the company's addresses that answers (syncTerminalBaseUrl). No VS Code dependency.

const fs = require('fs');
const path = require('path');

const BASE_URL_KEY = 'env.ANTHROPIC_BASE_URL';
/** Where the Agents part keeps the record of what Roost wrote (globalState). */
const WRITTEN_KEY = 'perch.terminal.written';

const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
const keyHelper = (keyFile) => 'cat ' + shq(keyFile);
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * What a way of running Claude wants in settings.json.
 * @param {'gateway'|'apiKey'|'bedrock'|'subscription'} way
 * @returns {Record<string, string|null>}
 */
function desiredSettings(way, o = {}) {
  const out = {};
  switch (way) {
    case 'gateway':
      for (const [k, v] of Object.entries(o.env || {})) out['env.' + k] = String(v);
      out.apiKeyHelper = keyHelper(o.keyFile);
      out[BASE_URL_KEY] = o.baseUrl;
      out['env.CLAUDE_CODE_USE_BEDROCK'] = '0';
      return out;
    case 'apiKey':
      return { apiKeyHelper: keyHelper(o.keyFile), 'env.CLAUDE_CODE_USE_BEDROCK': '0' };
    case 'bedrock':
      out['env.CLAUDE_CODE_USE_BEDROCK'] = '1';
      out['env.AWS_REGION'] = o.region;
      if (o.profile) out['env.AWS_PROFILE'] = o.profile;
      return out;
    case 'subscription':
      return out;
    default:
      throw new Error(`terminal claude: no such way: ${way}`);
  }
}

/** The file as a JSON object; a missing file is `{}`; anything else (comments, an array, unreadable) is not ok. */
function readSettings(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, json: {} };
    return { ok: false, missing: false, error: `${file} could not be read: ${e.message}` };
  }
  let json;
  // the parser's message is left out: it quotes the file around the fault, and the file may hold a key
  try { json = JSON.parse(text); } catch (_) { return { ok: false, missing: false, error: `${file} is not plain JSON` }; }
  if (!isObject(json)) return { ok: false, missing: false, error: `${file} does not hold a JSON object` };
  return { ok: true, json };
}

/** A key's value in the settings: undefined when absent. */
function getKey(json, key) {
  if (key.startsWith('env.')) { const env = json && json.env; return isObject(env) ? env[key.slice(4)] : undefined; }
  return json ? json[key] : undefined;
}
function setKey(json, key, value) {
  if (key.startsWith('env.')) {
    if (json.env !== undefined && !isObject(json.env)) throw new Error('settings.json: its env is not an object');
    const env = Object.assign({}, json.env);
    if (value === null) delete env[key.slice(4)]; else env[key.slice(4)] = value;
    if (Object.keys(env).length) json.env = env; else delete json.env;
  } else if (value === null) delete json[key];
  else json[key] = value;
}

/**
 * The plan: changes (made without asking), conflicts (the user's own values, replaced only when they agree), and
 * `kept`: what Roost wrote before, still there and still wanted, to stay in its record.
 * @returns {{ changes: {key:string, from:string|undefined, to:string|null}[], conflicts: {key:string, from:string|undefined, to:string|null}[], kept: Record<string,string> }}
 */
function planSettings(current, desired, written) {
  const w = written || {}, changes = [], conflicts = [], kept = {};
  for (const [key, to] of Object.entries(desired || {})) {
    const from = getKey(current, key);
    if (from === to || (to === null && from === undefined)) { if (to !== null && key in w && w[key] === from) kept[key] = from; continue; }
    if (from === undefined || (key in w && w[key] === from)) changes.push({ key, from, to });
    else conflicts.push({ key, from, to });
  }
  for (const [key, was] of Object.entries(w)) {
    if (desired && key in desired) continue;
    const from = getKey(current, key);
    if (from !== undefined && from === was) changes.push({ key, from, to: null });   // Roost's own, no longer wanted
  }
  return { changes, conflicts, kept };
}

/** Write JSON beside the file, then rename it over: a reader never sees half a file. */
function writeJson(file, json) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  let mode = 0o600;
  try { mode = fs.statSync(file).mode & 0o777; } catch (_) { /* a new file */ }
  const tmp = `${file}.roost-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n', { mode });
    fs.renameSync(tmp, file);
  } catch (e) { try { fs.unlinkSync(tmp); } catch (_) { /* never made */ } throw e; }
}

/**
 * Apply a plan: its changes, and the conflicts named in `replace`, to the file as it is now (re-read). Throws when the
 * file isn't a plain JSON object, which is then left as it is.
 * @returns {{ written: Record<string,string> }} the new record of what Roost wrote
 */
function writeSettings(file, plan, { replace = [] } = {}) {
  const r = readSettings(file);
  if (!r.ok) throw new Error(`settings not written: ${r.error}`);
  const json = r.json, record = Object.assign({}, plan.kept);
  const apply = [...plan.changes, ...plan.conflicts.filter((c) => replace.includes(c.key))];
  for (const c of apply) {
    setKey(json, c.key, c.to);
    if (c.to === null) delete record[c.key]; else record[c.key] = c.to;
  }
  if (apply.length) writeJson(file, json);
  return { written: record };
}

/** A value as the panel may show it: the first 4 characters of one whose key names a token, key or secret. */
function maskValue(key, value) {
  const s = value === undefined || value === null ? '' : String(value);
  return key !== 'apiKeyHelper' && /TOKEN|KEY|SECRET/i.test(key) ? s.slice(0, 4) + '…' : s;
}

/**
 * Keep the gateway's address in settings.json to `baseUrl`, the one that answered: only when the file holds what Roost
 * wrote there (the user hasn't changed it since) and that differs. Never adds the key; leaves an unparsable file alone.
 * A value the user changed (or removed) is theirs from then on, and leaves the record.
 * @returns {{ changed: boolean, written: Record<string,string> }}
 */
function syncTerminalBaseUrl(file, baseUrl, written) {
  const w = Object.assign({}, written);
  const was = w[BASE_URL_KEY];
  if (typeof was !== 'string' || !was || !baseUrl) return { changed: false, written: w };
  const r = readSettings(file);
  if (!r.ok) return { changed: false, written: w };
  const now = getKey(r.json, BASE_URL_KEY);
  if (now !== was) { delete w[BASE_URL_KEY]; return { changed: false, written: w }; }
  if (now === baseUrl) return { changed: false, written: w };
  setKey(r.json, BASE_URL_KEY, baseUrl);
  writeJson(file, r.json);
  w[BASE_URL_KEY] = baseUrl;
  return { changed: true, written: w };
}

module.exports = { BASE_URL_KEY, WRITTEN_KEY, desiredSettings, readSettings, planSettings, writeSettings, maskValue, syncTerminalBaseUrl };
