'use strict';
// A fake MCP server on stdio (newline-delimited JSON-RPC 2.0), for mcpClient.test.js and tools.test.js.
// Tools: `login` (a device-code prompt; with { complete: true } it writes $FAKE_MCP_TOKEN_FILE) and `whoami`
// (isError until that file exists). FAKE_MCP_MODE misbehaves: `exit` (exits at once), `garbage` (prints lines that
// aren't JSON, never answers), `silent` (reads, never answers).
const fs = require('node:fs');

const mode = process.env.FAKE_MCP_MODE || '';
const tokenFile = process.env.FAKE_MCP_TOKEN_FILE || '';

if (mode === 'exit') process.exit(3);
if (mode === 'garbage') {
  process.stdout.write('hello\n');
  setInterval(() => process.stdout.write('hello\n'), 50);
}

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], isError });

function answer(req) {
  if (req.method === 'initialize') {
    return { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } };
  }
  if (req.method === 'tools/call') {
    const { name, arguments: args = {} } = req.params;
    if (name === 'login') {
      if (args.complete === true) {
        fs.writeFileSync(tokenFile, '{"token":"fake"}\n');
        return text('Login successful');
      }
      return text('To sign in, open https://login.example.com/device and enter code ABCD-1234.');
    }
    if (name === 'whoami') {
      return tokenFile && fs.existsSync(tokenFile) ? text('you are someone@example.com') : text('Not signed in. Call login first.', true);
    }
    return null;
  }
  return null;
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  if (mode === 'garbage' || mode === 'silent') return;
  buf += chunk;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    const req = JSON.parse(line);
    if (req.id === undefined) continue;   // a notification
    const result = answer(req);
    if (result) send({ id: req.id, result });
    else send({ id: req.id, error: { code: -32601, message: `unknown: ${req.method}` } });
  }
});
process.stdin.on('end', () => process.exit(0));
