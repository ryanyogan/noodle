# ADR-0062: A Transfer with both sides in Noodle is one row of the Transactions list

Status: accepted (2026-10-08)

## Context

A Transfer whose two sides are both in Noodle was listed twice on Transactions: the side leaving checking as a plain amount, and the side arriving as money in, with a `+` (a negative Transaction on a card, or a line of `income` in checking or savings, merged in by ADR-0061). Nothing was miscounted, but the owner (issue 152) read it as it looked: "why do credit card payments show as a positive transaction on the transactions page?" Paying a bill read as money coming in, and one payment was two rows.

## Decision

- **One row: the side the money left.** On the Transactions page's list (the one that asks for money in, `moneyIn` on `loadTransactionsPage`), the arriving side of a Transfer that still stands (`removed_at is null`) and has a leaving side (`out_transaction_id`) isn't listed. The leaving side is the row: "Transfer · Checking → Visa", a plain amount. The rule is one more condition on each of the two reads ADR-0061 merges (`arrivingSideOfPair` for `transactions`, `unpaired` for `income`), so every order and every page boundary holds as before.
- **Nothing is stored differently.** Both sides keep their own rows and their own data. Unmarking the Transfer lists both again.
- **Narrowed to an Account, each side is that Account's.** With the Account filter on, the list is that Account's rows, so the card's side is listed under the card (it is the only side that belongs there) and the leaving side under checking. An Account's own page reads through the same filter and is unchanged, as is every list that doesn't ask for money in (a Bucket's, the export, which writes both sides).
- **Under "Money in" the arriving side is never listed**, whatever the Account: it came in nowhere, and the Money in figure never counted it. Under "Money out" the leaving side is listed, and counts for nothing, as before.
- **A side marked alone is as it was**: its other side isn't in Noodle, so it is the only row there is, including a payment arriving on a card from an Account that isn't followed (still money back, with its `+`).
- **The row is found by either side's words.** A search matches the leaving side when the arriving side's note or name has the words, so searching the card's wording for a payment finds the one row. Narrowed to an Account, each side is found by its own words.
- **The row opens as the leaving side does**: its detail shows the other side and Unmark. The arriving side still opens at its own address.
- **Select mode selects what is listed.** "Everything the filters match" leaves the arriving side out as the list does (`selectedBy`), so its count is the list's. Deleting the one row, picked or as part of everything, deletes the leaving side's Transaction and ends the Transfer; the arriving side is kept and is a row again (money back on the card, or money in that waits for its kind), exactly as deleting one side of a Transfer always did. A side is deleted only when a Parent deleted that row.

## Considered

- **Hiding it in the browser.** Wrong at any page boundary: the page that holds one side can't know whether the other is on a page not loaded yet, and the counts and "everything the filters match" would disagree with the rows.
- **Listing the arriving side when the leaving side falls outside the list** (another month, a search that only the arriving side's words match). The row would change sides with the filters, and a payment that left on the 30th and arrived on the 1st would be one row in each month. It is listed once, in the month it left; the search reads both sides' words instead.
- **Deleting both sides with the one row.** It would delete a row the Parent never saw selected, from an Account they may not have meant. The other side staying, an ordinary row again, is what deleting one side already did.

## Consequences

- A Transfer that left in one month and arrived in the next is listed in the month it left only; the arriving month's list has it under that Account's filter.
- The three figures are unchanged: Money in never counted a Transfer's arriving side, Money out never counted either side, and Needs review never held a side of a Transfer. They agree with the rows, with one row fewer that counted for nothing.
- A list of Transactions has two conditions more to keep in step: `loadTransactionsPage` and `selectedBy` share `arrivingSideOfPair` and the search (`saying`); `money-in-rows.ts` has `unpaired`. `one-row-transfer.test.ts` pages every order with both kinds of paired Transfer.
