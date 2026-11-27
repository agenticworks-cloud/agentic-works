# Sign in to Teams

If your company has set up Agentic Works and one of its tools keeps the Teams sign-in (`teams.signIn.tokenFile`), **Sign In
to Teams** opens **Connect Your Tools** and signs in that tool's row instead. The step ticks by itself once that
sign-in is done: Teams uses the same login.

Otherwise, **Sign In to Teams** runs **Teams: Sign In**, which opens your browser on Microsoft's sign-in page. Sign
in with your work account, the way you do for Outlook or Teams on the web. Your company decides how: a password and
the Authenticator app, a passkey or a security key; **Other ways to sign in** lists the others. Then come back to VS
Code.

The first time, Microsoft asks to allow **chirp**, the app Teams signs in with. If it shows **Need admin approval**
instead, your company lets only its admins approve apps: ask your IT team to approve chirp (or use **Request
approval**, if the page offers it). Until then Teams stays signed out, and the rest of Agentic Works works as usual.

If your company has its own approved app for Teams: in the **Teams** view, click **Use your company's app** (or run
**Teams: Use a Company Microsoft App…**), enter the two IDs from your IT team, then click **Save and sign in**. Teams
then signs in with that app. With a company app, Teams shows a sign-in code: click **Copy Code and Open Sign-in Page**,
paste the code on Microsoft's page and sign in.

Along the way Microsoft may show **Let's keep your account secure**, asking you to set up another way to verify. That
is Microsoft's own prompt, not something Teams needs: click **Not now** to carry on.

If you close the browser before you finish, click **Cancel** on VS Code's "Signing in to Microsoft…" notification and
try again.

Personal Microsoft accounts aren't supported.

This step is ticked once Teams is signed in. The **Teams** view in the activity bar then lists your chats. Opening one
shows it in a tab, where you can read and reply.
