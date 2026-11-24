# Sign in to GitHub

The **PRs** tab, in the bottom panel, lists the pull requests that need you.

It uses the GitHub CLI's sign-in. **Roost: Sign In to GitHub** opens a terminal running `gh auth login`. Answer its
questions there; it usually opens your browser to finish signing in. When it's done the terminal closes and the PRs tab
fills in, with every account you have signed in to.

With your company's setup, this step comes first: tools your company set up for Claude may be downloaded from
GitHub with that same sign-in (in **Connect your tools**).

This step is ticked once `gh` has a login.

No `gh`? Install it from <https://cli.github.com>, or with the Roost installer (which installs it, and leaves the
sign-in to this step).
