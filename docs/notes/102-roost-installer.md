# 102 — The Roost installer

Built, 2026-11-23. Follows note [101](101-roost.md) (*Follow-ups*). How to install: [README.md](../../README.md),
*Install*.

## Intent

Roost exists because many people never get past installing VS Code and finding the right extensions; they pick an
editor that is one download instead (note 101, *Intent*). The installer closes that gap: **download one file, run
it, and VS Code opens with Roost in place**, looking the way Roost is meant to look. *(Sean)*

It is public and generic. A company that wants more (its own LLM gateway, MCP servers, sign-ins) layers its own
installer on top; a company's installer (kept outside this repo) is rebuilt that way, as a layer that runs this one
first. *(Sean)*

### Goals

- **One file, `roost-install.sh`, for macOS and Linux** *(Sean)*: downloaded and run with `bash roost-install.sh`.
  Linux means Ubuntu 22.04+ (and Debian-based), RHEL/Rocky 8 and 9, Fedora. *(distributions: my call, the set the
  company installer already handles plus Fedora)*
- Installs VS Code if it is missing, then Roost and its companion extensions, then sets the look, then opens VS Code.
- Safe to rerun: a second run fixes what is missing and changes nothing that is in place.
- A ✓ / – / ✗ checklist while it runs, the same format as the company installer's (with no company wording).

### Non-goals

- Windows (later, or never). *(Sean)*
- Linux servers reached over Remote-SSH (headless, no desktop VS Code): the next iteration. *(Sean)* Linux here means a
  desktop where VS Code runs on the machine.
- Sign-ins (Claude, Codex, Teams, Jira) and per-part questions: each part signs itself in inside Roost, with its own
  UI, and all parts are on (switched in Roost: Settings). *(my call, Sean: "do as you wish")* GitHub too since
  0.4.3: the installer installs `gh` and Roost's walkthrough signs it in (step 4b). Codebase search was asked here in 0.2.0–0.3.3; it is now off unless `--codebase-search`, and
  Roost's walkthrough offers it (note 101) *(Sean, 2026-11-24)*.
- Anything company-specific: gateways, MCP servers, company apps.
- The Marketplace: Roost is not published there yet. *(Sean: GitHub for now)*
- A graphical installer (`.pkg`, `.deb`): a `.sh` is fine on both systems. *(Sean)*

### Anti-goals

- Changing a working setup: an existing VS Code keeps its settings and its activity-bar layout; an already-set key
  is never overwritten.
- Leaving a half-installed Roost that fails at start (for example beside the standalone four, see below).
- Needing a terminal skill beyond running one command.

## Where it comes from

Each GitHub release of `seanahn/roost` carries two assets: `roost-install.sh` and `roost-<version>.vsix`. *(Sean)*

- The download link is the release's `roost-install.sh`; the README points to
  `https://github.com/seanahn/roost/releases/latest/download/roost-install.sh`.
- The script installs **the `.vsix` of its own release** (its version is written into the script when the release
  is made), downloaded from the same release and checked against a SHA-256 also written into the script. *(my call:
  the script and the extension always match; a tampered or truncated download is refused)*
- Updating Roost = downloading and running the newest installer; Roost does not update itself while it comes from
  GitHub.
- `make release` builds the `.vsix` and writes its version, its SHA-256 and the helper into a copy of the script,
  in `dist/`. `make release-publish` creates the GitHub release with both (`gh release create`). Publishing a
  release is Sean's action.

## What it does, in order

1. **Platform.** macOS (arm64, x86_64), or Linux by `/etc/os-release`; anything else stops with the supported list.
   Run with `sudo` (root, with `SUDO_USER` someone else), it stops here too: `✗ Platform: Run it without sudo: bash
   roost-install.sh — it asks for your password when it needs it.` (VS Code's settings, the PATH block and the
   extensions would otherwise go to root). Root itself (a container) runs as below.
2. **VS Code.** If `code` is missing: macOS — Homebrew (`brew install --cask visual-studio-code`), installing
   Homebrew first if needed; Ubuntu/Debian — Microsoft's apt repository; RHEL/Rocky/Fedora — Microsoft's yum
   repository; a repository already listed by any apt source (as VS Code's own package adds one) is not added
   again. Then make sure `code` is on the PATH for this run and for new terminals (one marked block in the
   login profile, as the company installer does). An existing VS Code is used as it is.
3. **The standalone four.** If any of `seanahn.perch`, `seanahn.chirp`, `seanahn.jay`, `seanahn.kestrel-prs` is
   installed, Roost's matching parts would fail to start (the same command ids twice). The installer lists them and
   asks: **Uninstall them and use Roost** (default) / **Stop**. Their settings, files under `~/.chirp` and `~/.jay`,
   and agent sessions stay; only the extensions go. *(my call)* Their `perch.*`, `chirp.*`, `jay.*` and `kestrel.*`
   settings are copied to Roost's `agents.*`, `teams.*`, `jira.*` and `pullRequests.*` by each part on its first
   start (note 101, *Renamed parts and settings*); the installer writes no part settings itself. **Stop** skips steps 4–7 (Roost, GitHub, the look,
   the icons, opening VS Code) and exits 1 — GitHub too, since gh is for Roost's PRs panel; a VS Code installed in step 2 stays, which is harmless. With no terminal to
   ask on (a pipe, a layer), the run stops the same way unless `--yes` was given, which answers Uninstall. If an
   uninstall fails, Roost is not installed (a clash is worse than no Roost) and the run says which one is left.
4. **Roost.** If the same version is installed: `✓ (already)`. An older one: upgrade, then say "Reload any open VS
   Code window to use the new version." A newer one (an old installer run again): leave it and say so. *(my call)*
   Otherwise download the release's `.vsix` (on Ubuntu/Debian, installing curl first if a minimal system has none),
   check its SHA-256, `code --install-extension`. A download that fails (network, proxy, a missing release) or does
   not match is `✗`, the file deleted, nothing installed. Then install the
   companions by id from the Marketplace if missing: `anthropic.claude-code`, `openai.chatgpt` (Perch runs their
   `claude` and `codex`) and `seanahn.perch-audio`. *(my call: explicitly, rather than trusting a `.vsix`'s
   extension pack to pull them; in practice the `.vsix`'s extension pack has already installed them, so the line is
   usually `✓ Companions (already)`)* A companion that cannot be installed (the Marketplace blocked, say) is `✗` with its
   name; Roost still works, but Perch's tabs need Claude Code or ChatGPT to run an agent, which the line says. With
   the Marketplace blocked, Roost's own install fails too (VS Code fetches its extension pack, the companions, as it
   installs the `.vsix`): `✗ Roost: VS Code couldn't install it; it also fetches Claude Code, ChatGPT and Perch's
   audio from the Marketplace, which may be unreachable from here — see <log>`, and the companions' line then
   leaves out "Roost still works".
4.5. **Claude Code's command-line tool** *(Sean, 2026-11-24; for 0.4)*. The Claude Code extension is not the
   `claude` command, so a terminal (and a Roost terminal tab) has none. The step is `✓ Claude Code CLI (already)`
   when `claude` resolves on the PATH or `~/.local/bin/claude` exists. Otherwise it downloads Anthropic's own installer,
   `https://claude.ai/install.sh`, to a temp file with `curl` and then runs it with `bash` (downloaded first, never
   piped, as Homebrew's is; on Ubuntu/Debian curl is installed first when a minimal system has none), confirms
   `~/.local/bin/claude` exists, and says `✓ Claude Code CLI (installed)`; else `✗ Claude Code CLI: couldn't be
   installed; see <log>`. Anthropic's installer runs as the user, without sudo; only the curl install before it does,
   and is in the up-front sudo list when the claude step will run (final review, 0.4). For new terminals, `~/.local/bin` goes into Roost's marked PATH block
   in the login profile (inside the block that is there, the one the PATH and Homebrew steps write; a block of its own
   only when there is none) unless `ORIG_PATH` already holds it. A dry run prints the two commands. `--skip claude`
   leaves it out; `ROOST_INSTALL_CLAUDE_INSTALLER` (a test seam) replaces the URL. Skipped, with no line, when the
   standalone-four question was answered Stop, like the steps after Roost.
4a. **git, for real** *(Sean, 2026-11-24; built in 0.4.0)*. Claude Code, Codex and the PRs part expect a working `git`, and
   today it only arrives as a side effect (Apple's Command Line Tools through Homebrew's installer; a dependency of
   the `gh` package on RHEL/Fedora, and probably on Debian/Ubuntu). The installer checks that `git --version`
   actually runs (on macOS `/usr/bin/git` is a stub that opens Apple's install dialog until the Command Line Tools
   are installed) and installs it when not: the Command Line Tools (`xcode-select --install`, or Homebrew's
   `brew install git` when Homebrew is already there) on macOS, the distro's `git` package on Linux (`apt-get update`, then
   `DEBIAN_FRONTEND=noninteractive apt-get install -y git`, as the other apt installs; `dnf install -y git`; listed in
   the up-front sudo list). Git counts as working when `git --version` exits
   0; on macOS, `/usr/bin/git` is not run at all while `xcode-select -p` fails (it would open Apple's dialog) and
   counts as missing. Without Homebrew on a Mac the step runs `xcode-select --install` and waits for `xcode-select -p`
   (600 s, `ROOST_INSTALL_CLT_WAIT`; polled every 5 s): `✗ git: finish the Command Line Tools install Apple opened,
   then run git --version` when it doesn't come. Lines: `✓ git (already)`, `✓ git (installed)`, `✗ git: couldn't be
   installed; see <log>`. A checklist line of its own, before GitHub; `ROOST_INSTALL_GIT` (a test seam) is the git
   path taken as found. Skipped, with no line, when the standalone-four question was answered Stop.
   **Homebrew on the PATH** *(built in 0.4.0)* (macOS only, step name `homebrew`, after GitHub): when this run installed Homebrew or
   anything through it, or Homebrew is there and `code`, `gh` or `git` resolves inside its bin directory, the login
   profile gets `# added by roost-install: Homebrew`, `[ -x <brew> ] && eval "$(<brew> shellenv)"`, `# end
   roost-install`, unless the profile already has a `brew shellenv` line or `ORIG_PATH` already holds the directory
   (`✓ Homebrew on the PATH (already)`). No line at all when Homebrew wasn't involved.
4b. **GitHub, for the PRs panel.** kestrel reads pull requests through the GitHub CLI and cannot sign in by itself, so:
   install `gh` if missing (Homebrew; GitHub's apt repository on Ubuntu/Debian; on RHEL/Rocky GitHub's rpm
   repository, added and then `dnf install gh` without `--repo gh-cli`, which GitHub's page gives but which hides
   the system repositories that gh's `git` comes from; on Fedora, Fedora's own `gh`). No sign-in question
   *(since 0.4.3; Sean, 2026-11-24: "gh auth login, why can't we put this as the first step of the walkthrough?")*:
   signed in, the line under ✓ says `signed in as <login>`; not signed in, it says `sign in from Roost's
   walkthrough in VS Code (Sign in to GitHub)`, and the walkthrough's GitHub step runs the sign-in (note 101).
   Before 0.4.3 this step asked "Sign in to GitHub now…? [Y/n]" and ran `gh auth login --web`.
5. **The look** (note 101, *Follow-ups*), in the user settings file, each key only if not already set; a settings
   file with comments is never rewritten (the lines are printed instead):
   - `"chat.disableAIFeatures": true` — VS Code's built-in Copilot off; Roost's tabs take its place;
   - `"workbench.startupEditor": "none"` — no Welcome page;
   - `"workbench.secondarySideBar.defaultVisibility": "hidden"` — Claude Code's and ChatGPT's own chat views stay
     closed;
   - `"workbench.activityBar.location": "top"`;
   - (0.3.2–0.3.9 also set `"agents.firstStart.openClaudeTab": true`, one Claude tab on first start. No longer: the
     walkthrough's first step opens a Claude or Codex tab when the user clicks it *(Sean, 2026-11-24)*. A company's
     installer may still set it.)
   - `"agents.codebaseIndex.enabled": true` — the agents' `codebase_search` tool, only with `--codebase-search`.
     Otherwise it stays off (its default) and the walkthrough's "Search your code (optional)" step offers it
     *(Sean, 2026-11-24: "by default turn it off and decide during walk through"; 0.2.0–0.3.3 asked here, default
     yes; `--no-codebase-search` is still accepted and does nothing)*. When it is added, the step says search by
     meaning is one command away, **Agents: Install Codebase Search by Meaning**, which the installer does not run.
   - `"teams.signIn.clientId"` and `"teams.signIn.tenant"` — a company's own Microsoft app for the Teams sign-in
     (note 101, *Follow-ups*, "a company's own Microsoft app"), only with `--teams-app <clientId>:<tenant>`. Both
     are added only when neither is set, so a client id never meets another app's tenant. The installer checks the
     shape (a GUID, a colon, then a GUID or a domain) before any step runs; the helper checks it again. Nothing is
     asked: a company's own setup passes its IDs, and Roost's repo and installer name none. *(0.3.0)*
6. **The icons.** Only on a VS Code **that has never been started**: `User/globalStorage/state.vscdb` is absent, or has
   no `workbench.activity.pinnedViewlets2` entry yet (the `code` CLI may create the file without one). Then write
   `workbench.activity.pinnedViewlets2` so the bar shows Explorer, Search, Extensions, Perch, Teams, Jira &
   Confluence, and hides Source Control, Run and Debug, Testing, and the Claude Code and Codex containers (hidden,
   not removed), and record `roost.installer.layoutWritten` in the same transaction, as the company installer's helper does. An existing
   VS Code keeps its own layout, and the checklist says how to hide icons by hand. VS Code running during the run:
   the icons step is skipped with "quit VS Code and rerun" (VS Code would overwrite the file on exit); the other
   steps go through the `code` CLI and are fine. *(my calls: never undo someone's own layout)*
   In the same write, Claude Code's and Codex's "open" buttons, which they put on every editor's title bar, are
   hidden: `claude-vscode.editor.openLast`, `claude-vscode.terminal.open` and `chatgpt.openSidebar` are added to
   `EditorTitle` in `menu.hiddenCommands`, which is where VS Code keeps a right-click hide (there is no setting).
   Whatever is already listed stays; a value that isn't that JSON is left alone. Their diff buttons stay.
   *(0.5.13; Sean, 2026-11-25: the buttons showed on the Get started page)*
   In the same step, on that same never-started VS Code, the first window is made maximized: `windowsState` in
   `User/globalStorage/storage.json` (mode 0 with a size to un-maximize to), only when absent. A fresh install
   otherwise opens a window about 60% of the screen, too narrow for the walkthrough's detail column beside the side
   bar *(Sean, 2026-11-24; tried on Ubuntu/X11: without it 60%, with it maximized)*.
   "VS Code is running" means the VS Code of this user data directory: its `code.lock` names a live process. A scan
   for any `code` process skipped the step whenever another VS Code was open, as in every test run beside one's own
   (2026-11-24).
7. **Open VS Code** (not when run as root, not with `--dry-run`). Roost's first start opens the PRs tab and its
   Get started walkthrough (note 101, *First start*).

Flags: `--dry-run` (print what would be done), `--skip <step>` (`vscode path standalone roost companions claude git github homebrew settings icons open`), `--yes` (answer the standalone-four question with
Uninstall; needed with no terminal), `--no-open` (do not open VS Code at the end), `--codebase-search` (codebase search on; off otherwise), `--teams-app <clientId>:<tenant>` (the Teams sign-in's company app, step 5; a malformed value is a usage error, exit 2), `--help`. Exit status 0 when no
step failed, else 1. *(my call)*

**OpenSSL 3 on Fedora.** Fedora 45 ships OpenSSL 4, and VS Code's rpm does not depend on `libssl.so.3`, which its
extension signature check (vsce-sign) needs: without it every `code --install-extension` fails with "Signature
verification failed". So on Fedora the VS Code step checks `rpm -q --whatprovides 'libssl.so.3()(64bit)'` and, when
nothing provides it, runs `dnf install -y 'libssl.so.3()(64bit)'` (openssl3-libs), after a fresh install and over an
existing VS Code alike; a failure is `✗` and names `dnf install openssl3-libs`.

**Administrator rights.** When a step that is going to run installs something system-wide, the run asks for the
sudo password once, after the Platform line, and first lists exactly what this run adds system-wide, only the items
that will happen: Homebrew (macOS); curl and ca-certificates, gnupg (a minimal Ubuntu/Debian); Microsoft's VS Code
package repository and its signing key, and VS Code; OpenSSL 3 (Fedora, for VS Code's extension signature checks); git (Linux, when it will be installed);
GitHub's gh package repository and its signing key, and gh. The lines say it too: `✓ VS Code (installed, with
OpenSSL 3 for VS Code's extension signature checks)` on a fresh Fedora 45, `✓ GitHub (added GitHub's package
repository, installed gh; …)`. Homebrew's installer runs `sudo` itself and can take longer than sudo's timestamp,
so while it runs a background `sudo -n -v` loop keeps it fresh; the loop ends as soon as the install does (or the
run is stopped).

**On a Mac without admin rights,** Homebrew cannot be installed: the VS Code step is `✗ VS Code: Homebrew needs an
administrator account; …` with the official download link, and the run continues with an existing `code` if there
is one; a missing `gh` is then `✗ GitHub: gh comes through Homebrew, which needs an administrator account; …`. (The
account counts as not an administrator when the up-front `sudo -v` fails.)

## How it is built

A company's installer (kept outside this repo: a script and its helper, tested on Ubuntu
22.04/24.04 and Rocky 8/9 in containers) already does steps 1, 2, 5, 6 and parts of 4, with the checklist, rerun
safety, bash 3.2 compatibility for macOS and stub-based tests. *(Sean: build on it)*

- Its **generic half moves into the Roost repo** as `installer/roost-install.sh` and `installer/roost-install-helper`
  (Python, stdlib only, for the settings merge and `state.vscdb`), with their tests in `installer/test/`, rewritten
  without anything company-specific.
- `roost-install.sh` is **one file** when downloaded: the release step inlines the helper (as a here-document the
  script writes to a temp file and runs with the system `python3`). *(my call: one download, nothing else fetched
  except the `.vsix`)* The inlined copy is used before a `roost-install-helper` beside the script: run as
  `curl | bash`, the script's own directory is unknown and that lookup would search the current directory, where a
  planted file would run. A source-tree script uses the one beside it; `ROOST_INSTALL_HELPER` overrides both.
- **Which Python.** Without a usable `python3`, the settings and icons steps are `–` with a note saying how to
  install it. On macOS, only `/usr/bin/python3` needs Command Line Tools (`xcode-select -p`): that shim opens
  Apple's install dialog when they are missing, so it is not run then; any other `python3` (Homebrew's) counts as
  it is. The helper runs on Python 3.6 (stdlib only), so RHEL 8's `dnf install python3` is enough; and on RHEL with
  no `python3` command at all, the installer uses `/usr/libexec/platform-python` (dnf's own 3.6), which every RHEL 8
  has. No minimum version is checked.
- **A company's installer becomes a layer**: it downloads a pinned release's `roost-install.sh` and runs it with
  `--no-open`, and **never** `--yes` (notes 101 and 803: `--yes` would answer the standalone-four uninstall for the
  user). A company installer refuses a machine it wasn't meant for rather than migrating it. It checks the layer's exit
  status, then runs its own steps (the company file, MCP servers, sign-ins, token files) and opens VS Code itself.
  That is a separate change in the company's own repo, after this one ships. Since Roost ships through GitHub
  releases for now, a company installer switches when the first release exists, not when Roost reaches the
  Marketplace (note 101's *Installers that set up the four today* is updated to match). *(my call)*

## Flows

A fresh Mac:

```
 user            roost-install.sh          Homebrew / apt / dnf     GitHub release        VS Code (code CLI)
   |                    |                          |                       |                      |
   |-- bash it -------->|                          |                       |                      |
   |                    |-- platform ok            |                       |                      |
   |                    |-- code missing: Homebrew missing → install it; then the VS Code cask ->|   |
   |                    |-- PATH block in the login profile (once)         |                      |
   |                    |-- code --list-extensions: none of the four --------------------------->|
   |                    |-- python3? [no: settings and icons skipped, with a note]                |
   |                    |-- download roost-x.vsix ---------------------->  |                      |
   |                    |<-- file; SHA-256 matches  |                      |                      |
   |                    |-- --install-extension roost, claude-code, chatgpt, perch-audio ------>  |
   |                    |-- gh missing: install it (signed in later, in the walkthrough)        |
   |                    |-- settings: 4 keys (none set before)             |                      |
   |                    |-- state.vscdb absent: write the icon layout      |                      |
   |<-- ✓ checklist (platform, VS Code, PATH, Roost, companions, GitHub, settings, icons); Done: 8 ✓ 0 – 0 ✗
   |                    |-- open VS Code ------------------------------------------------------> |
   |                    |                                    [Roost first start: PRs tab opens]   |
```

The failure that matters most — the standalone four are installed:

```
 user            roost-install.sh                                    VS Code (code CLI)
   |                    |-- code --list-extensions --------------------->|
   |                    |<-- seanahn.perch, seanahn.jay, … --------------|
   |<-- "Roost replaces Perch and jay. Uninstall them and use Roost? [Y/n]"
   | [Y]                |-- --uninstall-extension each; then Roost ----->|
   | [n] or no terminal  |-- ✗ Roost: stopped — the standalone extensions would clash
   |                    |   steps 4–7 skipped; VS Code (if just installed) stays; exit 1
```

A download that fails its check: the `.vsix` is deleted, never installed, `✗ Roost: the download did not match its
checksum — run the installer again`; the other steps still run, and the exit status is 1.

## Settled while planning (2026-11-23)

- Files: `installer/roost-install.sh` (bash 3.2-safe) and `installer/roost-install-helper` (Python, stdlib only: the
  settings merge and `state.vscdb`), carved from the company installer's generic half; tests in `installer/test/` with
  Python's `unittest` (no extra dependency) and the company installer's stub-on-PATH harness.
- Step names for `--skip`: `vscode path standalone roost companions claude git github homebrew settings icons open`.
- Release URL `https://github.com/seanahn/roost/releases/download/v<version>/roost-<version>.vsix`; the script
  carries `@ROOST_VERSION@` / `@ROOST_SHA256@`, stamped by `make release`; an unstamped script refuses the Roost step.
- `make release` writes `dist/roost-<version>.vsix` and `dist/roost-install.sh` (the helper inlined as a
  here-document written to a temp file at start); `make release-test` runs the release tests on it, failing rather
  than skipping without `dist/`. `make release-publish` creates the GitHub release with `gh`, tagged at HEAD
  (`--target`); `release-publish-check` refuses unless the tree is clean and HEAD is on origin, and the publish
  refuses a stale `dist/` (version, checksum or `.vsix` not matching) — Sean's action, never run by the build or the
  tests.
- On macOS, only `/usr/bin/python3` needs Command Line Tools (see *How it is built*, *Which Python*).
- Package signing keys are fetched from the vendors' URLs and not pinned by fingerprint, as the vendors' own
  instructions do (fingerprints rotate).
- Fedora uses Microsoft's yum repository with `dnf`. As root (containers), `code` calls get `--user-data-dir` and
  VS Code is not opened, as in the company installer.
- The icon layout also hides every activity-bar container of an installed `openai.chatgpt` (its Codex views).

Built: branch feat/installer; the plan's last commit: 8985c57.

## Left to the builder (settled)

- The generic half was copied out of the company installer and trimmed; nothing is shared between the two repos.
- The release step: `make release`, `installer/build-release.sh`, the assets `roost-install.sh` and
  `roost-<version>.vsix`.
- The repository setup commands are the company installer's, except gh on RHEL (no `--repo gh-cli`) and gh on Fedora
  (Fedora's own package).

## Verification

**Containers** (`make release`, `dist/` served locally, `ROOST_INSTALL_VSIX_URL` pointed at it; each image ran
`bash roost-install.sh --yes --no-open` twice, as root, with no terminal):

| Image | Run 1 | Run 2 |
|---|---|---|
| ubuntu:22.04 | 7 ✓ 1 – 0 ✗, exit 0 | `✓ (already)` but GitHub, exit 0 |
| ubuntu:24.04 | 7 ✓ 1 – 0 ✗, exit 0 | `✓ (already)` but GitHub, exit 0 |
| rockylinux:8 | 7 ✓ 1 – 0 ✗, exit 0 | `✓ (already)` but GitHub, exit 0 |
| rockylinux:9 | 7 ✓ 1 – 0 ✗, exit 0 | `✓ (already)` but GitHub, exit 0 |
| fedora:latest (45) | 7 ✓ 1 – 0 ✗, exit 0 | `✓ (already)` but GitHub, exit 0 |

The one `–` is `GitHub: run \`gh auth login\``, expected with no terminal (since 0.4.3 GitHub is ✓
instead, with a line saying to sign in from the walkthrough). Afterwards every profile held
seanahn.roost, anthropic.claude-code, openai.chatgpt and seanahn.perch-audio, settings.json the four keys, and
state.vscdb the layout. The runs found three faults, fixed before these results: gh on Rocky (`--repo gh-cli`),
OpenSSL 3 on Fedora 45, and Rocky 8's Python 3.6. The helper's tests also run in `python:3.6-slim`.

**Left for a real Mac run** (Sean's):

- A Mac with no VS Code: one run gives the look described, the icons trimmed, Roost's PRs tab on first start.
- A Mac with a used VS Code: its settings and layout are unchanged; only missing keys added.
- A Mac with the standalone four: the question, both answers.

A `.vsix` that does not match its checksum is refused in the tests (`test_checksum_mismatch_refuses`); a release
copy with one byte changed has not been tried by hand.

## Parked

- The sudo keep-alive loop survives a SIGKILL of the installer and keeps sudo's timestamp fresh every 50 s until
  logout; every catchable exit kills it. Fix: `kill -0 $$` in the loop's condition.
- The `release-publish-check` test picks up the user's global git config (commit signing, hooks), so it can fail on
  such a machine.
- After a failed `sudo -v` on Linux, later sudo calls may prompt again.
- `--skip roost` with Roost installed drops "Roost works" from a companion's failure line.
- Smaller: a relative `ROOST_VSCODE_USER_DIR` gives a traceback; `ID_LIKE` also accepts Amazon Linux, Oracle Linux
  and old Mint; two `apt-get update`s; Flatpak VS Code on Fedora gets openssl3-libs it does not need; `dist/release-notes.md` is left in `dist/`.
