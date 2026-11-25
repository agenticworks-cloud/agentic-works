'use strict';
// The company file: ~/.config/roost/company.json, written by a company's installer (ROOST_COMPANY_FILE overrides the
// path). It names an LLM gateway and the MCP servers the company offers. readCompany validates it whole: any error
// makes the file invalid, and the error starts with the path of the offending value (mcpServers[1].connect.kind: ...).
// The exceptions are the optional jira and email sections and a server's connect.button: a bad value there is dropped with a note
// (readCompany's notes), and the rest of the file still loads.
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
const isHttps = (v) => {
  if (!isString(v)) return false;
  try {
    return new URL(v).protocol === 'https:';
  } catch (e) {
    return false;
  }
};
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
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
  // Get started's Talk step opens a Claude tab on the gateway itself, once the gateway is ready, in place of its buttons
  if (g.openTabOnTalk !== undefined && typeof g.openTabOnTalk !== 'boolean') throw new Invalid('gateway.openTabOnTalk', 'must be true or false');
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
    openTabOnTalk: g.openTabOnTalk === true,
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

function connect(c, at, reg, home, notes) {
  if (c === undefined) c = { kind: 'none' };
  if (!isObject(c)) throw new Invalid(at, 'must be an object');
  if (!KINDS.includes(c.kind)) throw new Invalid(`${at}.kind`, `must be one of ${KINDS.join(', ')}`);
  const out = { kind: c.kind, args: {}, complete: null, doneWhen: null, check: null, button: '' };
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
  // button: the Connect button's label for a command or mcpTool row (e.g. "Sign in with <provider>")
  if (c.button !== undefined && c.button !== null) {
    const b = isString(c.button) ? c.button.trim() : '';
    if (c.kind !== 'command' && c.kind !== 'mcpTool') notes.push(`${at}.button: only a command or mcpTool row has a button; it is ignored`);
    else if (!b || b.length > 40 || /[\u0000-\u001f\u007f]/.test(b)) notes.push(`${at}.button: must be a string of 1 to 40 characters; it is ignored`);
    else out.button = b;
  }
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

function server(s, i, seen, home, notes) {
  const at = `mcpServers[${i}]`;
  if (!isObject(s)) throw new Invalid(at, 'must be an object');
  if (!isString(s.id) || !ID.test(s.id)) throw new Invalid(`${at}.id`, 'must be letters, digits, _ or -');
  if (seen.has(s.id)) throw new Invalid(`${at}.id`, `"${s.id}" is used twice`);
  seen.add(s.id);
  if (!isString(s.name)) throw new Invalid(`${at}.name`, 'must be a string');
  if (!isString(s.about)) throw new Invalid(`${at}.about`, 'must be a string');
  const reg = register(s.register, `${at}.register`, home);
  const conn = connect(s.connect, `${at}.connect`, reg, home, notes);
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

// jira: the company's Jira site and the user's email, for the Get started page to fill in: { site, email }, both
// optional. Never a token: any other field (a token among them) is ignored. A bad value is dropped with a note.
function jira(j, notes) {
  const out = { site: '', email: '' };
  if (j === undefined || j === null) return out;
  if (!isObject(j)) { notes.push('jira: must be an object; it is ignored'); return out; }
  if (j.site !== undefined) {
    if (isHttps(j.site)) out.site = j.site;
    else notes.push('jira.site: must be an https URL; it is ignored');
  }
  if (j.email !== undefined) {
    if (isString(j.email) && EMAIL.test(j.email)) out.email = j.email;
    else notes.push('jira.email: must be an email address; it is ignored');
  }
  return out;
}

// email: the Get started page asks for the user's address on the company's domain, and the company's tools get it in
// the environment variable named here (never on a command line): { domain, env }, env optional. A bad section is
// dropped with a note: no email step then.
const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;
const RESERVED_ENV = /^(PATH|HOME|SHELL|USER|LOGNAME|TMPDIR|NODE_OPTIONS|NODE_PATH|PYTHONPATH|LD_.*|DYLD_.*)$/;
function email(e, notes) {
  if (e === undefined || e === null) return null;
  if (!isObject(e)) { notes.push('email: must be an object; it is ignored'); return null; }
  const domain = isString(e.domain) ? e.domain.trim().toLowerCase() : '';
  if (!DOMAIN.test(domain) || domain.length > 253) { notes.push('email.domain: must be a domain name, such as example.com; the email section is ignored'); return null; }
  let env = '';
  if (e.env !== undefined) {
    if (!isString(e.env) || !ENV_NAME.test(e.env) || RESERVED_ENV.test(e.env)) {
      notes.push('email.env: must be an upper-case environment variable name, not one the system uses; the email section is ignored');
      return null;
    }
    env = e.env;
  }
  return { domain, env };
}

function validate(data, home, notes = [], dir = home) {
  if (!isObject(data)) throw new Invalid('', 'the file must hold a JSON object');
  if (!isString(data.name) || !data.name) throw new Invalid('name', 'must be a non-empty string');
  const company = { name: data.name, title: '', steps: { email: '', gateway: '', tools: '', talk: '' }, email: null, gateway: null, mcpServers: [], jira: { site: '', email: '' }, skills: [] };
  // optional wording for the Get started page: its title, and the names of its email, gateway, tools and talk steps
  if (data.title !== undefined) {
    if (!isString(data.title) || !data.title) throw new Invalid('title', 'must be a non-empty string');
    company.title = data.title;
  }
  if (data.steps !== undefined) {
    if (!isObject(data.steps)) throw new Invalid('steps', 'must be an object');
    for (const k of ['email', 'gateway', 'tools', 'talk']) {
      const v = data.steps[k];
      if (v === undefined) continue;
      if (!isString(v) || !v) throw new Invalid(`steps.${k}`, 'must be a non-empty string');
      company.steps[k] = v;
    }
  }
  company.jira = jira(data.jira, notes);
  company.email = email(data.email, notes);
  if (data.gateway !== undefined && data.gateway !== null) company.gateway = gateway(data.gateway, home);
  if (data.mcpServers !== undefined) {
    if (!Array.isArray(data.mcpServers)) throw new Invalid('mcpServers', 'must be an array');
    const seen = new Set();
    company.mcpServers = data.mcpServers.map((s, i) => server(s, i, seen, home, notes));
  }
  if (data.skills !== undefined) company.skills = skills(data.skills, home, dir);
  return company;
}

// skills: the agent skills that come with the company's tools, each a folder holding SKILL.md, copied by src/skills.js
// to ~/.claude/skills/<id>/ and ~/.agents/skills/<id>/. The id is the skill's name (Agent Skills: lowercase letters,
// digits and single hyphens, at most 64); source is a folder, ~ expanded, a relative one from the company file's folder.
const SKILL_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
function skills(v, home, dir) {
  if (!Array.isArray(v)) throw new Invalid('skills', 'must be an array');
  const seen = new Set();
  return v.map((k, i) => {
    const at = `skills[${i}]`;
    if (!isObject(k)) throw new Invalid(at, 'must be an object');
    if (!isString(k.id) || !SKILL_ID.test(k.id) || k.id.length > 64) throw new Invalid(`${at}.id`, 'must be lowercase letters, digits and single hyphens, at most 64');
    if (seen.has(k.id)) throw new Invalid(`${at}.id`, `${k.id} appears twice`);
    seen.add(k.id);
    if (!isString(k.source) || !k.source) throw new Invalid(`${at}.source`, 'must be a non-empty string');
    return { id: k.id, source: path.resolve(dir, expand(k.source, home)) };
  });
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
  // notes: the values dropped from the optional sections, each starting with its path (jira.site: ...)
  const notes = [];
  try {
    return { ok: true, company: validate(data, home, notes, path.dirname(path.resolve(file))), notes };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, missing: false, error: e.message };
    throw e;
  }
}

// The user's address saved by the Get started page's email step (globalState EMAIL_KEY, which Roost and its parts
// share): normalized, or '' when the company asks for none or it isn't an address on the company's domain.
const EMAIL_KEY = 'roost.email';
function companyEmail(company, value) {
  if (!company || !company.email || !isString(value)) return '';
  const v = value.trim().toLowerCase();
  if (v.length > 254 || !EMAIL.test(v) || !v.endsWith(`@${company.email.domain}`)) return '';
  return v;
}
// The environment the company's tools get it in: { [email.env]: address }, or {} with no env or no address.
function companyEmailEnv(company, value) {
  const v = companyEmail(company, value);
  return v && company.email.env ? { [company.email.env]: v } : {};
}

module.exports = { companyFile, readCompany, companyEmail, companyEmailEnv, EMAIL_KEY };
