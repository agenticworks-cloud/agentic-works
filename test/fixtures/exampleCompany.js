'use strict';
// The example company file of test/company.test.js (Task 2's EXAMPLE), for the tools tests.
module.exports = { name: 'Example Co',
  gateway: { name: 'Example Gateway', baseUrls: ['https://ai.example.com/llm-api', 'https://public.example.com/llm-api'],
             keyPage: 'https://ai.example.com/api-access', requiredModel: 'router-auto', env: { ANTHROPIC_MODEL: 'router-auto' },
             keyFiles: ['~/.config/example-gateway/token'], terminal: true },
  mcpServers: [
    { id: 'docs', name: 'Example Docs', about: 'the docs', register: { type: 'http', url: 'https://mcp.example.com/mcp', headers: { Authorization: 'Bearer ${token}' } },
      connect: { kind: 'tokenPage', page: 'https://mcp.example.com/token', check: { method: 'POST', url: 'https://mcp.example.com/mcp', body: 'initialize' } } },
    { id: 'mail', name: 'Example Mail', about: 'mail', register: { type: 'stdio', command: '~/.local/bin/example-mcp', env: { EXAMPLE_ID: '00000000-0000-0000-0000-000000000000' } },
      connect: { kind: 'mcpTool', tool: 'login', args: {}, complete: { complete: true }, doneWhen: { file: '~/.example-token.json' }, check: { mcpTool: 'whoami' } } },
    { id: 'tickets', name: 'Example Tickets', about: 'tickets', register: { type: 'stdio', command: '/opt/t/mcp' },
      connect: { kind: 'command', command: ['~/.local/bin/t-login'], doneWhen: { file: '~/.t/credentials.json' }, check: { command: ['~/.local/bin/t-login', '--status'] } } },
  ] };
