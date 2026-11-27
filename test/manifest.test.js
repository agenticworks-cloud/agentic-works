'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const script = path.join(root, 'scripts', 'build-manifest.js');
const { buildManifest } = require(script);
const { readParts } = require(path.join(root, 'src', 'parts.js'));

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const temps = [];
process.on('exit', () => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

// A temp tree with agentic-works.json and two small parts, a (id a) and b (id b).
function fixture(edit = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-works-manifest-'));
  temps.push(dir);
  const tree = {
    'agentic-works.json': { name: 'fixture', publisher: 'me', version: '0.0.1', engines: { vscode: '^1.90.0' } },
    'parts/a/part.json': { id: 'a', title: 'Part A', entry: 'src/extension.js', needs: [] },
    'parts/a/package.json': {
      name: 'a',
      activationEvents: ['onStartupFinished', 'onWebviewPanel:a.panel'],
      dependencies: { left: '^1.0.0' },
      extensionPack: ['x.one'],
      contributes: {
        commands: [{ command: 'a.x', title: 'X', icon: '$(gear)' }],
        viewsContainers: { activitybar: [{ id: 'a', title: 'A', icon: 'media/a.svg' }] },
        views: { a: [{ type: 'webview', id: 'a.view', name: 'A' }] },
        menus: {
          'view/title': [
            { command: 'a.x', when: 'view == a.view', group: 'navigation' },
            { command: 'a.x', when: 'view == a.view' },
          ],
        },
        configuration: { title: 'a', properties: { 'a.size': { type: 'number', default: 1 } } },
        keybindings: [
          { command: 'a.x', key: 'ctrl+alt+x' },
          { command: 'a.x', key: 'ctrl+alt+y', when: 'editorFocus' },
        ],
      },
    },
    'parts/b/part.json': { id: 'b', title: 'Part B', entry: 'src/extension.js', needs: ['a'] },
    'parts/b/package.json': {
      name: 'b',
      activationEvents: ['onStartupFinished', 'onCommand:b.y'],
      dependencies: { left: '^1.0.0', right: '^2.0.0' },
      extensionPack: ['x.one', 'x.two'],
      contributes: {
        commands: [{ command: 'b.y', title: 'Y', icon: { light: 'media/l.svg', dark: 'media/d.svg' } }],
        viewsContainers: { panel: [{ id: 'b', title: 'B', icon: 'media/b.svg' }] },
        views: {
          b: [
            { type: 'webview', id: 'b.view', name: 'B', when: 'foo' },
            { id: 'b.plain', name: 'Plain' },
          ],
        },
        menus: { commandPalette: [{ command: 'b.y' }] },
        configuration: [
          { title: 'b one', properties: { 'b.one': { type: 'string', default: '' } } },
          { title: 'b two', properties: { 'b.two': { type: 'boolean', default: false } } },
        ],
      },
    },
  };
  edit(tree);
  for (const [file, value] of Object.entries(tree)) {
    if (value === undefined) continue;
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), JSON.stringify(value, null, 2));
  }
  return dir;
}

const pkg = (tree, part) => tree[`parts/${part}/package.json`];

test('union keeps every id', () => {
  const m = buildManifest(fixture());
  assert.deepStrictEqual(m.contributes.commands.map((c) => c.command), ['a.x', 'b.y']);
  assert.deepStrictEqual(m.contributes.views.a.map((v) => v.id), ['a.view']);
  assert.deepStrictEqual(m.contributes.views.b.map((v) => v.id), ['b.view', 'b.plain']);
  assert.deepStrictEqual(m.contributes.viewsContainers.activitybar.map((v) => v.id), ['a']);
  assert.deepStrictEqual(m.contributes.viewsContainers.panel.map((v) => v.id), ['b']);
  assert.strictEqual(m.name, 'fixture');
  assert.strictEqual(m.main, './src/extension.js');
});

test('when added', () => {
  const m = buildManifest(fixture());
  const views = m.contributes.views.b;
  assert.strictEqual(views[0].when, 'config.agenticWorks.b.enabled && !agenticWorks.b.failed && (foo)');
  assert.strictEqual(views[1].when, 'config.agenticWorks.b.enabled && !agenticWorks.b.failed');
  assert.strictEqual(m.contributes.views.a[0].when, 'config.agenticWorks.a.enabled && !agenticWorks.a.failed');
  assert.deepStrictEqual(
    m.contributes.menus['view/title'].map((e) => e.when),
    ['config.agenticWorks.a.enabled && !agenticWorks.a.failed && (view == a.view)', 'config.agenticWorks.a.enabled && !agenticWorks.a.failed && (view == a.view)'],
  );
  assert.deepStrictEqual(m.contributes.keybindings.map((k) => k.when), ['config.agenticWorks.a.enabled && !agenticWorks.a.failed', 'config.agenticWorks.a.enabled && !agenticWorks.a.failed && (editorFocus)']);
  // VS Code ignores `when` on view containers; they hide when all their views are hidden.
  assert.strictEqual(m.contributes.viewsContainers.panel[0].when, undefined);
});

test('every part command is gated in the Command Palette', () => {
  const m = buildManifest(fixture());
  assert.deepStrictEqual(m.contributes.menus.commandPalette, [
    { command: 'a.x', when: 'config.agenticWorks.a.enabled && !agenticWorks.a.failed' },
    { command: 'b.y', when: 'config.agenticWorks.b.enabled && !agenticWorks.b.failed' },
  ]);
});

test('an Agentic Works section with the switches first, then one section per part', () => {
  const m = buildManifest(fixture());
  const cfg = m.contributes.configuration;
  assert.strictEqual(Array.isArray(cfg), true);
  assert.deepStrictEqual(cfg.map((c) => c.title), ['Agentic Works', 'Part A', 'Part B']);
  assert.deepStrictEqual(cfg.map((c) => c.order), [0, 1, 2]);
  assert.deepStrictEqual(Object.keys(cfg[0].properties), ['agenticWorks.a.enabled', 'agenticWorks.b.enabled']);
  assert.deepStrictEqual(Object.values(cfg[0].properties).map((p) => p.order), [0, 1]);
  const { order, ...sw } = cfg[0].properties['agenticWorks.a.enabled'];
  assert.deepStrictEqual(sw, { type: 'boolean', default: true, description: 'Part A: switch this part on or off.' });
  assert.deepStrictEqual(Object.keys(cfg[1].properties), ['a.size']);
  assert.deepStrictEqual(Object.keys(cfg[2].properties), ['b.one', 'b.two']);
  assert.deepStrictEqual(cfg[2].properties['b.one'], { type: 'string', default: '' });
});

test('paths rewritten relative to the root', () => {
  const m = buildManifest(fixture());
  assert.strictEqual(m.contributes.viewsContainers.activitybar[0].icon, 'parts/a/media/a.svg');
  assert.strictEqual(m.contributes.viewsContainers.panel[0].icon, 'parts/b/media/b.svg');
  assert.deepStrictEqual(m.contributes.commands[1].icon, { light: 'parts/b/media/l.svg', dark: 'parts/b/media/d.svg' });
  assert.strictEqual(m.contributes.commands[0].icon, '$(gear)');
});

test('activation events, dependencies and extensionPack are unions', () => {
  const m = buildManifest(fixture());
  assert.deepStrictEqual(m.activationEvents, ['onStartupFinished', 'onWebviewPanel:a.panel', 'onCommand:b.y']);
  assert.deepStrictEqual(m.dependencies, { left: '^1.0.0', right: '^2.0.0' });
  assert.deepStrictEqual(m.extensionPack, ['x.one', 'x.two']);
});

test('duplicate command id throws', () => {
  const dir = fixture((t) => pkg(t, 'b').contributes.commands.push({ command: 'a.x', title: 'again' }));
  assert.throws(() => buildManifest(dir), (e) => /a\.x/.test(e.message) && /\ba\b/.test(e.message) && /\bb\b/.test(e.message));
});

test('duplicate view, container, setting and webview ids throw', () => {
  const cases = [
    [(t) => pkg(t, 'b').contributes.views.b.push({ id: 'a.view', name: 'dup' }), /a\.view/],
    [(t) => pkg(t, 'b').contributes.viewsContainers.panel.push({ id: 'a', title: 'dup' }), /container/],
    [(t) => (pkg(t, 'b').contributes.configuration[0].properties['a.size'] = { type: 'number' }), /a\.size/],
    [(t) => (pkg(t, 'b').contributes.configuration[0].properties['agenticWorks.a.enabled'] = { type: 'boolean' }), /agenticWorks\.a\.enabled/],
    [(t) => pkg(t, 'b').activationEvents.push('onWebviewPanel:a.panel'), /a\.panel/],
  ];
  for (const [edit, re] of cases) assert.throws(() => buildManifest(fixture(edit)), re);
});

test('missing part.json throws', () => {
  const dir = fixture((t) => (t['parts/b/part.json'] = undefined));
  assert.throws(() => buildManifest(dir), /part\.json/);
});

test('unknown needs throws', () => {
  const dir = fixture((t) => (t['parts/b/part.json'].needs = ['nope']));
  assert.throws(() => buildManifest(dir), /nope/);
});

test('two parts with the same id throw', () => {
  const dir = fixture((t) => (t['parts/b/part.json'].id = 'a'));
  assert.throws(() => buildManifest(dir), /parts\/a and parts\/b have the same id a/);
});

test('unknown contribution point throws', () => {
  const dir = fixture((t) => (pkg(t, 'b').contributes.grammars = [{ language: 'x', path: 'syntaxes/x.json' }]));
  assert.throws(() => buildManifest(dir), /parts\/b.*grammars/);
});

test('agentic-works.json may not set generated fields', () => {
  for (const field of ['main', 'activationEvents', 'contributes', 'dependencies', 'extensionPack']) {
    const dir = fixture((t) => (t['agentic-works.json'][field] = field === 'main' ? './x.js' : []));
    assert.throws(() => buildManifest(dir), new RegExp(`agentic-works\\.json.*${field}`), field);
  }
});

test('dependency version conflict throws', () => {
  const dir = fixture((t) => (pkg(t, 'b').dependencies.left = '^9.0.0'));
  assert.throws(() => buildManifest(dir), /left/);
});

test('real tree builds', () => {
  const m = buildManifest(root);
  assert.strictEqual(m.name, 'agentic-works');
  assert.strictEqual(m.version, JSON.parse(fs.readFileSync(path.join(root, 'agentic-works.json'), 'utf8')).version, "agentic-works.json's version");
  const containers = Object.values(m.contributes.viewsContainers).flat().map((c) => c.id);
  for (const id of ['perch', 'chirp', 'jay', 'kestrel']) assert.ok(containers.includes(id), `container ${id}`);
  assert.deepStrictEqual(m.contributes.viewsContainers.panel.map((c) => c.id), ['kestrel']);
  assert.ok(m.dependencies['@anthropic-ai/claude-agent-sdk'], 'Claude Agent SDK');
  assert.ok(m.dependencies['@openai/codex-sdk'], 'Codex SDK');
  assert.deepStrictEqual(m.extensionPack, ['seanahn.perch-audio', 'anthropic.claude-code', 'openai.chatgpt']);
  // Every part has its switch, listed first and in part order.
  const parts = readParts(root);
  const cfg = m.contributes.configuration;
  const props = cfg[0].properties;
  assert.strictEqual(cfg[0].title, 'Agentic Works');
  assert.deepStrictEqual(Object.keys(props), parts.map((p) => `agenticWorks.${p.id}.enabled`));
  assert.deepStrictEqual(Object.values(props).map((p) => p.order), parts.map((_, i) => i));
  assert.deepStrictEqual(cfg.slice(1).map((c) => c.title), parts.map((p) => p.title));
  const partProps = parts.reduce((n, p) => {
    const c = JSON.parse(fs.readFileSync(path.join(p.dir, 'package.json'), 'utf8')).contributes.configuration;
    return n + (Array.isArray(c) ? c : c ? [c] : []).reduce((k, b) => k + Object.keys(b.properties || {}).length, 0);
  }, 0);
  assert.strictEqual(cfg.reduce((n, c) => n + Object.keys(c.properties).length, 0), parts.length + partProps);
  for (const p of parts) {
    const sw = props[`agenticWorks.${p.id}.enabled`];
    assert.strictEqual(sw.type, 'boolean', p.id);
    assert.strictEqual(sw.default, true, p.id);
    assert.strictEqual(sw.description, `${p.title}: switch this part on or off.`, p.id);
  }
  for (const type of ['perch.session', 'chirp.conversation', 'jay.ticket', 'jay.page']) {
    assert.ok(m.activationEvents.includes(`onWebviewPanel:${type}`), type);
  }
  // Every view and menu entry carries its part's switch; every icon path exists.
  const switches = parts.map((p) => `config.agenticWorks.${p.id}.enabled && !agenticWorks.${p.id}.failed`);
  // (agenticWorks.* commands are Agentic Works' own, in no part's switch: agenticWorks.openSettings is asserted in its own test)
  const own = (command) => /^agenticWorks\./.test(command || '');
  const entries = [...Object.values(m.contributes.views).flat(), ...Object.values(m.contributes.menus).flat()].filter((e) => !own(e.command));
  for (const e of entries) assert.ok(switches.some((s) => e.when.startsWith(s)), JSON.stringify(e));
  // Every command of a part is gated in the Command Palette by that part's switch.
  // (a command's part is the one whose package.json contributes it: command ids kept the parts' old names)
  const owner = Object.fromEntries(parts.flatMap((p) => (JSON.parse(fs.readFileSync(path.join(p.dir, 'package.json'), 'utf8')).contributes.commands || []).map((c) => [c.command, p.id])));
  for (const { command } of m.contributes.commands.filter((c) => !own(c.command))) {
    const id = owner[command];
    const want = `config.agenticWorks.${id}.enabled && !agenticWorks.${id}.failed`;
    const entries = m.contributes.menus.commandPalette.filter((e) => e.command === command);
    assert.ok(entries.length && entries.every((e) => e.when.startsWith(want)), `${command} gated by ${want}`);
  }
  for (const k of m.contributes.keybindings) assert.ok(switches.some((s) => k.when.startsWith(s)), JSON.stringify(k));
  // Every path in contributes points into a part, or Agentic Works' own media/ for its walkthrough, and exists on disk.
  const pathKeys = new Set(['icon', 'path', 'image', 'markdown', 'svg', 'light', 'dark']);
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v === null || typeof v !== 'object') return;
    for (const [k, x] of Object.entries(v)) {
      if (pathKeys.has(k) && typeof x === 'string' && !x.startsWith('$(')) {
        assert.ok(x.startsWith('parts/') || x.startsWith('media/walkthrough/'), `${k}: ${x} is inside a part or Agentic Works' walkthrough`);
        assert.ok(fs.existsSync(path.join(root, x)), `${x} exists`);
      } else walk(x);
    }
  };
  const { configuration, configurationDefaults, ...withPaths } = m.contributes;
  walk(withPaths);
  assert.deepStrictEqual(m.extensionKind, ['workspace']);
  assert.deepStrictEqual(m.categories, ['AI', 'Chat']);
});

test('agenticWorks.openSettings is Agentic Works\' own: in no part\'s switch, on the Perch view\'s title bar', () => {
  const m = buildManifest(root);
  const cmd = m.contributes.commands.find((c) => c.command === 'agenticWorks.openSettings');
  assert.deepStrictEqual([cmd.title, cmd.icon], ['Agentic Works: Settings', '$(gear)']);
  assert.deepStrictEqual(m.contributes.menus['view/title'].filter((e) => e.command === 'agenticWorks.openSettings'), [
    { command: 'agenticWorks.openSettings', when: 'view == perch.main', group: 'navigation@99' },
  ]);
  assert.deepStrictEqual(m.contributes.menus.commandPalette.filter((e) => e.command === 'agenticWorks.openSettings'), [], 'always in the Command Palette');
});

test('agentic-works.contributes.json merges without a part switch and may not clash with a part', () => {
  const dir = fixture((t) => (t['agentic-works.contributes.json'] = {
    commands: [{ command: 'agenticWorks.x', title: 'Agentic Works: X' }],
    menus: { 'view/title': [{ command: 'agenticWorks.x', when: 'view == a.view' }] },
  }));
  const m = buildManifest(dir);
  assert.ok(m.contributes.commands.some((c) => c.command === 'agenticWorks.x'));
  assert.ok(m.contributes.menus['view/title'].some((e) => e.command === 'agenticWorks.x' && e.when === 'view == a.view'));
  const clash = fixture((t) => (t['agentic-works.contributes.json'] = { commands: [{ command: 'a.x', title: 'again' }] }));
  assert.throws(() => buildManifest(clash), /duplicate command id a\.x/);
  const odd = fixture((t) => (t['agentic-works.contributes.json'] = { grammars: [] }));
  assert.throws(() => buildManifest(odd), /agentic-works\.contributes\.json.*grammars/);
});

test('the Get started walkthrough: Agentic Works\' own, each part\'s step shown only while it is on, every page and button real', () => {
  const m = buildManifest(root);
  const [w] = m.contributes.walkthroughs;
  assert.strictEqual(m.contributes.walkthroughs.length, 1);
  assert.strictEqual(w.id, 'agenticWorks.getStarted');
  const when = Object.fromEntries(w.steps.map((s) => [s.id, s.when]));
  assert.deepStrictEqual(when, {
    githubFirst: 'agenticWorks.company && config.agenticWorks.pullRequests.enabled && !agenticWorks.pullRequests.failed',
    connectClaude: 'config.agenticWorks.agents.enabled && !agenticWorks.agents.failed', agents: 'config.agenticWorks.agents.enabled && !agenticWorks.agents.failed', tools: 'agenticWorks.companyTools', codebaseSearch: 'config.agenticWorks.agents.enabled && !agenticWorks.agents.failed', teams: 'config.agenticWorks.teams.enabled && !agenticWorks.teams.failed',
    jira: 'config.agenticWorks.jira.enabled && !agenticWorks.jira.failed', github: 'config.agenticWorks.pullRequests.enabled && !agenticWorks.pullRequests.failed && !agenticWorks.company',
    parts: undefined,
  });
  // a sign-in step is done once its part says it is signed in (a context key it sets), not when its button runs
  const contexts = Object.fromEntries(w.steps.map((s) => [s.id, s.completionEvents.filter((e) => e.startsWith('onContext:'))]));
  assert.deepStrictEqual(contexts, {
    githubFirst: ['onContext:kestrel.signedIn'],
    connectClaude: ['onContext:perch.claudeConnected'], agents: ['onContext:perch.messageSent'], tools: ['onContext:agenticWorks.toolsConnected'], codebaseSearch: [], teams: ['onContext:chirp.signedIn'], jira: ['onContext:jay.signedIn'], github: ['onContext:kestrel.signedIn'], parts: [],
  });
  const buttonsOf = (id) => [...w.steps.find((st) => st.id === id).description.matchAll(/\(command:([\w.]+)\)/g)].map((x) => x[1]);
  // with a company file, GitHub comes first (its tools download through gh); without one, it keeps its place
  assert.deepStrictEqual(w.steps.map((st) => st.id).slice(0, 3), ['githubFirst', 'connectClaude', 'agents'], 'GitHub (company), Connect Claude, then the agents step');
  assert.deepStrictEqual(w.steps.map((st) => st.id), ['githubFirst', 'connectClaude', 'agents', 'tools', 'codebaseSearch', 'teams', 'jira', 'github', 'parts']);
  const [ghFirst, ghLater] = ['githubFirst', 'github'].map((id) => w.steps.find((st) => st.id === id));
  assert.deepStrictEqual([ghFirst.title, ghFirst.media.markdown, ghFirst.completionEvents], [ghLater.title, ghLater.media.markdown, ghLater.completionEvents], 'two copies of one step');
  assert.deepStrictEqual(buttonsOf('githubFirst'), ['agenticWorks.githubSignIn']);
  assert.deepStrictEqual(buttonsOf('github'), ['agenticWorks.githubSignIn']);
  assert(!w.steps.some((st) => st.id === 'gateway'), 'no gateway step: Connect Claude replaces it');
  assert.deepStrictEqual(buttonsOf('agents'), ['agenticWorks.newClaudeTab', 'agenticWorks.newCodexTab'], 'either agent, opened from here');
  assert.deepStrictEqual(buttonsOf('connectClaude'), ['perch.connectClaude', 'agenticWorks.connectClaudeNotNow']);
  // Connect your tools: shown with a company file that lists servers; done when all are connected, or left for now
  const tools = w.steps.find((st) => st.id === 'tools');
  assert.deepStrictEqual([tools.title, tools.media.markdown], ['Connect your tools', 'media/walkthrough/tools.md']);
  assert.strictEqual(tools.description, 'Sign in to the tools your company set up for Claude, and Claude Code gets them.\n[Connect Your Tools](command:agenticWorks.connectTools)\n[Not Now](command:agenticWorks.toolsNotNow)');
  assert.deepStrictEqual(tools.completionEvents, ['onContext:agenticWorks.toolsConnected', 'onCommand:agenticWorks.toolsNotNow']);
  assert.deepStrictEqual(buttonsOf('tools'), ['agenticWorks.connectTools', 'agenticWorks.toolsNotNow']);
  // Teams and Jira: Agentic Works' sign-in, which runs the matching tools row with a company file, else the part's own
  assert.deepStrictEqual(buttonsOf('teams'), ['agenticWorks.teamsSignIn']);
  assert.deepStrictEqual(buttonsOf('jira'), ['agenticWorks.jiraSignIn']);
  const title = (id) => (m.contributes.commands.find((c) => c.command === id) || {}).title;
  assert.strictEqual(title('agenticWorks.connectTools'), 'Agentic Works: Connect Your Tools');
  const hidden = new Set(m.contributes.menus.commandPalette.filter((e) => e.when === 'false').map((e) => e.command));
  for (const id of ['agenticWorks.toolsNotNow', 'agenticWorks.teamsSignIn', 'agenticWorks.jiraSignIn', 'agenticWorks.connectClaudeNotNow']) assert.ok(hidden.has(id), `${id} hidden from the palette`);
  assert.ok(!hidden.has('agenticWorks.connectTools'), 'Agentic Works: Connect Your Tools is in the palette');
  const cc = w.steps.find((st) => st.id === 'connectClaude');
  assert.deepStrictEqual(cc.completionEvents, ['onContext:perch.claudeConnected', 'onCommand:agenticWorks.connectClaudeNotNow'], 'done when Claude is connected, or left for now');
  assert.deepStrictEqual([cc.title, cc.media.markdown], ['Connect Claude', 'media/walkthrough/connect-claude.md']);
  assert.strictEqual(cc.description, 'Choose how Claude runs: your company\'s gateway when it has one; otherwise a gateway, a Claude subscription, an Anthropic API key or AWS Bedrock. Only using Codex? Click Not Now, then open a Codex tab: its footer signs you in (ChatGPT login, an OpenAI API key or Bedrock).\n[Connect Claude](command:perch.connectClaude)\n[Not Now](command:agenticWorks.connectClaudeNotNow)');
  assert(!m.contributes.commands.some((c) => c.command === 'agenticWorks.gatewayNotNow'), 'agenticWorks.gatewayNotNow is gone');
  const commands = new Set(m.contributes.commands.map((c) => c.command));
  for (const step of w.steps) {
    assert.ok(fs.existsSync(path.join(root, step.media.markdown)), `${step.id}: ${step.media.markdown} exists`);
    const buttons = [...step.description.matchAll(/\(command:([\w.]+)\)/g)].map((x) => x[1]);
    assert.ok(buttons.length > 0, `${step.id} has a button`);
    const onCommand = step.completionEvents.filter((e) => !e.startsWith('onContext:'));
    for (const e of onCommand) assert.match(e, /^onCommand:/, `${step.id}: ${e} is onCommand: or onContext:`);
    for (const id of [...buttons, ...onCommand.map((e) => e.replace(/^onCommand:/, ''))]) {
      assert.ok(commands.has(id), `${step.id}: ${id} is a contributed command`);
    }
  }
  const partWalkthrough = fixture((t) => { t['parts/a/package.json'].contributes.walkthroughs = []; });
  assert.throws(() => buildManifest(partWalkthrough), /parts\/a contributes walkthroughs/, 'a part may not contribute one');
});

// The parts' settings and palette titles were renamed (2026-11-23): perch.* → agents.*, chirp.* → teams.*, jay.* →
// jira.*, kestrel.* → pullRequests.*; each part carries the user's old values over (src/settingsCarryOver.js).
test('no setting has an old prefix, and no palette title an old name', () => {
  const m = buildManifest(root);
  const keys = m.contributes.configuration.flatMap((c) => Object.keys(c.properties));
  assert.deepStrictEqual(keys.filter((k) => /^(perch|chirp|jay|kestrel)\./.test(k)), []);
  const owner = { agents: 'agents.', teams: 'teams.', jira: 'jira.', pullRequests: 'pullRequests.' };
  for (const p of readParts(root)) {
    const c = JSON.parse(fs.readFileSync(path.join(p.dir, 'package.json'), 'utf8')).contributes.configuration;
    const own = (Array.isArray(c) ? c : c ? [c] : []).flatMap((b) => Object.keys(b.properties || {}));
    if (owner[p.id]) assert.deepStrictEqual(own.filter((k) => !k.startsWith(owner[p.id])), [], `${p.id}: every setting under ${owner[p.id]}`);
  }
  const titles = m.contributes.commands.map((c) => c.title);
  assert.deepStrictEqual(titles.filter((t) => /^(Perch|chirp|jay|kestrel): /.test(t)), []);
});

test('checked-in manifest equals a fresh build', () => {
  const r = spawnSync(process.execPath, [script, '--check'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr || r.stdout);
});

// The host's own settings (each part's switch) are read under the section the manifest declares them in.
test('the host reads its switches under the section the manifest declares', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const declared = new Set(pkg.contributes.configuration.flatMap((c) => Object.keys(c.properties)));
  for (const p of readParts(root)) assert.ok(declared.has(`agenticWorks.${p.id}.enabled`), `agenticWorks.${p.id}.enabled is declared`);
  for (const f of ['extension.js', 'getStarted.js']) {
    const text = fs.readFileSync(path.join(root, 'src', f), 'utf8');
    assert.ok(text.includes("getConfiguration('agenticWorks')"), `src/${f} reads the agenticWorks section`);
  }
  assert.match(fs.readFileSync(path.join(root, 'src', 'getStarted.js'), 'utf8'), /WATCHED_SETTINGS = \['agenticWorks',/);
});

// Open Settings filters on the extension's real id, or the settings page opens empty.
test('Open Settings filters on the real extension id', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const text = fs.readFileSync(path.join(root, 'src', 'extension.js'), 'utf8');
  const m = text.match(/registerCommand\('agenticWorks\.openSettings',[^\n]*'@ext:([^']+)'/);
  assert.ok(m, 'agenticWorks.openSettings opens the settings with an @ext: filter');
  assert.strictEqual(m[1], `${pkg.publisher}.${pkg.name}`);
});

let failed = 0;
for (const { name, fn } of tests) {
  try {
    fn();
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${e.message}`);
  }
}
if (failed) {
  console.log(`manifest.test.js: ${failed}/${tests.length} failed`);
  process.exit(1);
}
console.log(`manifest.test.js passed (${tests.length} tests)`);
