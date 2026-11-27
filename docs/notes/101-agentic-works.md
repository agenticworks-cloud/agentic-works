# 101 — Agentic Works: Perch, chirp, jay and kestrel as one extension

Built, 2026-11-23 (0.1.0). Written against Perch 0.7.42, chirp 0.2.5, jay 0.2.4, kestrel 0.1.10; imported at Perch
0.7.44. How to build, install and use it: [README.md](../../README.md).

## Intent

Four extensions by the same author already work together: kestrel puts a prompt into a Perch tab, Perch opens
Jira tickets and Confluence pages through jay, and chirp and jay keep the conversation, ticket or page in
front as a file an agent can read. Installing four extensions is already too much for many people: they do not
think at the operating-system level, and finding VS Code plus the right extensions is where they give up, which
is why they pick an editor that is one download. **Agentic Works** is the four as one extension: one thing to install,
and one codebase in which the links between the parts can grow stronger. *(Sean)*

It may stay an extension for good, become a VS Code fork later, or become Perch itself; that is decided after
seeing it work. The extension comes first either way: a fork would ship Agentic Works built in. *(Sean)*

### Goals

- One extension, `agenticworks.agentic-works`, in a new repo `agenticworks-cloud/agentic-works` (local `/git/agentic-works`). *(Sean)*
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
- Publishing Agentic Works to the Marketplace (its own step, when ready).

### Anti-goals

- A part that fails to start, or a service that is down, taking the other parts with it.
- Renaming commands or views, which would break keybindings, other parts' calls and any installer's layout.
  *(Settings were renamed after all, on 2026-11-23, with a carry-over of the user's values: see* Renamed parts and
  settings *below.)*
- Losing any repo's history.

## Identity and distribution (2026-11-27)

The extension is **Agentic Works**. *(Sean, 2026-11-27)* The parts keep their names (Perch, chirp, jay, kestrel)
and their settings, commands and views; they are retired once Agentic Works is complete. *(Sean)*

| what | value |
|---|---|
| name in prose | Agentic Works |
| extension id | `agenticworks.agentic-works` (`name` `agentic-works`, `publisher` `agenticworks`) *(my call)* |
| settings, commands, walkthrough, context keys, stored state | prefix `agenticWorks.` (e.g. `agenticWorks.agents.enabled`, `agenticWorks.getStarted`) *(my call)* |
| environment variables | `AGENTIC_WORKS_*` (e.g. `AGENTIC_WORKS_COMPANY_FILE`) *(my call)* |
| config folder | `~/.config/agentic-works/`: `company.json`, `skills.json`, `tokens/`, `anthropic-key`, `gateway-key` *(my call)* |
| installer | `installer/agentic-works-install.sh` with `installer/agentic-works-install-helper` inlined; release asset `agentic-works-install.sh`; `.vsix` `agentic-works-<version>.vsix` *(my call)* |
| repo | `agenticworks-cloud/agentic-works`, transferred from Sean's own account so history, releases and redirects stay; local `/git/agentic-works` *(Sean)* |
| install | `curl -fsSL https://agenticworks.cloud/install | bash` *(Sean)*, served by the org Pages repo `agenticworks-cloud/agenticworks-cloud.github.io` with the custom domain `agenticworks.cloud` (registered at GoDaddy); each release copies its installer there as `install` |
| first version | 1.0.1 *(Sean, 2026-11-27)* |

**Nothing moves from an earlier install.** No settings, state, config folder or extension carry over: Sean is
the only user so far, and uninstalls and installs fresh. *(Sean)* The repo names no earlier name anywhere
(`test/noOldName.test.js`). *(Sean)*

Not in scope: Marketplace publishing; changes to the Perch, chirp, jay or kestrel repos. The repo transfer, each
release and each deploy of a company's installer wait for Sean's go-ahead.

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

`/git/agentic-works`, pushed to `github.com/agenticworks-cloud/agentic-works` (public, like Perch). Each repo is imported once with
a temporary clone of its `main` (kestrel's `master`) rewritten with `git filter-repo --to-subdirectory-filter
parts/<name>` and merged with `--allow-unrelated-histories`, keeping full history, under `parts/<name>/`, so `git
log` and `git blame` work on the `parts/` paths (a first import that left each file with a one-commit log under its
new path was redone this way). Commit
SHAs inside Agentic Works differ from the originals'; messages, authors and dates are kept. The layout
is built so that **a future part is one more folder** under `parts/`, with nothing else edited by hand *(Sean)*:

```
agentic-works/
  package.json            GENERATED from the parts (checked in); never edited by hand
  src/                    Agentic Works itself: the part loader, the on/off switches, shared services between parts
  parts/
    agents/         part.json  package.json  src/  media/  test/  docs/   (imported as parts/perch, plus part.json)
    jira/           part.json  …                                        (parts/jay)
    pull-requests/  part.json  …                                        (parts/kestrel)
    teams/          part.json  …                                        (parts/chirp)
  scripts/build-manifest.js
  docs/notes/             Agentic Works' own notes (this is 101); each part's notes stay in parts/<name>/docs
  Makefile                manifest, test (Agentic Works + every part), install / package / publish for agenticworks.agentic-works
```

**`parts/<name>/part.json`** describes a part to Agentic Works:

```json
{ "id": "teams", "title": "Teams", "entry": "src/extension.js", "needs": [] }
```

`id` names its switch (`agenticWorks.<id>.enabled`) and the context key `agenticWorks.<id>.failed` Agentic Works sets when it fails to start; `title` is what settings and messages call it;
`entry` exports the part's `activate` (and `deactivate`); `needs` lists parts it cannot work without (none
today: every existing link already tolerates the other part being absent). The part keeps its own
`package.json` for its `contributes` block (and, for Perch, its npm dependencies), as today.

After the import, development happens in Agentic Works; nothing is synced back. *(Sean: the four are retired eventually.)*
**Before the import:** Perch's `feat/phase-green` and chirp's `attachment-note` land on their `main`. *(Sean)*
Perch's stale `fix/gateway-opus-thinking-effort` (2026-10-23) stays behind.

### One manifest, generated, ids unchanged

VS Code reads only a static root `package.json`, so `scripts/build-manifest.js` (`make manifest`) builds it from
the parts: it reads every `parts/*/part.json` and that part's `package.json`, and writes the root manifest with

- the union of the parts' `contributes` blocks, with **every id kept**: `perch.*`, `chirp.*`, `jay.*`,
  `kestrel.*` commands (the settings were renamed later: *Renamed parts and settings*), the `perch`, `chirp` and `jay` activity-bar containers and the `kestrel`
  panel container, the webview types (`perch.session`, `chirp.conversation`, `jay.ticket`, `jay.page`). So the
  user's settings keep working and an installer's activity-bar layout (which hides and orders containers by id) does not
  change, plus Agentic Works' own `agenticWorks.openSettings` from `agentic-works.contributes.json`;
- `when: config.agenticWorks.<id>.enabled && !agenticWorks.<id>.failed` added to each part's views, menu entries (the Command
  Palette's included) and keybindings, combined with any `when` the part already has (view containers take no
  `when`: VS Code hides one whose views are all hidden);
- one `agenticWorks.<id>.enabled` setting per part, `true` by default, titled from `part.json`, collected in a first settings section titled Agentic Works (switches in part order, so they list before everything else), followed by one settings section per part titled from `part.json`, holding that part's own settings;
- the union of activation events and of npm dependencies (Perch's Claude Agent SDK and Codex SDK), which move
  into Agentic Works' `package.json` and `.vsix`; Perch's code finds them through Node's normal lookup from `parts/agents/`;
- Perch's `extensionPack` (perch-audio, Claude Code, ChatGPT). perch-audio stays a separate companion, since it
  must run on the user's own machine when VS Code is attached to a remote. *(my call)*

It **fails** on any id two parts both contribute, on a part without `part.json`, and on a `needs` that names no
part. A test checks that the checked-in manifest equals a fresh build, so a part's change without `make
manifest` fails the tests rather than shipping a stale manifest. Agentic Works' own identity (name, version,
publisher, icon, `extensionKind: ["workspace"]` so it runs beside the code over Remote-SSH, categories AI and Chat)
lives in a small `agentic-works.json` the script starts from. *(my call; extensionKind and categories: build)*

### Parts, and switching them

One setting per part, all `true` by default: today `agenticWorks.agents.enabled`, `agenticWorks.jira.enabled`,
`agenticWorks.pullRequests.enabled`, `agenticWorks.teams.enabled` *(ids: my call; `agents`: Sean)*. Agentic Works' loader finds the parts by reading the
same `part.json` files at runtime, so it has no list of parts to edit either.

- Agentic Works' `activate` starts each enabled part by calling that part's own `activate` with a **context of its own**:
  the real `ExtensionContext`'s fields, but its own `subscriptions` array. Stopping a part disposes that array
  and calls the part's `deactivate` if it has one.
- A setting change starts or stops that part at once.
- Each part's views, menu entries and keybindings get `when: config.agenticWorks.<id>.enabled && !agenticWorks.<id>.failed`,
  so a part that is off shows no icon, no panel tab and no commands in the palette or menus. The setting half is
  there from the window's first frame, so a part that is on shows its icon at once and a restored sidebar stays;
  Agentic Works sets only `agenticWorks.<id>.failed`. A part that is on but still starting shows its icon a moment before its
  views work, as a standalone extension does.
- **Isolation:** each part's `activate` runs in its own try/catch; a part that throws is reported once (a
  notification with "Show log", and Agentic Works' output channel) and left off for this window; the others run.
- A part's own background work (chirp's and kestrel's pollers, jay's mirror, Perch's timers) must stop with the
  part. Where a part keeps a timer outside its subscriptions today (Perch's `ticketTimer`, `firstStartTimer`,
  cleared only by its own `dispose`), Agentic Works' tests check that stopping the part leaves no timer running.
- **Parts start side by side** (`Promise.allSettled`), and Agentic Works' `activate` does not wait for them, so one part
  that hangs holds up neither the others nor Agentic Works. A start or stop that fails is logged and that part's later
  switches still run.
- **Retry:** switching a part off and on again retries a part that failed to start. From a failed start until
  the next good one, `agenticWorks.<id>.failed` is true (no icon or commands), whatever the setting says. *(my call)*
- **Switching a part off with tabs open** works like closing the window for that part *(my call)*: its editor
  tabs close, its agents stop, and its own saved tab list is kept, so switching it on again restores them as a
  window reload does. Before stopping a part Agentic Works calls its `confirmStop()` if it exports one; `false` puts the
  setting back on, at the scope it was changed in. Perch's asks while a turn runs ("Stop the running turn and
  close Perch's tabs?"). chirp and jay kept no tab list of their own before Agentic Works, so both got one in the build:
  the open conversations (with their titles), tickets and pages, in `workspaceState`; their `confirmStop()` only
  marks the stop as a switch-off, so their tabs close and stay listed. On start they reopen, after a 4-second wait
  for VS Code's own restore, any listed tab VS Code did not bring back; a listed tab that was never shown and that
  the user closes is forgotten.
- **A part that is off at startup:** Agentic Works still registers that part's webview serializers, so tabs VS Code
  restores for it are not lost: they are closed quietly and the part's saved tab list kept, so switching the
  part on brings them back. *(my call)* Agentic Works also tracks every serializer a part registers itself, by webview
  type, and removes it when the part stops or fails, so a part that threw after registering one (jay registers
  its outside its subscriptions) can be retried without "already registered".
- **Commands of a part that is off** are not registered (the part registers them in its `activate`). A call to
  one from another part, a keybinding or a script fails as a missing command does today when the other
  extension is not installed; existing callers already handle that.
- **Faults while running** are no different from today: the four standalone extensions already share one
  extension host process, so a part that hangs or spins already affects the others. Isolation in this design
  is about start-up and stopping.

### First start

On its very first activation Agentic Works opens, once: the PRs tab (`workbench.view.extension.kestrel`, kestrel's panel
container), so the bottom panel, closed on a fresh profile, shows it; the walkthrough (below); and last the side bar
on Perch's view (`workbench.view.extension.perch`, while Agents is on), since a fresh window can start with the side
bar closed and, with the activity bar on top, the part icons are then hidden with it *(Sean, after the first
installer run, 2026-11-24)*. Opened first, the Perch view gave way to Explorer in that run, so it goes last. It runs after the parts have started, is not
awaited by `activate`, and has no setting. Whatever happens (PRs off or failed, the command failing, which is
logged to the Agentic Works output channel) `agenticWorks.firstStart.done` is then recorded in the base context's `globalState`,
so it never happens again. The Agents part's own `agents.firstStart.openClaudeTab` (was `perch.…`) stays separate, for installers. It opens the one tab of the agent that can answer *(Sean, 2026-11-24)*: a Claude tab on the gateway when the gateway file is usable (a base URL and a token), else a Claude tab when Claude is signed in (a login or an API key), else a Codex tab when Codex is (its `auth.json`, or an API key), else a Claude tab, which offers the sign-in; placed as before, beside the walkthrough, 70/30. The setting keeps its name (Agents' note 203).

After the PRs tab, the same first start opens Agentic Works' **Get started** page *(0.5.0; it replaced opening the
walkthrough)*, a webview editor tab (`agenticWorks.getStarted`) in `src/getStarted.js`; a failure is logged like the PRs tab's.
**Agentic Works: Get Started** opens it again. Each step's controls are in the page, and no step opens another panel. A step shows
while its part is on and not failed; the first not-done step is open, the others closed with their tick, and a step once
done stays done (globalState `agenticWorks.getStarted.done`). The order and each step's signal:

| Step | Shown | Done when |
|---|---|---|
| Sign in to GitHub | with a company file first, else fifth; Pull Requests on | `kestrel.signedIn` |
| Connect Claude (the company's `steps.gateway` name with a gateway) | Agents on | `perch.gatewayReady` or `perch.claudeConnected`, or Not Now |
| Talk to Claude or Codex (`steps.talk`) | Agents on | `perch.messageSent` |
| Connect your tools (`steps.tools`) | company file lists `mcpServers` | `agenticWorks.toolsConnected`, or Not Now |
| Sign in to Teams | Teams on | `chirp.signedIn` |
| Connect Jira and Confluence | Jira on | `jay.signedIn` |
| Search your code (optional) | Agents on | the codebase search choice, or Not Now |
| Choose your parts | always | a switch, Done or All settings |

With a company file the order is GitHub, Claude, Talk, tools, Teams, Jira, code, parts; without one it is Claude, Talk,
Teams, Jira, GitHub, code, parts. VS Code's walkthrough is kept as the fallback on the Welcome page. It is Agentic Works' own (`contributes.walkthroughs` in agentic-works.contributes.json, the one contribution point only
Agentic Works may use), so it also sits on VS Code's Welcome page, and **Agentic Works: Get Started** opens it again. Its steps, each
shown only while its part is switched on and started (`when: config.agenticWorks.<id>.enabled && !agenticWorks.<id>.failed`; Connect
your tools only with a company file that lists MCP servers, `when: agenticWorks.companyTools`), have a button and a short
page (media/walkthrough/*.md). Their text is static: whatever depends on the company file is in a panel, not a step.
In order (the walkthrough's steps, which the page above replaces at first start):

| Step | Button | Done when |
|---|---|---|
| Sign in to GitHub, first (only with `agenticWorks.company`; step `githubFirst`) *(0.4.3)* | Agentic Works: Sign In to GitHub | as the later Sign in to GitHub step, which a company file hides (`!agenticWorks.company`): a server's `install` downloads through this sign-in |
| Connect Claude | Connect Claude (Agents: Connect Claude…, a panel of the ways Claude can run: the company's gateway only, else an LLM gateway, a Claude subscription, an Anthropic API key or AWS Bedrock; no Codex only since 0.4.3), or Not Now (`agenticWorks.connectClaudeNotNow`, hidden from the palette) | Claude is connected (`perch.claudeConnected`), or Not Now runs. It replaced 0.3's Use an LLM gateway (optional) step and its `agenticWorks.gatewayNotNow` *(0.4)* |
| Talk to Claude or Codex | New Claude Tab, New Codex Tab (opened beside the walkthrough, 70/30) | a message is sent from any tab (`perch.messageSent`) *(Sean, 2026-11-24: Agentic Works' installer no longer opens a tab on first start; the user opens the one they want here; either agent works, and the page says how each signs in)* |
| Connect your tools (only with `agenticWorks.companyTools`) | Agentic Works: Connect Your Tools (a panel, `agenticWorks.tools`, one row per MCP server in the company file, each signed in its own way and checked, then registered with Claude Code at user scope; with no servers the command says "Your company file lists no tools."), or Not Now (`agenticWorks.toolsNotNow`, hidden) | every row is connected (`agenticWorks.toolsConnected`, which Agentic Works sets after each change of a row: its check passed and Claude Code was given it), or Not Now runs *(0.4)* |
| Search your code (optional) | Agentic Works: Turn On Codebase Search, or Not Now | either runs; on goes through Agents: Toggle Codebase Search (which checks for a Python) and never turns it off; the installer leaves it off *(Sean, 2026-11-24)* |
| Sign in to Teams | Sign In to Teams (`agenticWorks.teamsSignIn`, hidden): with a company file and a tools row whose `doneWhen.file` is the expanded `teams.signIn.tokenFile`, the Connect Your Tools panel opens and runs that row's sign-in (unless it is connected already); else Teams: Sign In (`chirp.signIn`) | Teams is signed in (`chirp.signedIn`): chirp watches its token file, so a tools row's sign-in ticks it by itself |
| Connect Jira and Confluence | Connect Jira (`agenticWorks.jiraSignIn`, hidden: the matching tools row for `jira.signIn.tokenFile` as Teams does, else Jira: Sign In, `jay.signIn`, which opens the Jira view, whose sign-in form asks for the site URL, email and API token, with a Create one link to Atlassian's API tokens page) | Jira is signed in (`jay.signedIn`) *(Sean, 2026-11-24: no input box at the top)* |
| Sign in to GitHub (without a company file) | Agentic Works: Sign In to GitHub | gh has a login (`kestrel.signedIn`). Since 0.5.18 no terminal: the button runs `gh auth login --hostname github.com --git-protocol https --web` with no terminal and no input (`src/githubSignIn.js`), shows gh's one-time code on the step with Copy code & open and Cancel (from the Command Palette or Connect Your Tools, in a notification), then runs `gh auth setup-git`; once it ends Agentic Works runs `kestrel.refresh` (a failure, the PRs part being off, is ignored), so the PRs tab and the step pick up the login at once, not at kestrel's 30 s retry |
| Choose your parts | Agentic Works: Settings | that command runs |

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
not part of this project: **shared services** in Agentic Works' `src/` ("the ticket or page in front", "open or find a
PR session", "insert text into an agent's message box"), which a part provides and others use through Agentic Works
rather than by another part's command names. That is where the stronger links grow. *(Sean: stronger links
later; the place for them: my call)*

### Settings, from the explorer

The Perch view is an explorer (Sessions, Skills, MCP, Agents, Commands). Agentic Works adds a way to its settings
there *(Sean)*:

- a **gear** in the view's title bar, and a **Settings** row at the end of the explorer's sections;
- both run `agenticWorks.openSettings`, which opens VS Code's Settings filtered to Agentic Works (`@ext:agenticworks.agentic-works`): the
  parts' on/off switches first, then every part's own settings (`agents.*`, `jira.*`, `pullRequests.*`, `teams.*`).
  *(the filter and placement: my call)*

The gear and the row belong to Agentic Works, not to the Perch part, so they stay even if Perch's tabs are the only
part switched on; if the Perch part is off, the same command is in the Command Palette as **Agentic Works: Settings**.

### Installers that set up the four today

An installer that installs the four standalone extensions today must switch to Agentic Works. Installing Agentic Works beside them
would make Agentic Works' parts fail to start (the same command ids registered twice). So such an installer switches from
the four to `agenticworks.agentic-works`, and uninstalls the four, when Agentic Works' first GitHub release exists — not before (Agentic Works
ships through GitHub releases for now; note [102](102-agentic-works-installer.md)). *(my call: release order)*

### State that does not carry over

VS Code keeps an extension's SecretStorage and globalState per extension id, so Agentic Works starts without the
standalone extensions' stored state: **the user signs in to Teams and Jira once more**, and kestrel's hidden-PR
list, Perch's remembered tab state and Gannet's Recent list start empty. Files in `~/.chirp`, `~/.jay` and the agents' own session
records are shared and carry over. No migration of that state. (Settings are shared by every extension, so the
standalone ones' `perch.*`, `chirp.*`, `jay.*`, `kestrel.*` values are there for Agentic Works; since the rename each part
copies them to its new keys once: *Renamed parts and settings*.) *(my call: one sign-in, for one user, is cheaper than
migration code.)*

### Keybindings

A part's keybindings carry the same `when` as its views and commands, so a chord stays unbound while its part is
off. *(build)*

### Tests and packaging

`make test` runs each part's existing suite from its folder (Perch's `make test-offline` and `make test`,
the others' `make test`), plus Agentic Works' own tests: the manifest (a fresh build equals the checked-in one; no
duplicate ids; every view and menu of a part carries its `when`), starting and stopping parts, and isolation.
Adding a part: its folder with `part.json` under `parts/`, then `make manifest` and `make test`. `make package` builds one
`.vsix`; `make install` symlinks Agentic Works into the extension folders as `agenticworks.agentic-works-<version>`, the pattern
Perch uses. Agentic Works starts at version 0.1.0. `make deps` runs `npm ci` against the checked-in root lockfile, then in
each part. The package test (`make test-package`, which packages first) is outside `make test`, which must not need
a built artifact.

vsce reads only the root `.vscodeignore`, so Perch's exclusions moved there: the agents' platform programs (the
Claude Agent SDK's and Codex's per-platform packages, hundreds of megabytes; Perch runs the ones inside the
vendors' own extensions), source maps, Markdown, lockfiles, tests, docs, `__pycache__`, Perch's audio companion,
and the files only the manifest build reads (`agentic-works.json`, `agentic-works.contributes.json`, `.gitignore`). Excluding
`node_modules/**/*.md` also dropped licence files (the Claude Agent SDK's licence is its README), so scoped `!`
lines bring every dependency's `LICENSE*`/`LICENCE*` back without re-including the agents' programs. The `.vsix`
went from 495 MB to 10 MB; the package test checks the exclusions, the licence files and a size under 20 MB.
The root `LICENSE` is MIT (Sean Ahn, 2026), as each part's is.

### Renamed parts and settings (2026-11-23)

Built as 0.1.0, the parts kept their standalone names. Then *(Sean, 2026-11-23)*:

| folder (was) | part id | settings | Command Palette titles |
|---|---|---|---|
| `parts/agents` (`parts/perch`) | `agents` (was `perch`; switch `agenticWorks.agents.enabled`) | `perch.*` → `agents.*` | "Perch: …" → "Agents: …" |
| `parts/teams` (`parts/chirp`) | `teams` | `chirp.*` → `teams.*` | "chirp: …" → "Teams: …" |
| `parts/jira` (`parts/jay`) | `jira` | `jay.*` → `jira.*` | "jay: …" → "Jira: …" |
| `parts/pull-requests` (`parts/kestrel`) | `pullRequests` | `kestrel.*` → `pullRequests.*` | "kestrel: …" → "Pull Requests: …" |
| `parts/repos` (added 1.1.0, from Gannet) | `repos` | `gannet.*` → `repos.*` | "Gannet: …" → "Repos: …" |

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
part (a part does not require Agentic Works' `src/`, so it still runs on its own); Agentic Works' tests check the four copies
match and that each part calls it with its own prefixes. *(the copy per part: my call)*

Not carried over: language-specific values (`"[python]": { "perch.…" }`), and a workspace first opened after the
part's first start (the record is per user, not per workspace).

## Flows

Activation, and switching a part off:

```
 VS Code              Agentic Works activate            part (e.g. chirp)            settings
    |                       |                          |                         |
    |-- activate ---------->|                          |                         |
    |                       |-- register all parts' webview serializers          |
    |                       |-- read agenticWorks.*.enabled ------------------------>   |
    |                       |-- setContext agenticWorks.<part>.failed = false           |
    |                       |   [part off: its restored tabs closed quietly, its saved list kept]
    |                       |-- chirp.activate(own context) ->|                  |
    |                       |   [throws: log, notify once, leave off, setContext agenticWorks.teams.failed = true; others go on]
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
    |                       |-- [it had failed: setContext agenticWorks.teams.failed = false]; its saved tabs come back
```

The import:

```
 /git/perch, chirp, jay, kestrel            /git/agentic-works                        github agenticworks-cloud/agentic-works
    | [phase-green, attachment-note landed on main]   |                              |
    |-- clone; filter-repo → parts/perch; merge ----->|                              |
    |-- … parts/chirp, parts/jay, parts/kestrel ----->|                              |
    |                                                 |-- part.json ×4; Agentic Works src; make manifest (+ npm deps)
    |                                                 |-- npm install; make test (all parts, local)
    |                                                 |   [a test fails: fix in Agentic Works before the first push]
    |                                                 |-- push ----------------------------->|
```

## Settled while planning (2026-11-23)

- Part ids: `perch`, `teams` (chirp), `jira` (jay), `pullRequests` (kestrel); parts are ordered by folder name everywhere.
  (Perch's id became `agents` on 2026-11-23: *Renamed parts and settings*.)
  kestrel's id was `prs` until it became `pullRequests`, so its Settings switch reads "Pull Requests" not "Prs".
- A part's context is the real one with its own `subscriptions` and its folder as `extensionUri`, so each
  part's media and webview resource roots resolve under `parts/<name>/`; `globalState`, `workspaceState` and
  `secrets` are shared (every part already prefixes its keys).
- A part may export `confirmStop()`; Agentic Works calls it before stopping the part, and a `false` puts the switch
  back on. Perch implements it (the modal question while a turn runs).
- For a part that is off, Agentic Works registers a serializer for each of its webview types (from its
  `onWebviewPanel:` activation events) that closes restored panels, and removes it before starting the part.
  Where stopping a part today clears its saved tab list (Perch's `dispose` closing the window), a stop keeps it.
- A part's views, menus, palette entries and keybindings are gated on its setting and `agenticWorks.<id>.failed`
  (`config.agenticWorks.<id>.enabled && !agenticWorks.<id>.failed`), not on a key Agentic Works would set when it starts the part:
  settings context keys exist from the first frame, so icons do not arrive late and restored sidebars are
  not lost. Agentic Works clears every `agenticWorks.<id>.failed` as it starts and sets it for a part that fails; switching a
  part off or on, and closing the window, set no key. *(final review, Ruling 10)*
- Agentic Works' own contributions (the `agenticWorks.openSettings` command and its gear on the Perch view's title) live in
  `agentic-works.contributes.json`, merged by the manifest build. The **Settings** row is in the Perch part's page and
  runs the command; in a standalone Perch the row does nothing visible.
- `make deps / test / test-live / manifest / install / package`; the `.vsix` carries the root `node_modules`
  only; perch-audio is still built and published from `parts/agents/audio` as its own package.

Built: the 0.1 branch; the plan's last commit: 6c40dd9. The plan
(in `docs/superpowers/plans/` at 6c40dd9) is deleted; this note is the record.

## Follow-ups (after this project)

- **An Agentic Works installer** *(Sean, 2026-11-23)*. Built: note [102](102-agentic-works-installer.md). One command for people anywhere that installs VS Code first (the
  OS's package manager or the official download), then the Agentic Works extension, so someone who has never set up an
  editor gets Agentic Works in one step. It turns VS Code's built-in Copilot off (`"chat.disableAIFeatures": true`),
  since Agentic Works' Claude and Codex tabs take its place, skips the Welcome page, and keeps the secondary sidebar
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
  that company's installer, kept outside this repo). Agentic Works
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
    never go into Agentic Works' public repo or installer.
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
  but the key, and the walkthrough is where the person gets the key and pastes it. Agentic Works stays generic: what a
  company's gateway is (its name, addresses, key page, environment) comes from a file its installer writes, never
  from Agentic Works' repo.
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
  *(Sean, 2026-11-24, designing a company installer on Agentic Works: "the walkthrough walks through everything except
  what's already determined" for the company; subscription, API, Bedrock and Codex must work as well as the
  company's gateway; the company's MCP servers get a walkthrough step; one sign-in serves an MCP server and the
  matching part)*. Company details stay out of this repo; they come from one file the company's installer writes.
  - **The company file**, `~/.config/agentic-works/company.json`: `name`; `gateway` (the preset above: `name`, `baseUrls`,
    `keyPage`, `requiredModel`, `env`, `keyFiles`, plus `terminal`: write terminal `claude`'s settings by default, and
    `routerPrefixes`: model-id prefixes the gateway menu groups as Routers, default none);
    `mcpServers`: a list of `{ id, name, about, register, connect }`, where `register` is what Claude Code is
    given (`http` with a URL and headers, `${token}` standing for the token; or `stdio` with a command and env) and
    `connect` is how it gets signed in: `tokenPage` (a page to open, the token pasted, a check request), `command`
    (a sign-in command run in a terminal, done when a file appears), `mcpTool` (the server's own sign-in tool: Agentic Works
    starts the server over stdio, calls the tool, shows what it returns, such as a device code, then calls it again
    with the `complete` arguments; for servers whose sign-in is a tool, with no command of its own), or `none`; and
    an optional `check` (a request, an MCP tool call that needs the sign-in, or a status command): a row is
    connected only once its check passes, not because a file exists. Read at start; context key
    `agenticWorks.company` when valid; a note in the Agentic Works output channel when it doesn't parse.
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
    rewritten to it, only while it still holds the address Agentic Works wrote there; a value the user changed is theirs, and
    the key is never added. *(Sean, 2026-11-24: no launcher; Agentic Works' installer installs the claude CLI, at
    `~/.local/bin/claude`, which Claude Code's updater rewrites.)*
  - **Connect your tools** *(company file with `mcpServers` only)*, after *Talk to Claude or Codex*: a panel, one
    row per server (name, what it gives the agent, connected or not, a button). `tokenPage`: open, paste, check,
    save; `command`: run in a VS Code terminal, connected when its file appears; then the server is registered
    with Claude Code at user scope, as `claude mcp add` would. Ticked when every row is connected, or **Not Now**.
  - **One sign-in, two uses:** a company installer can point Teams' and Jira's token-file settings at the files
    the matching MCP servers' sign-ins write. Those steps then tick by themselves after *Connect your tools*; with a
    company file, their buttons run the matching tools row instead of the part's own sign-in.
  - **A company installer layered on Agentic Works'** must never pass `--yes` (it would answer "uninstall the standalone
    four?" for the user), and should refuse a machine it wasn't meant for rather than migrate it.
  - Also: the installer installs `git` explicitly, when `git --version` doesn't run (note 102, step 4a).
  - Also found: the installer adds Homebrew's `brew shellenv` to the login profile only when VS Code came from
    Homebrew; it should whenever Homebrew was used (`gh` from Homebrew is otherwise not on new terminals' PATH, nor
    VS Code's, on a Mac whose profile lacks it).
  - **Settled while planning 0.4** *(my calls, 2026-11-24; the 0.4 plan)*:
    - *Company file.* `AGENTIC_WORKS_COMPANY_FILE` overrides the path. Any error makes the whole file invalid (the note names
      the path, `mcpServers[1].connect.kind: …`); unknown keys are ignored; `~` expands in key files, commands and
      `doneWhen` files; `${token}` is allowed only in a `tokenPage` server's `register`. `check` and `doneWhen` sit
      inside `connect`. A second context key, `agenticWorks.companyTools`, gates *Connect your tools*. The Agents part reads
      the file through its own copy of `src/company.js` (a part never requires Agentic Works' `src/`), checked identical.
    - *Key check.* A probe or check waits 3 s per address at a tab start, 10 s in a form. A 401/403 from the first
      address is final. `requiredModel` matches with a leading `anthropic/` ignored. Without a company gateway the
      form checks too, and only on an *unexpected answer* (a gateway with no `/v1/models`) offers **Save anyway**.
      At a tab start with no address answering, the tab uses the gateway file's address, with no note.
    - *Terminal `claude`* is written only when a connection is saved, so `apiKeyHelper` never points at a key that
      doesn't exist yet (the first *Open* above). There is no launcher (Sean, 2026-11-24: Agentic Works' installer installs
      the claude CLI at `~/.local/bin/claude`, and its updater rewrites that path): `settings.json` gets the address
      that answered, kept current as above (`syncTerminalBaseUrl`; the record of what Agentic Works wrote is globalState's
      `perch.terminal.written`). The key file for `apiKeyHelper` is `keyFiles[0]`, else
      `~/.config/agentic-works/gateway-key`. Agentic Works records what it wrote: a later choice removes Agentic Works' own values and treats
      any other value as the user's (shown, masked when its name says token, key or secret, and replaced only on
      **Replace**). A settings file that isn't a plain JSON object is never rewritten. Agents treats any `apiKeyHelper`
      in `settings.json` as a pinned machine (non-gateway tabs then take it off).
    - *Connect Claude* is an Agents panel (`perch.connectClaude`); its gateway way opens the gateway form. The choice is
      recorded (`perch.claude.connection`) and new Claude tabs follow it until a tab's footer picks a backend. The
      Anthropic API key lives in `~/.config/agentic-works/anthropic-key` and reaches a tab as `ANTHROPIC_API_KEY` (a third
      tab backend, `apiKey`; the footer's menu is unchanged). Bedrock is checked with the AWS CLI
      (`aws bedrock list-foundation-models --by-provider anthropic`); without the CLI it offers **Save anyway**; an
      expired SSO sign-in names `aws sso login`. With nothing recorded, the step counts as done when a gateway is ready
      or Claude can already run.
    - *Connect your tools* lives in Agentic Works' `src/`, not a part. Registration writes `~/.claude.json`'s `mcpServers`
      directly (re-read just before, atomic), rather than running `claude mcp add`, so a token is never in argv; a
      different entry of the same name is replaced only on **Replace**. `tokenPage` tokens are kept in
      `~/.config/agentic-works/tokens/<id>`. With no `check`, a row is connected when its `doneWhen` file exists (`none`:
      always). `mcpTool` uses one server process for both calls (60 s, then 15 minutes for `complete`); the code and
      link are picked from the tool's text. Checks run when the panel opens and after a sign-in, not at start (VS
      Code keeps a ticked step).
    - *Teams and Jira buttons* find their tools row by file: the row whose `doneWhen` file is the part's
      `signIn.tokenFile`.
    - *Order:* Connect Claude, Talk to Claude or Codex, Connect your tools, Search your code, Teams, Jira, GitHub,
      Choose your parts. `agenticWorks.gatewayNotNow` becomes `agenticWorks.connectClaudeNotNow`.
    - *Installer:* git is checked without running Apple's `/usr/bin/git` shim when the Command Line Tools are missing;
      on a Mac without Homebrew it runs `xcode-select --install` and waits up to 10 minutes. "Homebrew was used" means
      this run installed something with it, or `code`, `gh` or `git` comes from it; its shellenv goes in a block of
      its own, step `homebrew`, with no line when Homebrew wasn't used.

  - **Built (0.4.0), rulings made during the build and the final fixes** *(Sean's and mine, 2026-11-24; each: the
    ruling, why, and the cost if wrong)*:
    - *R1, no launcher.* Nothing is put at `~/.local/bin/claude`: Claude Code's CLI lives there and its updater
      rewrites it. Terminal `claude`'s address is kept current by Agentic Works instead (`syncTerminalBaseUrl`, after each
      successful re-probe at a gateway tab start and at activation), and only while the value is the one Agentic Works wrote.
      `desiredSettings('gateway')` always sets `env.ANTHROPIC_BASE_URL`. Sean chose it. If wrong: off the VPN with VS
      Code closed, terminal `claude` points at the last address until VS Code starts.
    - *R2, the installer installs the Claude Code CLI.* Step `claude` (after companions) downloads Anthropic's
      official installer and runs it (as Homebrew's is), when `claude` isn't on the PATH; `~/.local/bin` joins Agentic Works'
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
      copies, since a part never requires Agentic Works' `src/` (as with `settingsCarryOver.js`); a test catches drift. If
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
    - *A failed command sign-in ends the wait (Sean, 2026-11-27; built in 1.0.2).* Closing the Atlassian window
      mid-sign-in left the row on "Connecting…" until the terminal was closed. Now, where shell integration reports
      the command's exit code, an error ends the wait at once: the row says "The sign-in stopped before it finished;
      its terminal says why. Press the button to try again." and its button (e.g. Sign in with Atlassian) is the
      retry. The failed terminal stays open to be read, and is replaced when the sign-in is tried again. Without
      shell integration, closing the terminal still ends the wait, as before.
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
  - **Plan:** the 0.4 plan in `docs/superpowers/plans/` at bb25a76.
    Built: branch `feat/agentic-works-0.4`, merged directly, with no PR. The plan is deleted; this note is the record.

- **GitHub first, tools installed from the walkthrough (design, for 0.4.3; Built (0.4.3), below)** *(Sean, 2026-11-24: "gh auth login, why
  can't we put this as the first step of the walkthrough?"; "even codex, we can open a new codex tab and use the sub
  pill to configure")*. The terminal asks nothing but the Mac password; every sign-in is in VS Code.
  - **Installer:** no GitHub sign-in question; `gh` is still installed. The walkthrough's GitHub step signs in.
  - **Walkthrough with a company file:** **Sign in to GitHub** is the first step (a second copy of the step, `when`
    `agenticWorks.company`; the existing one keeps its place, `when` `!agenticWorks.company`; both tick on `kestrel.signedIn`).
    **Connect Claude** then offers the company's gateway only: **Codex only** goes too, since a Codex tab's footer
    already offers ChatGPT login, an OpenAI API key or Bedrock; the footer line names both.
  - **Tools installed from the panel:** a server's optional `install` in the company file:
    `{ "github": { "repo": "owner/name", "tag": "latest" | "<tag>", "assets": { "darwin-arm64": "<asset>",
    "darwin-x64": …, "linux-x64": …, "linux-arm64": … } }, "to": "~/.local/bin/<name>" }`. When `register.command`
    (or `to`) is missing, **Connect** first runs `gh release download` (argv, no shell; the platform's asset; to a temp
    file, then moved to `to`, mode 0755), then signs in. `gh` not signed in: the row says "Sign in to GitHub first",
    with that step's button. A platform with no asset: the row says so.
  - **A company installer** then only installs Agentic Works and writes the company file.
  - **Built (0.4.3)**, with what differs from the design above *(my calls unless marked)*:
    - *Installer.* `ensure_github` installs gh and asks nothing; `on_terminal` went with the question. Signed in, the
      line under ✓ GitHub says `signed in as <login>`; not signed in, `sign in from Agentic Works' walkthrough in VS Code
      (Sign in to GitHub)`. `--yes` no longer mentions GitHub. Note 102, step 4b, has it.
    - *Walkthrough.* The first copy is step `githubFirst`, `when` `agenticWorks.company && config.agenticWorks.pullRequests.enabled
      && !agenticWorks.pullRequests.failed` (it needs the PRs part, as the other copy does); its text says the company's
      tools may download through it. Both copies share `media/walkthrough/github.md`.
    - *No Codex only at all* *(Sean, 2026-11-24)*: not only with a company gateway. Without a company file it did
      nothing **Not Now** doesn't. The page and the walkthrough say instead: "Only using Codex? Click Not Now, then
      open a Codex tab: its footer signs you in (ChatGPT login, an OpenAI API key or Bedrock)." Gone with it: the
      host's `codex` message, the terminal box's `offered` flag (always shown now) and `isConnected`'s `codex` case, so
      a connection recorded as `codex` before 0.4.3 counts as none recorded (a gateway that is ready or a Claude that
      can run). With a company gateway the footer line reads: "Using your own Claude subscription, an API key or
      Bedrock, or Codex? Switch any tab's backend in its footer whenever you like; a Codex tab's footer offers ChatGPT
      login, an OpenAI API key or Bedrock."
    - *install.* Validated in `company.js` (both copies): `repo` matches `^[\w.-]+/[\w.-]+$`; `tag` defaults to
      `latest` and may not start with `-`; `assets` keys other than the four platforms are ignored, and a name may
      not hold `/` or start with `-`; `to` expands `~` and must then be absolute. Needed when `to`, or a stdio
      `register.command` that is a path, is missing. Only a button downloads (Connect, or a tokenPage row's Check and
      save or Connect); a check on opening the panel says "Not installed yet: Connect downloads it." Order: no asset
      for `process.platform-process.arch` ("No download of <name> for this computer (<platform>)."), then
      `gh auth status` (failing: "Sign in to GitHub first.", the row's `action: 'githubSignIn'`, whose **Sign In to
      GitHub** button runs `agenticWorks.githubSignIn`), then `gh release download [<tag>] --repo --pattern <asset> --output
      <tmp>` through the injected runner (argv, no shell, 5 min). `gh release download` with no tag downloads from
      the latest release (its `--help`; `--pattern` is then required, and given), so no `gh release view` step. The
      file is copied beside `to`, chmod 0755, renamed over it; the temp directory is removed. A failure is "The
      download of <name> failed: <gh's last stderr line>", with `gh[pousr]_…` and `github_pat_…` cut to the prefix;
      gh missing is said as such. Tests: `test/tools.test.js` with a fake runner (already there; downloaded, latest
      and a tag; not signed in, then signed in; no asset; download fails; gh missing).
    - *Not checked live:* a real `gh release download` of a private release, and the walkthrough's two GitHub steps
      in a real VS Code.

- **A Get started page of Agentic Works' own, everything in place — Built (0.5.0)** *(Sean, 2026-11-24, on the first run of a
  company's installer: "can we change the wording to Get Started with <the company>? and, instead of Connect Claude,
  Connect <the company's> Gateway, and do not open another form. do the whole thing in place"; the names are left out,
  as the guard test asks)*. VS Code's walkthrough can't do either: its text is
  fixed when Agentic Works is built (and Agentic Works names no company), and its detail pane holds no input fields. So Agentic Works shows its
  own page.
  - **The page:** a webview editor tab, **Get started**, opened by Agentic Works' first start in place of the walkthrough, and
    by **Agentic Works: Get Started**. One column of steps; each expands in place with its own controls and ticks when done
    (the same completion signals as today's steps: `kestrel.signedIn`, `perch.gatewayReady` / `perch.claudeConnected`,
    `perch.messageSent`, `agenticWorks.toolsConnected`, `chirp.signedIn`, `jay.signedIn`, codebase search's choice). No step
    opens another panel: GitHub's sign-in button, the gateway key field with **Get a key** and **Check and save**,
    Connect Claude's ways, the tools rows with their token fields and codes, Jira's site/email/token, the codebase
    search choice, and the part switches are all inline. A sign-in that needs the browser or a terminal (gh, Claude's
    login, a tools command) still opens it; the step shows it is waiting and ticks when done.
  - **Words from the company file:** optional `title` ("Get started with <title>", default "Agentic Works"), and optional
    step names: `steps.gateway` (e.g. "Connect <the gateway's name>"; default "Connect Claude"), `steps.tools`
    (default "Connect your tools"), and, since 0.5.1, `steps.talk` (e.g. "Talk to <the gateway's name>"; default
    "Talk to Claude or Codex") *(Sean, 2026-11-24)*. Without a company file: "Get started with Agentic Works" and Agentic Works' own step names. The
    repo names no company; the guard test still applies.
  - **Steps and order:** with a company file: GitHub, the gateway (the company's only: key field in place), Talk to
    Claude or Codex, Connect your tools (when it lists servers), Teams, Jira, Search your code, Choose your parts.
    Without one: Connect Claude (subscription, gateway, API key, Bedrock inline), Talk to Claude or Codex, Teams, Jira,
    GitHub, Search your code, Choose your parts. Steps of a part that is off are hidden, as today.
  - **The pieces it reuses:** the logic behind today's panels (the gateway check and save, Connect Claude's ways, the
    Tools rows, Jira's sign-in) is moved behind one host that the page talks to; the separate panels stay reachable
    from their commands for later use, but the page never opens them.
  - **VS Code's walkthrough** *(my call)*: kept as it is on the Welcome page, as a fallback and for people who look
    there; first start opens the page instead.
  - **Settled while planning 0.5** *(my calls, 2026-11-24; the 0.5 plan)*:
    - *How the page reaches the parts' logic.* Through commands the parts register, taking arguments and returning
      results: the pattern the parts already use with each other (`jay.openTicket` returns whether it opened,
      `jay.projectKeys` the keys, `perch.findPrSession` a session). `perch.connectClaude.request(msg)` takes one of the
      Connect Claude panel's messages, or one of the gateway form's renamed (`gatewayReady`, `getKey`, `gatewaySave`),
      and returns the replies that panel would have been posted (the form's renamed `gatewayState`, `gatewayError`,
      `gatewayVerdict`, `gatewaySaved`); `jay.signInWith({site, email, token})` returns the sign-in form's message, or
      null once signed in. So the panels and the page run one host code path, and the separate panels keep working.
      Both commands are contributed with `commandPalette` `when: false`, as jay's are. Not message-passing commands
      with callbacks: a reply that arrives late (Claude's subscription login) simply resolves the request later.
      Why: no new mechanism, and a part still never requires Agentic Works' `src/`. Cost if wrong: a part's later page message
      needs its request command taught it too.
    - *Secrets across the bridge.* A key goes page → Agentic Works' host → the part's command, in the extension host's own
      process (a command an extension runs that is registered in the same host is called directly, never sent out),
      never in argv; the parts' replies never hold one, so neither does anything Agentic Works posts. Agentic Works logs a message's
      `type` and an error's text, never its fields. Typed secret fields are emptied as they are sent.
    - *The Agents page context is the page's own.* Connect Claude's host keeps the page's choices (terminal box,
      pending Replace/Keep, Bedrock picked) apart from the panel's; a gateway saved from the page records the gateway
      way there, and the open panel's listener ignores it. Each reply goes to the request that caused it.
    - *Completion signals.* VS Code has no way to read a context key back, so Agentic Works watches the parts' `setContext`
      calls for `kestrel.signedIn`, `perch.gatewayReady`, `perch.claudeConnected`, `perch.messageSent`,
      `chirp.signedIn` and `jay.signedIn`, by wrapping `vscode.commands.executeCommand` before any part starts, as it
      already wraps `registerWebviewPanelSerializer` (the parts share Agentic Works' `vscode` object). Where it cannot be
      wrapped, that is logged and those steps tick only from Agentic Works' own knowledge. `agenticWorks.toolsConnected` and codebase
      search's setting are Agentic Works' own.
    - *Done is kept.* A step once done stays done, in globalState `agenticWorks.getStarted.done`, as VS Code keeps a ticked
      walkthrough step (`perch.messageSent` is per window). Not Now, Turn On and Settings on the page run the
      walkthrough's own commands, so its `onCommand:` ticks follow. Choose your parts ticks on a switch, Done or All
      settings.
    - *The page.* An editor tab, view type `agenticWorks.getStarted`, title **Get started**, one at a time, kept alive when
      hidden (`retainContextWhenHidden`), not brought back after a reload (no serializer, as Connect Your Tools).
      Heading `Get started with <title>` (`Agentic Works` without a company file or `title`). The first step shown that isn't
      done is open, the others closed with their tick; any can be opened. First start opens it where it opened the
      walkthrough; **Agentic Works: Get Started** opens it; the walkthrough stays reachable from VS Code's Welcome page only.
    - *The company file's words.* `title` and `steps` are optional; `title`, `steps.gateway`, `steps.tools` (and since 0.5.1
      `steps.talk`) must be non-empty strings when present (otherwise the whole file is invalid, as before); other `steps` keys are ignored.
    - *Steps shown.* As the walkthrough: while the part is switched on and not failed (GitHub: Pull Requests; Connect
      Claude, Talk to Claude or Codex, Search your code: Agents; Connect your tools: company tools listed). A company
      file without a gateway keeps the company order, and its Claude step offers every way, as the panel does.
    - *Steps in place.* GitHub: Sign in, or with a login "Signed in as …" and Add Another Account; the step waits while
      gh's terminal is open. Teams and Jira with a tools row for their token file: that row, shown and signed in in the
      step, without opening Connect Your Tools. Teams otherwise runs its own sign-in (the browser) and waits for
      `chirp.signedIn`. Jira otherwise: the site, email and API token form in place, through `jay.signInWith`; with a
      token file of its own and no row, Jira's own Sign In. Choose your parts: a switch per part, written at the user
      level (Agents' stop question may put it back; the page follows the setting), Done, and All settings.
    - *A part that isn't running.* A request whose command isn't there says "<part title> isn't running." in its step;
      a reply that comes after the page closed is dropped.
    - *Shared rows.* Connect Your Tools' rows are one script (`src/toolsRows.js`) used by both of Agentic Works' pages.

  - **Built (0.5.0), rulings made during the build and the final fixes** *(my calls unless marked; each: the ruling,
    why, and the cost if wrong; the 0.5 plan in docs/superpowers/plans/ at 9934915)*:
    - *Context keys are watched by wrapping `vscode.commands.executeCommand`.* It is the same pattern as wrapping
      `vscode.window` for `trackSerializers` (shipped and live since 0.1), and the parts load inside Agentic Works' extension,
      so they share its `vscode` object. If wrong: the Get started steps don't tick live. **To verify on the first live
      0.5 run.**
    - *Not Now, and Replace/Keep Mine, show in both modes.* The walkthrough's Not Now exists either way, and terminal
      settings conflicts happen with a company gateway too. If wrong: an extra button.
    - *The just-typed gateway token is held in page memory until the next reply* (never in the DOM, never sent back by the
      host), so Save anyway works; the secrets rule is about host to page. If wrong: brief extra exposure inside the
      webview.
    - *The final whole-branch review runs before Task 9*, because closing deletes the plan the reviewer needs (as in
      0.4). If wrong: nothing.
    - *Final fixes:*
      - Claude's login shows a waiting line, "Signing in to Claude in the terminal…", from the moment the request is out
        until it ends (a counter dropped in a `finally`, so an error clears it).
      - Teams shows a note, "Teams isn't signed in. Try again, or see the Teams view for why.", when `chirp.signIn`
        resolves but `chirp.signedIn` isn't true; the note clears on the next try and once signed in.
      - The page's held gateway token is always cleared (on any verdict, error or "isn't running" answer), except where
        Save anyway still needs it.
      - A key or token goes only to a part that is running (`running(id)`: Agentic Works' part state is `on`, set when activate
        has finished); otherwise the answer is "<part> isn't running." and no command is called.
      - A later error after a good gateway save keeps `gatewaySaved` in `perch.connectClaude.request`'s replies.
      - `AGENTIC_WORKS_TEST_HARNESS_STRICT_GH` replaces the old test guard name (`AGENTIC_WORKS_TEST`) for the gh guard in
        `src/extension.js`, the Makefile, `test/vscodeStub.js` and `test/realParts.test.js`.
    - *Known limits:* a second Sign In to Teams while one is going gets a wrong not-signed-in note until
      `chirp.signedIn` arrives; the interim verdict from Agents ("this panel notes it when you are done") can still reach
      the page for a moment.
  - **Built (0.5.0), not checked live.** Everything above was run by the offline tests only (`make test`): the page in
    a real VS Code; whether Agentic Works watching the parts' context keys works in a real extension host (the ruling to verify
    on the first live run); a real gateway, or a real sign-in (GitHub, Teams, Jira, Claude) through the page.

- **A key helper for the company gateway — Built (0.5.1)** *(Sean, 2026-11-24: get the gateway key automatically
  — "if [the] key does not exist yet, create one, get the key, if exist, refresh it, get the key"; "if for any
  reason cannot create or replace, what do we show to user?")*. A company file's `gateway.keyCommand` (optional,
  argv: first word absolute or `~/`) names a program that prints a fresh key on stdout and nothing else, progress
  and errors on stderr; exit 0 with a key, 2 when the person didn't finish signing in, anything else a failure.
  - **Get a key** runs it (argv, no shell; stdin closed; a timeout of 12 minutes, since a sign-in window may be open)
    while the step says "Getting your <gateway name> key…". On exit 0 the key goes straight to **Check and save**
    (never shown, never logged, never in argv); its verdicts are the usual ones.
  - **When it can't:** the step says "Couldn't get a key automatically:" and the program's last stderr line
    (anything key-shaped masked, one line, at most 200 characters); exit 2 reads "The sign-in wasn't completed.";
    a program that isn't there reads "The key helper isn't installed."; a timeout reads "That took too long." Then,
    always: **Try again**, and the manual way: **Open the key page**, the key field and **Check and save**. Nothing
    dead-ends.
  - A company's own helper (outside this repo) writes plain reasons for its cases: a key limit, the page changed,
    the gateway unreachable.
  - **Built (0.5.1), and where it differs** *(my calls unless marked)*:
    - *Where it runs: the Agents part.* `getKey` (the panel's and `perch.connectClaude.request`'s) runs the helper
      when the company gateway has a `keyCommand` (`parts/agents/src/keyCommand.js`, spawn with no shell, stdin
      `'ignore'`, stdout capped at 64 KiB, detached as a process group of its own; answered at its exit after a
      200 ms drain, not at its pipes' close, so a browser or refresher it leaves behind can't hold it open; that
      leftover group is stopped then; at the timeout the whole group gets SIGTERM, then SIGKILL) and hands the key to
      `saveGatewayForm`, the pasted key's path. The key never reaches Agentic Works' `src/`, a page or the log. Without a
      `keyCommand`, `getKey` opens the key page as before. A new request, `keyPage`, opens the key page either way
      (the manual way's button). A failure is answered `keyFailed {text}` (`gatewayKeyFailed` to Get started).
    - *The waiting line.* On Get started it is the host's step line, as Claude's login has it (a counter while a
      `getKey` with a helper is out); the panel shows its own. One helper at a time: a second Get a key while one
      runs (from the other page) is answered "A key is already being fetched; wait for it to finish."; the button is
      disabled meanwhile on the page that asked.
    - *The manual way when a helper exists* is behind **Paste a key instead**, and is shown by any failure, by
      the reason or by a verdict on the helper's key (the gateway rejected it), with Get a key renamed **Try again**.
    - *Reasons beyond the spec:* exit 0 with nothing printed reads "…: the key helper printed no key."; more than
      64 KiB on stdout reads "…: the key helper printed more than a key."; a failure with no stderr names the exit
      code. Masking replaces `sk-…` and any run of 20 or more characters (quotes, brackets and commas end a run) with
      "…", so a long URL or path in a reason is masked too. If wrong: a reason less helpful than it could be.
    - *`steps.talk`* *(Sean, 2026-11-24)*: the company file may name the Talk to Claude or Codex step too, like
      `steps.gateway` and `steps.tools`; New Claude Tab there is unchanged.
    - *Not checked live:* a real company helper, a real sign-in window, a real gateway.

- **Step details beside the steps — Built (0.5.2)** *(Sean, 2026-11-24, on the Get started page: "why don't i see the
  detailed information to the right?")*. The walkthrough showed longer text beside the selected step; the page, one
  column, had lost it. Now a details column shows the step last opened or clicked (before any click, the one opened
  for being the first not done): its name, then its text. Wide, the steps keep 680px and the details take the rest,
  up to 560px, sticky; at 1000px or narrower they go under the steps.
  - *The texts:* new, 80–200 words, `media/getstarted/<step id>.md`; the gateway step has `claude-company-gateway.md`
    and `claude-every-way.md`, picked as its controls are. `{{gateway}}` and `{{title}}` are the company file's words.
  - *Rendered in the host by Agentic Works' own small renderer* (`src/stepDetails.js`), not `markdown.api.render`, whose HTML
    isn't sanitized and which needs the built-in Markdown extension *(my call)*. Everything is escaped; the company's
    words are put back escaped after the markdown is made; only https links are kept, and the host opens a clicked
    one with `openExternal` (any other scheme: nothing). Not checked live: the layout in a real VS Code window.

- **Jira pre-filled; Search your code by meaning — Built (0.5.3)** *(Sean, 2026-11-24: "Connect Jira and
  Confluence, the same, use [the company's site] and the email address, we already know. then search your code, remove the
  optional part, say by meaning")*. The company file may hold an optional `jira` section, `{ site, email }`: the
  company's site and the person's email, which the Connect Jira and Confluence form is filled with, so only an API
  token is left to type.
  - *Never a token:* any other key in the section, a token among them, is ignored. A bad value (a site that isn't
    https, an email that doesn't look like one) is dropped with a note in the output; the rest of the file still
    loads, unlike a bad value anywhere else in it *(my call: a wrong prefill is not worth losing the gateway over)*.
  - *The site:* the user-level `jira.site` (`inspect().globalValue`, as the Jira part reads it) wins, else the
    company file's. Before this the page read it with `get()`, which could pick up a workspace's value.
  - *The form:* each of the site and email is filled from the state unless the user has typed another; nothing is
    sent until Sign in. The token is as before: never in the state, emptied as it is sent.
  - *The rename:* Search your code (optional) is now **Search your code by meaning**, on the page and in the
    walkthrough; the step is unchanged (off by default, Turn On or Not Now), and its text still says the by-meaning
    model is installed separately.

- **The talk step opens its own Claude tab; the Teams code in place — Built (0.5.4)** *(Sean, 2026-11-25: "for [the
  company], can we not show the claude or codex button, instead, can we open up a new claude tab?" and "only during
  the walkthrough, can we show the code and copy button in place?")*.
  - *The opt-in:* the company file's `gateway.openTabOnTalk: true` (under `gateway`, beside `terminal`: `steps` holds
    only the steps' names, and the tab is on the gateway). Without it nothing changes.
  - *The talk step with it:* no New Claude Tab / New Codex Tab; its text (and `agents-auto.md`) says a Claude tab
    opens on the gateway by itself. The host opens it (`agenticWorks.newClaudeGatewayTab`, beside the page, through the
    Agents part's new `perch.openGatewayTab`: an open gateway tab is shown rather than another opened, and a new one
    is on the gateway and in an editor whatever the saved backend, which may lag a gateway just saved) when the page
    is open, `perch.gatewayReady` is true now (a Not Now is not it), the step isn't done, Agents is running and no
    Perch tab is open (`perch.sessionCount`, which answers once the wait for restored tabs and the installer's first
    start tab are over). One open at a time, once per window, and never again once one has opened
    (`agenticWorks.getStarted.autoTabOpened`); a failed open is tried again after 1, 3 and 10 s while the page is open.
    With no Perch tab open (`perch.sessionOpen`) and the gateway ready, the step offers **Open Claude Tab**.
  - *The Teams code:* the page's Sign In to Teams calls `chirp.signIn` with `{ inPlace: true }`, so the code opens
    neither the Teams view nor a notification. The Teams part sets `chirp.signInCodeWaiting` while a code waits and
    answers `chirp.signInCode`; the step shows the code large, its address as text, **Copy code & open**
    (`chirp.copyCode`) and **Cancel** (`chirp.cancelSignIn`), and hides them once signed in or cancelled. Only a code
    of the page's own sign-in shows there, and it is never logged. The Teams view and the palette are as before.
- **A sign-in row before its sign-in; a finished step closes — Built (0.5.5)** *(Sean, 2026-11-25: "can we run
  jira-login from [the company setup]? instead of asking user to run it? and connect [the gateway], on completion the
  form does not collapse")*.
  - *Before the first sign-in:* a `command` row whose `doneWhen` file is missing says "Not signed in yet." without
    running its check: the check's own error ("Run 'x-login' first") told the user to run what the row's button runs.
    Once the file exists the check runs as before, and its last stderr line shows when it fails.
  - *The button's label:* `connect.button` (a command or mcpTool row, 1 to 40 characters) replaces "Connect", e.g.
    "Sign in with <provider>". A bad value is dropped with a note, like the jira section's.
  - *A finished step closes:* a step that turns done closes, whether Get started opened it or the user did, and the
    details follow the next open step. A step done from the start, or reopened by hand, is left alone.

- **Skills from the company file; a row with nothing tried yet isn't an error — Built (0.5.6)** *(Sean, 2026-11-25:
  the company installs and registers an MCP server whose release has a bug the agents must work around, so it ships
  the rules too; and "why not connected error message right away, is this intended?")*.
  - *The file:* `skills`, each `{ id, source }` (`src/company.js`; a bad entry makes the file invalid, as a server's).
  - *The pass* (`src/skills.js`, at each start with a valid company file; a missing one changes nothing, so a file
    briefly absent removes nothing): each skill copied to `~/.claude/skills/<id>/` and `~/.agents/skills/<id>/`
    (Codex's user skills); `~/.config/agentic-works/skills.json` holds each copy's file hashes (and executable bits). A copy
    still as recorded is replaced by a new version or removed once dropped; one edited (a link or odd file inside
    counts) or one Agentic Works never wrote is left, with a line in the output. A copy that already matches the source is
    Agentic Works', record or not, so a pass cut short or another window's loses nothing; the record is saved after each
    change, and a lock file (taken over after a minute) keeps windows from running passes at once. A source with a
    link, no `SKILL.md`, over 200 entries or 1 MB isn't used.
  - *Nothing tried yet:* a row not installed, with no token, or not signed in says so in the ordinary colour, without
    "Not connected:" (`notYet` on the row); a check that ran and failed is still red.

- **An email step that the company's sign-ins get — Built (0.5.7)** *(Sean, 2026-11-25: the gateway's sign-in
  window asked for the address; "can we have email entry box in the walk through?", the domain prefilled, and "as a
  separate step, in case, someone opts out from" the gateway)*.
  - *The file:* `email: { domain, env }` and `steps.email` (`src/company.js`; a bad section is dropped with a note).
  - *The step* (company order, after GitHub, only with the section): a box ending in `@<domain>` with the cursor
    before the `@` (since 0.5.15: an empty box showing `your.name@<domain>` in grey, focused when the step opens;
    a bare name gets `@<domain>` on Save), **Save** (an address on the domain, kept lowercase) and **Not Now**; still editable once ticked.
  - *Where it goes:* globalState `agenticWorks.email`, which the parts share (a part's context is made from Agentic Works'); never
    logged. A setting was the other choice, but Agentic Works contributes none of its own today. The Jira form's email starts
    with it. The gateway's `keyCommand` (the Agents part, page and panel alike) and each `command` sign-in's terminal
    get it in the environment variable `env`; a helper may use it to fill in the sign-in page.
  - *Later:* on a managed Mac the address may be known already (Intune or Platform SSO): to look at when the company
    install is tried there.
- **The company's mark in place of Claude's — Built (1.0.2)** *(Sean, 2026-11-27: "the new claude tab button, can we show [the company's] icon
  instead of claude?"; all Claude badges, not only that button)*.
  - *The file:* `icons: { claude | codex: "<file>" | { light, dark } }`, an `.svg` or `.png` beside the company file
    (`src/company.js`; a bad entry is dropped with a note). Agentic Works ships no company's mark: the company's
    installer puts the file next to its company file.
  - *Where it shows:* the Agents part, wherever the kind's badge is (the New Claude Tab buttons, the + menu, the
    footer, the tab strip), as a mask of the light file tinted with the theme's text colour (a vendor's glyph keeps
    its own tint); the editor tabs and the past-sessions list get the light and dark files as they are.
- **Get started comes back until it's finished — Built (0.5.8)** *(Sean, 2026-11-25: closing VS Code mid-walkthrough
  relaunched an empty window, "it becomes like this on next launch?"; and in a folder window too)*. The page isn't
  restored when VS Code restarts, the installer sets `workbench.startupEditor` to none, and an empty window starts with
  the side bar hidden. So each start, while a shown step is neither done nor Not Now'd, opens the Get started page and
  the Perch view as the first start does (not the PRs tab, which stays first-start only).
- **The prompt an answer is for, pinned — Built (0.5.9)** *(Sean, 2026-11-25: in the Perch tab "it's hard to see
  what the response is for"; "follow your scrolling")*. Ported from Perch 0.7.49 (its note 401): a strip above the
  transcript shows the prompt whose answer is at the top of the view, once its bubble has scrolled off; a long one
  shows its last two lines; a click goes to it.
- **Clearer pinned prompt; jay's own ticket tab; tabs kept off a gateway pinned later — Built (0.5.10)**
  *(Sean, 2026-11-25: the pinned prompt was "hard to notice" and "flickering"; "switch back to our own editor for jay
  by default, the one from confluence is ugly"; a subscription tab was answered by the gateway's model)*. The pinned strip is
  brighter with a focus-coloured edge and is only redrawn when its prompt changes (Perch 0.7.50). `jira.ticketView`
  defaults to `"jay"`. A subscription or API tab restarts on its own backend when `~/.claude/settings.json` gains or
  loses a gateway pin while it runs, since a running Claude Code takes up the file's new gateway (Perch 0.7.51).
- **Reactions in Teams — Built (0.5.11)** *(Sean, 2026-11-25: "the chirp does not have a way to tag with reaction";
  "full emoji pickers")*. A click on a reaction adds Sean's or takes it back; hovering a message shows six quick
  reactions and a picker with every emoji, a search, recent ones and a skin tone (parts/teams note 101, "Reacting").
  jay's ticket keys: someone else's in purple, unassigned ones plain, and closer to the expand arrow (jay 0.2.9).
- **Build's task count on the phase pill — Built (0.5.12)** *(ported from Perch 0.7.48, its note 203)*. In Build the
  pill reads "Build 5/9" and the card's Build row "Build — 5 of 9 tasks done", from the SDD ledger the session last
  named. Agentic Works' Get started tests no longer add "hello" sessions to the real session list: the test home keeps its own
  (`aw-test-reset`, outside this repo).
  The pinned prompt lies over the top of the transcript instead of taking its own space, so two prompts close
  together no longer flicker (ported from Perch 0.7.52).
- **Vendor buttons off the editor title bar — Built (0.5.13).** Claude Code and Codex each put an "open" button on
  every editor's title bar, Get started included. On a VS Code that has never been started, the installer's Icons step
  now hides them too, the way a right-click in the title bar does (note 102, step 6).
- **Send "Hello" — Built (0.5.14).** The Get started step that talks to Claude says to send "Hello" rather than "a message".
- **The email box: focused, with an example — Built (0.5.15).** *(Sean, 2026-11-25: "set focus to the email entry",
  "someone@… as background"; a witty name such as fledgling "may get the person confused")* The box is empty with
  `your.name@<domain>` in grey, takes the focus whenever the step opens, and a bare name gets `@<domain>` on Save.
  A company file can show its own format instead: `email.example` ("your.name for one company, but first.last for
  another"); a bad one is ignored with a note. A state refresh no longer moves steps that are already in place,
  which took the focus out of a box being typed in.
- **A company's own words in a step's details — Built (0.5.16).** *(Sean, 2026-11-25: at his company a newcomer makes
  their own GitHub account, then asks its git admins for access; "how will it work with the walkthrough?")* The
  GitHub step ticks on any `gh` login, so a new account signs in at once; repo access is the admins' and shows only as
  an empty PRs tab. The company file's optional `notes` puts the company's own text first in a step's details (keyed
  as `steps` is), rendered by the same escaping renderer. Git runs over HTTPS with gh's sign-in
  (`--git-protocol https`), so no SSH key is needed for the walkthrough.
- **"Hello" typed in the talk step's new tab — Built (0.5.17).** *(Sean, 2026-11-25: "can we type in hello to the
  perch tab and set focus?")* Get started opens the talk step's tab (the gateway tab, Open Claude Tab, New Claude Tab,
  New Codex Tab) with `{ fill: 'Hello' }`; Agents' `perch.openGatewayTab`, `perch.newClaude` and `perch.newCodex` take
  it as the new tab's prefill, which the page types in the box with the focus there, so Enter sends it. A tab already
  open is only shown, nothing typed; any other argument (a menu's URI) opens an empty tab.
- **GitHub's sign-in without a terminal — Built (0.5.18).** *(Sean, 2026-11-25, at the terminal's "Authenticate Git
  with your GitHub credentials? (Y/n)": "do we have to use the terminal? no way to make it easier?")* gh run with no
  terminal and no input asks nothing (checked with gh 2.45): it prints a one-time code and GitHub's device page and
  waits. `src/githubSignIn.js` runs it (argv, `GH_PROMPT_DISABLED=1`, `GH_BROWSER=true` so gh opens nothing itself),
  reads the code, and once gh is done runs `gh auth setup-git` (that question's yes). The step shows the code with
  **Copy code & open** (only GitHub's own device page is opened) and **Cancel**, as Teams' step does; a failure leaves
  gh's last line, never the code; the code's 15 minutes run out with "try again". One sign-in at a time, shared by the
  page and **Agentic Works: Sign In to GitHub** (which shows the code in a notification). Not VS Code's own GitHub sign-in:
  its token belongs to VS Code's app, which can revoke it on sign-out and which a company's GitHub organization would
  have to approve on its own.
- **The pinned prompt looks like the prompt — Built (1.0.2)** *(Sean, 2026-11-27, on the strip over an answer: "the
  following user prompt is still not quite obvious"; "check how claude code cli in vscode or cursor do")*. Claude Code
  (2.1.332) pins the turn's own prompt bubble, unchanged, at the top while its answer scrolls, over a band that fades
  into the answer, and labels nothing. The strip here was a smaller, full-width grey card showing the prompt's last two
  lines, which didn't read as the prompt. Now it is a copy of the bubble that was sent: the bubble's tint, border, shape
  and size, on the right, from the prompt's start, three whole lines at most, over a band of the page's colour
  (`--page-bg`: the sidebar's or the editor's) that fades into the answer. It still lies over the transcript, so
  nothing flickers, and a click still goes to the prompt. *(Kept the overlay rather than true sticky, which would group
  the transcript into turns: my call.)*
- **Get a key says what it is doing, can be cancelled, and survives a reload — Built (1.0.3)** *(Sean, 2026-11-27,
  after a fetch on the saved sign-in looked dead: "the button is doing nothing now"; "yes" to a clearer wait, Cancel,
  and remembering a running fetch)*. The helper's stderr lines are its progress: the Agents part keeps the last one
  (its `name:` prefix dropped, anything key-shaped masked), and Get started asks for it every second
  (`keyStatus` → `gatewayKeyStatus {running, progress}`) and adds it to the step's line as a sentence ("Getting your
  <gateway> key… Sign in in the window that opened."). While it runs the button reads **Getting a key…** and is
  disabled, and **Cancel** beside it sends `cancelKey`, which stops the helper's process group and answers the run
  with "Cancelled." (no trace written); **Try again** and the manual way follow, as for any failure. The state's
  `claude.keyRunning` tells a page opened or reloaded mid-run that a key is being fetched; the page only takes
  *running* from it, so a state sent before a run's answer can't end that run early *(my call)*. The gateway panel
  keeps its own waiting text, without Cancel *(my call: Get started is where the wait was missed)*.
- **A step for the secret check — Built (1.0.4)** *(Sean, 2026-11-27: "agenticworks support secret checks on user
  prompts, right? can we have a step before [the code search] step?"; "by default it should be turned on")*. The Agents
  part's check (note 110 in parts/agents) runs before every message and is on by default, but no one heard of it until
  it fired. **Check messages for secrets** comes just before **Search your code by meaning**, in both orders, while the
  Agents part is on. It says whether the check is on (`agents.secretCheck.enabled`, unset is on), and its details list
  what it catches and the four ways through for a value that only looks like a key: Send anyway, Not a secret (its hash
  kept for good), Off for this repo, and `agents.secretCheck.ignore` for a whole format.
  - On: **Keep it on**. Off: **Turn it on** and **Not Now**; when this workspace's settings turned it off (Off for this
    repo), the step says so. No off button *(Sean: on by default)*.
  - **Turn it on** removes a `false` at the user and workspace levels, so the default holds, rather than writing
    `true` *(my call: a user who never set it keeps no setting)*. A folder's own `false` in a multi-root workspace is
    left; **Agents: Turn the Secret Check On for This Folder** is for that.
  - Done only when a button is pressed, not from the setting, so the step is read once even though the check is
    already on *(my call)*. `notes.secrets` gives the company's own text; the name isn't the company file's to change,
    like the code search step's *(my call)*. Not added to VS Code's walkthrough *(my call: Get started is the page
    people use)*.
- **Gannet as the Repos part — Built (1.1.0)** *(Sean, 2026-11-27: "lets get the gannet merged to agentic works, just
  like teams or jira"; the id `repos`, "we can also have bitbucket later")*. Gannet came in with its history under
  `parts/repos`, as the others did. The part is **Repos** rather than GitHub so a Bitbucket host can join it later
  without a rename *(my call)*. As for the others: settings `gannet.*` → `repos.*`, carried over once; commands
  "Gannet: …" → "Repos: …" and its messages say Repos; command, view, container (`gannet`, titled GitHub) and
  globalState ids, the `gannet:` file scheme and the `gannet-credential` helper keep their names. The installer
  uninstalls a standalone Gannet with the other four. Agentic Works' VS Code floor rose to 1.94, Gannet's.
  - Gannet keeps its per-machine state in files in its global storage, not globalState: `machine.json` (the
    directories, the checkouts it knows, new folders), the `gannet-credential` shim and the token sockets. The part
    uses Agentic Works' own global storage, directly (no subfolder), since the part's code and tests assume a store
    of its own *(my call)*.
  - VS Code deletes an extension's global storage folder when it uninstalls it (`postUninstall` in its
    `extensionLifecycle.ts`), so the standalone's `machine.json` and its shim are gone once Gannet is. The installer
    copies `machine.json` into Agentic Works' global storage before it uninstalls Gannet, unless one is there. The part
    also copies it on its first start if the standalone is still installed (the sibling folder `seanahn.gannet`) and
    this store has none.
  - Repos the standalone checked out name its shim in their `.git/config`. Once, after writing its own shim, the part
    finds the checkouts it knows (from that `machine.json`) whose helper names the standalone's shim, and sets them up
    again with this store's shim and their login, as a new checkout would be *(my call: edit those repos' config, not
    recreate a folder of an uninstalled extension)*. `repos.checkoutsRepointed` in `machine.json` records it. A
    checkout the standalone didn't record, or every one when Gannet was uninstalled by hand, falls back to git's own
    sign-in until checked out again or added to gh. `src/standalone.js`.
  - The retired `gannet.checkoutFolder`, which only the one-time move to directories reads, is still read under its
    old name *(my call)*. The Recent list (globalState) starts empty, as other parts' stored state did.
- **A terminal on first start — Built (1.1.1)** *(Sean, 2026-11-27: the test VS Code sometimes showed no terminal
  area; asked "open the panel once at first start?", "yes")*. VS Code remembers the bottom panel per window and folder,
  and a fresh one may start with it closed; nothing in Agentic Works hides it. On the very first start, after the PRs
  tab, Agentic Works runs `workbench.action.terminal.focus`, which opens the panel on Terminal and starts a shell if
  there is none; the Get started page and the Perch view open after it, so they end up in front. Only once: later
  starts leave the panel as VS Code remembers it *(my call: Terminal is the tab shown, PRs one click away)*.
- **Default directories for Repos — Built (1.1.1)** *(Sean, 2026-11-27: "add /Users/<you>/ as default, unless you see
  some repos under different directory, for instance /Users/<you>/code"; "the same with linux … unless /git folder is
  used for git repos")*. Once per machine, when its list is empty (a new machine, not one carried over from Gannet),
  Repos adds the directories that hold git repos (a folder with at least one child that has `.git`): `/git` on Linux,
  then the folders one level under home, by name, skipping hidden ones and `~/Library`; then home itself if a repo
  sits directly in it. When none hold repos, home alone. `repos.directoriesDefaulted` in `machine.json` records it,
  so a directory removed from the list (its ×, **Remove from List**) stays removed. *(my calls: one level deep; /git
  built in on Linux rather than in the company file, since Sean's rule is for Linux generally; the first-checkout
  question, asked only when the list is empty, still offers `~/github`.)* `defaultDirectories` in
  `parts/repos/src/workspaces.js`.
- **The side bar follows Get started — Built (1.1.1)** *(Sean, 2026-11-27: "show the relevant explorer … as we move
  through walkthrough … when github connection is done switch … to gannet, when everything's done, switch back to
  gannet"; "i meant when the walkthrough finishes")*. While the page is open, a step that becomes done shows its part's
  view container: Sign in to GitHub → Repos (`gannet`), Connect Claude and Talk → Perch, Sign in to Teams → Teams,
  Connect Jira and Confluence → Jira & Confluence; the others have no view of their own and switch nothing. When the
  walkthrough is finished (every shown step done or Not Now'd) the side bar shows Repos instead. Then the page is
  revealed again with focus, so the keyboard stays in it. *(my calls: only a step really done (its signal), not
  Not Now; nothing for steps done before the page first showed its state, so opening the page or restarting VS Code
  never moves the side bar; nothing for a part that is off.)*
- **A refused gateway key is said — Built** *(Sean, 2026-11-27: "Hello" in the first Claude tab only showed Working…;
  the gateway had answered every request 401 "Key is blocked", and Claude Code retried for three minutes)*. The relay
  reads the body of a 401 or 403 as it passes (the response still reaches Claude Code unchanged) and gives the tab the
  gateway's reason, to its first sentence, with token-like words hidden. The first refusal of a turn stops the turn,
  puts the message back in the box, and leaves a note: "The gateway refused this tab's key (401: …). Get a new key,
  then send the message again.", with **Get a Key** (the gateway panel) and **Leave the Gateway**. *(my calls: once a
  turn; 429 and 5xx are not refusals and keep Claude Code's own retrying.)*
- **The side bar says Repos — Built** *(Sean, 2026-11-27, "yes, do that")*. The Repos part's view container was still
  titled GitHub, from the standalone Gannet; it shows repos, GitHub's now and other hosts' later.
- **The installer opens VS Code only on a first install — Built (1.1.3)** *(Sean, 2026-11-27: "when i close the works
  and starts again, it does not remember the layout anymore"; "i don't want my remote ssh one to seclab affected")*.
  Causes: the installer opened `code --new-window`, an empty window whose layout VS Code doesn't keep, and a VS Code
  still running (any window, a Remote one too) never restores windows on a new start. VS Code keeps each folder's and
  workspace's layout itself, so opening it again brings it back. Now:
  - a first install (no Agentic Works before) ends with a plain `code`, which brings back any windows VS Code had;
  - an update or a repair opens nothing; when VS Code is open the summary says "Reload your local VS Code windows to
    use Agentic Works X; Remote windows aren't affected." (a Remote window runs its extensions on its host, which the
    installer never touches);
  - only when the standalone extensions go (they'd clash with Agentic Works in a local window), and VS Code is open, it
    asks once to close the local windows (a Remote window can stay) and press Enter, then goes on.
  *(1.1.2 waited up to three times and said Remote windows could stay, but a Remote window is the same app here
  (`pgrep -x code`; on macOS the app bundle's path) and can't be told apart, so it asked again while one was open.)*
- **The installer's `--profile <name>` — Built (1.1.9)** *(Sean, 2026-11-27: "with c3 works, can we hide it? show
  only what we agreed on")*. A company's installer can put Agentic Works in a VS Code profile of its own, beside the
  user's: the extensions (`code --profile`), the settings and the icon layout go into that profile, and the user's own
  profile is left as it is. The Profile step runs before any extension goes in, and a failure stops the run, so nothing
  lands in the user's profile.
  - VS Code closed: the helper (`vscode-profile <name>`) adds the profile to `storage.json` and makes its folder, with
    the user's settings, keybindings, tasks and snippets copied in.
  - VS Code open: it rewrites `storage.json` from memory, losing a profile written beside it (tried), so a window is
    opened on the name, which makes it; once `storage.json` lists it (up to 30 s), the user's files are copied in
    where the profile's own are blank (`--fill`).
  - A name is letters, digits, spaces, dots, dashes and underscores, up to 40.
  - Each profile has its own state, so it starts with a fresh walkthrough.
- **One window when VS Code is open: `--folder` and `--window-mark` — Built (1.1.10)** *(Sean, 2026-11-27: "it
  started 2 new vscode, first one looks good, second one has trust issue")*. With VS Code open, `--profile` opens a
  window on the name to make the profile; a company's setup that then opened its own folder made a second window.
  - `--folder <dir>` (absolute, there): that window opens on the folder.
  - `--window-mark <file>` (absolute): made when the run opened a window, so the setup around it opens no other.
  - The installer's own open at the end of a first install is left out when it opened that window.
  - Agentic Works starts in that window as soon as it's installed, so the setup puts what it reads when it starts
    (the company file, its skills, the Get started request) there before running the installer.
- **The first terminal in the folder the installer was run in — Built (1.1.9)** *(Sean, 2026-11-27: "the current
  directory in terminal, can it be the original directory?")*. The request file may hold
  `{"terminalCwd": "<absolute folder>"}`; when it names a folder that's there, the first start's terminal opens in it,
  else the usual one.
- **That tab is empty when Talk is done — Built (1.1.8)** *(Sean, 2026-11-27: "do not enter hello message for the
  case")*. The first run's gateway tab has "Hello" typed in only while Talk to the gateway isn't done; someone who has
  talked to it gets an empty tab.
- **A company installer's first run: a terminal, and a chat tab when the gateway works — Built (1.1.7)** *(Sean,
  2026-11-27: "if it's first time, and if the ai gateway's connection is already there, it should open a chat tab, and
  if it's first time, the terminal should always open")*. When the request file is claimed, the start opens a terminal
  as the very first start does, and Get started opens a Claude tab on the gateway with "Hello" typed in once the key is
  known to work, even with Talk done, the tab opened before, or other Perch tabs open (an open gateway tab is shown
  instead). A refused key or no gateway: no tab, and the usual flow (Get a key, then the tab).
- **The gateway's key is checked with the gateway — Built (1.1.6)** *(Sean, 2026-11-27: Get started showed Connect and
  Talk to the company gateway done while the saved key was blocked; "how do we check if the connection is there")*.
  Before, the gateway was "ready" when its file had an address and a key, and nothing asked the gateway.
  - The Agents part asks the gateway (`GET /v1/models`, the key in a header) once per key a window, at start and when
    the file changes. Accepted: ready. Refused (401/403): not ready, and `perch.gatewayRefused` holds the gateway's
    reason (its first sentence without "Authentication Error, "; never the key), or true without one. Not reachable
    (offline, a gateway error): ready, since that says nothing about the key. While it is asked, not ready.
  - A key just saved by the gateway form or Get a key was checked then and isn't asked about again. A tab's 401/403
    asks again, so Get started learns of a key revoked while the window is open.
  - Get started, on a refusal: Connect and Talk are no longer done, the record that the talk step's tab opened is
    cleared, and the Connect step says "<gateway> refused your saved key (<reason>). Get a key to replace it." Once a
    key works, the tab opens by itself with "Hello" typed in, as for someone new (unless a Perch tab is open: then
    Open Claude Tab).
  - Get started's steps column is narrower (300–440px, was 680px) and its details get up to 640px; they stack only
    below 760px (Sean: "the description becomes so squeezed").
  - With a company gateway, Talk is ticked by `perch.gatewayAnswered` (a Claude tab on the gateway had a turn answered),
    no longer by a message sent, which may have been refused.
- **A request file opens Get started once — Built (1.1.5)** *(Sean, 2026-11-27: a new user of a company's setup goes
  through the walkthrough; "there will be some file under user's home directory that tells if it's first time use")*.
  A company's installer leaves `~/.config/agentic-works/open-get-started` (`AGENTIC_WORKS_GET_STARTED_REQUEST`
  overrides it) before opening VS Code on its first run. At start, the first window claims it by renaming it away and
  deleting it, then opens Get started and the Perch view as for steps left, even when every step is done. Only one
  window shows it; later starts follow the steps as before.
- **A Cursor `code` command is never taken for VS Code — Built (1.1.4)** *(Sean, 2026-11-27: "if he was using cursor
  beforehand, what will be the experience?")*. Cursor can put its own `code` on the PATH so `code .` opens Cursor; the
  installer took it for VS Code, put Agentic Works into Cursor and its settings into VS Code's file, which Cursor doesn't
  read. Now `find_code` walks every `code` on the PATH and passes over one that lives, or links, under a Cursor folder
  (the path, lowercased, has `/cursor`); with VS Code there too it uses VS Code's and says "The code command on your PATH
  opens Cursor; Agentic Works uses VS Code's own."; with only Cursor it installs VS Code as for anyone without it. Cursor
  is never run. A folder of one's own named `cursor…` holding a `code` would be passed over too; judged unlikely.
  `works` does the same: it runs the installer with `--no-open` and opens VS Code itself only when Agentic Works
  wasn't installed before.

## Left to the builder

- Where each part's media lives and how its asset paths are resolved under `<part>/` (29 uses of
  `extensionUri`/`asAbsolutePath` across chirp, jay and kestrel).
- Whether each part's `vscodeStub.js` / `test/stubs.js` stays separate or is shared.

## Verification

What was asked:

- `make test` green; a fresh window with Agentic Works and none of the four standalone extensions shows the Perch,
  Teams and Jira & Confluence icons and the PRs panel tab; each part works as its standalone did.
- Turning each part off hides its icon or tab and its commands at once, and stops its polling; turning it on
  brings it back without a reload.
- A part made to throw at start leaves the other three working, with one notification.
- `git log -- parts/perch/src/extension.js` in Agentic Works shows Perch's full history (since the rename:
  `git log --follow -- parts/agents/src/extension.js`).
- A throwaway fifth part (a folder with `part.json` and one view) appears with its own switch after `make
  manifest`, with no other file edited.

What was found (2026-11-23):

  - **0.3.3, from Sean's first-time run with his company's own app:** listing chirp's scopes stopped at "Need
    admin approval" over one the app lacks (`User.ReadBasic.All`; it has `User.Read.All`), since the tenant lets no
    user consent. With a company app chirp now asks for `https://graph.microsoft.com/.default` (plus
    `offline_access` for the sign-in code): exactly what the app was approved for, never a consent prompt. Channels
    are then tried, as with a token file, and a 403 turns them off.
- **History:** after the filter-repo import every source commit of a part's file is in Agentic Works' log of it
  (commit counts 194 / 35 / 21 / 42 for Perch, chirp, jay, kestrel; identical trees and blobs); `make test`'s
  import test checks it against the imported commits.
- **Fifth part:** a throwaway `parts/zz-demo/` (part.json, a view container, a view, a command) got its switch
  `agenticWorks.demo.enabled` after the four, its view gated on it and its command in the palette gated too, and the
  loader found it, with only `package.json` regenerated. The first run failed one of Agentic Works' own tests, which
  listed the four parts by hand; the tests now take the parts from `parts/`, and with the demo present `make
  manifest && make test` passes with nothing but `package.json` and the new folder changed. After removing it,
  `make manifest` gives a byte-identical `package.json`.
- **Live run** (Sean; a separate VS Code 1.129 profile; Agentic Works symlinked by `make install`): a Perch tab ran a
  Claude turn (the vendors' programs were found); the Perch explorer showed the Settings row and the gear; both
  opened Settings filtered to Agentic Works with the four switches first; Teams switched off and on again, its icon back;
  first start opened the PRs panel, which listed a real open PR; Agentic Works' output log stayed empty (no part failure,
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
