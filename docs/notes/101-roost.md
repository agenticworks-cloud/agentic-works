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
`git subtree add` from its `main` (kestrel's `master`), keeping full history, under its own folder:

```
roost/
  package.json          the one manifest: every contribution of the four, merged; extensionPack from Perch
  src/extension.js      Roost's activate: starts the enabled parts, starts/stops them on setting changes
  perch/  chirp/  jay/  kestrel/      the four, as imported (src/, media/, test/, docs/)
  docs/notes/           Roost's own notes (this is 101); Perch's come along in perch/docs/notes
  Makefile              test = each part's tests; install / package / publish for seanahn.roost
```

After the import, development happens in Roost; nothing is synced back. *(Sean: the four are retired eventually.)*
**Before the import:** Perch's `feat/phase-green` and chirp's `attachment-note` land on their `main`. *(Sean)*
Perch's stale `fix/gateway-opus-thinking-effort` (2026-10-23) stays behind.

### One manifest, ids unchanged

Roost's `package.json` holds the union of the four `contributes` blocks with **every id kept**: `perch.*`,
`chirp.*`, `jay.*`, `kestrel.*` settings and commands, the `perch`, `chirp` and `jay` activity-bar containers and
the `kestrel` panel container, the webview types (`perch.session`, `chirp.conversation`, `jay.ticket`,
`jay.page`). So the user's settings keep working and the C3 installer's activity-bar layout (c3securitytools'
note 802) does not change. Activation events are the union. Perch's npm dependencies (the Claude Agent SDK and the Codex SDK) move into Roost's `package.json` and
`.vsix`; Perch's code finds them from `perch/` through Node's normal lookup. Perch's `extensionPack` (perch-audio, Claude Code,
ChatGPT) carries over: perch-audio stays a separate companion, since it must run on the user's own machine
when VS Code is attached to a remote. *(my call)*

### Parts, and switching them

Four settings, all `true` by default: `roost.perch.enabled`, `roost.teams.enabled`, `roost.jira.enabled`,
`roost.prs.enabled`. *(names: my call)*

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
not part of this project.

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
the others' `make test`), plus Roost's own tests: the merged manifest (no duplicate ids; every view and menu of
a part carries its `when`), starting and stopping parts, and isolation. `make package` builds one
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
    |-- git subtree add --prefix=perch main --------->|                              |
    |-- … chirp, jay, kestrel (master) -------------->|                              |
    |                                                 |-- merge manifests (+ Perch's npm deps), Roost src, Makefile
    |                                                 |-- npm install; make test (all parts, local)
    |                                                 |   [a test fails: fix in Roost before the first push]
    |                                                 |-- push ----------------------------->|
```

## Left to the builder

- How the merged `package.json` is produced (by hand once, or a script that checks it against the four).
- Where each part's media lives and how its asset paths are resolved under `<part>/` (29 uses of
  `extensionUri`/`asAbsolutePath` across chirp, jay and kestrel).
- Whether each part's `vscodeStub.js` / `test/stubs.js` stays separate or is shared.

## Verification

- `make test` green; a fresh window with Roost and none of the four standalone extensions shows the Perch,
  Teams and Jira & Confluence icons and the PRs panel tab; each part works as its standalone did.
- Turning each part off hides its icon or tab and its commands at once, and stops its polling; turning it on
  brings it back without a reload.
- A part made to throw at start leaves the other three working, with one notification.
- `git log -- perch/src/extension.js` in Roost shows Perch's full history.
