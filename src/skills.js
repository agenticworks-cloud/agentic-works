'use strict';
// Skills: the company file's agent skills (company.skills), each a folder holding SKILL.md, copied to Claude Code's
// skills folder (~/.claude/skills/<id>/) and the one Codex reads (~/.agents/skills/<id>/). What Agentic Works copied is
// recorded in ~/.config/agentic-works/skills.json (each file's SHA-256 and whether it is executable), so a later pass can tell
// its own copy from one the user edited: it replaces or removes only a copy still as it left it. A copy that already
// matches the source is Agentic Works' whatever the record says (a pass cut short, or another window's). A skill dropped from
// the company file is removed. A folder of the same name that Agentic Works never wrote is the user's and is never touched.
// One pass at a time across windows: a lock file beside the record.
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TARGETS = ['.claude/skills', '.agents/skills'];
const RECORD = '.config/agentic-works/skills.json';
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;   // as company.js checks it
const MAX_ENTRIES = 200;
const MAX_BYTES = 1024 * 1024;
const LOCK_STALE_MS = 60 * 1000;

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const exists = (p) => { try { fs.lstatSync(p); return true; } catch (e) { return false; } };

class Unusual extends Error {}

// A folder's files, by path relative to it (with /): { data, exec }. A link or special file in it throws Unusual
// (a source with one isn't used; a copy with one counts as edited). Sizes are checked before anything is read.
function readTree(dir) {
  const files = new Map();
  let bytes = 0;
  let entries = 0;
  const walk = (d, rel) => {
    for (const name of fs.readdirSync(d)) {
      if (++entries > MAX_ENTRIES) throw new Error(`more than ${MAX_ENTRIES} files and folders`);
      const r = rel ? `${rel}/${name}` : name;
      const full = path.join(d, name);
      const st = fs.lstatSync(full);
      if (st.isDirectory()) walk(full, r);
      else if (st.isFile()) {
        bytes += st.size;
        if (bytes > MAX_BYTES) throw new Error(`more than ${MAX_BYTES} bytes`);
        const fd = fs.openSync(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
        try { files.set(r, { data: fs.readFileSync(fd), exec: (st.mode & 0o111) !== 0 }); } finally { fs.closeSync(fd); }
      } else throw new Unusual(`${r} is a link or special file`);
    }
  };
  walk(dir, '');
  return files;
}

const hashes = (files) => Object.fromEntries([...files].map(([r, f]) => [r, (f.exec ? 'x:' : '') + sha(f.data)]).sort(([a], [b]) => (a < b ? -1 : 1)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// What is at `dir`: null (nothing), or its hashes; a link, a file, or anything unusual inside is 'other'.
function look(dir) {
  if (!exists(dir)) return null;
  if (!fs.lstatSync(dir).isDirectory()) return 'other';
  try { return hashes(readTree(dir)); } catch (e) { return 'other'; }
}

function writeTree(dir, files) {
  const tmp = path.join(path.dirname(dir), `.${path.basename(dir)}.agentic-works-${process.pid}-${Date.now()}`);
  try {
    for (const [r, f] of files) {
      const to = path.join(tmp, ...r.split('/'));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.writeFileSync(to, f.data, { mode: f.exec ? 0o755 : 0o644 });
    }
    if (!files.size) fs.mkdirSync(tmp, { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.renameSync(tmp, dir);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The record, with anything malformed in it dropped (a hand-edited or merged file must not stop every later pass).
function readRecord(file) {
  let r;
  try { r = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { skills: {} }; }
  const out = { skills: {} };
  const skills = r && typeof r.skills === 'object' && r.skills && !Array.isArray(r.skills) ? r.skills : {};
  for (const [id, v] of Object.entries(skills)) {
    if (!ID.test(id) || !v || typeof v.targets !== 'object' || !v.targets) continue;
    const targets = {};
    for (const t of TARGETS) {
      const h = v.targets[t];
      if (h && typeof h === 'object' && !Array.isArray(h) && Object.values(h).every((x) => typeof x === 'string')) targets[t] = h;
    }
    if (Object.keys(targets).length) out.skills[id] = { targets };
  }
  return out;
}

function writeRecord(file, record) {
  const tmp = `${file}.${process.pid}-${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

// The lock: made with O_EXCL; one older than LOCK_STALE_MS is a pass that died, and is taken over.
function lock(file) {
  for (let i = 0; i < 2; i++) {
    try {
      fs.closeSync(fs.openSync(file, 'wx', 0o600));
      return true;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try { if (Date.now() - fs.statSync(file).mtimeMs > LOCK_STALE_MS) { fs.rmSync(file, { force: true }); continue; } } catch (_) { continue; }
      return false;
    }
  }
  return false;
}

/**
 * One pass: every skill in `skills` copied where it isn't yet or is out of date, every recorded one no longer listed
 * removed. Returns { installed, updated, removed, kept } (lines "<id> in ~/<folder>"), or { busy: true } while another
 * window's pass runs; logs each change and each copy left alone.
 */
function syncSkills(skills, { home = os.homedir(), log = () => {} } = {}) {
  const recordFile = path.join(home, RECORD);
  const out = { installed: [], updated: [], removed: [], kept: [] };
  if (!skills.length && !exists(recordFile)) return out;   // nothing to do, and nothing written
  fs.mkdirSync(path.dirname(recordFile), { recursive: true, mode: 0o700 });
  const lockFile = `${recordFile}.lock`;
  if (!lock(lockFile)) { log('Skills: another window is setting them up; left to it'); return { ...out, busy: true }; }
  try {
    const record = readRecord(recordFile);
    const save = () => writeRecord(recordFile, record);   // after each change, so a pass cut short loses none
    const wanted = new Set(skills.map((s) => s.id));

    for (const s of skills) {
      let files;
      try {
        if (!fs.statSync(s.source).isDirectory()) throw new Error('not a folder');
        files = readTree(s.source);
        if (!files.has('SKILL.md')) throw new Error('no SKILL.md in it');
      } catch (e) {
        log(`Skills: ${s.id}: ${s.source} can't be used (${e.message}); left as it is`);
        continue;
      }
      const want = hashes(files);
      for (const t of TARGETS) {
        const dir = path.join(home, t, s.id);
        const at = `${s.id} in ~/${t}`;
        const entry = record.skills[s.id] || (record.skills[s.id] = { targets: {} });
        const recorded = entry.targets[t];
        const now = look(dir);
        if (now !== null && now !== 'other' && same(now, want)) {
          if (!same(recorded, want)) { entry.targets[t] = want; save(); }   // already as it should be: Agentic Works'
          continue;
        }
        if (now !== null && !(recorded && same(now, recorded))) {
          out.kept.push(at);
          log(recorded ? `Skills: ${at} was edited; left as it is` : `Skills: ${at} wasn't put there by Agentic Works; left as it is`);
          continue;
        }
        try {
          fs.mkdirSync(path.dirname(dir), { recursive: true });
          writeTree(dir, files);
          entry.targets[t] = want;
          save();
          (now === null ? out.installed : out.updated).push(at);
          log(`Skills: ${at} ${now === null ? 'installed' : 'updated'}`);
        } catch (e) {
          log(`Skills: ${at} couldn't be written: ${e.message}`);
        }
      }
      if (!Object.keys(record.skills[s.id].targets).length) { delete record.skills[s.id]; save(); }
    }

    for (const id of Object.keys(record.skills)) {
      if (wanted.has(id)) continue;
      const targets = record.skills[id].targets;
      for (const t of Object.keys(targets)) {
        const dir = path.join(home, t, id);
        const at = `${id} in ~/${t}`;
        const now = look(dir);
        if (now !== null && now !== 'other' && same(now, targets[t])) {
          try {
            fs.rmSync(dir, { recursive: true, force: true });
            out.removed.push(at);
            log(`Skills: ${at} removed (no longer in the company file)`);
          } catch (e) {
            log(`Skills: ${at} couldn't be removed: ${e.message}`);
            continue;   // kept in the record: tried again next pass
          }
        } else if (now !== null) {
          out.kept.push(at);
          log(`Skills: ${at} is no longer in the company file but was edited; left as it is`);
        }
        delete targets[t];
        save();
      }
      if (!Object.keys(targets).length) { delete record.skills[id]; save(); }
    }
    return out;
  } finally {
    fs.rmSync(lockFile, { force: true });
  }
}

module.exports = { syncSkills, TARGETS, RECORD };
