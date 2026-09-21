# Forward your support inbox

Your customers keep emailing the address they already know. Forward that address
to ReplyMaven and every message becomes a conversation Maven can answer, with
your team able to step in at any point.

Nothing changes about where your mail is hosted. You are adding a forwarding
rule, not moving your email.

Copy your forwarding address from **Tools → Email** in the dashboard. It looks
like `yourproject@updates.replymaven.com`.

## A note on verification codes

Most providers send a confirmation code to the address you forward to, and ask
you to enter it before forwarding starts.

That code will arrive in ReplyMaven. Open your inbox, find the new conversation
from your email provider, and copy the code out of it. This is expected, and it
only happens once per address.

Google Workspace admin routing and Microsoft 365 admin rules skip this step.

## Gmail

1. Open **Settings → See all settings → Forwarding and POP/IMAP**.
2. Select **Add a forwarding address** and paste your ReplyMaven address.
3. Google emails a confirmation code. Find it in your ReplyMaven inbox and enter it.
4. Choose **Forward a copy of incoming mail to**, and pick what happens to the
   Gmail copy. Keeping it in the inbox is the safe choice while you try this out.
5. Save.

To forward only some mail, create a filter instead and tick **Forward it to**.
This is the right approach if `support@` is an alias on a personal mailbox.

## Google Workspace

If you administer the domain, route it centrally instead of per user.

1. In the Admin console, open **Apps → Google Workspace → Gmail → Routing**.
2. Add a rule, match the recipient `support@yourdomain.com`, and add your
   ReplyMaven address as an additional recipient.
3. Save. There is no confirmation code for admin routing.

Group addresses work too: open the group in **Directory → Groups**, then add
your ReplyMaven address as a member with delivery enabled.

## Outlook and Microsoft 365

1. Open **Settings → Mail → Forwarding**.
2. Tick **Enable forwarding** and paste your ReplyMaven address.
3. Decide whether to keep a copy. Keeping one is recommended at first.
4. Save.

Administrators can instead use a mail flow rule in the Exchange admin center,
under **Mail flow → Rules**, which avoids the per-mailbox setting.

## Apple Mail and iCloud

Apple Mail on your Mac has no forwarding of its own. The setting lives in
iCloud, which holds the mailbox.

1. Sign in at **icloud.com** and open **Mail**.
2. Open **Settings → Forwarding**.
3. Tick **Forward my email to** and paste your ReplyMaven address.
4. Apple sends a verification message. Find it in your ReplyMaven inbox and
   follow it.

If your support address is an iCloud alias, forwarding applies to the whole
mailbox, not the single alias. Use a rule under **Settings → Rules** to forward
only messages sent to that alias.

## Proton Mail

Forwarding requires a paid Proton plan.

1. Open **Settings → All settings → Mail → Forwarding**.
2. Under **Forward emails**, add your ReplyMaven address.
3. Proton sends a verification email. Find it in your ReplyMaven inbox and
   confirm.

Proton forwards messages after decrypting them on their side, so end-to-end
encrypted mail from other Proton users cannot be forwarded automatically.

## Superhuman

Superhuman is a mail client that sits on top of a Gmail or Outlook account, so
it has no forwarding settings of its own. Set forwarding up in the underlying
account using the Gmail, Google Workspace, or Outlook steps above, and
Superhuman will keep working exactly as it does now.

## Any other provider

Any provider with a forwarding or redirect rule works. You need two things:

- Forward to your ReplyMaven address.
- Be able to read the verification code, which arrives in your ReplyMaven inbox.

## Checking it worked

Send a test email to your support address from an outside account. Within a
minute it should appear as a new conversation in your inbox, and the address it
was sent to is listed under **Tools → Email**.

If nothing arrives, check that the forwarding rule is active and that the
verification step was completed. Providers pause forwarding silently when a
confirmation is left unfinished.
