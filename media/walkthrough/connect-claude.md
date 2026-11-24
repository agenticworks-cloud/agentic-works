# Connect Claude

**Connect Claude** opens a small panel with the ways Claude can run. Pick one; new Claude tabs then run on it. This
step is ticked once Claude is connected, or when you press **Not Now**. You can open the panel again at any time with
**Agents: Connect Claude…**.

- **Your company's gateway**, when your company has set one up for Roost (it is then first, and marked
  Recommended), or **an LLM gateway** otherwise: an Anthropic-compatible endpoint, such as a company's LLM proxy.
  This opens **Agents: Set Up a Gateway…**, where the key is checked with the gateway before it is saved. A
  company's gateway may have more than one address; each Claude tab finds the one that answers as it starts.
- **Claude subscription**: your Claude plan. If this machine isn't logged in yet, Claude Code's own sign-in opens in
  a terminal, and the panel notes when it is done.
- **Anthropic API key**: billed per token. Paste the key; it is checked with Anthropic first, then kept in
  `~/.config/roost/anthropic-key`, readable by you alone (mode 0600). Claude tabs are given it in their environment.
- **AWS Bedrock**: an AWS profile or SSO sign-in already on this machine, and a region. It is checked with the AWS
  CLI's list of Anthropic models; without the AWS CLI it can't be checked, and **Save anyway** saves it unchecked. If
  your sign-in has run out, the panel names the `aws sso login` to run.
- **Codex only**: no Claude. Codex tabs work as they always do.

Only Claude tabs use the choice. `claude` in a terminal, and Claude Code's own settings
(`~/.claude/settings.json`), are left as they are, unless you tick **Use for `claude` in the terminal too**. Then
the choice is written to that file as well: a value you already have there is shown, and replaced only if you
press **Replace**; **Keep Mine** leaves it. A file that isn't plain JSON (comments, say) is never rewritten.

Any Claude tab can still be moved to another backend from the menu in its footer; new tabs then follow that choice.
