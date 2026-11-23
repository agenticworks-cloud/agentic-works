# Roost

One VS Code extension with four parts:

- **Perch**: Claude Code and Codex sessions as editor tabs, side by side, any number of them.
- **Teams**: Microsoft Teams chats and channels, each conversation in a tab.
- **Jira & Confluence**: tickets and pages in tabs, with the space tree and your own work in the sidebar.
- **PRs**: your open pull requests in a panel tab, with their checks and reviews, and the chat that made each one.

Perch, Teams and Jira & Confluence each have their own icon in the activity bar; PRs is a tab in the bottom panel.
Each part was a separate extension before (Perch, chirp, jay and kestrel); Roost carries their histories under
`parts/`.

## Switching parts on and off

Open **Settings → Roost** (the gear on the Perch view, the **Settings** row at the end of the Perch explorer, or
**Roost: Settings** in the Command Palette). The first section holds one switch per part, all on by default:

| Part | Switch |
|---|---|
| Teams | `roost.teams.enabled` |
| Jira & Confluence | `roost.jira.enabled` |
| PRs | `roost.pullRequests.enabled` |
| Perch | `roost.perch.enabled` |

A switch takes effect at once, with no reload. A part that is off shows no icon, panel tab or commands; its open
tabs close, and come back when you switch it on again. If a Perch turn is running, Roost asks before stopping it.
A part that fails to start is reported once and left off; the others keep working. Each part's own settings
follow in a section of their own.

## First start

On its very first start Roost opens the PRs tab once, so the bottom panel shows it. After that it is up to you.

## Build and install

```sh
make deps       # npm ci for Roost and every part
make test       # Roost's tests, then each part's, then a check that package.json matches the parts
make install    # symlink this checkout into your VS Code extension folders; then reload the window
make package    # build roost-<version>.vsix
```

`make test-live` adds Perch's live tests, one tiny turn through each agent with your real logins.

## Adding a part

A part is a folder under `parts/` with a `part.json` beside its own `package.json`:

```json
{ "id": "demo", "title": "Demo", "entry": "src/extension.js", "needs": [] }
```

Run `make manifest`: the root `package.json` is generated from the parts (never edit it by hand), and the new
part gets its switch and its views with no other file edited. Then `make test`.

## Companion extensions

Installing Roost also installs, through its extension pack:

- **Claude Code** and **ChatGPT**: Perch runs the `claude` and `codex` programs they ship.
- **perch-audio**: dictation's recording companion, which runs on your own machine even when VS Code is attached
  to a remote one.

## Licence

MIT. See [LICENSE](LICENSE).

## Design

[docs/notes/101-roost.md](docs/notes/101-roost.md): what Roost is, how it was built, and what was verified.
