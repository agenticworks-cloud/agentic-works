'use strict';
// Connect Claude's ways, without VS Code: the AWS profiles on the machine, the Bedrock check (the AWS CLI, faked here),
// whether Claude counts as connected, and the backend a new Claude tab takes from the recorded connection.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../src/claudeConnections');

(async () => {
  assert.strictEqual(C.ANTHROPIC_KEY_FILE, '~/.config/roost/anthropic-key');
  assert.strictEqual(C.GATEWAY_KEY_FILE, '~/.config/roost/gateway-key');

  // ---- readSecretFile: the secret trimmed, '' when there is none
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-conn-'));
    try {
      const f = path.join(dir, 'k');
      assert.strictEqual(C.readSecretFile(f), '', 'absent');
      fs.writeFileSync(f, 'sk-ant-1\n');
      assert.strictEqual(C.readSecretFile(f), 'sk-ant-1', 'the newline taken off');
      fs.writeFileSync(f, '  \n');
      assert.strictEqual(C.readSecretFile(f), '', 'blank');
      assert.strictEqual(C.anthropicKeyFile(dir), path.join(dir, '.config', 'roost', 'anthropic-key'));
      assert.strictEqual(C.gatewayKeyFile(dir), path.join(dir, '.config', 'roost', 'gateway-key'));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  // ---- awsProfiles: ~/.aws/config's [default] and [profile x], ~/.aws/credentials' [x], by name, once each
  {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'roost-aws-'));
    try {
      assert.deepStrictEqual(C.awsProfiles({ home }), [], 'no ~/.aws: none');
      fs.mkdirSync(path.join(home, '.aws'));
      fs.writeFileSync(path.join(home, '.aws', 'config'), '[default]\nregion=us-east-1\n\n# a comment\n[profile dev]\nregion = eu-west-1\noutput=json\n[sso-session corp]\nsso_region=us-west-2\n');
      fs.writeFileSync(path.join(home, '.aws', 'credentials'), '[ci]\naws_access_key_id=AKIAEXAMPLE\naws_secret_access_key=x\n[default]\naws_access_key_id=AKIAEXAMPLE2\n');
      assert.deepStrictEqual(C.awsProfiles({ home }), [{ name: 'ci', region: '' }, { name: 'default', region: 'us-east-1' }, { name: 'dev', region: 'eu-west-1' }]);
    } finally { fs.rmSync(home, { recursive: true, force: true }); }
  }

  // ---- checkBedrock: the AWS CLI's model list, each answer a verdict with its words
  {
    const runs = [];
    const fake = (answer) => async (argv) => { runs.push(argv); if (answer instanceof Error) throw answer; return answer; };
    const enoent = Object.assign(new Error('spawn aws ENOENT'), { code: 'ENOENT' });
    const models = JSON.stringify({ modelSummaries: [{ modelId: 'anthropic.claude-x' }, { modelId: 'anthropic.claude-y' }] });

    let r = await C.checkBedrock({ profile: 'dev', region: 'eu-west-1', run: fake({ code: 0, stdout: models, stderr: '' }) });
    assert.deepStrictEqual(runs.pop(), ['aws', 'bedrock', 'list-foundation-models', '--by-provider', 'anthropic', '--region', 'eu-west-1', '--output', 'json', '--profile', 'dev']);
    assert.deepStrictEqual(r, { verdict: 'works', text: 'Works: 2 Anthropic models in eu-west-1.', models: ['anthropic.claude-x', 'anthropic.claude-y'] });

    r = await C.checkBedrock({ profile: '', region: 'us-east-1', run: fake({ code: 0, stdout: '{"modelSummaries":[]}', stderr: '' }) });
    assert.deepStrictEqual(runs.pop(), ['aws', 'bedrock', 'list-foundation-models', '--by-provider', 'anthropic', '--region', 'us-east-1', '--output', 'json'], 'default credentials: no --profile');
    assert.deepStrictEqual(r, { verdict: 'noModels', text: 'No Anthropic models are offered in us-east-1.', models: [] });

    r = await C.checkBedrock({ profile: 'dev', region: 'us-east-1', run: fake({ code: 255, stdout: '', stderr: '\nError when retrieving token from sso: Token has expired and refresh failed\n' }) });
    assert.deepStrictEqual(r, { verdict: 'signIn', text: 'AWS needs a sign-in first: run aws sso login --profile dev in a terminal.', models: [] });
    r = await C.checkBedrock({ profile: '', region: 'us-east-1', run: fake({ code: 253, stdout: '', stderr: 'Unable to locate credentials. You can configure credentials by running "aws configure".\n' }) });
    assert.deepStrictEqual(r, { verdict: 'signIn', text: 'AWS needs a sign-in first: run aws sso login in a terminal.', models: [] });

    r = await C.checkBedrock({ profile: '', region: 'us-east-1', run: fake({ code: 254, stdout: '', stderr: 'An error occurred (AccessDeniedException) when calling the ListFoundationModels operation: no\n' }) });
    assert.deepStrictEqual(r, { verdict: 'denied', text: 'The AWS account may not list Bedrock models in us-east-1.', models: [] });

    r = await C.checkBedrock({ profile: '', region: 'us-east-1', run: fake(enoent) });
    assert.deepStrictEqual(r, { verdict: 'unchecked', text: 'Bedrock needs the AWS CLI: install it (on macOS: brew install awscli), then try again.', models: [] }, 'no AWS CLI: what to do');
    assert.strictEqual(C.BEDROCK_NEEDS_CLI, r.text);
    assert.deepStrictEqual(C.COMPANY_WAYS, ['gateway', 'codex']);

    r = await C.checkBedrock({ profile: '', region: 'mars-1', run: fake({ code: 255, stdout: '', stderr: '\nCould not connect to the endpoint URL: "https://bedrock.mars-1.amazonaws.com/"\n\n' }) });
    assert.deepStrictEqual(r, { verdict: 'failed', text: 'Could not connect to the endpoint URL: "https://bedrock.mars-1.amazonaws.com/"', models: [] }, 'the last non-empty line');
  }

  // ---- isConnected: a recorded connection counts once it is ready; none recorded, a ready gateway or a Claude that can run
  const base = { connection: '', gatewayReady: false, canRun: false, apiKeySaved: false, bedrockSaved: false };
  const conn = (o) => C.isConnected(Object.assign({}, base, o));
  assert.strictEqual(conn({}), false, 'none recorded, nothing ready');
  assert.strictEqual(conn({ gatewayReady: true }), true);
  assert.strictEqual(conn({ canRun: true }), true);
  assert.strictEqual(conn({ connection: 'codex' }), true, 'Codex only needs nothing of Claude');
  assert.strictEqual(conn({ connection: 'apiKey' }), false, 'an API key way without its key');
  assert.strictEqual(conn({ connection: 'apiKey', apiKeySaved: true }), true);
  assert.strictEqual(conn({ connection: 'apiKey', canRun: true, gatewayReady: true }), false, 'the recorded way decides');
  assert.strictEqual(conn({ connection: 'gateway', gatewayReady: true }), true);
  assert.strictEqual(conn({ connection: 'gateway', canRun: true }), false);
  assert.strictEqual(conn({ connection: 'subscription', canRun: true }), true);
  assert.strictEqual(conn({ connection: 'subscription' }), false);
  assert.strictEqual(conn({ connection: 'bedrock', bedrockSaved: true }), true);
  assert.strictEqual(conn({ connection: 'bedrock' }), false);

  // ---- newTabBackend: what a new Claude tab runs on, by the recorded connection; null leaves today's rule
  assert.deepStrictEqual(C.newTabBackend('gateway'), { gateway: true, own: '' });
  assert.deepStrictEqual(C.newTabBackend('subscription'), { gateway: false, own: 'subscription' });
  assert.deepStrictEqual(C.newTabBackend('apiKey'), { gateway: false, own: 'apiKey' });
  assert.deepStrictEqual(C.newTabBackend('bedrock'), { gateway: false, own: 'api' });
  assert.strictEqual(C.newTabBackend('codex'), null);
  assert.strictEqual(C.newTabBackend(undefined), null);
  assert.strictEqual(C.newTabBackend('bogus'), null);

  console.log('claudeConnections tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
