'use strict';
// The company file: ~/.config/roost/company.json, written by a company's installer (ROOST_COMPANY_FILE overrides the
// path). It names an LLM gateway and the MCP servers the company offers. readCompany validates it whole: any error
// makes the file invalid, and the error starts with the path of the offending value (mcpServers[1].connect.kind: ...).
// This file is copied byte for byte to parts/agents/src/company.js (a part never requires Roost's src/); a Roost test
// checks the copies match.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function companyFile({ env = process.env, home = os.homedir() } = {}) {
  return env.ROOST_COMPANY_FILE || path.join(home, '.config', 'roost', 'company.json');
}

class Invalid extends Error {
  constructor(at, message) {
    super(at ? `${at}: ${message}` : message);
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isString = (v) => typeof v === 'string';
const isHttp = (v) => {
  if (!isString(v)) return false;
  try {
    const p = new URL(v).protocol;
    return p === 'http:' || p === 'https:';
  } catch (e) {
    return false;
  }
};
const ID = /^[A-Za-z0-9_-]+$/;
const KINDS = ['tokenPage', 'command', 'mcpTool', 'none'];
const TOKEN = '${token}';

const expand = (p, home) => (p === '~' ? home : p.startsWith('~/') ? path.join(home, p.slice(2)) : p);

function stringMap(v, at) {
  if (!isObject(v)) throw new Invalid(at, 'must be an object of strings');
  for (const [k, val] of Object.entries(v)) if (!isString(val)) throw new Invalid(`${at}.${k}`, 'must be a string');
  return { ...v };
}

function stringArray(v, at) {
  if (!Array.isArray(v)) throw new Invalid(at, 'must be an array of strings');
  v.forEach((s, i) => { if (!isString(s)) throw new Invalid(`${at}[${i}]`, 'must be a string'); });
  return v.slice();
}

function gateway(g, home) {
  if (!isObject(g)) throw new Invalid('gateway', 'must be an object');
  if (!isString(g.name) || !g.name) throw new Invalid('gateway.name', 'must be a non-empty string');
  if (!Array.isArray(g.baseUrls) || g.baseUrls.length === 0) throw new Invalid('gateway.baseUrls', 'must be a non-empty array of URLs');
  g.baseUrls.forEach((u, i) => { if (!isHttp(u)) throw new Invalid(`gateway.baseUrls[${i}]`, 'must be an http or https URL'); });
  if (!isHttp(g.keyPage)) throw new Invalid('gateway.keyPage', 'must be an http or https URL');
  if (g.requiredModel !== undefined && !isString(g.requiredModel)) throw new Invalid('gateway.requiredModel', 'must be a string');
  if (g.terminal !== undefined && typeof g.terminal !== 'boolean') throw new Invalid('gateway.terminal', 'must be true or false');
  // the start of the names the gateway lists for its routers (models that pick a model per request): a menu group of their own
  const routerPrefixes = g.routerPrefixes === undefined ? [] : stringArray(g.routerPrefixes, 'gateway.routerPrefixes');
  routerPrefixes.forEach((s, i) => { if (!s) throw new Invalid(`gateway.routerPrefixes[${i}]`, 'must be a non-empty string'); });
  // a program that prints a fresh key on stdout (Get a key runs it, argv and no shell): its first word absolute or ~/
  let keyCommand = null;
  if (g.keyCommand !== undefined && g.keyCommand !== null) {
    keyCommand = stringArray(g.keyCommand, 'gateway.keyCommand');
    if (keyCommand.length === 0 || !keyCommand[0]) throw new Invalid('gateway.keyCommand', 'must be a non-empty array of strings');
    keyCommand[0] = expand(keyCommand[0], home);
    if (!path.isAbsolute(keyCommand[0])) throw new Invalid('gateway.keyCommand[0]', 'must be an absolute path or start with ~/');
  }
  return {
    name: g.name,
    baseUrls: g.baseUrls.slice(),
    keyPage: g.keyPage,
    requiredModel: g.requiredModel || '',
    env: g.env === undefined ? {} : stringMap(g.env, 'gateway.env'),
    keyFiles: (g.keyFiles === undefined ? [] : stringArray(g.keyFiles, 'gateway.keyFiles')).map((f) => expand(f, home)),
    terminal: g.terminal === true,
    routerPrefixes,
    keyCommand,
  };
}

function check(c, at, home) {
  if (c === undefined || c === null) return null;
  if (!isObject(c)) throw new Invalid(at, 'must be an object');
  if (c.command !== undefined) {
    const argv = stringArray(c.command, `${at}.command`);
    if (argv.length === 0) throw new Invalid(`${at}.command`, 'must not be empty');
    argv[0] = expand(argv[0], home);
    return { kind: 'command', argv };
  }
  if (c.mcpTool !== undefined) {
    if (!isString(c.mcpTool) || !c.mcpTool) throw new Invalid(`${at}.mcpTool`, 'must be a non-empty string');
    if (c.args !== undefined && !isObject(c.args)) throw new Invalid(`${at}.args`, 'must be an object');
    return { kind: 'mcpTool', tool: c.mcpTool, args: c.args || {} };
  }
  if (c.method !== undefined || c.url !== undefined) {
    if (!isString(c.method) || !c.method) throw new Invalid(`${at}.method`, 'must be a non-empty string');
    if (!isHttp(c.url)) throw new Invalid(`${at}.url`, 'must be an http or https URL');
    if (c.body !== undefined && !isString(c.body)) throw new Invalid(`${at}.body`, 'must be a string');
    return { kind: 'request', method: c.method, url: c.url, body: c.body === undefined ? '' : c.body };
  }
  throw new Invalid(at, 'must have method and url, mcpTool, or command');
}

function register(r, at, home) {
  if (!isObject(r)) throw new Invalid(at, 'must be an object');
  if (r.type === 'http') {
    if (!isHttp(r.url)) throw new Invalid(`${at}.url`, 'must be an http or https URL');
    return { type: 'http', url: r.url, headers: r.headers === undefined ? {} : stringMap(r.headers, `${at}.headers`) };
  }
  if (r.type === 'stdio') {
    if (!isString(r.command) || !r.command) throw new Invalid(`${at}.command`, 'must be a non-empty string');
    return {
      type: 'stdio',
      command: expand(r.command, home),
      args: r.args === undefined ? [] : stringArray(r.args, `${at}.args`),
      env: r.env === undefined ? {} : stringMap(r.env, `${at}.env`),
    };
  }
  throw new Invalid(`${at}.type`, 'must be "http" or "stdio"');
}

function connect(c, at, reg, home) {
  if (c === undefined) c = { kind: 'none' };
  if (!isObject(c)) throw new Invalid(at, 'must be an object');
  if (!KINDS.includes(c.kind)) throw new Invalid(`${at}.kind`, `must be one of ${KINDS.join(', ')}`);
  const out = { kind: c.kind, args: {}, complete: null, doneWhen: null, check: null };
  if (c.kind === 'tokenPage') {
    if (!isHttp(c.page)) throw new Invalid(`${at}.page`, 'must be an http or https URL');
    out.page = c.page;
  }
  if (c.kind === 'command') {
    if (!Array.isArray(c.command) || c.command.length === 0) throw new Invalid(`${at}.command`, 'must be a non-empty array of strings');
    out.command = stringArray(c.command, `${at}.command`);
    out.command[0] = expand(out.command[0], home);
  }
  if (c.kind === 'mcpTool') {
    if (!isString(c.tool) || !c.tool) throw new Invalid(`${at}.tool`, 'must be a non-empty string');
    if (reg.type !== 'stdio') throw new Invalid(`${at.replace(/connect$/, 'register')}.type`, 'must be "stdio" for a connect kind of mcpTool');
    out.tool = c.tool;
  }
  if (c.args !== undefined) {
    if (!isObject(c.args)) throw new Invalid(`${at}.args`, 'must be an object');
    out.args = c.args;
  }
  if (c.complete !== undefined && c.complete !== null) {
    if (!isObject(c.complete)) throw new Invalid(`${at}.complete`, 'must be an object');
    out.complete = c.complete;
  }
  if (c.doneWhen !== undefined && c.doneWhen !== null) {
    if (!isObject(c.doneWhen) || !isString(c.doneWhen.file) || !c.doneWhen.file) throw new Invalid(`${at}.doneWhen`, 'must be an object with a file');
    out.doneWhen = { file: expand(c.doneWhen.file, home) };
  } else if (c.kind === 'command') {
    throw new Invalid(`${at}.doneWhen`, 'is required for a connect kind of command');
  }
  out.check = check(c.check, `${at}.check`, home);
  return out;
}

// install: where a server's program comes from when it isn't there yet: a GitHub release's asset for this platform,
// downloaded with gh (src/tools.js) and put at `to`. Everything that reaches gh's argv is checked here: no value can
// start with "-" (an option), and an asset name is a file name, not a path.
const PLATFORMS = ['darwin-arm64', 'darwin-x64', 'linux-x64', 'linux-arm64'];
const REPO = /^[\w.-]+\/[\w.-]+$/;

function install(v, at, home) {
  if (v === undefined || v === null) return null;
  if (!isObject(v)) throw new Invalid(at, 'must be an object');
  const g = v.github;
  if (!isObject(g)) throw new Invalid(`${at}.github`, 'must be an object');
  if (!isString(g.repo) || !REPO.test(g.repo)) throw new Invalid(`${at}.github.repo`, 'must be owner/name');
  const tag = g.tag === undefined ? 'latest' : g.tag;
  if (!isString(tag) || !tag || tag.startsWith('-')) throw new Invalid(`${at}.github.tag`, 'must be "latest" or a tag that does not start with -');
  if (!isObject(g.assets)) throw new Invalid(`${at}.github.assets`, 'must be an object of asset names by platform');
  const assets = {};
  for (const k of PLATFORMS) {
    const a = g.assets[k];
    if (a === undefined) continue;
    if (!isString(a) || !a || a.includes('/') || a.startsWith('-')) throw new Invalid(`${at}.github.assets.${k}`, 'must be a file name, with no / and not starting with -');
    assets[k] = a;
  }
  if (!isString(v.to) || !v.to) throw new Invalid(`${at}.to`, 'must be a non-empty string');
  const to = expand(v.to, home);
  if (!path.isAbsolute(to)) throw new Invalid(`${at}.to`, 'must be an absolute path or start with ~/');
  return { github: { repo: g.repo, tag, assets }, to };
}

function server(s, i, seen, home) {
  const at = `mcpServers[${i}]`;
  if (!isObject(s)) throw new Invalid(at, 'must be an object');
  if (!isString(s.id) || !ID.test(s.id)) throw new Invalid(`${at}.id`, 'must be letters, digits, _ or -');
  if (seen.has(s.id)) throw new Invalid(`${at}.id`, `"${s.id}" is used twice`);
  seen.add(s.id);
  if (!isString(s.name)) throw new Invalid(`${at}.name`, 'must be a string');
  if (!isString(s.about)) throw new Invalid(`${at}.about`, 'must be a string');
  const reg = register(s.register, `${at}.register`, home);
  const conn = connect(s.connect, `${at}.connect`, reg, home);
  if (conn.kind !== 'tokenPage' && JSON.stringify(reg).includes(TOKEN)) {
    throw new Invalid(`${at}.register`, `${TOKEN} may appear only in a tokenPage server's register`);
  }
  // never on a command line (argv is visible to every process), nor in a URL: only in headers or env
  const onArgv = reg.type === 'http' ? [['url', reg.url]] : [['command', reg.command], ...reg.args.map((a, j) => [`args[${j}]`, a])];
  for (const [k, v] of onArgv) {
    if (v.includes(TOKEN)) throw new Invalid(`${at}.register.${k}`, `${TOKEN} may appear only in headers or env`);
  }
  return { id: s.id, name: s.name, about: s.about, register: reg, connect: conn, install: install(s.install, `${at}.install`, home) };
}

function validate(data, home) {
  if (!isObject(data)) throw new Invalid('', 'the file must hold a JSON object');
  if (!isString(data.name) || !data.name) throw new Invalid('name', 'must be a non-empty string');
  const company = { name: data.name, title: '', steps: { gateway: '', tools: '', talk: '' }, gateway: null, mcpServers: [] };
  // optional wording for the Get started page: its title, and the names of its gateway, tools and talk steps
  if (data.title !== undefined) {
    if (!isString(data.title) || !data.title) throw new Invalid('title', 'must be a non-empty string');
    company.title = data.title;
  }
  if (data.steps !== undefined) {
    if (!isObject(data.steps)) throw new Invalid('steps', 'must be an object');
    for (const k of ['gateway', 'tools', 'talk']) {
      const v = data.steps[k];
      if (v === undefined) continue;
      if (!isString(v) || !v) throw new Invalid(`steps.${k}`, 'must be a non-empty string');
      company.steps[k] = v;
    }
  }
  if (data.gateway !== undefined && data.gateway !== null) company.gateway = gateway(data.gateway, home);
  if (data.mcpServers !== undefined) {
    if (!Array.isArray(data.mcpServers)) throw new Invalid('mcpServers', 'must be an array');
    const seen = new Set();
    company.mcpServers = data.mcpServers.map((s, i) => server(s, i, seen, home));
  }
  return company;
}

function readCompany(file, { home = os.homedir() } = {}) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: false, missing: true, error: `${file} does not exist` };
    return { ok: false, missing: false, error: `${file} cannot be read: ${e.message}` };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, missing: false, error: `invalid JSON: ${e.message}` };
  }
  try {
    return { ok: true, company: validate(data, home) };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, missing: false, error: e.message };
    throw e;
  }
}

module.exports = { companyFile, readCompany };
