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

`fresh_starts` holds each request: its level, who asked, when it runs, its status (scheduled, running, failed, done, cancelled; see the addendum) and its progress. Starting one makes the row and a Fresh start Workflow instance with the same ID, which sleeps until the row's run time, then takes it from scheduled to running only if nobody cancelled it. Cancelling, by either Parent, marks the row cancelled and terminates the instance; if it has already woken, it reads the cancel and stops. Only one can be scheduled or running at once.

With both Parents in the Household it runs 24 hours later, and the other Parent is told. A Household with one Parent may run it at once after the typed confirmation. (#63's first part runs it at once; the second part adds the wait, the warnings and the Danger zone.)

The row has no foreign key, so Delete Household can remove the Household while it runs; it removes this row too. A fresh start keeps it, as done, so the screen can say "All cleared".

## Progress

Before each step the Workflow writes the step to the row and the Agent sends open screens `{ freshStart: { step, steps, label, state } }` ("Clearing Transactions and the Plan… 5 of 6"), ending in `state: "done"`.

## Addendum (#118): runs, a failed clear, and both Parents agreeing

Found the night the owners started fresh for real: a step failed its retries and the screen kept showing a step that didn't move; restarting the Workflow instance left the request at `running` for good; and the day's wait couldn't be skipped although both Parents wanted it.

### A request is carried by one run at a time

A **run** is one Fresh start Workflow instance. The first run's id is the request's own. Try again and "Start it now" hand the request to a new instance, whose id is kept in `fresh_starts.run_id` (null means the first). The hand-over is one conditional update, so two Parents pressing at once start one run, not two.

- **A run that begins** reads the request (`freshStartRunPlan`): `scheduled` waits until the run time, then clears; `running` or `failed` clears at once (a restarted instance, or a new run, carries on); `cancelled`, `done`, gone, or another run's request exits.
- **Before every step** a run reads the request again (`freshStartCarriesOn`) and ends, touching nothing more, unless it is `running` and still this run's. So a second run that finds the work done exits, and a run that was replaced stops before its next step. The Worker also terminates the replaced instance when it can. At worst the old run finishes the one step it was in while the new one starts: every step is repeatable (it finds less, or nothing, to clear) and the snapshot step skips when the snapshot is there, so that overlap clears nothing twice and nothing extra.
- A request that is gone carries on: Delete Household removes its own record in its last step, and a retry of that step must still finish.
- A later run goes over the steps an earlier run finished, quietly (they find nothing left), and reports progress only from the step the request had reached, so progress and "done so far" never go backwards. This was chosen over skipping those steps: a bank connected or a Nudge held while the request sat failed is then dealt with too.

Waking the sleeping instance: Workflows has no call to cut a `sleepUntil` short, so "Start it now" sets the run time to now, creates a new instance and terminates the sleeping one (as Cancel already does). If the terminate doesn't land, the old instance wakes a day later, finds the request done or not its own, and exits.

### Failed, stuck, and Try again

A step has five retries, 30 seconds doubling (15½ minutes of waiting). When they are used up the Workflow marks the request `failed` with the step (`failed_step`) and the time (`failed_at`), tells the Household's open screens, and ends in error. A `failed` request is still the Household's one request: no other can be scheduled beside it, it can't be cancelled (part of the Household is cleared), and work begun before it still stops before writing (`clearedSince`).

A request is shown as **stuck** when it should be moving and hasn't begun a step for **20 minutes** (`STUCK_AFTER_MS`; `progress_at` is stamped when each attempt of a step begins): `running` with nothing begun since, or `scheduled` and 20 minutes past its run time. Twenty is longer than any silence a healthy run leaves: an attempt may take 10 minutes (the Workflow's limit for a step) and the longest wait between retries is 8. Stuck is only how it is shown; the row isn't changed until a Parent tries again. Open screens ask again each minute while a request exists, so they find out without being told.

Both Parents then see, in the banner on every page, in the Danger zone and on the progress screen: where it stopped, what has finished ("Done so far: a snapshot taken, banks disconnected and background work stopped"), that nothing else has been cleared since, and **Try again**. What is listed comes from the step the request reached, less the step that failed and all after it; when unsure it says less, never more. Try again starts a new run, which carries on as above.

### Both Parents agree

While a request waits, the Parent who did not ask reads "Ryan asked to start fresh. It happens tomorrow 3:12 PM." with **Cancel** and **Start it now**. Start it now asks for the Household's name, as the first Parent's confirmation did (checked on the server too), records who agreed (`agreed_by`), sets the run time to now and starts a run. The Parent who asked sees only Cancel, and the server refuses them: nobody skips their own wait alone, so the day stands unless both agree. Cancel works until the run begins. A Household with one Parent is unchanged. Delete Household's "Also delete the last snapshot" is kept on the request (`delete_backups`) so a later run honours it; a request made before this has none, and keeps the last snapshot.

### Not covered

If creating the new instance fails after the hand-over, the request points at a run that never began; it shows as stuck 20 minutes later and Try again starts another. A Delete Household whose last step fails after removing its own record leaves nothing to show a failure on.
