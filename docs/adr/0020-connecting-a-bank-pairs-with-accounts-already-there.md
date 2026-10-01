# Connecting a bank pairs with the Accounts already there

Connecting a bank used to create a new Account for every account at the institution, every time (ADR-0017's flow, #45). A Parent who had added "Chase checking" by hand, or kept the Costco card up to date with statements, got a second Account for each, the same spending counted twice, and their Goals left on the old Account (seen live in the #47 review: four "Plaid … ··0000" Accounts beside the ones already there).

Now connecting asks first. After Plaid Link, a **Choose Accounts** step lists each checking, savings, card and loan account the institution has, and for each one the Parent picks:

- **Same as <an Account they already have>**, Noodle's suggestion when it has one;
- **Add as a new Account**, the default when there's no suggestion; or
- **Leave it out**: nothing is brought in for it (a joint account the other Parent connected already, say).

## What pairing does

- **The Account stays.** Its ID, name, kind, Goals (savings and payoff), Set-aside money, balances, statements and Transactions are all kept. Pairing only records the Bank Connection and the bank's ID for the account on it (`accounts.bank_connection_id`, `accounts.external_id`, the columns a connected Account already had).
- **The bank's balance becomes its newest balance**, as a bank refresh would. For a card or loan with a payoff Goal that is "what's owed", so paid down moves at once (ADR-0019). If what Goals have Set aside on a checking or savings Account is more than the bank's balance, the Account shows the shortfall as it does after any balance update; pairing doesn't move Goal money.
- **From then on the bank brings its Transactions in**, and they **Match what's already there** instead of doubling it:
  - **Quick Adds** are Matched with their bank copies as after any Import (the Match rules are unchanged).
  - **Lines a statement already brought in** are recognised: a posted bank line with the same amount within 3 days of a line already in that Account from somewhere else (a statement, or an earlier Bank Connection) is that line. It isn't added again; the row that's there keeps its Bucket, Splits, For, note and any Match, and is marked as the bank's line (`bank_line_id`), so later reads of the same line skip it too. One line on each side pairs with at most one on the other, nearest day first, then the closer description. Pending lines never pair: a statement has none.
  - This is what makes the **first Import** safe: Plaid hands over about 90 days at once, and the part a statement already covered pairs line by line, while days the statements didn't cover come in. A cut-off date ("only after the last statement") was considered; it loses lines a statement missed and can't help with the case below.
  - The other way round works the same: a statement uploaded to a connected Account (the fallback while its bank needs a login again) leaves out lines the bank already brought in, by the same rule, and counts them as already imported.
- **Reconnecting keeps the pairing.** Reconnect uses Link's update mode on the same Item (ADR-0017), so the Bank Connection and its accounts' IDs stay, and so do the Accounts paired with them. Nothing is asked again.

## Suggestions

Noodle suggests an Account only when it has a reason to, and never one it would refuse:

- **Compatible kinds only.** Checking and savings hold money; cards and loans are owed. A bank account can pair with an Account of the same side only, because the sign of every line, what counts as income, and what Goals can do there all follow from it. Within a side the Account keeps the kind the Parent gave it (their "savings" stays savings if Plaid calls it checking).
- **Not connected already.** An Account already paired with any Bank Connection isn't offered.
- **A reason:** the last digits Plaid shows appear in the Account's name ("Visa ··3333", "card 3333") or match the account its OFX statements named (ACCTID, kept on each Import), or the names share a word that isn't generic ("Costco", "Kids", "Chase"; not "checking", "card", "account", "bank" and the like), counting the institution's name. Digits weigh most, then shared words, then the exact kind.
- Each Account is suggested for at most one bank account, the best-scoring pair first.

## Edge cases

- **One bank account paired twice, or two bank accounts paired with one Account.** Refused: an Account holds one Bank Connection and one bank ID, and `accounts_bank_external_idx` keeps each bank account on at most one Account. The sheet doesn't offer an Account twice, and the server checks again.
- **A kind mismatch** across sides (a card chosen for a checking account) is refused by the server and never offered. Within a side, the Account keeps its kind.
- **Unpairing** ("Stop bringing in from <bank>" on the Account's page) clears the two columns. The Account and everything on it stay, and becomes an Account kept by hand or by statements again. Its bank account is then left out of the Bank Connection; the Parent can pair it again (or add it) from the Bank Connection's **Choose Accounts**. Lines the bank sent while it was left out aren't fetched again: the Bank Connection's cursor moved on, so a statement fills that gap, and the overlap rule keeps it from doubling.
- **An Account with a payoff Goal or Set-aside money** keeps them, as above; the bank's balance is simply its newest. A payoff Goal whose card turns out to owe more than its target offers "Start again from today's balance" (ADR-0019).
- **A Plaid account that disappears** (a card closed or reissued, so Plaid stops listing its ID): its Account keeps everything and stops getting lines and balances. Choose Accounts shows it as no longer at the bank, with Stop bringing in; a reissued card's new account can then be paired with the same Account.
- **Leaving Choose Accounts without saving.** The Bank Connection waits in a "choosing" state: nothing is imported (the Import Workflow, the daily sync and webhooks all skip it, so the cursor doesn't move and no history is lost), and its row says "Choose which Accounts these are" until the Parent does.
- **The Bank Connection already in production** has its Accounts already and stays as it is: the new state is only for connections made from now on, and the migration only adds the `bank_line_id` columns.

## Storage

- `bank_connections.status` gains `"choosing"`. The column is plain text in D1, so this is a Drizzle-only change.
- `transactions.bank_line_id` and `income.bank_line_id` (nullable, unique per Account) hold the bank's key (`id:<bank ID>`, as `bankLineKey` makes it) for a row the bank's line paired with. A bank row the bank brought in itself keeps the key in `external_id` as before.
- The decisions are pure functions in `@noodle/domain` (`suggestPairings`, `pairSameLines`); `@noodle/db` writes them guarded, so a second Parent's choice or a retried read changes nothing twice.

## Considered

- **Keep connected Accounts separate and warn.** Simple, but every Household that started by hand (most, since connecting is optional) would count everything twice until it archived its old Accounts, and its Goals would be on the wrong ones.
- **Merge after the fact** ("These two Accounts are the same"): moving Goals, Set-aside money, Transactions and Matches between Accounts is far more to get right than not making the second Account.
- **Pair in the browser, from what Link's onSuccess lists, before exchanging the token.** It avoids the "choosing" state, but Link's account list has no balances, the choice would be lost on a reload, and the public token expires after 30 minutes.
- **A cut-off date instead of line-by-line overlap** (import only lines after the last statement): above.
- **Description matching for the overlap.** Plaid cleans merchant names and statements don't, so descriptions differ for the same line; they only break ties between two lines of the same amount.

## Sources

- Plaid Link, `onSuccess` metadata (accounts with id, name, mask, type and subtype; no balances): https://plaid.com/docs/link/web/
- Plaid, update mode keeps the Item: https://plaid.com/docs/link/update-mode/
- Plaid, `/item/public_token/exchange` (a public token expires after 30 minutes): https://plaid.com/docs/api/items/#itempublic_tokenexchange
- Plaid, `/transactions/sync` (history window, pending and posted): https://plaid.com/docs/api/products/transactions/
- YNAB links an existing account to a bank connection, and imports only from a few days before the last reconciled transaction, telling people to reject duplicates by hand: https://support.ynab.com/en_us/linked-accounts-in-ynab-B1991f2Cc
