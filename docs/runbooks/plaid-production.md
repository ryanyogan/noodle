# Moving to production Plaid (#70)

**Status: done.** The deployed app has been on production Plaid since 2026-10-05, when a Parent connected the first real bank (Chase, which logs in on its own page: OAuth) from the installed app on a phone. Parts 1 and 2 are kept as the record of how it was done and for doing it again (a new Plaid team, say); "Since the switch" below is what's still to do and how to look after it.

Dev keeps Plaid Sandbox through `.dev.vars`, E2E keeps the fake (`plaid-fake.ts`), and only the deployed app moved. Never paste a Plaid secret into a chat, an issue, a file or a commit: it goes in at the `wrangler secret put` prompt and nowhere else.

## Part 1: the Parent (step 2 of the rollout)

In the Plaid dashboard (dashboard.plaid.com), signed in to the Noodle team:

1. **Application profile.** Fill it in: app name "Noodle", website `https://noodle.yogan.dev`, what it does ("a household budget; reads balances and Transactions, read-only, never moves money"). Answer the security questionnaire if Plaid asks for it.
2. **Company information.** Legal name and address. Link shows this to whoever connects a bank.
3. **Link customization.** Name "Noodle", the Noodle logo (the app icon), and the brand colour. Then, in the same customization, **Data Transparency Messaging: choose at least one use case** (what Noodle uses the data for, such as tracking and managing finances). Publish the customization. Without a use case Plaid refuses every production link token (`/link/token/create` answers "At least one Data Transparency Messaging use case is required to be configured"), so pressing Connect a bank shows "Couldn't connect account" and Plaid's window never opens. Sandbox doesn't ask for it, which is why this was missed and stopped the first try on 2026-10-05. `npx wrangler tail` from `apps/web` shows Plaid's sentence when it happens.
4. **Allowed redirect URIs** (Developers, API): add exactly `https://noodle.yogan.dev/bank/return`, and save. No wildcard, no trailing slash, no `#`. Every link token names this address (`redirect_uri`), and Plaid refuses a link token whose address isn't on this list, so no bank can be connected until it's there.
5. **OAuth institutions** (the US OAuth institutions page): request access for Chase, Wells Fargo, Bank of America, Capital One and any other bank the Household uses. Chase can take several days; the page shows each one's status. Banks not yet approved can't be connected until they are.
6. **The production secret.** In Developers, Keys, copy the production secret. Then, in a terminal at `apps/web` of the repo:

   ```sh
   npx wrangler secret put PLAID_SECRET
   ```

   and paste it at the prompt. `PLAID_CLIENT_ID` and `BANK_CONNECTION_KEY` stay as they are. Tell the lead it's done (not the secret).

From the moment the secret is put until the lead's switch is deployed, the app still names Sandbox with a production secret, so Plaid refuses its keys (`INVALID_API_KEYS`). That's expected: Connect says Plaid isn't set up, the daily sync says the same on each Bank Connection, and nothing breaks. Do step 6 when the lead is ready to switch.

## Part 2: the lead (steps 3 to 5)

3. **Switch.**
   1. Read-only: list production's Bank Connections (the `SELECT` at the top of `apps/web/scripts/plaid-retire-sandbox.sql`). Decide with the Parent whether the practice Transactions are deleted now or left for the Fresh start (#63).
   2. Take the switch time: `date +%s%3N`. Put it in both `__SWITCH_MS__` in `plaid-retire-sandbox.sql` (don't commit that edit), then run it against remote D1 as its header says. Run the `SELECT` again: nothing should be left.
   3. In `apps/web/wrangler.jsonc` `vars`, set `"PLAID_ENV": "production"`. Commit, CI green, push, deploy. (At the 2026-10-05 switch a `PLAID_SANDBOX_RETIRED` var was set too, so that Accounts said "Connect your real bank" until one was. It and that message were removed once the real bank was connected; a Household whose Bank Connections have all ended sees each one say to connect the bank again, and Connect a bank.)
4. **First real bank.** The Parent connects one real bank at noodle.yogan.dev on a computer, and one OAuth bank (Chase, say) in the installed app on the iPhone; each should come back to where it started (Accounts or the get-started wizard). Watch `npx wrangler tail` from `apps/web`: `plaid-link` lines, the Import, then a `plaid-webhook` line (`SYNC_UPDATES_AVAILABLE`, outcome `synced`). The first import reads as far back as the Parent chose before Link opened (issue 89; "This month only" to begin with, a year at most), over several rounds a minute apart when it's long. Next day, check it synced again on the next webhook, and look at the Review rate on the real merchant names (#58).
5. **Close out.** Tick #70's acceptance, and update ADR-0017's status line and the README's setup notes. Done 2026-10-05.

**Rolling back:** set `PLAID_ENV` back to `"sandbox"` and `npx wrangler secret put PLAID_SECRET` with the Sandbox secret, then deploy. Bank Connections made against production stop working under Sandbox, as the Sandbox ones did here.

## Since the switch (2026-10-05)

What happened, and what a Parent can do now:

- **The first real Bank Connection** was Chase, through its own login (OAuth) and back by `/bank/return`, from the installed app on a phone. The first try failed for want of a Data Transparency Messaging use case (Part 1, step 3); once one was published it worked with no change to the app.
- **How far back Transactions come** is the Parent's choice, asked before Link opens for a new Bank Connection: this month only, or the last 30, 60, 90, 120 or 365 days (issue 89, ADR-0017). It can't be changed afterwards for that Bank Connection.
- **Unlinking one Account from its bank, and archiving an Account,** both exist (issue 94, ADR-0046), on the Account's page under More.
- **The practice Accounts left from Sandbox** ("Plaid Checking ··0000", "Plaid Saving ··1111" and the like) are still in the real Household. Nothing in the code removes them: a Parent opens each one's page, then More, then "Archive this Account". Its Transactions and history stay; it leaves Accounts, the totals and the pickers.

### Rotating the Plaid secret

**Due now:** the production secret was pasted into a chat on 2026-10-05, so it must be replaced. Only the Parent can do this, and the value goes nowhere but the prompt.

1. In the Plaid dashboard (Developers, Keys), make a new production secret. Leave the old one in place for now.
2. In a terminal at `apps/web`:

   ```sh
   npx wrangler secret put PLAID_SECRET
   ```

   and paste the new secret at the prompt. This takes effect at once; no deploy is needed.
3. Check it: on Accounts, press Connect a bank, choose how far back, and see Plaid's window open (then close it; nothing is connected). That proves the new secret, since the link token is made with it. The Bank Connection's "Last updated" should also move by the next day, at the 09:00 UTC sync if no webhook comes first. `npx wrangler tail` shows `INVALID_API_KEYS` if the paste went wrong, and the app says Plaid isn't set up until it's put right.
4. Back in the dashboard, delete the old secret. Bank Connections are untouched: their access tokens belong to the Plaid team (`PLAID_CLIENT_ID`), not to the secret, so nobody reconnects.

`PLAID_CLIENT_ID` and `BANK_CONNECTION_KEY` stay. Never replace `BANK_CONNECTION_KEY`: it seals every stored bank credential, and a new one would make every Bank Connection unreadable. A Sandbox secret in a developer's `.dev.vars` is a different secret and is rotated the same way in the dashboard's Sandbox row.

## How Link opens, and the phone check (#70)

Link is Plaid's own window: it draws itself in a frame over the whole Noodle window and can't be put inside a sheet of ours (Plaid's web Link has no "render into this element" option; its embedded view is only the bank search, and the login still opens the same full window). What Noodle does around it (`bank-link-run.ts`, `bank-link-frame.ts`):

- The link token is made when the Parent presses Connect; the button shows a spinner until Link says it has loaded, then Link opens, once. A second press can't open another.
- Link's frame is held inside the safe area (clear of the notch and the home indicator). On a phone a bar of Noodle's own sits above it with **Close**, which asks Link to exit and takes it down after a second and a half if it doesn't. Back and Escape do the same.
- When Link is gone the page scrolls again and the button that opened it has the focus.

**Banks that log in on their own page or app (OAuth), in the installed app.** Plaid opens the bank in a new tab where it can; in the installed app there are no tabs, so it either shows the bank in an in-app browser sheet over Noodle or leaves for the bank's page (or the bank's own app). The bank then sends the Parent to `https://noodle.yogan.dev/bank/return?oauth_state_id=…`, where Link is made again with the same link token and that address (`receivedRedirectUri`) and finishes; the Parent lands on the page they started from with Choose Accounts open. If that address opens in Safari rather than the installed app (iOS decides; a bank's app handing back usually does this), it still finishes there: Noodle keeps the link in progress on the server for the signed-in Parent (`getBankLinkSession`), so nothing is lost as long as Safari is signed in to Noodle. The Bank Connection then shows in the installed app the next time Accounts is opened. Noodle can't force iOS to return to the installed app: universal links are for native apps only.

**Check by hand on the iPhone, in the installed app** (Sandbox first, then again after the switch). Tests use a stand-in for Link, so none of this is proven until it's done:

1. Accounts, Connect a bank: the spinner, then Link. Noodle's bar with Close is fully below the notch; Link's own header and X are visible under it; nothing is under the home indicator.
2. Close (Noodle's): back on Accounts, which scrolls. Open again, Link's own X: the same. Open again, swipe back from the left edge: the same.
3. Go through a non-OAuth bank (Sandbox: "First Platypus Bank", `user_good` / `pass_good`): the keyboard doesn't cover the fields, and it ends with Choose Accounts.
4. An OAuth bank (Sandbox: "Platypus OAuth Bank"; production: Chase): note where the bank's page opens (a sheet, Safari, or the bank's app) and where it comes back. It should end on Accounts with Choose Accounts open, in the installed app or in Safari. If it comes back to Safari signed out, sign in there and it shows "That bank isn't connected yet": start again from the installed app and tell the lead, with the bank's name.
5. Turn the phone sideways with Link open: Link stays clear of the notch on the side.
