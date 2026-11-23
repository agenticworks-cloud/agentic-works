#!/usr/bin/env bash
# roost-install — VS Code with Roost on this Mac or Linux desktop, in one command:
#
#   bash roost-install.sh
#
# macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora. Installs VS Code if it
# is missing and puts `code` on the PATH; uninstalls the standalone Perch, chirp, jay and kestrel (after asking),
# which Roost replaces; installs this release's Roost .vsix (SHA-256 checked), its companion extensions and the
# GitHub CLI, offering one GitHub sign-in; sets VS Code's look and its activity-bar icons (on a VS Code never
# started), then opens VS Code. It prints a checklist, one line per step. Each step checks first, so a
# rerun only fills in what is missing. A failed step is reported and the run goes on; the exit status is 1 when
# any step failed. Design: docs/notes/102-roost-installer.md.
#
# Runs under macOS's /bin/bash 3.2: no associative arrays, mapfile, ${x,,}, |& or [[ -v ]].
# No `set -e`: each step reports its own result and the run continues.
#
# Environment:
#   NO_COLOR                 plain marks even on a terminal
#   ROOST_INSTALL_FAKE_OS    test seam only: macos|ubuntu|debian|rhel|fedora instead of detecting the platform
#   ROOST_INSTALL_FAKE_ARCH  test seam only: instead of `uname -m`
#   ROOST_INSTALL_NO_MAIN    test seam only: 1 = define the functions and return, for tests that source this file
#   ROOST_INSTALL_TTY        test seam only: the file answers are read from, one per line, instead of /dev/tty
#   ROOST_INSTALL_VSIX_URL   test seam only: where Roost's .vsix is downloaded from, instead of this release
#   ROOST_INSTALL_APT_DIR    test seam only: instead of /etc/apt, where existing apt sources are looked for
#   ROOST_INSTALL_HELPER     roost-install-helper's path, instead of the one beside this script
#   ROOST_INSTALL_PYTHON3    test seam only: the python3 path taken as found, instead of `command -v python3`
#   ROOST_INSTALL_PLATFORM_PYTHON  test seam only: instead of /usr/libexec/platform-python (RHEL 8's system python)
set -u

# Roost's version and its .vsix's SHA-256: written in by `make release`. A copy without them refuses the Roost step.
ROOST_VERSION="@ROOST_VERSION@"
ROOST_SHA256="@ROOST_SHA256@"
ROOST_ID="seanahn.roost"
ROOST_VSIX_URL=${ROOST_INSTALL_VSIX_URL:-"https://github.com/seanahn/roost/releases/download/v$ROOST_VERSION/roost-$ROOST_VERSION.vsix"}
LATEST_INSTALLER="https://github.com/seanahn/roost/releases/latest/download/roost-install.sh"
STANDALONE="seanahn.perch seanahn.chirp seanahn.jay seanahn.kestrel-prs"  # the extensions Roost replaces
COMPANIONS="anthropic.claude-code openai.chatgpt seanahn.perch-audio"  # Perch runs claude and codex through these
GH_KEY="https://cli.github.com/packages/githubcli-archive-keyring.gpg"
GH_RPM_REPO="https://cli.github.com/packages/rpm/gh-cli.repo"
APT_DIR=${ROOST_INSTALL_APT_DIR:-/etc/apt}

STEP_NAMES="vscode path standalone roost companions github settings icons open"  # what --skip accepts, in run order
SUPPORTED="macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora"
MAC_CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
DOWNLOAD_URL="https://code.visualstudio.com/download"
HOMEBREW_INSTALLER="https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh"
MS_KEY="https://packages.microsoft.com/keys/microsoft.asc"
ORIG_PATH=$PATH  # the PATH a new terminal would have, before this run adds to it

DRY_RUN=0
YES=0
NO_OPEN=0
SKIPS=" "
OS=""
ARCH=""
CODE="code"
CODE_DATA=""  # as root on Linux: the --user-data-dir VS Code's CLI insists on (its default, ~/.config/Code)
AS_ROOT=0
SUDO=""
TTY_OPEN=0
CLASH=""  # why Roost can't go in beside the standalone four; when set, Roost fails and the steps after it stay out
VSIX_DIR=""  # the .vsix download's temp dir while it exists; cleanup removes it on an interrupt too
INLINED_HELPER=""  # the released script's own copy of the helper, written to a private temp file at start
HOMEBREW_STATE=""  # planned (a dry run printed its install) or failed, so a second step doesn't repeat it
SUDO_FAILED=0  # 1 when the up-front `sudo -v` failed: on a Mac, an account that isn't an administrator

# ---- the checklist -------------------------------------------------------------------------------------------

STEP_LABEL=""
STEP_RESULT=""
LINE_OPEN=0  # 1 while the cursor sits at the end of a terminal's "… <label>" line
N_OK=0
N_SKIP=0
N_FAIL=0
C_OK="" C_SKIP="" C_FAIL="" C_END=""
if [ -t 1 ] && [ -z "${NO_COLOR+set}" ]; then
  C_OK=$'\033[32m' C_SKIP=$'\033[90m' C_FAIL=$'\033[31m' C_END=$'\033[0m'
fi
LOG=/dev/null  # every command's output; made in main, kept when a step fails

step_begin() {  # $1 = label: "  … <label>", overwritten by step_end on a terminal
  STEP_LABEL=$1
  if [ -t 1 ]; then
    printf '  … %s' "$STEP_LABEL"
    LINE_OPEN=1
  else
    printf '  … %s\n' "$STEP_LABEL"
  fi
}

step_say() {  # $1 = text: a line under the step in progress (prompts, URLs, dry-run commands)
  if [ "$LINE_OPEN" = 1 ]; then
    printf '\n'
    LINE_OPEN=0
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
  if [ "$LINE_OPEN" = 1 ]; then
    printf '\r\033[K'
    LINE_OPEN=0
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
  printf '\nroost-install supports %s.\n\n' "$SUPPORTED"
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
  if [ -n "${ROOST_INSTALL_FAKE_OS:-}" ]; then
    OS=$ROOST_INSTALL_FAKE_OS
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
  machine=${ROOST_INSTALL_FAKE_ARCH:-$(uname -m)}
  case $machine in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64) ARCH=x86_64 ;;
    *) unsupported "$OS on $machine" ;;
  esac
  if [ "$(id -u)" != 0 ]; then
    SUDO=sudo
  elif [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != root ]; then
    # `sudo bash roost-install.sh`: VS Code, its settings and the PATH block would go to root, not to this user.
    step_end failed "Run it without sudo: bash roost-install.sh — it asks for your password when it needs it."
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

find_code() {  # sets CODE to VS Code's CLI; false when VS Code isn't installed
  if command -v code > /dev/null 2>&1; then
    CODE=$(command -v code)
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
  step_say "Homebrew is missing; installing it first"
  tmp=$(mktemp "${TMPDIR:-/tmp}/roost-install-homebrew.XXXXXX") || return 1
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
  tmp=$(mktemp "${TMPDIR:-/tmp}/roost-install-key.XXXXXX") || return 1
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

PATH_MARK="# added by roost-install"
PATH_END="# end roost-install"

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
  if [ -f "$profile" ] && grep -qF "$PATH_MARK" "$profile"; then
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

# ---- the extensions: the standalone four, Roost, its companions ---------------------------------------------

code_cli() {  # argv for VS Code's CLI; as root on Linux, with the --user-data-dir it insists on
  run "$CODE" ${CODE_DATA:+--user-data-dir "$CODE_DATA"} "$@"
}

installed_extensions() {  # the installed extensions, as lowercase id@version words
  printf '$ %s --list-extensions --show-versions\n' "$CODE" >> "$LOG"
  "$CODE" ${CODE_DATA:+--user-data-dir "$CODE_DATA"} --list-extensions --show-versions < /dev/null 2>> "$LOG" |
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

extension_name() {  # $1 = id of one of the standalone four: its name
  case $1 in
    seanahn.perch) echo Perch ;;
    seanahn.chirp) echo chirp ;;
    seanahn.jay) echo jay ;;
    seanahn.kestrel-prs) echo kestrel ;;
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

on_terminal() {  # $* = argv, run with the terminal (fd 3) as stdin and output on screen: a browser sign-in
  printf '$ %s\n' "$*" >> "$LOG"
  if [ "$TTY_OPEN" = 1 ]; then "$@" <&3; else "$@" < /dev/null; fi
}

check_standalone() {  # the standalone four would clash with Roost (the same command ids): uninstall them, or stop
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
    step_say "Roost replaces $names: asks to uninstall them (or --yes)"
    for id in $found; do code_cli --uninstall-extension "$id"; done
    step_end done "dry run"
    return 0
  fi
  if [ "$YES" = 1 ]; then
    rc=0
  else
    ask_yn "Roost replaces $names. Uninstall them and use Roost? [Y/n]"
    rc=$?
  fi
  case $rc in
    1) CLASH="stopped — Roost would clash with $names; uninstall them, or rerun and answer Y"; return 0 ;;
    2) CLASH="$names would clash with Roost, and there is no terminal to ask on; rerun with --yes to uninstall them"
       return 0 ;;
  esac
  for id in $found; do
    code_cli --uninstall-extension "$id" || failed="$failed $id"
  done
  if [ -n "$failed" ]; then
    # shellcheck disable=SC2086
    CLASH="couldn't uninstall $(names_of $failed), and Roost would clash with it; see $LOG,"
    CLASH="$CLASH uninstall it in VS Code, then rerun"
    return 0
  fi
  step_begin "Standalone extensions"
  step_end done "uninstalled $names"
}

roost_stamped() {  # true when make release wrote this script's Roost version and SHA-256 in
  case $ROOST_VERSION$ROOST_SHA256 in *@*) return 1 ;; esac
  [ -n "$ROOST_VERSION" ] && [ -n "$ROOST_SHA256" ]
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

install_roost_vsix() {  # $1 = temp dir: download this release's .vsix there, check it, install it; sets ROOST_ERROR
  local vsix="$1/roost-$ROOST_VERSION.vsix" sum  # code installs a path only when it ends in .vsix
  ROOST_ERROR=""
  if [ "$DRY_RUN" != 1 ] && ! have curl; then
    ROOST_ERROR="curl isn't installed, to download $ROOST_VSIX_URL"
  elif ! run curl -fsSL -o "$vsix" "$ROOST_VSIX_URL"; then
    ROOST_ERROR="couldn't download $ROOST_VSIX_URL; check the network, then run the installer again"
  elif [ "$DRY_RUN" = 1 ]; then
    code_cli --install-extension "$vsix"
  elif ! sum=$(file_sha256 "$vsix"); then
    ROOST_ERROR="no sha256sum or shasum to check the download with"
  elif [ "$(lower "$sum")" != "$(lower "$ROOST_SHA256")" ]; then
    ROOST_ERROR="the download did not match its checksum — run the installer again"
  elif ! code_cli --install-extension "$vsix"; then
    # Roost's extension pack is its companions, which VS Code fetches from the Marketplace as it installs Roost.
    ROOST_ERROR="VS Code couldn't install it; it also fetches Claude Code, ChatGPT and Perch's audio from the"
    ROOST_ERROR="$ROOST_ERROR Marketplace, which may be unreachable from here — see $LOG"
  fi
  [ -z "$ROOST_ERROR" ]
}

ROOST_IN_PLACE=0  # 1 when the Roost step leaves a Roost installed (this release's, an older or a newer one)

ensure_roost() {  # this release's Roost: installed, upgraded over an older one, or a newer one left alone
  local current="" detail="installed $ROOST_VERSION"
  skipped roost "Roost" && return 0
  step_begin "Roost"
  if [ -n "$CLASH" ]; then
    step_end failed "$CLASH"
    return 0
  fi
  if ! roost_stamped; then
    step_end failed "this copy of the installer has no Roost release in it; run a released installer: $LATEST_INSTALLER"
    return 0
  fi
  if find_code; then
    current=$(installed_version "$ROOST_ID" "$(installed_extensions)")
  elif [ "$DRY_RUN" != 1 ]; then
    step_end skipped "VS Code isn't installed"
    return 0
  fi
  [ -z "$current" ] || ROOST_IN_PLACE=1
  if [ -n "$current" ]; then
    case $(version_cmp "$current" "$ROOST_VERSION") in
      eq) step_end already; return 0 ;;
      gt) step_end skipped "$current is newer than this installer's $ROOST_VERSION; left as is"; return 0 ;;
    esac
    detail="upgraded from $current to $ROOST_VERSION"
  fi
  case $OS in ubuntu|debian) apt_prereqs curl ;; esac  # not in a minimal system; a failure is reported just below
  if ! VSIX_DIR=$(mktemp -d "${TMPDIR:-/tmp}/roost-install-vsix.XXXXXX"); then
    VSIX_DIR=""
    step_end failed "couldn't make a temp dir for the download"
    return 0
  fi
  install_roost_vsix "$VSIX_DIR"
  rm -rf "$VSIX_DIR"
  VSIX_DIR=""
  if [ -n "$ROOST_ERROR" ]; then
    step_end failed "$ROOST_ERROR"
  elif [ "$DRY_RUN" = 1 ]; then
    step_end done "dry run"
  else
    ROOST_IN_PLACE=1
    step_end done "$detail"
    [ -z "$current" ] || step_say "Reload any open VS Code window to use the new version."
  fi
}

ensure_companions() {  # Claude Code and ChatGPT (Perch runs their claude and codex) and Perch's audio, by id
  local installed="" id missing="" failed="" agents=""
  skipped companions "Companions" && return 0
  step_begin "Companions"
  if [ -n "$CLASH" ]; then
    step_end skipped "skipped — Roost was not installed"
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
      [ "$ROOST_IN_PLACE" = 0 ] || agents="; Roost works, but${agents#;}" ;;
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

# ---- GitHub, for kestrel's PRs panel -------------------------------------------------------------------------

GH_REPO_ADDED=0  # 1 once install_gh has added GitHub's package repository

install_gh() {  # GitHub's CLI: Homebrew; GitHub's apt or rpm repository; Fedora's own repository
  case $OS in
    macos)
      ensure_homebrew || return 1
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

ensure_github() {  # gh, and one optional browser sign-in (never answered by --yes)
  local installed="" user rc
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone four
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
    installed="installed gh; "
    [ "$GH_REPO_ADDED" = 0 ] || installed="added GitHub's package repository, $installed"
  fi
  if [ "$DRY_RUN" = 1 ]; then
    if have gh && gh_signed_in; then
      step_end already
    else
      run gh auth login --web --hostname github.com --git-protocol https
      step_end done "dry run"
    fi
    return 0
  fi
  if gh_signed_in; then
    user=$(github_user)
    if [ -n "$installed" ]; then
      step_end done "${installed}signed in${user:+ as $user}"
    else
      step_end already
      [ -z "$user" ] || step_say "signed in as $user"
    fi
    return 0
  fi
  ask_yn "Sign in to GitHub now, so Roost can show your pull requests? [Y/n]"
  rc=$?
  if [ "$rc" != 0 ]; then
    step_end skipped "${installed}run \`gh auth login\` to see your pull requests"
    return 0
  fi
  on_terminal gh auth login --web --hostname github.com --git-protocol https
  if gh_signed_in; then
    user=$(github_user)
    step_end done "${installed}signed in${user:+ as $user}"
    step_say "\`gh auth login\` may have set git's credential helper in ~/.gitconfig"
  else
    step_end failed "${installed}gh auth login didn't finish; run \`gh auth login\` to see your pull requests"
  fi
}

# ---- the look: settings and icons, through roost-install-helper; then VS Code opens ---------------------------

HELPER_OUT=""
PYTHON=""  # the python3 the helper runs with; python_ok finds it
PYTHON_WHY=""  # why there is none, when python_ok is false

write_inlined_helper() {  # a released script carries the helper as a here-document (make release fills this in)
  # @INLINED_HELPER@
  return 1
}

helper_path() {  # prints roost-install-helper's path: $ROOST_INSTALL_HELPER, the inlined one (a released script), or the one beside this script (the source tree)
  local here
  if [ -n "${ROOST_INSTALL_HELPER:-}" ]; then
    printf '%s' "$ROOST_INSTALL_HELPER"
    return 0
  fi
  # The inlined copy first: under `curl | bash`, $0 is `bash` and the sibling lookup would search the current directory.
  if [ -n "$INLINED_HELPER" ]; then
    printf '%s' "$INLINED_HELPER"
    return 0
  fi
  here=$(dirname "${BASH_SOURCE[0]:-$0}")
  [ -f "$here/roost-install-helper" ] || return 1
  printf '%s' "$here/roost-install-helper"
}

python_ok() {  # true when there is a python3 to run the helper with (in PYTHON); else PYTHON_WHY says why not
  local platform_python=${ROOST_INSTALL_PLATFORM_PYTHON:-/usr/libexec/platform-python}
  PYTHON=${ROOST_INSTALL_PYTHON3:-$(command -v python3 2> /dev/null)}
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

run_helper() {  # $1 = subcommand: its stdout in HELPER_OUT; returns its exit status (0 done, 2 skipped, 1 error)
  local helper rc
  HELPER_OUT=""
  if ! helper=$(helper_path); then
    HELPER_OUT="roost-install-helper isn't beside this script; run a released installer: $LATEST_INSTALLER"
    return 1
  fi
  if [ "$DRY_RUN" = 1 ]; then
    step_say "\$ python3 $helper $1"
    return 0
  fi
  printf '$ %s %s %s\n' "$PYTHON" "$helper" "$1" >> "$LOG"
  # As root on Linux, the user data dir the code calls use.
  HELPER_OUT=$(env ${CODE_DATA:+"ROOST_VSCODE_USER_DIR=$CODE_DATA/User"} "$PYTHON" "$helper" "$1" \
    < /dev/null 2>> "$LOG")
  rc=$?
  case $rc in 0|2) ;; *) HELPER_OUT="" ;; esac  # an error's own words are in the log
  return "$rc"
}

look_step() {  # $1 = step name, $2 = label, $3 = helper subcommand, $4 = done detail, $5 = failure detail
  local rc first rest line
  skipped "$1" "$2" && return 0
  step_begin "$2"
  if [ -n "$CLASH" ]; then
    step_end skipped "skipped — Roost was not installed"
    return 0
  fi
  if ! python_ok; then
    step_end skipped "$PYTHON_WHY"
    return 0
  fi
  run_helper "$3"
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

apply_settings() {  # the look's four keys, each only when absent; a settings file with comments is left as it is
  look_step settings "Settings" vscode-settings "added to settings.json" "couldn't write VS Code's settings; see $LOG"
}

apply_icons() {  # the activity bar's icons, only on a VS Code never started (its state.vscdb has no layout yet)
  look_step icons "Icons" vscode-layout "activity bar trimmed" "couldn't write the icon layout; see $LOG"
  case $STEP_RESULT:$HELPER_OUT in
    skipped:*"already has an icon layout"*) step_say "to hide an icon yourself, right-click it in the activity bar" ;;
  esac
}

open_vscode() {  # a new VS Code window, once the checklist is done; not as root, nor with --no-open or --dry-run
  skip_named open && return 0
  [ "$NO_OPEN" = 1 ] && return 0
  [ -n "$CLASH" ] && return 0  # the run stopped at the standalone four
  find_code || [ "$DRY_RUN" = 1 ] || return 0
  if [ "$DRY_RUN" = 1 ]; then
    printf 'Would open VS Code: $ %s --new-window\n' "$CODE"
  elif [ "$AS_ROOT" = 1 ]; then
    if [ -n "$CODE_DATA" ]; then
      printf 'Running as root, so VS Code is not opened. To start it: %s --no-sandbox --user-data-dir %s\n' \
        "$CODE" "$CODE_DATA"
    else
      printf 'Running as root, so VS Code is not opened; open it as yourself.\n'
    fi
  else
    printf 'Opening VS Code.\n'
    run "$CODE" --new-window || printf "VS Code didn't open; open it from your applications.\n"
  fi
}

# ---- sudo, the terminal, flags, main -------------------------------------------------------------------------

roost_download_planned() {  # true when the Roost step is going to download the .vsix: no Roost yet, or an older one
  local current
  skip_named roost && return 1
  roost_stamped || return 1
  find_code || return 0  # the VS Code step installs it first
  current=$(installed_version "$ROOST_ID" "$(installed_extensions)") || return 0
  [ "$(version_cmp "$current" "$ROOST_VERSION")" = lt ]
}

system_changes() {  # what the steps that are going to run add system-wide, one per line, in run order; or nothing
  local vscode=0 gh=0 roost=0 ms_repo=0 gh_repo=0
  skip_named vscode || find_code || vscode=1
  skip_named github || have gh || gh=1
  if { [ "$vscode" = 1 ] || find_code; } && roost_download_planned; then roost=1; fi
  case $OS in
    macos)  # VS Code and gh come through Homebrew, whose installer needs administrator rights
      if [ "$vscode$gh" != 00 ] && ! find_brew; then echo "Homebrew"; fi ;;
    ubuntu|debian)
      [ "$vscode" = 1 ] && ! apt_has_source "packages.microsoft.com/repos/code" && ms_repo=1
      [ "$gh" = 1 ] && ! apt_has_source "cli.github.com/packages" && gh_repo=1
      if ! have curl && [ "$ms_repo$gh_repo$roost" != 000 ]; then echo "curl and ca-certificates"; fi
      if [ "$ms_repo" = 1 ] && ! have gpg; then echo "gnupg"; fi
      [ "$ms_repo" = 1 ] && echo "Microsoft's VS Code package repository and its signing key"
      [ "$vscode" = 1 ] && echo "VS Code"
      [ "$gh_repo" = 1 ] && echo "GitHub's gh package repository and its signing key"
      [ "$gh" = 1 ] && echo "gh" ;;
    rhel|fedora)
      [ "$vscode" = 1 ] && printf '%s\n' "Microsoft's VS Code package repository and its signing key" "VS Code"
      if ! skip_named vscode && fedora_needs_ssl; then
        echo "OpenSSL 3 (Fedora, for VS Code's extension signature checks)"
      fi
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
  if { exec 3< "${ROOST_INSTALL_TTY:-/dev/tty}"; } 2> /dev/null; then
    TTY_OPEN=1
  fi
}

usage() {
  cat <<EOF
roost-install — VS Code with Roost, on macOS and Linux desktops ($SUPPORTED)

  bash roost-install.sh [options]

Options:
  --dry-run      print each command instead of running it
  --skip <step>  leave a step out; repeatable. Steps: $STEP_NAMES
  --yes          answer yes when asked to uninstall the standalone extensions Roost replaces (needed with no
                 terminal); never answers the GitHub sign-in
  --no-open      don't open VS Code at the end
  --help         this text

Environment:
  NO_COLOR       plain marks even on a terminal
EOF
}

parse_args() {
  while [ $# -gt 0 ]; do
    case $1 in
      --dry-run) DRY_RUN=1 ;;
      --yes) YES=1 ;;
      --no-open) NO_OPEN=1 ;;
      --skip)
        [ $# -ge 2 ] || { printf 'roost-install: --skip needs a step: %s\n' "$STEP_NAMES" >&2; exit 2; }
        case " $STEP_NAMES " in
          *" $2 "*) SKIPS="$SKIPS$2 " ;;
          *) printf "roost-install: no step '%s'; steps: %s\n" "$2" "$STEP_NAMES" >&2; exit 2 ;;
        esac
        shift ;;
      --help|-h) usage; exit 0 ;;
      *) printf "roost-install: unknown option '%s'\n\n" "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
}

cleanup() {  # on exit: the log is kept, and named, only when a step failed and something was logged
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
}

main() {  # the steps, in order
  parse_args "$@"
  LOG=$(mktemp "${TMPDIR:-/tmp}/roost-install-log.XXXXXX")
  trap cleanup EXIT
  trap 'exit 130' INT  # through the EXIT trap, so an interrupted run leaves no download behind
  trap 'exit 143' TERM
  write_inlined_helper || INLINED_HELPER=""
  printf 'roost-install — VS Code with Roost%s\n\n' "$([ "$DRY_RUN" = 1 ] && echo ' (dry run)')"
  check_platform
  prepare_sudo
  open_tty
  ensure_vscode
  ensure_path
  check_standalone
  ensure_roost
  ensure_companions
  ensure_github
  apply_settings
  apply_icons
  finish
  open_vscode
  [ "$N_FAIL" = 0 ]
}

[ "${ROOST_INSTALL_NO_MAIN:-}" = 1 ] || main "$@"
