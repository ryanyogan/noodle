# ADR-0054: Free to Spend can build up from month to month

Status: accepted (2026-10-05, issue 113)

## Context

A Parent asked what happens to Free to Spend when a month ends: "roll it to savings, or let it build up". Nothing did. Each month's Free to Spend was worked out from that month alone ([ADR-0001](0001-layered-plan-not-zero-based.md): "whatever remains is Free to Spend"), so what a month left unassigned simply stopped being shown, and Extra income a Parent "left in the account" of an ended month ([ADR-0040](0040-plan-on-pay-you-can-count-on.md)) went nowhere. Only Buckets carried anything (Carries over), derived by walking the months and never stored.

The Parent's decisions (issue 113, 2026-10-05) are final: building up is off until a Parent turns it on and starts from that month; a month that ends below zero carries nothing; the carry is derived, never stored; a Household "Keep back" amount; the words are "builds up" and "carried over"; Plan health and Explore are unchanged.

## Decision

- A month's Free to Spend either **starts fresh** (the default, and what every Household has had) or **builds up**. When a month builds up, what it ends with, if above zero, is added to the next month's Free to Spend.
  - `left(m) = Take-home pay − Commitments − allowances − Covers from Free to Spend − Goal funding + Extra income added + carried in(m)`
  - `carried in(m+1) = m builds up ? max(0, left(m)) : 0`
- The setting is the Household's and effective-dated, like a Bucket's Resets monthly or Carries over: table `free_to_spend_carry(household_id, month, carries)`, primary key `(household_id, month)`. A row holds for later months until the next one; no row means starts fresh. The design guessed `bucket_rolling`'s shape; the real table also has a `bucket_id` and its own household index, neither of which applies here, and the primary key already leads with `household_id`.
- **The carry is derived, never stored.** `freeCarriedIn` in `packages/domain/src/free-carry.ts` walks the months; `loadFreeCarriedIn` in `packages/db/src/free-carry.ts` feeds it each month's total Moved out of Free to Spend and Extra income added to it. So a late change to an ended month (Extra income left in the account, Goal funding dated in it) reaches the months after it with nothing to reconcile.
- The walk starts at the beginning of the unbroken run of months that build up ending the month before (`freeCarrySince`). Months before a Parent turned it on are never read, which is how "starts from that month" holds; a Household that never turned it on reads no history at all.
- **A month below zero carries nothing**, so the next month starts clean. Money carried into an over-planned month does count toward it; what remains above zero carries on.
- `monthState` takes `freeCarriedIn` and adds it to `freeToSpend`; `MonthState.freeCarriedIn` says how much of it was carried. The write guards' SQL twin, `freeToSpendSql`, takes the same amount as a parameter, as `bucketLeftSql` takes what rolled over, so a Cover or Goal funding can use carried-in money.
- **Keep back** is one Household amount, `households.free_to_spend_keep_cents`, default 0. It only shapes what "Close <Month>" offers to send to a Goal (`aboveKeepBack`); it never changes Free to Spend, and money kept back builds up, or ends with the month, like the rest.
- Sending the leftover to a Goal is ordinary Goal funding dated in the ended month. No new kind of Move.
- Carrying does not depend on the month being closed, as with Buckets that carry over.
- Migration 0057 only adds the table and the column, so an older Household snapshot restores as it is (ADR-0048) with Free to Spend starting fresh and nothing kept back. A Fresh start clears the setting with the rest of the Plan and puts the kept-back amount back to 0, as it does the emergency Goal.

This amends ADR-0001's "the remainder" for a month that follows one that builds up.

## Consequences

- With no row in `free_to_spend_carry` every figure is what it was before.
- Free to Spend in a month can now depend on earlier months. Whatever shows or guards a month's Free to Spend must be given the carried-in amount; `loadMonth` does this for everything that calls `monthState` on its result.
- Reports still add up each month's own Free to Spend without the carry, or a quarter would count the same dollars three times. Plan › Year, the months ahead in Plan health and Explore, and the affordability answers still project each month on its own (decision 7); a Tight month that built-up money would cover still warns.
- The check before a Cover or Goal funding reads the carried-in amount and then writes with it. An ended month changing between the two (Extra income left in the account at that moment) could let the write use a carry that is a moment old. Accepted: both changes are a Parent's, in the same Household, and the next load shows the true figure.
- Turning building up on or off is not yet a Plan change in "What changed"; that comes with the setting's UI.
