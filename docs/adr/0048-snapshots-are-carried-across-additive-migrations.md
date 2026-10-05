# Snapshots are carried across additive migrations

Status: accepted (2026-10-05, issue 88)

## Context

A Household snapshot records the newest migration it was taken under (ADR-0035). Until now a restore was refused unless that was still the newest: "taken before Noodle's last update changed how data is stored", and the history said "Can't be restored".

Four migrations landed on 2026-10-05 (0050 to 0053). Each one made every earlier snapshot unrestorable, the "Before deleting Transactions" snapshots included, which are the only way back from a bulk delete (ADR-0045). All four only added things: nullable or defaulted columns and new tables. Nothing in an older snapshot was wrong for the new schema; the rule was simply too strict.

## Decision

**A snapshot taken under an older migration is restored when every migration since is one the restore knows how to carry.** Additive migrations are carried with no code. Anything else needs a transform, and a test fails until it has one.

### The rule

- **Rows go in by column name, with only the columns the snapshot has.** A column added since is left out of the `INSERT`, so it takes the table's default, or NULL.
- **A table the snapshot lacks comes back empty** for that Household (it is cleared like every other table, and nothing is put in).
- **A column or a table the snapshot has and today's schema doesn't is refused, plainly, before anything is touched** ("holds something Noodle no longer stores the same way"). Dropping it silently would lose data. A table with no rows in it is let through: nothing is lost.
- **A snapshot taken under a newer migration than the database's stays refused** (a rolled-back database): "taken with a newer version of Noodle". So does one whose migration, or the database's, can't be read as a number, unless the two names are identical.
- **Order is the number a migration's name starts with** (`0052_account_archive`, with or without `.sql`). The Worker has no list of migrations at run time and needs none.
- The shape check runs on the whole file at both ways in: the server function before the "Before restore" snapshot is taken, and the Workflow's first step. A snapshot from the current migration is checked the same way.

### Migrations that aren't additive

`SNAPSHOT_TRANSFORMS` in `packages/db/src/snapshot-carry.ts` holds `{ migration, up(tables) }` entries: the snapshot's tables as they were before that migration, returned as they would be after it. A restore applies every entry for a migration after the snapshot's and up to the database's, in order, before the shape check and before every step that reads the file. It is empty today.

### The guard

`snapshot-carry.test.ts` reads every file in `packages/db/drizzle/` numbered after 0048 (the migration snapshots began with; no snapshot is older) and fails when one is neither additive nor named by a transform. "Additive" is decided from the SQL by `additiveChanges`: every statement is `CREATE TABLE`, `ALTER TABLE … ADD [COLUMN]`, `CREATE INDEX`, or `CREATE UNIQUE INDEX` on a table the same file creates. `DROP`, `RENAME`, `UPDATE`, `INSERT`, `PRAGMA`, a rebuilt table (`__new_…`), a unique index on a table that already has rows, or any statement it can't read makes the migration not additive. It fails closed.

The same function builds the test fixtures: a snapshot "as taken under 0048 … 0052" is today's with everything later migrations added taken out, restored into a current database with foreign keys on.

What the guard can't see: an additive column whose default is wrong for old rows. A migration that needs old rows backfilled does it with an `UPDATE`, which the guard catches; one that relies on the default being right is saying so.

### What a Parent is told

- The history offers "Restore" on carried snapshots. "Can't be restored" is left for a snapshot taken with a newer version, or in another file format.
- `CARRY_NOTES` holds one plain line per migration where the result differs from what a Parent would expect. The restore sheet lists the lines for the migrations between the snapshot and now. Today there is one, for 0052.

### Today's migrations

| Migration | Adds | A snapshot from before it, restored |
| --- | --- | --- |
| 0049 | `transactions.version` | Every Transaction starts again at version 0. |
| 0050 | `bank_connections.history_start`, `bank_link_sessions.history_start` | NULL: no cut-off. |
| 0051 | `deleted_bank_lines` | Empty: no deleted bank line is remembered. |
| 0052 | `accounts.archived_at` | Every Account unarchived. The sheet says so. |
| 0053 | `perk_pages` | Not Household data; not in a snapshot, not touched. |

- **Versions (ADR-0041).** Any restore, carried or not, puts versions back to the snapshot's, so a screen left open may hold a version higher than the row's and have one change refused before it refetches. Every open screen is told to refetch when a restore ends. Version 0 for a carried snapshot is the same case. A screen that missed the refetch and holds the same number as the restored row could write over it unseen; that was already so for a same-migration restore and is not made worse here.
- **History cut-off (ADR-0020, migration 0050).** A cut-off is only ever set when a Bank Connection is first linked, so a Bank Connection in a snapshot from before 0050 never had one, and its full history was already brought in and is in the snapshot. NULL is the truth. The next read at the bank offers the same lines, which are matched to the restored Transactions by their line IDs. Keeping today's cut-off for the same connection id was considered and dropped: there is none to keep.
- **Deleted bank lines (ADR-0045).** Before 0051 nothing could be deleted, so there were no deleted lines to remember, and the Transactions are in the snapshot. A line that arrived and was deleted after the snapshot comes back on the next bank read, like everything else the bank still reports since then: that is what "as it was then" means for any restore, and the sheet doesn't single it out.
- **Archiving (ADR-0046).** Before 0052 no Account could be archived. They come back as they were: all showing.

## Consequences

- A "Before deleting Transactions" snapshot survives the next additive migration, so bulk delete keeps its way back. ADR-0045's note that a later migration ends it no longer holds for additive ones.
- A migration that is not additive now costs a transform and a test, or the unit suite fails. That is the point.
- The Household's own row and its members are updated in place (ADR-0035), so a column added to `households` or `members` since the snapshot keeps today's value rather than taking the default.
- Snapshots already in R2 from before 2026-10-05 become restorable with no change to their files. None was read to check this; the fixtures are derived from the migrations' SQL.
- If the code is deployed before its migration is applied, a carried restore fails at the insert and the Workflow retries, as any write would.
