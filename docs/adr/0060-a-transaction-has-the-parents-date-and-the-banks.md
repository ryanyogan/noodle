# ADR-0060: A Transaction has the Parent's date and the bank's

Status: accepted (2026-10-07)

## Context

A Parent asked to change the date of a Transaction (issue 148): banks and merchants post late, so a charge made on September 30 arrives dated October 2 and counts in the wrong month. A Transaction had one `date`. Everything a Parent sees reads it (month membership, a Bucket's and a Commitment's totals, Reports, the Plan, a hand-kept card's balance "after the balance's day"), and so does everything that recognises the bank's line again: bank sync compared the stored date with the bank's and wrote the bank's back on any difference, the lines a bank Import leaves out because a statement brought them in are found by date, and Match pairs a Quick Add with a bank copy dated a few days after it. Changed in place, the bank's next sync would have put the date back.

Ended months: `ended-months.ts` only guards money back (ADR-0058). Nothing else stops a Transaction in an ended month from changing today (its amount, where it is filed, a delete), and a bank line dated in an ended month that arrives late simply lands in that month. What does exist is `month_closes`: one row per month once a Parent, or the defaults within a week, closed it.

## Decision

1. **Two dates, one new column.** `transactions.date` stays the day the Transaction counts on, and becomes the Parent's when they change it. A new nullable `transactions.bank_date` (migration 0087) holds the bank's own day from the first move on. It is null while `date` is still the bank's, and always for a Transaction typed in, which has no other date to keep. Back on the bank's day, it is null again.
2. **The bank's side reads `bankDay`** (`coalesce(bank_date, date)`, in `schema.ts`): bank sync's read of the rows it is about to change and its "still as read" guard, the same-line check against statements (`same-lines.ts`), and Match (`matches.ts`). When the bank changes a line (a new amount, a Pending line posting, a new day), a row a Parent moved keeps `date` and takes the bank's new day in `bank_date`; a row nobody moved follows the bank as before.
3. **Every other reader is untouched**, which is why the new column is the bank's and not the Parent's: dozens of reads of `date` stay correct as they are, and four places learn the new one.
4. **Allowed days:** any day up to the Household's today.
5. **Closed months:** a change of date is refused (`month-closed`, naming the month) when the month it would leave or the month it would land in has a `month_closes` row, a move within a closed month included. A month that has ended but has not been closed yet takes and gives Transactions, which is the late-September case. The check is made before the write and again inside it.
6. **Links keep their rules.** Splits, For, the Commitment paid, Refund links, Owed back and Transfer sides are held by the Transaction's id and move with it. A move that would put a linked Refund before its purchase, or more than 90 days after, is refused (`refund-order`) rather than breaking the link. What it is filed in, whole or by Split, must be in the Plan for the month it lands in (`not-in-plan`).
7. It is one more versioned write (ADR-0041): made on the version the Parent saw, one version on when it lands.

## Considered

- **Keep the bank's date in `date` and add the Parent's.** Every total, list, Report and guard would have had to learn `coalesce(parent_date, date)`; one missed read is a Transaction counted in two months or none.
- **Refuse for any ended month.** Simpler, and it defeats the case that was asked for. The code can tell ended from closed cheaply.
- **Refuse while any later month is closed** (so an old month that was never closed can't change under closed ones). Not taken: other edits to old months aren't held to it either, and it is the stricter reading to turn to if carried-over figures of closed months are seen to move.

## Consequences

- Detecting Transfers and card payments (`transfers.ts`, `card-payments.ts`) still pairs by `date`, the Parent's: a side moved far from its bank day may not be paired on its own afterwards. Pairs already made hold.
- A month that has ended and isn't closed yet can gain or lose spending in its first week, as it already could by an edit or a late bank line; what it hands on is worked out, never stored (ADR-0054).
- Download your data has both: `Date`, and `Bank's date` where they differ.
- Money in (`income`) has one date still. The same ability needs `income.bank_date`, the income half of bank sync's change write and "still as read" guard, the same-line and Transfer reads of `income.date`, and the rules of ADR-0058 for what a line Paid back or refunded (its `counts_on` days stay where they are).
