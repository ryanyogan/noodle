# ADR-0060: A Transaction has the Parent's date and the bank's

Status: accepted (2026-10-07); point 6 amended the same day (see "Amended")

## Context

A Parent asked to change the date of a Transaction (issue 148): banks and merchants post late, so a charge made on September 30 arrives dated October 2 and counts in the wrong month. A Transaction had one `date`. Everything a Parent sees reads it (month membership, a Bucket's and a Commitment's totals, Reports, the Plan, a hand-kept card's balance "after the balance's day"), and so does everything that recognises the bank's line again: bank sync compared the stored date with the bank's and wrote the bank's back on any difference, the lines a bank Import leaves out because a statement brought them in are found by date, and Match pairs a Quick Add with a bank copy dated a few days after it. Changed in place, the bank's next sync would have put the date back.

Ended months: `ended-months.ts` only guards money back (ADR-0058). Nothing else stops a Transaction in an ended month from changing today (its amount, where it is filed, a delete), and a bank line dated in an ended month that arrives late simply lands in that month. What does exist is `month_closes`: one row per month once a Parent, or the defaults within a week, closed it.

## Decision

1. **Two dates, one new column.** `transactions.date` stays the day the Transaction counts on, and becomes the Parent's when they change it. A new nullable `transactions.bank_date` (migration 0087) holds the bank's own day from the first move on. It is null while `date` is still the bank's, and always for a Transaction typed in, which has no other date to keep. Back on the bank's day, it is null again.
2. **The bank's side reads `bankDay`** (`coalesce(bank_date, date)`, in `schema.ts`): bank sync's read of the rows it is about to change and its "still as read" guard, the same-line check against statements (`same-lines.ts`), and Match (`matches.ts`). When the bank changes a line (a new amount, a Pending line posting, a new day), a row a Parent moved keeps `date` and takes the bank's new day in `bank_date`; a row nobody moved follows the bank as before.
3. **Every other reader is untouched**, which is why the new column is the bank's and not the Parent's: dozens of reads of `date` stay correct as they are, and four places learn the new one.
4. **Allowed days:** any day up to the Household's today.
5. **Closed months:** a change of date is refused (`month-closed`, naming the month) when the month it would leave or the month it would land in has a `month_closes` row, a move within a closed month included. A month that has ended but has not been closed yet takes and gives Transactions, which is the late-September case. The check is made before the write and again inside it.
6. **Links keep their rules.** Splits, For, the Commitment paid, Refund links, Owed back and Transfer sides are held by the Transaction's id and move with it. A move that would put a linked Refund before its purchase, or more than 90 days after, is refused (`refund-order`) rather than breaking the link. ~~What it is filed in, whole or by Split, must be in the Plan for the month it lands in (`not-in-plan`).~~ Replaced the day it shipped: see "Amended".
7. It is one more versioned write (ADR-0041): made on the version the Parent saw, one version on when it lands.

## Amended (2026-10-07): a Bucket the landing month's Plan lacked no longer refuses

The owner, the day it shipped: "if the bucket didn't exist the prior month, let the date change and just un-assign the bucket". A new Household has no Plan before its first month, so the refusal stopped the very case asked for (late September's charge, filed in October).

- **Filed whole in a Bucket or a Commitment** that isn't in the Plan of the month it lands in: the date changes and, in the same versioned write, it is left unassigned (`bucket_id` and `commitment_id` null). That is the state the Undo of "File in…" leaves and nothing new: it reads Unassigned in the lists, counts in no Bucket in either month, keeps its For, and waits in Review again only if Review was where it had waited (its `categorizations.outcome` is still `review`). What a Commitment's payments pay down on a card kept by hand is derived from the payments filed in it, so that goes with it and comes back with it.
- The answer says what it was taken out of (`unassigned`: kind, id, name). **Undo** sends the day it was on and that (`refile`), and both go back in one write: only onto a Transaction filed nowhere, whole, with no money back, and only where that month's Plan has it. Otherwise the day goes back and it stays unassigned.
- **Splits** (`not-in-plan`, `part: "split"`): still refused where any Split's Bucket or Commitment isn't in that month's Plan. A Split always has an assignment; there is no unassigned Split, and one was not invented for this. The Parent changes that Split first.
- **Money back** (`not-in-plan`, `part: "money-back"`): still refused where a Refund on a card (either side), a Refund link or Owed back is on the Transaction and what it is filed in isn't in that month's Plan. Money back restores the Bucket its purchase is filed in (ADR-0058), so a purchase filed nowhere would leave it restoring nothing.
- Unchanged: closed months, days that haven't come, the Refund order rule, Goal spending, and a side of a Transfer or a card payment, which is filed nowhere to begin with.

## Considered

- **Keep the bank's date in `date` and add the Parent's.** Every total, list, Report and guard would have had to learn `coalesce(parent_date, date)`; one missed read is a Transaction counted in two months or none.
- **Refuse for any ended month.** Simpler, and it defeats the case that was asked for. The code can tell ended from closed cheaply.
- **Refuse while any later month is closed** (so an old month that was never closed can't change under closed ones). Not taken: other edits to old months aren't held to it either, and it is the stricter reading to turn to if carried-over figures of closed months are seen to move.

## Consequences

- Detecting Transfers and card payments (`transfers.ts`, `card-payments.ts`) still pairs by `date`, the Parent's: a side moved far from its bank day may not be paired on its own afterwards. Pairs already made hold.
- A month that has ended and isn't closed yet can gain or lose spending in its first week, as it already could by an edit or a late bank line; what it hands on is worked out, never stored (ADR-0054).
- Download your data has both: `Date`, and `Bank's date` where they differ.
- Money in (`income`) has one date still. The same ability needs `income.bank_date`, the income half of bank sync's change write and "still as read" guard, the same-line and Transfer reads of `income.date`, and the rules of ADR-0058 for what a line Paid back or refunded (its `counts_on` days stay where they are).
