"""Tests for installer/agentic-works-install.sh: the platform, VS Code, `code` on the PATH, the standalone four, Agentic Works,
its companions, GitHub, the settings and icons, and opening VS Code.

Each test runs the script in a subprocess with HOME in a temp dir and a PATH of only stubs (brew, apt-get, dnf,
sudo, code, curl, gh, ... each logging its argv to $STUB_LOG) plus the handful of system tools the script needs, so
"is it installed" is whatever the test puts on PATH. AGENTIC_WORKS_INSTALL_FAKE_OS picks the platform. The script run is a
copy stamped with a test version and SHA-256, as `make release` stamps it; AGENTIC_WORKS_INSTALL_HELPER points it at
installer/agentic-works-install-helper, which a python3 stub stands in for unless a test puts the real python3 on PATH.
The `.vsix` downloads go to a local HTTP server, with the real curl. One case runs under bash 3.2, the bash macOS
ships, in the bash:3.2 container (skipped without Docker). No network.
"""

from __future__ import annotations

import functools
import hashlib
import http.server
import json
import os
import re
import shutil
import signal
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "agentic-works-install.sh"
HELPER = HERE.parent / "agentic-works-install-helper"
IMAGE = "bash:3.2"
DOWNLOAD = "https://code.visualstudio.com/download"

# The system tools the script may use; everything else on PATH is a stub.
SYSTEM = ("bash", "sh", "dirname", "uname", "mkdir", "chmod", "mv", "rm", "mktemp", "cat", "tr", "grep", "env",
          "id", "sha256sum", "shasum", "sleep")
ALL_PRESENT = ("brew", "curl", "gpg", "code", "sudo", "apt-get", "dnf", "rpm", "gh", "python3", "xcode-select",
               "git", "claude")

VERSION = "1.2.3"  # what the test copy of the script is stamped with
VSIX = b"PK agentic-works 1.2.3, as released"
SHA = hashlib.sha256(VSIX).hexdigest()
COMPANIONS = ("anthropic.claude-code", "openai.chatgpt", "seanahn.perch-audio")
INSTALLED = f"agenticworks.agentic-works@{VERSION} anthropic.claude-code@2.0.1 openai.chatgpt@0.4.2 seanahn.perch-audio@0.1.0"

STUB = """#!/bin/sh
printf '%s\\n' "{name} $*" >> "$STUB_LOG"
{extra}exit 0
"""
# curl and gpg write something to their -o file, as the real ones do, so a downloaded key isn't empty.
WRITE_O = ('out="" prev=""; for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done; '
           '[ -z "$out" ] || echo "${CURL_BODY:-stub}" > "$out"\n')
# code lists $CODE_EXTENSIONS (id@version words), notes when a .vsix it is given exists, and fails on $CODE_FAIL_ON.
# code --version says $CODE_VERSION_SAYS first (1.129.1 unless set), as VS Code's CLI says its version, and starts nothing.
CODE = r"""case " $* " in
  *" --version "*) printf '%s\n' "${CODE_VERSION_SAYS-1.129.1}" 0123456789abcdef0123456789abcdef01234567 x64
    exit "${CODE_VERSION_RC:-0}" ;;
  *" --list-extensions "*)
    for e in ${CODE_EXTENSIONS:-}; do
      case " $* " in *" --show-versions "*) echo "$e" ;; *) echo "${e%%@*}" ;; esac
    done
    exit 0 ;;
esac
for a in "$@"; do case $a in *.vsix) [ -f "$a" ] && printf 'vsix-present %s\n' "$a" >> "$STUB_LOG"
  [ -z "${CODE_SLEEP:-}" ] || exec sleep "$CODE_SLEEP" ;; esac; done
[ -n "${PROFILE_MADE:-}" ] && case " $* " in *" --new-window "*) : > "$PROFILE_MADE"
  # the helper's --wait runs beside the window being opened, not after it: 5 s for it to say it is there
  i=0; while [ ! -f "$PROFILE_MADE.waited" ] && [ "$i" -lt 100 ]; do sleep 0.05; i=$((i + 1)); done
  [ ! -f "$PROFILE_MADE.waited" ] || printf 'window: the helper waits beside it\n' >> "$STUB_LOG" ;; esac
[ -n "${CODE_FAIL_ON:-}" ] && case "$*" in *"$CODE_FAIL_ON"*) [ -z "${CODE_FAIL_MSG:-}" ] || echo "$CODE_FAIL_MSG" >&2
  exit 1 ;; esac
"""
# sudo and brew "install ... <word>" put $STUB_INSTALLS/<word> on PATH (gh, unless a test adds more), as the real
# install would.
INSTALLS = ('case " $* " in *" install "*) for w in "$@"; do [ -f "${STUB_INSTALLS:-/nonexistent}/$w" ] && '
            '{ cat "$STUB_INSTALLS/$w" > "${0%/*}/$w"; chmod 755 "${0%/*}/$w"; }; done ;; esac\n')
# python3 (running the helper) prints $PY_SETTINGS_OUT / $PY_LAYOUT_OUT and exits $PY_SETTINGS_RC / $PY_LAYOUT_RC;
# it notes the AGENTIC_WORKS_VSCODE_USER_DIR it was given. vscode-profile prints $PY_PROFILE_OUT ("made") and exits
# $PY_PROFILE_RC, or "already set" once $PROFILE_MADE exists (which `code --new-window` makes, as VS Code would).
# vscode-profile --fill prints $PY_FILL_OUT ("filled") and exits $PY_FILL_RC; with --wait N it first gives
# $PROFILE_MADE N seconds to be there, and skips (2) when it isn't. vscode-running exits $PY_RUNNING_RC (0: a `code`
# run now opens its window in a VS Code already running).
PYTHON3 = r"""[ -z "${AGENTIC_WORKS_VSCODE_USER_DIR:-}" ] || printf 'user-dir %s\n' "$AGENTIC_WORKS_VSCODE_USER_DIR" >> "$STUB_LOG"
case "$*" in
  *vscode-layout*) [ -z "${PY_LAYOUT_OUT:-}" ] || printf '%s\n' "$PY_LAYOUT_OUT"; exit "${PY_LAYOUT_RC:-0}" ;;
  *vscode-no-onboarding*) echo added; exit 0 ;;
  *vscode-running*) exit "${PY_RUNNING_RC:-0}" ;;
  *vscode-profile*--fill*)
    w=""; prev=""; for a in "$@"; do [ "$prev" = --wait ] && w=$a; prev=$a; done
    if [ -n "$w" ]; then
      [ -z "${PROFILE_MADE:-}" ] || : > "$PROFILE_MADE.waited"
      i=0; while [ ! -f "${PROFILE_MADE:-/nonexistent}" ]; do
        [ "$i" -lt $((w * 20)) ] || { echo "VS Code didn't make it"; exit 2; }
        sleep 0.05; i=$((i + 1)); done
    fi
    printf '%s\n' "${PY_FILL_OUT:-filled}"; exit "${PY_FILL_RC:-0}" ;;
  *vscode-profile*) [ -f "${PROFILE_MADE:-/nonexistent}" ] && { echo "already set"; exit 0; }
    printf '%s\n' "${PY_PROFILE_OUT:-made}"; exit "${PY_PROFILE_RC:-0}" ;;
  *) [ -z "${PY_SETTINGS_OUT:-}" ] || printf '%s\n' "$PY_SETTINGS_OUT"; exit "${PY_SETTINGS_RC:-0}" ;;
esac
"""
STUB_EXTRA = {
    "python3": PYTHON3,
    "xcode-select": '[ -z "${XCODE_SELECT_FAIL:-}" ] || exit 2\n',
    # git fails while $GIT_BROKEN is set.
    "git": '[ -z "${GIT_BROKEN:-}" ] || exit 1\n',
    "curl": '[ -n "${CURL_FAIL_ON:-}" ] && case "$*" in *"$CURL_FAIL_ON"*) exit 22 ;; esac\n' + WRITE_O,
    "gpg": WRITE_O,
    # rpm -q finds every package, except ones matching $RPM_MISSING.
    "rpm": '[ -n "${RPM_MISSING:-}" ] && case "$*" in "-q "*"$RPM_MISSING"*) exit 1 ;; esac\n',
    "code": CODE,
    # sudo -n -v (the keepalive during Homebrew's install) notes the pid of the loop running it.
    "sudo": '[ "$*" = "-n -v" ] && printf \'keepalive-ppid %s\\n\' "$PPID" >> "$STUB_LOG"\n' + INSTALLS,
    "brew": INSTALLS,
    # pgrep finds VS Code running while the number in $VSCODE_OPEN_COUNT (a file) is above 0, counting it down each time.
    "pgrep": ('f=${VSCODE_OPEN_COUNT:-/nonexistent}; [ -f "$f" ] || exit 1; n=$(cat "$f"); [ "$n" -gt 0 ] || exit 1; '
              'echo $((n - 1)) > "$f"; exit 0\n'),
}
# gh: signed in while $GH_AUTH_FILE exists (the installer never runs `gh auth login`; the tests check it isn't).
GH = r"""#!/bin/sh
printf '%s\n' "gh $*" >> "$STUB_LOG"
case "$1 $2" in
  "auth status") [ -f "$GH_AUTH_FILE" ]; exit $? ;;
  "api user") echo octocat; exit 0 ;;
esac
exit 0
"""

MARK_LINE = re.compile(r"^  [✓–✗] ")
ANSI = re.compile(r"\x1b\[")


def _write_stubs(directory: Path, names: tuple[str, ...]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name in names:
        path = directory / name
        path.write_text(GH if name == "gh" else STUB.format(name=name, extra=STUB_EXTRA.get(name, "")))
        path.chmod(0o755)


def stamp(dest: Path, version: str = VERSION, sha: str = SHA) -> Path:
    """A copy of the script with its placeholders filled in, as `make release` does."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(SCRIPT.read_text().replace("@AGENTIC_WORKS_VERSION@", version).replace("@AGENTIC_WORKS_SHA256@", sha))
    return dest


def _why_not(image: str = IMAGE) -> str:
    """'' when the image's container can run here, else why not."""
    if not shutil.which("docker"):
        return "docker is not installed"
    if subprocess.run(["docker", "info"], capture_output=True, timeout=60, check=False).returncode:
        return "the docker daemon is not reachable"
    if subprocess.run(["docker", "image", "inspect", image], capture_output=True, timeout=60, check=False).returncode:
        if subprocess.run(["docker", "pull", "-q", image], capture_output=True, timeout=300, check=False).returncode:
            return f"{image} can't be pulled"
    return ""


def _index(lines: list[str], needle: str) -> int:
    """The index of the first line containing needle, or -1."""
    return next((i for i, line in enumerate(lines) if needle in line), -1)


class _Installer(unittest.TestCase):
    """A temp HOME, a stubs dir and a system-tools dir per test."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="agentic-works-install-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.log = self.tmp / "stub.log"
        self.log.touch()
        self.script = stamp(self.tmp / "dist" / "agentic-works-install.sh")
        self.gh_auth = self.tmp / "gh-auth"  # signed in to GitHub while this exists
        self.gh_auth.touch()
        self.installs = self.tmp / "installs"  # what sudo or brew "install" puts on PATH
        self.installs.mkdir()
        (self.installs / "gh").write_text(GH)
        self.apt = self.tmp / "apt"  # stands in for /etc/apt
        (self.apt / "sources.list.d").mkdir(parents=True)

    def _path(self, stubs: tuple[str, ...], real: tuple[str, ...]) -> str:
        stub_dir, sys_dir = self.tmp / "stubs", self.tmp / "sys"
        shutil.rmtree(stub_dir, ignore_errors=True)
        shutil.rmtree(sys_dir, ignore_errors=True)
        _write_stubs(stub_dir, stubs)
        sys_dir.mkdir()
        for name in SYSTEM + real:
            found = shutil.which(name)
            if found:
                (sys_dir / name).symlink_to(found)
        return f"{stub_dir}:{sys_dir}"

    def env(self, os_name: str, stubs: tuple[str, ...], real: tuple[str, ...] = (), **extra: str) -> dict[str, str]:
        """stubs on PATH, and real: system tools used as they are (curl for the .vsix downloads)."""
        env = {
            "HOME": str(self.home),
            "PATH": self._path(stubs, real),
            "STUB_LOG": str(self.log),
            "AGENTIC_WORKS_INSTALL_FAKE_OS": os_name,
            "AGENTIC_WORKS_INSTALL_FAKE_ARCH": "x86_64",
            "AGENTIC_WORKS_INSTALL_TTY": "/dev/null",
            "AGENTIC_WORKS_INSTALL_APT_DIR": str(self.apt),
            "AGENTIC_WORKS_INSTALL_VSIX_URL": "http://127.0.0.1:9/nothing-listens-here.vsix",
            "AGENTIC_WORKS_INSTALL_HELPER": str(HELPER),
            "CODE_EXTENSIONS": INSTALLED,
            "GH_AUTH_FILE": str(self.gh_auth),
            "STUB_INSTALLS": str(self.installs),
            "TMPDIR": str(self.tmp),
            "SHELL": "/bin/bash",
            "TERM": "xterm",
        }
        env.update(extra)
        return env

    def tty(self, *answers: str) -> str:
        """A file of answers, one per line, for AGENTIC_WORKS_INSTALL_TTY."""
        path = self.tmp / "tty"
        path.write_text("".join(f"{answer}\n" for answer in answers))
        return str(path)

    def run_pipe(self, env: dict[str, str], *args: str, script: Path | None = None) -> tuple[int, str]:
        result = subprocess.run([shutil.which("bash"), str(script or self.script), *args], env=env,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=False)
        return result.returncode, (result.stdout + result.stderr).decode()

    def run_sourced(self, env: dict[str, str], probe: str, *args: str) -> tuple[int, str]:
        """Source the script (AGENTIC_WORKS_INSTALL_NO_MAIN=1), then run probe, a bash snippet; $1.. are args."""
        env = {**env, "AGENTIC_WORKS_INSTALL_NO_MAIN": "1"}
        result = subprocess.run([shutil.which("bash"), "-c", f'. "$0"; {probe}', str(self.script), *args], env=env,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=False)
        return result.returncode, (result.stdout + result.stderr).decode()

    def stub_log(self) -> list[str]:
        return self.log.read_text().splitlines()

    def logged(self, needle: str) -> list[str]:
        """The stub log lines containing needle."""
        return [line for line in self.stub_log() if needle in line]

    def opens(self) -> list[str]:
        """VS Code started: `code` with no arguments (the stub logs "code " for it)."""
        return [line for line in self.stub_log() if line in ("code ", "code --new-window")]

    def marks(self, out: str) -> list[str]:
        """The checklist's result lines, without their two-space indent."""
        return [line[2:] for line in out.splitlines() if MARK_LINE.match(line)]

    def leftovers(self) -> list[str]:
        """Downloaded .vsix files or their temp dirs still in TMPDIR."""
        return [p.name for p in self.tmp.iterdir() if "vsix" in p.name]


class TestVSCode(_Installer):
    def test_dry_run_ubuntu_installs_vscode(self) -> None:
        for os_name in ("ubuntu", "debian"):
            with self.subTest(os=os_name):
                rc, out = self.run_pipe(self.env(os_name, ("sudo", "apt-get", "python3")), "--dry-run")
                self.assertEqual(rc, 0, out)
                lines = out.splitlines()
                prereqs = _index(lines, "apt-get install -y curl ca-certificates gnupg")
                key = _index(lines, "https://packages.microsoft.com/keys/microsoft.asc")
                dearmor = _index(lines, "gpg --batch --yes --dearmor")
                repo = _index(lines, "https://packages.microsoft.com/repos/code stable main")
                code = _index(lines, "apt-get install -y code")
                self.assertTrue(0 <= prereqs < key < dearmor < repo < code, out)
                self.assertIn("/etc/apt/sources.list.d/vscode.list", out)
                self.assertIn("  ✓ VS Code (dry run)", out)
                self.assertIn("--install-extension", out)
                self.assertIn("apt-get install -y gh", out)
                self.assertRegex(out, r"\nDone: \d+ ✓  0 –  0 ✗\n")
                self.assertEqual(self.stub_log(), [], "a dry run changes nothing")

    def test_ubuntu_with_curl_and_gpg_installs_no_prerequisites(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get", "curl", "gpg")), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertNotIn("ca-certificates", out)
        self.assertNotIn("gnupg", out)
        self.assertIn("apt-get install -y code", out)

    def test_rhel_and_fedora_use_the_yum_repo(self) -> None:
        for os_name in ("rhel", "fedora"):
            with self.subTest(os=os_name):
                rc, out = self.run_pipe(self.env(os_name, ("sudo", "dnf", "rpm", "curl")), "--dry-run")
                self.assertEqual(rc, 0, out)
                lines = out.splitlines()
                key = _index(lines, "rpm --import https://packages.microsoft.com/keys/microsoft.asc")
                repo = _index(lines, "baseurl=https://packages.microsoft.com/yumrepos/vscode")
                code = _index(lines, "dnf install -y code")
                self.assertTrue(0 <= key < repo < code, out)
                self.assertIn("/etc/yum.repos.d/vscode.repo", out)
                self.assertNotIn("apt-get", out)
                self.assertNotIn("yum install", out)

    def test_macos_installs_homebrew_then_cask(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ("curl",)), "--dry-run")
        self.assertEqual(rc, 0, out)
        lines = out.splitlines()
        homebrew = _index(lines, "https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh")
        cask = _index(lines, "brew install --cask visual-studio-code")
        self.assertTrue(0 <= homebrew < cask, out)
        self.assertIn("NONINTERACTIVE=1", out)

        rc, out = self.run_pipe(self.env("macos", ("curl", "brew")), "--dry-run")  # Homebrew there already
        self.assertEqual(rc, 0, out)
        self.assertNotIn("Homebrew/install", out)
        self.assertIn("brew install --cask visual-studio-code", out)

    def test_existing_code_is_used(self) -> None:
        for os_name in ("macos", "ubuntu", "debian", "rhel", "fedora"):
            with self.subTest(os=os_name):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env(os_name, ALL_PRESENT))
                self.assertEqual(rc, 0, out)
                self.assertIn("  ✓ VS Code (already)", out)
                installs = [line for line in self.stub_log() if line.split()[0] in ("brew", "apt-get", "dnf", "rpm")
                            and not line.startswith("rpm -q ") or line.startswith("sudo ")]
                self.assertEqual(installs, [], out)

    def test_fedora_without_libssl3_gets_it(self) -> None:
        """Fedora 45 ships OpenSSL 4; VS Code's extension signature check (vsce-sign) needs libssl.so.3."""
        ssl = "libssl.so.3()(64bit)"
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("fedora", ALL_PRESENT, RPM_MISSING="libssl.so.3"))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ VS Code (installed OpenSSL 3, for VS Code's extension signature checks)", out)
        self.assertEqual(self.logged(f"sudo dnf install -y {ssl}"), [f"sudo dnf install -y {ssl}"], out)
        self.assertIn("Some installs need administrator rights", out)  # one sudo prompt up front covers it

        # A fresh install: VS Code, then libssl.so.3.
        rc, out = self.run_pipe(self.env("fedora", ("sudo", "dnf", "rpm", "curl"), RPM_MISSING="libssl.so.3"),
                                "--dry-run")
        self.assertEqual(rc, 0, out)
        lines = out.splitlines()
        self.assertTrue(0 <= _index(lines, "dnf install -y code") < _index(lines, "dnf install -y libssl.so.3"), out)

    def test_fedora_libssl3_install_fails(self) -> None:
        env = self.env("fedora", ALL_PRESENT, RPM_MISSING="libssl.so.3")
        (Path(env["PATH"].split(":")[0]) / "sudo").write_text("#!/bin/sh\nexit 1\n")  # sudo dnf install fails
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ VS Code: libssl.so.3 couldn't be installed, and without it VS Code installs no extensions;", out)

    def test_libssl3_only_checked_on_fedora(self) -> None:
        for os_name in ("ubuntu", "rhel"):
            with self.subTest(os=os_name):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env(os_name, ALL_PRESENT, RPM_MISSING="libssl.so.3"))
                self.assertEqual(rc, 0, out)
                self.assertEqual(self.logged("libssl"), [], out)

    def no_admin(self, env: dict[str, str]) -> dict[str, str]:
        """sudo -v fails, as it does for a Mac account that isn't an administrator."""
        (Path(env["PATH"].split(":")[0]) / "sudo").write_text('#!/bin/sh\n[ "$1" = -v ] && exit 1\nexit 0\n')
        return env

    def test_mac_without_admin(self) -> None:
        """Homebrew can't be installed: VS Code is ✗ with the download page, the run goes on, exit 1."""
        env = self.no_admin(self.env("macos", ("curl", "sudo"), CURL_FAIL_ON="Homebrew"))
        rc, out = self.run_pipe(env, "--skip", "github", "--skip", "claude", "--skip", "git")
        self.assertEqual(rc, 1, out)
        failed = [line for line in out.splitlines() if line.startswith("  ✗ VS Code: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertTrue(failed[0].startswith("  ✗ VS Code: Homebrew needs an administrator account; see "), failed)
        self.assertIn(DOWNLOAD, failed[0])
        self.assertNotIn("brew install", "\n".join(self.stub_log()))
        lines = out.splitlines()
        self.assertGreater(_index(lines, "code on the PATH"), _index(lines, "  ✗ VS Code: "), out)  # went on
        self.assertRegex(out, r"\nDone: \d+ ✓  \d+ –  1 ✗\n")
        self.assertIn("Details of what failed: ", out)

    def test_mac_without_admin_vscode_there(self) -> None:
        """VS Code installed, gh missing, no administrator account: the GitHub line says why, as VS Code's would."""
        env = self.no_admin(self.env("macos", ("curl", "sudo", "code"), CURL_BODY="exit 1"))
        rc, out = self.run_pipe(env, "--skip", "claude", "--skip", "git")
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✓ VS Code (already)", out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ GitHub: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertTrue(failed[0].startswith("✗ GitHub: gh comes through Homebrew, which needs an administrator "
                                             "account; see "), failed)

        # With administrator rights, but a Homebrew install that fails: no word of administrators.
        rc, out = self.run_pipe(self.env("macos", ("curl", "sudo", "code"), CURL_BODY="exit 1"),
                                "--skip", "claude", "--skip", "git")
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ GitHub: ")]
        self.assertTrue(failed[0].startswith("✗ GitHub: gh comes through Homebrew, which couldn't be installed; see "),
                        failed)

    def test_homebrew_script_failure(self) -> None:
        """The downloaded Homebrew installer exits 1: the line says so and points at the log, not at admin rights."""
        env = self.env("macos", ("curl", "sudo"), CURL_BODY="exit 1")
        rc, out = self.run_pipe(env, "--skip", "github", "--skip", "claude", "--skip", "git")
        self.assertEqual(rc, 1, out)
        failed = [line for line in out.splitlines() if line.startswith("  ✗ VS Code: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("Homebrew couldn't be installed", failed[0])
        self.assertIn(f"see {self.tmp}/agentic-works-install-log.", failed[0])
        self.assertIn(DOWNLOAD, failed[0])
        self.assertNotIn("administrator", failed[0])

    def ours(self) -> list[int]:
        """The pids of processes still running with this test's STUB_LOG in their environment."""
        found = []
        for proc in Path("/proc").iterdir():
            try:
                if proc.name.isdigit() and str(self.log).encode() in (proc / "environ").read_bytes():
                    found.append(int(proc.name))
            except OSError:
                pass
        return found

    def test_sudo_kept_alive_while_homebrew_installs(self) -> None:
        """Homebrew's installer runs sudo itself, and can outlast sudo's timestamp: a background `sudo -n -v` loop
        runs while it does, and is gone (with its sleep) once it has finished, or the run is stopped."""
        env = self.env("macos", ("curl", "sudo"), CURL_BODY="sleep 1")
        rc, out = self.run_pipe(env, "--skip", "github", "--skip", "claude", "--skip", "git")
        self.assertEqual(rc, 1, out)  # this Homebrew gives no brew
        loops = {line.split()[1] for line in self.logged("keepalive-ppid ")}
        self.assertEqual(len(loops), 1, self.stub_log())
        log = self.stub_log()
        self.assertLess(_index(log, "sudo -v"), _index(log, "keepalive-ppid"), log)  # after the one prompt
        self.assertEqual(self.ours(), [], "the keepalive or its sleep outlived the run")

        # Stopped (SIGTERM) while Homebrew installs: cleanup ends the loop.
        self.log.write_text("")
        proc = subprocess.Popen([shutil.which("bash"), str(self.script), "--skip", "github", "--skip", "claude",
                                 "--skip", "git"], env={**env, "CURL_BODY": "sleep 2"}, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(100):
                if self.logged("keepalive-ppid"):
                    break
                time.sleep(0.05)
            self.assertTrue(self.logged("keepalive-ppid"), self.stub_log())
            proc.send_signal(signal.SIGTERM)
            self.assertEqual(proc.wait(timeout=10), 143)
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        time.sleep(0.2)
        self.assertEqual(self.ours(), [], "the keepalive or its sleep outlived the run")

        # A dry run, or root (no sudo): no loop.
        self.log.write_text("")
        self.run_pipe(env, "--dry-run", "--skip", "github", "--skip", "claude", "--skip", "git")
        self.run_sourced(env, 'id() { echo 0; }; main --skip github --skip claude --skip git')
        self.assertEqual(self.logged("keepalive-ppid"), [])

    def test_existing_microsoft_source_is_kept(self) -> None:
        """An apt source for VS Code's repo already there (code's own postinst writes one): no second one, whose
        different keyring would make apt fail with "Conflicting values set for option Signed-By"."""
        sources = (
            ("sources.list.d/vscode.sources", "Types: deb\nURIs: https://packages.microsoft.com/repos/code\n", False),
            ("sources.list.d/vscode.list", "deb [arch=amd64] https://packages.microsoft.com/repos/code stable main\n",
             False),
            ("sources.list", "deb http://archive.ubuntu.com/ubuntu noble main\n"
                             "deb https://packages.microsoft.com/repos/code stable main\n", False),
            ("sources.list", "# deb https://packages.microsoft.com/repos/code stable main\n", True),  # commented out
        )
        for name, text, adds in sources:
            with self.subTest(source=name, adds=adds):
                shutil.rmtree(self.apt)
                (self.apt / "sources.list.d").mkdir(parents=True)
                (self.apt / name).write_text(text)
                rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get", "gh")), "--dry-run")
                self.assertEqual(rc, 0, out)
                self.assertIn("apt-get install -y code", out)
                self.assertEqual("microsoft.asc" in out, adds, out)
                self.assertEqual("/etc/apt/sources.list.d/vscode.list" in out, adds, out)
                self.assertEqual("gnupg" in out, adds, out)
                self.assertIn("apt-get install -y curl ca-certificates", out)  # Agentic Works' download needs curl

        # curl there already: nothing to install first.
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get", "gh", "curl")), "--dry-run")
        self.assertNotIn("ca-certificates", out)

    def disclosed(self, out: str) -> list[str] | None:
        """The system-wide changes listed before the sudo prompt; None when there was no prompt."""
        lines = out.splitlines()
        head = _index(lines, "Some installs need administrator rights")
        if head < 0:
            return None
        self.assertTrue(lines[head].endswith("This run adds, system-wide:"), lines[head])
        items = []
        for line in lines[head + 1:]:
            if not line.startswith("  - "):
                break
            items.append(line[4:])
        return items

    def test_system_wide_changes_are_listed_before_sudo(self) -> None:
        ms, gh_repo = ("Microsoft's VS Code package repository and its signing key",
                       "GitHub's gh package repository and its signing key")
        ssl = "OpenSSL 3 (Fedora, for VS Code's extension signature checks)"
        cases = (
            ("ubuntu, nothing there", "ubuntu", ("sudo", "apt-get"), {},
             ["curl and ca-certificates", "gnupg", ms, "VS Code", gh_repo, "gh"]),
            ("debian, gh only", "debian", ("sudo", "apt-get", "curl", "code"), {}, [gh_repo, "gh"]),
            ("debian, no curl, Agentic Works there", "debian", ("sudo", "apt-get", "code", "gh"), {}, None),
            # the claude step: Anthropic's installer runs without sudo, but the curl it is downloaded with is a system install
            ("debian, no curl, claude missing", "debian", ("sudo", "apt-get", "code", "gh", "git"), {},
             ["curl and ca-certificates"]),
            ("debian, no curl, Agentic Works older", "debian", ("sudo", "apt-get", "code", "gh"),
             {"CODE_EXTENSIONS": "agenticworks.agentic-works@1.0.0"}, ["curl and ca-certificates"]),
            ("rhel, VS Code only", "rhel", ("sudo", "dnf", "rpm", "curl", "gh"), {}, [ms, "VS Code"]),
            ("rhel, gh only", "rhel", ("sudo", "dnf", "rpm", "curl", "code"), {},
             ["GitHub's gh package repository and its signing key (with dnf's config-manager plugin)", "gh"]),
            ("fedora 45, nothing there", "fedora", ("sudo", "dnf", "rpm", "curl"), {"RPM_MISSING": "libssl.so.3"},
             [ms, "VS Code", ssl, "gh"]),
            ("fedora 45, VS Code there", "fedora", ALL_PRESENT, {"RPM_MISSING": "libssl.so.3"}, [ssl]),
            ("macos, no Homebrew", "macos", ("curl", "sudo"), {}, ["Homebrew"]),
            ("macos, Homebrew there", "macos", ("curl", "sudo", "brew"), {}, None),
            ("everything there", "ubuntu", ALL_PRESENT, {}, None),
            ("git only (ubuntu)", "ubuntu", tuple(n for n in ALL_PRESENT if n != "git"), {}, ["git"]),
            ("git only (rhel)", "rhel", tuple(n for n in ALL_PRESENT if n != "git"), {}, ["git"]),
            ("git only, --skip git", "ubuntu", tuple(n for n in ALL_PRESENT if n != "git"), {}, None),
            ("git broken", "ubuntu", ALL_PRESENT, {"GIT_BROKEN": "1"}, ["git"]),
            ("macos, git missing, Homebrew there", "macos", tuple(n for n in ALL_PRESENT if n != "git"), {}, None),
            ("--skip github", "debian", ("sudo", "apt-get", "curl", "code"), {}, None),
        )
        for name, os_name, stubs, extra, want in cases:
            with self.subTest(name):
                self.log.write_text("")
                args = ("--skip", "github") if name == "--skip github" else ()
                if name == "git only, --skip git":
                    args = ("--skip", "git")
                if "claude missing" not in name:
                    stubs = stubs + tuple(n for n in ("git", "claude") if n not in stubs and not name.startswith("git"))
                rc, out = self.run_pipe(self.env(os_name, stubs, **extra), *args)
                self.assertEqual(self.disclosed(out), want, out)

        # The ubuntu case with Microsoft's repository already a source: neither it nor gnupg is added.
        (self.apt / "sources.list.d" / "vscode.list").write_text("deb https://packages.microsoft.com/repos/code stable main\n")
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get")))
        self.assertEqual(self.disclosed(out), ["curl and ca-certificates", "VS Code", "git", gh_repo, "gh"], out)

    # Cursor can put its own `code` command on the PATH, so `code .` opens Cursor. That isn't VS Code: Agentic Works would go
    # into Cursor and its settings into a file Cursor doesn't read (Sean, 2026-11-27). A `code` under a Cursor folder is passed over.
    def cursor_first(self, env: dict[str, str]) -> dict[str, str]:
        cursor = self.tmp / "Cursor" / "resources" / "app" / "bin"
        cursor.mkdir(parents=True, exist_ok=True)
        (cursor / "code").write_text(STUB.format(name="cursor-code", extra=CODE))
        (cursor / "code").chmod(0o755)
        return {**env, "PATH": f"{cursor}:{env['PATH']}"}

    def test_cursors_code_is_passed_over_for_vscodes(self) -> None:
        rc, out = self.run_pipe(self.cursor_first(self.env("ubuntu", ALL_PRESENT)))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ VS Code (already)", out)
        self.assertIn("The code command on your PATH opens Cursor; Agentic Works uses VS Code's own.", out)
        self.assertEqual([l for l in self.stub_log() if l.startswith("cursor-code")], [], "Cursor is never run")
        self.assertTrue(any(l.startswith("code --list-extensions") for l in self.stub_log()), "VS Code's own is asked")

    def test_only_cursor_there_installs_vscode(self) -> None:
        (self.installs / "code").write_text(STUB.format(name="code", extra=CODE))
        (self.installs / "code").chmod(0o755)
        rc, out = self.run_pipe(self.cursor_first(self.env("ubuntu", ("sudo", "apt-get", "curl", "gpg", "gh"))),
                                "--skip", "extension", "--skip", "companions")
        self.assertIn("  ✓ VS Code (installed)", out)
        self.assertEqual([l for l in self.stub_log() if l.startswith("cursor-code")], [], "Cursor is never run")

    def test_fresh_fedora_names_openssl3(self) -> None:
        (self.installs / "code").write_text(STUB.format(name="code", extra=CODE))
        rc, out = self.run_pipe(self.env("fedora", ("sudo", "dnf", "rpm", "curl", "gh"), RPM_MISSING="libssl.so.3"),
                                "--skip", "extension", "--skip", "companions")
        self.assertIn("  ✓ VS Code (installed, with OpenSSL 3 for VS Code's extension signature checks)", out)

        # Without the need: just "installed".
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("fedora", ("sudo", "dnf", "rpm", "curl", "gh")),
                                "--skip", "extension", "--skip", "companions")
        self.assertIn("  ✓ VS Code (installed)\n", out)

    def test_install_that_gives_no_code_fails(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get", "curl", "gpg")))
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ VS Code: ", out)
        installs = [line for line in self.stub_log() if line.startswith("sudo ") and "apt-get install -y code" in line]
        self.assertEqual(len(installs), 1, self.stub_log())


class TestPlatform(_Installer):
    def test_unsupported_os_exits_1(self) -> None:
        rc, out = self.run_pipe(self.env("windows", ALL_PRESENT))
        self.assertEqual(rc, 1, out)
        for name in ("macOS", "Ubuntu 22.04+", "Debian", "RHEL/Rocky 8 and 9", "Fedora"):
            self.assertIn(name, out)
        self.assertEqual(self.stub_log(), [])

    def test_os_release_mapping(self) -> None:
        cases = (
            ('ID=ubuntu\nVERSION_ID="24.04"\n', "ubuntu"),
            ('ID=ubuntu\nVERSION_ID="22.04"\n', "ubuntu"),
            ('ID=ubuntu\nVERSION_ID="20.04"\n', "unsupported"),
            ('ID=debian\nVERSION_ID="12"\n', "debian"),
            ('ID=linuxmint\nID_LIKE="ubuntu debian"\nVERSION_ID="21.3"\n', "debian"),
            ('ID=pop\nID_LIKE="ubuntu debian"\nVERSION_ID="22.04"\n', "debian"),
            ('ID="rocky"\nID_LIKE="rhel centos fedora"\nVERSION_ID="9.4"\n', "rhel"),
            ('ID="rhel"\nVERSION_ID="8.10"\n', "rhel"),
            ('ID="centos"\nID_LIKE="rhel fedora"\nVERSION_ID="7"\n', "unsupported"),
            ('ID=fedora\nVERSION_ID=41\n', "fedora"),
            ('ID=arch\n', "unsupported"),
        )
        release = self.tmp / "os-release"
        env = self.env("ubuntu", ())
        for text, want in cases:
            with self.subTest(release=text):
                release.write_text(text)
                rc, out = self.run_sourced(env, 'os_from_release "$1" || echo unsupported', str(release))
                self.assertEqual(out.strip().splitlines()[-1], want, out)

    def test_sudo_is_refused(self) -> None:
        """`sudo bash agentic-works-install.sh`: stop at Platform, before anything is installed as root for someone else."""
        rc, out = self.run_sourced(self.env("ubuntu", ALL_PRESENT, SUDO_USER="alice"), 'id() { echo 0; }; main')
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ Platform: Run it without sudo: bash agentic-works-install.sh — it asks for your password when it "
                      "needs it.\n", out)
        self.assertEqual([mark.split(":")[0] for mark in self.marks(out)], ["✗ Platform"], out)
        self.assertRegex(out, r"\nDone: 0 ✓  0 –  1 ✗\n")
        self.assertEqual(self.stub_log(), [])

        # Root itself (a container, or sudo from root): runs as before.
        for extra in ({}, {"SUDO_USER": "root"}):
            with self.subTest(extra=extra):
                self.log.write_text("")
                rc, out = self.run_sourced(self.env("ubuntu", ALL_PRESENT, **extra), 'id() { echo 0; }; main')
                self.assertEqual(rc, 0, out)
                self.assertIn("  ✓ Platform (ubuntu, x86_64)", out)

    def test_platform_line(self) -> None:
        rc, out = self.run_pipe(self.env("fedora", ALL_PRESENT, AGENTIC_WORKS_INSTALL_FAKE_ARCH="aarch64"))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Platform (fedora, arm64)", out)


class TestPath(_Installer):
    """ensure_path: one marked block in the login profile, only when `code` isn't on the PATH already."""

    PROBE = ('MAC_CODE=$1; main --skip vscode --skip extension --skip companions --skip claude --skip git '
             '--skip github --skip homebrew')

    def mac_app(self) -> Path:
        code = self.tmp / "Applications" / "Visual Studio Code.app" / "Contents" / "Resources" / "app" / "bin" / "code"
        code.parent.mkdir(parents=True)
        code.write_text("#!/bin/sh\n")
        code.chmod(0o755)
        return code

    def test_path_block_once(self) -> None:
        code = self.mac_app()
        env = self.env("macos", ("brew",), SHELL="/bin/zsh")
        for run in (1, 2):
            rc, out = self.run_sourced(env, self.PROBE, str(code))
            self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ code on the PATH (.zprofile) (already)", out)
        text = (self.home / ".zprofile").read_text()
        self.assertEqual(text.count("# added by agentic-works-install"), 1, text)
        self.assertEqual(text.count("# end agentic-works-install"), 1, text)
        self.assertIn(str(code.parent), text)
        self.assertFalse((self.home / ".profile").exists())

        # The block works: a login shell reading it finds `code`.
        check = subprocess.run([shutil.which("bash"), "-c", f'PATH=/usr/bin:/bin; . "{self.home}/.zprofile"; '
                                'command -v code'], capture_output=True, timeout=30, check=False)
        self.assertEqual(check.stdout.decode().strip(), str(code), check)

    def test_homebrew_code_gets_brew_shellenv(self) -> None:
        env = self.env("macos", ("brew", "code"), SHELL="/bin/zsh")
        rc, out = self.run_sourced(env, 'ORIG_PATH=/usr/bin:/bin; main --skip vscode --skip claude --skip git --skip github --skip homebrew')
        self.assertEqual(rc, 0, out)
        text = (self.home / ".zprofile").read_text()
        self.assertIn(f'eval "$({self.tmp}/stubs/brew shellenv)"', text)

    HOMEBREW_BLOCK = ('# added by agentic-works-install: Homebrew\n[ -x /opt/homebrew/bin/brew ] && '
                      'eval "$(/opt/homebrew/bin/brew shellenv)"\n# end agentic-works-install\n')

    def test_homebrew_block_alone_does_not_count_as_the_path_block(self) -> None:
        code = self.mac_app()
        (self.home / ".zprofile").write_text(self.HOMEBREW_BLOCK)
        rc, out = self.run_sourced(self.env("macos", ("brew",), SHELL="/bin/zsh"), self.PROBE, str(code))
        self.assertEqual(rc, 0, out)
        self.assertNotIn("code on the PATH (.zprofile) (already)", out)
        text = (self.home / ".zprofile").read_text()
        self.assertTrue(text.startswith(self.HOMEBREW_BLOCK), text)
        self.assertEqual(text.splitlines().count("# added by agentic-works-install"), 1, text)
        self.assertIn(str(code.parent), text.split(self.HOMEBREW_BLOCK, 1)[1])

    def test_local_bin_goes_in_the_path_block_not_the_homebrew_block(self) -> None:
        path_block = '# added by agentic-works-install\nexport PATH="/opt/code/bin:$PATH"\n# end agentic-works-install\n'
        for name, text in (("homebrew first", self.HOMEBREW_BLOCK + path_block),
                           ("homebrew last", path_block + self.HOMEBREW_BLOCK)):
            with self.subTest(name):
                (self.home / ".profile").write_text(text)
                env = self.env("ubuntu", tuple(n for n in ALL_PRESENT if n != "claude"),
                               CURL_BODY='mkdir -p "$HOME/.local/bin"; : > "$HOME/.local/bin/claude"')
                rc, out = self.run_pipe(env)
                self.assertEqual(rc, 0, out)
                got = (self.home / ".profile").read_text()
                lines = got.splitlines()
                local = next(i for i, line in enumerate(lines) if "/.local/bin" in line)
                start = lines.index("# added by agentic-works-install")
                self.assertEqual(lines[start + 1], 'export PATH="/opt/code/bin:$PATH"', lines)
                self.assertEqual(local, start + 2, lines)
                self.assertEqual(lines[local + 1], "# end agentic-works-install", lines)
                self.assertEqual(len([l for l in lines if "/.local/bin" in l]), 1, got)
                (self.home / ".local" / "bin" / "claude").unlink()

    def test_code_on_the_path_leaves_the_profile_alone(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ code on the PATH (already)", out)
        self.assertFalse((self.home / ".profile").exists())
        self.assertFalse((self.home / ".bash_profile").exists())

    def test_bash_profile_when_there(self) -> None:
        code = self.mac_app()
        (self.home / ".bash_profile").write_text("# mine\n")
        rc, out = self.run_sourced(self.env("macos", ("brew",)), self.PROBE, str(code))
        self.assertEqual(rc, 0, out)
        self.assertIn("# added by agentic-works-install", (self.home / ".bash_profile").read_text())
        self.assertFalse((self.home / ".profile").exists())


class TestFlags(_Installer):
    def test_checklist_lines_when_piped(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT))
        self.assertEqual(rc, 0, out)
        self.assertNotIn("\r", out)
        self.assertIsNone(ANSI.search(out), out)
        lines = [line for line in out.splitlines() if line.startswith("  ") and not line.startswith("      ")]
        marks = [line for line in lines if MARK_LINE.match(line)]
        self.assertGreaterEqual(len(marks), 3, out)
        self.assertEqual(len(lines), 2 * len(marks), out)
        for begin, end in zip(lines[::2], lines[1::2]):
            self.assertTrue(begin.startswith("  … "), out)
            self.assertTrue(end[4:].startswith(begin[4:]), (begin, end))
        self.assertEqual([mark.split(" (")[0] for mark in self.marks(out)],
                         ["✓ Platform", "✓ VS Code", "✓ code on the PATH", "✓ Agentic Works", "✓ Companions", "✓ Claude Code CLI",
                          "✓ git", "✓ GitHub", "✓ Settings", "✓ Icons"], out)
        self.assertRegex(out, r"\nDone: 10 ✓  0 –  0 ✗\n")

    def test_skip_marks_the_step(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get")), "--skip", "vscode", "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn("  – VS Code: skipped (--skip vscode)", out)
        self.assertNotIn("apt-get install -y code", out)

    def test_every_step_name_and_flag_is_accepted(self) -> None:
        names = "vscode path profile standalone extension companions claude git github homebrew settings icons open".split()
        skips = tuple(arg for name in names for arg in ("--skip", name))
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT), "--yes", "--no-open", *skips)
        self.assertEqual(rc, 0, out)

    def test_unknown_skip_name_is_refused(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT), "--skip", "nonsense")
        self.assertEqual(rc, 2, out)
        self.assertIn("nonsense", out)

    def test_teams_app_shape_is_checked(self) -> None:
        for args in (("--teams-app",), ("--teams-app", "x:y"), ("--teams-app", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"),
                     ("--teams-app", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d:not a domain")):
            with self.subTest(args):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env("macos", ALL_PRESENT), *args)
                self.assertEqual(rc, 2, out)
                self.assertIn("--teams-app", out)
                self.assertEqual(self.stub_log(), [], "nothing run")

    def test_help(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT), "--help")
        self.assertEqual(rc, 0, out)
        for text in ("--dry-run", "--skip", "--yes", "--no-open", "--teams-app <clientId>:<tenant>", "--profile <name>",
                     "vscode path profile standalone extension companions claude git github homebrew settings icons open"):
            self.assertIn(text, out)
        self.assertEqual(self.stub_log(), [])


class TestBash32(_Installer):
    """The --dry-run ubuntu case under bash 3.2, in the bash:3.2 container."""

    @classmethod
    def setUpClass(cls) -> None:
        why = _why_not()
        if why:
            raise unittest.SkipTest(f"bash 3.2 container unavailable: {why}")

    def test_bash32(self) -> None:
        stubs = self.tmp / "stubs"
        _write_stubs(stubs, ("sudo", "apt-get", "python3"))
        cmd = ["docker", "run", "--rm", "-i", "-v", f"{self.script.parent}:/s:ro", "-v", f"{stubs}:/stubs:ro"]
        for name, value in {
            "HOME": "/tmp/h",
            "PATH": "/stubs:/usr/local/bin:/usr/bin:/bin",
            "STUB_LOG": "/tmp/stub.log",
            "AGENTIC_WORKS_INSTALL_FAKE_OS": "ubuntu",
            "AGENTIC_WORKS_INSTALL_HELPER": "/s/agentic-works-install-helper",
        }.items():
            cmd += ["-e", f"{name}={value}"]
        script = 'mkdir -p /tmp/h; echo "bash=$BASH_VERSION"; bash /s/agentic-works-install.sh --dry-run; echo "rc=$?"'
        cmd += [IMAGE, "bash", "-c", script]
        result = subprocess.run(cmd, capture_output=True, timeout=120, check=False, stdin=subprocess.DEVNULL)
        out = (result.stdout + result.stderr).decode()
        self.assertIn("bash=3.2", out)
        self.assertIn("rc=0", out)
        for bad in ("unbound variable", "syntax error", "bad substitution", "command not found"):
            self.assertNotIn(bad, out)
        self.assertIn("apt-get install -y code", out)
        self.assertIn("--install-extension", out)
        self.assertIn("apt-get install -y gh", out)
        self.assertIn("apt-get install -y git", out)
        self.assertIn("https://claude.ai/install.sh", out)
        self.assertIn("$ python3 /s/agentic-works-install-helper vscode-layout", out)
        self.assertRegex(out, r"\nDone: 10 ✓  0 –  0 ✗\n")


class TestPython36(unittest.TestCase):
    """The helper's tests under Python 3.6, RHEL 8's python3, in the python:3.6-slim container."""

    PY36 = "python:3.6-slim"

    @classmethod
    def setUpClass(cls) -> None:
        why = _why_not(cls.PY36)
        if why:
            raise unittest.SkipTest(f"Python 3.6 container unavailable: {why}")

    def test_helper_suite_on_python36(self) -> None:
        cmd = ["docker", "run", "--rm", "-v", f"{HERE.parent}:/w/installer:ro", "-w", "/w",
               "-e", "PYTHONDONTWRITEBYTECODE=1", self.PY36,
               "sh", "-c", 'python3 --version; python3 -m unittest installer/test/test_helper.py; echo "rc=$?"']
        result = subprocess.run(cmd, capture_output=True, timeout=300, check=False, stdin=subprocess.DEVNULL)
        out = (result.stdout + result.stderr).decode()
        self.assertIn("Python 3.6", out)
        self.assertIn("rc=0", out, out)
        self.assertRegex(out, r"\nOK\b", out)


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # keep the test output clean
        pass


class _Served(_Installer):
    """A local HTTP server for the .vsix downloads: good.vsix (matches SHA), bad.vsix (doesn't); others 404."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.served = Path(tempfile.mkdtemp(prefix="agentic-works-install-served-"))
        (cls.served / "good.vsix").write_bytes(VSIX)
        (cls.served / "bad.vsix").write_bytes(VSIX + b"!")
        handler = functools.partial(_Quiet, directory=str(cls.served))
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls) -> None:
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.served, ignore_errors=True)

    STUBS = ("code", "sudo", "gh", "git", "claude")

    def served_env(self, path: str = "good.vsix", **extra: str) -> dict[str, str]:
        """ubuntu, VS Code and gh in place, the real curl, the .vsix from the local server."""
        return self.env("ubuntu", self.STUBS, real=("curl",), AGENTIC_WORKS_INSTALL_VSIX_URL=f"{self.url}/{path}", **extra)

    def vsix_installs(self) -> list[str]:
        return [line for line in self.logged("--install-extension") if line.endswith(".vsix")]


class TestProfile(_Served):
    """--profile NAME (2026-11-27, for a company's setup beside the user's own VS Code): the extensions, settings and
    icons go into that VS Code profile, and the user's default profile is left as it is. The profile is made by the
    helper with VS Code closed; with VS Code open (it would lose a profile written beside it) a window opened on the
    name makes it, and the helper, waiting beside it, puts the user's settings and the look in as it does."""

    NAME = "Acme Works"

    def window_env(self, **extra: str) -> dict[str, str]:
        """VS Code open: the helper skips making the profile, and `code --new-window` makes it."""
        return self.profile_env(PY_PROFILE_RC="2", PY_PROFILE_OUT="VS Code is running",
                                PROFILE_MADE=str(self.tmp / "made"), **extra)

    def profile_env(self, **extra: str) -> dict[str, str]:
        return self.env("ubuntu", self.STUBS + ("python3",), real=("curl",), AGENTIC_WORKS_INSTALL_VSIX_URL=f"{self.url}/good.vsix",
                        CODE_EXTENSIONS="", **extra)

    def code_calls(self) -> list[str]:
        return [line for line in self.stub_log() if line.startswith("code ")]

    def test_everything_goes_into_the_profile(self) -> None:
        rc, out = self.run_pipe(self.profile_env(PY_PROFILE_OUT="made, with your settings"), "--profile", self.NAME)
        self.assertEqual(rc, 0, out)
        lines = out.splitlines()
        self.assertTrue(_index(lines, "✓ code on the PATH") < _index(lines, "✓ Profile Acme Works (made, with your settings)")
                        < _index(lines, "✓ Agentic Works"), out)
        calls = [c for c in self.code_calls() if "--install-extension" in c or "--list-extensions" in c]
        self.assertTrue(calls, self.stub_log())
        for call in calls:
            self.assertTrue(call.startswith("code --profile Acme Works "), call)
        helper = [line for line in self.stub_log() if line.startswith("python3 ")]
        self.assertEqual(helper, [f"python3 {HELPER} vscode-profile Acme Works",
                                  f"python3 {HELPER} --profile Acme Works vscode-settings",
                                  f"python3 {HELPER} --profile Acme Works vscode-layout"])
        self.assertIn("code --profile Acme Works", self.code_calls(), "a first install opens VS Code on the profile")

    def test_already_there(self) -> None:
        made = self.tmp / "made"
        made.touch()
        rc, out = self.run_pipe(self.profile_env(PROFILE_MADE=str(made)), "--profile", self.NAME)
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Profile Acme Works (already)", out)

    def test_vscode_open_makes_it_in_a_window(self) -> None:
        made = self.tmp / "made"
        env = self.profile_env(PY_PROFILE_RC="2", PY_PROFILE_OUT="VS Code is running", PROFILE_MADE=str(made),
                               PY_FILL_OUT="filled")
        rc, out = self.run_pipe(env, "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        # --skip-welcome: that window only (VS Code is running), so it shows none of VS Code's own walkthroughs
        self.assertIn("code --skip-welcome --profile Acme Works --new-window", self.code_calls())
        helper = [line for line in self.stub_log() if line.startswith("python3 ") and "vscode-profile" in line]
        self.assertEqual(helper, [f"python3 {HELPER} vscode-profile Acme Works",
                                  f"python3 {HELPER} vscode-profile Acme Works --fill --look --wait 30"])
        self.assertIn("  ✓ Profile Acme Works (made in a window VS Code opened on it, with your settings)", out)
        lines = self.stub_log()
        self.assertLess(_index(lines, "--new-window"), _index(lines, "--install-extension"))

    def test_the_helper_waits_beside_the_window_being_opened(self) -> None:
        # the window reads its profile's settings about half a second after `code` is run, a good half second before
        # `code` returns (VS Code 1.129, 2026-11-28): a helper run after it would be too late with them
        rc, out = self.run_pipe(self.window_env(), "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        self.assertIn("window: the helper waits beside it", self.stub_log())

    def test_a_fill_that_fails_doesnt_stop_the_run(self) -> None:
        rc, out = self.run_pipe(self.window_env(PY_FILL_RC="1"), "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Profile Acme Works (made in a window VS Code opened on it)", out)
        self.assertTrue(self.logged("--install-extension"))

    def test_settings_are_written_again_for_the_window_opened(self) -> None:
        # that window misses a settings.json written before it watches the file, about a second after it opens,
        # until the file is written again: the settings step does, once the window has had its settle time
        rc, out = self.run_pipe(self.window_env(AGENTIC_WORKS_INSTALL_SETTLE="0"), "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"python3 {HELPER} --profile Acme Works vscode-settings --rewrite 0", self.stub_log())

    def test_settings_wait_out_what_is_left_of_the_windows_ten_seconds(self) -> None:
        began = time.monotonic()
        rc, out = self.run_pipe(self.window_env(), "--profile", self.NAME, "--no-open")
        took = time.monotonic() - began
        self.assertEqual(rc, 0, out)
        (call,) = [line for line in self.stub_log() if "vscode-settings" in line]
        left = re.search(r" vscode-settings --rewrite ([0-9]+)$", call)
        self.assertTrue(left, call)
        # ten seconds from the window, less what the steps since took (the whole run took `took`; bash counts in seconds)
        self.assertLessEqual(int(left.group(1)), 10, call)
        self.assertGreaterEqual(int(left.group(1)), 10 - took - 1, call)

    def test_a_settle_time_with_a_zero_in_front_is_a_number_too(self) -> None:
        # bash reads 08 as an octal number, which it isn't: the run ended there
        rc, out = self.run_pipe(self.window_env(AGENTIC_WORKS_INSTALL_SETTLE="08"), "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        (call,) = [line for line in self.stub_log() if "vscode-settings" in line]
        self.assertRegex(call, r" vscode-settings --rewrite [0-8]$")
        self.assertIn("  ✓ Settings", out)

    def test_skipping_the_settings_keeps_the_look_out_of_the_profile_too(self) -> None:
        # --skip settings: none of the look's settings are written, by the settings step or as the profile is made
        rc, out = self.run_pipe(self.window_env(), "--profile", self.NAME, "--no-open", "--skip", "settings")
        self.assertEqual(rc, 0, out)
        helper = [line for line in self.stub_log() if line.startswith("python3 ")]
        self.assertIn(f"python3 {HELPER} vscode-profile Acme Works --fill --wait 30", helper)
        self.assertEqual([line for line in helper if "--look" in line or "vscode-settings" in line], [])
        self.assertIn("  ✓ Profile Acme Works (made in a window VS Code opened on it, with your settings)", out)

    def test_the_window_that_makes_it_starts_without_vscodes_welcome(self) -> None:
        # the window starts before the profile has settings (Copilot off among them): on VS Code's very first launch it
        # showed VS Code's welcome, a Copilot sign-in (Sean, 2026-11-27: "we already turned off the copilot. check how
        # it came back"; "have the installer add that one line")
        made = self.tmp / "made"
        env = self.profile_env(PY_PROFILE_RC="2", PY_PROFILE_OUT="VS Code is running", PROFILE_MADE=str(made))
        rc, out = self.run_pipe(env, "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        lines = self.stub_log()
        self.assertGreaterEqual(_index(lines, "vscode-no-onboarding"), 0, lines)
        self.assertLess(_index(lines, "vscode-no-onboarding"), _index(lines, "--new-window"))

    def test_vscode_closed_leaves_the_users_settings(self) -> None:
        rc, out = self.run_pipe(self.profile_env(PY_PROFILE_OUT="made"), "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 0, out)
        self.assertFalse([line for line in self.stub_log() if "vscode-no-onboarding" in line])

    def test_vscode_open_makes_it_in_a_window_on_the_folder(self) -> None:
        # one window, not two: a company's setup that opens a folder after has it opened in the window that makes the
        # profile, and learns so from the mark (2026-11-27)
        made, mark, folder = self.tmp / "made", self.tmp / "opened", self.tmp / "works"
        folder.mkdir()
        env = self.profile_env(PY_PROFILE_RC="2", PY_PROFILE_OUT="VS Code is running", PROFILE_MADE=str(made),
                               PY_FILL_OUT="filled")
        rc, out = self.run_pipe(env, "--profile", self.NAME, "--no-open", "--folder", str(folder),
                                "--window-mark", str(mark))
        self.assertEqual(rc, 0, out)
        self.assertEqual([c for c in self.code_calls() if "--disable-workspace-trust" in c], [], "not without --trust-folder")
        self.assertIn(f"code --skip-welcome --profile Acme Works --new-window {folder}", self.code_calls())
        self.assertTrue(mark.is_file())
        self.assertIn(f"  ✓ Profile Acme Works (made in a window VS Code opened on it, with your settings; on {folder})", out)

    def test_a_folder_the_setup_vouches_for_opens_trusted(self) -> None:
        # a folder VS Code doesn't trust opens in Restricted Mode, where Agentic Works is off and VS Code shows its own
        # walkthrough instead of Get started (Sean, 2026-11-28: "we can't get a new vscode with [the] walkthrough
        # screen?"). VS Code, running, reads no trust written beside it; --disable-workspace-trust holds for that
        # window only
        folder = self.tmp / "works"
        folder.mkdir()
        rc, out = self.run_pipe(self.window_env(), "--profile", self.NAME, "--no-open", "--folder", str(folder),
                                "--trust-folder")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"code --skip-welcome --disable-workspace-trust --profile Acme Works --new-window {folder}",
                      self.code_calls())

    def test_the_windows_flags_wait_for_a_vscode_that_surely_runs(self) -> None:
        # asked last, right before the window: what `code` is given holds for that window alone only while a VS Code
        # runs to take it
        folder = self.tmp / "works"
        folder.mkdir()
        rc, out = self.run_pipe(self.window_env(), "--profile", self.NAME, "--no-open", "--folder", str(folder),
                                "--trust-folder")
        self.assertEqual(rc, 0, out)
        lines = self.stub_log()
        # VS Code finds the one running by a socket named after its version: the helper is told which `code` is on disk
        self.assertEqual([line for line in lines if "vscode-running" in line],
                         [f"python3 {HELPER} vscode-running --code-version 1.129.1"])
        self.assertEqual([line for line in lines if "--version" in line and line.startswith("code ")], ["code --version"])
        self.assertLess(_index(lines, "vscode-no-onboarding"), _index(lines, "code --version"))
        self.assertLess(_index(lines, "code --version"), _index(lines, "vscode-running"))
        self.assertLess(_index(lines, "vscode-running"), _index(lines, "--new-window"))

    def test_a_code_that_says_no_version_gets_none_of_the_windows_flags(self) -> None:
        # without it the helper can't tell where this `code` looks for a VS Code already running
        folder = self.tmp / "works"
        folder.mkdir()
        for says in ("", "Unknown version", "1.129.1 (user setup)", "1.129.1; rm -rf x"):
            with self.subTest(says=says):
                self.log.write_text("")
                (self.tmp / "made").unlink() if (self.tmp / "made").exists() else None
                rc, out = self.run_pipe(self.window_env(CODE_VERSION_SAYS=says), "--profile", self.NAME, "--no-open",
                                        "--folder", str(folder), "--trust-folder")
                self.assertEqual(rc, 0, out)
                self.assertIn(f"code --profile Acme Works --new-window {folder}", self.code_calls())
                self.assertEqual([c for c in self.code_calls() if "--skip-welcome" in c or "--disable-workspace-trust" in c], [])
                self.assertEqual(self.logged("vscode-running"), [], "nothing to ask the helper with")

    def test_a_code_that_fails_to_say_its_version_gets_none_of_the_windows_flags(self) -> None:
        folder = self.tmp / "works"
        folder.mkdir()
        rc, out = self.run_pipe(self.window_env(CODE_VERSION_SAYS="", CODE_VERSION_RC="1"), "--profile", self.NAME,
                                "--no-open", "--folder", str(folder), "--trust-folder")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"code --profile Acme Works --new-window {folder}", self.code_calls())
        self.assertEqual([c for c in self.code_calls() if "--skip-welcome" in c or "--disable-workspace-trust" in c], [])

    def test_a_vscode_that_may_not_be_running_gets_none_of_the_windows_flags(self) -> None:
        # code.lock outlives a VS Code that crashed, and the `code` of an update on disk doesn't find the VS Code still
        # running: `code` then starts a VS Code, though the helper said one runs. Options given to a VS Code being
        # started hold for all of its windows until it quits, and one of them turns Restricted Mode off
        folder = self.tmp / "works"
        folder.mkdir()
        rc, out = self.run_pipe(self.window_env(PY_RUNNING_RC="2"), "--profile", self.NAME, "--no-open",
                                "--folder", str(folder), "--trust-folder")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"code --profile Acme Works --new-window {folder}", self.code_calls())
        self.assertEqual([c for c in self.code_calls() if "--skip-welcome" in c or "--disable-workspace-trust" in c], [])
        self.assertIn(f"  ✓ Profile Acme Works (made in a window VS Code opened on it, with your settings; on {folder})", out)

    def test_vscode_closed_gets_none_of_the_windows_flags(self) -> None:
        # given to a VS Code that isn't running they would hold for all of its windows, until it quits
        folder = self.tmp / "works"
        folder.mkdir()
        rc, out = self.run_pipe(self.profile_env(PY_PROFILE_OUT="made"), "--profile", self.NAME, "--folder", str(folder),
                                "--trust-folder")
        self.assertEqual(rc, 0, out)
        self.assertIn("code --profile Acme Works", self.code_calls(), "VS Code is opened, as before")
        self.assertEqual([c for c in self.code_calls() if "--skip-welcome" in c or "--disable-workspace-trust" in c], [])

    def test_the_window_that_made_the_profile_is_the_one_opened(self) -> None:
        made = self.tmp / "made"
        env = self.profile_env(PY_PROFILE_RC="2", PY_PROFILE_OUT="VS Code is running", PROFILE_MADE=str(made),
                               PY_FILL_OUT="filled")
        rc, out = self.run_pipe(env, "--profile", self.NAME)
        self.assertEqual(rc, 0, out)
        opens = [c for c in self.code_calls() if not any(w in c for w in ("--install-extension", "--list-extensions",
                                                                          "--uninstall-extension", "--version"))]
        self.assertEqual(opens, ["code --skip-welcome --profile Acme Works --new-window"], self.code_calls())

    def test_no_window_no_mark(self) -> None:
        mark, folder = self.tmp / "opened", self.tmp / "works"
        folder.mkdir()
        rc, out = self.run_pipe(self.profile_env(PY_PROFILE_OUT="made"), "--profile", self.NAME, "--no-open",
                                "--folder", str(folder), "--window-mark", str(mark))
        self.assertEqual(rc, 0, out)
        self.assertFalse(mark.exists())
        self.assertFalse([c for c in self.code_calls() if "--new-window" in c])

    def test_folder_must_be_a_folder(self) -> None:
        for args in (["--folder", str(self.tmp / "nowhere")], ["--folder", "relative"], ["--folder"],
                     ["--window-mark"], ["--window-mark", "relative"]):
            rc, out = self.run_pipe(self.profile_env(), "--profile", self.NAME, *args)
            self.assertEqual(rc, 2, (args, out))

    def test_trust_folder_needs_a_folder(self) -> None:
        rc, out = self.run_pipe(self.profile_env(), "--profile", self.NAME, "--trust-folder")
        self.assertEqual(rc, 2, out)
        self.assertIn("--trust-folder needs --folder", out)
        self.assertEqual(self.stub_log(), [], "nothing run")

    def test_window_that_never_makes_it_stops_the_run(self) -> None:
        env = self.profile_env(PY_PROFILE_RC="2", PY_PROFILE_OUT="VS Code is running", AGENTIC_WORKS_INSTALL_PROFILE_WAIT="1")
        rc, out = self.run_pipe(env, "--profile", self.NAME, "--no-open")
        self.assertEqual(rc, 1, out)
        self.assertRegex(out, r"  ✗ Profile Acme Works: VS Code didn't make it")
        self.assertRegex(out, r"  ✗ Agentic Works: .*profile")
        self.assertIn(f"python3 {HELPER} vscode-profile Acme Works --fill --look --wait 1", self.stub_log())
        self.assertEqual(self.logged("--install-extension"), [], "nothing goes into the default profile")

    def test_helper_failure_stops_the_run(self) -> None:
        rc, out = self.run_pipe(self.profile_env(PY_PROFILE_RC="1"), "--profile", self.NAME)
        self.assertEqual(rc, 1, out)
        self.assertRegex(out, r"  ✗ Profile Acme Works: couldn't make it; see ")
        self.assertEqual(self.logged("--install-extension"), [])
        self.assertEqual([c for c in self.code_calls() if c.startswith("code --profile Acme Works") and "-extension" not in c], [])

    def test_dry_run_prints_and_runs_nothing(self) -> None:
        rc, out = self.run_pipe(self.profile_env(), "--profile", self.NAME, "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"$ python3 {HELPER} vscode-profile 'Acme Works'", out)
        self.assertIn("  ✓ Profile Acme Works (dry run)", out)
        self.assertEqual([line for line in self.stub_log() if line.startswith("python3 ")], [])

    def test_name_shape_is_checked(self) -> None:
        for args in (("--profile",), ("--profile", ""), ("--profile", "a/b"), ("--profile", "x" * 41), ("--profile", " lead")):
            with self.subTest(args):
                self.log.write_text("")
                rc, out = self.run_pipe(self.profile_env(), *args)
                self.assertEqual(rc, 2, out)
                self.assertIn("--profile", out)
                self.assertEqual(self.stub_log(), [], "nothing run")

    def test_no_profile_no_step(self) -> None:
        rc, out = self.run_pipe(self.profile_env())
        self.assertEqual(rc, 0, out)
        self.assertNotIn("Profile", out)
        self.assertEqual([line for line in self.stub_log() if "--profile" in line or "vscode-profile" in line], [])


class TestVSCodeOpen(_Served):
    """VS Code open while extensions change (2026-11-27): asked once to close its local windows when the standalone
    extensions go (they'd clash with Agentic Works); an update only says to reload the local windows; a Remote window
    (the same app here, so not told apart) is never waited for. VS Code is opened only by a first install."""

    def open_env(self, times: int, installed: str = "seanahn.perch@0.9.0", **extra: str) -> dict[str, str]:
        count = self.tmp / "vscode-open"
        count.write_text(str(times))
        env = self.env("ubuntu", self.STUBS + ("pgrep",), real=("curl",), AGENTIC_WORKS_INSTALL_VSIX_URL=f"{self.url}/good.vsix",
                       VSCODE_OPEN_COUNT=str(count), CODE_EXTENSIONS=(installed + " " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)).strip())
        env.update(extra)
        return env

    WAIT = "VS Code is open on this computer. Close its local windows (a Remote window can stay), then press Enter."
    RELOAD = f"Reload your local VS Code windows to use Agentic Works {VERSION}; Remote windows aren't affected."

    def test_standalone_asks_once_then_goes_on(self) -> None:
        rc, out = self.run_pipe(self.open_env(9, AGENTIC_WORKS_INSTALL_TTY=self.tty("y", "")))
        self.assertEqual(rc, 0, out)
        self.assertEqual(out.count(self.WAIT), 1, out)
        self.assertLess(out.index(self.WAIT), out.index("✓ Standalone extensions (uninstalled Perch)"))
        self.assertIn(self.RELOAD, out)  # still open (a Remote window, say): its local windows to reload

    def test_standalone_closed_no_question(self) -> None:
        rc, out = self.run_pipe(self.open_env(0, AGENTIC_WORKS_INSTALL_TTY=self.tty("y")))
        self.assertEqual(rc, 0, out)
        self.assertNotIn(self.WAIT, out)
        self.assertNotIn(self.RELOAD, out)

    def test_standalone_no_terminal_goes_on(self) -> None:
        rc, out = self.run_pipe(self.open_env(9, AGENTIC_WORKS_INSTALL_TTY=str(self.tmp / "no-tty")), "--yes")
        self.assertEqual(rc, 0, out)
        self.assertNotIn(self.WAIT, out)
        self.assertIn(self.RELOAD, out)

    def test_upgrade_never_asks_and_opens_nothing(self) -> None:
        for times, reload in ((9, True), (0, False)):
            with self.subTest(open=bool(times)):
                self.log.write_text("")
                rc, out = self.run_pipe(self.open_env(times, "agenticworks.agentic-works@1.0.0", AGENTIC_WORKS_INSTALL_TTY=self.tty("")))
                self.assertEqual(rc, 0, out)
                self.assertIn(f"✓ Agentic Works (upgraded from 1.0.0 to {VERSION})", out)
                self.assertNotIn(self.WAIT, out)
                self.assertEqual(self.RELOAD in out, reload, out)
                self.assertEqual(self.opens(), [])

    def test_first_install_opens_plain_code(self) -> None:
        # plain `code`, as starting it from the dock does: VS Code brings back the windows it had, each with its
        # layout; --new-window gave an empty window, whose layout VS Code doesn't keep
        rc, out = self.run_pipe(self.open_env(0, ""))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"✓ Agentic Works (installed {VERSION})", out)
        self.assertEqual(self.opens(), ["code "], self.stub_log())
        for args in (("--no-open",), ("--skip", "open"), ("--dry-run",)):
            with self.subTest(args=args):
                self.log.write_text("")
                rc, out = self.run_pipe(self.open_env(0, ""), *args)
                self.assertEqual(rc, 0, out)
                self.assertEqual(self.opens(), [])
        self.assertRegex(out, r"Would open VS Code: \$ \S*/code\n")  # the dry run shows it, with no --new-window


class TestStandalone(_Served):
    """check_standalone: the four standalone extensions go before Agentic Works comes, or Agentic Works doesn't come."""

    def test_no_standalone_no_question(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, AGENTIC_WORKS_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 0, out)
        self.assertNotIn("Agentic Works replaces", out)
        self.assertNotIn("Standalone", out)
        self.assertEqual(self.logged("--uninstall-extension"), [])

    def test_standalone_yes_uninstalls_then_installs(self) -> None:
        installed = "seanahn.perch@0.9.0 Seanahn.Jay@0.5.0 " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)
        cases = (
            ("answered Y", self.tty("y"), ()),
            ("answered Enter", self.tty(""), ()),
            ("--yes, no terminal", str(self.tmp / "no-tty"), ("--yes",)),
        )
        for name, tty, args in cases:
            with self.subTest(name):
                self.log.write_text("")
                rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed, AGENTIC_WORKS_INSTALL_TTY=tty), *args)
                self.assertEqual(rc, 0, out)
                if args:
                    self.assertNotIn("[Y/n]", out)
                else:
                    self.assertIn("      Agentic Works replaces Perch and jay. Uninstall them and use Agentic Works? [Y/n]", out)
                self.assertIn("  ✓ Standalone extensions (uninstalled Perch and jay)", out)
                self.assertIn(f"  ✓ Agentic Works (installed {VERSION})", out)
                log = self.stub_log()
                perch = _index(log, "--uninstall-extension seanahn.perch")
                jay = _index(log, "--uninstall-extension seanahn.jay")
                ext = _index(log, "vsix-present ")
                self.assertTrue(0 <= perch < jay < ext, log)
                self.assertNotIn("chirp", "\n".join(self.logged("--uninstall-extension")))
                self.assertEqual(self.leftovers(), [])

    def test_standalone_stop_skips_the_rest(self) -> None:
        installed = f"seanahn.kestrel-prs@0.2.0 seanahn.chirp@0.3.0"
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed, AGENTIC_WORKS_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 1, out)
        self.assertIn("Agentic Works replaces chirp and kestrel. Uninstall them and use Agentic Works? [Y/n]", out)
        ext = [mark for mark in self.marks(out) if mark.startswith("✗ Agentic Works: ")]
        self.assertEqual(len(ext), 1, out)
        self.assertIn("stopped", ext[0])
        self.assertEqual([mark.split(":")[0].split(" (")[0] for mark in self.marks(out)],
                         ["✓ Platform", "✓ VS Code", "✓ code on the PATH", "✗ Agentic Works", "– Companions",
                          "– Settings", "– Icons"], out)
        self.assertIn("  – Companions: skipped — Agentic Works was not installed", out)
        self.assertIn("  – Settings: skipped — Agentic Works was not installed", out)
        self.assertIn("  – Icons: skipped — Agentic Works was not installed", out)
        self.assertEqual(self.opens(), [])  # nor is VS Code opened
        self.assertEqual(self.logged("--install-extension"), [])
        self.assertEqual(self.logged("--uninstall-extension"), [])
        self.assertEqual([line for line in self.stub_log() if line.startswith("gh ")], [])
        self.assertRegex(out, r"\nDone: 3 ✓  3 –  1 ✗\n")

    def test_standalone_gannet_is_replaced_too(self) -> None:
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS="seanahn.gannet@0.5.7", AGENTIC_WORKS_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 1, out)
        self.assertIn("Agentic Works replaces Gannet. Uninstall them and use Agentic Works? [Y/n]", out)

    def test_standalone_gannet_state_is_kept(self) -> None:
        # VS Code deletes an extension's global storage when it is uninstalled: Gannet's machine.json is copied first
        storage = self.home / ".config" / "Code" / "User" / "globalStorage"
        (storage / "seanahn.gannet").mkdir(parents=True)
        (storage / "seanahn.gannet" / "machine.json").write_text('{"gannet.workspaces": ["/git"]}')
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS="seanahn.gannet@0.5.7"), "--yes")
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Standalone extensions (uninstalled Gannet)", out)
        self.assertEqual(self.logged("--uninstall-extension"), ["code --uninstall-extension seanahn.gannet"])
        self.assertEqual((storage / "agenticworks.agentic-works" / "machine.json").read_text(), '{"gannet.workspaces": ["/git"]}')
        # Agentic Works' own is never replaced
        (storage / "seanahn.gannet" / "machine.json").write_text('{"gannet.workspaces": ["/other"]}')
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS="seanahn.gannet@0.5.7"), "--yes")
        self.assertEqual(rc, 0, out)
        self.assertEqual((storage / "agenticworks.agentic-works" / "machine.json").read_text(), '{"gannet.workspaces": ["/git"]}')

    def test_standalone_gannet_state_is_kept_where_vscode_keeps_it(self) -> None:
        # on Linux VS Code's data is in $XDG_CONFIG_HOME/Code when that is set
        config = self.tmp / "cfg"
        storage = config / "Code" / "User" / "globalStorage"
        (storage / "seanahn.gannet").mkdir(parents=True)
        (storage / "seanahn.gannet" / "machine.json").write_text('{"gannet.workspaces": ["/git"]}')
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS="seanahn.gannet@0.5.7", XDG_CONFIG_HOME=str(config)), "--yes")
        self.assertEqual(rc, 0, out)
        self.assertEqual((storage / "agenticworks.agentic-works" / "machine.json").read_text(), '{"gannet.workspaces": ["/git"]}')

    def test_no_terminal_without_yes_stops(self) -> None:
        env = self.served_env(CODE_EXTENSIONS="seanahn.jay@0.5.0", AGENTIC_WORKS_INSTALL_TTY=str(self.tmp / "no-tty"))
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        self.assertNotIn("[Y/n]", out)
        ext = [mark for mark in self.marks(out) if mark.startswith("✗ Agentic Works: ")]
        self.assertEqual(len(ext), 1, out)
        self.assertIn("jay", ext[0])
        self.assertIn("--yes", ext[0])
        self.assertEqual(self.logged("--uninstall-extension"), [])
        self.assertEqual(self.logged("--install-extension"), [])

        # A terminal that gives no answer (end of input) is not a yes either.
        self.log.write_text("")
        rc, out = self.run_pipe({**env, "AGENTIC_WORKS_INSTALL_TTY": "/dev/null"})
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.logged("--uninstall-extension"), [])

    def test_failed_uninstall_installs_no_agentic_works(self) -> None:
        env = self.served_env(CODE_EXTENSIONS="seanahn.perch@0.9.0 seanahn.jay@0.5.0",
                              CODE_FAIL_ON="--uninstall-extension seanahn.jay")
        rc, out = self.run_pipe(env, "--yes")
        self.assertEqual(rc, 1, out)
        ext = [mark for mark in self.marks(out) if mark.startswith("✗ Agentic Works: ")]
        self.assertEqual(len(ext), 1, out)
        self.assertIn("couldn't uninstall jay", ext[0])
        self.assertNotIn("Perch", ext[0])
        self.assertEqual(self.logged("--install-extension"), [])
        self.assertIn("  – Companions: skipped — Agentic Works was not installed", out)
        self.assertNotIn("GitHub", out)


class TestAgenticWorks(_Served):
    """ensure_agentic_works: the release's .vsix, version-aware, SHA-256 checked."""

    def test_same_version_already(self) -> None:
        rc, out = self.run_pipe(self.served_env())
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Agentic Works (already)", out)
        self.assertEqual(self.logged("--install-extension"), [])

    def test_older_version_upgraded(self) -> None:
        installed = "agenticworks.agentic-works@1.1.9 " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  ✓ Agentic Works (upgraded from 1.1.9 to {VERSION})\n", out)
        self.assertNotIn("Reload", out)  # VS Code isn't open here; when it is, the summary says so (TestVSCodeOpen)
        installs = self.vsix_installs()
        self.assertEqual(len(installs), 1, self.stub_log())
        self.assertTrue(installs[0].endswith(f"/agentic-works-{VERSION}.vsix"), installs)
        self.assertEqual(len(self.logged("vsix-present ")), 1, self.stub_log())  # the file was there for code
        self.assertEqual(self.leftovers(), [])  # and is gone after

    def test_newer_agentic_works_is_left_alone(self) -> None:
        installed = "agenticworks.agentic-works@1.10.0 " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)  # 1.10 > 1.2
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  – Agentic Works: 1.10.0 is newer than this installer's {VERSION}; left as is", out)
        self.assertEqual(self.logged("--install-extension"), [])

    def test_prerelease_counts_as_its_release(self) -> None:
        installed = f"agenticworks.agentic-works@{VERSION}-beta.1 " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Agentic Works (already)", out)
        for a, b, want in (("1.2.3-beta.1", "1.2.3", "eq"), ("1.2.3", "1.2.4-rc.9", "lt"), ("1.10.0", "1.9.9", "gt")):
            rc, out = self.run_sourced(self.served_env(), 'version_cmp "$1" "$2"', a, b)
            self.assertEqual(out.strip(), want, (a, b))

    def test_curl_installed_for_the_download(self) -> None:
        """Ubuntu/Debian with VS Code but no curl (a minimal system): curl goes in, under the one sudo prompt, before
        the .vsix download."""
        (self.installs / "curl").write_text(f'#!/bin/sh\nexec {shutil.which("curl")} "$@"\n')
        for os_name in ("ubuntu", "debian"):
            with self.subTest(os=os_name):
                self.log.write_text("")
                shutil.rmtree(self.tmp / "stubs", ignore_errors=True)
                env = self.env(os_name, ("code", "sudo", "apt-get", "gh", "git", "claude"), AGENTIC_WORKS_INSTALL_VSIX_URL=f"{self.url}/good.vsix",
                               CODE_EXTENSIONS=" ".join(f"{c}@1.0.0" for c in COMPANIONS))
                rc, out = self.run_pipe(env)
                self.assertEqual(rc, 0, out)
                self.assertIn("Some installs need administrator rights", out)
                self.assertIn(f"  ✓ Agentic Works (installed {VERSION})", out)
                log = self.stub_log()
                curl = _index(log, "sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y curl ca-certificates")
                self.assertTrue(0 <= _index(log, "sudo -v") < curl < _index(log, "vsix-present "), log)

        # A dry run with nothing installed plans curl once, not in each step that needs it.
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get")), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertEqual(len([line for line in out.splitlines() if "apt-get install -y curl" in line]), 1, out)

    def test_checksum_case_does_not_matter(self) -> None:
        stamp(self.script, sha=SHA.upper())
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=" ".join(f"{c}@1.0.0" for c in COMPANIONS)))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  ✓ Agentic Works (installed {VERSION})", out)

    def test_interrupted_install_leaves_nothing(self) -> None:
        """Ctrl-C (SIGINT to the process group) while code installs the .vsix: its temp dir still goes."""
        env = self.served_env(CODE_EXTENSIONS="", CODE_SLEEP="30")
        proc = subprocess.Popen([shutil.which("bash"), str(self.script)], env=env, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            for _ in range(200):
                if self.logged("vsix-present"):
                    break
                time.sleep(0.05)
            self.assertTrue(self.logged("vsix-present"), self.stub_log())
            self.assertTrue(self.leftovers())  # there while code runs
            os.killpg(proc.pid, signal.SIGINT)
            self.assertEqual(proc.wait(timeout=10), 130)
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
        self.assertEqual(self.leftovers(), [])

    def test_fresh_install(self) -> None:
        installed = " ".join(f"{c}@1.0.0" for c in COMPANIONS)
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  ✓ Agentic Works (installed {VERSION})", out)
        self.assertNotIn("Reload", out)  # only an upgrade replaces a running Agentic Works
        self.assertEqual(len(self.vsix_installs()), 1, self.stub_log())
        self.assertEqual(self.leftovers(), [])

    def test_checksum_mismatch_refuses(self) -> None:
        rc, out = self.run_pipe(self.served_env("bad.vsix", CODE_EXTENSIONS=""))
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ Agentic Works: the download did not match its checksum — run the installer again", out)
        self.assertEqual(self.vsix_installs(), [])
        self.assertEqual(self.logged("vsix-present"), [])
        self.assertEqual(self.leftovers(), [])
        self.assertIn("  ✓ Companions (installed", out)  # the run goes on

    def test_marketplace_blocked(self) -> None:
        """Installing Agentic Works' .vsix makes VS Code fetch its extension pack (the companions) from the Marketplace; with
        the Marketplace blocked that install fails: the Agentic Works line says it may be the Marketplace, and the
        Companions line doesn't claim Agentic Works works."""
        gallery = ("Error while installing extensions: Failed Installing Extensions: anthropic.claude-code "
                   "(getaddrinfo ENOTFOUND marketplace.visualstudio.com)")
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS="", CODE_FAIL_ON="--install-extension",
                                                CODE_FAIL_MSG=gallery))
        self.assertEqual(rc, 1, out)
        ext = [mark for mark in self.marks(out) if mark.startswith("✗ Agentic Works: ")]
        self.assertEqual(len(ext), 1, out)
        self.assertTrue(ext[0].startswith("✗ Agentic Works: VS Code couldn't install it; it also fetches Claude Code, "
                                            "ChatGPT and Perch's audio from the Marketplace, which may be unreachable "
                                            "from here — see "), ext)
        companions = [mark for mark in self.marks(out) if mark.startswith("✗ Companions: ")]
        self.assertEqual(len(companions), 1, out)
        self.assertIn("Perch's tabs need Claude Code or ChatGPT to run an agent", companions[0])
        self.assertNotIn("Agentic Works works", companions[0])
        self.assertIn(gallery, Path(out.split("Details of what failed: ")[1].split()[0]).read_text())

    def test_download_failure_reported(self) -> None:
        rc, out = self.run_pipe(self.served_env("missing.vsix", CODE_EXTENSIONS=""))
        self.assertEqual(rc, 1, out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Agentic Works: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("couldn't download", failed[0])
        self.assertIn(f"{self.url}/missing.vsix", failed[0])
        self.assertEqual(self.vsix_installs(), [])
        self.assertEqual(self.leftovers(), [])

    def test_unstamped_script_refuses(self) -> None:
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=""), script=SCRIPT)
        self.assertEqual(rc, 1, out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Agentic Works: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("run a released installer", failed[0])
        self.assertEqual(self.vsix_installs(), [])

    def test_dry_run_downloads_nothing(self) -> None:
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=""), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"{self.url}/good.vsix", out)
        self.assertIn("  ✓ Agentic Works (dry run)", out)
        self.assertEqual(self.logged("--install-extension"), [])
        self.assertEqual(self.leftovers(), [])

    def test_root_uses_the_user_data_dir(self) -> None:
        """As root on Linux every code call gets --user-data-dir (the CLI refuses without one)."""
        rc, out = self.run_sourced(self.served_env(CODE_EXTENSIONS=""), 'id() { echo 0; }; main')
        self.assertEqual(rc, 0, out)
        calls = self.logged("code ")
        self.assertTrue(calls, self.stub_log())
        for line in calls:
            self.assertIn(f"--user-data-dir {self.home}/.config/Code", line)


class TestCompanions(_Installer):
    def test_companions_installed_when_missing(self) -> None:
        installed = f"agenticworks.agentic-works@{VERSION} OpenAI.chatgpt@0.4.2"  # listed case doesn't matter
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Companions (installed anthropic.claude-code, seanahn.perch-audio)", out)
        installs = [line.split()[-1] for line in self.logged("--install-extension")]
        self.assertEqual(installs, ["anthropic.claude-code", "seanahn.perch-audio"])

    def test_companion_failure_noted(self) -> None:
        env = self.env("ubuntu", ALL_PRESENT, CODE_EXTENSIONS=f"agenticworks.agentic-works@{VERSION}",
                       CODE_FAIL_ON="--install-extension openai.chatgpt")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Companions: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertTrue(failed[0].startswith("✗ Companions: openai.chatgpt "), failed)
        self.assertIn("; Agentic Works works, but Perch's tabs need Claude Code or ChatGPT", failed[0])
        installs = [line.split()[-1] for line in self.logged("--install-extension")]
        self.assertEqual(installs, list(COMPANIONS))  # the others still went in

        # perch-audio alone failing says nothing about agents.
        self.log.write_text("")
        rc, out = self.run_pipe({**env, "CODE_FAIL_ON": "--install-extension seanahn.perch-audio"})
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Companions: ")]
        self.assertTrue(failed[0].startswith("✗ Companions: seanahn.perch-audio "), failed)
        self.assertNotIn("ChatGPT", failed[0])

    def test_no_vscode_skips_both(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ("gh",)), "--skip", "vscode")
        self.assertIn("  – Agentic Works: VS Code isn't installed", out)
        self.assertIn("  – Companions: VS Code isn't installed", out)


class TestGitHub(_Installer):
    """ensure_github: gh for kestrel's PRs panel; never a sign-in (Agentic Works' walkthrough signs in)."""

    def test_gh_installed_when_missing(self) -> None:
        no_gh = tuple(name for name in ALL_PRESENT if name != "gh")
        cases = (
            ("ubuntu", ("https://cli.github.com/packages/githubcli-archive-keyring.gpg",
                        "/usr/share/keyrings/githubcli-archive-keyring.gpg",
                        "https://cli.github.com/packages stable main", "/etc/apt/sources.list.d/github-cli.list",
                        "apt-get install -y gh"), ("--dearmor",)),
            ("debian", ("https://cli.github.com/packages stable main", "apt-get install -y gh"), ()),
            ("rhel", ("dnf install -y dnf-command\\(config-manager\\)",
                      "dnf config-manager --add-repo https://cli.github.com/packages/rpm/gh-cli.repo",
                      "dnf install -y gh"), ("apt-get", "--repo")),  # --repo gh-cli would hide git, which gh needs
            ("fedora", ("dnf install -y gh",), ("config-manager", "apt-get")),
            ("macos", ("brew install gh",), ("apt-get", "dnf")),
        )
        for os_name, want, never in cases:
            with self.subTest(os=os_name):
                rc, out = self.run_pipe(self.env(os_name, no_gh), "--dry-run")
                self.assertEqual(rc, 0, out)
                lines = out.splitlines()
                github = _index(lines, "… GitHub")
                self.assertGreaterEqual(github, 0, out)
                indexes = [_index(lines[github:], text) for text in want]
                self.assertTrue(all(i >= 0 for i in indexes) and indexes == sorted(indexes), (want, out))
                for text in never:
                    self.assertNotIn(text, "\n".join(lines[github:]))
                self.assertNotIn("gh auth login", out)

        # For real: gh goes in, and is signed in already.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", no_gh))
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.logged("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y gh")), 1)
        self.assertIn("  ✓ GitHub (added GitHub's package repository, installed gh; signed in as octocat)", out)

        # With GitHub's repository a source already (or on Fedora, from its own): no "added".
        for os_name, source in (("ubuntu", True), ("fedora", False)):
            with self.subTest(os=os_name):
                if source:
                    (self.apt / "sources.list.d" / "github-cli.list").write_text(
                        "deb https://cli.github.com/packages stable main\n")
                rc, out = self.run_pipe(self.env(os_name, no_gh))
                self.assertEqual(rc, 0, out)
                self.assertIn("  ✓ GitHub (installed gh; signed in as octocat)", out)
        rc, out = self.run_pipe(self.env("rhel", no_gh))
        self.assertIn("  ✓ GitHub (added GitHub's package repository, installed gh; signed in as octocat)", out)

    def test_github_apt_source_already_there(self) -> None:
        (self.apt / "sources.list.d" / "github-cli.list").write_text(
            "deb [signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n")
        rc, out = self.run_pipe(self.env("ubuntu", tuple(n for n in ALL_PRESENT if n != "gh")), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertNotIn("githubcli-archive-keyring.gpg", out)
        self.assertIn("apt-get install -y gh", out)

    def test_gh_signed_in_no_question(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, AGENTIC_WORKS_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ GitHub (already)\n      signed in as octocat\n", out)
        self.assertNotIn("Sign in to GitHub", out)
        self.assertEqual(self.logged("gh auth login"), [])
        self.assertNotIn("credential helper", out)  # this run signed nothing in

    def test_gh_not_signed_in_no_question(self) -> None:
        """Not signed in: no question and no `gh auth login`, with a terminal or with --yes and none."""
        self.gh_auth.unlink()
        tty = self.tty("y", "y")
        no_tty = str(self.tmp / "no-tty")
        for args, env in (((), {"AGENTIC_WORKS_INSTALL_TTY": tty}), (("--yes",), {"AGENTIC_WORKS_INSTALL_TTY": no_tty})):
            with self.subTest(args=args):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, **env), *args)
                self.assertEqual(rc, 0, out)
                self.assertIn("  ✓ GitHub (already)\n"
                              "      sign in from Agentic Works' walkthrough in VS Code (Sign in to GitHub)\n", out)
                self.assertNotIn("[Y/n]", out.split("… GitHub")[-1])
                self.assertEqual(self.logged("gh auth login"), [])
                self.assertNotIn("credential helper", out)

        # gh installed by this run, not signed in: the line says what was installed, then where to sign in.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("fedora", tuple(n for n in ALL_PRESENT if n != "gh")))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ GitHub (installed gh)\n"
                      "      sign in from Agentic Works' walkthrough in VS Code (Sign in to GitHub)\n", out)
        self.assertEqual(self.logged("gh auth login"), [])


class TestClaudeCLI(_Installer):
    """ensure_claude: Anthropic's installer, downloaded and then run, puts claude in ~/.local/bin."""

    NO_CLAUDE = tuple(name for name in ALL_PRESENT if name != "claude")
    FAKE_INSTALL = 'mkdir -p "$HOME/.local/bin"; : > "$HOME/.local/bin/claude"'
    LOCAL_BIN = "/.local/bin"

    def profile(self) -> str:
        path = self.home / ".profile"
        return path.read_text() if path.exists() else ""

    def test_already_on_the_path(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Claude Code CLI (already)", out)
        self.assertEqual(self.logged("claude.ai"), [])
        marks = [mark.split(" (")[0] for mark in self.marks(out)]
        self.assertTrue(marks.index("✓ Companions") + 1 == marks.index("✓ Claude Code CLI") ==
                        marks.index("✓ git") - 1, out)

    def test_already_in_local_bin(self) -> None:
        claude = self.home / ".local" / "bin" / "claude"
        claude.parent.mkdir(parents=True)
        claude.write_text("#!/bin/sh\n")
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_CLAUDE))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Claude Code CLI (already)", out)
        self.assertEqual(self.logged("claude.ai"), [])
        self.assertIn(f"{self.home}{self.LOCAL_BIN}", self.profile())  # and new terminals find it

    def test_installed_through_a_downloaded_script(self) -> None:
        env = self.env("ubuntu", self.NO_CLAUDE, CURL_BODY=self.FAKE_INSTALL)
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Claude Code CLI (installed)", out)
        curl = self.logged("curl ")
        self.assertEqual(len(curl), 1, curl)
        self.assertRegex(curl[0], r"^curl -fsSL -o \S+ https://claude\.ai/install\.sh$")
        self.assertTrue((self.home / ".local" / "bin" / "claude").exists())
        self.assertEqual(self.logged("sudo"), [], "needs no sudo")
        text = self.profile()
        self.assertEqual(text.count("# added by agentic-works-install"), 1, text)
        self.assertIn(f'export PATH="{self.home}{self.LOCAL_BIN}:$PATH"', text)
        self.assertEqual([p.name for p in self.tmp.iterdir() if "claude" in p.name], [], "temp file removed")

        # A login shell reading the block finds claude.
        check = subprocess.run([shutil.which("bash"), "-c", f'PATH=/usr/bin:/bin; . "{self.home}/.profile"; '
                                'command -v claude'], capture_output=True, timeout=30, check=False)
        self.assertEqual(check.stdout.decode().strip(), str(self.home / ".local/bin/claude"), check)

        # A rerun: already, and the profile is left alone.
        rc, out = self.run_pipe(env)
        self.assertIn("  ✓ Claude Code CLI (already)", out)
        self.assertEqual(self.profile(), text)

    def test_installer_url_seam(self) -> None:
        env = self.env("ubuntu", self.NO_CLAUDE, CURL_BODY=self.FAKE_INSTALL,
                       AGENTIC_WORKS_INSTALL_CLAUDE_INSTALLER="http://127.0.0.1:9/install.sh")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.logged("http://127.0.0.1:9/install.sh")), 1)
        self.assertEqual(self.logged("claude.ai"), [])

    def test_failure_is_reported(self) -> None:
        for name, extra in (("the script makes no claude", {"CURL_BODY": "exit 0"}),
                            ("the script fails", {"CURL_BODY": "exit 3"}),
                            ("the download fails", {"CURL_FAIL_ON": "claude.ai"})):
            with self.subTest(name):
                rc, out = self.run_pipe(self.env("ubuntu", self.NO_CLAUDE, **extra))
                self.assertEqual(rc, 1, out)
                self.assertRegex(out, r"  ✗ Claude Code CLI: couldn't be installed; see \S+agentic-works-install-log")
                self.assertNotIn(f"{self.home}{self.LOCAL_BIN}", self.profile())
                self.assertEqual([p.name for p in self.tmp.iterdir() if "claude" in p.name], [])

    def test_dry_run_prints_the_commands(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_CLAUDE), "--dry-run")
        self.assertEqual(rc, 0, out)
        lines = out.splitlines()
        download = _index(lines, "curl -fsSL -o ")
        claude = _index(lines[download + 1:], "bash ")
        self.assertTrue(any("https://claude.ai/install.sh" in line for line in lines), out)
        self.assertGreaterEqual(claude, 0, out)
        self.assertIn("  ✓ Claude Code CLI (dry run)", out)
        self.assertEqual([line for line in self.stub_log() if line.startswith(("curl", "sudo"))], [])
        self.assertFalse((self.home / ".local").exists())

    def test_skip_claude(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_CLAUDE), "--skip", "claude")
        self.assertEqual(rc, 0, out)
        self.assertIn("  – Claude Code CLI: skipped (--skip claude)", out)
        self.assertEqual(self.logged("claude.ai"), [])

    def test_local_bin_already_on_the_path_adds_nothing(self) -> None:
        bin_dir = self.home / ".local" / "bin"
        env = self.env("ubuntu", self.NO_CLAUDE, CURL_BODY=self.FAKE_INSTALL)
        rc, out = self.run_sourced(env, f'ORIG_PATH="{bin_dir}:$ORIG_PATH"; main')
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Claude Code CLI (installed)", out)
        self.assertNotIn(self.LOCAL_BIN, self.profile())

    def test_local_bin_goes_inside_the_existing_block(self) -> None:
        (self.home / ".profile").write_text("# mine\n\n# added by agentic-works-install\n"
                                            'export PATH="/opt/code/bin:$PATH"\n# end agentic-works-install\n# after\n')
        env = self.env("ubuntu", self.NO_CLAUDE, CURL_BODY=self.FAKE_INSTALL)
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        lines = self.profile().splitlines()
        self.assertEqual(lines.count("# added by agentic-works-install"), 1, lines)
        self.assertEqual(lines.count("# end agentic-works-install"), 1, lines)
        local = next(i for i, line in enumerate(lines) if self.LOCAL_BIN in line)
        self.assertTrue(lines.index("# added by agentic-works-install") < local < lines.index("# end agentic-works-install"), lines)
        self.assertEqual(lines[-1], "# after")

    def test_stopped_at_the_standalone_four_skips_it(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_CLAUDE, CODE_EXTENSIONS="seanahn.chirp@0.3.0",
                                         AGENTIC_WORKS_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 1, out)
        self.assertNotIn("Claude Code CLI", out)
        self.assertEqual(self.logged("claude.ai"), [])


class TestGit(_Installer):
    """ensure_git (step 4a): `git --version` has to run; and Homebrew's shellenv for a Homebrew-installed tool."""

    NO_GIT = tuple(name for name in ALL_PRESENT if name != "git")

    def git_stubs(self, env: dict[str, str], clt: bool = True) -> None:
        """xcode-select: --install creates $CLT_FILE (unless the CLT_NEVER env is set); -p succeeds once it exists."""
        (Path(env["PATH"].split(":")[0]) / "xcode-select").write_text(
            '#!/bin/sh\nprintf \'%s\\n\' "xcode-select $*" >> "$STUB_LOG"\n'
            'case "$1" in --install) [ -n "${CLT_NEVER:-}" ] || : > "$CLT_FILE" ;; -p) [ -f "$CLT_FILE" ]; exit $? ;; esac\n')

    def test_git_present_already(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT))
        self.assertEqual(rc, 0, out)
        marks = [mark.split(" (")[0] for mark in self.marks(out)]
        self.assertEqual(marks[marks.index("✓ Companions") + 1:marks.index("✓ GitHub")],
                         ["✓ Claude Code CLI", "✓ git"], out)
        self.assertIn("  ✓ git (already)", out)
        self.assertEqual(self.logged("install -y git"), [])
        self.assertIn("git --version", self.stub_log())

    def test_git_missing_linux_installs_package(self) -> None:
        for os_name, pm in (("ubuntu", "apt-get"), ("rhel", "dnf"), ("debian", "apt-get"), ("fedora", "dnf")):
            with self.subTest(os=os_name):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env(os_name, self.NO_GIT))
                self.assertEqual(rc, 0, out)
                if pm == "apt-get":  # updated first, and never asking: as the other apt installs are
                    self.assertEqual(self.logged("apt-get"), ["sudo apt-get update",
                                     "sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y git"], out)
                else:
                    self.assertEqual(self.logged(f"sudo {pm} install -y git"), [f"sudo {pm} install -y git"], out)
                self.assertIn("  ✓ git (installed)", out)
                self.assertIn("  - git\n", out)  # the up-front list of what this run adds system-wide

    def test_git_install_failure(self) -> None:
        env = self.env("ubuntu", self.NO_GIT)
        (Path(env["PATH"].split(":")[0]) / "sudo").write_text("#!/bin/sh\nexit 1\n")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        self.assertRegex(out, r"  ✗ git: couldn't be installed; see \S+agentic-works-install-log")

    def test_broken_git_is_installed_over(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, GIT_BROKEN="1"))
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.logged("apt-get install -y git")), 1, out)

    def test_dry_run_prints_the_install(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_GIT), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn("apt-get install -y git", out)
        self.assertIn("  ✓ git (dry run)", out)

    def test_macos_apple_git_without_clt_is_not_run(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT, AGENTIC_WORKS_INSTALL_GIT="/usr/bin/git", XCODE_SELECT_FAIL="1"),
                                "--skip", "settings", "--skip", "icons")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.logged("brew install git"), [f"brew install git"])
        self.assertEqual(self.logged("git --version"), [], "the shim would open Apple's dialog")
        self.assertIn("  ✓ git (installed)", out)

    def test_macos_apple_git_with_clt_is_run(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT, AGENTIC_WORKS_INSTALL_GIT="/usr/bin/git"))
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.logged("brew install git"), [])
        self.assertIn("  ✓ git (already)", out)

    def test_macos_git_without_brew_waits_for_clt(self) -> None:
        no_brew = tuple(name for name in self.NO_GIT if name != "brew")
        clt = self.tmp / "clt"
        env = self.env("macos", no_brew, AGENTIC_WORKS_INSTALL_CLT_WAIT="3", CLT_FILE=str(clt))
        self.git_stubs(env)
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.logged("xcode-select --install"), ["xcode-select --install"])
        self.assertIn("  ✓ git (installed)", out)

        # Apple's dialog never finishes: the wait ends, and says what to do.
        clt.unlink()
        env = self.env("macos", no_brew, AGENTIC_WORKS_INSTALL_CLT_WAIT="2", CLT_FILE=str(clt), CLT_NEVER="1")
        self.git_stubs(env)
        started = time.time()
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        self.assertLess(time.time() - started, 20)
        self.assertIn("  ✗ git: finish the Command Line Tools install Apple opened, then run git --version", out)

    def test_macos_git_with_clt_and_no_brew_is_already(self) -> None:
        no_brew = tuple(name for name in ALL_PRESENT if name != "brew")
        rc, out = self.run_pipe(self.env("macos", no_brew))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ git (already)", out)

    def test_brew_shellenv_when_gh_came_from_brew(self) -> None:
        stubs = tuple(name for name in ALL_PRESENT if name not in ("brew", "gh"))
        env = self.env("macos", stubs, SHELL="/bin/zsh")
        brew_dir = self.tmp / "brewbin"
        _write_stubs(brew_dir, ("brew",))
        env["PATH"] = f"{brew_dir}:{env['PATH']}"
        rc, out = self.run_sourced(env, 'ORIG_PATH=/usr/bin:/bin; main')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.logged("brew install gh"), ["brew install gh"])
        self.assertIn("  ✓ Homebrew on the PATH (.zprofile)", out)
        text = (self.home / ".zprofile").read_text()
        self.assertTrue(text.endswith(f'# added by agentic-works-install: Homebrew\n[ -x {brew_dir}/brew ] && '
                                      f'eval "$({brew_dir}/brew shellenv)"\n# end agentic-works-install\n'), text)

    def test_brew_shellenv_once(self) -> None:
        stubs = tuple(name for name in ALL_PRESENT if name not in ("brew", "gh"))
        env = self.env("macos", stubs, SHELL="/bin/zsh")
        brew_dir = self.tmp / "brewbin"
        _write_stubs(brew_dir, ("brew",))
        env["PATH"] = f"{brew_dir}:{env['PATH']}"
        for _ in (1, 2):
            rc, out = self.run_sourced(env, 'ORIG_PATH=/usr/bin:/bin; main')
            self.assertEqual(rc, 0, out)
        self.assertEqual((self.home / ".zprofile").read_text().count("brew shellenv"), 1)
        self.assertIn("  ✓ Homebrew on the PATH (already)", out)

    def test_brew_resolved_tool_gets_shellenv(self) -> None:
        """Homebrew wasn't used this run, but git resolves inside its bin directory: new terminals need the line."""
        env = self.env("macos", tuple(name for name in ALL_PRESENT if name not in ("brew", "git")), SHELL="/bin/zsh")
        brew_dir = self.tmp / "brewbin"
        _write_stubs(brew_dir, ("brew", "git"))
        env["PATH"] = f"{brew_dir}:{env['PATH']}"
        rc, out = self.run_sourced(env, 'ORIG_PATH=/usr/bin:/bin; main')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.logged("brew install"), [])
        self.assertIn("brew shellenv", (self.home / ".zprofile").read_text())

    def test_no_homebrew_line_without_homebrew(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT))
        self.assertNotIn("Homebrew on the PATH", out)
        rc, out = self.run_sourced(self.env("macos", tuple(name for name in ALL_PRESENT if name != "brew")),
                                   'ORIG_PATH=/usr/bin:/bin; main')
        self.assertNotIn("Homebrew on the PATH", out)

    def test_skip_git_and_homebrew(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_GIT), "--skip", "git", "--skip", "homebrew")
        self.assertEqual(rc, 0, out)
        self.assertIn("  – git: skipped (--skip git)", out)
        self.assertEqual(self.logged("install -y git"), [])
        rc, out = self.run_sourced(self.env("macos", ALL_PRESENT), 'ORIG_PATH=/usr/bin:/bin; main --skip homebrew')
        self.assertIn("  – Homebrew on the PATH: skipped (--skip homebrew)", out)

    def test_stopped_at_the_standalone_four_skips_git(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", self.NO_GIT, CODE_EXTENSIONS="seanahn.chirp@0.3.0",
                                         AGENTIC_WORKS_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 1, out)
        self.assertNotIn("git", "\n".join(self.marks(out)))
        self.assertEqual(self.logged("install -y git"), [])


class TestLook(_Installer):
    """apply_settings and apply_icons through the helper, then open_vscode."""

    def python3_calls(self) -> list[str]:
        return [line for line in self.stub_log() if line.startswith("python3 ")]

    def test_settings_and_icons_applied(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT))
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.python3_calls(), [f"python3 {HELPER} vscode-settings",
                                                f"python3 {HELPER} vscode-layout"])
        self.assertIn("  ✓ Settings (added to settings.json)", out)
        self.assertIn("  ✓ Icons (activity bar and editor title bar trimmed)", out)
        lines = out.splitlines()
        self.assertTrue(_index(lines, "✓ GitHub") < _index(lines, "✓ Settings") < _index(lines, "✓ Icons"), out)

        # Exit 2: skipped, the helper's reason as the detail; exit 1: failed.
        self.log.write_text("")
        env = self.env("ubuntu", ALL_PRESENT, PY_LAYOUT_RC="2",
                       PY_LAYOUT_OUT="VS Code is running: quit VS Code and rerun.", PY_SETTINGS_RC="1")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        self.assertIn("  – Icons: VS Code is running: quit VS Code and rerun\n", out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Settings: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("see ", failed[0])
        self.log.write_text("")
        rc, out = self.run_pipe({**env, "PY_SETTINGS_RC": "3", "PY_SETTINGS_OUT": "half a thought"})
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ Settings: couldn't write VS Code's settings; see ", out)
        self.assertNotIn("half a thought", out)

        # --dry-run prints the helper's commands and runs neither.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.python3_calls(), [])
        self.assertIn(f"$ python3 {HELPER} vscode-settings", out)
        self.assertIn(f"$ python3 {HELPER} vscode-layout", out)
        self.assertIn("  ✓ Settings (dry run)", out)
        self.assertIn("  ✓ Icons (dry run)", out)

    def test_codebase_search_flag(self) -> None:
        """Off unless --codebase-search (Agentic Works' walkthrough offers it); never asked; --no-codebase-search still accepted."""
        question = "Turn on codebase search"
        hint = "to search by meaning too, run Agents: Install Codebase Search by Meaning"
        for label, args, on in [
            ("default", (), False),
            ("--codebase-search", ("--codebase-search",), True),
            ("--no-codebase-search (0.2.0-0.3.3)", ("--no-codebase-search",), False),
        ]:
            with self.subTest(label):
                self.log.write_text("")
                env = self.env("ubuntu", ALL_PRESENT, AGENTIC_WORKS_INSTALL_TTY=self.tty("y"),
                               PY_SETTINGS_OUT="codebase search added" if on else "")
                rc, out = self.run_pipe(env, *args)
                self.assertEqual(rc, 0, out)
                want = f"python3 {HELPER} vscode-settings" + (" --codebase-search" if on else "")
                self.assertEqual(self.python3_calls()[0], want, out)
                self.assertNotIn(question, out)
                self.assertEqual(hint in out, on, out)

    def test_teams_app_reaches_the_settings_step(self) -> None:
        """--teams-app goes to the helper as given; without it, no --teams-app."""
        app = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d:contoso.onmicrosoft.com"
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT), "--teams-app", app, "--no-codebase-search")
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.python3_calls()[0], f"python3 {HELPER} vscode-settings --teams-app {app}")
        self.assertIn("  ✓ Settings (added to settings.json)", out)
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT), "--teams-app", app, "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"$ python3 {HELPER} vscode-settings --teams-app {app}", out)
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, AGENTIC_WORKS_INSTALL_TTY=str(self.tmp / "no-tty")))
        self.assertEqual(rc, 0, out)
        self.assertNotIn("--teams-app", self.python3_calls()[0])

    def test_helper_found_beside_the_script(self) -> None:
        """Without AGENTIC_WORKS_INSTALL_HELPER, the helper next to the script is used, as in a clone."""
        env = self.env("ubuntu", ALL_PRESENT)
        del env["AGENTIC_WORKS_INSTALL_HELPER"]
        rc, out = self.run_pipe(env, script=SCRIPT)  # unstamped: Agentic Works fails, the rest goes on
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.python3_calls()[0], f"python3 {HELPER} vscode-settings")
        self.assertIn("  ✓ Settings (added to settings.json)", out)

        self.log.write_text("")
        rc, out = self.run_pipe(env)  # the stamped copy has no helper beside it
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.python3_calls(), [])
        self.assertIn("  ✗ Settings: ", out)

    def test_used_vscode_keeps_settings(self) -> None:
        """The real helper: a used VS Code's own keys and its icon layout stay as they are."""
        user = self.home / ".config" / "Code" / "User"
        user.mkdir(parents=True)
        settings = user / "settings.json"
        settings.write_text(json.dumps({"editor.fontSize": 15, "workbench.startupEditor": "welcomePage"}))
        (user / "globalStorage").mkdir()
        con = sqlite3.connect(user / "globalStorage" / "state.vscdb")
        con.execute("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)")
        con.execute("INSERT INTO ItemTable VALUES ('workbench.activity.pinnedViewlets2', '[]')")
        con.commit()
        con.close()
        stubs = tuple(name for name in ALL_PRESENT if name != "python3")
        env = self.env("ubuntu", stubs, real=("python3",))
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        data = json.loads(settings.read_text())
        self.assertEqual(data["editor.fontSize"], 15)
        self.assertEqual(data["workbench.startupEditor"], "welcomePage")
        self.assertIs(data["chat.disableAIFeatures"], True)
        self.assertEqual(data["workbench.activityBar.location"], "top")
        self.assertIn("  ✓ Settings (added to settings.json)", out)
        self.assertIn("  – Icons: VS Code already has an icon layout; leaving it as it is\n", out)
        self.assertIn("right-click", out)  # how to hide one by hand

        # A second run: nothing to add.
        rc, out = self.run_pipe(env)
        self.assertIn("  ✓ Settings (already)", out)

        # A settings file with comments: not rewritten; the lines to add are printed under the step.
        text = '{\n  // mine\n  "editor.fontSize": 15\n}\n'
        settings.write_text(text)
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        self.assertEqual(settings.read_text(), text)
        lines = out.splitlines()
        skipped = _index(lines, "  – Settings: ")
        self.assertGreaterEqual(skipped, 0, out)
        self.assertIn("Add these lines yourself", lines[skipped])
        under = [line.strip() for line in lines[skipped + 1:skipped + 5] if line.startswith("      ")]
        self.assertIn('"chat.disableAIFeatures": true,', under, out)

    def test_no_python3_skips_settings_and_icons(self) -> None:
        """macOS's /usr/bin/python3 without the Command Line Tools would open Apple's install dialog: not run.
        Any other python3 (Homebrew's) runs without them."""
        # The shim, no Command Line Tools: both skipped, the shim never run. AGENTIC_WORKS_INSTALL_PYTHON3 stands in for
        # what `command -v python3` finds, since a stub can't live at /usr/bin.
        env = self.env("macos", ALL_PRESENT, XCODE_SELECT_FAIL="1", AGENTIC_WORKS_INSTALL_PYTHON3="/usr/bin/python3")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.python3_calls(), [], self.stub_log())
        self.assertEqual(self.logged("xcode-select -p"), ["xcode-select -p"] * 2)
        for label in ("Settings", "Icons"):
            skipped = [mark for mark in self.marks(out) if mark.startswith(f"– {label}: ")]
            self.assertEqual(len(skipped), 1, out)
            self.assertTrue(skipped[0].startswith(f"– {label}: python3 is not installed; "), skipped)
            self.assertIn("xcode-select --install", skipped[0])
            self.assertIn("brew install python", skipped[0])

        # Homebrew's python3 (anywhere but /usr/bin): runs, the Command Line Tools not asked about.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT, XCODE_SELECT_FAIL="1"))
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.python3_calls()), 2, self.stub_log())
        self.assertEqual(self.logged("xcode-select"), [])
        self.assertIn("  ✓ Settings (added to settings.json)", out)

        # No python3 at all on a Mac: how to get one.
        self.log.write_text("")
        stubs = tuple(name for name in ALL_PRESENT if name != "python3")
        rc, out = self.run_pipe(self.env("macos", stubs))
        self.assertEqual(rc, 0, out)
        self.assertIn("  – Settings: python3 is not installed; install it (Homebrew: brew install python), "
                      "then run the installer again\n", out)
        self.assertIn("  – Icons: python3 is not installed; ", out)

        # No python3 at all, on Linux.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("fedora", stubs))
        self.assertEqual(rc, 0, out)
        self.assertIn("  – Settings: python3 is not installed; install it, then run the installer again\n", out)
        self.assertIn("  – Icons: python3 is not installed; ", out)

        # RHEL 8 without python3: its system platform-python (3.6) runs the helper.
        self.log.write_text("")
        platform_python = self.tmp / "platform-python"
        platform_python.write_text('#!/bin/sh\nprintf \'platform-python %s\\n\' "$*" >> "$STUB_LOG"\n')
        platform_python.chmod(0o755)
        for os_name, used in (("rhel", True), ("fedora", False)):
            with self.subTest(os=os_name):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env(os_name, stubs, AGENTIC_WORKS_INSTALL_PLATFORM_PYTHON=str(platform_python)))
                self.assertEqual(rc, 0, out)
                if used:
                    self.assertEqual(len(self.logged("platform-python ")), 2, self.stub_log())
                    self.assertIn("  ✓ Settings (added to settings.json)", out)
                    self.assertIn("  ✓ Icons (activity bar and editor title bar trimmed)", out)
                else:
                    self.assertEqual(self.logged("platform-python "), [])
                    self.assertIn("  – Settings: python3 is not installed; ", out)

        # The shim with the Command Line Tools there (xcode-select -p succeeds): it is a real python3, and used.
        # Probed through python_ok alone, since the seam's /usr/bin/python3 is this machine's own, not a stub.
        self.log.write_text("")
        env = self.env("macos", ALL_PRESENT, AGENTIC_WORKS_INSTALL_PYTHON3="/usr/bin/python3")
        rc, out = self.run_sourced(env, 'OS=macos; python_ok && echo "ok $PYTHON"')
        self.assertEqual(out.strip(), "ok /usr/bin/python3", out)
        self.assertEqual(self.logged("xcode-select"), ["xcode-select -p"])

    def test_update_opens_nothing(self) -> None:
        # Agentic Works already there: an update or a repair; VS Code, if open, keeps its windows (2026-11-27)
        for args in ((), ("--dry-run",)):
            with self.subTest(args=args):
                self.log.write_text("")
                rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT), *args)
                self.assertEqual(rc, 0, out)
                self.assertEqual(self.opens(), [])
                self.assertNotIn("Opening VS Code", out)
                self.assertNotIn("Would open VS Code", out)

    def test_root_does_not_open(self) -> None:
        rc, out = self.run_sourced(self.env("ubuntu", ALL_PRESENT), 'id() { echo 0; }; main')
        self.assertEqual(rc, 0, out)
        self.assertEqual(self.opens(), [])
        self.assertIn(f"--user-data-dir {self.home}/.config/Code", out)  # how to start it
        self.assertIn("--no-sandbox", out)
        # The helper edits the user data dir the code calls use.
        self.assertEqual(self.logged("user-dir "), [f"user-dir {self.home}/.config/Code/User"] * 2)

    def test_rerun_is_all_already(self) -> None:
        env = self.env("ubuntu", ALL_PRESENT, PY_SETTINGS_OUT="already set", PY_LAYOUT_OUT="already set")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 0, out)
        marks = [mark for mark in self.marks(out) if not mark.startswith("✓ Platform ")]
        self.assertEqual(len(marks), 9, out)
        for mark in marks:
            self.assertTrue(mark.startswith("✓ ") and mark.endswith(" (already)"), mark)
        self.assertRegex(out, r"\nDone: 10 ✓  0 –  0 ✗\n")


if __name__ == "__main__":
    unittest.main()
