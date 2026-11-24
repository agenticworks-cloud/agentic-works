The **Jira and Confluence** view lists your tickets, and **Jira: Open Ticket** and **Jira: Open Confluence Page** open
one by key or link.

To sign in, fill in the form here:

1. **Site URL**: your Atlassian site, such as `https://your-site.atlassian.net`. It is filled in when `jira.site` is
   set.
2. **Email**: the one you sign in to Atlassian with.
3. **API token**: **Create one** opens Atlassian's
   [API tokens page](https://id.atlassian.com/manage-profile/security/api-tokens). Create a token there and paste it.

**Sign in** checks them with Jira before keeping them; the token goes in VS Code's secret storage. If Jira says no,
the reason shows under the form.

If one of your company's tools keeps the Jira sign-in, this step shows that tool's row instead. If
`jira.signIn.tokenFile` is set, **Sign In** uses that file.

This step is ticked once Jira is signed in.
