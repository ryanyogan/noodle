# Household snapshots: one Household's rows, gzipped JSON in noodle-backups

The nightly whole-database backup (ADR-0032) is for the operator: it restores all of Noodle or nothing. A Parent needs something smaller they can see and use: "take a snapshot before I try this", "what did we have last week", and, after a Fresh start, bad import or bug, "put our Household back". So each Household gets its own snapshots (#78).

## What a snapshot is

- One Household's rows from every household-scoped table, as JSON, gzipped, stored at `households/<householdId>/<ulid>.json.gz` in `noodle-backups` (the `BACKUPS` binding #79 added; no new binding). Never the whole database, never another Household's rows.
- The tables are `SNAPSHOT_TABLES`: Fresh start's `HOUSEHOLD_TABLES` (ADR-0029) minus `household_snapshots` (a snapshot doesn't hold the list of snapshots) and `fresh_starts` (restoring one could start a Fresh start again). Built from the same list, so the two can't drift: `fresh-start.test.ts` already fails when a table with a `household_id` (or one pointing at one) isn't listed, and `snapshot.test.ts` fails when one is listed but not snapshotted without a reason.
- Rows are stored as the database holds them (each column's driver value: timestamps as milliseconds, booleans as 0/1, JSON columns as text), keyed by column name, so a restore writes exactly what was there.
- Files (statements, receipts) are referenced by their R2 keys, not copied.
- The file starts `{"format":1,"householdId":…,"takenAt":…,"migration":…,"tables":{…}}`. `format` changes when the file's shape changes; `migration` (the newest `d1_migrations` name) says which schema the rows fit, so a restore can map an older snapshot forward or refuse it plainly.
- A `household_snapshots` row holds what the history shows: kind, who took it, when, the note, bytes, migration and rows per table. Its contents are never shown.

## When

- **By hand:** Household → Your data → Snapshots → "Take a snapshot", with an optional note. Either Parent.
- **Nightly:** the nightly cron (`0 9 * * *`) takes one for every Household straight after starting the Backup Workflow, a Household at a time, each failure logged and the rest carrying on. A Household that already has a nightly snapshot for that UTC day is skipped, so a retried cron doesn't double up. It isn't a step in the Backup Workflow: that Workflow stops at once while the export token is missing (ADR-0032), and the whole-database backup stays exactly as it was.
- **Before risky actions** (later phases): Fresh start, Delete Household, restoring a snapshot (kind `before-restore`), a bulk Rule apply, statement imports that replace data.

## Keeping them

Pruned after each nightly run, per Household (`snapshotsToPrune`, unit-tested):

- the newest 14 nightly snapshots;
- of older nightly ones, the newest in each of the 8 most recent weeks;
- manual and before-action snapshots for 90 days, at most the newest 20.

Pruning deletes the R2 object, then its row. Nothing under `households/` is bucket-locked or lifecycle-expired; the app's pruning is the only thing that removes them (and Delete Household, below).

## Privacy

A snapshot holds both Parents' data, including each one's Personal Allowance. So its contents are never shown or downloaded: the history shows only when, kind, who, the note, size and a few counts (Transactions, Buckets, Goals, Accounts). Download your data (#62, ADR-0028) stays the way to take data out. (The brief for phase 78a suggested a download; the issue's privacy rule wins.) Server logs name the snapshot and its counts, never rows.

Either Parent may take or (later) restore one; a restore will tell both.

## Restore (later phase)

"Restore this snapshot" replaces the Household's rows with the snapshot's: behind a typed confirmation like Fresh start's, first taking a `before-restore` snapshot, then clearing with Fresh start's machinery and inserting in batches in a Workflow, checking counts. It touches only rows with this Household's id. The merchant index and the Household Agent's state are rebuilt, not restored. A snapshot from an older migration is mapped forward or refused with a clear message.

## Fresh start and Delete Household

A Fresh start keeps `household_snapshots` (with the Household and its members), so the history survives it and a Fresh start can be undone. Delete Household removes the rows and, so its privacy promise holds, the snapshot files too. Keeping one final snapshot for 30 days unless the Parent ticks "also delete backups", and deferring statement and receipt file deletion past the retention window, are the restore phase's to decide; until then nothing is kept after a Delete Household.
