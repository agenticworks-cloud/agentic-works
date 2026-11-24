# Connect Jira and Confluence

**Connect Jira** opens the **Jira and Confluence** view in the activity bar, with a sign-in form:

1. **Site URL**: your Atlassian site, for example `https://yourcompany.atlassian.net` (filled in when `jira.site` is set).
2. **Atlassian account email**: the email you sign in to Atlassian with.
3. **API token**: **Create one** opens Atlassian's
   [API tokens page](https://id.atlassian.com/manage-profile/security/api-tokens); create a token there, then paste it.

**Sign in** checks them with Jira before keeping them; the token goes in VS Code's secret storage. If Jira says no,
the form says why, just under it.

This step is ticked once Jira is signed in. The view then lists your tickets; **Jira: Open Ticket** and **Jira: Open
Confluence Page** open one by key or link.
