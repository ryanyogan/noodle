# ADR-0054: Free to Spend is carried over from month to month

Status: accepted (2026-10-05, issue 113). It replaces, under the same number and before anything shipped, an opt-in design ("builds up", a Household setting, a "Keep back" amount and migration 0057), none of which exists any more.

## Context

Each month's Free to Spend was worked out from that month alone ([ADR-0001](0001-layered-plan-not-zero-based.md): "whatever remains is Free to Spend"). Looking at Plan › Year with real data, a Parent saw October end with money left and November at −$12.20 in red, and asked "where does the money go?". Their ruling: "it should be more representative of a bank account … we would want to keep a running ledger … that money wouldn't just disappear, and when the month ends the free to spend should still be there just less our standard calculations of commitments, buckets, etc." They also want the month to still read fresh, and to keep seeing the month's paychecks that have not come in yet.

## Decision

- **A running ledger.** A month's Free to Spend = what the months before handed on (of either sign) + the month's own figure.
  - `left(m) = carried in(m) + own(m)`, and `carried in(m+1) = left(m)`. Nothing is clamped: a month that ended short takes from the next.
  - **An ended month** hands on what it **actually** ended with: `own(m)` = income received − every Transaction not spent from a Goal − Goal funding. This is the "Actual Free to Spend" Plan › Year shows (`actualFigures`). Its Plan, Covers and Extra-income Moves are not read; typed-in income and Transactions count like any other.
  - **The Household's month and months ahead** use the Plan: `own(m)` = Take-home pay (paychecks not yet in included) − Commitments − allowances − Covers from Free to Spend − Goal funding + Extra income added.
  - **An ended month with no income recorded hands on only what it was carried**: `own(m) = 0` when the income received in it totals zero or less. Decided by the lead on 2026-10-05 (phase 113c), not yet ruled on by a Parent. Without it a Household that only uses Quick Add and never records income would be short by a whole month of spending more every month (−$4,000, −$8,000, −$12,000 …). With any income recorded, even $1, the month is on the books and the rule above applies. The alternative considered was to hand on such a month's Plan figure; rejected because it would carry over money nobody recorded.
- **It starts at the first month with a Plan** (`firstCarryMonth`: the earliest take-home pay record, Bucket or Commitment). Bank history imported from before Noodle was in use is never read. That month is carried nothing.
- **No setting, no "Keep back" amount, no table.** The carry is derived, never stored: `freeCarryMonths` in `packages/domain/src/free-carry.ts` walks the months and `loadFreeCarryMonths` in `packages/db/src/free-carry.ts` feeds it. A late change to an ended month reaches the months after it with nothing to reconcile.
- **Months ahead chain the same way**: `yearGrid` and `planHealth` add each month's own Plan figure to what the months before leave, so Plan › Year and "Things to check" flag a month only when the chained figure is below zero.
- **The screen shows the two parts**, so the month still reads fresh: "$1,846 this month · $6,710 carried over from October", or "$1,846 this month · $230 short carried over from September". The words are "carried over" and "short".
- `monthState` takes `freeCarriedIn` and adds it to `freeToSpend`. The write guards' SQL twin, `freeToSpendSql`, takes the same amount, so a Cover or Goal funding can use carried-in money and is refused sooner after a shortfall.
- Sending what a month left to a Goal is ordinary Goal funding dated in the ended month, which lowers what it hands on with no extra rule.

This amends ADR-0001's "the remainder": a month's remainder now includes what earlier months handed on.

## Consequences

- Every month after the first planned one depends on the months before it. Whatever shows or guards a month's Free to Spend must be given the carried amount; `loadMonth` does this for everything that calls `monthState` on its result. Each load reads the Household's income and spending for the ended months since the first planned month (three more round trips, whatever the number of months).
- A month with only part of its income recorded (a checking account not connected) still hands on less than it really left: the ledger is only as good as what is recorded, and the Parent corrects it by recording the income.
- An ended month with no income recorded still shows its spending in Plan › Year's "Actual"; only what it hands on leaves it out. Goal funding made in such a month does not lower what is carried either, so the month-end decision does not offer to send such a month's Free to Spend to a Goal.
- Reports still add up each month's own Free to Spend, and Plan › Year's yearly total leaves the carried amount out, or the same dollars would be counted in every month. Explore, Scenarios and the affordability answers still project each month on its own.
- The check before a Cover or Goal funding reads the carried amount and then writes with it; an ended month changing between the two could let the write use a carry that is a moment old. Accepted: both are a Parent's changes in the same Household, and the next load shows the true figure.
