Before a message goes to Claude or Codex, it is checked for something that looks like a password or key: an
Anthropic, OpenAI, GitHub, AWS, Slack or Google key, a signed token, a private key, a password in an address, a
`password = …` line, or a long random-looking string. A key sent by mistake would reach the model and the session's
record, which can't be taken back. The check runs in the tab, on the text alone, and is on unless you turn it off.

When something is found the message waits in the box, the match is highlighted, and you choose:

- **Send anyway** sends it as it is; the same text isn't flagged again in that tab.
- **Not a secret** sends it and remembers the value everywhere, for a test value that only looks like a key. Only a
  hash of the value is kept. **Agents: Clear Secret-Check Exceptions** forgets them all.
- **Off for this repo** turns the check off in that folder's `.vscode/settings.json`, then sends.
- **Edit** puts you back in the box.

For a family of values that are never secrets, such as a trace-id or test-fixture format, list regular expressions
in the **agents.secretCheck.ignore** setting: a value one of them matches in full is never flagged.

**Keep it on** or **Turn it on** finishes this step; **Not Now** leaves the check as it is.
