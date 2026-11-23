"""Tests for `make release`: dist/roost-install.sh stamped and carrying its helper, and what stays out of the .vsix.

Needs `make release` to have run first (it builds the .vsix, which takes a while). Never runs release-publish.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DIST = ROOT / "dist"
VERSION = json.loads((ROOT / "package.json").read_text())["version"]
VSIX = DIST / f"roost-{VERSION}.vsix"
SCRIPT = DIST / "roost-install.sh"


if not (SCRIPT.exists() and VSIX.exists()) and os.environ.get("ROOST_REQUIRE_DIST") == "1":
    raise SystemExit("dist/ is missing: run `make release` (ROOST_REQUIRE_DIST=1)")


@unittest.skipUnless(SCRIPT.exists() and VSIX.exists(), "run `make release` first")
class ReleaseTest(unittest.TestCase):
    def test_stamped_script_has_version_and_sha(self):
        text = SCRIPT.read_text()
        sha = hashlib.sha256(VSIX.read_bytes()).hexdigest()
        self.assertIn(f'ROOST_VERSION="{VERSION}"', text)
        self.assertIn(f'ROOST_SHA256="{sha}"', text)
        self.assertNotIn("@ROOST_VERSION@", text)
        self.assertNotIn("@ROOST_SHA256@", text)
        self.assertNotIn("@INLINED_HELPER@", text)

    def test_released_script_runs_its_inlined_helper(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "home").mkdir()
            (tmp_path / "tmp").mkdir()
            env = {**os.environ, "HOME": str(tmp_path / "home"), "TMPDIR": str(tmp_path / "tmp"), "NO_COLOR": "1"}
            env.pop("ROOST_INSTALL_HELPER", None)
            copy = tmp_path / "run" / "roost-install.sh"  # alone: no sibling helper
            copy.parent.mkdir()
            copy.write_bytes(SCRIPT.read_bytes())
            out = subprocess.run(["bash", str(copy), "--dry-run", "--skip", "vscode"], env=env,
                                 capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60)
            self.assertNotIn("isn't beside this script", out.stdout + out.stderr)
            m = re.search(r"python3 (\S*roost-install-helper\.\S+) ", out.stdout)
            self.assertIsNotNone(m, out.stdout)
            self.assertTrue(m.group(1).startswith(str(tmp_path / "tmp")), m.group(1))
            self.assertEqual(list((tmp_path / "tmp").glob("roost-install-helper.*")), [], "removed on exit")

    def test_piped_script_ignores_a_decoy_helper_in_the_current_directory(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            for d in ("home", "tmp", "cwd"):
                (tmp_path / d).mkdir()
            marker = tmp_path / "decoy-ran"
            decoy = tmp_path / "cwd" / "roost-install-helper"
            decoy.write_text(f"#!/bin/sh\ntouch {marker}\n")
            decoy.chmod(0o755)
            env = {**os.environ, "HOME": str(tmp_path / "home"), "TMPDIR": str(tmp_path / "tmp"), "NO_COLOR": "1"}
            env.pop("ROOST_INSTALL_HELPER", None)
            with SCRIPT.open("rb") as f:
                out = subprocess.run(["bash", "-s", "--", "--dry-run", "--skip", "vscode"], env=env, stdin=f,
                                     cwd=tmp_path / "cwd", capture_output=True, text=True, timeout=60)
            self.assertFalse(marker.exists(), "the decoy ran")
            m = re.search(r"python3 (\S*roost-install-helper\.\S+) ", out.stdout)
            self.assertIsNotNone(m, out.stdout)
            self.assertTrue(m.group(1).startswith(str(tmp_path / "tmp")), m.group(1))

    def test_release_assets_not_in_vsix(self):
        names = zipfile.ZipFile(VSIX).namelist()
        bad = [n for n in names if n.startswith(("extension/installer/", "extension/dist/"))]
        self.assertEqual(bad, [])


class ReleasePublishCheckTest(unittest.TestCase):
    """release-publish's refusals, through its release-publish-check prerequisite, in a scratch git repo holding a
    copy of the Makefile. release-publish itself (which runs gh) is only read, never run."""

    def git(self, cwd: Path, *args: str) -> None:
        subprocess.run(["git", "-c", "user.name=t", "-c", "user.email=t@example.com", *args], cwd=cwd, check=True,
                       capture_output=True, timeout=60)

    def check(self, repo: Path) -> subprocess.CompletedProcess:
        return subprocess.run(["make", "--no-print-directory", "release-publish-check"], cwd=repo,
                              capture_output=True, text=True, timeout=60)

    def test_refuses_a_dirty_tree_or_an_unpushed_head(self):
        with tempfile.TemporaryDirectory() as tmp:
            origin, repo = Path(tmp) / "origin.git", Path(tmp) / "repo"
            self.git(Path(tmp), "init", "-q", "--bare", str(origin))
            self.git(Path(tmp), "init", "-q", str(repo))
            (repo / "Makefile").write_bytes((ROOT / "Makefile").read_bytes())
            self.git(repo, "add", "Makefile")
            self.git(repo, "commit", "-q", "-m", "one")

            out = self.check(repo)  # no origin
            self.assertNotEqual(out.returncode, 0, out)
            self.assertIn("HEAD isn't on origin; push it first", out.stdout + out.stderr)

            self.git(repo, "remote", "add", "origin", str(origin))
            self.git(repo, "push", "-q", "origin", "HEAD:refs/heads/main")
            self.git(repo, "fetch", "-q", "origin")
            out = self.check(repo)
            self.assertEqual(out.returncode, 0, out)

            (repo / "stray").write_text("x\n")  # untracked
            out = self.check(repo)
            self.assertNotEqual(out.returncode, 0, out)
            self.assertIn("uncommitted changes", out.stdout + out.stderr)

            self.git(repo, "add", "stray")
            self.git(repo, "commit", "-q", "-m", "two")  # committed, not pushed
            out = self.check(repo)
            self.assertNotEqual(out.returncode, 0, out)
            self.assertIn("HEAD isn't on origin", out.stdout + out.stderr)

    def test_publish_is_checked_and_targets_head(self):
        text = (ROOT / "Makefile").read_text()
        rule = re.search(r"^release-publish:(.*)\n((?:\t.*\n|  .*\n)+)", text, re.M)
        self.assertIsNotNone(rule, "no release-publish rule")
        self.assertIn("release-publish-check", rule.group(1).split())
        gh = [line for line in rule.group(2).splitlines() if "gh release create" in line]
        self.assertEqual(len(gh), 1, rule.group(2))
        self.assertIn('--target "$$(git rev-parse HEAD)"', rule.group(2))


if __name__ == "__main__":
    unittest.main()
