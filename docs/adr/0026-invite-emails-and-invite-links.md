# Invite emails through Cloudflare Email Service, and invite links with hashed tokens

Inviting the other Parent used to send nothing. They had to find Noodle and sign in with exactly the address they were invited with (#60). Now inviting emails them a link, and the link works whatever email they sign up with.

**Sending.** Email goes out through Cloudflare Email Service's `send_email` binding, `EMAIL` in apps/web/wrangler.jsonc. It needs no API key. The binding may only send from `hello@noodle.yogan.dev` (`allowed_sender_addresses`). That address is the `EMAIL_FROM` var, and mail shows as from "Noodle". All sending goes through one function, `sendEmail` in apps/web/src/server/email/send.ts. It never throws. It returns ok, or a plain failure ("not-set-up" or "failed") that the caller can show. A failed invite email doesn't undo the invite: Household says "Couldn't send. Copy the link instead." and shows the link. The Check-in's email summary uses the same function and sender. It used to wait for a `CHECK_IN_EMAIL_FROM` var, so once the binding is live in production, Check-in emails start going out too.

**Templates.** Every email lives in apps/web/src/server/email/templates.ts: a shared layout (`emailHtml`) and one function per email, each giving a subject, a text part and an HTML part. The HTML sets no page or card background and leaves body text in the mail app's own colour. That way a mail app that darkens messages can't leave dark text on a dark page. Only the button is filled: brand blue with white text, which reads on light and dark. The small print is a mid grey that is readable on both. Long links wrap anywhere so they can't widen the email on a phone. The templates have vitest snapshot tests for HTML and text. The invite email says "{Name} invited you to plan {Household}'s money together on Noodle", says what Noodle is in one line, has a "Join {Household}" button, and says "This link works for 7 days." It never includes amounts or any Household data beyond its name. The Check-in email (check-in-email.ts) can move into the shared layout later.

**The stub.** With `AI_MODEL=stub` (E2E), or in local dev without the binding, nothing is sent. Each email is written to the local R2 bucket under `dev-outbox/<address>/`, so it survives a reload of the dev server. E2E reads it from `GET /api/dev/outbox?to=<address>`. The route only exists when `__AI_STUB__` is true at build time, so production builds don't have it. In the stub, sending to `fail@example.com` fails, so the "Couldn't send" path can be tested.

**Links.** Invite links are built server side as `<origin>/invite/<token>`. In production the origin is `APP_ORIGIN` (https://noodle.yogan.dev). In dev and E2E it's the origin the app was opened at, because the `APP_ORIGIN` var still names production there.

**Invite tokens.**
- A token is 32 random bytes from `crypto.getRandomValues`, written as base64url (43 characters).
- Only its SHA-256 hash is stored (`invites.token_hash`, unique). The token itself is shown once, in the email and in Copy link, and Noodle can't show it again.
- Lookups go by hash. The stored hash is then compared again in constant time.
- A link works once. It expires 7 days after inviting (`invites.expires_at`). It stops working if the invite is replaced or the Household already has both Parents (`MAX_PARENTS`). There is still one open invite per Household.
- Opening the link signed out leads to sign-up with the invited email filled in. Signed in with a different email, Noodle asks "This invite was for a@b.com. Join anyway?". Signing in with the invited address still finds the invite on Welcome.
- The token code is in packages/db/src/invite-token.ts, with its unit tests.

**Production setup** (done by hand, once):
1. Onboard the sending domain: `npx wrangler email sending enable noodle.yogan.dev`, run from apps/web. You can also do it in the dashboard under Email Service > Email Sending. yogan.dev is already a zone on the account.
2. Add the DNS records Email Sending asks for (SPF, DKIM and the bounce/return-path MX records) on noodle.yogan.dev. Cloudflare adds them itself when the zone is on Cloudflare. Check with `npx wrangler email sending list` that the domain is verified. Add a DMARC record if yogan.dev doesn't have one (`_dmarc.yogan.dev TXT "v=DMARC1; p=none; rua=mailto:<you>"`).
3. Deploy (`bun run deploy` or the usual pipeline). The `send_email` binding and `EMAIL_FROM` var ship in wrangler.jsonc. No secrets are needed.
4. Send yourself an invite from Household in production and check that it arrives (inbox, not spam) and that the link opens.

**Left for later.** Household doesn't list invites with their sent and expiry times yet, and there's no Resend (rate-limited, minting a new token) or Cancel. The inviter isn't told yet when the other Parent joins.

## Resend, cancel and expiry (#60, phase c)

- **Household shows the open invite** with when it was last sent and when it runs out: "Sent 2 days ago · expires in 5 days". Past its expiry it says "The invite to a@b.com ran out on Oct 9" and still offers Resend.
- **Resend makes a new link.** Only a hash is stored, so the old link can't be sent again: Resend mints a new token, replaces the hash (the old link then finds nothing and says it doesn't work), starts the 7 days again and emails it. Copy link shows the new link right after; after a reload the card says resending gives a new one.
- **Limits:** Resend waits a minute after the last email ("You can resend in a minute."), and a Household sends at most 5 invite emails per UTC day, new invites and resends together, so swapping emails doesn't get round it ("You've sent 5 invites today. You can send another tomorrow."). A new invite to a corrected email needn't wait the minute. Kept on the invite row (`sent_at`, `sends_that_day`), checked by `checkSend` in `invite-token.ts`.
- **Cancel** asks first, then deletes the open invite, so its link says it doesn't work. One open invite per Household and `MAX_PARENTS` are unchanged.
- **Telling the inviter:** accepting already calls `notifyHousehold(["parents"])`, so the inviter's open Household page shows the new Parent without a reload (tested in `invite.spec.ts`). No Nudge yet: a new Nudge kind needs its own preference, event and content, which is more than this change.
- **Dev seam:** with AI_MODEL=stub, `POST /api/dev/invite-age?to=&days=` moves an open invite's times back, so E2E can wait out the minute and see an expired invite. It isn't in production builds.
