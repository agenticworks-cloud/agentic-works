"""Tests for installer/roost-install-helper: VS Code settings merge and activity-bar layout.

Python 3.6-safe, as the helper is: test_install.TestPython36 runs this file under 3.6."""

import contextlib
import os
import subprocess
import sys
import io
import json
import sqlite3
import tempfile
import unittest
from importlib.machinery import SourceFileLoader
import importlib.util
from pathlib import Path
from typing import List, Tuple
from unittest import mock

SCRIPT = Path(__file__).resolve().parents[1] / "roost-install-helper"
KEY = "workbench.activity.pinnedViewlets2"
MARKER = "roost.installer.layoutWritten"
SHOWN = [
    "workbench.view.explorer",
    "workbench.view.search",
    "workbench.view.extensions",
    "workbench.view.extension.perch",
    "workbench.view.extension.chirp",
    "workbench.view.extension.jay",
]
HIDDEN = [
    "workbench.view.scm",
    "workbench.view.debug",
    "workbench.view.testing",
    "workbench.view.extension.claude-sidebar",
    "workbench.view.extension.claude-sessions-sidebar",
]


def _load_script():
    loader = SourceFileLoader("roost_install_helper", str(SCRIPT))
    spec = importlib.util.spec_from_loader("roost_install_helper", loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


class _Case(unittest.TestCase):
    def setUp(self) -> None:
        self.h = _load_script()
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.tmp = Path(tmp.name)
        self.user = self.tmp / "User"
        self.exts = self.tmp / "extensions"
        env = mock.patch.dict(
            "os.environ",
            {"ROOST_VSCODE_USER_DIR": str(self.user), "ROOST_VSCODE_EXTENSIONS_DIR": str(self.exts)},
        )
        env.start()
        self.addCleanup(env.stop)

    def run_cli(self, *argv: str) -> Tuple[int, str]:
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = self.h.main(list(argv))
        return code, out.getvalue()


class SettingsTests(_Case):
    def test_settings_written_on_empty(self) -> None:
        code, _ = self.run_cli("vscode-settings")
        self.assertEqual(code, 0)
        self.assertEqual(
            json.loads((self.user / "settings.json").read_text()),
            {
                "chat.disableAIFeatures": True,
                "workbench.startupEditor": "none",
                "workbench.secondarySideBar.defaultVisibility": "hidden",
                "workbench.activityBar.location": "top",
            },
        )

    def test_codebase_search_added_only_when_asked_and_absent(self) -> None:
        code, out = self.run_cli("vscode-settings", "--codebase-search")
        self.assertEqual(code, 0)
        self.assertEqual(out, "codebase search added\n")
        self.assertIs(json.loads((self.user / "settings.json").read_text())["agents.codebaseIndex.enabled"], True)
        (self.user / "settings.json").write_text(json.dumps({"agents.codebaseIndex.enabled": False}))
        code, out = self.run_cli("vscode-settings", "--codebase-search")
        self.assertEqual(code, 0)
        self.assertEqual(out, "", "the look's keys added, the user's false kept: nothing said")
        self.assertIs(json.loads((self.user / "settings.json").read_text())["agents.codebaseIndex.enabled"], False,
                      "a value the user set is kept")
        (self.user / "settings.json").write_text("{}")
        self.run_cli("vscode-settings")
        self.assertNotIn("agents.codebaseIndex.enabled", json.loads((self.user / "settings.json").read_text()))

    def test_teams_app_added_only_when_asked_and_absent(self) -> None:
        app = "0A1B2C3D-4E5F-4A6B-8C7D-9E0F1A2B3C4D"
        code, out = self.run_cli("vscode-settings", "--teams-app", app + ":Contoso.onmicrosoft.com")
        self.assertEqual((code, out), (0, ""))
        data = json.loads((self.user / "settings.json").read_text())
        self.assertEqual((data["teams.signIn.clientId"], data["teams.signIn.tenant"]),
                         (app.lower(), "contoso.onmicrosoft.com"))
        self.assertIn("chat.disableAIFeatures", data, "with the look's keys")
        # a tenant GUID, with --codebase-search too
        (self.user / "settings.json").write_text("{}")
        code, out = self.run_cli("vscode-settings", "--codebase-search", "--teams-app", app + ":" + app)
        self.assertEqual((code, out), (0, "codebase search added\n"))
        self.assertEqual(json.loads((self.user / "settings.json").read_text())["teams.signIn.tenant"], app.lower())
        # either already set: both kept as they are, so an app never meets another's tenant
        for have in ({"teams.signIn.clientId": "mine"}, {"teams.signIn.tenant": "fabrikam.com"}):
            (self.user / "settings.json").write_text(json.dumps(have))
            code, _ = self.run_cli("vscode-settings", "--teams-app", app + ":contoso.com")
            self.assertEqual(code, 0)
            data = json.loads((self.user / "settings.json").read_text())
            self.assertEqual({k: v for k, v in data.items() if k.startswith("teams.")}, have)
        # without the flag: neither
        (self.user / "settings.json").write_text("{}")
        self.run_cli("vscode-settings")
        self.assertFalse(any(k.startswith("teams.") for k in json.loads((self.user / "settings.json").read_text())))

    def test_teams_app_shape_is_checked(self) -> None:
        for bad in ("x:y", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d:contoso",
                    ":contoso.com", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d:contoso com"):
            with self.subTest(bad), contextlib.redirect_stderr(io.StringIO()):
                code, _ = self.run_cli("vscode-settings", "--teams-app", bad)
                self.assertEqual(code, 1)
                self.assertFalse((self.user / "settings.json").exists(), "nothing written")

    def test_teams_app_in_jsonc_is_printed(self) -> None:
        self.user.mkdir()
        (self.user / "settings.json").write_text('{\n  // mine\n  "editor.fontSize": 15\n}\n')
        code, out = self.run_cli("vscode-settings", "--teams-app", "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d:contoso.com")
        self.assertEqual(code, 2)
        self.assertIn('"teams.signIn.clientId": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",', out)
        self.assertIn('"teams.signIn.tenant": "contoso.com",', out)

    def test_keeps_foreign_keys(self) -> None:
        self.user.mkdir()
        (self.user / "settings.json").write_text(
            json.dumps({"editor.fontSize": 15, "workbench.startupEditor": "welcomePage"})
        )
        code, _ = self.run_cli("vscode-settings")
        self.assertEqual(code, 0)
        data = json.loads((self.user / "settings.json").read_text())
        self.assertEqual(data["editor.fontSize"], 15)
        self.assertEqual(data["workbench.startupEditor"], "welcomePage")
        self.assertEqual(data["workbench.activityBar.location"], "top")

    def test_jsonc_is_not_rewritten(self) -> None:
        self.user.mkdir()
        raw = b'{\n  // my font\n  "editor.fontSize": 15\n}\n'
        (self.user / "settings.json").write_bytes(raw)
        self.assertIsNone(self.h.merge_settings(raw.decode(), {"a": 1}))
        code, out = self.run_cli("vscode-settings")
        self.assertEqual(code, 2)
        self.assertIn('"workbench.activityBar.location": "top"', out)
        self.assertIn('"chat.disableAIFeatures": true', out)
        self.assertEqual((self.user / "settings.json").read_bytes(), raw)

    def test_untouched_when_all_present(self) -> None:
        self.user.mkdir()
        raw = (
            b'{"chat.disableAIFeatures":true,"workbench.startupEditor":"none",'
            b'"workbench.secondarySideBar.defaultVisibility":"hidden","workbench.activityBar.location":"top",'
            b'"agents.firstStart.openClaudeTab":false}'  # false: the Agents part already opened its tab
        )
        (self.user / "settings.json").write_bytes(raw)
        code, out = self.run_cli("vscode-settings")
        self.assertEqual((code, out.strip()), (0, "already set"))
        self.assertEqual((self.user / "settings.json").read_bytes(), raw)

    def test_non_ascii_kept(self) -> None:
        self.user.mkdir()
        (self.user / "settings.json").write_text('{"x": "café"}', encoding="utf-8")
        self.run_cli("vscode-settings")
        raw = (self.user / "settings.json").read_text(encoding="utf-8")
        self.assertIn("café", raw)
        self.assertNotIn("\\u00e9", raw)

    def test_mode_kept_on_rewrite(self) -> None:
        self.user.mkdir()
        path = self.user / "settings.json"
        path.write_text("{}")
        path.chmod(0o600)
        self.run_cli("vscode-settings")
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_symlinked_settings_kept_a_symlink(self) -> None:
        self.user.mkdir()
        target = self.tmp / "dotfiles" / "settings.json"
        target.parent.mkdir()
        target.write_text(json.dumps({"editor.fontSize": 15}))
        link = self.user / "settings.json"
        link.symlink_to(target)
        self.assertEqual(self.run_cli("vscode-settings")[0], 0)
        self.assertTrue(link.is_symlink())
        data = json.loads(target.read_text())
        self.assertEqual(data["editor.fontSize"], 15)
        self.assertEqual(data["workbench.activityBar.location"], "top")

    def test_non_utf8_treated_as_jsonc(self) -> None:
        self.user.mkdir()
        raw = b'{"x": "caf\xe9"}'
        (self.user / "settings.json").write_bytes(raw)
        self.assertEqual(self.run_cli("vscode-settings")[0], 2)
        self.assertEqual((self.user / "settings.json").read_bytes(), raw)


class VscodeRunningTests(_Case):
    """Running means: the code.lock of this user data directory names a live process."""

    def _lock(self, text: str) -> None:
        self.user.mkdir(parents=True, exist_ok=True)
        (self.user.parent / "code.lock").write_text(text)

    def test_no_lock_is_not_running(self) -> None:
        self.assertFalse(self.h.vscode_running())

    def test_live_pid_is_running(self) -> None:
        self._lock(str(os.getpid()))
        self.assertTrue(self.h.vscode_running())

    def test_dead_pid_or_garbage_is_not_running(self) -> None:
        dead = subprocess.Popen([sys.executable, "-c", "pass"])
        dead.wait()
        self._lock(str(dead.pid))
        self.assertFalse(self.h.vscode_running())
        self._lock("not a pid")
        self.assertFalse(self.h.vscode_running())

class LayoutTests(_Case):
    def _db(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self.user / "globalStorage" / "state.vscdb"))

    def _make_db(self, items: dict) -> Path:
        db = self.user / "globalStorage" / "state.vscdb"
        db.parent.mkdir(parents=True)
        con = sqlite3.connect(str(db))
        con.execute("CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)")
        con.executemany("INSERT INTO ItemTable (key, value) VALUES (?, ?)", list(items.items()))
        con.commit()
        con.close()
        return db

    def _layout(self, running: bool = False) -> Tuple[int, str]:
        with mock.patch.object(self.h, "vscode_running", return_value=running):
            return self.run_cli("vscode-layout")

    def test_layout_order_and_hidden(self) -> None:
        entry = self.h.layout_entry([], [])
        self.assertEqual([e["id"] for e in entry], SHOWN + HIDDEN)
        for i, e in enumerate(entry[:6]):
            self.assertEqual(e, {"id": SHOWN[i], "pinned": True, "visible": True, "order": i})
        for e in entry[6:]:
            self.assertFalse(e["pinned"])
            self.assertFalse(e["visible"])

    def test_layout_keeps_unknown_ids(self) -> None:
        foo = {"id": "workbench.view.extension.foo", "pinned": True, "visible": True, "order": 9}
        entry = self.h.layout_entry([foo, {"id": "workbench.view.scm", "pinned": True, "visible": True}], [])
        self.assertIn(foo, entry)
        self.assertEqual([e["visible"] for e in entry if e["id"] == "workbench.view.scm"], [False])

    def test_codex_containers_hidden(self) -> None:
        pkg = self.exts / "openai.chatgpt-1.2.3" / "package.json"
        pkg.parent.mkdir(parents=True)
        pkg.write_text(json.dumps({"contributes": {"viewsContainers": {"activitybar": [{"id": "codex"}]}}}))
        self.assertEqual(self._layout()[0], 0)
        con = self._db()
        (value,) = con.execute("SELECT value FROM ItemTable WHERE key=?", (KEY,)).fetchone()
        con.close()
        hidden = [e["id"] for e in json.loads(value) if not e["visible"]]
        self.assertIn("workbench.view.extension.codex", hidden)

    def test_fresh_db_gets_layout_and_marker(self) -> None:
        code, out = self._layout()
        self.assertEqual((code, out), (0, ""))
        con = self._db()
        (value,) = con.execute("SELECT value FROM ItemTable WHERE key=?", (KEY,)).fetchone()
        marker = con.execute("SELECT 1 FROM ItemTable WHERE key=?", (MARKER,)).fetchone()
        con.close()
        self.assertEqual(json.loads(value), self.h.layout_entry([], []))
        self.assertIsNotNone(marker)

    def test_first_window_maximized_only_when_absent(self) -> None:
        storage = self.user / "globalStorage" / "storage.json"
        self.assertEqual(self._layout()[0], 0)
        ui = json.loads(storage.read_text())["windowsState"]["lastActiveWindow"]["uiState"]
        self.assertEqual(ui["mode"], 0, "maximized")
        self.assertTrue(ui["width"] and ui["height"], "with a size: VS Code ignores a state without one")
        # an existing windowsState, or a file that isn't JSON, is left as it is; other keys are kept
        storage.write_text(json.dumps({"windowsState": {"x": 1}, "other": 2}))
        self.h.maximize_first_window(storage)
        self.assertEqual(json.loads(storage.read_text()), {"windowsState": {"x": 1}, "other": 2})
        storage.write_text(json.dumps({"other": 2}))
        self.h.maximize_first_window(storage)
        self.assertEqual(json.loads(storage.read_text())["other"], 2)
        storage.write_text("not json")
        self.h.maximize_first_window(storage)
        self.assertEqual(storage.read_text(), "not json")

    def test_db_without_pinned_entry_gets_layout(self) -> None:
        db = self._make_db({"other": "x"})
        self.assertTrue(self.h.layout_needed(db))
        self.assertEqual(self._layout()[0], 0)
        self.assertFalse(self.h.layout_needed(db))

    def test_layout_needed_when_db_absent(self) -> None:
        self.assertTrue(self.h.layout_needed(self.user / "globalStorage" / "state.vscdb"))

    def test_existing_layout_is_never_rewritten(self) -> None:
        db = self._make_db({KEY: json.dumps([{"id": "workbench.view.scm", "pinned": True, "visible": True}])})
        before = db.read_bytes()
        code, out = self._layout()
        self.assertEqual(code, 2)
        self.assertTrue(out.strip())
        self.assertEqual(db.read_bytes(), before)

    def test_rerun_is_already_set_even_with_vscode_running(self) -> None:
        self._layout()
        code, out = self._layout(running=True)
        self.assertEqual((code, out.strip()), (0, "already set"))

    def test_engineer_changes_not_rewritten_on_rerun(self) -> None:
        self._layout()
        mine = json.dumps([{"id": "workbench.view.scm", "pinned": True, "visible": True, "order": 0}])
        con = self._db()
        con.execute("UPDATE ItemTable SET value=? WHERE key=?", (mine, KEY))
        con.commit()
        con.close()
        self.assertEqual(self._layout(), (0, "already set\n"))
        con = self._db()
        (value,) = con.execute("SELECT value FROM ItemTable WHERE key=?", (KEY,)).fetchone()
        con.close()
        self.assertEqual(value, mine)

    def test_vscode_running_skips(self) -> None:
        code, out = self._layout(running=True)
        self.assertEqual(code, 2)
        self.assertIn("quit VS Code", out)
        self.assertFalse((self.user / "globalStorage" / "state.vscdb").exists())


if __name__ == "__main__":
    unittest.main()
