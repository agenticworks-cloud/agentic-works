The **PRs** tab, in the bottom panel, lists the pull requests that need you. It uses the GitHub CLI's sign-in.

**Sign In to GitHub** opens a terminal running `gh auth login`. Answer its questions there; it usually opens your
browser to finish. While the terminal is open, this step says it is waiting. When it closes, the step says who you
are signed in as, and the PRs tab fills in. **Add Another Account** signs in one more.

With your company's setup this step comes first: tools your company set up for Claude may be downloaded from GitHub
with this same sign-in, in **Connect your tools**.

This step is ticked once `gh` has a login.

Git uses this sign-in over HTTPS, so you don't need an SSH key. A repository that shows a `git@github.com:` address
can be cloned from its `https://github.com/` one instead, or add a key with `gh ssh-key add`.

No `gh`? Install it from [cli.github.com](https://cli.github.com), or let the Roost installer install it; the sign-in
is still left to this step.
