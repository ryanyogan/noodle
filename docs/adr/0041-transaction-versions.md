# A version on each Transaction, so two screens never quietly overwrite each other

Decided 2026-10-04 (#85).

Both Parents use Noodle at the same time on their own phones. Changing a Transaction was an UPDATE by ID with nothing to say what the Parent had been looking at, so when two screens (the two Parents, or two tabs) changed the same one, the request that landed last won and the other change was gone without a word. #84 and the first half of #85 put one screen's own writes in order (`reviewWrites`); nothing ordered two screens.

## Decision

`transactions.version` (`integer not null default 0`, migration 0049) goes up by one with every write that changes what a Parent sees of the Transaction.

- **A Parent's change says which version it was made on** (`expectedVersion`): an edit, a split, a delete, an Undo back into Review. The write is guarded in the UPDATE itself (`where id = ? and version = ?`, `set version = version + 1`), so the check and the write are one statement and cannot race. Its For and Splits are written in the same batch only if that UPDATE landed.
- **Refused is an answer, not an error.** The server functions answer `{ status: "changed-elsewhere", current }` with the Transaction as it is now; nothing is thrown, no 500. A retry of a change that already landed is still recognised as that change (the Transaction holds its values and is exactly one version on), so retries stay safe.
- **Background writers move the version on and are never refused themselves**: the bank's sync taking a posted line over a pending one, categorization and Rules filing it, a Refund link assigning or unassigning it, filing without a Bucket. They name no version. A Parent's change made on what was there before them is then refused instead of landing on top.
- **Not counted as a change**: the background naming of a merchant (ADR-0027). It runs minutes after an import, exactly while Parents are in Review, an edit keeps the name anyway, and counting it would refuse honest decisions.
- **One screen's queue carries the version forward.** Several changes to one Transaction can wait their turn. Each is sent with the newer of the version on the row it was made from and the version this screen's last write to it answered, looked up when it is sent, not when it was queued (`apps/web/src/transaction-versions.ts`). When one is refused, what was remembered is forgotten rather than caught up, so the changes waiting behind it are refused too and not sent over a change the Parent never saw.
- **What the Parent sees** (plain words, ADR-0018): the change is undone on screen, the Transaction is shown as it is now, and one message says "This Transaction was changed on another screen. Here's how it looks now." once, however many changes were refused together. An edit form that is open when the other change arrives starts again from the fresh values with the same message. A Review card someone else already decided leaves the stack. A batch files what it can and says how many it left: "3 were changed elsewhere and left as they are."

## Considered

- **Last write wins, with live refresh only.** The screens already refetch when the Household changes, but a form that is open keeps what it showed, and a phone that was asleep hears nothing. This is what lost changes.
- **`updated_at` instead of a counter.** Two writes in the same millisecond compare equal, and D1 has no finer clock. A counter cannot tie.
- **Merging field by field** (her note, his Bucket). More to explain than "it changed, here it is", and Splits, For and the amount depend on each other. Not worth it for two people.
- **Locking a Transaction while it is open.** A phone put down mid-edit would lock the other Parent out.

## Consequences

- A change made on an old version is never written. The Parent has to make it again on what is there now; nothing redoes it for them.
- The message says "another screen" for the bank's sync and for a Rule too. It is true enough and one message is easier to learn than three.
- Restoring a Household snapshot (ADR-0035) puts versions back to what they were in the snapshot. A screen left open across a restore may have a change refused once, then is right again after its refetch. A snapshot from before versions existed is restored with every version at 0 (ADR-0048).
- Every `insert … select` into `transactions` lists the column (`0 as version`): Drizzle fills those by position.
