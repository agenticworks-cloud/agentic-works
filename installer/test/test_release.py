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


if __name__ == "__main__":
    unittest.main()
