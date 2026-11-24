# Search your code (optional)

Codebase search gives Claude and Codex tabs a `codebase_search` tool. It searches your workspace by keywords, and by
meaning once that is installed, so a tab can find code by what it does when the names in the code aren't what you'd ask
for.

It is **off** unless you turn it on. On a well-documented repository the agents find their answers as fast with plain
search, and the extra tool can cost them steps; it helps most in large or unfamiliar code.

- **Turn On Codebase Search** turns it on for every workspace. Each tab takes it up from its next message. It needs
  Python 3.8 or newer; you're told if none is found.
- **Search by meaning** needs a one-time download of about 300 MB: run **Agents: Install Codebase Search by Meaning**
  once codebase search is on.
- **Not Now** leaves it off. You can turn it on later with **Agents: Toggle Codebase Search**, or for one folder from a
  tab's footer.

Indexes are kept in `~/.cache/codebase-index/`.
