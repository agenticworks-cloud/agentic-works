'use strict';
// Connect Claude's ways of running Claude, without VS Code: where the Anthropic API key and terminal claude's gateway
// key are kept, the AWS profiles on the machine, the Bedrock check (the AWS CLI's model list), whether Claude counts as
// connected, and the backend a new Claude tab takes from the recorded connection. (Sean, 2026-11-24; note 101.)

const fs = require('fs');
const os = require('os');
const path = require('path');

const ANTHROPIC_KEY_FILE = '~/.config/roost/anthropic-key';
const GATEWAY_KEY_FILE = '~/.config/roost/gateway-key';
/** globalState: the way chosen in Connect Claude, until a tab's footer picks a backend. */
const CONNECTION_KEY = 'perch.claude.connection';
/** globalState: Bedrock's { profile, region }, as saved in Connect Claude. */
const BEDROCK_KEY = 'perch.claude.bedrock';
const WAYS = ['gateway', 'subscription', 'apiKey', 'bedrock', 'codex'];
/** The ways Connect Claude offers with a company gateway: that gateway only; a tab's footer has the rest, Codex's
 * backends too. (Sean, 2026-11-24, 0.4.3; note 101.) */
const COMPANY_WAYS = ['gateway'];
/** Bedrock's check without the AWS CLI: said as what to do. */
const BEDROCK_NEEDS_CLI = 'Bedrock needs the AWS CLI: install it (on macOS: brew install awscli), then try again.';

const underHome = (p, home) => path.join(home, p.replace(/^~\//, ''));
const anthropicKeyFile = (home = os.homedir()) => underHome(ANTHROPIC_KEY_FILE, home);
const gatewayKeyFile = (home = os.homedir()) => underHome(GATEWAY_KEY_FILE, home);

/** A secret kept in a file of its own, trimmed; '' when there is no such file, or nothing in it. */
function readSecretFile(file) {
  try { return fs.readFileSync(file, 'utf8').trim(); } catch (_) { return ''; }
}

/** The sections of an INI file, each with its keys: `{ [section]: { key: value } }`. Comments and junk are passed over. */
function iniSections(text) {
  const out = {};
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sec = /^\[\s*([^\]]+?)\s*\]$/.exec(line);
    if (sec) { cur = out[sec[1]] = out[sec[1]] || {}; continue; }
    const kv = /^([^=]+?)\s*=\s*(.*)$/.exec(line);
    if (kv && cur) cur[kv[1]] = kv[2];
  }
  return out;
}
const readText = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch (_) { return ''; } };

/**
 * The AWS profiles on the machine: ~/.aws/config's `[default]` and `[profile x]`, ~/.aws/credentials' `[x]`, by name,
 * each once, with the region the config gives it ('' for none).
 * @returns {{ name: string, region: string }[]}
 */
function awsProfiles({ home = os.homedir() } = {}) {
  const byName = new Map();
  const add = (name, region) => {
    const was = byName.get(name);
    if (!was) byName.set(name, { name, region: region || '' });
    else if (!was.region && region) was.region = region;
  };
  for (const [sec, keys] of Object.entries(iniSections(readText(path.join(home, '.aws', 'config'))))) {
    const m = sec === 'default' ? ['', 'default'] : /^profile\s+(\S+)$/.exec(sec);
    if (m) add(m[1], keys.region);
  }
  for (const sec of Object.keys(iniSections(readText(path.join(home, '.aws', 'credentials'))))) add(sec, '');
  return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/**
 * Run a program without a shell: `{ code, stdout, stderr }` whatever its exit code; rejects (code ENOENT) when there
 * is no such program. Nothing secret is ever passed in argv here.
 */
function runArgv(argv, { timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    require('child_process').execFile(argv[0], argv.slice(1), { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') { reject(err); return; }
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || (err && !stdout ? err.message : '') || '') });
    });
  });
}

/**
 * Whether Bedrock lists Anthropic's models for this profile (or the default credentials) in this region, by the AWS
 * CLI: `aws bedrock list-foundation-models --by-provider anthropic`.
 * @param {{ profile?: string, region: string, run?: (argv: string[]) => Promise<{code:number, stdout:string, stderr:string}> }} o
 * @returns {Promise<{ verdict: 'works'|'noModels'|'signIn'|'denied'|'unchecked'|'failed', text: string, models: string[] }>}
 */
async function checkBedrock({ profile = '', region, run = runArgv } = {}) {
  const argv = ['aws', 'bedrock', 'list-foundation-models', '--by-provider', 'anthropic', '--region', region, '--output', 'json', ...(profile ? ['--profile', profile] : [])];
  let got;
  try { got = await run(argv); } catch (e) {
    // no AWS CLI: what to do, not an error; asked only once Bedrock was picked (Sean, 2026-11-24)
    if (e && e.code === 'ENOENT') return { verdict: 'unchecked', text: BEDROCK_NEEDS_CLI, models: [] };
    return { verdict: 'failed', text: String((e && e.message) || e), models: [] };
  }
  const stderr = String((got && got.stderr) || '');
  if (got && got.code === 0) {
    let body = null;
    try { body = JSON.parse(got.stdout); } catch (_) { body = null; }
    const models = body && Array.isArray(body.modelSummaries) ? body.modelSummaries.map((x) => x && x.modelId).filter((x) => typeof x === 'string') : [];
    if (models.length) return { verdict: 'works', text: `Works: ${models.length} Anthropic models in ${region}.`, models };
    return { verdict: 'noModels', text: `No Anthropic models are offered in ${region}.`, models: [] };
  }
  if (/Unable to locate credentials|SSO|expired|ExpiredToken/i.test(stderr)) return { verdict: 'signIn', text: `AWS needs a sign-in first: run aws sso login${profile ? ' --profile ' + profile : ''} in a terminal.`, models: [] };
  if (/AccessDenied/.test(stderr)) return { verdict: 'denied', text: `The AWS account may not list Bedrock models in ${region}.`, models: [] };
  const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return { verdict: 'failed', text: lines.length ? lines[lines.length - 1] : `The AWS CLI failed (exit ${got ? got.code : '?'}).`, models: [] };
}

/**
 * Whether Claude counts as connected (perch.claudeConnected): a recorded connection once it is ready; with none
 * recorded, a ready gateway or a Claude that can already run.
 */
function isConnected({ connection, gatewayReady, canRun, apiKeySaved, bedrockSaved } = {}) {
  switch (connection) {
    case 'gateway': return !!gatewayReady;
    case 'subscription': return !!canRun;
    case 'apiKey': return !!apiKeySaved;
    case 'bedrock': return !!bedrockSaved;
    case 'codex': return true;
    default: return !!(gatewayReady || canRun);
  }
}

/**
 * The backend a new Claude tab takes from the recorded connection, or null (Codex only, or none recorded) for the
 * rule from before: the remembered gateway, else agents.claude.defaultBackend.
 * @returns {{ gateway: boolean, own: ''|'subscription'|'api'|'apiKey' } | null}
 */
function newTabBackend(connection) {
  switch (connection) {
    case 'gateway': return { gateway: true, own: '' };
    case 'subscription': return { gateway: false, own: 'subscription' };
    case 'apiKey': return { gateway: false, own: 'apiKey' };
    case 'bedrock': return { gateway: false, own: 'api' };
    default: return null;
  }
}

module.exports = { ANTHROPIC_KEY_FILE, GATEWAY_KEY_FILE, CONNECTION_KEY, BEDROCK_KEY, WAYS, COMPANY_WAYS, BEDROCK_NEEDS_CLI, anthropicKeyFile, gatewayKeyFile, readSecretFile, awsProfiles, runArgv, checkBedrock, isConnected, newTabBackend };
