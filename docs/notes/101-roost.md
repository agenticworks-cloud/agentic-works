# 101 — Roost: Perch, chirp, jay and kestrel as one extension

Built, 2026-11-23 (0.1.0). Written against Perch 0.7.42, chirp 0.2.5, jay 0.2.4, kestrel 0.1.10; imported at Perch
0.7.44. How to build, install and use it: [README.md](../../README.md).

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
- Each part — **Agents** (Perch: Claude Code and Codex tabs), **Teams** (chirp), **Jira & Confluence** (jay), **PRs**
  (kestrel) — can be
  switched on or off in settings while VS Code runs, with no reload. **All on by default.** *(Sean)*
- A part whose service the user does not use simply does not work for them (Teams with no Microsoft sign-in
  only offers the sign-in) and never gets in the way of the others. *(Sean)*
- Still separate icons: Perch, Teams and Jira & Confluence in the activity bar, PRs as a panel tab. *(Sean)*
- A public product, on the Marketplace in time; a company can layer its own installer on top. *(Sean)*

### Non-goals

- A VS Code fork (later, if at all).
- Handling a standalone chirp, jay, kestrel or Perch installed alongside: the author is their only user; anyone
  else sorts it out. *(Sean)*
- Retiring the four repos and Marketplace listings: they stay as they are until the author decides. *(Sean)*
- New features or new links between the parts: this project makes them one; stronger links come after.
- Publishing Roost to the Marketplace (its own step, when ready).

### Anti-goals

- A part that fails to start, or a service that is down, taking the other parts with it.
- Renaming commands or views, which would break keybindings, other parts' calls and any installer's layout.
  *(Settings were renamed after all, on 2026-11-23, with a carry-over of the user's values: see* Renamed parts and
  settings *below.)*
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
parts/<name>` and merged with `--allow-unrelated-histories`, keeping full history, under `parts/<name>/`, so `git
log` and `git blame` work on the `parts/` paths (a first import that left each file with a one-commit log under its
new path was redone this way). Commit
SHAs inside Roost differ from the originals'; messages, authors and dates are kept. The layout
is built so that **a future part is one more folder** under `parts/`, with nothing else edited by hand *(Sean)*:

```
roost/
  package.json            GENERATED from the parts (checked in); never edited by hand
  src/                    Roost itself: the part loader, the on/off switches, shared services between parts
  parts/
    agents/         part.json  package.json  src/  media/  test/  docs/   (imported as parts/perch, plus part.json)
    jira/           part.json  …                                        (parts/jay)
    pull-requests/  part.json  …                                        (parts/kestrel)
    teams/          part.json  …                                        (parts/chirp)
  scripts/build-manifest.js
  docs/notes/             Roost's own notes (this is 101); each part's notes stay in parts/<name>/docs
  Makefile                manifest, test (Roost + every part), install / package / publish for seanahn.roost
```

**`parts/<name>/part.json`** describes a part to Roost:

```json
{ "id": "teams", "title": "Teams", "entry": "src/extension.js", "needs": [] }
```

`id` names its switch (`roost.<id>.enabled`) and the context key `roost.<id>.failed` Roost sets when it fails to start; `title` is what settings and messages call it;
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
  `kestrel.*` commands (the settings were renamed later: *Renamed parts and settings*), the `perch`, `chirp` and `jay` activity-bar containers and the `kestrel`
  panel container, the webview types (`perch.session`, `chirp.conversation`, `jay.ticket`, `jay.page`). So the
  user's settings keep working and an installer's activity-bar layout (which hides and orders containers by id) does not
  change, plus Roost's own `roost.openSettings` from `roost.contributes.json`;
- `when: config.roost.<id>.enabled && !roost.<id>.failed` added to each part's views, menu entries (the Command
  Palette's included) and keybindings, combined with any `when` the part already has (view containers take no
  `when`: VS Code hides one whose views are all hidden);
- one `roost.<id>.enabled` setting per part, `true` by default, titled from `part.json`, collected in a first settings section titled Roost (switches in part order, so they list before everything else), followed by one settings section per part titled from `part.json`, holding that part's own settings;
- the union of activation events and of npm dependencies (Perch's Claude Agent SDK and Codex SDK), which move
  into Roost's `package.json` and `.vsix`; Perch's code finds them through Node's normal lookup from `parts/agents/`;
- Perch's `extensionPack` (perch-audio, Claude Code, ChatGPT). perch-audio stays a separate companion, since it
  must run on the user's own machine when VS Code is attached to a remote. *(my call)*

It **fails** on any id two parts both contribute, on a part without `part.json`, and on a `needs` that names no
part. A test checks that the checked-in manifest equals a fresh build, so a part's change without `make
manifest` fails the tests rather than shipping a stale manifest. Roost's own identity (name, version,
publisher, icon, `extensionKind: ["workspace"]` so it runs beside the code over Remote-SSH, categories AI and Chat)
lives in a small `roost.json` the script starts from. *(my call; extensionKind and categories: build)*

### Parts, and switching them

One setting per part, all `true` by default: today `roost.agents.enabled`, `roost.jira.enabled`,
`roost.pullRequests.enabled`, `roost.teams.enabled` *(ids: my call; `agents`: Sean)*. Roost's loader finds the parts by reading the
same `part.json` files at runtime, so it has no list of parts to edit either.

- Roost's `activate` starts each enabled part by calling that part's own `activate` with a **context of its own**:
  the real `ExtensionContext`'s fields, but its own `subscriptions` array. Stopping a part disposes that array
  and calls the part's `deactivate` if it has one.
- A setting change starts or stops that part at once.
- Each part's views, menu entries and keybindings get `when: config.roost.<id>.enabled && !roost.<id>.failed`,
  so a part that is off shows no icon, no panel tab and no commands in the palette or menus. The setting half is
  there from the window's first frame, so a part that is on shows its icon at once and a restored sidebar stays;
  Roost sets only `roost.<id>.failed`. A part that is on but still starting shows its icon a moment before its
  views work, as a standalone extension does.
- **Isolation:** each part's `activate` runs in its own try/catch; a part that throws is reported once (a
  notification with "Show log", and Roost's output channel) and left off for this window; the others run.
- A part's own background work (chirp's and kestrel's pollers, jay's mirror, Perch's timers) must stop with the
  part. Where a part keeps a timer outside its subscriptions today (Perch's `ticketTimer`, `firstStartTimer`,
  cleared only by its own `dispose`), Roost's tests check that stopping the part leaves no timer running.
- **Parts start side by side** (`Promise.allSettled`), and Roost's `activate` does not wait for them, so one part
  that hangs holds up neither the others nor Roost. A start or stop that fails is logged and that part's later
  switches still run.
- **Retry:** switching a part off and on again retries a part that failed to start. From a failed start until
  the next good one, `roost.<id>.failed` is true (no icon or commands), whatever the setting says. *(my call)*
- **Switching a part off with tabs open** works like closing the window for that part *(my call)*: its editor
  tabs close, its agents stop, and its own saved tab list is kept, so switching it on again restores them as a
  window reload does. Before stopping a part Roost calls its `confirmStop()` if it exports one; `false` puts the
  setting back on, at the scope it was changed in. Perch's asks while a turn runs ("Stop the running turn and
  close Perch's tabs?"). chirp and jay kept no tab list of their own before Roost, so both got one in the build:
  the open conversations (with their titles), tickets and pages, in `workspaceState`; their `confirmStop()` only
  marks the stop as a switch-off, so their tabs close and stay listed. On start they reopen, after a 4-second wait
  for VS Code's own restore, any listed tab VS Code did not bring back; a listed tab that was never shown and that
  the user closes is forgotten.
- **A part that is off at startup:** Roost still registers that part's webview serializers, so tabs VS Code
  restores for it are not lost: they are closed quietly and the part's saved tab list kept, so switching the
  part on brings them back. *(my call)* Roost also tracks every serializer a part registers itself, by webview
  type, and removes it when the part stops or fails, so a part that threw after registering one (jay registers
  its outside its subscriptions) can be retried without "already registered".
- **Commands of a part that is off** are not registered (the part registers them in its `activate`). A call to
  one from another part, a keybinding or a script fails as a missing command does today when the other
  extension is not installed; existing callers already handle that.
- **Faults while running** are no different from today: the four standalone extensions already share one
  extension host process, so a part that hangs or spins already affects the others. Isolation in this design
  is about start-up and stopping.

### First start

On its very first activation Roost opens, once: the PRs tab (`workbench.view.extension.kestrel`, kestrel's panel
container), so the bottom panel, closed on a fresh profile, shows it; the walkthrough (below); and last the side bar
on Perch's view (`workbench.view.extension.perch`, while Agents is on), since a fresh window can start with the side
bar closed and, with the activity bar on top, the part icons are then hidden with it *(Sean, after the first
installer run, 2026-11-24)*. Opened first, the Perch view gave way to Explorer in that run, so it goes last. It runs after the parts have started, is not
awaited by `activate`, and has no setting. Whatever happens (PRs off or failed, the command failing, which is
logged to the Roost output channel) `roost.firstStart.done` is then recorded in the base context's `globalState`,
so it never happens again. The Agents part's own `agents.firstStart.openClaudeTab` (was `perch.…`) stays separate, for installers. It opens the one tab of the agent that can answer *(Sean, 2026-11-24)*: a Claude tab on the gateway when the gateway file is usable (a base URL and a token), else a Claude tab when Claude is signed in (a login or an API key), else a Codex tab when Codex is (its `auth.json`, or an API key), else a Claude tab, which offers the sign-in; placed as before, beside the walkthrough, 70/30. The setting keeps its name (Agents' note 203).

After the PRs tab, the same first start opens Roost's walkthrough, **Get started with Roost**
(`workbench.action.openWalkthrough`, `seanahn.roost#roost.getStarted`); a failure is logged like the PRs tab's. The
walkthrough is Roost's own (`contributes.walkthroughs` in roost.contributes.json, the one contribution point only
Roost may use), so it also sits on VS Code's Welcome page, and **Roost: Get Started** opens it again. Its steps, each
shown only while its part is switched on and started (`when: config.roost.<id>.enabled && !roost.<id>.failed`; Connect
your tools only with a company file that lists MCP servers, `when: roost.companyTools`), have a button and a short
page (media/walkthrough/*.md). Their text is static: whatever depends on the company file is in a panel, not a step.
In order:

| Step | Button | Done when |
|---|---|---|
| Connect Claude | Connect Claude (Agents: Connect Claude…, a panel of the ways Claude can run: the company's gateway or an LLM gateway, a Claude subscription, an Anthropic API key, AWS Bedrock, Codex only), or Not Now (`roost.connectClaudeNotNow`, hidden from the palette) | Claude is connected (`perch.claudeConnected`), or Not Now runs. It replaced 0.3's Use an LLM gateway (optional) step and its `roost.gatewayNotNow` *(0.4)* |
| Talk to Claude or Codex | New Claude Tab, New Codex Tab (opened beside the walkthrough, 70/30) | a message is sent from any tab (`perch.messageSent`) *(Sean, 2026-11-24: Roost's installer no longer opens a tab on first start; the user opens the one they want here; either agent works, and the page says how each signs in)* |
| Connect your tools (only with `roost.companyTools`) | Roost: Connect Your Tools (a panel, `roost.tools`, one row per MCP server in the company file, each signed in its own way and checked, then registered with Claude Code at user scope; with no servers the command says "Your company file lists no tools."), or Not Now (`roost.toolsNotNow`, hidden) | every row is connected (`roost.toolsConnected`, which Roost sets after each change of a row: its check passed and Claude Code was given it), or Not Now runs *(0.4)* |
| Search your code (optional) | Roost: Turn On Codebase Search, or Not Now | either runs; on goes through Agents: Toggle Codebase Search (which checks for a Python) and never turns it off; the installer leaves it off *(Sean, 2026-11-24)* |
| Sign in to Teams | Sign In to Teams (`roost.teamsSignIn`, hidden): with a company file and a tools row whose `doneWhen.file` is the expanded `teams.signIn.tokenFile`, the Connect Your Tools panel opens and runs that row's sign-in (unless it is connected already); else Teams: Sign In (`chirp.signIn`) | Teams is signed in (`chirp.signedIn`): chirp watches its token file, so a tools row's sign-in ticks it by itself |
| Connect Jira and Confluence | Connect Jira (`roost.jiraSignIn`, hidden: the matching tools row for `jira.signIn.tokenFile` as Teams does, else Jira: Sign In, `jay.signIn`, which opens the Jira view, whose sign-in form asks for the site URL, email and API token, with a Create one link to Atlassian's API tokens page) | Jira is signed in (`jay.signedIn`) *(Sean, 2026-11-24: no input box at the top)* |
| Sign in to GitHub | Roost: Sign In to GitHub | gh has a login (`kestrel.signedIn`). The button opens a terminal running `gh auth login --hostname github.com && exit`; when that terminal closes Roost runs `kestrel.refresh` (a failure, the PRs part being off, is ignored), so the PRs tab and the step pick up the login at once, not at kestrel's 30 s retry |
| Choose your parts | Roost: Settings | that command runs |

"Done" follows VS Code's own completion events. The Choose your parts step, and Search your code's two buttons, are
ticked when their command runs (`onCommand:`); the agents step when a message is sent, Connect Claude when Claude is
connected, Connect your tools when every tool is (`onContext:`), or their Not Now. The three sign-in steps are ticked only once that part is actually signed in (`onContext:`): each
part sets its own context key, in its own namespace so it still works as an extension of its own, true when signed
in and false when signed out or stopped, and sends it only when it changes. chirp sets `chirp.signedIn` when a login
works and clears it when signed out; jay sets `jay.signedIn` while it runs with a sign-in; kestrel sets
`kestrel.signedIn` when gh lists a login and clears it when gh has none. *(Sean's first-time-user test, 2026-11-24:
with `onCommand:` the Teams step was ticked although the Microsoft sign-in had been abandoned.)* The pages say what
each sign-in does, for a first-time user. The step for Choose your parts has no `when`.

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
  parts' on/off switches first, then every part's own settings (`agents.*`, `jira.*`, `pullRequests.*`, `teams.*`).
  *(the filter and placement: my call)*

The gear and the row belong to Roost, not to the Perch part, so they stay even if Perch's tabs are the only
part switched on; if the Perch part is off, the same command is in the Command Palette as **Roost: Settings**.

### Installers that set up the four today

An installer that installs the four standalone extensions today must switch to Roost. Installing Roost beside them
would make Roost's parts fail to start (the same command ids registered twice). So such an installer switches from
the four to `seanahn.roost`, and uninstalls the four, when Roost's first GitHub release exists — not before (Roost
ships through GitHub releases for now; note [102](102-roost-installer.md)). *(my call: release order)*

### State that does not carry over

VS Code keeps an extension's SecretStorage and globalState per extension id, so Roost starts without the
standalone extensions' stored state: **the user signs in to Teams and Jira once more**, and kestrel's hidden-PR
list and Perch's remembered tab state start empty. Files in `~/.chirp`, `~/.jay` and the agents' own session
records are shared and carry over. No migration of that state. (Settings are shared by every extension, so the
standalone ones' `perch.*`, `chirp.*`, `jay.*`, `kestrel.*` values are there for Roost; since the rename each part
copies them to its new keys once: *Renamed parts and settings*.) *(my call: one sign-in, for one user, is cheaper than
migration code.)*

### Keybindings

A part's keybindings carry the same `when` as its views and commands, so a chord stays unbound while its part is
off. *(build)*

### Tests and packaging

`make test` runs each part's existing suite from its folder (Perch's `make test-offline` and `make test`,
the others' `make test`), plus Roost's own tests: the manifest (a fresh build equals the checked-in one; no
duplicate ids; every view and menu of a part carries its `when`), starting and stopping parts, and isolation.
Adding a part: its folder with `part.json` under `parts/`, then `make manifest` and `make test`. `make package` builds one
`.vsix`; `make install` symlinks Roost into the extension folders as `seanahn.roost-<version>`, the pattern
Perch uses. Roost starts at version 0.1.0. `make deps` runs `npm ci` against the checked-in root lockfile, then in
each part. The package test (`make test-package`, which packages first) is outside `make test`, which must not need
a built artifact.

vsce reads only the root `.vscodeignore`, so Perch's exclusions moved there: the agents' platform programs (the
Claude Agent SDK's and Codex's per-platform packages, hundreds of megabytes; Perch runs the ones inside the
vendors' own extensions), source maps, Markdown, lockfiles, tests, docs, `__pycache__`, Perch's audio companion,
and the files only the manifest build reads (`roost.json`, `roost.contributes.json`, `.gitignore`). Excluding
`node_modules/**/*.md` also dropped licence files (the Claude Agent SDK's licence is its README), so scoped `!`
lines bring every dependency's `LICENSE*`/`LICENCE*` back without re-including the agents' programs. The `.vsix`
went from 495 MB to 10 MB; the package test checks the exclusions, the licence files and a size under 20 MB.
The root `LICENSE` is MIT (Sean Ahn, 2026), as each part's is.

### Renamed parts and settings (2026-11-23)

Built as 0.1.0, the parts kept their standalone names. Then *(Sean, 2026-11-23)*:

| folder (was) | part id | settings | Command Palette titles |
|---|---|---|---|
| `parts/agents` (`parts/perch`) | `agents` (was `perch`; switch `roost.agents.enabled`) | `perch.*` → `agents.*` | "Perch: …" → "Agents: …" |
| `parts/teams` (`parts/chirp`) | `teams` | `chirp.*` → `teams.*` | "chirp: …" → "Teams: …" |
| `parts/jira` (`parts/jay`) | `jira` | `jay.*` → `jira.*` | "jay: …" → "Jira: …" |
| `parts/pull-requests` (`parts/kestrel`) | `pullRequests` | `kestrel.*` → `pullRequests.*` | "kestrel: …" → "Pull Requests: …" |

The folders moved with `git mv`, so `git log --follow` and `git blame` reach back through the import. Part titles
stay, but for Agents: "Agents (Claude Code and Codex)". Folder order is now agents, jira, pull-requests, teams, so
the switches and settings sections list in that order. **Unchanged:** command ids, view and container ids, webview
types, context keys, globalState and secret keys, `~/.chirp` and `~/.jay`: users never see them, and the links
between the parts and the installers' layout depend on them.

**Carry-over.** Each part, at activation, copies the user's values from the old keys to the new: for each of its
settings and each scope (user, workspace, every workspace folder), if the new key has no value at that scope and
the old key has one, the old value is written to the new key at that scope; the old key is left. Then the part
records `<new prefix>.settingsCarriedOver` in globalState, so it runs once; a write that fails is logged in the
part's output channel and skipped. It is not awaited: a value carried over reaches the part through its
configuration-change handlers, or at its next start. The code is `src/settingsCarryOver.js`, the same file in each
part (a part does not require Roost's `src/`, so it still runs on its own); Roost's tests check the four copies
match and that each part calls it with its own prefixes. *(the copy per part: my call)*

Not carried over: language-specific values (`"[python]": { "perch.…" }`), and a workspace first opened after the
part's first start (the record is per user, not per workspace).

## Flows

Activation, and switching a part off:

```
 VS Code              Roost activate            part (e.g. chirp)            settings
    |                       |                          |                         |
    |-- activate ---------->|                          |                         |
    |                       |-- register all parts' webview serializers          |
    |                       |-- read roost.*.enabled ------------------------>   |
    |                       |-- setContext roost.<part>.failed = false           |
    |                       |   [part off: its restored tabs closed quietly, its saved list kept]
    |                       |-- chirp.activate(own context) ->|                  |
    |                       |   [throws: log, notify once, leave off, setContext roost.teams.failed = true; others go on]
    |                       |<-- ok ----------------------|                      |
    |   ... later, the user turns Teams off ...           |                      |
    |                       |<-- onDidChangeConfiguration ---------------------- |
    |                       |   [Perch with a turn running: ask; cancel → setting back on]
    |                       |-- close its tabs; dispose its subscriptions (commands, pollers), deactivate ->|
    |                       |   [dispose throws: log it, still mark the part off]                         |
    |                       |   [no context key: the setting itself hides its views]
    |<-- icon, views, menus hidden (when clauses) -----|  |                      |
    |   ... the user turns Teams on again ...             |                      |
    |                       |-- chirp.activate(new own context) ->| [throws: as at start]
    |                       |-- [it had failed: setContext roost.teams.failed = false]; its saved tabs come back
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

- Part ids: `perch`, `teams` (chirp), `jira` (jay), `pullRequests` (kestrel); parts are ordered by folder name everywhere.
  (Perch's id became `agents` on 2026-11-23: *Renamed parts and settings*.)
  kestrel's id was `prs` until it became `pullRequests`, so its Settings switch reads "Pull Requests" not "Prs".
- A part's context is the real one with its own `subscriptions` and its folder as `extensionUri`, so each
  part's media and webview resource roots resolve under `parts/<name>/`; `globalState`, `workspaceState` and
  `secrets` are shared (every part already prefixes its keys).
- A part may export `confirmStop()`; Roost calls it before stopping the part, and a `false` puts the switch
  back on. Perch implements it (the modal question while a turn runs).
- For a part that is off, Roost registers a serializer for each of its webview types (from its
  `onWebviewPanel:` activation events) that closes restored panels, and removes it before starting the part.
  Where stopping a part today clears its saved tab list (Perch's `dispose` closing the window), a stop keeps it.
- A part's views, menus, palette entries and keybindings are gated on its setting and `roost.<id>.failed`
  (`config.roost.<id>.enabled && !roost.<id>.failed`), not on a key Roost would set when it starts the part:
  settings context keys exist from the first frame, so icons do not arrive late and restored sidebars are
  not lost. Roost clears every `roost.<id>.failed` as it starts and sets it for a part that fails; switching a
  part off or on, and closing the window, set no key. *(final review, Ruling 10)*
- Roost's own contributions (the `roost.openSettings` command and its gear on the Perch view's title) live in
  `roost.contributes.json`, merged by the manifest build. The **Settings** row is in the Perch part's page and
  runs the command; in a standalone Perch the row does nothing visible.
- `make deps / test / test-live / manifest / install / package`; the `.vsix` carries the root `node_modules`
  only; perch-audio is still built and published from `parts/agents/audio` as its own package.

Built: branch `feat/roost-0.1`; the plan's last commit: 6c40dd9. The plan
(`docs/superpowers/plans/2026-11-23-roost.md`) is deleted; this note is the record.

## Follow-ups (after this project)

- **A Roost installer** *(Sean, 2026-11-23)*. Built: note [102](102-roost-installer.md). One command for people anywhere that installs VS Code first (the
  OS's package manager or the official download), then the Roost extension, so someone who has never set up an
  editor gets Roost in one step. It turns VS Code's built-in Copilot off (`"chat.disableAIFeatures": true`),
  since Roost's Claude and Codex tabs take its place, skips the Welcome page, and keeps the secondary sidebar
  closed (`"workbench.secondarySideBar.defaultVisibility": "hidden"`), where Claude Code's and ChatGPT's own chat
  views would otherwise open: those two extensions stay installed (Perch runs their `claude` and `codex`), but
  Perch's tabs replace their views. It also sets the activity bar: on top
  (`"workbench.activityBar.location": "top"`), showing Explorer, Search, Extensions, Perch, Teams and Jira &
  Confluence, with Source Control, Run and Debug, Testing and the Claude Code and Codex icons hidden *(Sean,
  2026-11-23)*. Which icons show is not a setting: it is VS Code's UI state (`workbench.activity.pinnedViewlets2`
  in `User/globalStorage/state.vscdb`), which no extension can change for another, so the installer writes it
  before VS Code first starts, hidden rather than removed. Public, so nothing company-specific; a company's
  installer stays a separate layer on top.

- **Stronger links** through shared services in `src/` (see *Links between parts, for now*).
- **Teams: a company's own Microsoft app — Built (0.3.0)** *(Sean, 2026-11-24; design below, then what was built)*. Both of chirp's sign-ins, the
  editor's and the sign-in code, use chirp's own app (`5d0faf94…`, "chirp, unverified"; the editor sign-in passes it
  in VS Code's `VSCODE_CLIENT_ID` scope, so it is not VS Code's app). A company that lets only admins approve apps,
  as Sean's company does, stops a first-time user at Microsoft's "Need admin approval" (Sean's first-time run,
  2026-11-24). Its people got in through the company's own approved app, by way of `ms365-mcp`'s token file (noted in
  that company's installer, kept outside this repo). Roost
  cannot find a company's approved app itself (Microsoft has no lookup for it), so it makes the choice visible to
  the user who hits the wall and easy to set for the person who sets machines up:
  - **Settings** `teams.signIn.clientId` and `teams.signIn.tenant`, defaults chirp's app and `organizations`. With
    a company app set, `auto` prefers the sign-in code, which needs only the app's "allow public client flows";
    the editor sign-in also needs the app to accept VS Code's redirect, and is used when `editor` is chosen.
  - **The wall, explained.** When a sign-in fails because the app is not approved (Microsoft's consent error,
    `AADSTS65001` / `AADSTS90094`; to confirm on both paths which error reaches chirp), the Teams view says so
    and offers: *copy the approval link for IT* (Microsoft's admin-consent URL for the app in use,
    `https://login.microsoftonline.com/organizations/adminconsent?client_id=<id>`), *Use our company's app…*,
    and a line on Microsoft's own "Request approval" button, shown where a company has turned that on.
  - **Teams: Use a Company Microsoft App…** (palette, the message above, the walkthrough's Teams page): asks for
    the Application (client) ID and the Directory (tenant) ID, checks they are GUIDs, writes both settings at the
    user level, and signs in again.
  - **Installer:** `--teams-app <clientId>:<tenantId>` writes the two settings (only when absent, like the rest),
    so a company's own installer (kept outside this repo) passes its IDs in one flag. Company IDs
    never go into Roost's public repo or installer.
  - Until it is built, the walkthrough's Teams page says that the app to approve is chirp, and what "Need admin
    approval" means.
  - **Built (0.3.0).** The two settings (GUID checks; the tenant may also be a domain such as
    `contoso.onmicrosoft.com`, or `organizations`; an invalid value is ignored with a note above the Teams lists),
    threaded into the editor sign-in (`VSCODE_CLIENT_ID:` / `VSCODE_TENANT:`), the sign-in code (the authority URL
    and `client_id`, refresh included) and **Copy admin link** (`https://login.microsoftonline.com/<tenant>/adminconsent?client_id=<app in use>`).
    A change to either restarts sign-in, like `teams.signIn.method`. Sign-in-code tokens now record their
    `client_id` (older ones are read from the token's `appid`) and are ignored, not deleted, under another app.
    **Teams: Use a Company Microsoft App…** asks for both IDs (checked as typed), writes both at the user level and
    signs in once. The installer's `--teams-app <clientId>:<tenant>` (note 102). The walkthrough's Teams page names
    the command. Differs from the design:
    - **The wall is not detected; it is explained after the fact.** Neither path reliably hands chirp Microsoft's
      consent error, so after any sign-in that ends cancelled, declined, expired, or with `AADSTS65001` /
      `AADSTS90094` (a new failure kind, `consent`, if they ever surface), the signed-out Teams view says *If
      Microsoft said Need admin approval, your company has to approve the app first:* with **Copy admin link** and
      **Use a company app…**. Not shown before a first attempt; gone once a sign-in starts. No line on Microsoft's
      own **Request approval** button there (the walkthrough page keeps it), to keep the view short.
    - With a company app, `auto` tries the sign-in code first and, if the app does not allow public client flows
      (`AADSTS7000218`), moves on to the editor sign-in with a note; the design had the code only.
    - `--teams-app` writes the pair only when **neither** key is set, so an app never meets another's tenant.
    - The walkthrough page names the command in its text, without a command link.
  - **What reaches chirp, verified and not.** Only by the offline tests: nothing here was run against a tenant
    that requires admin approval, or with a real company app. Not verified: (1) the editor path: whether VS Code's
    Microsoft provider ever rejects `getSession` with the consent error, rather than leaving the browser on "Need
    admin approval" until the user clicks Cancel (then chirp sees "Cancelled", mapped to cancelled); (2) the
    sign-in-code path: whether the token poll, after the user meets "Need admin approval" at devicelogin, answers
    `AADSTS65001`, `authorization_declined` / `access_denied`, or nothing until `expired_token` (all three end in
    the hint); (3) whether `VSCODE_TENANT:` takes a domain as well as a tenant ID (Microsoft's authority does).
  - **A form in the Teams view, not input boxes** *(Sean, 2026-11-24: no input box at the top)*. **Teams: Use a
    Company Microsoft App…** no longer opens VS Code's two input boxes at the top of the window: it reveals the Teams
    view and opens, prefilled from the two settings and focused, a **Use your company's app** section of the
    signed-out page (collapsed otherwise; the hint's **Use a company app…** opens it too). Fields: Application
    (client) ID; Directory (tenant) ID or domain; "Your IT team provides both."; **Save and sign in** (Enter too) and
    **Cancel**. The extension checks both with `clientIdProblem` / `tenantProblem` on submit (the page does not
    repeat the regexes) and sends what is wrong back by field, or a settings-write error under the fields; nothing is
    written unless both are right. Then both settings are written at the user level and Teams signs in once, the
    command's old code shared as `setCompanyApp`. With a company app set, the signed-out page says *Signing in with
    your company's app (0123abcd…) · Change*. **Signed in**, the command shows "Sign out first to change the app
    Teams signs in with." rather than a form under the account line (the form lives only in the signed-out page);
    while a sign-in is waiting, the command cancels it and opens the form.
- **Agents: a company's gateway, ready but for the key (Built, 0.4.0; superseded in shape by the company file below)** *(Sean, 2026-11-24)*. A company LLM
  gateway usually needs a personal key that each person makes on a web page of the company's. Today a company
  installer has to ask for it in the terminal before VS Code ever opens. Instead the installer prepares everything
  but the key, and the walkthrough is where the person gets the key and pastes it. Roost stays generic: what a
  company's gateway is (its name, addresses, key page, environment) comes from a file its installer writes, never
  from Roost's repo.
  - **The preset.** `preset.json`, beside the gateway file (`agents.claude.gatewayEnv`'s directory, by default
    `~/.config/gateway-claude/`), written by a company's installer:
    `{ "name": "Example Gateway", "baseUrls": ["https://ai.example.com/llm-api", "https://public.example.com/llm-api"],
    "keyPage": "https://ai.example.com/api-access", "requiredModel": "…" (optional), "env": { "ANTHROPIC_MODEL": "…",
    … } (optional), "keyFiles": ["~/.config/example-gateway/token"] (optional) }`. Read when present, ignored with a
    note in the form when it doesn't parse. `baseUrls` in order of preference: the first that answers wins (an office
    network or VPN address first, a public one after). `keyFiles`: other places the key is saved, for the company's
    own tools (a terminal launcher, Claude Code's `apiKeyHelper`).
  - **The key check.** `GET <baseUrl>/v1/models` with the key as both `Authorization: Bearer` and `x-api-key` (it
    authenticates the key and lists its models without calling one), each base URL in order until one answers at all.
    Verdicts: *works*; *works, but its scope lacks `requiredModel`*; *rejected* (401/403); *can't reach the gateway*
    (none answered: say "on the VPN?" when the preset has more than one address); *unexpected answer*. Only a key that
    works is saved. The same check serves the form without a preset, against the Base URL typed in.
  - **The form with a preset.** **Agents: Set Up a Gateway…** shows the preset's name, no Base URL field (the
    address that answered is shown once checked), a **Get a key** button that opens `keyPage` in the browser, a Key
    field (hidden as typed) and **Check and save**. On *works*: the gateway file gets `ANTHROPIC_BASE_URL` (the address
    that answered), `ANTHROPIC_AUTH_TOKEN` and the preset's `env`, mode 0600 as today; each `keyFiles` entry gets the
    key alone, mode 0600 in a 0700 directory; `perch.gatewayReady` turns true, and the form offers **New Claude Tab**
    on the gateway. A key already saved shows as set, with *Replace*; it is never sent to the form.
  - **The walkthrough with a preset.** Context key `perch.gatewayPreset` (the preset read and valid). Two gateway
    steps, one shown at a time: with a preset, **Connect to the company gateway** comes first, before *Talk to
    Claude or Codex* (button **Set Up the Gateway**, ticked on `perch.gatewayReady`; the page says the address is
    already known and only the key is needed; the step title can't carry the preset's name, as walkthrough text is
    static); without one, the optional *Use an LLM gateway* stays where it is. With a working gateway, the first
    step's **New Claude Tab** opens on the gateway (Perch's choice of backend; the first-start order already prefers a
    usable gateway).
  - **What a company installer then does** (one company's is noted in its own repo, outside this one): writes the preset; points the terminal's
    `claude` at the gateway with Claude Code's `apiKeyHelper` reading the key file (so it works as soon as the
    walkthrough saves the key; to confirm against the real gateway); no longer asks for the key in the terminal,
    keeping an optional flag for scripted installs.
  - **Open:** whether `apiKeyHelper` with a key that doesn't exist yet fails gently in a terminal `claude` started
    before the walkthrough; whether a VPN-off machine should prefer the public address silently or say so.

- **A company file, Connect Claude, and Connect your tools (Built, 0.4.0; supersedes the preset above)**
  *(Sean, 2026-11-24, designing a company installer on Roost: "the walkthrough walks through everything except
  what's already determined" for the company; subscription, API, Bedrock and Codex must work as well as the
  company's gateway; the company's MCP servers get a walkthrough step; one sign-in serves an MCP server and the
  matching part)*. Company details stay out of this repo; they come from one file the company's installer writes.
  - **The company file**, `~/.config/roost/company.json`: `name`; `gateway` (the preset above: `name`, `baseUrls`,
    `keyPage`, `requiredModel`, `env`, `keyFiles`, plus `terminal`: write terminal `claude`'s settings by default, and
    `routerPrefixes`: model-id prefixes the gateway menu groups as Routers, default none);
    `mcpServers`: a list of `{ id, name, about, register, connect }`, where `register` is what Claude Code is
    given (`http` with a URL and headers, `${token}` standing for the token; or `stdio` with a command and env) and
    `connect` is how it gets signed in: `tokenPage` (a page to open, the token pasted, a check request), `command`
    (a sign-in command run in a terminal, done when a file appears), `mcpTool` (the server's own sign-in tool: Roost
    starts the server over stdio, calls the tool, shows what it returns, such as a device code, then calls it again
    with the `complete` arguments; for servers whose sign-in is a tool, with no command of its own), or `none`; and
    an optional `check` (a request, an MCP tool call that needs the sign-in, or a status command): a row is
    connected only once its check passes, not because a file exists. Read at start; context key
    `roost.company` when valid; a note in the Roost output channel when it doesn't parse.
  - **Connect Claude** replaces *Use an LLM gateway (optional)* and comes first. One step, a small panel with the
    ways Claude can run: the company's gateway when the file has one (recommended: the preset form above, **Get a
    key**, **Check and save**; the address re-checked each time a Claude tab starts on the gateway, so a laptop
    moving on and off a VPN keeps working), a generic LLM gateway otherwise (today's form), **Claude subscription** (Agents: Log
    in to Claude), **Anthropic API key** (pasted, checked with `GET /v1/models`, kept in a file of the user's, mode
    600), **AWS Bedrock** (a profile or SSO already on the machine, and a region; checked with a model list), or
    **Codex only**. Ticked when one is set up, or **Not Now**. New Claude Tab then opens with that connection.
    **Terminal `claude`**, when asked ("use for `claude` in the terminal too", on by default when the company file's
    `gateway.terminal` is true, off otherwise): the choice is written to `~/.claude/settings.json` (gateway:
    `env.ANTHROPIC_BASE_URL` the address that answered, model env and `apiKeyHelper` reading the key file; API key:
    `apiKeyHelper`; Bedrock: `CLAUDE_CODE_USE_BEDROCK=1`, region; subscription: nothing). A value the user already
    has there is shown and replaced only when they agree. The gateway's address then follows the company address that
    answers: each time a Claude tab's start finds one, and once at activation (the company's `baseUrls` probed in the
    background with the gateway file's key, only when that file names one of them), `env.ANTHROPIC_BASE_URL` is
    rewritten to it, only while it still holds the address Roost wrote there; a value the user changed is theirs, and
    the key is never added. *(Sean, 2026-11-24: no launcher; Roost's installer installs the claude CLI, at
    `~/.local/bin/claude`, which Claude Code's updater rewrites.)*
  - **Connect your tools** *(company file with `mcpServers` only)*, after *Talk to Claude or Codex*: a panel, one
    row per server (name, what it gives the agent, connected or not, a button). `tokenPage`: open, paste, check,
    save; `command`: run in a VS Code terminal, connected when its file appears; then the server is registered
    with Claude Code at user scope, as `claude mcp add` would. Ticked when every row is connected, or **Not Now**.
  - **One sign-in, two uses:** a company installer can point Teams' and Jira's token-file settings at the files
    the matching MCP servers' sign-ins write. Those steps then tick by themselves after *Connect your tools*; with a
    company file, their buttons run the matching tools row instead of the part's own sign-in.
  - **A company installer layered on Roost's** must never pass `--yes` (it would answer "uninstall the standalone
    four?" for the user), and should refuse a machine it wasn't meant for rather than migrate it.
  - Also: the installer installs `git` explicitly, when `git --version` doesn't run (note 102, step 4a).
  - Also found: the installer adds Homebrew's `brew shellenv` to the login profile only when VS Code came from
    Homebrew; it should whenever Homebrew was used (`gh` from Homebrew is otherwise not on new terminals' PATH, nor
    VS Code's, on a Mac whose profile lacks it).
  - **Settled while planning 0.4** *(my calls, 2026-11-24; plan `docs/superpowers/plans/2026-11-24-roost-0.4-company.md`)*:
    - *Company file.* `ROOST_COMPANY_FILE` overrides the path. Any error makes the whole file invalid (the note names
      the path, `mcpServers[1].connect.kind: …`); unknown keys are ignored; `~` expands in key files, commands and
      `doneWhen` files; `${token}` is allowed only in a `tokenPage` server's `register`. `check` and `doneWhen` sit
      inside `connect`. A second context key, `roost.companyTools`, gates *Connect your tools*. The Agents part reads
      the file through its own copy of `src/company.js` (a part never requires Roost's `src/`), checked identical.
    - *Key check.* A probe or check waits 3 s per address at a tab start, 10 s in a form. A 401/403 from the first
      address is final. `requiredModel` matches with a leading `anthropic/` ignored. Without a company gateway the
      form checks too, and only on an *unexpected answer* (a gateway with no `/v1/models`) offers **Save anyway**.
      At a tab start with no address answering, the tab uses the gateway file's address, with no note.
    - *Terminal `claude`* is written only when a connection is saved, so `apiKeyHelper` never points at a key that
      doesn't exist yet (the first *Open* above). There is no launcher (Sean, 2026-11-24: Roost's installer installs
      the claude CLI at `~/.local/bin/claude`, and its updater rewrites that path): `settings.json` gets the address
      that answered, kept current as above (`syncTerminalBaseUrl`; the record of what Roost wrote is globalState's
      `perch.terminal.written`). The key file for `apiKeyHelper` is `keyFiles[0]`, else
      `~/.config/roost/gateway-key`. Roost records what it wrote: a later choice removes Roost's own values and treats
      any other value as the user's (shown, masked when its name says token, key or secret, and replaced only on
      **Replace**). A settings file that isn't a plain JSON object is never rewritten. Agents treats any `apiKeyHelper`
      in `settings.json` as a pinned machine (non-gateway tabs then take it off).
    - *Connect Claude* is an Agents panel (`perch.connectClaude`); its gateway way opens the gateway form. The choice is
      recorded (`perch.claude.connection`) and new Claude tabs follow it until a tab's footer picks a backend. The
      Anthropic API key lives in `~/.config/roost/anthropic-key` and reaches a tab as `ANTHROPIC_API_KEY` (a third
      tab backend, `apiKey`; the footer's menu is unchanged). Bedrock is checked with the AWS CLI
      (`aws bedrock list-foundation-models --by-provider anthropic`); without the CLI it offers **Save anyway**; an
      expired SSO sign-in names `aws sso login`. With nothing recorded, the step counts as done when a gateway is ready
      or Claude can already run.
    - *Connect your tools* lives in Roost's `src/`, not a part. Registration writes `~/.claude.json`'s `mcpServers`
      directly (re-read just before, atomic), rather than running `claude mcp add`, so a token is never in argv; a
      different entry of the same name is replaced only on **Replace**. `tokenPage` tokens are kept in
      `~/.config/roost/tokens/<id>`. With no `check`, a row is connected when its `doneWhen` file exists (`none`:
      always). `mcpTool` uses one server process for both calls (60 s, then 15 minutes for `complete`); the code and
      link are picked from the tool's text. Checks run when the panel opens and after a sign-in, not at start (VS
      Code keeps a ticked step).
    - *Teams and Jira buttons* find their tools row by file: the row whose `doneWhen` file is the part's
      `signIn.tokenFile`.
    - *Order:* Connect Claude, Talk to Claude or Codex, Connect your tools, Search your code, Teams, Jira, GitHub,
      Choose your parts. `roost.gatewayNotNow` becomes `roost.connectClaudeNotNow`.
    - *Installer:* git is checked without running Apple's `/usr/bin/git` shim when the Command Line Tools are missing;
      on a Mac without Homebrew it runs `xcode-select --install` and waits up to 10 minutes. "Homebrew was used" means
      this run installed something with it, or `code`, `gh` or `git` comes from it; its shellenv goes in a block of
      its own, step `homebrew`, with no line when Homebrew wasn't used.

  - **Built (0.4.0), rulings made during the build and the final fixes** *(Sean's and mine, 2026-11-24; each: the
    ruling, why, and the cost if wrong)*:
    - *R1, no launcher.* Nothing is put at `~/.local/bin/claude`: Claude Code's CLI lives there and its updater
      rewrites it. Terminal `claude`'s address is kept current by Roost instead (`syncTerminalBaseUrl`, after each
      successful re-probe at a gateway tab start and at activation), and only while the value is the one Roost wrote.
      `desiredSettings('gateway')` always sets `env.ANTHROPIC_BASE_URL`. Sean chose it. If wrong: off the VPN with VS
      Code closed, terminal `claude` points at the last address until VS Code starts.
    - *R2, the installer installs the Claude Code CLI.* Step `claude` (after companions) downloads Anthropic's
      official installer and runs it (as Homebrew's is), when `claude` isn't on the PATH; `~/.local/bin` joins Roost's
      PATH block when it isn't on the original PATH. Note 102 has the step; a company installer need not install it.
      Sean's call. If wrong: an extra download of about 100 MB for users who never use a terminal. The up-front
      list of system-wide changes counts the curl and ca-certificates this step may need.
    - *R3, never `--yes` for company layers.* An earlier line of note 102 said a company installer passes `--yes`;
      this note's rule wins (it would answer "uninstall the standalone four?" for the user), and 102 was fixed.
    - *R4, the final review ran before closing.* The whole-branch review needed the plan, so the plan was deleted
      only afterwards, with the final fixes folded in here.
    - *R5, company mentions removed.* Pre-existing company mentions were removed from the current files in one
      separate commit, with no history rewrite (the repo is public, nothing secret, the history already public, and
      SHAs are referenced elsewhere). The gateway menu's Routers grouping, once a fixed prefix, now follows the company
      file's `gateway.routerPrefixes` (default none). A guard test, `test/noCompanyNames.test.js`, run by `make
      test`, scans the tracked files for company names (stored encoded, so it doesn't name them) and fails on a
      hit. If wrong: a user with no company file loses the Routers grouping, and the company's own file
      must add `routerPrefixes` (until it does its routers show under Other).
    - *Task 3, whose address is probed.* The company's addresses are probed, and the gateway file's key sent to them,
      only when the file's `ANTHROPIC_BASE_URL` is one of the company's `baseUrls` (normalized); otherwise no address
      is tried. A key for a user's own gateway must not go to the company's hosts. The company form follows the same
      rule: it reuses the file's key only for a company address (`companyKeyKept`), else shows the key field and
      answers "A key is needed." with no request. If wrong: a company gateway saved under an address variant is
      not re-probed.
    - *Task 2, `company.js` copies.* `src/company.js` and `parts/agents/src/company.js` stay two byte-identical
      copies, since a part never requires Roost's `src/` (as with `settingsCarryOver.js`); a test catches drift. If
      wrong: a later edit must touch both.
    - *Task 5, the walkthrough table.* This note's *First start* table was stale after the order changed; the task
      that owns the walkthrough order updates it, and this closing pass checked it against the shipped manifest.
    - *Task 6, "connected" and secrets.* A row is connected only when its registration succeeded with no conflict or
      reason, and *Connect your tools* is ticked only when all are. A `${token}` is allowed only in a `tokenPage`
      server's http headers or stdio env, never in args or the command (the argv rule); `company.js` validation
      (both copies) and registration refuse otherwise, so a server that wants the token as an argument must take it
      from env. `~/.claude.json` is Claude Code's file in `$HOME`: the rule there is a 0600 file, the 0700-directory
      rule doesn't apply.
    - *Final fixes.* (1) the company form no longer sends a key kept from another gateway (above). (2) Connect Claude's
      conflicts and Saved are remembered by the host and resent when its page is shown again, and the gateway form
      opens beside the panel, because a hidden webview drops messages. (3) `writeSettings` re-reads the file and
      applies each change only if the key still holds its `from`; a key that changed since the plan is returned as a
      conflict and asked again; a `kept` entry that changed is dropped from the record. (4) The installer's git
      step on Ubuntu and Debian runs `apt-get update` and then a non-interactive `apt-get install -y git`; the
      `claude` step's sudo (curl and ca-certificates) is listed up front. (5) A `command` sign-in's row says "If the
      sign-in failed, close its terminal to try again." while its terminal is open.
  - **Connect Claude, two decisions after 0.4.0** *(Sean, 2026-11-24; built in 0.4.2)*:
    - *With a company gateway, that gateway only.* When `company.json` is valid and has a `gateway`, the panel shows
      the company's gateway (its form: get a key, Check and save) and Codex only, and one line below: "Using your
      own Claude subscription, an API key or Bedrock instead? Switch any tab's backend in its footer (subscription /
      gateway / API) whenever you like." No subscription, API key or Bedrock way; the host ignores those messages
      too. Why: each tab's footer already switches backend, *Agents: Log in to Claude (subscription)* exists, and so
      does the window switch, so a company user can still use a subscription without the walkthrough offering it.
      Codex only stays (my call): it is not another Claude backend, and it lets a user with no Claude yet tick the
      step. If wrong: drop `codex` from `COMPANY_WAYS` in `claudeConnections.js` and from the page's list.
    - *Without one, Bedrock is checked only once picked.* The five ways stay, but Bedrock's section shows only
      **Use Bedrock…** until pressed; its form, its AWS text and the reading of `~/.aws` (`awsProfiles`) come after
      (`bedrockPick`, `state.bedrockOpen`; open at once when Bedrock is the way in use). Before, `connectState` read
      `~/.aws` on every open and the Bedrock section's AWS CLI text was shown to everyone; the CLI itself ran only on
      Bedrock's Check and save. Picked with no AWS CLI, the panel says, not as an error: "Bedrock needs the AWS CLI:
      install it (on macOS: brew install awscli), then try again." (Save anyway is still offered.) No AWS text shows
      unless Bedrock was chosen. The walkthrough page, being static, says a company's setup may offer its gateway
      only, and that any tab's footer switches backend.
  - **Built (0.4.0), not checked live.** Everything above was run by the offline tests only (`make test`, the
    installer's tests: 127 run, 4 skipped on this machine). Not run: hidden webviews in a real VS Code (the resend
    after a hidden page is covered by a stub that drops messages); a real gateway (the key check, the re-probe, the
    `routerPrefixes` grouping); a real installer run on a fresh machine (the `claude` and git steps, the PATH
    block); and `make test-package`'s size check, which cannot run in a worktree because `node_modules` is a
    symlink there.
  - **Plan:** `docs/superpowers/plans/2026-11-24-roost-0.4-company.md`, last at bb25a76.
    Built: branch `feat/roost-0.4`, merged directly, with no PR. The plan is deleted; this note is the record.

## Left to the builder

- Where each part's media lives and how its asset paths are resolved under `<part>/` (29 uses of
  `extensionUri`/`asAbsolutePath` across chirp, jay and kestrel).
- Whether each part's `vscodeStub.js` / `test/stubs.js` stays separate or is shared.

## Verification

What was asked:

- `make test` green; a fresh window with Roost and none of the four standalone extensions shows the Perch,
  Teams and Jira & Confluence icons and the PRs panel tab; each part works as its standalone did.
- Turning each part off hides its icon or tab and its commands at once, and stops its polling; turning it on
  brings it back without a reload.
- A part made to throw at start leaves the other three working, with one notification.
- `git log -- parts/perch/src/extension.js` in Roost shows Perch's full history (since the rename:
  `git log --follow -- parts/agents/src/extension.js`).
- A throwaway fifth part (a folder with `part.json` and one view) appears with its own switch after `make
  manifest`, with no other file edited.

What was found (2026-11-23):

  - **0.3.3, from Sean's first-time run with his company's own app:** listing chirp's scopes stopped at "Need
    admin approval" over one the app lacks (`User.ReadBasic.All`; it has `User.Read.All`), since the tenant lets no
    user consent. With a company app chirp now asks for `https://graph.microsoft.com/.default` (plus
    `offline_access` for the sign-in code): exactly what the app was approved for, never a consent prompt. Channels
    are then tried, as with a token file, and a 403 turns them off.
- **History:** after the filter-repo import every source commit of a part's file is in Roost's log of it
  (commit counts 194 / 35 / 21 / 42 for Perch, chirp, jay, kestrel; identical trees and blobs); `make test`'s
  import test checks it against the imported commits.
- **Fifth part:** a throwaway `parts/zz-demo/` (part.json, a view container, a view, a command) got its switch
  `roost.demo.enabled` after the four, its view gated on it and its command in the palette gated too, and the
  loader found it, with only `package.json` regenerated. The first run failed one of Roost's own tests, which
  listed the four parts by hand; the tests now take the parts from `parts/`, and with the demo present `make
  manifest && make test` passes with nothing but `package.json` and the new folder changed. After removing it,
  `make manifest` gives a byte-identical `package.json`.
- **Live run** (Sean; a separate VS Code 1.129 profile; Roost symlinked by `make install`): a Perch tab ran a
  Claude turn (the vendors' programs were found); the Perch explorer showed the Settings row and the gear; both
  opened Settings filtered to Roost with the four switches first; Teams switched off and on again, its icon back;
  first start opened the PRs panel, which listed a real open PR; Roost's output log stayed empty (no part failure,
  no serializer warning). The settings sections and the first-start PRs tab were added during this run.
- **Not checked live:** the Teams and Jira & Confluence views' content, the PRs and Jira switches, a part made to
  throw (covered by the loader's tests only), and tabs restored across a part that is off at startup (covered by
  the loader's and the parts' tests only).

## Parked

- Perch's `host.test.js` fails now and then in a full `make test` (a background session reported as `duplicate`, not
  `background`); it passes on its own and on a rerun (seen twice, 2026-11-24).
- The loader ignores `needs` at runtime: the manifest build checks that it names parts, and no part uses it.
- chirp and jay reopen their saved tabs after 4 seconds even where VS Code chose not to restore them (the cost
  of their tab lists, accepted).
- While Perch's stop question is open the setting already reads off, so Perch's sidebar hides; on Cancel the icon
  returns but the sidebar does not refocus Perch. One click; no data lost.
- chirp's and jay's tab lists match unrevived tabs by title: two tabs with one title (chirp's "Teams chat" before
  its list loads) can drop the wrong entry, and an unrevived tab moved between groups goes to the end of the list.
