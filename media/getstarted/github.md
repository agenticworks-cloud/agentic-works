The **PRs** tab, in the bottom panel, lists the pull requests that need you. It uses the GitHub CLI's sign-in.

**Sign In to GitHub** starts GitHub's sign-in here, with no terminal and no questions: this step shows a one-time
code. **Copy code & open** copies it and opens GitHub's device page in your browser; paste the code there and approve
it. The step then sets git up to use the sign-in, says who you are signed in as, and the PRs tab fills in. **Cancel**
stops it; a code lasts 15 minutes. **Add Another Account** signs in one more.

With your company's setup this step comes first: tools your company set up for Claude may be downloaded from GitHub
with this same sign-in, in **Connect your tools**.

This step is ticked once `gh` has a login.

Git uses this sign-in over HTTPS, so you don't need an SSH key. A repository that shows a `git@github.com:` address
can be cloned from its `https://github.com/` one instead, or add a key with `gh ssh-key add`.

No `gh`? Install it from [cli.github.com](https://cli.github.com), or let the Roost installer install it; the sign-in
is still left to this step.
