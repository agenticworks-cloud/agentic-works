#!/usr/bin/env bash
# agentic-works-install — VS Code with Agentic Works on this Mac or Linux desktop, in one command:
#
#   bash agentic-works-install.sh
#
# macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora. Installs VS Code if it
# is missing and puts `code` on the PATH; uninstalls the standalone Perch, chirp, jay, kestrel and Gannet (after asking),
# which Agentic Works replaces; installs this release's Agentic Works .vsix (SHA-256 checked), its companion extensions and the
# GitHub CLI (signed in from Agentic Works' walkthrough, not here); sets VS Code's look and its activity-bar icons (on a
# VS Code never started), then opens VS Code. It prints a checklist, one line per step. Each step checks first, so
# a rerun only fills in what is missing. A failed step is reported and the run goes on; the exit status is 1 when
# any step failed. Design: docs/notes/102-agentic-works-installer.md.
#
# Runs under macOS's /bin/bash 3.2: no associative arrays, mapfile, ${x,,}, |& or [[ -v ]].
# No `set -e`: each step reports its own result and the run continues.
#
# Environment:
#   NO_COLOR                 plain marks even on a terminal
#   AGENTIC_WORKS_INSTALL_FAKE_OS    test seam only: macos|ubuntu|debian|rhel|fedora instead of detecting the platform
#   AGENTIC_WORKS_INSTALL_FAKE_ARCH  test seam only: instead of `uname -m`
#   AGENTIC_WORKS_INSTALL_NO_MAIN    test seam only: 1 = define the functions and return, for tests that source this file
#   AGENTIC_WORKS_INSTALL_TTY        test seam only: the file answers are read from, one per line, instead of /dev/tty
#   AGENTIC_WORKS_INSTALL_VSIX_URL   test seam only: where Agentic Works' .vsix is downloaded from, instead of this release
#   AGENTIC_WORKS_INSTALL_APT_DIR    test seam only: instead of /etc/apt, where existing apt sources are looked for
#   AGENTIC_WORKS_INSTALL_HELPER     agentic-works-install-helper's path, instead of the one beside this script
#   AGENTIC_WORKS_INSTALL_PYTHON3    test seam only: the python3 path taken as found, instead of `command -v python3`
#   AGENTIC_WORKS_INSTALL_PLATFORM_PYTHON  test seam only: instead of /usr/libexec/platform-python (RHEL 8's system python)
#   AGENTIC_WORKS_INSTALL_GIT        test seam only: the git path taken as found, instead of `command -v git`
#   AGENTIC_WORKS_INSTALL_CLT_WAIT   seconds to wait for Apple's Command Line Tools after `xcode-select --install` (600)
#   AGENTIC_WORKS_INSTALL_CLAUDE_INSTALLER  test seam only: where Claude Code's installer is downloaded from, instead of
#                            https://claude.ai/install.sh
set -u

# Agentic Works' version and its .vsix's SHA-256: written in by `make release`. A copy without them refuses the Agentic Works step.
AGENTIC_WORKS_VERSION="@AGENTIC_WORKS_VERSION@"
AGENTIC_WORKS_SHA256="@AGENTIC_WORKS_SHA256@"
AGENTIC_WORKS_ID="agenticworks.agentic-works"
AGENTIC_WORKS_VSIX_URL=${AGENTIC_WORKS_INSTALL_VSIX_URL:-"https://github.com/agenticworks-cloud/agentic-works/releases/download/v$AGENTIC_WORKS_VERSION/agentic-works-$AGENTIC_WORKS_VERSION.vsix"}
LATEST_INSTALLER="https://github.com/agenticworks-cloud/agentic-works/releases/latest/download/agentic-works-install.sh"
STANDALONE="seanahn.perch seanahn.chirp seanahn.jay seanahn.kestrel-prs seanahn.gannet"  # the extensions Agentic Works replaces
COMPANIONS="anthropic.claude-code openai.chatgpt seanahn.perch-audio"  # Perch runs claude and codex through these
GH_KEY="https://cli.github.com/packages/githubcli-archive-keyring.gpg"
GH_RPM_REPO="https://cli.github.com/packages/rpm/gh-cli.repo"
APT_DIR=${AGENTIC_WORKS_INSTALL_APT_DIR:-/etc/apt}

STEP_NAMES="vscode path profile standalone extension companions claude git github homebrew settings icons open"  # what --skip accepts, in run order
SUPPORTED="macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora"
MAC_CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
DOWNLOAD_URL="https://code.visualstudio.com/download"
HOMEBREW_INSTALLER="https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"
CLAUDE_INSTALLER=${AGENTIC_WORKS_INSTALL_CLAUDE_INSTALLER:-"https://claude.ai/install.sh"}
MS_KEY="https://packages.microsoft.com/keys/microsoft.asc"
ORIG_PATH=$PATH  # the PATH a new terminal would have, before this run adds to it

DRY_RUN=0
YES=0
NO_OPEN=0
FOLDER=""  # --folder DIR: the folder the window opened to make --profile's profile opens on, so a setup that opens it after needs no second window
WINDOW_OPENED=0  # this run opened a VS Code window (to make the profile): open_vscode opens no other
WINDOW_MARK=""  # --window-mark FILE: made when this run opened a VS Code window, so a setup run around it doesn't open another
PROFILE=""  # --profile NAME: the VS Code profile the extensions, settings and icons go into; else the user's own
CODEBASE_SEARCH=0  # --codebase-search: agents.codebaseIndex.enabled true in the settings step; else the walkthrough offers it
TEAMS_APP=""       # --teams-app <clientId>:<tenant>: the Teams sign-in's company app, for the settings step
SKIPS=" "
OS=""
ARCH=""
CODE="code"
CODE_DATA=""  # as root on Linux: the --user-data-dir VS Code's CLI insists on (its default, ~/.config/Code)
AS_ROOT=0
SUDO=""
TTY_OPEN=0
CLASH=""  # why Agentic Works can't go in beside the standalone five; when set, Agentic Works fails and the steps after it stay out
AGENTIC_WORKS_FRESH=0  # 1 when this run installs Agentic Works where there was none: then VS Code is opened
RELOAD_VSCODE=0  # VS Code was open while Agentic Works came or changed: say to reload its local windows
VSIX_DIR=""  # the .vsix download's temp dir while it exists; cleanup removes it on an interrupt too
INLINED_HELPER=""  # the released script's own copy of the helper, written to a private temp file at start
HOMEBREW_STATE=""  # planned (a dry run printed its install) or failed, so a second step doesn't repeat it
HOMEBREW_USED=0  # 1 once this run installed Homebrew or installed anything through it
SUDO_FAILED=0  # 1 when the up-front `sudo -v` failed: on a Mac, an account that isn't an administrator

# ---- the checklist -------------------------------------------------------------------------------------------

STEP_LABEL=""
STEP_RESULT=""
LINE_OPEN=0  # 1 while the cursor sits at the end of a terminal's "… <label>" line
SPIN_PID=""  # the spinner drawing the open line, on a terminal; stopped before anything else is printed
SPIN_PREFIX="  "  # the open line's indent: "  " for a step's own line, "      " for a waiting line under it
SPIN_TEXT=""  # the open line's text after its "…"
WAIT_OPEN=0  # 1 while the open line is a waiting line (step_wait), which step_end keeps rather than overwrites
N_OK=0
N_SKIP=0
N_FAIL=0
C_OK="" C_SKIP="" C_FAIL="" C_END=""
if [ -t 1 ] && [ -z "${NO_COLOR+set}" ]; then
  C_OK=$'\033[32m' C_SKIP=$'\033[90m' C_FAIL=$'\033[31m' C_END=$'\033[0m'
fi
LOG=/dev/null  # every command's output; made in main, kept when a step fails

step_begin() {  # $1 = label: "  … <label>", overwritten by step_end on a terminal, where a spinner turns meanwhile
  STEP_LABEL=$1
  SPIN_PREFIX="  " SPIN_TEXT=$1 WAIT_OPEN=0
  if [ -t 1 ]; then
    printf '  … %s' "$STEP_LABEL"
    LINE_OPEN=1
    spinner_start
  else
    printf '  … %s\n' "$STEP_LABEL"
  fi
}

spinner_start() {  # the "…" of the open line turns until spinner_stop; it ends by itself if this script is gone
  local parent=$$
  (
    while kill -0 "$parent" 2> /dev/null; do
      for f in ⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏; do
        printf '\r%s%s %s' "$SPIN_PREFIX" "$f" "$SPIN_TEXT"
        sleep 0.1
      done
    done
  ) &
  SPIN_PID=$!
}

spinner_stop() {  # before anything else is printed: the spinner gone, the open line back to "  … <label>"
  [ -n "$SPIN_PID" ] || return 0
  { kill "$SPIN_PID" && wait "$SPIN_PID"; } 2> /dev/null
  SPIN_PID=""
  [ "$LINE_OPEN" = 1 ] && printf '\r%s… %s' "$SPIN_PREFIX" "$SPIN_TEXT"
  return 0
}

step_wait() {  # $1 = text: a line under the step for a long wait (an install, a download), its "…" turning until
               # the next output; without a terminal, a plain line as step_say prints
  spinner_stop
  if [ "$LINE_OPEN" = 1 ]; then
    printf '\n'
    LINE_OPEN=0
  fi
  if [ -t 1 ]; then
    SPIN_PREFIX="      " SPIN_TEXT=$1 WAIT_OPEN=1
    printf '      … %s' "$1"
    LINE_OPEN=1
    spinner_start
  else
    printf '      %s\n' "$1"
  fi
}

step_say() {  # $1 = text: a line under the step in progress (prompts, URLs, dry-run commands)
  spinner_stop
  if [ "$LINE_OPEN" = 1 ]; then
    printf '\n'
    LINE_OPEN=0 WAIT_OPEN=0
  fi
  printf '      %s\n' "$1"
}

step_end() {  # $1 = done|already|skipped|failed, $2 = detail
  local result=$1 detail=${2:-} mark colour text
  case $result in
    done|already)
      mark='✓' colour=$C_OK text=$STEP_LABEL
      [ -n "$detail" ] && text="$text ($detail)"
      [ "$result" = already ] && text="$text (already)"
      N_OK=$((N_OK + 1)) ;;
    skipped)
      mark='–' colour=$C_SKIP text="$STEP_LABEL: $detail"
      N_SKIP=$((N_SKIP + 1)) ;;
    *)
      result=failed mark='✗' colour=$C_FAIL text="$STEP_LABEL: $detail"
      N_FAIL=$((N_FAIL + 1)) ;;
  esac
  spinner_stop
  if [ "$LINE_OPEN" = 1 ]; then
    if [ "$WAIT_OPEN" = 1 ]; then printf '\n'; else printf '\r\033[K'; fi  # a waiting line stays
    LINE_OPEN=0 WAIT_OPEN=0
  fi
  printf '  %s%s%s %s\n' "$colour" "$mark" "$C_END" "$text"
  STEP_RESULT=$result
}

tally() {
  printf 'Done: %d ✓  %d –  %d ✗\n' "$N_OK" "$N_SKIP" "$N_FAIL"
}

skip_named() {  # $1 = step name: true when --skip named it
  case $SKIPS in *" $1 "*) return 0 ;; esac
  return 1
}

skipped() {  # $1 = step name, $2 = label: true (and the step is marked skipped) when --skip named it
  skip_named "$1" || return 1
  STEP_LABEL=$2
  step_end skipped "skipped (--skip $1)"
}

# ---- running commands ----------------------------------------------------------------------------------------
# Every command runs with stdin from /dev/null (the terminal's answers come from fd 3) and its output in $LOG, so
# the checklist stays readable; --dry-run prints the command under the step instead.

run() {  # argv
  if [ "$DRY_RUN" = 1 ]; then
    local shown
    shown=$(printf '%q ' "$@")
    step_say "\$ ${shown% }"
    return 0
  fi
  printf '$ %s\n' "$*" >> "$LOG"
  "$@" < /dev/null >> "$LOG" 2>&1
}

run_sh() {  # $1 = a shell command line (pipes, redirections)
  if [ "$DRY_RUN" = 1 ]; then
    step_say "\$ $1"
    return 0
  fi
  printf '$ %s\n' "$1" >> "$LOG"
  bash -o pipefail -c "$1" < /dev/null >> "$LOG" 2>&1
}

have() {  # $1 = command: on PATH
  command -v "$1" > /dev/null 2>&1
}

# ---- platform ------------------------------------------------------------------------------------------------

unsupported() {  # $1 = what this system is: the Platform step fails, and the run stops
  step_end failed "$1 isn't supported"
  printf '\nagentic-works-install supports %s.\n\n' "$SUPPORTED"
  tally
  exit 1
}

os_from_release() {  # $1 = an os-release file: prints ubuntu|debian|rhel|fedora; false on anything else
  local id like version major
  id=$(. "$1" 2> /dev/null && printf '%s' "${ID:-}")
  like=$(. "$1" 2> /dev/null && printf '%s' "${ID_LIKE:-}")
  version=$(. "$1" 2> /dev/null && printf '%s' "${VERSION_ID:-0}")
  major=${version%%.*}
  case " $id $like " in
    " ubuntu "*) [ "$major" -ge 22 ] 2> /dev/null && echo ubuntu ;;
    *" debian "*|*" ubuntu "*) echo debian ;;
    *" rhel "*) [ "$major" -ge 8 ] 2> /dev/null && echo rhel ;;
    *" fedora "*) echo fedora ;;
    *) return 1 ;;
  esac
}

detect_platform() {  # sets OS=macos|ubuntu|debian|rhel|fedora and ARCH=arm64|x86_64; exits 1 anywhere else
  local kernel machine release=/etc/os-release
  if [ -n "${AGENTIC_WORKS_INSTALL_FAKE_OS:-}" ]; then
    OS=$AGENTIC_WORKS_INSTALL_FAKE_OS
    case $OS in macos|ubuntu|debian|rhel|fedora) ;; *) unsupported "$OS" ;; esac
  else
    kernel=$(uname -s)
    case $kernel in
      Darwin) OS=macos ;;
      Linux)
        [ -r "$release" ] || unsupported "Linux without $release"
        OS=$(os_from_release "$release") ||
          unsupported "$(. "$release" 2> /dev/null && printf '%s' "${PRETTY_NAME:-${ID:-an unknown Linux}}")" ;;
      *) unsupported "$kernel" ;;
    esac
  fi
  machine=${AGENTIC_WORKS_INSTALL_FAKE_ARCH:-$(uname -m)}
  case $machine in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64) ARCH=x86_64 ;;
    *) unsupported "$OS on $machine" ;;
  esac
  if [ "$(id -u)" != 0 ]; then
    SUDO=sudo
  elif [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    # `sudo bash agentic-works-install.sh`: VS Code, its settings and the PATH block would go to root, not to this user.
    step_end failed "Run it without sudo: bash agentic-works-install.sh — it asks for your password when it needs it."
    printf '\n'
    tally
    exit 1
  else
    AS_ROOT=1
    [ "$OS" = macos ] || CODE_DATA="$HOME/.config/Code"
  fi
}

check_platform() {
  step_begin "Platform"
  detect_platform
  step_end done "$OS, $ARCH"
}

# ---- VS Code -------------------------------------------------------------------------------------------------

is_cursor() {  # true when $1, or what it links to, lives in a Cursor folder: Cursor can install a `code` that opens Cursor
  local resolved
  resolved=$(readlink -f "$1" 2> /dev/null) || resolved=$1
  case "$(printf '%s %s' "$1" "$resolved" | tr '[:upper:]' '[:lower:]')" in */cursor*) return 0 ;; esac
  return 1
}

CURSOR_CODE=""  # a `code` on the PATH that opens Cursor, passed over
find_code() {  # sets CODE to VS Code's CLI; false when VS Code isn't installed. A Cursor `code` is never taken for it.
  local c found=""
  CURSOR_CODE=""
  while IFS= read -r c; do
    [ -n "$c" ] || continue
    if is_cursor "$c"; then [ -n "$CURSOR_CODE" ] || CURSOR_CODE=$c; continue; fi
    found=$c; break
  done <<EOF_CODE
$(type -ap code 2> /dev/null)
EOF_CODE
  if [ -n "$found" ]; then
    CODE=$found
  elif [ "$OS" = macos ] && [ -x "$MAC_CODE" ]; then
    CODE=$MAC_CODE
  else
    CODE=code
    return 1
  fi
}

find_brew() {  # true when Homebrew is installed; puts it on PATH for this run
  local prefix
  command -v brew > /dev/null 2>&1 && return 0
  for prefix in /opt/homebrew /usr/local; do
    if [ -x "$prefix/bin/brew" ]; then
      PATH="$prefix/bin:$PATH"
      return 0
    fi
  done
  return 1
}

brew_bin() {  # where Homebrew's brew is, or would be after the install
  if command -v brew > /dev/null 2>&1; then
    command -v brew
  elif [ "$ARCH" = arm64 ]; then
    echo /opt/homebrew/bin/brew
  else
    echo /usr/local/bin/brew
  fi
}

SUDO_KEEPALIVE=""  # the pid of the loop keeping sudo's timestamp fresh while Homebrew installs

sudo_keepalive_start() {  # Homebrew's installer runs sudo itself, and can take longer than sudo's 5-minute timestamp
  [ -n "$SUDO" ] && [ "$DRY_RUN" != 1 ] && [ "$SUDO_FAILED" = 0 ] || return 0
  # shellcheck disable=SC2016
  ( s=""
    trap 'kill "$s" 2> /dev/null; exit 0' TERM
    while sudo -n -v 2> /dev/null; do sleep 50 & s=$!; wait "$s"; done ) < /dev/null > /dev/null 2>&1 &
  SUDO_KEEPALIVE=$!
}

sudo_keepalive_stop() {  # the loop, and its sleep
  [ -n "$SUDO_KEEPALIVE" ] || return 0
  kill "$SUDO_KEEPALIVE" 2> /dev/null
  wait "$SUDO_KEEPALIVE" 2> /dev/null
  SUDO_KEEPALIVE=""
}

ensure_homebrew() {  # macOS: Homebrew, from its own installer (which needs an administrator account)
  local tmp rc
  find_brew && return 0
  case $HOMEBREW_STATE in planned) return 0 ;; failed) return 1 ;; esac
  step_wait "Homebrew is missing; installing it first (a few minutes)"
  tmp=$(mktemp "${TMPDIR:-/tmp}/agentic-works-install-homebrew.XXXXXX") || return 1
  sudo_keepalive_start
  # Downloaded first, then run: a failed download stops here rather than running an empty script.
  run curl -fsSL -o "$tmp" "$HOMEBREW_INSTALLER" && run env NONINTERACTIVE=1 /bin/bash "$tmp"
  rc=$?
  sudo_keepalive_stop
  rm -f "$tmp"
  if [ "$DRY_RUN" = 1 ]; then
    HOMEBREW_STATE=planned
  elif [ "$rc" != 0 ] || ! find_brew; then
    HOMEBREW_STATE=failed
    return 1
  fi
  HOMEBREW_USED=1
}

homebrew_failure() {  # why ensure_homebrew failed, for a step's line
  if [ "$SUDO_FAILED" = 1 ]; then echo "needs an administrator account"; else echo "couldn't be installed"; fi
}

deb_arch() {
  if [ "$ARCH" = arm64 ]; then echo arm64; else echo amd64; fi
}

apt_has_source() {  # $1 = a repository URL: true when an apt source, not commented out, already points at it
  # As VS Code's own postinst checks: a second source for the same repository with another keyring makes every
  # apt-get fail ("Conflicting values set for option Signed-By").
  local file
  for file in "$APT_DIR/sources.list" "$APT_DIR"/sources.list.d/*.list "$APT_DIR"/sources.list.d/*.sources; do
    [ -f "$file" ] || continue
    grep -v '^[[:space:]]*#' "$file" 2> /dev/null | grep -qF "$1" && return 0
  done
  return 1
}

add_apt_repo() {  # $1 = key URL, $2 = keyring path, $3 = sources.list.d file, $4 = deb line, $5 = armored|binary
  # The sources.list line is written only once the keyring is in place and non-empty: a line without its key
  # makes every later apt-get update fail, on every rerun.
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/agentic-works-install-key.XXXXXX") || return 1
  if ! run curl -fsSL -o "$tmp" "$1" || { [ "$DRY_RUN" != 1 ] && [ ! -s "$tmp" ]; }; then
    rm -f "$tmp"
    return 1
  fi
  if [ "$5" = armored ]; then
    if ! run gpg --batch --yes --dearmor -o "$tmp.gpg" "$tmp" || { [ "$DRY_RUN" != 1 ] && [ ! -s "$tmp.gpg" ]; }; then
      rm -f "$tmp" "$tmp.gpg"
      return 1
    fi
    [ "$DRY_RUN" = 1 ] || mv -f "$tmp.gpg" "$tmp"
  fi
  # shellcheck disable=SC2086
  run $SUDO install -m 644 "$tmp" "$2" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  run_sh "echo '$4' | $SUDO tee $3 > /dev/null"
}

PREREQS_PLANNED=" "  # a dry run's curl and gpg, printed once and then taken as installed

apt_prereqs() {  # $* = commands needed: installs the missing ones' packages (curl, gpg)
  local need="" tool
  for tool in "$@"; do
    have "$tool" && continue
    case $PREREQS_PLANNED in *" $tool "*) continue ;; esac
    [ "$DRY_RUN" = 1 ] && PREREQS_PLANNED="$PREREQS_PLANNED$tool "
    case $tool in curl) need="${need:+$need }curl ca-certificates" ;; gpg) need="${need:+$need }gnupg" ;; esac
  done
  [ -n "$need" ] || return 0  # neither is in a minimal Debian or Ubuntu
  # shellcheck disable=SC2086
  run $SUDO apt-get update && run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y $need
}

install_vscode_apt() {  # Ubuntu and Debian-based: Microsoft's apt repository (unless a source has it); curl, gnupg
  # shellcheck disable=SC2086
  if ! apt_has_source "packages.microsoft.com/repos/code"; then
    apt_prereqs curl gpg &&
      add_apt_repo "$MS_KEY" /usr/share/keyrings/microsoft.gpg /etc/apt/sources.list.d/vscode.list \
        "deb [arch=$(deb_arch) signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main" \
        armored || return 1
  fi
  # shellcheck disable=SC2086
  run $SUDO apt-get update && run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y code
}

install_vscode_dnf() {  # RHEL/Rocky and Fedora: Microsoft's yum repository, with dnf
  # shellcheck disable=SC2086
  run $SUDO rpm --import "$MS_KEY" &&
    run_sh "printf '[code]\\nname=Visual Studio Code\\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\\nenabled=1\\ngpgcheck=1\\ngpgkey=$MS_KEY\\n' | $SUDO tee /etc/yum.repos.d/vscode.repo > /dev/null" &&
    run $SUDO dnf install -y code
}

FEDORA_SSL="libssl.so.3()(64bit)"
SSL_FAILED=""

fedora_needs_ssl() {  # true on a Fedora without libssl.so.3 (Fedora 45 ships OpenSSL 4)
  # VS Code checks each Marketplace extension's signature with vsce-sign, a .NET program that loads libssl.so.3
  # (or .1.1) and aborts without one ("Signature verification failed with 'UnknownError'"); VS Code's rpm doesn't
  # require it.
  [ "$OS" = fedora ] || return 1
  printf '$ rpm -q --whatprovides %s\n' "$FEDORA_SSL" >> "$LOG"
  ! rpm -q --whatprovides "$FEDORA_SSL" < /dev/null >> "$LOG" 2>&1
}

install_fedora_ssl() {  # sets SSL_FAILED, the step's detail, when it fails
  SSL_FAILED="libssl.so.3 couldn't be installed, and without it VS Code installs no extensions; see $LOG, or run"
  SSL_FAILED="$SSL_FAILED \`dnf install openssl3-libs\`"
  # shellcheck disable=SC2086
  run $SUDO dnf install -y "$FEDORA_SSL"
}

ensure_vscode() {
  skipped vscode "VS Code" && return 0
  step_begin "VS Code"
  find_code; [ -z "$CURSOR_CODE" ] || step_say "The code command on your PATH opens Cursor; Agentic Works uses VS Code's own."
  if find_code; then
    if ! fedora_needs_ssl; then
      step_end already
    elif install_fedora_ssl; then
      step_end done "installed OpenSSL 3, for VS Code's extension signature checks"
    else
      step_end failed "$SSL_FAILED"
    fi
    return 0
  fi
  case $OS in
    macos)
      if ! ensure_homebrew; then
        step_end failed "Homebrew $(homebrew_failure); see $LOG, or download VS Code from $DOWNLOAD_URL"
        return 0
      fi
      HOMEBREW_USED=1
      run "$(brew_bin)" install --cask visual-studio-code ;;
    ubuntu|debian) install_vscode_apt ;;
    rhel|fedora) install_vscode_dnf ;;
  esac
  if [ "$DRY_RUN" = 1 ]; then
    ! fedora_needs_ssl || install_fedora_ssl
    step_end done "dry run"
  elif find_code; then
    if ! fedora_needs_ssl; then
      step_end done "installed"
    elif install_fedora_ssl; then
      step_end done "installed, with OpenSSL 3 for VS Code's extension signature checks"
    else
      step_end failed "installed, but $SSL_FAILED"
    fi
  elif [ "$OS" = macos ]; then
    step_end failed "the install didn't give a 'code' command; see $LOG, or download VS Code from $DOWNLOAD_URL"
  else
    step_end failed "the install didn't give a 'code' command; see $LOG"
  fi
}

# ---- code on the PATH ----------------------------------------------------------------------------------------

PATH_MARK="# added by agentic-works-install"
PATH_END="# end agentic-works-install"

shell_profile() {  # the login shell's profile file
  case ${SHELL:-} in
    *zsh) echo "$HOME/.zprofile" ;;
    *) if [ -f "$HOME/.bash_profile" ]; then echo "$HOME/.bash_profile"; else echo "$HOME/.profile"; fi ;;
  esac
}

ensure_path() {  # `code` on PATH for this run and, through one marked block in the login profile, new terminals
  local label="code on the PATH" profile short dir brew lines
  skipped path "$label" && return 0
  step_begin "$label"
  profile=$(shell_profile)
  short=${profile#"$HOME"/}
  if [ -f "$profile" ] && grep -qxF "$PATH_MARK" "$profile"; then
    step_end already "$short"
    return 0
  fi
  if ! find_code; then
    if [ "$DRY_RUN" = 1 ]; then step_end done "dry run"; else step_end skipped "VS Code isn't installed"; fi
    return 0
  fi
  dir=$(dirname "$CODE")
  case ":$PATH:" in *":$dir:"*) ;; *) PATH="$dir:$PATH" ;; esac
  case ":$ORIG_PATH:" in *":$dir:"*) step_end already; return 0 ;; esac
  brew=$(brew_bin)
  if [ "$OS" = macos ] && [ "$dir" = "$(dirname "$brew")" ]; then  # Homebrew's cask: its bin dir, as it advises
    if [ -f "$profile" ] && grep -q 'brew shellenv' "$profile"; then
      step_end already "$short"
      return 0
    fi
    lines="[ -x $brew ] && eval \"\$($brew shellenv)\""
  else
    lines="case \":\$PATH:\" in *\":$dir:\"*) ;; *) export PATH=\"$dir:\$PATH\" ;; esac"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    step_say "\$ append to $profile:"
    step_say "$lines"
    step_end done "dry run"
    return 0
  fi
  if printf '\n%s\n%s\n%s\n' "$PATH_MARK" "$lines" "$PATH_END" >> "$profile"; then
    step_end done "$short"
  else
    step_end failed "couldn't write $profile"
  fi
}

# ---- --profile: a VS Code profile of its own -------------------------------------------------------------------

profile_name_ok() {  # $1 = a profile name: letters, digits, spaces, dots, dashes and underscores; 1-40, not starting with a space
  [[ $1 =~ ^[A-Za-z0-9._-][A-Za-z0-9\ ._-]{0,39}$ ]]
}

ensure_profile() {  # --profile's VS Code profile, before any extension goes in: a failure stops the run, so nothing lands
  # in the user's own profile. VS Code closed: the helper makes it, with the user's settings, keybindings and snippets
  # copied in. VS Code open: it would lose a profile written beside it (tried, 2026-11-27), so a window opened on the
  # name makes it, and the user's settings are copied in after
  local label="Profile $PROFILE" rc waited=0 wait=${AGENTIC_WORKS_INSTALL_PROFILE_WAIT:-30}
  [ -n "$PROFILE" ] || return 0
  skipped profile "$label" && return 0
  step_begin "$label"
  if ! python_ok; then
    CLASH="there is no VS Code profile $PROFILE to install into ($PYTHON_WHY)"
    step_end failed "$PYTHON_WHY"
    return 0
  fi
  run_helper vscode-profile "$PROFILE"
  rc=$?
  if [ "$DRY_RUN" = 1 ]; then step_end done "dry run"; return 0; fi
  case $rc in
    0) if [ "$HELPER_OUT" = "already set" ]; then step_end already; else step_end done "$HELPER_OUT"; fi
       return 0 ;;
    2) ;;
    *) CLASH="there is no VS Code profile $PROFILE to install into; see $LOG"
       step_end failed "couldn't make it; see $LOG"
       return 0 ;;
  esac
  printf '$ %s --profile %s --new-window %s\n' "$CODE" "$PROFILE" "$FOLDER" >> "$LOG"
  "$CODE" ${CODE_DATA:+--user-data-dir "$CODE_DATA"} --profile "$PROFILE" --new-window ${FOLDER:+"$FOLDER"} < /dev/null >> "$LOG" 2>&1
  WINDOW_OPENED=1
  [ -z "$WINDOW_MARK" ] || : > "$WINDOW_MARK" 2>> "$LOG"
  while :; do
    run_helper vscode-profile "$PROFILE" && [ "$HELPER_OUT" = "already set" ] && break
    if [ "$waited" -ge "$wait" ]; then
      CLASH="there is no VS Code profile $PROFILE to install into; quit VS Code and rerun"
      step_end failed "VS Code didn't make it in the window opened on it; quit VS Code and rerun"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  local on=""
  [ -z "$FOLDER" ] || on="; on $FOLDER"
  if run_helper vscode-profile "$PROFILE" --fill && [ "$HELPER_OUT" = filled ]; then
    step_end done "made in a window VS Code opened on it, with your settings$on"
  else
    step_end done "made in a window VS Code opened on it$on"
  fi
}

# ---- the extensions: the standalone five, Agentic Works, its companions ---------------------------------------------

code_cli() {  # argv for VS Code's CLI; as root on Linux, with the --user-data-dir it insists on; in --profile's profile
  run "$CODE" ${CODE_DATA:+--user-data-dir "$CODE_DATA"} ${PROFILE:+--profile "$PROFILE"} "$@"
}

installed_extensions() {  # the installed extensions, as lowercase id@version words
  printf '$ %s --list-extensions --show-versions\n' "$CODE" >> "$LOG"
  "$CODE" ${CODE_DATA:+--user-data-dir "$CODE_DATA"} ${PROFILE:+--profile "$PROFILE"} --list-extensions --show-versions < /dev/null 2>> "$LOG" |
    tr 'A-Z' 'a-z'
}

installed_version() {  # $1 = id, $2 = installed_extensions' words: prints its version; false when not installed
  local word
  for word in $2; do
    case $word in "$1@"*) printf '%s' "${word#*@}"; return 0 ;; esac
  done
  return 1
}

version_cmp() {  # $1, $2 = versions (1.2.3): prints lt, eq or gt, numeric by field; a prerelease (-beta.1) is cut
  local a=${1%%-*} b=${2%%-*} x y
  while [ -n "$a" ] || [ -n "$b" ]; do
    x=${a%%.*} y=${b%%.*}
    if [ "$x" = "$a" ]; then a=""; else a=${a#*.}; fi
    if [ "$y" = "$b" ]; then b=""; else b=${b#*.}; fi
    x=${x%%[!0-9]*} y=${y%%[!0-9]*}
    x=$((10#${x:-0})) y=$((10#${y:-0}))
    if [ "$x" -lt "$y" ]; then echo lt; return 0; fi
    if [ "$x" -gt "$y" ]; then echo gt; return 0; fi
  done
  echo eq
}

extension_name() {  # $1 = id of one of the standalone five: its name
  case $1 in
    seanahn.perch) echo Perch ;;
    seanahn.chirp) echo chirp ;;
    seanahn.jay) echo jay ;;
    seanahn.kestrel-prs) echo kestrel ;;
    seanahn.gannet) echo Gannet ;;
    *) echo "$1" ;;
  esac
}

names_of() {  # $* = ids: their names as "A", "A and B" or "A, B and C"
  local id i=0 out=""
  for id in "$@"; do
    i=$((i + 1))
    if [ "$i" = 1 ]; then
      out=$(extension_name "$id")
    elif [ "$i" = $# ]; then
      out="$out and $(extension_name "$id")"
    else
      out="$out, $(extension_name "$id")"
    fi
  done
  printf '%s' "$out"
}

commas() {  # $* = words: "a, b, c"
  local text="$*"
  printf '%s' "${text// /, }"
}

ask_yn() {  # $1 = a [Y/n] question, on the terminal: 0 = yes (Enter too), 1 = no, 2 = no terminal or no answer
  local answer=""
  [ "$TTY_OPEN" = 1 ] || return 2
  spinner_stop
  if [ "$LINE_OPEN" = 1 ]; then
    printf '\n'
    LINE_OPEN=0
  fi
  printf '      %s ' "$1"
  if ! IFS= read -r answer <&3 && [ -z "$answer" ]; then  # end of input
    printf '\n'
    return 2
  fi
  [ -t 1 ] || printf '\n'  # on a terminal, its echo of Enter ends the line
  answer=${answer%$'\r'}
  case $answer in
    ""|[Yy]|[Yy][Ee][Ss]) return 0 ;;
    *) return 1 ;;
  esac
}

keep_gannet_state() {  # VS Code deletes an extension's global storage on uninstall: Gannet's machine.json (its folders
  # and checkouts) goes to Agentic Works' Repos part first, unless Agentic Works already has one
  local user from to
  if [ "$OS" = macos ]; then user="$HOME/Library/Application Support/Code/User"; else user="${CODE_DATA:-$HOME/.config/Code}/User"; fi
  from="$user/globalStorage/seanahn.gannet/machine.json"
  to="$user/globalStorage/agenticworks.agentic-works/machine.json"
  [ -f "$from" ] && [ ! -e "$to" ] || return 0
  mkdir -p "${to%/*}" && cat "$from" > "$to.tmp" && mv "$to.tmp" "$to" || { rm -f "$to.tmp"; printf "couldn't keep Gannet's machine.json\n" >> "$LOG"; }
  return 0
}

vscode_open() {  # true while VS Code's app runs here: a local window or a Remote one, which can't be told apart here
  have pgrep || return 1
  case $OS in
    macos) pgrep -f '/Visual Studio Code.app/Contents/MacOS/' > /dev/null 2>&1 ;;
    *) pgrep -x code > /dev/null 2>&1 ;;
  esac
}

ask_vscode_closed() {  # before the standalone extensions go: open local windows run them beside Agentic Works until
  # reloaded. Asked once; a Remote window runs its extensions on its host, so it may stay open and the run goes on
  local answer
  [ "$DRY_RUN" = 1 ] && return 0
  vscode_open || return 0
  if [ "$TTY_OPEN" = 1 ] && [ "$YES" != 1 ]; then
    spinner_stop
    if [ "$LINE_OPEN" = 1 ]; then printf '\n'; LINE_OPEN=0; fi
    printf '      %s ' "VS Code is open on this computer. Close its local windows (a Remote window can stay), then press Enter."
    if IFS= read -r answer <&3; then [ -t 1 ] || printf '\n'; else printf '\n'; fi
  fi
  vscode_open && RELOAD_VSCODE=1
  return 0
}

check_standalone() {  # the standalone five would clash with Agentic Works (the same command ids): uninstall them, or stop
  local installed id found="" failed="" names rc
  skipped standalone "Standalone extensions" && return 0
  find_code || return 0  # no VS Code, no extensions
  installed=$(installed_extensions)
  for id in $STANDALONE; do
    installed_version "$id" "$installed" > /dev/null && found="$found $id"
  done
  [ -n "$found" ] || return 0
  # shellcheck disable=SC2086
  names=$(names_of $found)
  if [ "$DRY_RUN" = 1 ]; then
    step_begin "Standalone extensions"
    step_say "Agentic Works replaces $names: asks to uninstall them (or --yes)"
    for id in $found; do code_cli --uninstall-extension "$id"; done
    step_end done "dry run"
    return 0
  fi
  if [ "$YES" = 1 ]; then
    rc=0
  else
    ask_yn "Agentic Works replaces $names. Uninstall them and use Agentic Works? [Y/n]"
    rc=$?
  fi
  case $rc in
    1) CLASH="stopped — Agentic Works would clash with $names; uninstall them, or rerun and answer Y"; return 0 ;;
    2) CLASH="$names would clash with Agentic Works, and there is no terminal to ask on; rerun with --yes to uninstall them"
       return 0 ;;
  esac
  ask_vscode_closed
  case " $found " in *" seanahn.gannet "*) keep_gannet_state ;; esac
  for id in $found; do
    code_cli --uninstall-extension "$id" || failed="$failed $id"
  done
  if [ -n "$failed" ]; then
    # shellcheck disable=SC2086
    CLASH="couldn't uninstall $(names_of $failed), and Agentic Works would clash with it; see $LOG,"
    CLASH="$CLASH uninstall it in VS Code, then rerun"
    return 0
  fi
  step_begin "Standalone extensions"
  step_end done "uninstalled $names"
}

agentic_works_stamped() {  # true when make release wrote this script's Agentic Works version and SHA-256 in
  case $AGENTIC_WORKS_VERSION$AGENTIC_WORKS_SHA256 in *@*) return 1 ;; esac
  [ -n "$AGENTIC_WORKS_VERSION" ] && [ -n "$AGENTIC_WORKS_SHA256" ]
}

lower() {  # $1 = text: in lowercase
  printf '%s' "$1" | tr 'A-Z' 'a-z'
}

file_sha256() {  # $1 = file: prints its SHA-256; false when neither sha256sum nor shasum is here
  local out
  if have sha256sum; then
    out=$(sha256sum "$1" 2>> "$LOG") || return 1
  elif have shasum; then
    out=$(shasum -a 256 "$1" 2>> "$LOG") || return 1
  else
    return 1
  fi
  printf '%s' "${out%% *}"
}

install_agentic_works_vsix() {  # $1 = temp dir: download this release's .vsix there, check it, install it; sets AGENTIC_WORKS_ERROR
  local vsix="$1/agentic-works-$AGENTIC_WORKS_VERSION.vsix" sum  # code installs a path only when it ends in .vsix
  AGENTIC_WORKS_ERROR=""
  if [ "$DRY_RUN" != 1 ] && ! have curl; then
    AGENTIC_WORKS_ERROR="curl isn't installed, to download $AGENTIC_WORKS_VSIX_URL"
  elif ! run curl -fsSL -o "$vsix" "$AGENTIC_WORKS_VSIX_URL"; then
    AGENTIC_WORKS_ERROR="couldn't download $AGENTIC_WORKS_VSIX_URL; check the network, then run the installer again"
  elif [ "$DRY_RUN" = 1 ]; then
    code_cli --install-extension "$vsix"
  elif ! sum=$(file_sha256 "$vsix"); then
    AGENTIC_WORKS_ERROR="no sha256sum or shasum to check the download with"
  elif [ "$(lower "$sum")" != "$(lower "$AGENTIC_WORKS_SHA256")" ]; then
    AGENTIC_WORKS_ERROR="the download did not match its checksum — run the installer again"
  elif ! code_cli --install-extension "$vsix"; then
    # Agentic Works' extension pack is its companions, which VS Code fetches from the Marketplace as it installs Agentic Works.
    AGENTIC_WORKS_ERROR="VS Code couldn't install it; it also fetches Claude Code, ChatGPT and Perch's audio from the"
    AGENTIC_WORKS_ERROR="$AGENTIC_WORKS_ERROR Marketplace, which may be unreachable from here — see $LOG"
  fi
  [ -z "$AGENTIC_WORKS_ERROR" ]
}

AGENTIC_WORKS_IN_PLACE=0  # 1 when the Agentic Works step leaves an Agentic Works installed (this release's, an older or a newer one)

ensure_agentic_works() {  # this release's Agentic Works: installed, upgraded over an older one, or a newer one left alone
  local current="" detail="installed $AGENTIC_WORKS_VERSION"
  skipped extension "Agentic Works" && return 0
  step_begin "Agentic Works"
  if [ -n "$CLASH" ]; then
    step_end failed "$CLASH"
    return 0
  fi
  if ! agentic_works_stamped; then
    step_end failed "this copy of the installer has no Agentic Works release in it; run a released installer: $LATEST_INSTALLER"
    return 0
  fi
  if find_code; then
    current=$(installed_version "$AGENTIC_WORKS_ID" "$(installed_extensions)")
  elif [ "$DRY_RUN" != 1 ]; then
    step_end skipped "VS Code isn't installed"
    return 0
  fi
  [ -z "$current" ] || AGENTIC_WORKS_IN_PLACE=1
  if [ -n "$current" ]; then
    case $(version_cmp "$current" "$AGENTIC_WORKS_VERSION") in
      eq) step_end already; return 0 ;;
      gt) step_end skipped "$current is newer than this installer's $AGENTIC_WORKS_VERSION; left as is"; return 0 ;;
    esac
    detail="upgraded from $current to $AGENTIC_WORKS_VERSION"
  fi
  case $OS in ubuntu|debian) apt_prereqs curl ;; esac  # not in a minimal system; a failure is reported just below
  if ! VSIX_DIR=$(mktemp -d "${TMPDIR:-/tmp}/agentic-works-install-vsix.XXXXXX"); then
    VSIX_DIR=""
    step_end failed "couldn't make a temp dir for the download"
    return 0
  fi
  install_agentic_works_vsix "$VSIX_DIR"
  rm -rf "$VSIX_DIR"
  VSIX_DIR=""
  if [ -n "$AGENTIC_WORKS_ERROR" ]; then
    step_end failed "$AGENTIC_WORKS_ERROR"
  elif [ "$DRY_RUN" = 1 ]; then
    [ -n "$current" ] || AGENTIC_WORKS_FRESH=1
    step_end done "dry run"
  else
    AGENTIC_WORKS_IN_PLACE=1
    step_end done "$detail"
    if [ -z "$current" ]; then AGENTIC_WORKS_FRESH=1; elif vscode_open; then RELOAD_VSCODE=1; fi
  fi
}

ensure_companions() {  # Claude Code and ChatGPT (Perch runs their claude and codex) and Perch's audio, by id
  local installed="" id missing="" failed="" agents=""
  skipped companions "Companions" && return 0
  step_begin "Companions"
  if [ -n "$CLASH" ]; then
    step_end skipped "skipped — Agentic Works was not installed"
    return 0
  fi
  if find_code; then
    installed=$(installed_extensions)
  elif [ "$DRY_RUN" != 1 ]; then
    step_end skipped "VS Code isn't installed"
    return 0
  fi
  for id in $COMPANIONS; do
    installed_version "$id" "$installed" > /dev/null || missing="$missing $id"
  done
  if [ -z "$missing" ]; then
    step_end already
    return 0
  fi
  for id in $missing; do
    code_cli --install-extension "$id" || failed="$failed $id"
  done
  case $failed in
    *anthropic.claude-code*|*openai.chatgpt*)
      agents="; Perch's tabs need Claude Code or ChatGPT to run an agent"
      [ "$AGENTIC_WORKS_IN_PLACE" = 0 ] || agents="; Agentic Works works, but${agents#;}" ;;
  esac
  # shellcheck disable=SC2086
  if [ "$DRY_RUN" = 1 ]; then
    step_end done "dry run"
  elif [ -n "$failed" ]; then
    step_end failed "$(commas $failed) didn't install (see $LOG)$agents"
  else
    step_end done "installed $(commas $missing)"
  fi
}

# ---- Claude Code's command-line tool, for a terminal ---------------------------------------------------------

profile_block_add() {  # $1 = profile, $2 = a line: into Agentic Works' PATH block (made when there is none); false on failure
  # The block is the one whose marker is a whole line "# added by agentic-works-install": the Homebrew block's marker
  # ("...: Homebrew") is another block, and the line never goes into it.
  local profile=$1 line=$2 text="" row start=0 end=0 i=0 n=0
  if [ -f "$profile" ]; then
    while IFS= read -r row || [ -n "$row" ]; do
      i=$((i + 1))
      if [ "$start" = 0 ]; then
        [ "$row" = "$PATH_MARK" ] && start=$i
      elif [ "$end" = 0 ] && [ "$row" = "$PATH_END" ]; then
        end=$i
      fi
    done < "$profile"
  fi
  if [ "$start" = 0 ] || [ "$end" = 0 ]; then
    printf '\n%s\n%s\n%s\n' "$PATH_MARK" "$line" "$PATH_END" >> "$profile"
    return
  fi
  while IFS= read -r row || [ -n "$row" ]; do
    n=$((n + 1))
    [ "$n" = "$end" ] && text="$text$line"$'\n'
    text="$text$row"$'\n'
  done < "$profile"
  printf '%s' "$text" > "$profile"  # in place: the file's mode and any symlink stay
}

claude_local_bin_planned() {  # true when ~/.local/bin isn't on the PATH a new terminal gets
  case ":$ORIG_PATH:" in *":$HOME/.local/bin:"*) return 1 ;; esac
  return 0
}

ensure_claude_path() {  # ~/.local/bin on the PATH for this run and, in Agentic Works' block, for new terminals; false on failure
  local dir="$HOME/.local/bin" profile line
  case ":$PATH:" in *":$dir:"*) ;; *) PATH="$dir:$PATH" ;; esac
  claude_local_bin_planned || return 0
  profile=$(shell_profile)
  line="case \":\$PATH:\" in *\":$dir:\"*) ;; *) export PATH=\"$dir:\$PATH\" ;; esac"
  if [ -f "$profile" ] && grep -qF "$line" "$profile"; then return 0; fi
  if [ "$DRY_RUN" = 1 ]; then
    step_say "\$ add to $profile, inside Agentic Works' block:"
    step_say "$line"
    return 0
  fi
  profile_block_add "$profile" "$line" 2>> "$LOG"
}

ensure_claude() {  # Claude Code's CLI, from Anthropic's installer (user-level: no sudo): `claude` in a terminal
  local label="Claude Code CLI" tmp rc
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone five
  skipped claude "$label" && return 0
  step_begin "$label"
  if [ -e "$HOME/.local/bin/claude" ]; then
    if ensure_claude_path; then
      step_end already
    else
      step_end failed "claude is in ~/.local/bin, but $(shell_profile) couldn't be written"
    fi
    return 0
  fi
  if have claude; then
    step_end already
    return 0
  fi
  case $OS in ubuntu|debian) apt_prereqs curl ;; esac  # not in a minimal system
  tmp=$(mktemp "${TMPDIR:-/tmp}/agentic-works-install-claude.XXXXXX") || { step_end failed "couldn't make a temp file; see $LOG"; return 0; }
  # Downloaded first, then run, as Homebrew's is: a failed download stops here rather than running an empty script.
  run curl -fsSL -o "$tmp" "$CLAUDE_INSTALLER" && run bash "$tmp"
  rc=$?
  rm -f "$tmp"
  if [ "$DRY_RUN" = 1 ]; then
    ensure_claude_path
    step_end done "dry run"
  elif [ "$rc" != 0 ] || [ ! -e "$HOME/.local/bin/claude" ]; then
    step_end failed "couldn't be installed; see $LOG"
  elif ensure_claude_path; then
    step_end done "installed"
  else
    step_end failed "installed in ~/.local/bin, but $(shell_profile) couldn't be written, so a new terminal won't find it"
  fi
}

# ---- git, which Claude Code, Codex and the PRs part expect to run --------------------------------------------

git_works() {  # true when `git --version` runs; on a Mac, Apple's /usr/bin/git shim without the CLT is never run
  local git=${AGENTIC_WORKS_INSTALL_GIT:-}
  [ -n "$git" ] || git=$(command -v git 2> /dev/null) || return 1
  if [ "$OS" = macos ] && [ "$git" = /usr/bin/git ] && ! xcode-select -p > /dev/null 2>&1; then
    return 1  # the shim would open Apple's install dialog
  fi
  printf '$ %s --version\n' "$git" >> "$LOG"
  "$git" --version < /dev/null >> "$LOG" 2>&1
}

wait_for_clt() {  # up to AGENTIC_WORKS_INSTALL_CLT_WAIT seconds for Apple's Command Line Tools; polled every 5 s (1 s if short)
  local wait=${AGENTIC_WORKS_INSTALL_CLT_WAIT:-600} step=5 elapsed=0
  case $wait in ''|*[!0-9]*) wait=600 ;; esac
  [ "$wait" -lt 10 ] && step=1
  while ! xcode-select -p > /dev/null 2>&1; do
    [ "$elapsed" -ge "$wait" ] && return 1
    sleep "$step"
    elapsed=$((elapsed + step))
  done
}

ensure_git() {
  local rc=0
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone five
  skipped git "git" && return 0
  step_begin "git"
  if git_works; then
    step_end already
    return 0
  fi
  case $OS in
    macos)
      if find_brew || [ "$HOMEBREW_STATE" = planned ]; then
        HOMEBREW_USED=1
        run "$(brew_bin)" install git || rc=1
      else
        step_say "git needs Apple's Command Line Tools; Apple's installer window opens next"
        run xcode-select --install || rc=1
        [ "$rc" = 0 ] && [ "$DRY_RUN" != 1 ] && step_wait "waiting for Apple's install to finish"
        if [ "$rc" = 0 ] && [ "$DRY_RUN" != 1 ] && ! wait_for_clt; then
          step_end failed "finish the Command Line Tools install Apple opened, then run git --version"
          return 0
        fi
      fi ;;
    ubuntu|debian)  # a fresh machine's package lists may be stale or missing: updated first, as the other apt installs are
      # shellcheck disable=SC2086
      { run $SUDO apt-get update && run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y git; } || rc=1 ;;
    rhel|fedora)
      # shellcheck disable=SC2086
      run $SUDO dnf install -y git || rc=1 ;;
  esac
  if [ "$DRY_RUN" = 1 ]; then
    step_end done "dry run"
  elif [ "$rc" != 0 ]; then
    step_end failed "couldn't be installed; see $LOG"
  else
    step_end done "installed"
  fi
}

# ---- GitHub, for kestrel's PRs panel -------------------------------------------------------------------------

GH_REPO_ADDED=0  # 1 once install_gh has added GitHub's package repository

install_gh() {  # GitHub's CLI: Homebrew; GitHub's apt or rpm repository; Fedora's own repository
  case $OS in
    macos)
      ensure_homebrew || return 1
      HOMEBREW_USED=1
      run "$(brew_bin)" install gh ;;
    ubuntu|debian)
      # shellcheck disable=SC2086
      if ! apt_has_source "cli.github.com/packages"; then
        apt_prereqs curl &&
          add_apt_repo "$GH_KEY" /usr/share/keyrings/githubcli-archive-keyring.gpg \
            /etc/apt/sources.list.d/github-cli.list \
            "deb [arch=$(deb_arch) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
            binary || return 1
        GH_REPO_ADDED=1
      fi
      # shellcheck disable=SC2086
      run $SUDO apt-get update && run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y gh ;;
    rhel)
      # Not `--repo gh-cli`, as GitHub's page has it: that hides the system repositories, and gh needs their git.
      # shellcheck disable=SC2086
      run $SUDO dnf install -y 'dnf-command(config-manager)' &&
        run $SUDO dnf config-manager --add-repo "$GH_RPM_REPO" || return 1
      GH_REPO_ADDED=1
      # shellcheck disable=SC2086
      run $SUDO dnf install -y gh ;;
    fedora)
      # shellcheck disable=SC2086
      run $SUDO dnf install -y gh ;;
  esac
}

github_user() {
  gh api user --jq .login < /dev/null 2>> "$LOG"
}

gh_signed_in() {
  printf '$ gh auth status\n' >> "$LOG"
  gh auth status < /dev/null >> "$LOG" 2>&1
}

ensure_github() {  # gh, for kestrel's PRs panel; the sign-in is Agentic Works' walkthrough's, never the terminal's
  local installed="" user
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone five
  skipped github "GitHub" && return 0
  step_begin "GitHub"
  if ! have gh; then
    if ! install_gh; then
      if [ "$OS" = macos ] && [ "$HOMEBREW_STATE" = failed ]; then
        step_end failed "gh comes through Homebrew, which $(homebrew_failure); see $LOG"
      else
        step_end failed "gh couldn't be installed; see $LOG"
      fi
      return 0
    fi
    if [ "$DRY_RUN" != 1 ] && ! have gh; then
      step_end failed "the install didn't give a 'gh' command; see $LOG"
      return 0
    fi
    installed="installed gh"
    [ "$GH_REPO_ADDED" = 0 ] || installed="added GitHub's package repository, $installed"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    if [ -n "$installed" ]; then step_end done "$installed; dry run"; else step_end already; fi
    return 0
  fi
  if gh_signed_in; then
    user=$(github_user)
    if [ -n "$installed" ]; then
      step_end done "$installed; signed in${user:+ as $user}"
    else
      step_end already
      [ -z "$user" ] || step_say "signed in as $user"
    fi
  else
    if [ -n "$installed" ]; then step_end done "$installed"; else step_end already; fi
    step_say "sign in from Agentic Works' walkthrough in VS Code (Sign in to GitHub)"
  fi
}

ensure_homebrew_path() {  # macOS: Homebrew's shellenv in the login profile, when this run used Homebrew or a tool comes from it
  local label="Homebrew on the PATH" profile short brew dir tool found=0 lines
  [ "$OS" = macos ] || return 0
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone five
  skipped homebrew "$label" && return 0
  brew=$(brew_bin)
  dir=$(dirname "$brew")
  if [ "$HOMEBREW_USED" = 1 ]; then
    found=1
  elif find_brew; then
    for tool in code gh git; do
      [ "$(dirname "$(command -v "$tool" 2> /dev/null || echo /nonexistent/x)")" = "$dir" ] && found=1
    done
  fi
  [ "$found" = 1 ] || return 0  # Homebrew wasn't used: no line at all
  step_begin "$label"
  profile=$(shell_profile)
  short=${profile#"$HOME"/}
  if [ -f "$profile" ] && grep -q 'brew shellenv' "$profile"; then
    step_end already
    return 0
  fi
  case ":$ORIG_PATH:" in *":$dir:"*) step_end already; return 0 ;; esac
  lines="[ -x $brew ] && eval \"\$($brew shellenv)\""
  if [ "$DRY_RUN" = 1 ]; then
    step_say "\$ append to $profile:"
    step_say "$lines"
    step_end done "dry run"
    return 0
  fi
  if printf '\n%s\n%s\n%s\n' "$PATH_MARK: Homebrew" "$lines" "$PATH_END" >> "$profile"; then
    step_end done "$short"
  else
    step_end failed "couldn't write $profile"
  fi
}

# ---- the look: settings and icons, through agentic-works-install-helper; then VS Code opens ---------------------------

HELPER_OUT=""
PYTHON=""  # the python3 the helper runs with; python_ok finds it
PYTHON_WHY=""  # why there is none, when python_ok is false

write_inlined_helper() {  # a released script carries the helper as a here-document (make release fills this in)
  # @INLINED_HELPER@
  return 1
}

helper_path() {  # prints agentic-works-install-helper's path: $AGENTIC_WORKS_INSTALL_HELPER, the inlined one (a released script), or the one beside this script (the source tree)
  local here
  if [ -n "${AGENTIC_WORKS_INSTALL_HELPER:-}" ]; then
    printf '%s' "$AGENTIC_WORKS_INSTALL_HELPER"
    return 0
  fi
  # The inlined copy first: under `curl | bash`, $0 is `bash` and the sibling lookup would search the current directory.
  if [ -n "$INLINED_HELPER" ]; then
    printf '%s' "$INLINED_HELPER"
    return 0
  fi
  here=$(dirname "${BASH_SOURCE[0]:-$0}")
  [ -f "$here/agentic-works-install-helper" ] || return 1
  printf '%s' "$here/agentic-works-install-helper"
}

python_ok() {  # true when there is a python3 to run the helper with (in PYTHON); else PYTHON_WHY says why not
  local platform_python=${AGENTIC_WORKS_INSTALL_PLATFORM_PYTHON:-/usr/libexec/platform-python}
  PYTHON=${AGENTIC_WORKS_INSTALL_PYTHON3:-$(command -v python3 2> /dev/null)}
  PYTHON_WHY=""
  # RHEL 8 has no python3 command until `dnf install python3`, but always has dnf's own Python 3.6, which the
  # helper runs on.
  if [ -z "$PYTHON" ] && [ "$OS" = rhel ] && [ -x "$platform_python" ]; then
    PYTHON=$platform_python
  fi
  if [ -z "$PYTHON" ]; then
    if [ "$OS" = macos ]; then
      PYTHON_WHY="python3 is not installed; install it (Homebrew: brew install python), then run the installer again"
    else
      PYTHON_WHY="python3 is not installed; install it, then run the installer again"
    fi
    return 1
  fi
  # macOS's /usr/bin/python3 is a shim that opens Apple's Command Line Tools install dialog when they're missing;
  # any other python3 (Homebrew's) is a real one.
  if [ "$OS" = macos ] && [ "$PYTHON" = /usr/bin/python3 ] && ! xcode-select -p > /dev/null 2>&1; then
    PYTHON_WHY="python3 is not installed; run \`xcode-select --install\` (or brew install python), then run the"
    PYTHON_WHY="$PYTHON_WHY installer again"
    PYTHON=""
    return 1
  fi
}

shell_words() {  # $* = words: as one line, a word with a space in single quotes ('Acme Works'), for a command shown
  local out="" w
  for w in "$@"; do
    case $w in *" "*) w="'$w'" ;; esac
    out="$out${out:+ }$w"
  done
  printf '%s' "$out"
}

run_helper() {  # $* = subcommand and its options: its stdout in HELPER_OUT; returns its exit status (0 done, 2 skipped, 1 error)
  local helper rc
  HELPER_OUT=""
  if ! helper=$(helper_path); then
    HELPER_OUT="agentic-works-install-helper isn't beside this script; run a released installer: $LATEST_INSTALLER"
    return 1
  fi
  # the settings and the layout go into --profile's profile; vscode-profile names its own
  case $1 in vscode-settings|vscode-layout) [ -z "$PROFILE" ] || set -- --profile "$PROFILE" "$@" ;; esac
  if [ "$DRY_RUN" = 1 ]; then
    step_say "\$ python3 $helper $(shell_words "$@")"
    return 0
  fi
  printf '$ %s %s %s\n' "$PYTHON" "$helper" "$(shell_words "$@")" >> "$LOG"
  # As root on Linux, the user data dir the code calls use.
  HELPER_OUT=$(env ${CODE_DATA:+"AGENTIC_WORKS_VSCODE_USER_DIR=$CODE_DATA/User"} "$PYTHON" "$helper" "$@" \
    < /dev/null 2>> "$LOG")
  rc=$?
  case $rc in 0|2) ;; *) HELPER_OUT="" ;; esac  # an error's own words are in the log
  return "$rc"
}

look_step() {  # $1 = step name, $2 = label, $3 = helper subcommand (and options, split on spaces), $4 = done detail, $5 = failure detail
  local rc first rest line
  skipped "$1" "$2" && return 0
  step_begin "$2"
  if [ -n "$CLASH" ]; then
    step_end skipped "skipped — Agentic Works was not installed"
    return 0
  fi
  if ! python_ok; then
    step_end skipped "$PYTHON_WHY"
    return 0
  fi
  # shellcheck disable=SC2086  # $3 is a subcommand and its options
  run_helper $3
  rc=$?
  if [ "$DRY_RUN" = 1 ] && [ "$rc" = 0 ]; then
    step_end done "dry run"
    return 0
  fi
  case $rc in
    0) if [ "$HELPER_OUT" = "already set" ]; then step_end already; else step_end done "$4"; fi ;;
    2)  # the reason is the first line; the lines after it (settings to add by hand) go under the step
      first=${HELPER_OUT%%$'\n'*}
      rest=""
      [ "$first" = "$HELPER_OUT" ] || rest=${HELPER_OUT#*$'\n'}
      step_end skipped "${first%.}"
      if [ -n "$rest" ]; then
        while IFS= read -r line; do step_say "$line"; done <<< "$rest"
      fi ;;
    *) step_end failed "${HELPER_OUT:-$5}" ;;
  esac
}

apply_settings() {  # the look's keys, and codebase search when asked for, each only when absent; JSONC is left as it is
  local sub=vscode-settings
  [ "$CODEBASE_SEARCH" = 1 ] && sub="$sub --codebase-search"
  [ -n "$TEAMS_APP" ] && sub="$sub --teams-app $TEAMS_APP"  # checked by parse_args: no spaces in it
  look_step settings "Settings" "$sub" "added to settings.json" "couldn't write VS Code's settings; see $LOG"
  if [ "$STEP_RESULT" = done ] && [ "$HELPER_OUT" = "codebase search added" ]; then
    step_say "codebase search is on; to search by meaning too, run Agents: Install Codebase Search by Meaning in VS Code"
  fi
}

apply_icons() {  # the activity bar's icons and the vendor buttons on editor title bars, only on a VS Code never started (its state.vscdb has no layout yet)
  look_step icons "Icons" vscode-layout "activity bar and editor title bar trimmed" "couldn't write the icon layout; see $LOG"
  case $STEP_RESULT:$HELPER_OUT in
    skipped:*"already has an icon layout"*) step_say "to hide an icon or a title-bar button yourself, right-click it" ;;
  esac
}

open_vscode() {  # VS Code, after a first install only: a plain start, which brings back any windows it had; once the checklist is done; not as root, nor with --no-open or --dry-run
  skip_named open && return 0
  [ "$NO_OPEN" = 1 ] && return 0
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone five
  [ "$WINDOW_OPENED" = 1 ] && return 0  # the window that made the profile is VS Code, opened
  find_code || [ "$DRY_RUN" = 1 ] || return 0
  if [ "$AS_ROOT" != 1 ] && [ "$AGENTIC_WORKS_FRESH" != 1 ]; then
    return 0  # an update or a repair: VS Code's windows stay as they are; the summary says when to reload them
  elif [ "$DRY_RUN" = 1 ]; then
    printf 'Would open VS Code: $ %s\n' "$CODE"
  elif [ "$AS_ROOT" = 1 ]; then
    if [ -n "$CODE_DATA" ]; then
      printf 'Running as root, so VS Code is not opened. To start it: %s --no-sandbox --user-data-dir %s\n' \
        "$CODE" "$CODE_DATA"
    else
      printf 'Running as root, so VS Code is not opened; open it as yourself.\n'
    fi
  else
    printf 'Opening VS Code.\n'
    run "$CODE" ${PROFILE:+--profile "$PROFILE"} || printf "VS Code didn't open; open it from your applications.\n"
  fi
}

# ---- sudo, the terminal, flags, main -------------------------------------------------------------------------

agentic_works_download_planned() {  # true when the Agentic Works step is going to download the .vsix: no Agentic Works yet, or an older one
  local current
  skip_named extension && return 1
  agentic_works_stamped || return 1
  find_code || return 0  # the VS Code step installs it first
  current=$(installed_version "$AGENTIC_WORKS_ID" "$(installed_extensions)") || return 0
  [ "$(version_cmp "$current" "$AGENTIC_WORKS_VERSION")" = lt ]
}

system_changes() {  # what the steps that are going to run add system-wide, one per line, in run order; or nothing
  local vscode=0 gh=0 ext=0 ms_repo=0 gh_repo=0 git=0 claude=0
  skip_named vscode || find_code || vscode=1
  # the claude step runs Anthropic's installer as the user (no sudo); only the curl it downloads with may be a system install
  skip_named claude || [ -n "$CLASH" ] || [ -e "$HOME/.local/bin/claude" ] || have claude || claude=1
  skip_named git || [ -n "$CLASH" ] || git_works || git=1
  skip_named github || have gh || gh=1
  if { [ "$vscode" = 1 ] || find_code; } && agentic_works_download_planned; then ext=1; fi
  case $OS in
    macos)  # VS Code and gh come through Homebrew, whose installer needs administrator rights
      if [ "$vscode$gh" != 00 ] && ! find_brew; then echo "Homebrew"; fi ;;
    ubuntu|debian)
      [ "$vscode" = 1 ] && ! apt_has_source "packages.microsoft.com/repos/code" && ms_repo=1
      [ "$gh" = 1 ] && ! apt_has_source "cli.github.com/packages" && gh_repo=1
      if ! have curl && [ "$ms_repo$gh_repo$ext$claude" != 0000 ]; then echo "curl and ca-certificates"; fi
      if [ "$ms_repo" = 1 ] && ! have gpg; then echo "gnupg"; fi
      [ "$ms_repo" = 1 ] && echo "Microsoft's VS Code package repository and its signing key"
      [ "$vscode" = 1 ] && echo "VS Code"
      [ "$git" = 1 ] && echo "git"
      [ "$gh_repo" = 1 ] && echo "GitHub's gh package repository and its signing key"
      [ "$gh" = 1 ] && echo "gh" ;;
    rhel|fedora)
      [ "$vscode" = 1 ] && printf '%s\n' "Microsoft's VS Code package repository and its signing key" "VS Code"
      if ! skip_named vscode && fedora_needs_ssl; then
        echo "OpenSSL 3 (Fedora, for VS Code's extension signature checks)"
      fi
      [ "$git" = 1 ] && echo "git"
      if [ "$gh" = 1 ] && [ "$OS" = rhel ]; then
        echo "GitHub's gh package repository and its signing key (with dnf's config-manager plugin)"
      fi
      [ "$gh" = 1 ] && echo "gh" ;;
  esac
  return 0
}

prepare_sudo() {  # one password prompt up front, only when something needs installing, after saying what
  local changes item
  [ "$DRY_RUN" = 1 ] && return 0
  [ -n "$SUDO" ] || return 0
  changes=$(system_changes)
  [ -n "$changes" ] || return 0
  printf 'Some installs need administrator rights; sudo may ask for your password. This run adds, system-wide:\n'
  while IFS= read -r item; do printf '  - %s\n' "$item"; done <<< "$changes"
  if ! sudo -v; then
    SUDO_FAILED=1
    printf 'sudo failed; the system installs below will fail too.\n'
  fi
}

open_tty() {  # fd 3 = the terminal the answers come from; TTY_OPEN=1 when there is one
  [ "$DRY_RUN" = 1 ] && return 0
  if { exec 3< "${AGENTIC_WORKS_INSTALL_TTY:-/dev/tty}"; } 2> /dev/null; then
    TTY_OPEN=1
  fi
}

usage() {
  cat <<EOF
agentic-works-install — VS Code with Agentic Works, on macOS and Linux desktops ($SUPPORTED)

  bash agentic-works-install.sh [options]

Options:
  --dry-run      print each command instead of running it
  --skip <step>  leave a step out; repeatable. Steps: $STEP_NAMES
  --yes          answer yes when asked to uninstall the standalone extensions Agentic Works replaces (needed with no
                 terminal)
  --no-open      don't open VS Code at the end
  --codebase-search
                 turn codebase search on in Claude and Codex tabs (off otherwise; Agentic Works' walkthrough offers it)
  --profile <name>
                 install into the VS Code profile of that name, made when there is none (your settings, keybindings
                 and snippets copied in); your own profile is left as it is
  --folder <dir> with --profile: when VS Code is open, the window opened to make the profile opens on this folder
  --window-mark <file>
                 made when this run opened a VS Code window
  --teams-app <clientId>:<tenant>
                 sign Teams in with your company's own Microsoft app: its Application (client) ID, then the
                 Directory (tenant) ID or domain, from your IT team (added only when not already set)
  --help         this text

Environment:
  NO_COLOR       plain marks even on a terminal
EOF
}

teams_app_ok() {  # $1 = <clientId>:<tenant>: a GUID, a colon, then a GUID or a domain such as contoso.onmicrosoft.com
  local guid='[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
  local domain='([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}'
  local re="^$guid:($guid|$domain)\$"
  [[ $1 =~ $re ]]
}

parse_args() {
  while [ $# -gt 0 ]; do
    case $1 in
      --dry-run) DRY_RUN=1 ;;
      --yes) YES=1 ;;
      --no-open) NO_OPEN=1 ;;
      --codebase-search) CODEBASE_SEARCH=1 ;;
      --no-codebase-search) ;;  # 0.2.0–0.3.3 asked, and this said no; it is off now unless asked for
      --teams-app)
        [ $# -ge 2 ] || { printf 'agentic-works-install: --teams-app needs <clientId>:<tenant>\n' >&2; exit 2; }
        teams_app_ok "$2" || {
          printf "agentic-works-install: --teams-app '%s' isn't <clientId>:<tenant> (a GUID, then a tenant GUID or a domain)\n" "$2" >&2
          exit 2
        }
        TEAMS_APP=$2
        shift ;;
      --profile)
        [ $# -ge 2 ] && profile_name_ok "$2" || {
          printf "agentic-works-install: --profile needs a name: letters, digits, spaces, dots, dashes, underscores; up to 40\n" >&2
          exit 2
        }
        PROFILE=$2
        shift ;;
      --folder)
        [ $# -ge 2 ] && [ "${2#/}" != "$2" ] && [ -d "$2" ] || {
          printf 'agentic-works-install: --folder needs a folder that is there, as an absolute path\n' >&2
          exit 2
        }
        FOLDER=$2
        shift ;;
      --window-mark)
        [ $# -ge 2 ] && [ "${2#/}" != "$2" ] || {
          printf 'agentic-works-install: --window-mark needs a file, as an absolute path\n' >&2
          exit 2
        }
        WINDOW_MARK=$2
        shift ;;
      --skip)
        [ $# -ge 2 ] || { printf 'agentic-works-install: --skip needs a step: %s\n' "$STEP_NAMES" >&2; exit 2; }
        case " $STEP_NAMES " in
          *" $2 "*) SKIPS="$SKIPS$2 " ;;
          *) printf "agentic-works-install: no step '%s'; steps: %s\n" "$2" "$STEP_NAMES" >&2; exit 2 ;;
        esac
        shift ;;
      --help|-h) usage; exit 0 ;;
      *) printf "agentic-works-install: unknown option '%s'\n\n" "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
}

cleanup() {  # on exit: the log is kept, and named, only when a step failed and something was logged
  spinner_stop
  sudo_keepalive_stop
  [ -z "$VSIX_DIR" ] || rm -rf "$VSIX_DIR"
  [ -z "$INLINED_HELPER" ] || rm -f "$INLINED_HELPER"
  if [ "$N_FAIL" != 0 ] && [ -s "$LOG" ]; then
    printf 'Details of what failed: %s\n' "$LOG"
  elif [ "$LOG" != /dev/null ]; then
    rm -f "$LOG"
  fi
}

finish() {
  printf '\n'
  tally
  [ "$RELOAD_VSCODE" != 1 ] || printf "Reload your local VS Code windows to use Agentic Works %s; Remote windows aren't affected.\n" "$AGENTIC_WORKS_VERSION"
}

main() {  # the steps, in order
  parse_args "$@"
  LOG=$(mktemp "${TMPDIR:-/tmp}/agentic-works-install-log.XXXXXX")
  trap cleanup EXIT
  trap 'exit 130' INT  # through the EXIT trap, so an interrupted run leaves no download behind
  trap 'exit 143' TERM
  write_inlined_helper || INLINED_HELPER=""
  printf 'agentic-works-install — VS Code with Agentic Works%s\n\n' "$([ "$DRY_RUN" = 1 ] && echo ' (dry run)')"
  check_platform
  prepare_sudo
  open_tty
  ensure_vscode
  ensure_path
  ensure_profile
  check_standalone
  ensure_agentic_works
  ensure_companions
  ensure_claude
  ensure_git
  ensure_github
  ensure_homebrew_path
  apply_settings
  apply_icons
  finish
  open_vscode
  [ "$N_FAIL" = 0 ]
}

[ "${AGENTIC_WORKS_INSTALL_NO_MAIN:-}" = 1 ] || main "$@"
