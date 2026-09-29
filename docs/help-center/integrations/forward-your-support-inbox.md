# Forward your support inbox

Forward your existing support address to ReplyMaven. Maven can answer incoming email, and your team can take over from the private team thread. Your provider keeps hosting the mailbox.

Copy the forwarding address from **Settings → Channels → Email**. It looks like `yourproject@updates.replymaven.com`.

Forwarding setup depends on your email provider. For continuous delivery, use a provider-side forwarding rule. Desktop mail rules may stop when the mail app is closed.

## Confirmation messages

Some providers ask you to confirm a new forwarding address. The message is sent to the forwarding address, but ReplyMaven may filter automatic email. Do not rely on seeing it in the dashboard inbox. If it does not arrive, ask your email administrator about provider-side routing that does not require mailbox-level confirmation, or use a different supported forwarding setup.

After setup, send a normal test email from another account to your support address. Check **Settings → Channels → Email** for a recent received address. If the message does not arrive, check the provider's forwarding rule and spam folder.

## Gmail

1. In Gmail on a computer, open **Settings → See all settings → Forwarding and POP/IMAP**.
2. Choose **Add a forwarding address** and enter your ReplyMaven forwarding address.
3. Google sends its confirmation to the forwarding address. ReplyMaven may filter automatic messages, so do not rely on seeing the code in the dashboard. If it does not arrive, ask your Workspace administrator about a routing rule that fits your setup.
4. Return to Gmail settings. Choose **Forward a copy of incoming mail to** and select what Gmail should do with its copy. Keeping a copy in the inbox is a good first setting.
5. Save your changes.

To forward only selected messages, turn off all-message forwarding and create a Gmail filter with **Forward it**. See [Google's forwarding guide](https://support.google.com/mail/answer/10957?hl=en).

## Google Workspace

If you administer Google Workspace, you can route mail in the Admin console under **Apps → Google Workspace → Gmail → Routing**. Add the ReplyMaven address as a recipient for mail sent to your support address. Admin routing may not use the mailbox-level confirmation flow. Check your organization's delivery and routing rules before you enable it.

Group mail can include list headers that ReplyMaven filters. If you use a Google Group, send a normal test message and confirm it appears in the dashboard before relying on the route.

## Outlook and Microsoft 365

In Outlook on the web or new Outlook, open **Settings → Mail → Forwarding**, enable forwarding, enter the ReplyMaven address, and save. You can choose to keep a copy in the original mailbox.

A Microsoft 365 administrator can also create a mail flow rule in the Exchange admin center. See [Microsoft's forwarding guide](https://support.microsoft.com/en-us/outlook/mail/turn-automatic-forwarding-on-or-off-in-outlook).

## Apple Mail and iCloud Mail

Apple Mail can run a rule that forwards selected messages while the Mail app is open. It is not a server-side forwarding rule and may stop when the app is closed. See [Apple's Mail guide](https://support.apple.com/guide/mail/read-and-respond-to-emails-mlhlp1010/mac).

For an iCloud Mail address, set forwarding on iCloud.com under **Mail → Settings → Mail Forwarding**. You can forward the whole mailbox or create a rule for selected messages. See [Apple's iCloud Mail guide](https://support.apple.com/en-gb/guide/icloud/mm6b1a3960/icloud).

## Proton Mail

Automatic forwarding is available on paid Proton Mail plans. In Proton, open **Settings → All settings → Forward and auto-reply** and add a forwarding rule. Choose the source address and conditions, then send the confirmation request. The destination account must accept it before forwarding starts.

If you forward to a non-Proton address, end-to-end encryption is disabled for mail to and from that forwarding address. Proton says this does not affect encryption for your other Proton addresses. See [Proton's forwarding guide](https://proton.me/support/email-forwarding).

## Superhuman and other mail apps

Superhuman uses an underlying Gmail or Outlook account. Set the forwarding rule with that provider. Other mail apps may also depend on an underlying provider. Use the provider's server-side forwarding or redirect feature when available.

## Check delivery

Send a normal message to your support address from an outside account. Confirm that it appears as a new conversation in the dashboard. Reply to it and confirm that the response reaches the sender. Confirmation and automated messages can be filtered, so use a normal test message to verify the route.
