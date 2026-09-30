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

Considered: keeping SimpleFIN as a fallback (no longer needed, and it doubled the provider surface), and collapsing the seam into Plaid calls (it keeps the Import Workflow and the tests independent of Plaid's shapes, and costs little).
