"""Tests for installer/roost-install.sh: the platform, VS Code and `code` on the PATH.

Each test runs the script in a subprocess with HOME in a temp dir and a PATH of only stubs (brew, apt-get, dnf,
sudo, code, curl, ... each logging its argv to $STUB_LOG) plus the handful of system tools the script needs, so
"is it installed" is whatever the test puts on PATH. ROOST_INSTALL_FAKE_OS picks the platform. One case runs
under bash 3.2, the bash macOS ships, in the bash:3.2 container (skipped without Docker). No network.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
SCRIPT = HERE.parent / "roost-install.sh"
IMAGE = "bash:3.2"
DOWNLOAD = "https://code.visualstudio.com/download"

# The system tools the script may use; everything else on PATH is a stub.
SYSTEM = ("bash", "sh", "dirname", "uname", "mkdir", "chmod", "mv", "rm", "mktemp", "cat", "tr", "grep", "env",
          "id")
ALL_PRESENT = ("brew", "curl", "gpg", "code", "sudo", "apt-get", "dnf", "rpm")

STUB = """#!/bin/sh
printf '%s\\n' "{name} $*" >> "$STUB_LOG"
{extra}exit 0
"""
# curl and gpg write something to their -o file, as the real ones do, so a downloaded key isn't empty.
WRITE_O = 'out="" prev=""; for a in "$@"; do [ "$prev" = -o ] && out=$a; prev=$a; done; [ -z "$out" ] || echo stub > "$out"\n'
STUB_EXTRA = {
    "curl": '[ -n "${CURL_FAIL_ON:-}" ] && case "$*" in *"$CURL_FAIL_ON"*) exit 22 ;; esac\n' + WRITE_O,
    "gpg": WRITE_O,
}

MARK_LINE = re.compile(r"^  [✓–✗] ")
ANSI = re.compile(r"\x1b\[")


def _write_stubs(directory: Path, names: tuple[str, ...]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    for name in names:
        path = directory / name
        path.write_text(STUB.format(name=name, extra=STUB_EXTRA.get(name, "")))
        path.chmod(0o755)


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

    def _path(self, stubs: tuple[str, ...]) -> str:
        stub_dir, sys_dir = self.tmp / "stubs", self.tmp / "sys"
        shutil.rmtree(stub_dir, ignore_errors=True)
        shutil.rmtree(sys_dir, ignore_errors=True)
        _write_stubs(stub_dir, stubs)
        sys_dir.mkdir()
        for name in SYSTEM:
            found = shutil.which(name)
            if found:
                (sys_dir / name).symlink_to(found)
        return f"{stub_dir}:{sys_dir}"

    def env(self, os_name: str, stubs: tuple[str, ...], **extra: str) -> dict[str, str]:
        env = {
            "HOME": str(self.home),
            "PATH": self._path(stubs),
            "STUB_LOG": str(self.log),
            "ROOST_INSTALL_FAKE_OS": os_name,
            "ROOST_INSTALL_FAKE_ARCH": "x86_64",
            "ROOST_INSTALL_TTY": "/dev/null",
            "TMPDIR": str(self.tmp),
            "SHELL": "/bin/bash",
            "TERM": "xterm",
        }
        env.update(extra)
        return env

    def run_pipe(self, env: dict[str, str], *args: str) -> tuple[int, str]:
        result = subprocess.run([shutil.which("bash"), str(SCRIPT), *args], env=env, stdin=subprocess.DEVNULL,
                                capture_output=True, timeout=60, check=False)
        return result.returncode, (result.stdout + result.stderr).decode()

    def run_sourced(self, env: dict[str, str], probe: str, *args: str) -> tuple[int, str]:
        """Source the script (ROOST_INSTALL_NO_MAIN=1), then run probe, a bash snippet; $1.. are args."""
        env = {**env, "ROOST_INSTALL_NO_MAIN": "1"}
        result = subprocess.run([shutil.which("bash"), "-c", f'. "$0"; {probe}', str(SCRIPT), *args], env=env,
                                stdin=subprocess.DEVNULL, capture_output=True, timeout=60, check=False)
        return result.returncode, (result.stdout + result.stderr).decode()

    def stub_log(self) -> list[str]:
        return self.log.read_text().splitlines()


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
        rc, out = self.run_pipe(env)
        self.assertEqual(rc, 1, out)
        failed = [line for line in out.splitlines() if line.startswith("  ✗ VS Code: ")]
        self.assertEqual(len(failed), 1, out)
        self.assertIn(DOWNLOAD, failed[0])
        self.assertNotIn("brew install", "\n".join(self.stub_log()))
        lines = out.splitlines()
        self.assertGreater(_index(lines, "code on the PATH"), _index(lines, "  ✗ VS Code: "), out)  # went on
        self.assertRegex(out, r"\nDone: \d+ ✓  \d+ –  1 ✗\n")
        self.assertIn("Details of what failed: ", out)

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

    PROBE = 'MAC_CODE=$1; main --skip vscode'

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
        rc, out = self.run_sourced(env, 'ORIG_PATH=/usr/bin:/bin; main --skip vscode')
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
        self.assertRegex(out, r"\nDone: 3 ✓  0 –  0 ✗\n")

    def test_skip_marks_the_step(self) -> None:
        rc, out = self.run_pipe(self.env("ubuntu", ("sudo", "apt-get")), "--skip", "vscode", "--dry-run")
        self.assertEqual(rc, 0, out)
        self.assertIn("  – VS Code: skipped (--skip vscode)", out)
        self.assertNotIn("apt-get install", out)

    def test_every_step_name_and_flag_is_accepted(self) -> None:
        names = "vscode path standalone roost companions settings icons open".split()
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
        for text in ("--dry-run", "--skip", "--yes", "--no-open", "vscode path standalone roost companions"):
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
        cmd = ["docker", "run", "--rm", "-i", "-v", f"{SCRIPT.parent}:/s:ro", "-v", f"{stubs}:/stubs:ro"]
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
        self.assertRegex(out, r"\nDone: \d+ ✓  0 –  0 ✗\n")


if __name__ == "__main__":
    unittest.main()
