# ADR-0063: A paycheck counts on its pay day

Status: accepted (2026-10-08, issue 156 phase 2)

## Context

A salaried Parent's paycheck for the 1st is often posted by the bank on the last day of the month before. Every total of Income by month read the month from the day the line landed (`income.date`), so that month showed three paychecks and Extra income nobody earned, and the next began a paycheck short. Phase 1 (migration 0088) let a Parent say how they are paid and listed the month's expected paychecks, but only read: nothing counted differently.

## Decision

- **The month a line of Income counts in is its own fact.** `income.pay_day` (nullable, a day key) is the Pay day the line is the pay for. With one, the line counts on that day; with none, on its date, exactly as before. The bank's date and amount are never changed.
- **One expression says the day.** `incomeCountsOn` (`coalesce(pay_day, date)`, with `incomeCountsOnRaw` for raw SQL) in `packages/db/src/counting.ts`, and its twin `countsOn` in `packages/domain/src/extra-income.ts`. Every read or guard that puts Income in a month goes through one of them: `loadIncome` (This Month, Plan › Income, the Check-in, the Plan draft), `receivedSql` (Extra income, its guard of ADR-0052, Close month), `removeIncome`, `loadIncomeCells` (Reports, Plan › Year's actuals, the Carry-over chain of ADR-0054), `loadHistoryStart`, the month `changeMoneyInKind` and `editMoneyIn` guard, `receivedIn` and `payRanges`.
- **A match is stored, by the rule of phase 1.** `payDayMatches` (pure) says which lines should have which Pay day: Income that counts and is a salaried Parent's pay, within $300 of the paycheck and 5 days of an open Pay day, the closest in amount first. `matchPayDays` writes it, for the lines that have just arrived or changed (an Import or bank sync, a kind changed to Income, whose pay set or stated by Rule), and for all the Household's Income when a Parent saves how they are paid. A stored Pay day is what Plan › Income lists as In; a line that fits and has none kept yet is still read as In, as in phase 1.
- **By hand, and it sticks.** `income.pay_day_by_hand` (nullable, 1 once said) records that a Parent chose: "This is the pay for…" one of that Parent's Pay days within 20 days, or "Not a paycheck for a pay day", which clears `pay_day`. The automatic rule never touches a line with a Pay day or with this set. A second column, not a sentinel in `pay_day`, so `coalesce(pay_day, date)` stays the whole rule.
- **Whose pay.** When a Parent saves how they are paid, Income nobody has said whose pay it is becomes theirs, with the Pay day, when it fits a Pay day of theirs and of no other salaried Parent. Whose pay a Parent chose is never changed. Given to somebody else later, a line forgets its Pay day; so does a line whose kind stops being Income.
- **Guards.** A change that moves a line between months is held, inside the write, to: Extra income already decided in the month it leaves stays covered without it (ADR-0052), and neither month has been closed (`month_closes`). By hand it is refused (`extra-income`, or the new `month-closed`); the automatic write skips the line, leaves it counting where it landed, and reports it ("not moved: September is closed").
- Migration 0090 adds the two nullable columns and rewrites nothing (ADR-0048). Nothing moves on deploy: a line gets a Pay day only when it arrives after a Parent is on a salary, or when a Parent saves how they are paid.

## What stays on the day it landed

- The date a row of the Transactions list shows, and its place in the list's order: always the day the bank posted it.
- Finding the same line again, pairing Transfers and Refunds, and bank sync, which all compare bank dates.
- Between us, Refunds, Paid back and Transfers: only Income has a Pay day.
- The Plan draft's reading of when paychecks land, and the one-time October pass over money in.

## The Transactions page follows the month a line counts in (2026-10-08, amended the same day)

As first decided, the Transactions list, its month filter and its Money in figure stayed on the day a line landed. In use that read as a mistake: October's Money in on Transactions was a paycheck short of October's Income on Plan › Income and This Month, and September's was a paycheck over. So the month a money-in line belongs to on the Transactions page is the month it counts in, by the same `incomeCountsOn` (`matching` in `packages/db/src/money-in-rows.ts`, which the rows, the "Money in" filter, Needs review and the figures all read). A paycheck posted September 30 for October 1 is one row of October's list and none of September's, is in October's Money in and not September's, and a range over both months has it once. The row still shows September 30 and sorts by it, so newest first it is the last row of October, and it says "pay for Oct 1". "Not a paycheck for a pay day" sends row and money back to September together. One rule rather than a row in both months, so a figure is always the sum of the rows its filter lists and no line can be added up twice.

## Consequences

- A paycheck matched across a month's end lowers what the ended month hands on and raises the running month's Income by the same amount; the Carry-over chain is derived, so there is nothing to reconcile.
- A stored Pay day stays when a Parent later changes their schedule or goes back to hourly: history never moves on its own. A Parent changes one line by hand.
- When the bank changes a pending line's date or amount, its Pay day is kept.
- A month closed before its paycheck was matched keeps that paycheck. The Month-close Workflow closes a month about a week after it ends, so a paycheck is best matched as it arrives.
- Reads by month filter on `coalesce(pay_day, date)`, which the index on `(household_id, date)` only narrows by Household.
