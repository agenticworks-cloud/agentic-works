#!/usr/bin/env bash
# roost-install — VS Code with Roost on this Mac or Linux desktop, in one command:
#
#   bash roost-install.sh
#
# macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora. Installs VS Code if it
# is missing and puts `code` on the PATH, printing a checklist, one line per step. Each step checks first, so a
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
set -u

STEP_NAMES="vscode path standalone roost companions settings icons open"  # what --skip accepts, in run order
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
SUDO=""
TTY_OPEN=0

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

skipped() {  # $1 = step name, $2 = label: true (and the step is marked skipped) when --skip named it
  case $SKIPS in
    *" $1 "*)
      STEP_LABEL=$2
      step_end skipped "skipped (--skip $1)"
      return 0 ;;
  esac
  return 1
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
  elif [ "$OS" != macos ]; then
    CODE_DATA="$HOME/.config/Code"
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

ensure_homebrew() {  # macOS: Homebrew, from its own installer (which needs an administrator account)
  local tmp rc
  find_brew && return 0
  step_say "Homebrew is missing; installing it first"
  tmp=$(mktemp "${TMPDIR:-/tmp}/roost-install-homebrew.XXXXXX") || return 1
  # Downloaded first, then run: a failed download stops here rather than running an empty script.
  run curl -fsSL -o "$tmp" "$HOMEBREW_INSTALLER" && run env NONINTERACTIVE=1 /bin/bash "$tmp"
  rc=$?
  rm -f "$tmp"
  [ "$rc" = 0 ] || return 1
  [ "$DRY_RUN" = 1 ] || find_brew
}

deb_arch() {
  if [ "$ARCH" = arm64 ]; then echo arm64; else echo amd64; fi
}

add_apt_repo() {  # $1 = armored key URL, $2 = keyring path, $3 = sources.list.d file, $4 = deb line
  # The sources.list line is written only once the keyring is in place and non-empty: a line without its key
  # makes every later apt-get update fail, on every rerun.
  local tmp
  tmp=$(mktemp "${TMPDIR:-/tmp}/roost-install-key.XXXXXX") || return 1
  if ! run curl -fsSL -o "$tmp" "$1" || { [ "$DRY_RUN" != 1 ] && [ ! -s "$tmp" ]; }; then
    rm -f "$tmp"
    return 1
  fi
  if ! run gpg --batch --yes --dearmor -o "$tmp.gpg" "$tmp" || { [ "$DRY_RUN" != 1 ] && [ ! -s "$tmp.gpg" ]; }; then
    rm -f "$tmp" "$tmp.gpg"
    return 1
  fi
  [ "$DRY_RUN" = 1 ] || mv -f "$tmp.gpg" "$tmp"
  # shellcheck disable=SC2086
  run $SUDO install -m 644 "$tmp" "$2" || { rm -f "$tmp"; return 1; }
  rm -f "$tmp"
  run_sh "echo '$4' | $SUDO tee $3 > /dev/null"
}

install_vscode_apt() {  # Ubuntu and Debian-based: Microsoft's apt repository; curl and gnupg first when missing
  local need=""
  have curl || need="curl ca-certificates"
  have gpg || need="${need:+$need }gnupg"  # neither is in a minimal Debian or Ubuntu
  # shellcheck disable=SC2086
  if [ -n "$need" ]; then
    run $SUDO apt-get update && run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y $need || return 1
  fi
  # shellcheck disable=SC2086
  add_apt_repo "$MS_KEY" /usr/share/keyrings/microsoft.gpg /etc/apt/sources.list.d/vscode.list \
    "deb [arch=$(deb_arch) signed-by=/usr/share/keyrings/microsoft.gpg] https://packages.microsoft.com/repos/code stable main" &&
    run $SUDO apt-get update &&
    run $SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y code
}

install_vscode_dnf() {  # RHEL/Rocky and Fedora: Microsoft's yum repository, with dnf
  # shellcheck disable=SC2086
  run $SUDO rpm --import "$MS_KEY" &&
    run_sh "printf '[code]\\nname=Visual Studio Code\\nbaseurl=https://packages.microsoft.com/yumrepos/vscode\\nenabled=1\\ngpgcheck=1\\ngpgkey=$MS_KEY\\n' | $SUDO tee /etc/yum.repos.d/vscode.repo > /dev/null" &&
    run $SUDO dnf install -y code
}

ensure_vscode() {
  skipped vscode "VS Code" && return 0
  step_begin "VS Code"
  if find_code; then
    step_end already
    return 0
  fi
  case $OS in
    macos)
      if ! ensure_homebrew; then
        step_end failed "Homebrew couldn't be installed (it needs an administrator account); download VS Code from $DOWNLOAD_URL"
        return 0
      fi
      run "$(brew_bin)" install --cask visual-studio-code ;;
    ubuntu|debian) install_vscode_apt ;;
    rhel|fedora) install_vscode_dnf ;;
  esac
  if [ "$DRY_RUN" = 1 ]; then
    step_end done "dry run"
  elif find_code; then
    step_end done "installed"
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

# ---- sudo, the terminal, flags, main -------------------------------------------------------------------------

needs_root() {  # true when a step that is going to run will install something system-wide
  case $SKIPS in *" vscode "*) return 1 ;; esac
  find_code && return 1
  [ "$OS" != macos ] && return 0
  ! find_brew  # Homebrew's installer needs administrator rights
}

prepare_sudo() {  # one password prompt up front, only when something needs installing
  [ "$DRY_RUN" = 1 ] && return 0
  [ -n "$SUDO" ] || return 0
  needs_root || return 0
  printf 'Some installs need administrator rights; sudo may ask for your password.\n'
  sudo -v || printf 'sudo failed; the system installs below will fail too.\n'
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
  --yes          answer yes when asked to uninstall the standalone extensions Roost replaces (needed with no terminal)
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
  printf 'roost-install — VS Code with Roost%s\n\n' "$([ "$DRY_RUN" = 1 ] && echo ' (dry run)')"
  check_platform
  prepare_sudo
  open_tty
  ensure_vscode
  ensure_path
  finish
  [ "$N_FAIL" = 0 ]
}

[ "${ROOST_INSTALL_NO_MAIN:-}" = 1 ] || main "$@"
