Pick one way for Claude to run; new Claude tabs then use it.

- **An LLM gateway**: an Anthropic-compatible endpoint, such as a company's LLM proxy. Give its base URL and token.
  If the gateway answers oddly, **Save anyway** saves it unchecked.
- **Claude subscription**: **Log In** runs Claude Code's own sign-in in a terminal; this step says it is waiting
  until you finish.
- **Anthropic API key**: billed per token. The key is checked with Anthropic, then kept in
  `~/.config/roost/anthropic-key`, readable by you alone.
- **AWS Bedrock**: **Use Bedrock…**, then an AWS profile or SSO sign-in already on this machine, and a region. It is
  checked with the AWS CLI; without the CLI, **Save anyway**.

`claude` in a terminal is left as it is, unless you tick **Use for claude in the terminal too**. Values of yours
already in `~/.claude/settings.json` are shown first: **Replace** or **Keep Mine**.

Only using Codex? Press **Not Now** and open a Codex tab; its footer signs you in. Any tab's footer can move it to
another way later.

This step is ticked once Claude is connected, or with **Not Now**.
