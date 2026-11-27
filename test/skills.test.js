'use strict';
// Skills (src/skills.js): the company file's skills copied to ~/.claude/skills/<id>/ and ~/.agents/skills/<id>/,
// recorded in ~/.config/agentic-works/skills.json; a copy the user edited, or one Agentic Works never wrote, is left alone; a skill
// dropped from the company file is removed.
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncSkills, RECORD } = require('../src/skills');

const temps = [];
process.on('exit', () => temps.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function setup() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentic-works-skills-'));
  temps.push(home);
  const src = path.join(home, 'pkg', 'skills', 'teams');
  fs.mkdirSync(path.join(src, 'refs'), { recursive: true });
  fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: teams\n---\nv1\n');
  fs.writeFileSync(path.join(src, 'refs', 'more.md'), 'more\n');
  const logs = [];
  const sync = (skills) => syncSkills(skills, { home, log: (l) => logs.push(l) });
  return { home, src, logs, sync, skill: [{ id: 'teams', source: src }] };
}
const claude = (s) => path.join(s.home, '.claude', 'skills', 'teams');
const agents = (s) => path.join(s.home, '.agents', 'skills', 'teams');
const read = (f) => fs.readFileSync(f, 'utf8');
const exists = (p) => { try { fs.lstatSync(p); return true; } catch (e) { return false; } };

// installed in both places, recorded; a second pass changes nothing
{
  const s = setup();
  const r = s.sync(s.skill);
  assert.deepStrictEqual(r.installed, ['teams in ~/.claude/skills', 'teams in ~/.agents/skills']);
  assert.strictEqual(read(path.join(claude(s), 'SKILL.md')), '---\nname: teams\n---\nv1\n');
  assert.strictEqual(read(path.join(agents(s), 'refs', 'more.md')), 'more\n');
  const rec = JSON.parse(read(path.join(s.home, RECORD)));
  assert.deepStrictEqual(Object.keys(rec.skills.teams.targets).sort(), ['.agents/skills', '.claude/skills']);
  assert.strictEqual(fs.statSync(path.join(s.home, RECORD)).mode & 0o777, 0o600);
  const again = s.sync(s.skill);
  assert.deepStrictEqual([again.installed, again.updated, again.removed, again.kept], [[], [], [], []]);
}

// a new version replaces Agentic Works' own copy
{
  const s = setup();
  s.sync(s.skill);
  fs.writeFileSync(path.join(s.src, 'SKILL.md'), '---\nname: teams\n---\nv2\n');
  fs.rmSync(path.join(s.src, 'refs'), { recursive: true });
  const r = s.sync(s.skill);
  assert.deepStrictEqual(r.updated, ['teams in ~/.claude/skills', 'teams in ~/.agents/skills']);
  assert.ok(read(path.join(claude(s), 'SKILL.md')).endsWith('v2\n'));
  assert.ok(!fs.existsSync(path.join(claude(s), 'refs')), 'a file gone from the source goes');
}

// a copy the user edited is left alone, even when a new version comes, and isn't removed when dropped
{
  const s = setup();
  s.sync(s.skill);
  fs.appendFileSync(path.join(claude(s), 'SKILL.md'), 'my note\n');
  fs.writeFileSync(path.join(s.src, 'SKILL.md'), '---\nname: teams\n---\nv2\n');
  const r = s.sync(s.skill);
  assert.deepStrictEqual(r.kept, ['teams in ~/.claude/skills']);
  assert.deepStrictEqual(r.updated, ['teams in ~/.agents/skills']);
  assert.ok(read(path.join(claude(s), 'SKILL.md')).endsWith('v1\nmy note\n'), 'the edit stays');
  assert.ok(s.logs.some((l) => l.includes('was edited; left as it is')));
  const gone = s.sync([]);
  assert.deepStrictEqual(gone.removed, ['teams in ~/.agents/skills']);
  assert.deepStrictEqual(gone.kept, ['teams in ~/.claude/skills']);
  assert.ok(fs.existsSync(path.join(claude(s), 'SKILL.md')), 'the edited copy stays');
  assert.ok(!fs.existsSync(agents(s)));
  assert.deepStrictEqual(JSON.parse(read(path.join(s.home, RECORD))).skills, {}, 'no longer Agentic Works\'');
}

// a folder of the same name Agentic Works never wrote is the user's
{
  const s = setup();
  fs.mkdirSync(claude(s), { recursive: true });
  fs.writeFileSync(path.join(claude(s), 'SKILL.md'), 'mine\n');
  const r = s.sync(s.skill);
  assert.deepStrictEqual(r.kept, ['teams in ~/.claude/skills']);
  assert.strictEqual(read(path.join(claude(s), 'SKILL.md')), 'mine\n');
  s.sync([]);
  assert.strictEqual(read(path.join(claude(s), 'SKILL.md')), 'mine\n', 'never removed');
}

// dropped from the company file: an unedited copy is removed
{
  const s = setup();
  s.sync(s.skill);
  const r = s.sync([]);
  assert.deepStrictEqual(r.removed, ['teams in ~/.claude/skills', 'teams in ~/.agents/skills']);
  assert.ok(!fs.existsSync(claude(s)) && !fs.existsSync(agents(s)));
}

// a source that can't be used changes nothing
{
  const s = setup();
  s.sync(s.skill);
  fs.rmSync(path.join(s.src, 'SKILL.md'));
  const r = s.sync(s.skill);
  assert.deepStrictEqual([r.installed, r.updated, r.removed], [[], [], []]);
  assert.ok(fs.existsSync(path.join(claude(s), 'SKILL.md')));
  assert.ok(s.logs.some((l) => l.includes('no SKILL.md')));
}

// a link in the source: the skill isn't used (never followed, never installed incomplete)
{
  const s = setup();
  fs.writeFileSync(path.join(s.home, 'secret'), 'x');
  fs.symlinkSync(path.join(s.home, 'secret'), path.join(s.src, 'link.md'));
  const r = s.sync(s.skill);
  assert.deepStrictEqual(r.installed, []);
  assert.ok(!fs.existsSync(claude(s)));
  assert.ok(s.logs.some((l) => l.includes('link.md is a link')));
}

// a copy already as the source has it is Agentic Works', record or not (a pass cut short): recorded, so later removable
{
  const s = setup();
  s.sync(s.skill);
  fs.rmSync(path.join(s.home, RECORD));
  const r = s.sync(s.skill);
  assert.deepStrictEqual([r.installed, r.kept], [[], []]);
  assert.deepStrictEqual(s.sync([]).removed, ['teams in ~/.claude/skills', 'teams in ~/.agents/skills']);
}

// a malformed record is mended, not fatal
{
  const s = setup();
  fs.mkdirSync(path.dirname(path.join(s.home, RECORD)), { recursive: true });
  fs.writeFileSync(path.join(s.home, RECORD), JSON.stringify({ skills: { teams: null, '../x': { targets: { '.claude/skills': {} } }, other: { targets: 7 } } }));
  assert.deepStrictEqual(s.sync(s.skill).installed.length, 2);
  assert.deepStrictEqual(Object.keys(JSON.parse(read(path.join(s.home, RECORD))).skills), ['teams']);
}

// a link the user added inside Agentic Works' copy counts as an edit: never deleted
{
  const s = setup();
  s.sync(s.skill);
  fs.symlinkSync('/tmp', path.join(claude(s), 'mine'));
  const r = s.sync([]);
  assert.deepStrictEqual(r.kept, ['teams in ~/.claude/skills']);
  assert.ok(exists(path.join(claude(s), 'mine')));
}

// an executable file stays executable, and losing the bit is an edit
{
  const s = setup();
  fs.writeFileSync(path.join(s.src, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
  s.sync(s.skill);
  assert.ok(fs.statSync(path.join(claude(s), 'run.sh')).mode & 0o100);
  fs.chmodSync(path.join(claude(s), 'run.sh'), 0o644);
  assert.deepStrictEqual(s.sync([]).kept, ['teams in ~/.claude/skills']);
}

// another window's pass holds the lock: nothing done; a stale lock is taken over
{
  const s = setup();
  const lockFile = `${path.join(s.home, RECORD)}.lock`;
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, '');
  assert.strictEqual(s.sync(s.skill).busy, true);
  assert.ok(!fs.existsSync(claude(s)));
  const old = new Date(Date.now() - 120000);
  fs.utimesSync(lockFile, old, old);
  assert.strictEqual(s.sync(s.skill).installed.length, 2);
  assert.ok(!fs.existsSync(lockFile), 'released');
}

// no leftovers beside the copies
{
  const s = setup();
  s.sync(s.skill);
  assert.deepStrictEqual(fs.readdirSync(path.join(s.home, '.claude', 'skills')), ['teams']);
}

// no skills and nothing recorded: no record file is written
{
  const s = setup();
  s.sync([]);
  assert.ok(!fs.existsSync(path.join(s.home, RECORD)));
}

console.log('skills.test.js passed');
