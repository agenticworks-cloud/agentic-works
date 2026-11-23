# 102 — The Roost installer

Proposal, 2026-11-23. Follows note [101](101-roost.md) (*Follow-ups*).

## Intent

Roost exists because many people never get past installing VS Code and finding the right extensions; they pick an
editor that is one download instead (note 101, *Intent*). The installer closes that gap: **download one file, run
it, and VS Code opens with Roost in place**, looking the way Roost is meant to look. *(Sean)*

It is public and generic. A company that wants more (its own LLM gateway, MCP servers, sign-ins) layers its own
installer on top; C3's installer is rebuilt that way, as a layer that runs this one first. *(Sean)*

### Goals

- **One file, `roost-install.sh`, for macOS and Linux** *(Sean)*: downloaded and run with `bash roost-install.sh`.
  Linux means Ubuntu 22.04+ (and Debian-based), RHEL/Rocky 8 and 9, Fedora. *(distributions: my call, the set the
  C3 installer already handles plus Fedora)*
- Installs VS Code if it is missing, then Roost and its companion extensions, then sets the look, then opens VS Code.
- Safe to rerun: a second run fixes what is missing and changes nothing that is in place.
- A ✓ / – / ✗ checklist while it runs, the same format as the C3 installer's (c3-free wording).

### Non-goals

- Windows (later, or never). *(Sean)*
- Linux servers reached over Remote-SSH (headless, no desktop VS Code): the next iteration. *(Sean)* Linux here means a
  desktop where VS Code runs on the machine.
- Sign-ins (Claude, Codex, Teams, Jira) and per-part questions: each part signs itself in inside Roost, with its own
  UI, and all parts are on (switched in Roost: Settings). *(my call, Sean: "do as you wish")* The one exception is
  GitHub, below.
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
- `make release` builds the `.vsix`, writes its version and SHA-256 into a copy of the script, and creates the
  GitHub release with both (`gh release create`). Publishing a release is Sean's action.

## What it does, in order

1. **Platform.** macOS (arm64, x86_64), or Linux by `/etc/os-release`; anything else stops with the supported list.
   Run with `sudo` (root, with `SUDO_USER` someone else), it stops here too: `✗ Platform: Run it without sudo: bash
   roost-install.sh — it asks for your password when it needs it.` (VS Code's settings, the PATH block and the
   extensions would otherwise go to root). Root itself (a container) runs as below.
2. **VS Code.** If `code` is missing: macOS — Homebrew (`brew install --cask visual-studio-code`), installing
   Homebrew first if needed; Ubuntu/Debian — Microsoft's apt repository; RHEL/Rocky/Fedora — Microsoft's yum
   repository. Then make sure `code` is on the PATH for this run and for new terminals (one marked block in the
   login profile, as the C3 installer does). An existing VS Code is used as it is.
3. **The standalone four.** If any of `seanahn.perch`, `seanahn.chirp`, `seanahn.jay`, `seanahn.kestrel-prs` is
   installed, Roost's matching parts would fail to start (the same command ids twice). The installer lists them and
   asks: **Uninstall them and use Roost** (default) / **Stop**. Their settings, files under `~/.chirp` and `~/.jay`,
   and agent sessions stay; only the extensions go. *(my call)* **Stop** skips steps 4–7 (Roost, the look, the
   icons, opening VS Code) and exits 1; a VS Code installed in step 2 stays, which is harmless. With no terminal to
   ask on (a pipe, a layer), the run stops the same way unless `--yes` was given, which answers Uninstall. If an
   uninstall fails, Roost is not installed (a clash is worse than no Roost) and the run says which one is left.
4. **Roost.** If the same version is installed: `✓ (already)`. An older one: upgrade. A newer one (an old installer
   run again): leave it and say so. *(my call)* Otherwise download the release's `.vsix` (on Ubuntu/Debian, installing
   curl first if a minimal system has none), check its SHA-256,
   `code --install-extension`. A download that fails (network, proxy, a missing release) or does not match is
   `✗`, the file deleted, nothing installed. Then install the
   companions by id from the Marketplace if missing: `anthropic.claude-code`, `openai.chatgpt` (Perch runs their
   `claude` and `codex`) and `seanahn.perch-audio`. *(my call: explicitly, rather than trusting a `.vsix`'s
   extension pack to pull them)* A companion that cannot be installed (the Marketplace blocked, say) is `✗` with its
   name; Roost still works, but Perch's tabs need Claude Code or ChatGPT to run an agent, which the line says.
4b. **GitHub, for the PRs panel.** kestrel reads pull requests through the GitHub CLI and cannot sign in by itself, so:
   install `gh` if missing (Homebrew; GitHub's apt / rpm repository, as the C3 installer does), then, if `gh auth
   status` fails, ask "Sign in to GitHub now, for the PRs panel? [Y/n]" and run `gh auth login --web` on Y. No
   terminal, or `n`: `– GitHub: run \`gh auth login\` to see your pull requests`. `--yes` does not answer this one
   (a browser sign-in is never automatic). *(my call)*
5. **The look** (note 101, *Follow-ups*), in the user settings file, each key only if not already set; a settings
   file with comments is never rewritten (the lines are printed instead):
   - `"chat.disableAIFeatures": true` — VS Code's built-in Copilot off; Roost's tabs take its place;
   - `"workbench.startupEditor": "none"` — no Welcome page;
   - `"workbench.secondarySideBar.defaultVisibility": "hidden"` — Claude Code's and ChatGPT's own chat views stay
     closed;
   - `"workbench.activityBar.location": "top"`.
6. **The icons.** Only on a VS Code **that has never been started**: `User/globalStorage/state.vscdb` is absent, or has
   no `workbench.activity.pinnedViewlets2` entry yet (the `code` CLI may create the file without one). Then write
   `workbench.activity.pinnedViewlets2` so the bar shows Explorer, Search, Extensions, Perch, Teams, Jira &
   Confluence, and hides Source Control, Run and Debug, Testing, and the Claude Code and Codex containers (hidden,
   not removed), and record `roost.installer.layoutWritten` in the same transaction, as the C3 helper does. An existing
   VS Code keeps its own layout, and the checklist says how to hide icons by hand. VS Code running during the run:
   the icons step is skipped with "quit VS Code and rerun" (VS Code would overwrite the file on exit); the other
   steps go through the `code` CLI and are fine. *(my calls: never undo someone's own layout)*
7. **Open VS Code** (not when run as root, not with `--dry-run`). Roost's first start opens the PRs tab.

Flags: `--dry-run` (print what would be done), `--skip <step>`, `--yes` (answer the standalone-four question with
Uninstall; needed with no terminal), `--no-open` (do not open VS Code at the end), `--help`. Exit status 0 when no
step failed, else 1. *(my call)*

**On a Mac without admin rights,** Homebrew cannot be installed: the VS Code step is `✗` with the official download
link, and the run continues with an existing `code` if there is one.

## How it is built

The C3 installer (c3securitytools, `agent_k/scripts/perch-install` + `perch-install-helper`, tested on Ubuntu
22.04/24.04 and Rocky 8/9 in containers) already does steps 1, 2, 5, 6 and parts of 4, with the checklist, rerun
safety, bash 3.2 compatibility for macOS and stub-based tests. *(Sean: build on it)*

- Its **generic half moves into the Roost repo** as `installer/roost-install.sh` and `installer/roost-install-helper`
  (Python, stdlib only, for the settings merge and `state.vscdb`), with their tests in `installer/test/`, rewritten
  without anything C3-specific.
- `roost-install.sh` is **one file** when downloaded: the release step inlines the helper (as a here-document the
  script writes to a temp file and runs with the system `python3`). *(my call: one download, nothing else fetched
  except the `.vsix`)* On a Mac without Python 3 (no Command Line Tools), the settings and icons steps are skipped
  with a note, rather than triggering the Xcode install dialog. *(my call)*
- **The C3 installer becomes a layer**: it downloads a pinned release's `roost-install.sh` and runs it with
  `--yes --no-open`, checks its exit status, then runs its own steps (gateway, MCP servers, sign-ins, token files)
  and opens VS Code itself. That is a separate change in c3securitytools, after this one ships, and note 802 is
  updated then. Since Roost ships through GitHub releases for now, the C3 installer switches when the first release
  exists, not when Roost reaches the Marketplace (note 101's *Installers that set up the four today* is updated to
  match). *(my call)*

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
   |                    |-- settings: 4 keys (none set before)             |                      |
   |                    |-- state.vscdb absent: write the icon layout      |                      |
   |<-- ✓ checklist (platform, VS Code, PATH, Roost, companions, settings, icons); Done: 7 ✓ 0 – 0 ✗  |
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
  settings merge and `state.vscdb`), carved from the C3 installer's generic half; tests in `installer/test/` with
  Python's `unittest` (no extra dependency) and the C3 installer's stub-on-PATH harness.
- Step names for `--skip`: `vscode path standalone roost companions github settings icons open`.
- Release URL `https://github.com/seanahn/roost/releases/download/v<version>/roost-<version>.vsix`; the script
  carries `@ROOST_VERSION@` / `@ROOST_SHA256@`, stamped by `make release`; an unstamped script refuses the Roost step.
- `make release` writes `dist/roost-<version>.vsix` and `dist/roost-install.sh` (the helper inlined as a
  here-document written to a temp file at start); `make release-publish` creates the GitHub release with `gh` — Sean's
  action, never run by the build.
- On macOS, `python3` counts only if Command Line Tools are present (`xcode-select -p`), so the settings and icons
  steps never trigger Apple's install dialog.
- Fedora uses Microsoft's yum repository with `dnf`. As root (containers), `code` calls get `--user-data-dir` and
  VS Code is not opened, as in the C3 installer.
- The icon layout also hides every activity-bar container of an installed `openai.chatgpt` (its Codex views).

Implementation plan: `docs/superpowers/plans/2026-11-23-roost-installer.md` (deleted when the work merges).

## Left to the builder

- How the generic half is split out of `perch-install` (copy and trim, or a shared source both repos build from).
- The release step's details (`make release`, the asset names, the inlining).
- Exact repository setup commands per distribution (reuse the C3 installer's, which run in containers today).

## Verification

- Container runs: Ubuntu 22.04 and 24.04, Rocky 8 and 9, Fedora — twice each; the second run all `✓ (already)`.
- A real Mac with no VS Code: one run gives the look described, the icons trimmed, Roost's PRs tab on first start.
- A machine with VS Code already used: its settings and layout are unchanged; only missing keys added.
- A machine with the standalone four: the question, both answers.
- A tampered `.vsix` (one byte changed in the release copy): refused.
