# Roost Installer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use trivialpowers:subagent-driven-development (recommended) or trivialpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `roost-install.sh` — one downloaded file that, on macOS or a Linux desktop, installs VS Code if missing, then Roost from its GitHub release and its companions, sets Roost's look, and opens VS Code.

**Architecture:** A bash orchestrator (`installer/roost-install.sh`, bash 3.2-safe) with a stdlib-Python helper (`installer/roost-install-helper`) for the settings merge and VS Code's `state.vscdb`, both carved from the C3 installer's generic half. `make release` stamps the version and the `.vsix` SHA-256 into a copy of the script, inlines the helper, and writes `dist/roost-install.sh` beside `dist/roost-<version>.vsix`.

**Tech Stack:** bash 3.2+, Python 3 (stdlib: json, sqlite3), Homebrew / apt / dnf, the `code` CLI, `gh` for releases, Python `unittest` for tests (no pytest dependency), Docker for container runs.

**Spec:** `docs/notes/102-roost-installer.md`

The design holds every design decision; this plan holds build steps and code-level names only, and is deleted when the work merges. If a decision changes during the build, change the design in the same commit.

**Base code (read, don't modify):** `/git/c3securitytools/.worktrees/perch-install/agent_k/scripts/perch-install`, `perch-install-helper`, and `agent_k/tests/test_perch_install.py`, `test_perch_install_helper.py` (stub-on-PATH harness, bash 3.2 container test).

## Global Constraints

- Platforms: macOS (arm64, x86_64); Linux desktops: Ubuntu 22.04+ and Debian-based, RHEL/Rocky 8 and 9, Fedora. Anything else exits 1 with the supported list. No Windows, no Remote-SSH servers.
- bash 3.2-safe: no `declare -A`, `mapfile`, `${x,,}`, `|&`, `[[ -v ]]`.
- No company names anywhere (public repo); no gateway, MCP or sign-in steps.
- Checklist lines: `  … <label>` then `  ✓ <label> (<detail>)` / `  ✓ <label> (already)` / `  – <label>: <detail>` / `  ✗ <label>: <detail>`; `Done: N ✓  N –  N ✗`; colour only on a tty without `NO_COLOR` (the C3 installer's `step_begin` / `step_end` / `step_say` / `tally`).
- Flags: `--dry-run`, `--skip <step>` (repeatable), `--yes`, `--no-open`, `--help`. Exit 0 when no step failed, else 1.
- Extension ids: Roost `seanahn.roost`; standalone four `seanahn.perch`, `seanahn.chirp`, `seanahn.jay`, `seanahn.kestrel-prs`; companions `anthropic.claude-code`, `openai.chatgpt`, `seanahn.perch-audio`.
- Release URL: `https://github.com/seanahn/roost/releases/download/v<version>/roost-<version>.vsix`; the script's placeholders `@ROOST_VERSION@` and `@ROOST_SHA256@` are stamped by `make release`.
- Settings written only when absent: `"chat.disableAIFeatures": true`, `"workbench.startupEditor": "none"`, `"workbench.secondarySideBar.defaultVisibility": "hidden"`, `"workbench.activityBar.location": "top"`. A settings file with comments is never rewritten (print the lines).
- Icons, only when `state.vscdb` is absent or has no `workbench.activity.pinnedViewlets2`: visible, in order, `workbench.view.explorer`, `workbench.view.search`, `workbench.view.extensions`, `workbench.view.extension.perch`, `workbench.view.extension.chirp`, `workbench.view.extension.jay`; hidden: `workbench.view.scm`, `workbench.view.debug`, `workbench.view.testing`, `workbench.view.extension.claude-sidebar`, `workbench.view.extension.claude-sessions-sidebar`, and every activity-bar container of an installed `openai.chatgpt`. Record `roost.installer.layoutWritten` in the same transaction. VS Code running → skip with "quit VS Code and rerun".
- Commits as the repo's local identity (Sean Ahn); end messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **An existing, used VS Code** (its own settings, its own icon layout) — nothing of the user's changes; only missing keys are added; icons untouched. Test: `existing layout is never rewritten` (Task 1), `used vscode keeps settings` (Task 4).
2. **The standalone four installed, run through a pipe without `--yes`** — stops before Roost, exit 1, VS Code left as is. Test: `no terminal without --yes stops` (Task 3).
3. **A tampered or truncated `.vsix`** — refused, deleted, nothing installed. Test: `checksum mismatch refuses` (Task 3).
4. **Rerunning an old installer over a newer Roost** — Roost left alone with a note. Test: `newer roost is left alone` (Task 3).
5. **A Mac without Python 3** — settings and icons skipped with a note, no Xcode prompt triggered. Test: `no python3 skips settings and icons` (Task 4).

---

### Task 1: `installer/roost-install-helper`

**Files:**
- Create: `installer/roost-install-helper` (Python 3, stdlib only, executable), `installer/test/test_helper.py`

**Interfaces:**
- Produces subcommands (exit 0 done, 2 skipped with a reason on stdout, 1 error): `vscode-settings`, `vscode-layout`. Overrides for tests: `$ROOST_VSCODE_USER_DIR` (default `~/Library/Application Support/Code/User` on macOS, `~/.config/Code/User` on Linux), `$ROOST_VSCODE_EXTENSIONS_DIR` (default `~/.vscode/extensions`). Functions tests import: `user_dir()`, `merge_settings(text, wanted) -> str | None` (None = JSONC or not an object), `layout_entry(existing, hidden_extra) -> list`, `layout_needed(db_path) -> bool`, `vscode_running() -> bool` (macOS: `pgrep -u <uid> -f "Visual Studio Code.app/Contents/MacOS/"`; Linux: `pgrep -x -u <uid> code`).
- Carve from `perch-install-helper`'s `vscode-settings` / `vscode-layout` (atomic writes keeping mode and symlinks, non-UTF-8 treated as JSONC, `ensure_ascii=False`, no write when nothing changes); drop everything else.

- [ ] **Step 1: Write the failing tests** (`unittest`): `settings_written_on_empty` (the four keys); `keeps_foreign_keys` (an existing `"workbench.startupEditor": "welcomePage"` stays); `jsonc_is_not_rewritten` (bytes unchanged, exit 2, the lines printed); `layout_order_and_hidden` (the visible ids in order with `order` 0–5, the five hidden ids `visible: False`); `codex_containers_hidden` (a fake `openai.chatgpt-*/package.json` with an activitybar container `codex` → `workbench.view.extension.codex` hidden); `fresh_db_gets_layout_and_marker`; `existing_layout_is_never_rewritten` (a db with a `pinnedViewlets2` entry → exit 2, bytes unchanged); `vscode_running_skips` (patched → exit 2, no write).
- [ ] **Step 2: Run** `python3 -m unittest installer/test/test_helper.py` — Expected: fails (no helper).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same — Expected: passes.
- [ ] **Step 5: Commit** `git commit -m "Installer: the settings and icon-layout helper"` (explicit paths)

### Task 2: `installer/roost-install.sh` — platform, VS Code, PATH

**Files:**
- Create: `installer/roost-install.sh`, `installer/test/test_install.py`, `installer/test/stubs/` (if the harness needs files)

**Interfaces:**
- Produces: the checklist functions (`step_begin`, `step_end`, `step_say`, `tally`), `run`/`run_sh` (dry-run aware, output to a log), `detect_platform` (`OS=macos|ubuntu|debian|rhel|fedora`, `ARCH`), `ensure_vscode` (missing `code` → macOS Homebrew cask, installing Homebrew first; apt/yum repositories per the C3 installer's `install_pkgs_*` and VS Code steps, `gnupg` first on minimal Debian/Ubuntu, Fedora via the same yum repo with `dnf`), `find_code` (`$CODE`), `ensure_path` (one marked block in the login profile, idempotent), `parse_args`, `main` (an ordered list of steps; `--skip` names: `vscode path standalone roost companions settings icons open`), `PERCH`-free. Test seams: `ROOST_INSTALL_FAKE_OS`, `ROOST_INSTALL_FAKE_ARCH`, `ROOST_INSTALL_NO_MAIN` (source without running).
- Carve from `perch-install`: checklist, `run`/`run_sh` (pipefail), `detect_platform`, `ensure_homebrew`, `find_brew`, the VS Code repo steps and `add_apt_repo`, `find_code`, `ensure_path`, `needs_root`/`prepare_sudo`, `open_tty`, `parse_args`, `finish`'s tally. Drop every C3 step.

- [ ] **Step 1: Write the failing tests** (`unittest`, stubs on PATH, HOME a temp dir): `dry_run_ubuntu_installs_vscode`; `rhel_and_fedora_use_the_yum_repo` (fedora uses `dnf`); `macos_installs_homebrew_then_cask`; `existing_code_is_used` (no install line); `path_block_once` (two runs, one block); `unsupported_os_exits_1`; `mac_without_admin` (Homebrew install fails → `✗ VS Code:` with `https://code.visualstudio.com/download`, run continues); `bash32` (the dry run in the `bash:3.2` container; skip without Docker).
- [ ] **Step 2: Run** `python3 -m unittest installer/test/test_install.py` — Expected: fails.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: passes.
- [ ] **Step 5: Commit** `git commit -m "Installer: platform, VS Code and PATH"`

### Task 3: The standalone four, Roost, companions

**Files:**
- Modify: `installer/roost-install.sh`; Test: `installer/test/test_install.py`

**Interfaces:**
- Consumes: Task 2's functions.
- Produces: `check_standalone` (lists installed ids from `"$CODE" --list-extensions`; asks "Roost replaces <names>. Uninstall them and use Roost? [Y/n]" on the terminal; `--yes` answers Y; no terminal and no `--yes` → stop; Stop or a failed uninstall → `✗ Roost:` and steps `roost companions settings icons open` are skipped, exit 1), `ensure_roost` (installed version from `"$CODE" --list-extensions --show-versions`: equal → `✓ (already)`; older → upgrade; newer → `– Roost: <v> is newer than this installer's <w>; left as is`; else download `ROOST_VSIX_URL` (default the release URL with `@ROOST_VERSION@`; test override `ROOST_INSTALL_VSIX_URL`) to a temp file, `shasum -a 256` / `sha256sum` against `@ROOST_SHA256@`, mismatch or failed download → delete, `✗`), `ensure_companions` (each missing companion by id; a failure → `✗ Companions: <id>` and a note that Perch's tabs need Claude Code or ChatGPT). An unstamped script (placeholders still in) refuses `ensure_roost` with "run a released installer".

- [ ] **Step 1: Write the failing tests:** `no_standalone_no_question`; `standalone_yes_uninstalls_then_installs` (order in the stub log); `standalone_stop_skips_the_rest` (answer `n` → no roost/settings/icons/open lines, exit 1); `no_terminal_without_yes_stops`; `failed_uninstall_installs_no_roost`; `same_version_already`; `older_version_upgraded`; `newer_roost_is_left_alone`; `checksum_mismatch_refuses` (a local HTTP server serves a `.vsix` whose hash differs → file gone, no `--install-extension`); `download_failure_reported`; `companions_installed_when_missing`; `companion_failure_noted`; `unstamped_script_refuses`.
- [ ] **Step 2: Run** — Expected: fails. **Step 3: Implement.** **Step 4: Run** — Expected: passes.
- [ ] **Step 5: Commit** `git commit -m "Installer: the standalone four, Roost from its release, companions"`

### Task 4: Settings, icons, opening VS Code

**Files:**
- Modify: `installer/roost-install.sh`; Test: `installer/test/test_install.py`

**Interfaces:**
- Consumes: Task 1's helper (found beside the script when run from a clone: `installer/roost-install-helper`; in a released script, written from the inlined here-document to a temp file — Task 5 inlines it; here, define `helper_path()` returning the sibling path or `$ROOST_INSTALL_HELPER`), Task 2–3's functions.
- Produces: `apply_settings` (`python3 <helper> vscode-settings`; no `python3` → `– Settings: python3 is not installed; …`, never invoking `/usr/bin/python3` on macOS unless Command Line Tools are present: check `xcode-select -p` first), `apply_icons` (same, `vscode-layout`; exit 2 messages passed through `step_say`), `open_vscode` (`"$CODE" --new-window`, not with `--no-open`, `--dry-run` or as root — root prints how to start it).

- [ ] **Step 1: Write the failing tests:** `settings_and_icons_applied` (helper stub called with each subcommand); `used_vscode_keeps_settings` (real helper, an existing settings file with a foreign key → kept); `no_python3_skips_settings_and_icons` (macOS fake, no `python3`, `xcode-select -p` fails → both `–`, `/usr/bin/python3` never run); `no_open_flag`; `root_does_not_open`; `rerun_is_all_already` (every probe stub succeeds → every line `✓ … (already)`).
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Run** — passes.
- [ ] **Step 5: Commit** `git commit -m "Installer: settings, icons, open VS Code"`

### Task 5: `make release`

**Files:**
- Create: `installer/build-release.sh` (or a `scripts/` entry), `installer/test/test_release.py`; Modify: `Makefile`, `.vscodeignore` (exclude `installer/**`, `dist/**`), `.gitignore` (`dist/`)

**Interfaces:**
- Produces: `make release` → `make package`, then `dist/roost-<version>.vsix` and `dist/roost-install.sh` (placeholders stamped with `package.json`'s version and the `.vsix` SHA-256; the helper inlined as a quoted here-document the script writes to `$TMPDIR` at start and removes on exit). `make release-publish` → `gh release create v<version> dist/roost-install.sh dist/roost-<version>.vsix --repo seanahn/roost --title "Roost <version>" --notes-file <generated>`; never run by the build (it is Sean's action).

- [ ] **Step 1: Write the failing tests:** `stamped_script_has_version_and_sha` (matches the built `.vsix`); `released_script_runs_its_inlined_helper` (run the dist script with `--dry-run --skip vscode` in a temp HOME → the settings step uses the inlined helper; no sibling file needed); `release_assets_not_in_vsix` (no `installer/` or `dist/` in the `.vsix`).
- [ ] **Step 2: Run** — fails. **Step 3: Implement.** **Step 4: Run** `make release && python3 -m unittest installer/test/test_release.py` — passes.
- [ ] **Step 5: Commit** `git commit -m "make release: the stamped one-file installer beside the .vsix"`

### Task 6: Container runs

**Files:** fixes only, with regression tests in `installer/test/test_install.py`

- [ ] **Step 1:** With `make release`'s `dist/` served by a local HTTP server (`ROOST_INSTALL_VSIX_URL`), run `dist/roost-install.sh --yes --no-open` as root in `ubuntu:22.04`, `ubuntu:24.04`, `rockylinux:8`, `rockylinux:9`, `fedora:latest`, twice each (`bash -c 'sh1; sh2'`). Expected: run 1 installs VS Code, Roost and the companions (headless `code --install-extension` as root needs `--user-data-dir`; reuse the C3 installer's handling), writes settings and the icon layout into root's fresh profile; run 2 all `✓ (already)` or `–`; exit 0.
- [ ] **Step 2:** For each failure: fix, add a stub test, rerun that container. Commit each fix by explicit path.
- [ ] **Step 3:** Record each image's final checklist (trimmed) in the closing task's design update.

### Task 7: The design and docs describe what was built

**Files:**
- Modify: `docs/notes/102-roost-installer.md`, `docs/notes/101-roost.md` (*Follow-ups*: the installer is built; *Installers that set up the four today*: switches at the first GitHub release), `README.md` (an **Install** section: download `roost-install.sh` from the latest release and run `bash roost-install.sh`; what it does; flags; link to note 102)
- Delete: `docs/superpowers/plans/2026-11-23-roost-installer.md`

- [ ] **Step 1:** Note 102: "Proposal" → "Built, <date>"; fold in every ruling from the build; add the container results and what is left for a real Mac run (Sean's: a Mac with no VS Code; a Mac with a used VS Code; the standalone four). Add a "Built" line naming the plan's last commit. Link `README.md`.
- [ ] **Step 2:** README and note 101 as above.
- [ ] **Step 3:** Commit the docs; then `git rm` this plan and record its last commit's SHA in note 102; commit. `make test < /dev/null` and `python3 -m unittest discover installer/test` pass.
- [ ] Creating the GitHub release (`make release-publish`) and pushing are Sean's call.
