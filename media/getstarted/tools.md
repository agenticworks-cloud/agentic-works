These are the tools {{title}} has set up for Claude: MCP servers, such as its docs, mail or tickets. There is one row
for each, saying what it is for and whether it is connected. Each signs in its own way, and its row shows the button it
needs:

- **Open the page**, then paste the token it gives you and press **Check and save**. The token is kept in
  `~/.config/roost/tokens/`, readable by you alone.
- **Connect**, which runs the tool's own sign-in in a terminal.
- **Connect**, which shows a code: **Copy code and open**, then paste the code on the page that opens.
- **Connect** alone: nothing to sign in to; the tool is checked.

A tool that isn't on this computer yet is downloaded first, with your GitHub sign-in. Once its check passes, every
Claude tab, and `claude` in a terminal, can use it. If Claude Code already has another server of that name, the row
offers **Replace**.

This step is ticked once every tool is connected, or with **Not Now**. **Roost: Connect Your Tools** shows the same
rows later.
