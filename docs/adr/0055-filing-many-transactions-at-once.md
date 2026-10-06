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

## Addendum, 2026-10-05 (issue 117): months before the first Plan, and what "All time" costs

### A month with no Buckets says so; nothing is filed outside its own month

Bank history usually goes back further than the Plan (the first Household: Buckets from September, history from January). "One month only" above stays: a Transaction is filed in the Plan of its own month, and a past month's Plan cannot be changed (`assertEditable`), so "Create Bucket" from a picker was always refused for a past month and a month before the first Plan had nothing to offer at all. For such a month (it is over, and its Plan has no Bucket and no Commitment this Parent can assign to) the picker shows one sentence instead of a search over an empty list, with "File without a Bucket" (ADR-0037) for a Transaction that is assigned nowhere: it leaves Review and stays Unassigned, so no month's figures change. Review already did this for its cards; the Assigned to cell, the editor under the row and the phone's sheet now do the same. No existing Transaction is changed in bulk: each pre-Plan one leaves Review when a Parent files it, there or with Review's "File all from before …".

Considered: offering the Buckets of the first planned month for earlier Transactions. It would put January's spending in September's Plan or need a Plan written backwards for months that never had one, and every figure of those months (and what rolls on from them) would change after the fact.

### The Bucket filter in a list of more than a month

The filter lists the Buckets of every month the list covers, each once, by name (`loadBucketsInMonths`): one indexed read of the Household's Buckets, asked for only while a range is shown.

### What the orders other than by date cost in "All time"

By date, a page is the next 50 rows of an index on the Household and the date, whatever the range: the cost is the page. Any other order (amount, name, Assigned to, Account) has no index to follow, so every page fetch sorts every matching row of the range before it takes 50; in "All time" that is every Transaction the Household has, for each page scrolled to. The first page of any range also sums every matching row for the total. At a Household's size (a few thousand rows a year) this is milliseconds in D1 and is accepted. It is not accepted blindly: if a Household's list becomes slow, the first step is an index per sort key on (household, key, date, id), not a cache; a custom from/to range would bound it too. Nothing here was measured on production data.

## Addendum, 2026-10-06 (issue 138): it can set For as well

"It changes only the assignment: amount, name and For stay" above now reads: amount and name stay, and For stays unless a Parent says who. The selection bar has For chips beside "File in…": "As it is" (the start, and what the bar always did), Everyone, and each Member; several Members can be on. With a For picked, `fileTransactions` takes `forMemberIds` and every Transaction it files is For those Members, in the same write as its Bucket. Nothing else about the run changes: the same rows are left and counted, one month only, nothing learned, no Rule.

- **Already there** now means in that Bucket or Commitment *and*, when a For is given, For the same Members. A row in the target with another For is filed (its For changes, its version moves on), so "File in Groceries, For Mia" over rows already in Groceries is how many get a For at once. For is not set without an assignment: the bar files, and For rides along.
- **Undo** is still the inverse. Each row's answer also carries who it was For before, and `unfileTransactions` puts that back in the same write as the Bucket, only on the rows that very write returns (still at the filing's version). A row changed since keeps its Bucket and its For.
- **Members** not in the Household are dropped from the For, as every other write of For does. An empty For is Everyone.
- **Never the other Parent's Personal Allowance** (ADR-0003): a For changes none of it. The target must be one this Parent can assign to or the whole run is refused; a row in, or partly in, the other Parent's Personal Allowance is left, its For too; Undo will not put a row back there. Tests: `packages/db/src/privacy.test.ts`, `file-transactions.test.ts`.
- The message says it: "Filed 12 in Groceries, For Mia."

The Review card has the same chips (without "As it is": one Transaction has one For to show). What is picked there is held on the screen until the card is filed; Confirm, the picker and "Confirm all" send it with the assignment through the one-Transaction write, and "Always file …?" puts it in the Rule (ADR-0030).
