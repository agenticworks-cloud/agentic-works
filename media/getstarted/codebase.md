Codebase search gives Claude and Codex tabs a `codebase_search` tool. It searches your workspace by keywords, and by
meaning once that is installed, so a tab can find code by what it does when the names in the code aren't what you
would ask for.

It is off unless you turn it on. On a well-documented repository the agents find their answers as fast with plain
search, and the extra tool can cost them steps. It helps most in large or unfamiliar code.

- **Turn On** turns it on for every workspace; each tab takes it up from its next message. It needs Python 3.8 or
  newer.
- Searching by meaning uses a model that is installed separately, a one-time download of about 300 MB: run
  **Agents: Install Codebase Search by Meaning**. Until then it searches by keywords.
- **Not Now** leaves it off. **Agents: Toggle Codebase Search** changes it later.

Indexes are kept in `~/.cache/codebase-index/`.
