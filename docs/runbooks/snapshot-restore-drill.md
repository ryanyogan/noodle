# Household snapshot restore drill (local)

Proves, on your own machine, that **take a snapshot → change things → restore** gives the same Household back (#78, ADR-0035). Everything here is local: the local D1 database and the local `noodle-backups` bucket that the dev server keeps under `apps/web/.wrangler/`. Never add `--remote` to any command on this page. For the whole database there is no backup file any more: it is D1 Time Travel (ADR-0039, which removed the nightly export), and how to use it is in `restore.md`.

**This drill has not been run by anyone yet** (the table at the end is empty). It was written, and corrected in phase 78j, from the code alone: the first person to run it should fix any command that doesn't do what it says, and fill in the first row.

## 0. The quick check (no server)

The unit tests do the round trip on an in-memory database: snapshot, Fresh-start clear plus changes, restore, identical rows; a second Household untouched; a restore that stops part way made whole again from its "Before restore" snapshot; the merchant index's teaching the same after as before; held files kept and released, also when a file is deleted by hand; a snapshot before a Rule files several Transactions.

```sh
cd packages/db  && bunx vitest run src/snapshot-restore.test.ts src/merchant-rebuild.test.ts
cd apps/web     && mkdir -p .tmp-shots && TMPDIR=$PWD/.tmp-shots bunx vitest run src/server/snapshot-store.test.ts src/server/file-holds.test.ts src/server/merchant-rebuild.test.ts
```

Green here is necessary, not enough: it doesn't run the restore Workflow (`SnapshotRestoreWorkflow`, whose steps call the functions these tests cover, in an order only a run proves). CI's `e2e/snapshots.spec.ts` runs the Workflow once, on a small Household with the stub model. The drill below does it on a full one.

## 1. Set up

Run from `apps/web`.

```sh
cp /path/to/your/.dev.vars .dev.vars      # once, in a fresh checkout
bun run db:migrate:local
env AI_MODEL=stub PORT=5186 bun run dev
```

Sign in as a Parent of a Household with real-looking data (several Buckets, Goals, Accounts, a few months of Transactions, an imported statement, a Receipt). Don't run `bun run seed` against a database you care about.

## 2. Take the snapshot and record "before"

1. Household → Your data → Snapshots → **Take a snapshot**, note "drill".
2. Dump the local database and keep its rows, sorted (a restore puts rows back in the snapshot's order, so the files are compared sorted, not line by line):

```sh
npx wrangler d1 export noodle --local --no-schema --output=.tmp-shots/before.sql
grep '^INSERT' .tmp-shots/before.sql | sort > .tmp-shots/before.sorted
```

3. Note the Household's id and its counts (they are also in the snapshot's row):

```sh
npx wrangler d1 execute noodle --local --command="SELECT id, kind, note, row_counts FROM household_snapshots ORDER BY created_at DESC LIMIT 3"
```

## 3. Change things

Do at least one of each, so the restore has something to undo in every direction:

- **Add:** a Quick Add Transaction, a new Bucket, a new Goal.
- **Change:** rename a Bucket, move a Transaction to another Bucket, change the Plan for this month.
- **Remove:** delete a Transaction and a Rule.
- **A Rule in bulk:** add a Rule that files two or more Transactions waiting in Review. The toast should end "Noodle took a snapshot first, …" and a "Before applying a Rule" row should appear in Snapshots (one Transaction: no snapshot, and the toast doesn't say so).
- **Optional, the hard case:** Start fresh (one Parent: it runs at once). The statement and Receipt files the snapshot refers to must still be in the local `STATEMENTS` bucket afterwards, and listed in `households/<household id>/held-files.json` in the local `noodle-backups` bucket. A download prepared under Your data is deleted and does not come back with the restore (the sheet says so).

Confirm the dump now differs: `npx wrangler d1 export noodle --local --no-schema --output=.tmp-shots/changed.sql` and `diff <(grep '^INSERT' .tmp-shots/changed.sql | sort) .tmp-shots/before.sorted | head`.

## 4. Restore

Household → Your data → Snapshots → **Restore** on the "drill" snapshot, type the Household's name, wait for it to finish. The dev server's log should end with `Snapshot restored` and then `Merchant index rebuilt` (or, if the rebuild failed, `Couldn’t rebuild the merchant index`: the restore still counts as done, and merchants are learned again as Transactions are assigned). A second Parent with Household settings open should see the "Before a restore" row appear without reloading.

## 5. Compare

```sh
npx wrangler d1 export noodle --local --no-schema --output=.tmp-shots/after.sql
grep '^INSERT' .tmp-shots/after.sql | sort > .tmp-shots/after.sorted
diff .tmp-shots/before.sorted .tmp-shots/after.sorted
```

**Pass** when the only lines that differ are in tables a restore doesn't put back or writes itself:

| Table | Why it may differ |
| --- | --- |
| `household_snapshots` | the "Before a restore" snapshot (and "Before a Fresh start" or "Before applying a Rule", if you did those) is new; the history isn't restored |
| `fresh_starts` | kept across a restore, never restored |
| `members` | only if a Parent joined after the snapshot: members are added or updated, never removed |
| Anything that records a Nudge or an email | the other Parent is told about the restore. Not checked which table, if any, this writes: the Nudge goes through a Queue and the email through the dev outbox. Name it here when the drill is first run. |

**Fail** on any other table: a row missing, extra or changed. Keep both `.sorted` files and open an issue with the diff's table names (not its rows: they are a family's data).

Also check, by hand:

- The counts on the page (Transactions, Buckets, Goals, Accounts) match the snapshot's row from step 2.
- An imported Transaction's statement and a Receipt's picture still open (their files weren't deleted).
- A second Household in the same local database, if you have one, has identical rows before and after (`grep` its id in both `.sorted` files).
- Restoring the "Before a restore" snapshot brings back the state from step 3.
- A migration added between taking a snapshot and restoring it doesn't stop the restore when it only adds columns or tables (ADR-0048): the row still offers "Restore", new columns take their defaults and new tables come back empty, so the dump differs from step 1's in exactly those columns. Run the plain drill on one schema.
- To drill the carry itself: take the snapshot, `git switch` to a commit with a later migration, `bun run db:migrate:local`, restore. Expect the sheet to list anything that comes back differently (after 0052: "every Account in it comes back unarchived"), and the `INSERT` lines to match apart from the added columns. A snapshot taken on the later schema and restored after switching back is refused: "taken with a newer version of Noodle".
- `bun run test` fails (`snapshot-carry.test.ts`) when a migration since 0048 does more than add and has no transform in `packages/db/src/snapshot-carry.ts`. Write the transform; never skip the test.

Clean up: `rm -r .tmp-shots/*.sql .tmp-shots/*.sorted` (they hold the Household's data).

## Drills

| Date | Who | Commit | Changes made (step 3) | Result | Notes |
| --- | --- | --- | --- | --- | --- |
