# Connect your tools

Your company has set up some tools for Claude: MCP servers, such as its docs, mail or tickets. **Connect Your Tools**
opens a panel with one row for each, saying what it is for and whether it is connected. Each one signs in its own
way, and the row shows the button it needs:

- **Open the page**, then **Check and save**: the page gives you a token. Paste it in the row; it is checked with the
  tool first, then kept in `~/.config/roost/tokens/`, readable by you alone.
- **Connect**, which opens a terminal: the tool's own sign-in runs there. The row notes when it is done.
- **Connect**, which shows a sign-in code and a link: **Copy code and open** copies the code and opens the page;
  paste the code there and sign in.
- **Connect** alone: nothing to sign in to; the tool is checked.

A tool that isn't on this computer yet is downloaded first, when you press its button: from your company's GitHub
releases, with your GitHub sign-in (the **Sign in to GitHub** step). Not signed in yet, the row says so and offers
**Sign In to GitHub**; if there is no download for this kind of computer, the row says that too.

Once a tool's check passes, Claude Code is given it, for every Claude tab and for `claude` in the terminal. If Claude
Code already has a different server of the same name, the row says so and offers **Replace**; until then that tool
is not connected.

This step is ticked once every tool is connected, or when you press **Not Now**. You can open the panel again at any
time with **Roost: Connect Your Tools**.
