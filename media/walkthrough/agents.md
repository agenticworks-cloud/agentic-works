# Talk to Claude or Codex

Your first tab is already open, beside this page: a Claude tab, or a Codex tab if only Codex was signed in on this
machine. Type a message at the bottom of it and press Enter; this step is ticked once you've sent one, from either.

Either agent works the same way. A Claude tab is a real Claude Code session, a Codex tab a real Codex session, in an
editor tab: it reads and edits your workspace, runs commands when you allow it, and keeps its history across reloads.

- **Go to the Claude Tab** takes you to the tab that is open. **New Codex Tab** opens a Codex one.
- More tabs: **New Claude tab** or **New Codex tab** in the **Perch** view, or **Agents: New Claude Tab** and
  **Agents: New Codex Tab** in the Command Palette. With a gateway set up (the next step),
  **Agents: New Claude Tab on the Gateway** opens a Claude tab on it.
- Each tab's footer shows which backend it uses and the usage left.
- The **Perch** view in the activity bar lists your tabs and past sessions.

## Signing in

Each agent needs a sign-in the first time; a tab that has none offers it when you send your first message.

- **Claude**: **Agents: Log in to Claude (subscription)** signs in with your Claude account. Or use an API key:
  `ANTHROPIC_API_KEY` in the environment, or API / Bedrock credentials.
- **Codex**: its own ChatGPT sign-in, offered in the tab (**Log In** opens ChatGPT's sign-in page in your browser).
  Or **Agents: Set OpenAI API Key for Codex…** to run it on an OpenAI API key instead.
