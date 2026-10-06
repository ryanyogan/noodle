# A waiting Transaction can always be decided: file without a Bucket

Status: accepted (2026-10-04, #82)

## Context

A Parent connected a bank and Review filled with Transactions from months before this one. Nothing could be done with them, and the count never moved.

- **Why nothing could be done.** A Transaction is only assigned within its own month's Plan (ADR-0009, ADR-0021): `updateTransaction` refuses a Bucket that isn't in that month's Plan, and the card's picker lists only that month's Buckets and Commitments. A bank brings in months from before the Household's first Plan. Those months have no Buckets and no Commitments, so the card had no picker, no Confirm, and in Sort could "only be skipped". Review could never be emptied.
- **Why the count didn't move.** Skipping is not a decision, so skipping stuck cards changed no count. Sort's "3 of 12" counted only the cards loaded (at most 100), so with more than 100 waiting the second number grew by one with every decision ("2 of 101"). The list had no count of its own on the page.

## Decision

- **File without a Bucket.** A Transaction waiting in Review can leave it as it is: unassigned, in no Bucket, Commitment or Goal. It is offered on every card from a month before this one, and on any card whose month has nothing to file in. It is `fileWithoutBucket`, which only removes the Transaction's waiting marker (its `categorizations` row); nothing about the Transaction changes.
- **No month's figures change.** An unassigned Transaction adds nothing to any Bucket while it waits, and adds nothing after. So filing without a Bucket never changes what a month spent, what was left, its Sweeps or what carried over. That holds for a closed month too: nothing is reopened, and how it ended still reads the same. The Transaction stays in Transactions, in its own month, where it can be given a Bucket later if that month gets a Plan.
- **A month that has a Plan keeps its picker.** An earlier month with a Plan still offers its Buckets and Commitments, closed or not, as editing any Transaction of that month does. That is unchanged by this ADR: filing in a Bucket of a month that is over changes that Bucket's spending for the month, as it always has. Filing without a Bucket is the choice that changes nothing.
- **Many at once.** "File all N from before <this month> without a Bucket" files every loaded card from an earlier month, with one Undo. It takes at most the 100 cards Review loads; with more waiting, the next ones load and it can be pressed again.
- **Undo** is the usual one: `returnToReview` puts the card back with its guess.
- **It teaches nothing.** No Rule is offered and no merchant is learned, since no Bucket was chosen.
- **The count is everything that waits.** Sort's "n of m" is `stackProgress`: decided this visit plus one, of decided plus the server's count of all that wait. What Sort says ("4 left") uses the same count. The list says "N to review". The Review tab, the Sidebar's badge, This Month's chip and the Check-in all read the same cached Review (or the same server count, under every month's key), which each decision changes at once and then refetches.

## Alternatives

- **File an old Transaction in today's Buckets.** Rejected: a Bucket that didn't exist in a month would get spending there, and the month would show spending against no allowance. It breaks "assigned within its own month's Plan".
- **Make the Parent plan the earlier month first.** That is still offered ("Set up <month>'s Plan"), but as the only way it left Review blocked for anyone who just wants this month right.
- **Don't bring earlier months into Review at all.** Rejected for now: the Transactions are real and a Parent may want them filed once they plan those months. Filing all of them at once costs one tap.

## Consequences

- A Transaction filed without a Bucket shows in Transactions as unassigned and is counted in no Report by Bucket, as before it was filed.
- ADR-0021's "can only be skipped" no longer holds: → or ← on such a card says it can be filed without a Bucket or skipped.

## Note, 2026-10-06 (spec 130, issue 138): it still comes out of what the month carries over

"No month's figures change" above is about the act of filing: taking a Transaction out of Review without a Bucket changes nothing that was not already so. It does not mean the money is counted nowhere. Since ADR-0054, Free to Spend is carried over from month to month, and what a month ends with is the income it received less its spending and Goal funding, in a Bucket or not. A Transaction that is unassigned, waiting in Review or filed without a Bucket, adds to no Bucket's spending and shows in no Report by Bucket, but it is money out of its month, so it comes out of what that month carries over to the next. That was already true while it waited; filing it without a Bucket leaves it true. Carrying over starts at the first month with a Plan (ADR-0054), so a Transaction from before it comes out of nothing: those months hand nothing on.

So "it adds nothing to any Bucket" holds, and "what carried over" does not change *by filing it*. Read "No month's figures change" with that meaning, as `CONTEXT.md` now says. The code was right throughout; only these words were loose.

