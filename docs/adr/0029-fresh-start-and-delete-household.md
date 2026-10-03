# Fresh start and Delete Household

A Parent can clear the Household and begin again (#63). Its data lives in D1, R2 (statements, Receipts, downloads), Vectorize (the merchant index), the Household Agent's storage, Plaid, and whatever Workflow is running for it, so clearing it is a job of several steps, any of which can fail halfway.

## Two levels

- **Fresh start** keeps the Household (its name, time zone, Check-in day, Receipt address), both Parents and the Children, and clears all money data: every other household-scoped table. With no Setup progress, Buckets or Accounts left, the get-started wizard (#53) opens next.
- **Delete Household** clears everything, membership included. Both Parents go back to `/welcome`, as if they'd never joined. Their Clerk accounts stay; deleting one is Clerk's account page, not Noodle's.

Invites, push subscriptions and Nudge settings go in both: they belong to the old start, and a Parent turns Nudges on again from the wizard.

## Which tables

`HOUSEHOLD_TABLES` (`packages/db/src/fresh-start.ts`) lists every household-scoped table, parents before children, starting from the seed's order. A test finds every table in the schema with a `household_id`, or with a foreign key to one, and fails if any isn't listed, so a new table can't be left behind. Rows are cleared in reverse, after `households.emergency_goal_id` is set to null. A fresh start skips `households`, `members` and `fresh_starts`.

## Order

The Fresh start Workflow runs these steps, each retried and each safe to run again:

1. **Disconnect banks**: Plaid's `/item/remove` for every linked Bank Connection, through #61's disconnect, while the tokens are still in D1. If Plaid can't be reached the step retries, and nothing has been cleared yet. Once a connection is disconnected, a running Import stops at its next round and webhooks find nothing.
2. **Stop background work**: the Household Agent deletes its alarm and all its storage (Nudges held, background AI held or retrying, the model budget) and tells open screens to reload.
3. **Forget merchants**: the merchant index's vector IDs are `{householdId}:{hash of merchant}`. Vectorize can't list by prefix, so the merchants are kept in `merchant_vectors` as they're learned (from #63 on), and for older ones derived from the Household's Transactions and Review (the merchantKeys `loadCorrection` teaches from). Their IDs are deleted a thousand at a time.
4. **Clear files** in R2 under `{householdId}/`, `receipts/{householdId}/` and `exports/{householdId}/`, a page of a thousand at a time.
5. **Clear rows** in D1, as above.

The fresh start is **done at "cleared"**, right after step 5: its row is marked done with theA Workflow's instances can't be found by Household, so they aren't terminated. Instead each one that writes for a Household (Import, Month-close, Perk research, Setup, download) checks before every step whether that Household is being cleared, or had a fresh start finish after the instance began (`clearedSince(db, householdId, startedAt)` in packages/db; `stopIfCleared` wraps the Workflow's step). If so the step throws a NonRetryableError that the Workflow catches, and it stops quietly without writing. The Agent's background AI checks the same before looking for Insights. An Import also stops once its Bank Connection is disconnected (step 1), and background AI and Nudges lose what they held (step 2).e Agent's storage aren't swept, since neither can tell what was written after the clear.

## Workflows already running

A Workflow's instances can't be found by Household, so they aren't terminated. Instead they run out of things to do: an Import stops once its Bank Connection is disconnected (step 1); background AI and Nudges lose what they held (step 2); a Month-close, Perk research, Setup or download Workflow that writes in the meantime has what it wrote removed by the sweep. The rows they would read are gone, so a later run finds nothing.

## Grace period

`fresh_starts` holds each request: its level, who asked, when it runs, its status (scheduled, running, done, cancelled) and its progress. Starting one makes the row and a Fresh start Workflow instance with the same ID, which sleeps until the row's run time, then takes it from scheduled to running only if nobody cancelled it. Cancelling, by either Parent, marks the row cancelled and terminates the instance; if it has already woken, it reads the cancel and stops. Only one can be scheduled or running at once.

With both Parents in the Household it runs 24 hours later, and the other Parent is told. A Household with one Parent may run it at once after the typed confirmation. (#63's first part runs it at once; the second part adds the wait, the warnings and the Danger zone.)

The row has no foreign key, so Delete Household can remove the Household while it runs; it removes this row too. A fresh start keeps it, as done, so the screen can say "All cleared".

## Progress

Before each step the Workflow writes the step to the row and the Agent sends open screens `{ freshStart: { step, steps, label, state } }` ("Clearing Transactions and the Plan… 5 of 6"), ending in `state: "done"`.
