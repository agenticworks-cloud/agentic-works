"""Tests for installer/roost-install.sh: the platform, VS Code, `code` on the PATH, the standalone four, Roost,
its companions and GitHub.

Each test runs the script in a subprocess with HOME in a temp dir and a PATH of only stubs (brew, apt-get, dnf,
sudo, code, curl, gh, ... each logging its argv to $STUB_LOG) plus the handful of system tools the script needs, so
"is it installed" is whatever the test puts on PATH. ROOST_INSTALL_FAKE_OS picks the platform. The script run is a
copy stamped with a test version and SHA-256, as `make release` stamps it. The `.vsix` downloads go to a local
HTTP server, with the real curl. One case runs under bash 3.2, the bash macOS ships, in the bash:3.2 container
(skipped without Docker). No network.
"""

from __future__ import annotations

import functools
import hashlib
import http.server
import re
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "roost-install.sh"
IMAGE = "bash:3.2"
DOWNLOAD = "https://code.visualstudio.com/download"

# The system tools the script may use; everything else on PATH is a stub.
SYSTEM = ("bash", "sh", "dirname", "uname", "mkdir", "chmod", "mv", "rm", "mktemp", "cat", "tr", "grep", "env",
          "id", "sha256sum", "shasum")
ALL_PRESENT = ("brew", "curl", "gpg", "code", "sudo", "apt-get", "dnf", "rpm", "gh")

VERSION = "1.2.3"  # what the test copy of the script is stamped with
VSIX = b"PK roost 1.2.3, as released"
SHA = hashlib.sha256(VSIX).hexdigest()
COMPANIONS = ("anthropic.claude-code", "openai.chatgpt", "seanahn.perch-audio")
INSTALLED = f"seanahn.roost@{VERSION} anthropic.claude-code@2.0.1 openai.chatgpt@0.4.2 seanahn.perch-audio@0.1.0"

STUB = """#!/bin/sh
printf '%s\\n' "{name} $*" >> "$STUB_LOG"
{extra}exit 0
"""
# curl and gpg write something to their -o file, as the real ones do, so a downloaded key isn't empty.
WRITE_O = ('out="" prev=""; for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done; '
           '[ -z "$out" ] || echo "${CURL_BODY:-stub}" > "$out"\n')
# code lists $CODE_EXTENSIONS (id@version words), notes when a .vsix it is given exists, and fails on $CODE_FAIL_ON.
CODE = r"""case " $* " in
  *" --list-extensions "*)
    for e in ${CODE_EXTENSIONS:-}; do
      case " $* " in *" --show-versions "*) echo "$e" ;; *) echo "${e%%@*}" ;; esac
    done
    exit 0 ;;
esac
for a in "$@"; do case $a in *.vsix) [ -f "$a" ] && printf 'vsix-present %s\n' "$a" >> "$STUB_LOG" ;; esac; done
[ -n "${CODE_FAIL_ON:-}" ] && case "$*" in *"$CODE_FAIL_ON"*) exit 1 ;; esac
"""
# sudo and brew "install gh" put a gh stub on PATH, as the real install would.
GH_INSTALL = ('case " $* " in *" install "*" gh "*) [ -z "${GH_STUB_SRC:-}" ] || '
              '{ cat "$GH_STUB_SRC" > "${0%/*}/gh"; chmod 755 "${0%/*}/gh"; } ;; esac\n')
STUB_EXTRA = {
    "curl": '[ -n "${CURL_FAIL_ON:-}" ] && case "$*" in *"$CURL_FAIL_ON"*) exit 22 ;; esac\n' + WRITE_O,
    "gpg": WRITE_O,
    "code": CODE,
    "sudo": GH_INSTALL,
    "brew": GH_INSTALL,
}
# gh: signed in while $GH_AUTH_FILE exists; `gh auth login` creates it, logging the line it reads from stdin.
GH = r"""#!/bin/sh
printf '%s\n' "gh $*" >> "$STUB_LOG"
case "$1 $2" in
  "auth status") [ -f "$GH_AUTH_FILE" ]; exit $? ;;
  "auth login")
    line=""; read -r line; printf 'gh-stdin %s\n' "$line" >> "$STUB_LOG"
    [ -n "${GH_LOGIN_FAIL:-}" ] && exit 1
    : > "$GH_AUTH_FILE"; exit 0 ;;
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
    dest.write_text(SCRIPT.read_text().replace("@ROOST_VERSION@", version).replace("@ROOST_SHA256@", sha))
    return dest


def _why_not() -> str:
    """'' when the bash 3.2 container can run here, else why not."""
    if not shutil.which("docker"):
        return "docker is not installed"
    if subprocess.run(["docker", "info"], capture_output=True, timeout=60, check=False).returncode:
        return "the docker daemon is not reachable"
    if subprocess.run(["docker", "image", "inspect", IMAGE], capture_output=True, timeout=60, check=False).returncode:
        if subprocess.run(["docker", "pull", "-q", IMAGE], capture_output=True, timeout=300, check=False).returncode:
            return f"{IMAGE} can't be pulled"
    return ""


def _index(lines: list[str], needle: str) -> int:
    """The index of the first line containing needle, or -1."""
    return next((i for i, line in enumerate(lines) if needle in line), -1)


class _Installer(unittest.TestCase):
    """A temp HOME, a stubs dir and a system-tools dir per test."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="roost-install-test-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        self.home = self.tmp / "home"
        self.home.mkdir()
        self.log = self.tmp / "stub.log"
        self.log.touch()
        self.script = stamp(self.tmp / "dist" / "roost-install.sh")
        self.gh_auth = self.tmp / "gh-auth"  # signed in to GitHub while this exists
        self.gh_auth.touch()
        (self.tmp / "gh-stub").write_text(GH)
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
            "ROOST_INSTALL_FAKE_OS": os_name,
            "ROOST_INSTALL_FAKE_ARCH": "x86_64",
            "ROOST_INSTALL_TTY": "/dev/null",
            "ROOST_INSTALL_APT_DIR": str(self.apt),
            "ROOST_INSTALL_VSIX_URL": "http://127.0.0.1:9/nothing-listens-here.vsix",
            "CODE_EXTENSIONS": INSTALLED,
            "GH_AUTH_FILE": str(self.gh_auth),
            "GH_STUB_SRC": str(self.tmp / "gh-stub"),
            "TMPDIR": str(self.tmp),
            "SHELL": "/bin/bash",
            "TERM": "xterm",
        }
        env.update(extra)
        return env

    def tty(self, *answers: str) -> str:
        """A file of answers, one per line, for ROOST_INSTALL_TTY."""
        path = self.tmp / "tty"
        path.write_text("".join(f"{answer}\n" for answer in answers))
        return str(path)

    def run_pipe(self, env: dict[str, str], *args: str, script: Path | None = None) -> tuple[int, str]:
        result = subprocess.run([shutil.which("bash"), str(script or self.script), *args], env=env,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=False)
        return result.returncode, (result.stdout + result.stderr).decode()

    def run_sourced(self, env: dict[str, str], probe: str, *args: str) -> tuple[int, str]:
        """Source the script (ROOST_INSTALL_NO_MAIN=1), then run probe, a bash snippet; $1.. are args."""
        env = {**env, "ROOST_INSTALL_NO_MAIN": "1"}
        result = subprocess.run([shutil.which("bash"), "-c", f'. "$0"; {probe}', str(self.script), *args], env=env,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=False)
        return result.returncode, (result.stdout + result.stderr).decode()

    def stub_log(self) -> list[str]:
        return self.log.read_text().splitlines()

    def logged(self, needle: str) -> list[str]:
        """The stub log lines containing needle."""
        return [line for line in self.stub_log() if needle in line]

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
                rc, out = self.run_pipe(self.env(os_name, ("sudo", "apt-get")), "--dry-run")
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
                            or line.startswith("sudo ")]
                self.assertEqual(installs, [], out)

    def test_mac_without_admin(self) -> None:
        """Homebrew can't be installed: VS Code is ✗ with the download page, the run goes on, exit 1."""
        env = self.env("macos", ("curl", "sudo"), CURL_FAIL_ON="Homebrew")
        rc, out = self.run_pipe(env, "--skip", "github")
        self.assertEqual(rc, 1, out)
        failed = [line for line in out.splitlines() if line.startswith("  ✗ VS Code: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn(DOWNLOAD, failed[0])
        self.assertNotIn("brew install", "\n".join(self.stub_log()))
        lines = out.splitlines()
        self.assertGreater(_index(lines, "code on the PATH"), _index(lines, "  ✗ VS Code: "), out)  # went on
        self.assertRegex(out, r"\nDone: \d+ ✓  \d+ –  1 ✗\n")
        self.assertIn("Details of what failed: ", out)

    def test_homebrew_script_failure(self) -> None:
        """The downloaded Homebrew installer exits 1: the line says so and points at the log, not at admin rights."""
        env = self.env("macos", ("curl", "sudo"), CURL_BODY="exit 1")
        rc, out = self.run_pipe(env, "--skip", "github")
        self.assertEqual(rc, 1, out)
        failed = [line for line in out.splitlines() if line.startswith("  ✗ VS Code: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("Homebrew couldn't be installed", failed[0])
        self.assertIn(f"see {self.tmp}/roost-install-log.", failed[0])
        self.assertIn(DOWNLOAD, failed[0])
        self.assertNotIn("administrator", failed[0])

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

    def test_platform_line(self) -> None:
        rc, out = self.run_pipe(self.env("fedora", ALL_PRESENT, ROOST_INSTALL_FAKE_ARCH="aarch64"))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Platform (fedora, arm64)", out)


class TestPath(_Installer):
    """ensure_path: one marked block in the login profile, only when `code` isn't on the PATH already."""

    PROBE = 'MAC_CODE=$1; main --skip vscode --skip roost --skip companions --skip github'

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
        self.assertEqual(text.count("# added by roost-install"), 1, text)
        self.assertEqual(text.count("# end roost-install"), 1, text)
        self.assertIn(str(code.parent), text)
        self.assertFalse((self.home / ".profile").exists())

        # The block works: a login shell reading it finds `code`.
        check = subprocess.run([shutil.which("bash"), "-c", f'PATH=/usr/bin:/bin; . "{self.home}/.zprofile"; '
                                'command -v code'], capture_output=True, timeout=30, check=False)
        self.assertEqual(check.stdout.decode().strip(), str(code), check)

    def test_homebrew_code_gets_brew_shellenv(self) -> None:
        env = self.env("macos", ("brew", "code"), SHELL="/bin/zsh")
        rc, out = self.run_sourced(env, 'ORIG_PATH=/usr/bin:/bin; main --skip vscode --skip github')
        self.assertEqual(rc, 0, out)
        text = (self.home / ".zprofile").read_text()
        self.assertIn(f'eval "$({self.tmp}/stubs/brew shellenv)"', text)

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
        self.assertIn("# added by roost-install", (self.home / ".bash_profile").read_text())
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
                         ["✓ Platform", "✓ VS Code", "✓ code on the PATH", "✓ Roost", "✓ Companions", "✓ GitHub"], out)
        self.assertRegex(out, r"\nDone: 6 ✓  0 –  0 ✗\n")

    def test_skip_marks_the_step(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get")), "--skip", "vscode", "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn("  – VS Code: skipped (--skip vscode)", out)
        self.assertNotIn("apt-get install -y code", out)

    def test_every_step_name_and_flag_is_accepted(self) -> None:
        names = "vscode path standalone roost companions github settings icons open".split()
        skips = tuple(arg for name in names for arg in ("--skip", name))
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT), "--yes", "--no-open", *skips)
        self.assertEqual(rc, 0, out)

    def test_unknown_skip_name_is_refused(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT), "--skip", "nonsense")
        self.assertEqual(rc, 2, out)
        self.assertIn("nonsense", out)

    def test_help(self) -> None:
        rc, out = self.run_pipe(self.env("macos", ALL_PRESENT), "--help")
        self.assertEqual(rc, 0, out)
        for text in ("--dry-run", "--skip", "--yes", "--no-open",
                     "vscode path standalone roost companions github settings icons open"):
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
        _write_stubs(stubs, ("sudo", "apt-get"))
        cmd = ["docker", "run", "--rm", "-i", "-v", f"{self.script.parent}:/s:ro", "-v", f"{stubs}:/stubs:ro"]
        for name, value in {
            "HOME": "/tmp/h",
            "PATH": "/stubs:/usr/local/bin:/usr/bin:/bin",
            "STUB_LOG": "/tmp/stub.log",
            "ROOST_INSTALL_FAKE_OS": "ubuntu",
        }.items():
            cmd += ["-e", f"{name}={value}"]
        script = 'mkdir -p /tmp/h; echo "bash=$BASH_VERSION"; bash /s/roost-install.sh --dry-run; echo "rc=$?"'
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
        self.assertRegex(out, r"\nDone: 6 ✓  0 –  0 ✗\n")


class _Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args: object) -> None:  # keep the test output clean
        pass


class _Served(_Installer):
    """A local HTTP server for the .vsix downloads: good.vsix (matches SHA), bad.vsix (doesn't); others 404."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.served = Path(tempfile.mkdtemp(prefix="roost-install-served-"))
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

    STUBS = ("code", "sudo", "gh")

    def served_env(self, path: str = "good.vsix", **extra: str) -> dict[str, str]:
        """ubuntu, VS Code and gh in place, the real curl, the .vsix from the local server."""
        return self.env("ubuntu", self.STUBS, real=("curl",), ROOST_INSTALL_VSIX_URL=f"{self.url}/{path}", **extra)

    def vsix_installs(self) -> list[str]:
        return [line for line in self.logged("--install-extension") if line.endswith(".vsix")]


class TestStandalone(_Served):
    """check_standalone: the four standalone extensions go before Roost comes, or Roost doesn't come."""

    def test_no_standalone_no_question(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, ROOST_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 0, out)
        self.assertNotIn("Roost replaces", out)
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
                rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed, ROOST_INSTALL_TTY=tty), *args)
                self.assertEqual(rc, 0, out)
                if args:
                    self.assertNotIn("[Y/n]", out)
                else:
                    self.assertIn("      Roost replaces Perch and jay. Uninstall them and use Roost? [Y/n]", out)
                self.assertIn("  ✓ Standalone extensions (uninstalled Perch and jay)", out)
                self.assertIn(f"  ✓ Roost (installed {VERSION})", out)
                log = self.stub_log()
                perch = _index(log, "--uninstall-extension seanahn.perch")
                jay = _index(log, "--uninstall-extension seanahn.jay")
                roost = _index(log, "vsix-present ")
                self.assertTrue(0 <= perch < jay < roost, log)
                self.assertNotIn("chirp", "\n".join(self.logged("--uninstall-extension")))
                self.assertEqual(self.leftovers(), [])

    def test_standalone_stop_skips_the_rest(self) -> None:
        installed = f"seanahn.kestrel-prs@0.2.0 seanahn.chirp@0.3.0"
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed, ROOST_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 1, out)
        self.assertIn("Roost replaces chirp and kestrel. Uninstall them and use Roost? [Y/n]", out)
        roost = [mark for mark in self.marks(out) if mark.startswith("✗ Roost: ")]
        self.assertEqual(len(roost), 1, out)
        self.assertIn("stopped", roost[0])
        self.assertEqual([mark.split(":")[0].split(" (")[0] for mark in self.marks(out)],
                         ["✓ Platform", "✓ VS Code", "✓ code on the PATH", "✗ Roost", "✓ GitHub"], out)
        self.assertEqual(self.logged("--install-extension"), [])
        self.assertEqual(self.logged("--uninstall-extension"), [])
        self.assertRegex(out, r"\nDone: 4 ✓  0 –  1 ✗\n")

    def test_no_terminal_without_yes_stops(self) -> None:
        env = self.served_env(CODE_EXTENSIONS="seanahn.jay@0.5.0", ROOST_INSTALL_TTY=str(self.tmp / "no-tty"))
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        self.assertNotIn("[Y/n]", out)
        roost = [mark for mark in self.marks(out) if mark.startswith("✗ Roost: ")]
        self.assertEqual(len(roost), 1, out)
        self.assertIn("jay", roost[0])
        self.assertIn("--yes", roost[0])
        self.assertEqual(self.logged("--uninstall-extension"), [])
        self.assertEqual(self.logged("--install-extension"), [])

        # A terminal that gives no answer (end of input) is not a yes either.
        self.log.write_text("")
        rc, out = self.run_pipe({**env, "ROOST_INSTALL_TTY": "/dev/null"})
        self.assertEqual(rc, 1, out)
        self.assertEqual(self.logged("--uninstall-extension"), [])

    def test_failed_uninstall_installs_no_roost(self) -> None:
        env = self.served_env(CODE_EXTENSIONS="seanahn.perch@0.9.0 seanahn.jay@0.5.0",
                              CODE_FAIL_ON="--uninstall-extension seanahn.jay")
        rc, out = self.run_pipe(env, "--yes")
        self.assertEqual(rc, 1, out)
        roost = [mark for mark in self.marks(out) if mark.startswith("✗ Roost: ")]
        self.assertEqual(len(roost), 1, out)
        self.assertIn("couldn't uninstall jay", roost[0])
        self.assertNotIn("Perch", roost[0])
        self.assertEqual(self.logged("--install-extension"), [])
        self.assertNotIn("Companions", out)


class TestRoost(_Served):
    """ensure_roost: the release's .vsix, version-aware, SHA-256 checked."""

    def test_same_version_already(self) -> None:
        rc, out = self.run_pipe(self.served_env())
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Roost (already)", out)
        self.assertEqual(self.logged("--install-extension"), [])

    def test_older_version_upgraded(self) -> None:
        installed = "seanahn.roost@1.1.9 " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  ✓ Roost (upgraded from 1.1.9 to {VERSION})", out)
        installs = self.vsix_installs()
        self.assertEqual(len(installs), 1, self.stub_log())
        self.assertTrue(installs[0].endswith(f"/roost-{VERSION}.vsix"), installs)
        self.assertEqual(len(self.logged("vsix-present ")), 1, self.stub_log())  # the file was there for code
        self.assertEqual(self.leftovers(), [])  # and is gone after

    def test_newer_roost_is_left_alone(self) -> None:
        installed = "seanahn.roost@1.10.0 " + " ".join(f"{c}@1.0.0" for c in COMPANIONS)  # 1.10 > 1.2
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  – Roost: 1.10.0 is newer than this installer's {VERSION}; left as is", out)
        self.assertEqual(self.logged("--install-extension"), [])

    def test_fresh_install(self) -> None:
        installed = " ".join(f"{c}@1.0.0" for c in COMPANIONS)
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn(f"  ✓ Roost (installed {VERSION})", out)
        self.assertEqual(len(self.vsix_installs()), 1, self.stub_log())
        self.assertEqual(self.leftovers(), [])

    def test_checksum_mismatch_refuses(self) -> None:
        rc, out = self.run_pipe(self.served_env("bad.vsix", CODE_EXTENSIONS=""))
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ Roost: the download did not match its checksum — run the installer again", out)
        self.assertEqual(self.vsix_installs(), [])
        self.assertEqual(self.logged("vsix-present"), [])
        self.assertEqual(self.leftovers(), [])
        self.assertIn("  ✓ Companions (installed", out)  # the run goes on

    def test_download_failure_reported(self) -> None:
        rc, out = self.run_pipe(self.served_env("missing.vsix", CODE_EXTENSIONS=""))
        self.assertEqual(rc, 1, out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Roost: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("couldn't download", failed[0])
        self.assertIn(f"{self.url}/missing.vsix", failed[0])
        self.assertEqual(self.vsix_installs(), [])
        self.assertEqual(self.leftovers(), [])

    def test_unstamped_script_refuses(self) -> None:
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=""), script=SCRIPT)
        self.assertEqual(rc, 1, out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Roost: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn("run a released installer", failed[0])
        self.assertEqual(self.vsix_installs(), [])

    def test_dry_run_downloads_nothing(self) -> None:
        rc, out = self.run_pipe(self.served_env(CODE_EXTENSIONS=""), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn(f"{self.url}/good.vsix", out)
        self.assertIn("  ✓ Roost (dry run)", out)
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
        installed = f"seanahn.roost@{VERSION} OpenAI.chatgpt@0.4.2"  # listed case doesn't matter
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, CODE_EXTENSIONS=installed))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ Companions (installed anthropic.claude-code, seanahn.perch-audio)", out)
        installs = [line.split()[-1] for line in self.logged("--install-extension")]
        self.assertEqual(installs, ["anthropic.claude-code", "seanahn.perch-audio"])

    def test_companion_failure_noted(self) -> None:
        env = self.env("ubuntu", ALL_PRESENT, CODE_EXTENSIONS=f"seanahn.roost@{VERSION}",
                       CODE_FAIL_ON="--install-extension openai.chatgpt")
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        failed = [mark for mark in self.marks(out) if mark.startswith("✗ Companions: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertTrue(failed[0].startswith("✗ Companions: openai.chatgpt "), failed)
        self.assertIn("Perch's tabs need Claude Code or ChatGPT", failed[0])
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
        self.assertIn("  – Roost: VS Code isn't installed", out)
        self.assertIn("  – Companions: VS Code isn't installed", out)


class TestGitHub(_Installer):
    """ensure_github: gh for kestrel's PRs panel, and one optional sign-in that --yes never answers."""

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
                      "dnf install -y gh --repo gh-cli"), ("apt-get",)),
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
                self.assertIn("gh auth login --web", out)

        # For real: gh goes in, and is signed in already.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", no_gh))
        self.assertEqual(rc, 0, out)
        self.assertEqual(len(self.logged("sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y gh")), 1)
        self.assertIn("  ✓ GitHub (installed gh; signed in as octocat)", out)

    def test_github_apt_source_already_there(self) -> None:
        (self.apt / "sources.list.d" / "github-cli.list").write_text(
            "deb [signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\n")
        rc, out = self.run_pipe(self.env("ubuntu", tuple(n for n in ALL_PRESENT if n != "gh")), "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertNotIn("githubcli-archive-keyring.gpg", out)
        self.assertIn("apt-get install -y gh", out)

    def test_gh_signed_in_no_question(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, ROOST_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 0, out)
        self.assertIn("  ✓ GitHub (signed in as octocat) (already)", out)
        self.assertNotIn("Sign in to GitHub", out)
        self.assertEqual(self.logged("gh auth login"), [])

    def test_gh_sign_in_on_yes(self) -> None:
        self.gh_auth.unlink()
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, ROOST_INSTALL_TTY=self.tty("", "for-gh")))
        self.assertEqual(rc, 0, out)
        self.assertIn("      Sign in to GitHub now, for the PRs panel? [Y/n]", out)
        self.assertEqual(len(self.logged("gh auth login --web")), 1, self.stub_log())
        self.assertEqual(self.logged("gh-stdin"), ["gh-stdin for-gh"])  # gh read the terminal
        self.assertIn("  ✓ GitHub (signed in as octocat)", out)

        # n: no sign-in, a note instead.
        self.gh_auth.unlink()
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, ROOST_INSTALL_TTY=self.tty("n")))
        self.assertEqual(rc, 0, out)
        self.assertIn("  – GitHub: run `gh auth login` to see your pull requests", out)
        self.assertEqual(self.logged("gh auth login"), [])

        # A sign-in that doesn't finish is ✗.
        self.log.write_text("")
        rc, out = self.run_pipe(self.env("ubuntu", ALL_PRESENT, ROOST_INSTALL_TTY=self.tty("y"), GH_LOGIN_FAIL="1"))
        self.assertEqual(rc, 1, out)
        self.assertIn("  ✗ GitHub: ", out)

    def test_gh_no_terminal_skips_sign_in(self) -> None:
        self.gh_auth.unlink()
        for args in ((), ("--yes",)):
            with self.subTest(args=args):
                self.log.write_text("")
                env = self.env("ubuntu", ALL_PRESENT, ROOST_INSTALL_TTY=str(self.tmp / "no-tty"))
                rc, out = self.run_pipe(env, *args)
                self.assertEqual(rc, 0, out)
                self.assertNotIn("Sign in to GitHub", out)
                self.assertIn("  – GitHub: run `gh auth login` to see your pull requests", out)
                self.assertEqual(self.logged("gh auth login"), [])


if __name__ == "__main__":
    unittest.main()
