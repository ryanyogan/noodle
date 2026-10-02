# Plaid is the only Bank Connection provider, on its Trial plan

Bank Connections go through Plaid and nothing else. SimpleFIN (#18) was added as a fallback in case Plaid production access was slow to come. It isn't: Plaid's Trial plan gives new US accounts free production access with no business registration or sales process. It allows up to 10 Items, with uncapped calls against connected Items, and covers Transactions, Balance and Liabilities. OAuth works at Chase, Bank of America, Wells Fargo, Capital One, Citi and Amex. One Household needs far fewer than 10 Items. A second provider was a second thing to maintain and test and a second way into the Bank Connections UI, so it was removed (#45). Production held no SimpleFIN Bank Connections when it went.

The provider-neutral seam stays (`apps/web/src/server/bank-connection.ts`): Plaid is its one implementation, and nothing past it speaks Plaid. `bank_connections.provider` is narrowed to `"plaid"` in Drizzle only; the column is plain text in D1, so there was no migration. `notice` stays too: it now holds the `display_message` Plaid puts on an error for the end user, and a read that works clears it.

What an Item is shapes how the app behaves:

- An Item is one login at one institution, and it covers every account under that login. One Bank Connection is one Item.
- Removing an Item (`/item/remove`) does not give its slot back.
- Reconnecting must use Link's update mode, which keeps the same Item. A fresh Link would use another slot. Reconnect in the app does this; don't add a "remove and connect again" path.
- A joint account both Parents log into counts as two Items if both link it. Warning a Parent before they link an institution the Household already has is a possible follow-up.
- Development and E2E stay on Sandbox, which is free and unlimited. E2E (AI_MODEL=stub) uses a fake Plaid on top of that.
- Moving from Trial to Pay-as-you-go is one-way.

Production today runs against Sandbox: `PLAID_ENV` is `"sandbox"` in `wrangler.jsonc`, with the Sandbox `PLAID_SECRET`. Moving to the Trial plan means setting `PLAID_ENV` to `"production"` and replacing the `PLAID_SECRET` Worker secret with the production one (`wrangler secret put PLAID_SECRET`). `PLAID_CLIENT_ID` and `BANK_CONNECTION_KEY` stay. Access tokens are per environment, so Bank Connections made against Sandbox stop working after the switch and are connected again.

## Link, ready for production keys (#71)

- **Redirect URI.** Every link token names `${APP_ORIGIN}/bank/return` as its `redirect_uri` (`https://noodle.yogan.dev/bank/return`), which must be listed under Allowed redirect URIs in Plaid's dashboard. Banks that log the Parent in on their own page or app (OAuth: Chase, Capital One and the rest) come back by it. It's sent only when the app is being served from `APP_ORIGIN` over HTTPS, so a local copy sends none; `PLAID_REDIRECT_URI` names another registered address for trying OAuth locally against Sandbox.
- **The return route.** `/bank/return` makes Link again with the same link token and `receivedRedirectUri`, finishes as Link would have on the page (the token exchange, then Choose Accounts, ADR-0020; or a reconnect done), and takes the Parent back to where they started: Accounts, an Account's page or the get-started wizard. The link token and that page are kept in the tab's sessionStorage, and for the Parent in `bank_link_sessions` (one row per Parent, ignored once the token would have expired), for when the bank comes back in a browser that hasn't the tab's copy, as an installed PWA's can. With nothing to finish it says so and offers to start again.
- **Link tokens are made when the Parent presses Connect**, not with the page (they last 4 hours, 30 minutes in update mode). If Link still closes with `INVALID_LINK_TOKEN`, a new one is made and Link reopened, once.
- **Exits with an error** are said in plain words with a way forward ("Chase didn't respond. Try again, or upload a statement instead"), mapped from Plaid's error type and code (`apps/web/src/bank-link.ts`). Plaid's own text is never shown. In update mode the Reconnect button stays beside the message.
- **Event logging.** Link's `OPEN`, `SELECT_INSTITUTION`, `ERROR`, `EXIT` and `HANDOFF` events go to the Worker's logs as `plaid-link` lines, with `link_session_id` and `request_id` (what Plaid support asks for), any error type and code, the institution's Plaid ID and the Household's ID. No account data and no names.
- **The duplicate rule.** Before a public token is exchanged, the bank just linked is compared with the Household's Bank Connections: the same institution (by Plaid's institution ID, kept from now on in `bank_connections.institution_id`; by name for older ones) and no account there that the Bank Connection doesn't already list (by last digits). When it matches, the Parent is offered "You've already connected Chase. Reconnect it instead?", which is update mode on the Item they have. A second login at the same bank with other accounts isn't a duplicate, and a Parent can say "It's a different login" to connect it anyway. This is the warning the list above called a possible follow-up.
- **The script** is still loaded only when a Parent connects. A Content-Security-Policy, if one is ever added, must allow `cdn.plaid.com` for scripts and frames (noted where the script loads).

Considered: keeping SimpleFIN as a fallback (no longer needed, and it doubled the provider surface), and collapsing the seam into Plaid calls (it keeps the Import Workflow and the tests independent of Plaid's shapes, and costs little).
