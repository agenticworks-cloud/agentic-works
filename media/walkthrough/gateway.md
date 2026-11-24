# Use an LLM gateway (optional)

A gateway is an Anthropic-compatible endpoint that Claude Code can be sent to instead of Anthropic: a company's LLM
proxy, say, which gives you a base URL and a token. Skip this step if you don't have one.

- **Set Up a Gateway** opens a short form: the base URL, the token and, if the gateway names its models differently,
  the model names. **Save** writes them, and the form then offers **New Claude Tab on the Gateway**. This step is
  ticked once a gateway is saved.
- **Not Now** leaves it. You can set one up later with **Agents: Set Up a Gateway…**.

Only Claude tabs put on the gateway use it: their Claude Code process is given the gateway's variables. Claude Code's
own settings (`~/.claude/settings.json`) are left untouched, so other tabs and `claude` in a terminal go on as before.
Any Claude tab can be moved onto the gateway, or off it, from the backend menu in its footer.

The values are kept in one file, `~/.config/gateway-claude/env` unless the setting `agents.claude.gatewayEnv` names
another, as `export KEY=VALUE` lines a shell can read too. The token is kept in that file only, which is readable by
you alone (mode 0600); the form never shows it again, only that one is set, with **Replace**.
