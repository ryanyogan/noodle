# Deleting Transactions: any one, many at once, and a deleted bank line stays deleted

Decided 2026-10-05 (#97).

A Parent connected their bank and got a year of history when they wanted this month. Their decision: "leave the chase data, the user can choose on the import, if they made a mistake they can always bulk delete the transactions, lets allow for deletion of transactions, and multi-select and bulk delete". Choosing how far back an Import goes is #89; this is the way out after the fact.

## What was there

One Transaction could already be deleted from its editor, imported or not (`deleteTransaction`): its For, Splits, Refund links, Transfer and Matches go with it, never Goal spending or anything partly in the other Parent's Personal Allowance. It was a hard delete, and that was the fault: an Import leaves out a line only because a row with its ID is in the Account (`transactions_account_external_idx`, `on conflict do nothing`). With the row gone the ID was forgotten, so the next sync that mentioned the line (a change to it, a pending charge posting) or the same statement uploaded again brought it straight back.

## Decisions

### A deleted line's ID is remembered (`deleted_bank_lines`)

Deleting a Transaction that came from an Import writes its Account and line ID to `deleted_bank_lines` in the same batch as the delete (migration 0050, additive). Nothing else about the Transaction is kept. Only an Import reads it:

- `importStatement` leaves out lines whose ID is there (`deletedLineKeys`), for statements and Bank Connections alike. They are counted with the lines "already here".
- A sync also leaves out a posted line that replaces a deleted pending one, and remembers the posted line's ID too, so a later change to it stays out (`bankLinesNotDeleted`, called once in `syncBankLines` before `bankLinesNotHere`).
- A line the bank itself dropped is not remembered: nothing deleted it on purpose.

Considered: a soft delete (`transactions.deleted_at`) touches every read of Transactions and every total, for a row nobody wants to see again; reusing `bank_line_pairs` would need a row to point at, and the row is what is being deleted. A small table that only Imports read changes no read path.

The table is a Household table, so a Fresh start clears it and a snapshot holds it: restoring a snapshot from before a delete puts back both the Transactions and what was remembered at that time, so they are not blocked afterwards.

Not covered: the same real charge arriving under another ID from another source (deleted as a bank line, then brought in by a statement, or the other way round). Pairing across sources compares rows that are there (ADR-0020), and the row is gone.

### One delete can be undone for ten seconds

Deleting one says so at once with an Undo ("Deleted. It won't come back when your bank syncs." for an imported one), and the delete is sent when the Undo has gone, ten seconds later (the same time as every Undo), or when the page is put away. Undo is never sending it. The send follows the toast itself, not a clock of its own: while the toast waits (the pointer is over it, it is held, or the keyboard is in the toasts) the delete waits with it, so Undo never shows for a delete that has already been sent. If the page is closed in those seconds and the request doesn't leave, the Transaction is still there next time: the safe way to fail. A refetch in those seconds can show the row again until the delete lands.

### Select mode and "all that match"

The Transactions page has a Select mode. What is selected is IDs, or "everything the filters match, except these", never rows on screen, so it holds for a list that loads a page at a time. The page shows one month, and the need was "everything from this Account before a date", so "all that match" comes in two sizes: in the month shown, and in it and every month before. The server builds the selection from the same filters the list uses (`selectedBy`), for the Parent looking (ADR-0003).

### Facts first, then a snapshot, then the delete

- The confirm sheet states, counted on the server as things are now: how many, from when to when, which Accounts, the total, and how many are imported, filed, split, one side of a Transfer, part of a Refund, have a Receipt, or are in a closed month; and what stays.
- A Household snapshot of kind `before-transactions-delete` ("Before deleting Transactions") is taken first, whenever anything is about to go. If it can't be taken, nothing is deleted (ADR-0035). It has its own cap, the newest 3 for 90 days, counted apart from every other kind, as snapshots before a Rule apply are. No migration: the kind is text.
- What still matches when the delete runs is what goes, a hundred a batch, each batch whole or not at all; the answer says how many went. A retry deletes what is left and counts nothing twice.
- A bulk delete names no version (ADR-0041): it deletes what is the Parent's to delete at that moment. Money back linked as a Refund to a deleted purchase moves on a version, as with one delete.

### Closed months are included, and said

A month's close records its Sweeps and where its Extra income went; Transactions in a closed month could always be edited or deleted one at a time, and the year of unwanted history is almost all in past months. Leaving closed months out would make the feature useless for what it was asked for. So they are deleted too, the sheet says how many and what that means ("what those months spent will change, and the Sweeps decided when they closed stay as they are"), and the snapshot is the way back.

### Money in is left alone

The Transactions page lists Transactions only. Deposits into a checking or savings Account are income rows, with their own rule for removal (refused while the month's Extra income already decided depends on them). Bulk delete doesn't touch them and the sheet says so. Removing a year of imported deposits in one go is not built.

## Consequences

- A deleted bank line can't be brought back by syncing again. The way back is the snapshot (many) or Undo (one).
- An Import's own count of what it added is what it added then; it isn't reduced when its Transactions are deleted later.
- A snapshot is restorable only under the migration it was taken with (ADR-0035), so a later migration ends the way back for snapshots taken before it, these included.
