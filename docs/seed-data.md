# Seed data

Three Households for designing and reviewing every screen: `fresh` (just created), `starter` (two weeks in) and `busy` (eight months of heavy use). They load into the **local** D1 that `bun run dev` uses. Each one replaces everything in that database, including E2E leftovers.

```sh
cd apps/web
bun run seed busy        # or fresh, starter; about 3 s
bun run dev              # http://localhost:5173 (AI_MODEL=stub bun run dev works offline)
```

The builder is `packages/db/src/seed.ts`. It computes rows only, with no I/O. `apps/web/scripts/seed.ts` applies the local migrations, finds or creates the two Clerk Parents, and writes the rows in one transaction. `packages/db/src/seed.test.ts` loads each scenario on several "todays" and checks the invariants the app relies on: no orphan rows, Splits add up, Transfers and Refunds net out, Matches, Receipts total, what Goals set aside fits their Accounts' balances, the payoff Goal started from what its card owed and has come down since, every month's Plan leaves Free to Spend at or above zero, and Extra income decisions and Sweeps never exceed what there was. It also checks the edge cases `busy` promises.

All dates are relative to today in the Household's time zone (America/Chicago), so "this month" always has live data. IDs are fixed, so a page's URL survives a reseed.

## It only touches the local database

The script never calls Cloudflare's API or `wrangler d1 execute`. It opens the local database's own SQLite file under `apps/web/.wrangler/state` and refuses any path outside that folder. It also refuses any extra argument (`--remote`, `--env`) and any Clerk key that isn't a development key (`sk_test_`). There is no code path that reaches remote D1.

## Signing in

The Parents are test users in the Clerk development instance, the same one E2E uses (keys in `apps/web/.dev.vars`):

| Parent | Email | In |
| --- | --- | --- |
| Alex | `seed-alex+clerk_test@example.com` | every scenario |
| Jordan | `seed-jordan+clerk_test@example.com` | `busy` (invited but not joined in `starter`) |

At `/sign-in`:
1. Enter the email.
2. Enter the password `noodle-seed-parent`.
3. If Clerk asks for a verification code for a new device, enter `424242`. Clerk accepts that code for any `+clerk_test` address, and no email is sent.

The seed resets the password on every run. These are throwaway dev-instance users, not real accounts. Sign in as Jordan to see the other side of a Personal Allowance, and to see this week's Check-in as already done.

## Scenarios

### fresh

One Parent (Alex) whose Household "The Rinks" was created five minutes ago. There are no Accounts, Plan, Transactions or Goals. This shows every empty state and first-run hint.

### starter

About two weeks in, with one Parent and an open invite to Jordan. It has:
- a take-home pay of $9,000;
- 4 Buckets (Kids carries over);
- 3 Commitments;
- one checking Account with a balance;
- about a dozen Quick Adds, plus the Commitments that came due and one paycheck;
- an Emergency fund Goal with $1,000 set aside, not yet marked as the emergency Goal.

### busy

"The Okonkwo-Lindqvist Household of Texas" (40 characters): Alex and Jordan, and two Children, Maya and Theo. It covers the eight months up to today.

**Accounts and Bank Connections**
- Chase checking and Sapphire card come through a healthy Chase connection.
- Ally savings ($112,480.55) and the Honda loan come through an Ally connection that needs reconnecting. It lapsed three weeks ago, so the latest savings transfers have no incoming side.
- The Costco Visa comes from monthly CSV statements. This month's Costco trips are Quick Adds, because they aren't on a statement yet.
- Kids' Savings has a balance from an OFX statement.

**Plan**
- Take-home pay is $12,400, raised to $13,000 by Jordan three months in.
- 17 Buckets: some carry over and some reset monthly, both Personal Allowances, one archived, one renamed, and one Just change.
- 14 Commitments: monthly, biweekly (Daycare, so some months are Lumpy) and annual.
  - Disney+ was ended by an applied Scenario.
  - Netflix's price went up.
  - Property tax two months out takes that month's Free to Spend below zero.
  - Car insurance four months out is a Lumpy month.
- Plan changes come from both Parents, including two this week, plus a Just change set for next month.

**Transactions**
- About 1,450 in all.
- Costco trips are split across Groceries, Household supplies and Hockey, with For set on the Hockey part.
- Transfers pay off both cards and move money to Ally savings.
- Target returns are linked as Refunds.
- Quick Adds are Matched to their imported copies.
- The card has three Pending charges.
- 11 items wait in Review, with and without a guess.
- 11 Rules, two of them a Parent's own.
- Filed rows show as auto-filed.
- There is a $0 charge, a duplicate charge, and a 66-character merchant.

**Goals**
- Emergency fund (the emergency Goal).
- House down payment ($150,000 target).
- "Spring break: Disney World with Grandma!", which is behind.
- A completed laptop Goal.
- An archived tournament Goal.
- A payoff Goal, "Pay off the Costco Visa" (ADR-0019), added four months ago at what the card owed then. An extra $250 a month is funded from Free to Spend and paid with each card payment, and the card's balance over those months shows it paid down by $750 to this month's $612.40.
- Each savings Goal has money set aside from its Account, monthly funding, Goal spending, Sweeps and Extra income.

**Month by month**
- The six months before last are closed, some by a Parent and some by the defaults, with their Sweeps.
- Last month is still open, with its leftovers and $640 of pending Extra income. The Check-in offers them, and This Month does too on days 1–7.
- Extra income: a bonus sent to the house Goal, and a tax refund split between a Goal and a Bucket.
- Covers come from other Buckets and from Free to Spend.

**Warnings and edge cases**
- Eating out is overspent this month and over its allowance most months.
- Car maintenance's Available is negative after last month's transmission.
- Income is behind this month from the 15th, because Jordan's second paycheck is late.
- Piano lessons is a Bucket with a $0 allowance that has never been used.
- Names are 40 characters long (an Account, a Bucket, a Goal and a Commitment).

**Assistance**
- Insights and Overlaps: new, accepted and dismissed. The new ones are a Perk-covered Netflix, a duplicate charge and a price increase.
- Perk Sources: T-Mobile and Chase Sapphire are confirmed, with Perks; Costco is suggested; Amazon Prime is dismissed.
- Scenarios: three, with Changes. One Change is muted, one points at the archived Bucket ("No longer in the Plan"), one is a $120,000 one-off, and one Scenario was applied.
- Six Receipts: five forwarded Amazon ones and a snapped Costco one.
- Weekly Check-ins by both Parents. This week only Jordan has done it, so Alex gets the full card stack.
- Nudge preferences are set for both Parents, one with quiet hours.

### What the seed can't show

- **Nudge history.** Nudges aren't stored anywhere a page reads: they go out through the queue, and the Household Agent keeps only scheduling state.
- **Receipt images.** R2 has no objects behind the seeded Receipts, so they show no thumbnail.
- **Reconnecting a Bank Connection.** The seeded Bank Connections have fake credentials, so Reconnect and refresh fail.

## Page findings (input for #47 and #48)

Every page was opened in each scenario at 1280×900 and 390×844, signed in as Alex. The result:
- no page errors, console errors or 5xx responses;
- no horizontal overflow at phone width.

Pages without a proper empty state in `fresh`:
- **Plan › Goals** (`/plan/$month/goals`): just the heading and one line. It doesn't say there are no Goals yet, or that an Account comes first, as `/goals` does.
- **Explore** (`/explore`): opens straight into the sandbox on an empty Plan ("Scenario 1 (not saved)", flat $0 charts, "Projected balance at its lowest $0"). There's no hint that it needs a Plan first.
- **Can we afford it?** (`/explore/afford`): under the "no take-home pay yet" note it still gives Home verdicts from zeros: "Not yet", "$0 set aside", housing that "would take Free to Spend from $0 to −$2,589".
- **Year at a glance** (`/plan/year/$year`): shows a table row of "Not set" and $0 for this month instead of an empty state.
- **This Month / Plan for a month before the Household existed** (the previous-month arrow): offers "Nothing planned yet · Set up the Plan" for a month before the Household was created. The arrows keep going back.
- **Check-in**: on day one it opens on "You're done for this week · Nothing needed you this week", with nothing to say what a Check-in is.

Pages without meaningful content in `busy`:
- **Ask** (`/ask`): the same as in `fresh`, just the suggested questions. That's by design, since nothing asked is kept. To review a real answer, you have to ask a question (the `AI_MODEL=stub` answers are canned).
- **Reports** (`/reports`): comparisons reach back before the Household's history. For example, the last 6 months come out "Up 226%" against a previous period that is mostly empty.
- **Transactions** (`/transactions/$month`): the list is virtualized, so a full-page screenshot shows only the first screenful of about 20 rows. Review density by scrolling, not from screenshots.
- The Month-close prompt on This Month appears only on days 1–7 of a month. On other days, last month's open close shows only in the Check-in.
