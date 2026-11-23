# 101 — Roost: Perch, chirp, jay and kestrel as one extension

Proposal, 2026-11-23. Written against Perch 0.7.42, chirp 0.2.5, jay 0.2.4, kestrel 0.1.10.

## Intent

Four extensions by the same author already work together: kestrel puts a prompt into a Perch tab, Perch opens
Jira tickets and Confluence pages through jay, and chirp and jay keep the conversation, ticket or page in
front as a file an agent can read. Installing four extensions is already too much for many people: they do not
think at the operating-system level, and finding VS Code plus the right extensions is where they give up, which
is why they pick an editor that is one download. **Roost** is the four as one extension: one thing to install,
and one codebase in which the links between the parts can grow stronger. *(Sean)*

It may stay an extension for good, become a VS Code fork later, or become Perch itself; that is decided after
seeing it work. The extension comes first either way: a fork would ship Roost built in. *(Sean)*

### Goals

- One extension, `seanahn.roost`, in a new repo `seanahn/roost` (local `/git/roost`). *(Sean)*
- Each part — **Perch** (agent tabs), **Teams** (chirp), **Jira & Confluence** (jay), **PRs** (kestrel) — can be
  switched on or off in settings while VS Code runs, with no reload. **All on by default.** *(Sean)*
- A part whose service the user does not use simply does not work for them (Teams with no Microsoft sign-in
  only offers the sign-in) and never gets in the way of the others. *(Sean)*
- Still separate icons: Perch, Teams and Jira & Confluence in the activity bar, PRs as a panel tab. *(Sean)*
- A public product, on the Marketplace in time; C3 engineers get the C3 installer on top. *(Sean)*

### Non-goals

- A VS Code fork (later, if at all).
- Handling a standalone chirp, jay, kestrel or Perch installed alongside: the author is their only user; anyone
  else sorts it out. *(Sean)*
- Retiring the four repos and Marketplace listings: they stay as they are until the author decides. *(Sean)*
- New features or new links between the parts: this project makes them one; stronger links come after.
- Publishing Roost to the Marketplace (its own step, when ready).

### Anti-goals

- A part that fails to start, or a service that is down, taking the other parts with it.
- Renaming settings, commands or views, which would break the user's existing settings and the C3 installer.
- Losing any repo's history.

## What the four look like (recon, 2026-11-23)

| | Perch | jay | chirp | kestrel |
|---|---|---|---|---|
| Source | ~17.7k lines | ~13.4k | ~5.2k | ~4.6k |
| npm dependencies | Claude Agent SDK, Codex SDK | none | none | none |
| Icon / panel | `perch` | `jay` | `chirp` | `kestrel` (panel) |
| Settings / commands | 33 / 33 | 11 / 10 | 3 / 9 | 2 / 2 |
| Entry | `activate(context)` | `activate(context, deps)` | same | same |
| Stored state | globalState, files | SecretStorage, `~/.jay` | SecretStorage, `~/.chirp` | globalState `kestrel.hidden` |

All four are plain JavaScript with no build step, target VS Code `^1.90`, and prefix every setting, command,
view and file with their own name, so **nothing collides**. They talk today through commands (kestrel →
`perch.openPrSession`, `perch.findPrSession`, `perch.notePrMerged`, `perch.insertText`; Perch → `jay.activeIssueFile`,
`jay.activePageFile`, `jay.projectKeys`, `jay.siteUrl`, `jay.openPage`, `jay.openTicket` and jay's page types) and
through files in `~/.chirp` and `~/.jay`.

## How it is made

### The repo

`/git/roost`, pushed to `github.com/seanahn/roost` (public, like Perch). Each repo is imported once with
a temporary clone of its `main` (kestrel's `master`) rewritten with `git filter-repo --to-subdirectory-filter
parts/<name>` and merged with `--allow-unrelated-histories`, keeping full history, under `parts/<name>/`. Commit
SHAs inside Roost differ from the originals'; messages, authors and dates are kept. The layout
is built so that **a future part is one more folder** under `parts/`, with nothing else edited by hand *(Sean)*:

```
roost/
  package.json            GENERATED from the parts (checked in); never edited by hand
  src/                    Roost itself: the part loader, the on/off switches, shared services between parts
  parts/
    perch/    part.json  package.json  src/  media/  test/  docs/     (as imported, plus part.json)
    chirp/    part.json  …
    jay/      part.json  …
    kestrel/  part.json  …
  scripts/build-manifest.js
  docs/notes/             Roost's own notes (this is 101); each part's notes stay in parts/<name>/docs
  Makefile                manifest, test (Roost + every part), install / package / publish for seanahn.roost
```

**`parts/<name>/part.json`** describes a part to Roost:

```json
{ "id": "teams", "title": "Teams", "entry": "src/extension.js", "needs": [] }
```

`id` names its switch (`roost.<id>.enabled`) and context key; `title` is what settings and messages call it;
`entry` exports the part's `activate` (and `deactivate`); `needs` lists parts it cannot work without (none
today: every existing link already tolerates the other part being absent). The part keeps its own
`package.json` for its `contributes` block (and, for Perch, its npm dependencies), as today.

After the import, development happens in Roost; nothing is synced back. *(Sean: the four are retired eventually.)*
**Before the import:** Perch's `feat/phase-green` and chirp's `attachment-note` land on their `main`. *(Sean)*
Perch's stale `fix/gateway-opus-thinking-effort` (2026-10-23) stays behind.

### One manifest, generated, ids unchanged

VS Code reads only a static root `package.json`, so `scripts/build-manifest.js` (`make manifest`) builds it from
the parts: it reads every `parts/*/part.json` and that part's `package.json`, and writes the root manifest with

- the union of the parts' `contributes` blocks, with **every id kept**: `perch.*`, `chirp.*`, `jay.*`,
  `kestrel.*` settings and commands, the `perch`, `chirp` and `jay` activity-bar containers and the `kestrel`
  panel container, the webview types (`perch.session`, `chirp.conversation`, `jay.ticket`, `jay.page`). So the
  user's settings keep working and the C3 installer's activity-bar layout (c3securitytools' note 802) does not
  change;
- `when: roost.<id>.enabled` added to each part's views, view containers and menu entries (combined with any
  `when` the part already has);
- one `roost.<id>.enabled` setting per part, `true` by default, titled from `part.json`;
- the union of activation events and of npm dependencies (Perch's Claude Agent SDK and Codex SDK), which move
  into Roost's `package.json` and `.vsix`; Perch's code finds them through Node's normal lookup from `parts/perch/`;
- Perch's `extensionPack` (perch-audio, Claude Code, ChatGPT). perch-audio stays a separate companion, since it
  must run on the user's own machine when VS Code is attached to a remote. *(my call)*

It **fails** on any id two parts both contribute, on a part without `part.json`, and on a `needs` that names no
part. A test checks that the checked-in manifest equals a fresh build, so a part's change without `make
manifest` fails the tests rather than shipping a stale manifest. Roost's own identity (name, version,
publisher, icon) lives in a small `roost.json` the script starts from. *(my call)*

### Parts, and switching them

One setting per part, all `true` by default: today `roost.perch.enabled`, `roost.teams.enabled`,
`roost.jira.enabled`, `roost.prs.enabled` *(ids: my call)*. Roost's loader finds the parts by reading the
same `part.json` files at runtime, so it has no list of parts to edit either.

- Roost's `activate` starts each enabled part by calling that part's own `activate` with a **context of its own**:
  the real `ExtensionContext`'s fields, but its own `subscriptions` array. Stopping a part disposes that array
  and calls the part's `deactivate` if it has one.
- A setting change starts or stops that part at once.
- Each part's views, view containers and menu entries get `when: roost.<part>.enabled`, a context key Roost
  sets, so a part that is off shows no icon, no panel tab and no commands in the palette or menus.
- **Isolation:** each part's `activate` runs in its own try/catch; a part that throws is reported once (a
  notification with "Show log", and Roost's output channel) and left off for this window; the others run.
- A part's own background work (chirp's and kestrel's pollers, jay's mirror, Perch's timers) must stop with the
  part. Where a part keeps a timer outside its subscriptions today (Perch's `ticketTimer`, `firstStartTimer`,
  cleared only by its own `dispose`), Roost's tests check that stopping the part leaves no timer running.
- **Retry:** switching a part off and on again retries a part that failed to start. While it is failed, its
  context key is false (no icon or commands), whatever the setting says. *(my call)*
- **Switching a part off with tabs open** works like closing the window for that part *(my call)*: its editor
  tabs close, its agents stop, and its own saved tab list is kept, so switching it on again restores them as a
  window reload does. If a Perch turn is running, Roost asks first ("Stop the running turn and close Perch's
  tabs?"); cancelling sets the setting back to on.
- **A part that is off at startup:** Roost still registers that part's webview serializers, so tabs VS Code
  restores for it are not lost: they are closed quietly and the part's saved tab list kept, so switching the
  part on brings them back. *(my call)*
- **Commands of a part that is off** are not registered (the part registers them in its `activate`). A call to
  one from another part, a keybinding or a script fails as a missing command does today when the other
  extension is not installed; existing callers already handle that.
- **Faults while running** are no different from today: the four standalone extensions already share one
  extension host process, so a part that hangs or spins already affects the others. Isolation in this design
  is about start-up and stopping.

### Links between parts, for now

The existing links keep working unchanged, because the commands and files keep their names. Where a part calls
another's command and that part is off, the call already fails softly today (the other extension may not be
installed); that behaviour is kept. Turning those calls into direct in-process calls is the first follow-up,
not part of this project: **shared services** in Roost's `src/` ("the ticket or page in front", "open or find a
PR session", "insert text into an agent's message box"), which a part provides and others use through Roost
rather than by another part's command names. That is where the stronger links grow. *(Sean: stronger links
later; the place for them: my call)*

### Settings, from the explorer

The Perch view is an explorer (Sessions, Skills, MCP, Agents, Commands). Roost adds a way to its settings
there *(Sean)*:

- a **gear** in the view's title bar, and a **Settings** row at the end of the explorer's sections;
- both run `roost.openSettings`, which opens VS Code's Settings filtered to Roost (`@ext:seanahn.roost`): the
  parts' on/off switches first, then every part's own settings (`perch.*`, `chirp.*`, `jay.*`, `kestrel.*`).
  *(the filter and placement: my call)*

The gear and the row belong to Roost, not to the Perch part, so they stay even if Perch's tabs are the only
part switched on; if the Perch part is off, the same command is in the Command Palette as **Roost: Settings**.

### The C3 installer

c3securitytools' installer (note 802) installs the four standalone extensions today. Installing Roost beside them
would make Roost's parts fail to start (the same command ids registered twice). So the installer switches from
the four to `seanahn.roost`, and uninstalls the four, in the same change in which Roost is first published to
the Marketplace — not before. *(my call: release order)*

### State that does not carry over

VS Code keeps an extension's SecretStorage and globalState per extension id, so Roost starts without the
standalone extensions' stored state: **the user signs in to Teams and Jira once more**, and kestrel's hidden-PR
list and Perch's remembered tab state start empty. Files in `~/.chirp`, `~/.jay` and the agents' own session
records are shared and carry over. No migration. *(my call: one sign-in, for one user, is cheaper than
migration code.)*

### Tests and packaging

`make test` runs each part's existing suite from its folder (Perch's `make test-offline` and `make test`,
the others' `make test`), plus Roost's own tests: the manifest (a fresh build equals the checked-in one; no
duplicate ids; every view and menu of a part carries its `when`), starting and stopping parts, and isolation.
Adding a part: its folder with `part.json` under `parts/`, then `make manifest` and `make test`. `make package` builds one
`.vsix`; `make install` symlinks Roost into the extension folders as `seanahn.roost-<version>`, the pattern
Perch uses. Roost starts at version 0.1.0.

## Flows

Activation, and switching a part off:

```
 VS Code              Roost activate            part (e.g. chirp)            settings
    |                       |                          |                         |
    |-- activate ---------->|                          |                         |
    |                       |-- register all parts' webview serializers          |
    |                       |-- read roost.*.enabled ------------------------>   |
    |                       |-- setContext roost.<part>.enabled = true/false     |
    |                       |   [part off: its restored tabs closed quietly, its saved list kept]
    |                       |-- chirp.activate(own context) ->|                  |
    |                       |   [throws: log, notify once, leave off; others go on]
    |                       |<-- ok ----------------------|                      |
    |   ... later, the user turns Teams off ...           |                      |
    |                       |<-- onDidChangeConfiguration ---------------------- |
    |                       |   [Perch with a turn running: ask; cancel → setting back on]
    |                       |-- close its tabs; dispose its subscriptions (commands, pollers), deactivate ->|
    |                       |   [dispose throws: log it, still mark the part off]                         |
    |                       |-- setContext roost.teams.enabled = false           |
    |<-- icon, views, menus hidden (when clauses) -----|  |                      |
    |   ... the user turns Teams on again ...             |                      |
    |                       |-- chirp.activate(new own context) ->| [throws: as at start]
    |                       |-- setContext roost.teams.enabled = true; its saved tabs come back
```

The import:

```
 /git/perch, chirp, jay, kestrel            /git/roost                        github seanahn/roost
    | [phase-green, attachment-note landed on main]   |                              |
    |-- clone; filter-repo → parts/perch; merge ----->|                              |
    |-- … parts/chirp, parts/jay, parts/kestrel ----->|                              |
    |                                                 |-- part.json ×4; Roost src; make manifest (+ npm deps)
    |                                                 |-- npm install; make test (all parts, local)
    |                                                 |   [a test fails: fix in Roost before the first push]
    |                                                 |-- push ----------------------------->|
```

## Settled while planning (2026-11-23)

- Part ids: `perch`, `teams` (chirp), `jira` (jay), `prs` (kestrel); parts are ordered by folder name everywhere.
- A part's context is the real one with its own `subscriptions` and its folder as `extensionUri`, so each
  part's media and webview resource roots resolve under `parts/<name>/`; `globalState`, `workspaceState` and
  `secrets` are shared (every part already prefixes its keys).
- A part may export `confirmStop()`; Roost calls it before stopping the part, and a `false` puts the switch
  back on. Perch implements it (the modal question while a turn runs).
- For a part that is off, Roost registers a serializer for each of its webview types (from its
  `onWebviewPanel:` activation events) that closes restored panels, and removes it before starting the part.
  Where stopping a part today clears its saved tab list (Perch's `dispose` closing the window), a stop keeps it.
- Roost's own contributions (the `roost.openSettings` command and its gear on the Perch view's title) live in
  `roost.contributes.json`, merged by the manifest build. The **Settings** row is in the Perch part's page and
  runs the command; in a standalone Perch the row does nothing visible.
- `make deps / test / test-live / manifest / install / package`; the `.vsix` carries the root `node_modules`
  only; perch-audio is still built and published from `parts/perch/audio` as its own package.

Plan: `docs/superpowers/plans/2026-11-23-roost.md` (deleted when the work merges).

## Follow-ups (after this project)

- **Stronger links** through shared services in `src/` (see *Links between parts, for now*).
- **chirp: a company's own Microsoft app.** chirp signs in with its own built-in app (an unverified publisher),
  which many companies block users from approving. Add `chirp.signIn.clientId` and `chirp.signIn.tenant`
  (default: chirp's app and `organizations`), so the editor sign-in and the sign-in code can use an app the
  company's admins already approved. Today a locked-down company's only route is a token file from another tool.
  *(Sean)*

## Left to the builder

- Where each part's media lives and how its asset paths are resolved under `<part>/` (29 uses of
  `extensionUri`/`asAbsolutePath` across chirp, jay and kestrel).
- Whether each part's `vscodeStub.js` / `test/stubs.js` stays separate or is shared.

## Verification

- `make test` green; a fresh window with Roost and none of the four standalone extensions shows the Perch,
  Teams and Jira & Confluence icons and the PRs panel tab; each part works as its standalone did.
- Turning each part off hides its icon or tab and its commands at once, and stops its polling; turning it on
  brings it back without a reload.
- A part made to throw at start leaves the other three working, with one notification.
- `git log -- parts/perch/src/extension.js` in Roost shows Perch's full history.
- A throwaway fifth part (a folder with `part.json` and one view) appears with its own switch after `make
  manifest`, with no other file edited.
