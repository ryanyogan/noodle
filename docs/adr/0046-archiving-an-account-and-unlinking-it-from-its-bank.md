# Archiving an Account, and unlinking one from its bank

Status: accepted (2026-10-05, issue 94)

## Context

A Parent said: "we should be able to archive accounts, and unlink bank accounts from plaid". The Household had real Accounts on one Bank Connection, practice Accounts left from before the real bank was connected, and a test Account made by hand. They wanted the leftovers out of the way without losing history.

What there was:

- **No way to put an Account away.** An Account could be renamed, never removed or hidden. Every Account showed in Accounts, its totals, and every picker.
- **Stopping one Account existed, half-way.** "Stop bringing in…" on a connected Account's menu cleared its pairing (`unpairAccount`, ADR-0020). When it was the Bank Connection's last Account, the Bank Connection stayed: linked at the bank, its token kept, read every day for nothing, and counted against Plaid's allowance (ADR-0017).
- **Disconnecting a whole bank existed** (`disconnectBankConnection`): removed at the bank, token deleted, every Account unpaired and kept.

## Decision

- **An Account can be archived.** `accounts.archived_at` (null while in use). An archived Account is in none of the Accounts list, the totals, the pickers (a Goal's Account, the Transactions and Reports filters, choosing Accounts for a Bank Connection) or what Perks looks at. They all read `loadGoals`' `accounts`, which leaves archived ones out; the archived ones come beside them as `archivedAccounts`, only to be listed and restored.
- **Nothing about its history changes.** Its Transactions, statements, balances and Imports are not touched, so every past month, Bucket and Report counts what it did. A Report names an archived Account where spending was its.
- **Restore.** "Archived" at the bottom of Accounts lists each with "Restore", which clears `archived_at`. It comes back kept by hand.
- **Not while a Goal is kept in it.** A Goal's money is in its Account, and a Payoff Goal pays its Account down. An Account with a Goal that isn't archived is refused, naming the Goals, and the page says to archive the Goal first. Asking and then archiving the Goals too was rejected: it would end a Goal from a screen that isn't about Goals. No new Goal can be kept in an archived Account.
- **Unlinked is the pairing cleared**, as before: `bank_connection_id` and `external_id` null. That pairing is the only thing the Import Workflow keys on (`loadBankConnectionToImport`, `syncBankLines`, `refreshBankBalances` all match on it), so no flag is needed and the Bank Connection's other Accounts go on untouched. The Account's Transactions keep the bank's own IDs (`transactions.external_id`), so linking it again brings in only what isn't there (ADR-0020).
- **Unlinking the last Account disconnects the Bank Connection**, through the one existing path (`disconnectBankConnection`): removed at the bank, token deleted. If the bank can't be told, nothing changes and the Parent is asked to try again.
- **Archiving unlinks first.** An archived Account that stayed linked would have what the bank sent meanwhile passed over (the cursor moves on for the whole Bank Connection) and never read after a Restore. So archiving a connected Account stops its syncing, the confirm says so, and Restore brings it back kept by hand. Sync still skips an archived Account on its own (the same three places), in case one is ever both.
- **Linking again.** While its Bank Connection is there: "Accounts" beside the bank on the Accounts page, and choose it. After the Bank Connection went with its last Account: connect the bank again and choose the Account (it is suggested by name, kind and last digits). An archived Account is not offered there until it is restored.
- **Where it is on the screen.** A "More" section at the bottom of the Account's page: "Stop syncing with <bank>" and "Archive this Account", each asking first in the usual confirm, in plain words about what stays and what stops.

## Alternatives

- **Delete the Account.** Rejected: its Transactions are the Household's history, and past months would change.
- **A separate "unlinked" flag, keeping the bank's ID on the Account.** Rejected: sync would need the flag checked everywhere the pairing is, and pairing again already finds the Account without it.
- **Keep an archived Account linked and only skip it in sync.** Rejected: lines sent while it was archived would be lost without anyone being told.
- **Archive several at once.** Left out: archiving is rare, and one at a time is clear.

## Consequences

- Archiving the only Account on a Bank Connection ends that Bank Connection at the bank. The confirm says so.
- A Transaction in an archived Account can still be opened and changed from Transactions. The archived Account has no page of its own until it is restored.
- Lines the bank posts between unlinking and linking again are only brought in if they are within what the bank sends on the next read.
