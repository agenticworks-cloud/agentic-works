# Agentic Works

One VS Code extension with four parts:

- **Agents** (Claude Code and Codex): their sessions as editor tabs, side by side, any number of them.
- **Teams**: Microsoft Teams chats and channels, each conversation in a tab.
- **Jira & Confluence**: tickets and pages in tabs, with the space tree and your own work in the sidebar.
- **PRs**: your open pull requests in a panel tab, with their checks and reviews, and the chat that made each one.

Agents (the Perch icon), Teams and Jira & Confluence each have their own icon in the activity bar; PRs is a tab in
the bottom panel. Each part was a separate extension before (Perch, chirp, jay and kestrel); Agentic Works carries their
histories under `parts/agents`, `parts/teams`, `parts/jira` and `parts/pull-requests`.

## Install

In a terminal:

```sh
curl -fsSL https://agenticworks.cloud/install | bash
```

That is the latest release's `agentic-works-install.sh`; it is also on the
[releases page](https://github.com/agenticworks-cloud/agentic-works/releases). The design is
[docs/notes/101-agentic-works.md](docs/notes/101-agentic-works.md), the installer's
[docs/notes/102-agentic-works-installer.md](docs/notes/102-agentic-works-installer.md).

Run it without `sudo`: it asks for your password when it needs it, after listing what it adds system-wide. It:

- installs VS Code if it is missing (Homebrew on macOS, Microsoft's package repository on Linux) and puts `code` on
  the PATH;
- offers to uninstall the standalone Perch, chirp, jay and kestrel extensions, which would clash with Agentic Works;
- installs Agentic Works (checked against its SHA-256) and its companions, Claude Code, ChatGPT and perch-audio;
- installs the GitHub CLI, for the PRs panel (you sign in to GitHub from the Get started page, not the terminal);
- sets the look (Copilot off, no Welcome page, the activity bar on top) without overwriting a setting you made,
  and trims the activity-bar icons and the Claude Code and Codex buttons on editor title bars, on a VS Code that
  has never been started;
- opens VS Code, where Agentic Works' first start opens its Get started page (again any time: Agentic Works: Get Started).

It prints a ✓ / – / ✗ checklist and is safe to run again; a second run changes nothing that is in place. Running
the newest installer is also how Agentic Works is updated.

| Flag | |
|---|---|
| `--dry-run` | print each command instead of running it |
| `--skip <step>` | leave a step out (repeatable): `vscode path standalone extension companions claude git github homebrew settings icons open` |
| `--yes` | answer yes to uninstalling the standalone four (needed with no terminal) |
| `--no-open` | don't open VS Code at the end |
| `--codebase-search` | turn codebase search on in Claude and Codex tabs (off otherwise; the Get started page offers it) |
| `--teams-app <clientId>:<tenant>` | sign Teams in with your company's own Microsoft app: its Application (client) ID, then the Directory (tenant) ID or domain, from your IT team (written to `teams.signIn.clientId` and `teams.signIn.tenant` only when neither is set) |
| `--help` | the options |

Supported: macOS (arm64, x86_64); Ubuntu 22.04+ and Debian-based Linux; RHEL/Rocky 8 and 9; Fedora, on a desktop
where VS Code runs. Not Windows, and not a server reached over Remote-SSH. The design:
[docs/notes/102-agentic-works-installer.md](docs/notes/102-agentic-works-installer.md).

## Switching parts on and off

Open **Settings → Agentic Works** (the gear on the Perch view, the **Settings** row at the end of the Perch explorer, or
**Agentic Works: Settings** in the Command Palette). The first section holds one switch per part, all on by default:

| Part | Switch |
|---|---|
| Agents (Claude Code and Codex) | `agenticWorks.agents.enabled` |
| Jira & Confluence | `agenticWorks.jira.enabled` |
| PRs | `agenticWorks.pullRequests.enabled` |
| Teams | `agenticWorks.teams.enabled` |

A switch takes effect at once, with no reload. A part that is off shows no icon, panel tab or commands; its open
tabs close, and come back when you switch it on again. If an agent's turn is running, Agentic Works asks before stopping it.
A part that fails to start is reported once and left off; the others keep working. Each part's own settings
follow in a section of their own, under the part's name: `agents.*`, `teams.*`, `jira.*` and `pullRequests.*`, and
its commands are listed as **Agents: …**, **Teams: …**, **Jira: …** and **Pull Requests: …**.

These were `perch.*`, `chirp.*`, `jay.*` and `kestrel.*` in the standalone extensions. On its first start each part
copies any value you set under the old name to the new one, at the same level (user, workspace or folder), unless
the new one is already set there; the old entries stay in your `settings.json`, unused, for you to delete.

## First start

On its very first start Agentic Works opens the PRs tab once, so the bottom panel shows it, and its **Get started** page in
an editor tab. Open the page again any time with **Agentic Works: Get Started** in the Command Palette. It is Agentic Works' own
page, with each step's controls in place. A step shows while its part is on. Without a company file the steps run:
Connect Claude, Talk to Claude or Codex, Sign in to Teams, Connect Jira and Confluence, Sign in to GitHub, Search your
code by meaning, Choose your parts. With one: Sign in to GitHub, Connect Claude, Talk to Claude or Codex, Connect your
tools, Sign in to Teams, Connect Jira and Confluence, Search your code by meaning, Choose your parts. Connect your
tools appears only when the company file lists at least one `mcpServers` entry. The first step not yet done is open,
the others closed with their tick, and a step once done stays done. VS Code's own walkthrough is still there as a
fallback, on the Welcome page.

## For a company's installer

A company can set Agentic Works up for its people by writing one file, `~/.config/agentic-works/company.json` (the
`AGENTIC_WORKS_COMPANY_FILE` environment variable overrides the path). Agentic Works reads it at start; an invalid file is noted in
the Agentic Works output channel and ignored. Fields:

The file is rejected as a whole if anything in it is invalid (the Agentic Works output channel names the offending value,
such as `mcpServers[1].connect.kind`); unknown keys are ignored, and `~` expands in key files, commands and `doneWhen`
files. Required keys are marked **required**.

- `name` (**required**): the company's name.
- `title` (optional): a non-empty string; the Get started page reads "Get started with <title>" (default Agentic Works).
- `steps` (optional): `email`, `gateway`, `tools` and `talk`, each an optional non-empty string naming that step of
  the Get started page (defaults Your email, Connect Claude, Connect your tools, Talk to Claude or Codex).
- `notes` (optional): the company's own text at the top of a step's details, such as how its people get GitHub
  access: keys `github`, `email`, `gateway`, `talk`, `tools`, `teams`, `jira`, `secrets`, `codebase`, `parts`; each markdown of
  up to 2000 characters, rendered like Agentic Works' own (escaped, https links only). A bad one is ignored with a note.
- `email` (optional): `domain` (**required**, such as `example.com`), `env` (an upper-case environment variable
  name, not one the system uses) and `example` (the name part shown in grey before `@<domain>`, such as `first.last`;
  `your.name` without one). The Get started page then has an email step after GitHub's: a box showing
  `<example>@<domain>` in grey, **Save** (only an address on that domain; a bare name gets `@<domain>`) and **Not Now**. The address stays in Agentic Works' own storage,
  is never logged, starts the Jira step's email, and goes in `env` to the gateway's `keyCommand` and to the
  `command` sign-ins of `mcpServers` (their terminal's environment, never their command line), so they can fill it in.
  A bad section is dropped with a note, as `jira`'s is.
- `icons` (optional): the company's own mark in place of a vendor's, keyed `claude` or `codex`: an `.svg` or `.png`
  file beside the company file (or a `~/` path), or `{ "light": …, "dark": … }` for light and dark themes. The Agents
  pages (the New Claude Tab buttons, the + menu, the footer) show its shape in the theme's text colour, and the
  editor tabs show the file itself. A bad entry is dropped with a note; the rest stay.
- `gateway` (optional): `name` (**required**), `baseUrls` (**required**, a non-empty list of http(s) URLs, tried in
  order, so a VPN address can come first), `keyPage` (**required**, an http(s) URL where a person makes a key), and
  optional `requiredModel`, `env` (strings), `keyFiles` (other places the key is saved), `terminal` (true, so
  terminal `claude` is set up by default too), `openTabOnTalk` (true: once the gateway is ready, the Get started page's
  talk step opens a Claude tab on it by itself, in place of its New Claude Tab and New Codex Tab buttons) and `routerPrefixes` (non-empty strings: the gateway's model names that
  start with one are its routers, which pick a model for each request, and get a menu group of their own; none by
  default), and `keyCommand` (a non-empty array of strings, the program and its arguments, its first word an
  absolute path or starting with `~/`: a key helper that prints a fresh key on stdout and nothing else, progress and
  errors on stderr; exit 0 with a key, 2 when the person didn't finish signing in, anything else a failure). With a
  `keyCommand`, **Get a key** runs it (no shell, stdin closed, at most 12 minutes) and checks and saves the key it
  prints; when it can't, the step says why (the helper's last stderr line, key-shaped words masked), with **Try
  again** and the manual way (the key page, the key field, **Check and save**).
- `jira` (optional): `site` (an https URL, the company's Atlassian site) and `email` (the person's email), each
  optional, filled in on the Connect Jira and Confluence step so only an API token is left to type. A user-level
  `jira.site` setting wins over the file's site. Never a token: any other key is ignored. Unlike the rest of the
  file, a bad value here is dropped with a note in the Agentic Works output channel, and the rest of the file still loads.
- `mcpServers` (optional): a list of servers with distinct ids, each `{ id, name, about, register, connect }`.
  - `id` (**required**): letters, digits, `_` or `-`. `name` and `about` (**required**): strings.
  - `register` (**required**) is what Claude Code is given: `{ "type": "http", "url", "headers" }` or
    `{ "type": "stdio", "command", "args", "env" }`. `${token}` may appear only in a `tokenPage` server's http
    `headers` or stdio `env`, never in a URL, a command or its args.
  - `connect` (optional, default `none`) says how the server is signed in; `kind` is one of:

    | `kind` | Keys |
    | --- | --- |
    | `tokenPage` | `page`: an http(s) URL to open; the person pastes the token |
    | `command` | `command`: a non-empty array, the sign-in command run in a terminal; `doneWhen.file` (required): the file that appears once signed in |
    | `mcpTool` | `tool`: the server's own sign-in tool; `args` and `complete`: the arguments of the first and second call; `doneWhen.file`; needs a `stdio` `register` |
    | `none` | nothing to sign in |

    Any kind may also have `doneWhen` and a `check` that must pass before the row counts as connected. A `check` is
    one of three shapes: `{ "method", "url", "body" }` (a request), `{ "mcpTool", "args" }` (a tool call that needs
    the sign-in) or `{ "command": [ ... ] }` (a status command). A `command` row's check runs only once its
    `doneWhen.file` exists; before that the row says it isn't signed in yet. A `command` or `mcpTool` row may have
    `button` (1 to 40 characters), the label of its button in place of **Connect**; a bad one is ignored with a note.
  - `install` (optional): where the server's program comes from when it isn't there yet:
    `{ "github": { "repo": "owner/name", "tag": "latest", "assets": { "darwin-arm64": "<asset>", "darwin-x64": …,
    "linux-x64": …, "linux-arm64": … } }, "to": "~/.local/bin/<name>" }`. `tag` is `latest` (the default) or a
    release tag; `assets` names the release asset for each platform (a file name: no `/`, not starting with `-`);
    `to` is where it goes (`~` expands). When `to`, or a `stdio` `command` that is a path, is missing, **Connect**
    first downloads this computer's asset with `gh release download` (the person's GitHub sign-in, so a private
    repository works), puts it at `to` with mode 0755, then signs in. Not signed in to GitHub: the row says so, with
    a **Sign In to GitHub** button. A platform with no asset: the row says so.
- `skills` (optional): agent skills that come with the company's tools, each `{ "id", "source" }`. `id` is the
  skill's name (lowercase letters, digits and single hyphens, at most 64); `source` is a folder holding `SKILL.md`
  (`~` expands; a relative path is from the company file's folder). At each start Agentic Works copies each to
  `~/.claude/skills/<id>/` (Claude Code) and `~/.agents/skills/<id>/` (Codex), and records what it copied in
  `~/.config/agentic-works/skills.json`. It replaces or removes only a copy still as it left it: one the user edited, or a
  folder of that name it never wrote, is left alone, with a line in the Agentic Works output channel. A skill dropped from
  the file is removed at the next start. A source holding a link isn't used.

```json
{
  "name": "Example Co",
  "gateway": {
    "name": "Example gateway",
    "baseUrls": ["https://gateway.example.com", "https://gateway.vpn.example.com"],
    "keyPage": "https://keys.example.com",
    "requiredModel": "example-model",
    "keyFiles": ["~/.config/example/key"],
    "terminal": true,
    "routerPrefixes": ["example-router"]
  },
  "mcpServers": [
    {
      "id": "wiki",
      "name": "Wiki",
      "about": "Search the company wiki.",
      "register": { "type": "http", "url": "https://wiki.example.com/mcp", "headers": { "Authorization": "Bearer ${token}" } },
      "connect": {
        "kind": "tokenPage",
        "page": "https://wiki.example.com/tokens",
        "check": { "method": "GET", "url": "https://wiki.example.com/api/me" }
      }
    }
  ]
}
```

What Agentic Works does with it (the design and what was built: [note 101](docs/notes/101-agentic-works.md), the 0.4 and 0.5 bullets under Follow-ups):

- **Sign in to GitHub** is the Get started page's first step (without a company file it comes later), since a server's
  `install` downloads through that sign-in.
- The page's heading reads "Get started with" and the company's `title`; its Claude, tools and talk steps are named by
  `steps.gateway`, `steps.tools` and `steps.talk`.
- **Connect Claude** offers the company's gateway only. The other ways (a Claude subscription, an Anthropic API key,
  AWS Bedrock, and Codex's ChatGPT login, OpenAI API key or Bedrock) are a tab's footer away, whenever the person
  likes. With `gateway.terminal`, `claude` in the terminal uses the same connection, and its address in `~/.claude/settings.json` follows whichever of `baseUrls` answers.
- **Connect your tools** lists each MCP server, signs it in the way `connect` says, checks it, and registers it with
  Claude Code.

One sign-in can serve two uses: point `teams.signIn.tokenFile` or `jira.signIn.tokenFile` at the file the matching
server's sign-in writes, and the Teams or Jira step ticks by itself after Connect your tools.

A company installer runs Agentic Works' installer (`agentic-works-install.sh`) with `--no-open` and **never** `--yes`, which would
answer the standalone-four uninstall for the user. It refuses a machine it wasn't meant for rather than migrating it.

## Build and install

```sh
make deps       # npm ci for Agentic Works and every part
make test       # Agentic Works' tests, then each part's, then a check that package.json matches the parts
make install    # symlink this checkout into your VS Code extension folders; then reload the window
make package    # build agentic-works-<version>.vsix
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

Installing Agentic Works also installs, through its extension pack:

- **Claude Code** and **ChatGPT**: the Agents part runs the `claude` and `codex` programs they ship.
- **perch-audio**: dictation's recording companion, which runs on your own machine even when VS Code is attached
  to a remote one.

## Licence

MIT. See [LICENSE](LICENSE).

## Design

[docs/notes/101-agentic-works.md](docs/notes/101-agentic-works.md): what Agentic Works is, how it was built, and what was verified.
