'use strict';
// Registering a company's MCP server with Claude Code at user scope, as `claude mcp add --scope user` would: the
// top-level mcpServers[id] of ~/.claude.json. Written directly rather than through `claude mcp add`, so a token is
// never in a process's argv. Claude Code rewrites this file while it runs, so it is re-read just before each write,
// every other key is kept as found, and the write is atomic (a temp file renamed over it). A file that isn't a JSON
// object is never rewritten.
const fs = require('node:fs');
const path = require('node:path');
const { isDeepStrictEqual } = require('node:util');

const CLAUDE_JSON = '~/.claude.json';
const TOKEN = '${token}';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const fill = (s, token) => s.split(TOKEN).join(token);
const fillMap = (m, token) => Object.fromEntries(Object.entries(m || {}).map(([k, v]) => [k, fill(v, token)]));

/**
 * What Claude Code is given for a server: its `register`, with `${token}` replaced in headers and env. Throws when
 * `${token}` is in the url, command or args: a token never goes on a command line.
 */
function registration(server, { token = '' } = {}) {
  const r = server.register;
  const plain = r.type === 'http' ? [r.url] : [r.command, ...(r.args || [])];
  if (plain.some((v) => String(v).includes(TOKEN))) throw new Error(`${server.id}: ${TOKEN} may appear only in headers or env`);
  if (r.type === 'http') return { type: 'http', url: r.url, headers: fillMap(r.headers, token) };
  return { type: 'stdio', command: r.command, args: (r.args || []).slice(), env: fillMap(r.env, token) };
}

function readObject(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return {};
    throw e;
  }
  let json;
  try { json = JSON.parse(text); } catch (_) { json = undefined; }
  if (!isObject(json)) throw new Error(`${file} is not a JSON object; it was left alone`);
  if (json.mcpServers !== undefined && !isObject(json.mcpServers)) throw new Error(`${file}'s mcpServers is not a JSON object; it was left alone`);
  return json;
}

function writeAtomic(file, json) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // Always 0600, the temp file too: the file can hold a token (a header), whatever its mode was before
  const tmp = `${file}.agentic-works-${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(json, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);   // against a umask, which only narrows
    fs.renameSync(tmp, file);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch (_) { /* never made */ }
    throw e;
  }
}

/**
 * Put `entry` at mcpServers[id] of `file`. A different entry already there is a 'conflict' (left as it is) unless
 * `replace`, or unless it equals `previous` (what Agentic Works itself registered before, such as the entry with an older
 * token). Throws, leaving the file alone, when it isn't a JSON object.
 * @returns {'added'|'same'|'conflict'|'replaced'}
 */
function register(file, id, entry, { replace = false, previous } = {}) {
  const first = readObject(file);
  const had = first.mcpServers && Object.prototype.hasOwnProperty.call(first.mcpServers, id) ? first.mcpServers[id] : undefined;
  if (had !== undefined && isDeepStrictEqual(had, entry)) return 'same';
  if (had !== undefined && !replace && !(previous !== undefined && isDeepStrictEqual(had, previous))) return 'conflict';
  const now = readObject(file);   // re-read just before writing: Claude Code may have rewritten it meanwhile
  now.mcpServers = { ...(now.mcpServers || {}), [id]: entry };
  writeAtomic(file, now);
  return had === undefined ? 'added' : 'replaced';
}

module.exports = { CLAUDE_JSON, registration, register };
