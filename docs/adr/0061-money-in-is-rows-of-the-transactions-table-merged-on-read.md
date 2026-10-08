# ADR-0061: Money in is rows of the Transactions table, merged when the list is read

Status: accepted (2026-10-08)

## Context

Money into an Account that holds money is kept in `income`, apart from `transactions` (ADR-0057), and the Transactions page listed it in a section of its own under the table, with its own "Change" control. The owner (issue 152): "they are transactions just positive ones", in the same table, edited "just like any other transaction", no separate section.

The table is read from the server a page at a time, already in order (ADR-0051): keyset paging over (what the list sorts on, date, ID), ten orders, the list's filters and privacy all in SQL (`loadTransactionsPage`). `income` has none of a Transaction's columns for Buckets, Splits, For, Match or privacy, and a great deal reads it as it is: the Plan's Income and Extra income, whose pay, the guards of ADR-0052 and ADR-0058, bank sync, Imports, snapshots.

## Decision

- **Stored as it is; merged on read.** `income` stays its own table. When the Transactions list asks for it (`moneyIn` on `loadTransactionsPage`, which only the Transactions page sets), each table is read in the list's order, past the same cursor, one more than a page of each, and the two are merged in the Worker by the same order (`listOrder` in `money-in-rows.ts`). The first page's worth of both together is the page; its last row is the next cursor, whichever table it came from. The order is total (the sort's key, then date, then ID, and IDs are ULIDs in both tables), so no row is missed or listed twice at a page boundary.
- **A money-in row is a `TransactionRow` with a negative amount** (as money back onto a card already is) and `moneyIn`, the line itself. It sorts by that amount, by its wording as its name, by the Account it came into, and with the unassigned by "Assigned to". Text is compared byte by byte in UTF-8, as SQLite does, not as JS strings compare.
- **The list's filters apply as far as they mean anything**: the month or range, the Account, the search, Needs review (lines waiting in Review). A Bucket or For filter leaves money in out: it is in no Bucket and For nobody. The summary's Money in shows only these rows and Money out none of them.
- **The three figures come with the list's first page**, under the same filters, so they agree with what is listed: Money in is Income, Refunds and Paid back (a Transfer and Between us came in nowhere, a line that waits counts in Needs review).
- **It opens at the same address as any row** (`/transactions/$month/$id`): `getTransaction` reads a money-in line when no Transaction has the ID. Its editor is a Transaction's in layout and holds everything the old section offered. What may change is ADR-0057's: the name (its note) and kind always, whose pay on Income, the amount and date only on a line a Parent typed in.
- **Select mode is for Transactions.** A money-in row has no checkbox and "everything the filters match" never holds one; with only money in showing there is nothing to select. Deleting and filing many at once read `transactions` alone, as before.

## Considered

- **One table**: move money in into `transactions`. The honest end state, and too much to do safely while the Household uses it daily: every read of `income` named above would change, with a data migration that isn't additive (ADR-0048).
- **A SQL `UNION ALL`** of the two reads. One statement, but every column of a Transaction's row would need a stand-in on the other side, the keyset comparison would run over a subquery, and Drizzle's typed select would be given up for raw SQL. Two reads of at most 51 rows each and a merge is the same result.
- **Merging in the browser** from the month's money-in read. Wrong at once for any order or page: the browser holds one page of Transactions and cannot know where a line of money in falls among rows it hasn't loaded.

## Consequences

- A new order or filter on the list is written twice: in `loadTransactionsPage` and in `money-in-rows.ts`. The unit test pages every order at several page sizes to hold them together.
- A Transfer whose arriving side is money in is listed on both its sides, as it was listed in two places before; showing it once is the rest of issue 152. (Done in ADR-0062: where both sides are in Noodle, the list has the side the money left alone.)
- An imported line's amount and date still can't be changed, and its name is its note: renaming one replaces the bank's wording, which a money-in Rule reads. Giving money in a Parent's name and day beside the bank's (as ADR-0060 did for a Transaction) needs `income.merchant` and `income.bank_date`, and is not done here.
- An Account's own list and a Bucket's are unchanged: they don't ask for money in.
