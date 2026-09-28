# Personal Allowance privacy is enforced on the server

Transactions in a Parent's Personal Allowance are never sent to the other Parent's client, and are excluded from any AI context built for the other Parent; only aggregate totals cross that boundary. Hiding them in the UI alone was rejected because a single leaked gift purchase breaks the trust the feature exists for.

## Consequences

- A Personal Allowance is a Bucket with `buckets.owner_member_id` set (one per Parent); it counts in the Plan like any Bucket. Only its Parent sets it, assigns spending to it, or Covers into or from it.
- Every read of Transactions is made for a Viewer (`packages/db/src/privacy.ts`): `visibleTo` leaves out the other Parent's Personal Allowance, and `privateTotals` gives its spending as one total per month, For the whole Household, with an ID naming only the Bucket and month. New reads (search, Ask, Insights, Nudges) go through the same rules.
- Splits follow the same rule: a Split in the other Parent's Personal Allowance is never read one by one (`visibleSplit`) and only adds to `privateTotals`. A Transaction split only into it is hidden like a whole one. A mixed Transaction, split partly into it and partly elsewhere, shows the other Parent only its other Splits, their sum as its amount, and no note (the note may describe the private part); nothing marks it as having a private part.
- Writes are guarded the same way, so the other Parent can't edit, delete, split, or move spending into a Personal Allowance that isn't theirs, even with a Transaction's ID. A mixed Transaction is its Parent's alone to change or delete (`changeableBy`): the other Parent sees only part of it, and an edit from them would overwrite the private Splits.
