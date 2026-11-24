# chirp

Microsoft Teams chats and channels in VS Code and Cursor. Chats and
channels get a sidebar of their own, and each conversation opens as an
editor tab you can read and type in.

chirp has no AI in it. An agent beside it (Claude Code, the Claude CLI,
or any agent that reads files) can read the conversation in front and
summarize it or draft a reply.

chirp is not made by or affiliated with Microsoft.

- **Sidebar:** chirp's icon in the Activity Bar. A filter box, then Chats
  (unread ones in bold, a red pulsing `@` on those that mention you),
  then Teams and Channels. The badge counts unread mentions.
- **Chat tabs:** messages as in Teams, with a message box. Enter sends,
  Shift+Enter adds a new line, and typing `@` offers the chat's members.
  Opening a chat marks it read in Teams, but only while its tab is
  visible and the window has focus.
- **Channel tabs:** one card per post, with its last two replies and a
  reply box, and a box at the bottom for a new post.

## Signing in

chirp signs in to Microsoft 365 with a **work or school account**.
Personal Microsoft accounts aren't supported. There are three ways to
sign in. The setting `teams.signIn.method` picks one; the default,
`auto`, picks for you.

| Way | `teams.signIn.method` | When to use it |
| --- | --- | --- |
| **The editor's Microsoft sign-in** | `editor` | The default. VS Code or Cursor shows its usual account prompt and keeps your sign-in. |
| **A sign-in code** | `deviceCode` | If the editor's sign-in isn't available. chirp shows a code; you enter it at microsoft.com/devicelogin. chirp keeps the tokens in the editor's secret storage. |
| **An existing token file** | `tokenFile` | If another tool already signs you in to Microsoft Graph and keeps its tokens in a file. Set `teams.signIn.tokenFile` to that file, and chirp reuses that login. |

With `auto`, chirp uses the token file if `teams.signIn.tokenFile` is set;
otherwise the editor's sign-in; otherwise a sign-in code.

During either browser sign-in Microsoft may show **Let's keep your account
secure**, asking you to set up another way to verify. That is Microsoft's own
prompt, not something chirp needs: **Not now** carries on with the sign-in.

### A company's own Microsoft app

By default chirp signs in with its own app, which Microsoft shows as
**chirp, unverified**. A company that lets only its admins approve apps
stops that sign-in at Microsoft's **Need admin approval** page. Either IT
approves chirp (**Copy admin link** gives them Microsoft's approval page
for the app in use), or your company uses an app of its own that it has
already approved. Two settings name it; your IT team provides both:

| Setting | What | Empty |
| --- | --- | --- |
| `teams.signIn.clientId` | the app's Application (client) ID, a GUID | chirp's own app |
| `teams.signIn.tenant` | your Directory (tenant) ID, or a domain such as `contoso.onmicrosoft.com` | `organizations`, any work or school account |

While signed out, the Teams view has a **Use your company's app** section
(collapsed until you open it, or until **Teams: Use a Company Microsoft
App…** or the hint's **Use a company app…** opens it): the Application
(client) ID, the Directory (tenant) ID or domain, and **Save and sign in**
(or Enter). chirp checks both, says inline what is wrong, writes them to
your user settings and signs in again; so does changing either in
Settings. With a company app set, the signed-out view says *Signing in
with your company's app (0123abcd…)*, with **Change** to edit it. Signed
in, the command says to sign out first. A value that is neither an ID nor a domain is ignored, with a
note above the lists. The settings are not used with a token file.

With a company app, chirp asks for exactly what your admins approved for it
(Microsoft's `.default` permission set) rather than its own list, so it never
asks for a permission the app lacks. Channels are tried, and switched off if
the app has no channel permissions.

With a company app, `auto` uses a sign-in code first, which only needs the
app to **allow public client flows**; if it doesn't, chirp tries the
editor's sign-in, which needs the app to accept VS Code's redirect. An
explicit `editor` or `deviceCode` is used as set. Sign-in-code tokens are
kept with the app that got them and never used with another.

Microsoft's "Need admin approval" page appears in the browser, and chirp
can't see it: on the editor's sign-in VS Code keeps waiting until you
click **Cancel**; with a sign-in code, the code runs out or is declined.
So after a sign-in that ends that way, the Teams view says *If Microsoft
said Need admin approval, your company has to approve the app first*,
with **Copy admin link** and **Use a company app…**. It isn't shown before
you have tried to sign in.

- **Commands:** **Teams: Sign In** and **Teams: Sign Out**, also in the
  sidebar's title bar.
- **Signing out** deletes the cached lists and the conversation files
  under `~/.chirp`, and chirp stays signed out until you sign in again.
  - With a sign-in code, it also deletes chirp's tokens.
  - With the editor's sign-in, the account stays in the editor's Accounts
    menu (remove it there if you want), but chirp stops using it.
  - It never changes a token file.
- **The token file** is JSON with `access_token`, `refresh_token`,
  `client_id`, `tenant_id` and `expires_at` (Unix seconds). chirp
  refreshes it in place, using that file's own `client_id`.

### Permissions, and what your admin may need to approve

chirp asks for these delegated Microsoft Graph permissions in two steps,
so chats never wait on channels:

| Step | Permissions | What they're for | Who can approve |
| --- | --- | --- | --- |
| Signing in | `User.Read`, `Chat.ReadWrite`, `ChatMessage.Send`, `Chat.Create`, `User.ReadBasic.All`, `offline_access` | your profile; reading your chats, sending, marking read; starting a 1:1 with someone found by name; staying signed in | usually you, if your company lets users approve apps |
| **Enable channels** (a button in the sidebar) | `Team.ReadBasic.All`, `Channel.ReadBasic.All`, `ChannelMessage.Read.All`, `ChannelMessage.Send` | your teams and channels, reading and posting in them, channel mentions | `ChannelMessage.Read.All` needs an admin |

- If your company requires an admin to approve chirp, send them this link:
  `https://login.microsoftonline.com/organizations/adminconsent?client_id=5d0faf94-77bc-41c5-8c4f-73bacc2040ff`
  (also under **Copy admin link** in the sidebar).
- chirp's app is from an unverified publisher. Many companies block
  users from approving such apps, and there even the first step needs an
  admin.
- With a token file, chirp has whatever permissions that tool's login
  has. If channels aren't among them, the sidebar says so.

## What chirp writes to disk

Each open conversation is written as plain text to `~/.chirp/chats/` or
`~/.chirp/channels/`, and `~/.chirp/current.teams` is the one most
recently in front. The files are readable only by you. This lets an
agent beside chirp know which conversation you mean by "the chat". Set
`teams.agentFiles` to `false` to turn it off; the files are deleted
when you do.

## Install from source

```
make install     # links this checkout into VS Code / code-server; reload the window
make test        # offline tests: no network
make package     # a .vsix
```

Setup notes: [docs/notes/901-setup.md](docs/notes/901-setup.md).

## Design

What chirp is for and the decisions behind it:
[docs/notes/101-design.md](docs/notes/101-design.md), and sign-in in
[docs/notes/201-sign-in.md](docs/notes/201-sign-in.md).

## License

MIT
