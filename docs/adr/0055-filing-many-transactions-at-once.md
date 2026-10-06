# Filing many Transactions at once: what it leaves alone, and its Undo

Decided 2026-10-05 (issue 99, phase 99f).

The Transactions table can select many rows (ADR-0045 for delete, ADR-0051 for the table). "File in…" on the selection bar files everything selected in one Bucket or Commitment, picked from the same picker a row's Assigned to cell uses.

## Decisions

### It files only what one Bucket can take whole, and counts the rest

`fileTransactions` (`packages/db/src/transactions.ts`) takes the selection as bulk delete does (`selectedBy`: IDs, or everything the filters match except some), so it covers rows the screen has not loaded. It changes only the assignment: amount, name and For stay. It leaves, and counts by kind, what a cell of the table would not refile either (`cellEdits`):

- a Split, a side of a Transfer, money back (linked as a Refund or not): they have no single Bucket to swap;
- Goal spending (it changes from its Goal) and anything partly in the other Parent's Personal Allowance;
- a row that is no longer at the version the screen showed (ADR-0041). The screen sends the versions of the rows it had loaded; rows it had not loaded are filed as they are. Each row is written only while still at the version the server read at the start, so a change made in between is left alone and counted too;
- a row outside the month.

A row already whole in the target is counted apart ("already there"): nothing was wrong with it, and it makes a retry safe.

The message says it: "Filed 12 in Groceries. 3 skipped: 2 Splits, 1 Transfer."

### One month only

A Transaction is assigned inside its own month's Plan (ADR-0037), and the target must be in that month's Plan and one the Parent can assign to. "…and every month before" is refused; the bar's button is off for it. A closed month is filed like any other, as one Transaction in it can be (ADR-0045 treats delete the same way).

### Undo is the inverse, not a snapshot

The answer carries, for each row filed, where it was (Bucket, Commitment or neither) and its version after filing. Undo (`unfileTransactions`) puts each back only while it is still at that version, still the Parent's to change, and what it goes back to is the Household's and theirs to assign to. A row changed since stays, and the message says how many.

Considered: a Household snapshot first, as bulk delete takes. A delete loses rows and everything hanging off them; a refile changes one column pair per row and the previous values fit in the answer. A snapshot restore would also undo everything else done since. So no snapshot is taken, and no new snapshot kind or migration is needed. The cost: Undo lasts as long as its message (ten seconds, as every Undo), not days. After that the rows are refiled by hand, or with "File in…" again.

### It learns nothing

Filing one Transaction by hand removes categorization's marker, learns the merchant for that Bucket after the response, and queues a "filed by hand" signal for background AI. Filing many removes the marker (a Parent has decided them; a Receipt or a later categorization run must not move them) and does neither of the other two: a sweep of forty rows into one Bucket is often a tidy-up, not forty statements about forty merchants, and one mistaken pick would teach all of them. No Rule is made. Undo does not put the marker back: the row returns to its old Bucket as one a Parent filed.

## Limits

5,000 Transactions per run (a second run takes the rest), versions for at most 1,000 loaded rows (more are filed as they are). This Month and the list show the loaded rows' change at once and roll back if the server refuses; rows not loaded show after the refetch.
