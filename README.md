# Roost

One VS Code extension with four parts:

- **Agents** (Claude Code and Codex): their sessions as editor tabs, side by side, any number of them.
- **Teams**: Microsoft Teams chats and channels, each conversation in a tab.
- **Jira & Confluence**: tickets and pages in tabs, with the space tree and your own work in the sidebar.
- **PRs**: your open pull requests in a panel tab, with their checks and reviews, and the chat that made each one.

Agents (the Perch icon), Teams and Jira & Confluence each have their own icon in the activity bar; PRs is a tab in
the bottom panel. Each part was a separate extension before (Perch, chirp, jay and kestrel); Roost carries their
histories under `parts/agents`, `parts/teams`, `parts/jira` and `parts/pull-requests`.

## Install

Download `roost-install.sh` from the latest release and run it in a terminal:

```sh
curl -fsSLO https://github.com/seanahn/roost/releases/latest/download/roost-install.sh
bash roost-install.sh
```

Run it without `sudo`: it asks for your password when it needs it, after listing what it adds system-wide. It:

- installs VS Code if it is missing (Homebrew on macOS, Microsoft's package repository on Linux) and puts `code` on
  the PATH;
- offers to uninstall the standalone Perch, chirp, jay and kestrel extensions, which would clash with Roost;
- installs Roost (checked against its SHA-256) and its companions, Claude Code, ChatGPT and perch-audio;
- installs the GitHub CLI and offers one `gh auth login`, for the PRs panel;
- sets the look (Copilot off, no Welcome page, the activity bar on top) without overwriting a setting you made,
  and trims the activity-bar icons on a VS Code that has never been started;
- opens VS Code, where Roost's first start opens its Get started walkthrough (again any time: Roost: Get Started).

It prints a ✓ / – / ✗ checklist and is safe to run again; a second run changes nothing that is in place. Running
the newest installer is also how Roost is updated.

| Flag | |
|---|---|
| `--dry-run` | print each command instead of running it |
| `--skip <step>` | leave a step out (repeatable): `vscode path standalone roost companions github settings icons open` |
| `--yes` | answer yes to uninstalling the standalone four (needed with no terminal); never answers the GitHub sign-in |
| `--no-open` | don't open VS Code at the end |
| `--codebase-search` | turn codebase search on in Claude and Codex tabs (off otherwise; the Get started walkthrough offers it) |
| `--teams-app <clientId>:<tenant>` | sign Teams in with your company's own Microsoft app: its Application (client) ID, then the Directory (tenant) ID or domain, from your IT team (written to `teams.signIn.clientId` and `teams.signIn.tenant` only when neither is set) |
| `--help` | the options |

Supported: macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora, on a desktop
where VS Code runs. Not Windows, and not a server reached over Remote-SSH. The design:
[docs/notes/102-roost-installer.md](docs/notes/102-roost-installer.md).

## Switching parts on and off

Open **Settings → Roost** (the gear on the Perch view, the **Settings** row at the end of the Perch explorer, or
**Roost: Settings** in the Command Palette). The first section holds one switch per part, all on by default:

| Part | Switch |
|---|---|
| Agents (Claude Code and Codex) | `roost.agents.enabled` |
| Jira & Confluence | `roost.jira.enabled` |
| PRs | `roost.pullRequests.enabled` |
| Teams | `roost.teams.enabled` |

A switch takes effect at once, with no reload. A part that is off shows no icon, panel tab or commands; its open
tabs close, and come back when you switch it on again. If an agent's turn is running, Roost asks before stopping it.
A part that fails to start is reported once and left off; the others keep working. Each part's own settings
follow in a section of their own, under the part's name: `agents.*`, `teams.*`, `jira.*` and `pullRequests.*`, and
its commands are listed as **Agents: …**, **Teams: …**, **Jira: …** and **Pull Requests: …**.

These were `perch.*`, `chirp.*`, `jay.*` and `kestrel.*` in the standalone extensions. On its first start each part
copies any value you set under the old name to the new one, at the same level (user, workspace or folder), unless
the new one is already set there; the old entries stay in your `settings.json`, unused, for you to delete.

## First start

On its very first start Roost opens the PRs tab once, so the bottom panel shows it. After that it is up to you.

## Build and install

```sh
make deps       # npm ci for Roost and every part
make test       # Roost's tests, then each part's, then a check that package.json matches the parts
make install    # symlink this checkout into your VS Code extension folders; then reload the window
make package    # build roost-<version>.vsix
```

`make test-live` adds the Agents part's live tests, one tiny turn through each agent with your real logins.

## Adding a part

A part is a folder under `parts/` with a `part.json` beside its own `package.json`:

```json
{ "id": "demo", "title": "Demo", "entry": "src/extension.js", "needs": [] }
```

Run `make manifest`: the root `package.json` is generated from the parts (never edit it by hand), and the new
part gets its switch and its views with no other file edited. Then `make test`.

## Companion extensions

Installing Roost also installs, through its extension pack:

- **Claude Code** and **ChatGPT**: the Agents part runs the `claude` and `codex` programs they ship.
- **perch-audio**: dictation's recording companion, which runs on your own machine even when VS Code is attached
  to a remote one.

## Licence

MIT. See [LICENSE](LICENSE).

## Design

[docs/notes/101-roost.md](docs/notes/101-roost.md): what Roost is, how it was built, and what was verified.
