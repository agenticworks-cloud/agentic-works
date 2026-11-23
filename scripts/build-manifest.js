#!/usr/bin/env node
'use strict';
// Builds Roost's root package.json from roost.json and every parts/<name>/ (its part.json and package.json).
// `node scripts/build-manifest.js` writes package.json; `--check` exits 1 if package.json differs from a fresh build.
const fs = require('node:fs');
const path = require('node:path');

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => JSON.parse(JSON.stringify(v));

// Parts in folder-name order; each is { name, part, pkg }.
function readParts(root) {
  const dir = path.join(root, 'parts');
  const names = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  const parts = names.map((name) => {
    const partFile = path.join(dir, name, 'part.json');
    if (!fs.existsSync(partFile)) throw new Error(`parts/${name} has no part.json`);
    const pkgFile = path.join(dir, name, 'package.json');
    if (!fs.existsSync(pkgFile)) throw new Error(`parts/${name} has no package.json`);
    return { name, part: readJson(partFile), pkg: readJson(pkgFile) };
  });
  const byId = new Map();
  for (const p of parts) {
    if (byId.has(p.part.id)) throw new Error(`parts/${byId.get(p.part.id).name} and parts/${p.name} have the same id ${p.part.id}`);
    byId.set(p.part.id, p);
  }
  for (const p of parts) {
    for (const need of p.part.needs || []) {
      if (!byId.has(need)) throw new Error(`parts/${p.name} needs ${need}, which names no part`);
    }
  }
  return parts;
}

// Records which part declared each id of a kind; the same id in two parts throws.
function idRegistry() {
  const seen = new Map();
  return (kind, id, owner) => {
    const key = `${kind}\0${id}`;
    const first = seen.get(key);
    if (first !== undefined && first !== owner) throw new Error(`duplicate ${kind} id ${id} in parts ${first} and ${owner}`);
    seen.set(key, owner);
  };
}

// A part's contributed paths are relative to its folder; the root manifest needs them relative to the root.
const PATH_KEYS = new Set(['icon', 'path', 'image', 'markdown', 'svg', 'light', 'dark']);
const isRelativePath = (s) => typeof s === 'string' && s !== '' && !s.startsWith('$(') && !/^[a-z][a-z0-9+.-]*:/i.test(s) && !path.isAbsolute(s);

// Settings and their defaults are values, not paths, so they are left alone.
const NO_PATHS = new Set(['configuration', 'configurationDefaults']);
// Contribution points this script knows how to merge, gate and rewrite. A part contributing another one
// fails the build, so adding it here is a decision (does it need a `when`? does it carry paths?).
const KNOWN_POINTS = new Set([...NO_PATHS, 'commands', 'keybindings', 'menus', 'views', 'viewsContainers']);
// Fields the script generates; roost.json setting them would be overwritten silently.
const GENERATED = ['main', 'activationEvents', 'contributes', 'dependencies', 'extensionPack'];

function rewritePaths(value, prefix) {
  if (Array.isArray(value)) return value.map((v) => rewritePaths(v, prefix));
  if (!isObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = PATH_KEYS.has(k) && isRelativePath(v) ? path.posix.join(prefix, v) : rewritePaths(v, prefix);
  }
  return out;
}

function partContributes(contributes, prefix) {
  const out = {};
  for (const [k, v] of Object.entries(contributes)) {
    if (!KNOWN_POINTS.has(k)) throw new Error(`${prefix} contributes ${k}, which build-manifest.js does not know`);
    out[k] = NO_PATHS.has(k) ? clone(v) : rewritePaths(v, prefix);
  }
  return out;
}

const withSwitch = (entry, key) => ({ ...entry, when: entry.when ? `${key} && (${entry.when})` : key });

// Arrays concatenate, objects merge key by key, equal scalars agree; anything else is a conflict.
function merge(into, from, where) {
  for (const [k, v] of Object.entries(from)) {
    const at = `${where}.${k}`;
    if (!(k in into)) into[k] = clone(v);
    else if (Array.isArray(into[k]) && Array.isArray(v)) into[k].push(...clone(v));
    else if (isObject(into[k]) && isObject(v)) merge(into[k], v, at);
    else if (JSON.stringify(into[k]) !== JSON.stringify(v)) throw new Error(`conflicting values for ${at}`);
  }
}

function buildManifest(root) {
  const roost = readJson(path.join(root, 'roost.json'));
  for (const field of GENERATED) {
    if (field in roost) throw new Error(`roost.json sets ${field}, which is generated from the parts`);
  }
  const parts = readParts(root);
  const claim = idRegistry();

  const switches = {};
  for (const { part } of parts) {
    const key = `roost.${part.id}.enabled`;
    claim('configuration property', key, 'roost');
    switches[key] = { type: 'boolean', default: true, description: `${part.title}: switch this part on or off.` };
  }
  const properties = { ...switches };
  const contributes = {};
  const activationEvents = ['onStartupFinished'];
  const dependencies = {};
  const dependencyOwner = {};
  const extensionPack = [];

  for (const { name, part, pkg } of parts) {
    const key = `roost.${part.id}.enabled`;
    const own = partContributes(pkg.contributes || {}, `parts/${name}`);

    for (const c of own.commands || []) claim('command', c.command, name);
    for (const [where, views] of Object.entries(own.views || {})) {
      own.views[where] = views.map((v) => {
        claim('view', v.id, name);
        return withSwitch(v, key);
      });
    }
    // viewsContainers keep no `when`: VS Code ignores it there and hides a container whose views are all hidden.
    for (const containers of Object.values(own.viewsContainers || {})) {
      for (const c of containers) claim('view container', c.id, name);
    }
    // A command shows in the Command Palette unless a commandPalette entry hides it, so each command
    // without one gets an entry; then every menu entry is wrapped with the switch.
    const palette = (own.menus || {}).commandPalette || [];
    for (const { command } of own.commands || []) {
      if (!palette.some((e) => e.command === command)) palette.push({ command });
    }
    if (palette.length) own.menus = { ...own.menus, commandPalette: palette };
    for (const [where, entries] of Object.entries(own.menus || {})) {
      own.menus[where] = entries.map((e) => withSwitch(e, key));
    }
    if (own.keybindings) own.keybindings = own.keybindings.map((k) => withSwitch(k, key));
    if (own.configuration !== undefined) {
      const blocks = Array.isArray(own.configuration) ? own.configuration : [own.configuration];
      for (const block of blocks) {
        for (const [prop, schema] of Object.entries(block.properties || {})) {
          claim('configuration property', prop, name);
          properties[prop] = schema;
        }
      }
      delete own.configuration;
    }
    merge(contributes, own, `parts/${name} contributes`);

    for (const ev of pkg.activationEvents || []) {
      if (ev.startsWith('onWebviewPanel:')) claim('webview type', ev.slice('onWebviewPanel:'.length), name);
      if (!activationEvents.includes(ev)) activationEvents.push(ev);
    }
    for (const [dep, version] of Object.entries(pkg.dependencies || {})) {
      if (dep in dependencies && dependencies[dep] !== version) {
        throw new Error(`dependency ${dep}: ${dependencies[dep]} in parts/${dependencyOwner[dep]}, ${version} in parts/${name}`);
      }
      dependencies[dep] = version;
      dependencyOwner[dep] = dependencyOwner[dep] || name;
    }
    for (const ext of pkg.extensionPack || []) if (!extensionPack.includes(ext)) extensionPack.push(ext);
  }
  contributes.configuration = { title: 'Roost', properties };

  const manifest = { ...roost, main: './src/extension.js', activationEvents, contributes };
  const depNames = Object.keys(dependencies).sort();
  if (depNames.length) manifest.dependencies = Object.fromEntries(depNames.map((d) => [d, dependencies[d]]));
  if (extensionPack.length) manifest.extensionPack = extensionPack;
  return manifest;
}

const render = (manifest) => `${JSON.stringify(manifest, null, 2)}\n`;

function main(argv) {
  const root = path.join(__dirname, '..');
  const file = path.join(root, 'package.json');
  const fresh = render(buildManifest(root));
  if (argv.includes('--check')) {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current !== fresh) {
      process.stderr.write('package.json is stale: run `make manifest`\n');
      return 1;
    }
    return 0;
  }
  fs.writeFileSync(file, fresh);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { buildManifest };
