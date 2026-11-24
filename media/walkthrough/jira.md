# Connect Jira and Confluence

1. **Jira: Site URL**: your Atlassian site, for example `https://yourcompany.atlassian.net`.
2. **Jira: Sign In**: asks for your site, your Atlassian email and an
   [Atlassian API token](https://id.atlassian.com/manage-profile/security/api-tokens) (create one there, then paste it).
   It checks them with Jira before keeping them; the token goes in VS Code's secret storage.

This step is ticked once Jira is signed in. The **Jira and Confluence** view in the activity bar then lists your
tickets; **Jira: Open Ticket** and **Jira: Open Confluence Page** open one by key or link.
