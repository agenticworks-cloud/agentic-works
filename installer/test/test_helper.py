"""Tests for installer/agentic-works-install-helper: VS Code settings merge and activity-bar layout.

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

SCRIPT = Path(__file__).resolve().parents[1] / "agentic-works-install-helper"
KEY = "workbench.activity.pinnedViewlets2"
MARKER = "agenticWorks.installer.layoutWritten"
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
    loader = SourceFileLoader("agentic_works_install_helper", str(SCRIPT))
    spec = importlib.util.spec_from_loader("agentic_works_install_helper", loader)
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
            {"AGENTIC_WORKS_VSCODE_USER_DIR": str(self.user), "AGENTIC_WORKS_VSCODE_EXTENSIONS_DIR": str(self.exts)},
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

    def _hidden_commands(self) -> dict:
        con = self._db()
        row = con.execute("SELECT value FROM ItemTable WHERE key=?", ("menu.hiddenCommands",)).fetchone()
        con.close()
        return json.loads(row[0]) if row else {}

    def test_vendor_title_buttons_hidden_with_the_layout(self) -> None:
        # Claude Code's and Codex's "open" buttons sit on every editor's title bar (Get started included); hidden as
        # a right-click in the title bar would, in the same one-time write as the icons
        self.assertEqual(self._layout()[0], 0)
        self.assertEqual(self._hidden_commands(), {"EditorTitle": [
            "claude-vscode.editor.openLast", "claude-vscode.terminal.open", "chatgpt.openSidebar"]})

    def test_hidden_title_buttons_merge_with_what_is_there(self) -> None:
        mine = {"EditorTitle": ["workbench.action.splitEditor", "chatgpt.openSidebar"], "ViewTitle": ["x.y"]}
        self._make_db({"menu.hiddenCommands": json.dumps(mine)})
        self.assertEqual(self._layout()[0], 0)
        self.assertEqual(self._hidden_commands(), {"EditorTitle": [
            "workbench.action.splitEditor", "chatgpt.openSidebar", "claude-vscode.editor.openLast",
            "claude-vscode.terminal.open"], "ViewTitle": ["x.y"]})

    def test_hidden_title_buttons_left_alone_when_not_json(self) -> None:
        self._make_db({"menu.hiddenCommands": "not json"})
        self.assertEqual(self._layout()[0], 0)
        con = self._db()
        (value,) = con.execute("SELECT value FROM ItemTable WHERE key=?", ("menu.hiddenCommands",)).fetchone()
        con.close()
        self.assertEqual(value, "not json")

    def test_title_buttons_not_touched_on_a_used_vscode(self) -> None:
        self._make_db({KEY: json.dumps([{"id": "workbench.view.scm", "pinned": True, "visible": True}])})
        self.assertEqual(self._layout()[0], 2)
        self.assertEqual(self._hidden_commands(), {}, "a VS Code already in use keeps its title bar")

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


class NoOnboardingTests(_Case):
    """`vscode-no-onboarding`: VS Code's first-launch welcome (its Copilot sign-in) off, in the user's own settings.json
    (2026-11-27). The setting is application-wide, read only from there; with VS Code open, the window that makes a
    profile starts before the profile has settings, and on VS Code's very first launch showed the welcome."""

    KEY = "workbench.welcomePage.experimentalOnboarding"

    def test_added_to_the_users_own_settings(self) -> None:
        self.user.mkdir(parents=True)
        (self.user / "settings.json").write_text('{"editor.fontSize": 15}\n')
        code, out = self.run_cli("--profile", "Acme Works", "vscode-no-onboarding")
        self.assertEqual((code, out.strip()), (0, "added"))
        self.assertEqual(json.loads((self.user / "settings.json").read_text()), {"editor.fontSize": 15, self.KEY: False})

    def test_a_value_there_is_kept(self) -> None:
        self.user.mkdir(parents=True)
        (self.user / "settings.json").write_text(json.dumps({self.KEY: True}))
        code, out = self.run_cli("vscode-no-onboarding")
        self.assertEqual((code, out.strip()), (0, "already set"))
        self.assertEqual(json.loads((self.user / "settings.json").read_text()), {self.KEY: True})

    def test_no_settings_file(self) -> None:
        code, out = self.run_cli("vscode-no-onboarding")
        self.assertEqual((code, out.strip()), (0, "added"))
        self.assertEqual(json.loads((self.user / "settings.json").read_text()), {self.KEY: False})

    def test_jsonc_left_alone(self) -> None:
        self.user.mkdir(parents=True)
        (self.user / "settings.json").write_text('{ // mine\n}\n')
        code, _ = self.run_cli("vscode-no-onboarding")
        self.assertNotEqual(code, 0)
        self.assertEqual((self.user / "settings.json").read_text(), '{ // mine\n}\n')


class ProfileTests(_Case):
    """--profile NAME: a VS Code profile of its own (a company's, beside the user's own); `vscode-profile NAME` makes
    it, and the settings and layout then go into its folder rather than the user's."""

    def _storage(self) -> Path:
        return self.user / "globalStorage" / "storage.json"

    def _profiles(self) -> list:
        return json.loads(self._storage().read_text()).get("userDataProfiles", [])

    def _make(self, name: str = "Acme Works", running: bool = False) -> Tuple[int, str]:
        with mock.patch.object(self.h, "vscode_running", return_value=running):
            return self.run_cli("vscode-profile", name)

    def _dir(self, name: str = "Acme Works") -> Path:
        (entry,) = [p for p in self._profiles() if p["name"] == name]
        return self.user / "profiles" / entry["location"]

    def test_made_with_the_users_settings_keybindings_and_snippets(self) -> None:
        self.user.mkdir(parents=True)
        (self.user / "settings.json").write_text('{"editor.fontSize": 15}\n')
        (self.user / "keybindings.json").write_text('[{"key": "ctrl+k"}]\n')
        (self.user / "snippets").mkdir()
        (self.user / "snippets" / "py.json").write_text("{}")
        self._storage().parent.mkdir(parents=True)
        self._storage().write_text(json.dumps({"theme": "dark", "userDataProfiles": [{"location": "abc", "name": "Mine"}]}))
        code, out = self._make()
        self.assertEqual((code, out.strip()), (0, "made, with your settings"))
        self.assertEqual(json.loads(self._storage().read_text())["theme"], "dark", "the rest of storage.json kept")
        self.assertEqual([p["name"] for p in self._profiles()], ["Mine", "Acme Works"])
        folder = self._dir()
        self.assertEqual((folder / "settings.json").read_text(), '{"editor.fontSize": 15}\n')
        self.assertEqual((folder / "keybindings.json").read_text(), '[{"key": "ctrl+k"}]\n')
        self.assertEqual((folder / "snippets" / "py.json").read_text(), "{}")
        self.assertEqual((self.user / "settings.json").read_text(), '{"editor.fontSize": 15}\n', "the user's own untouched")

    def test_made_on_a_vscode_never_started(self) -> None:
        code, out = self._make()
        self.assertEqual((code, out.strip()), (0, "made"))
        self.assertTrue(self._dir().is_dir())

    def test_there_already_is_left_alone(self) -> None:
        self._make()
        folder = self._dir()
        (folder / "settings.json").write_text('{"mine": 1}')
        (self.user / "settings.json").write_text('{"theirs": 2}')
        self.assertEqual(self._make(running=True), (0, "already set\n"), "even with VS Code running")
        self.assertEqual((folder / "settings.json").read_text(), '{"mine": 1}')
        self.assertEqual(len(self._profiles()), 1)

    def test_vscode_running_skips(self) -> None:
        # a running VS Code rewrites storage.json from memory: a profile written beside it is lost (tried, 2026-11-27)
        code, out = self._make(running=True)
        self.assertEqual(code, 2)
        self.assertIn("VS Code is running", out)
        self.assertFalse(self._storage().exists())

    def test_two_names_get_two_folders(self) -> None:
        self._make("Acme Works")
        self._make("Other")
        self.assertNotEqual(self._dir("Acme Works"), self._dir("Other"))

    def test_storage_that_isnt_json_is_an_error(self) -> None:
        self._storage().parent.mkdir(parents=True)
        self._storage().write_text("not json")
        self.assertEqual(self._make()[0], 1)
        self.assertEqual(self._storage().read_text(), "not json")

    def test_settings_go_into_the_profile(self) -> None:
        self._make()
        self.assertEqual(self.run_cli("--profile", "Acme Works", "vscode-settings")[0], 0)
        self.assertIn("workbench.startupEditor", json.loads((self._dir() / "settings.json").read_text()))
        self.assertFalse((self.user / "settings.json").exists(), "the user's own settings untouched")

    def test_layout_goes_into_the_profile(self) -> None:
        self._make()
        with mock.patch.object(self.h, "vscode_running", return_value=False):
            self.assertEqual(self.run_cli("--profile", "Acme Works", "vscode-layout")[0], 0)
        self.assertTrue(self.h.layout_recorded(self._dir() / "globalStorage" / "state.vscdb"))
        self.assertFalse((self.user / "globalStorage" / "state.vscdb").exists())

    def test_fill_copies_the_users_files_into_a_profile_vscode_made(self) -> None:
        # VS Code, open, makes the profile itself (with an empty settings.json); the user's files go in after
        self.user.mkdir(parents=True)
        (self.user / "settings.json").write_text('{"editor.fontSize": 15}')
        (self.user / "keybindings.json").write_text("[1]")
        self._storage().parent.mkdir(parents=True)
        self._storage().write_text(json.dumps({"userDataProfiles": [{"location": "-3919205c", "name": "Acme Works"}]}))
        folder = self.user / "profiles" / "-3919205c"
        folder.mkdir(parents=True)
        (folder / "settings.json").write_text("{}\n")
        (folder / "keybindings.json").write_text('[{"key": "mine"}]')
        self.assertEqual(self.run_cli("vscode-profile", "Acme Works", "--fill"), (0, "filled\n"))
        self.assertEqual((folder / "settings.json").read_text(), '{"editor.fontSize": 15}', "an empty one is replaced")
        self.assertEqual((folder / "keybindings.json").read_text(), '[{"key": "mine"}]', "one with something is kept")
        self.assertEqual(self.run_cli("vscode-profile", "Acme Works", "--fill"), (0, "already set\n"))
        self.assertEqual(self.run_cli("vscode-profile", "Nope", "--fill")[0], 1)

    def test_a_profile_not_made_is_an_error(self) -> None:
        code = self.run_cli("--profile", "Acme Works", "vscode-settings")[0]
        self.assertEqual(code, 1)
        self.assertFalse((self.user / "settings.json").exists())


if __name__ == "__main__":
    unittest.main()
