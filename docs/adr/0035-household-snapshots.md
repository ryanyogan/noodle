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
- **Before risky actions:** Fresh start (`before-fresh-start`), Delete Household (its one last snapshot, below), restoring a snapshot (`before-restore`), and a bulk Rule apply (`before-rule-apply`, below). Statement imports that replace data: no such path exists yet.

## Keeping them

Pruned after each nightly run, per Household (`snapshotsToPrune`, unit-tested):

- the newest 14 nightly snapshots;
- of older nightly ones, the newest in each of the 8 most recent weeks;
- manual and before-action snapshots for 90 days, at most the newest 20;
- snapshots taken before a bulk Rule apply for 90 days, at most the newest 3, counted on their own (Before applying a Rule, below).

Pruning deletes the R2 object, then its row. Nothing under `households/` is bucket-locked or lifecycle-expired; the app's pruning is the only thing that removes them (and Delete Household, below).

## Before applying a Rule

Applying a Rule to what's already imported files many Transactions at once, and is the one bulk change a Parent can't easily undo. So a snapshot of kind `before-rule-apply` ("Before applying a Rule" in the history, restorable like any other) is taken first.

- **Its own cap (decided 2026-10-04, #78):** the newest 3 are kept, for 90 days, counted apart from every other kind. A Parent who applies twenty Rules in an evening would otherwise push every snapshot they took by hand out of the shared "newest 20"; this way neither kind can ever evict the other. Three, because only the last few applies are worth undoing and each is a whole copy of the Household; 90 days, like the other before-action kinds.
- **Bulk** means the Rule is about to file more than one Transaction (`BULK_RULE_APPLY = 2`). One Transaction is undone from its own card, so none is taken; nor when nothing matches.
- **Where:** `applyRuleWithSnapshot` (`apps/web/src/server/snapshot-store.ts`), which both "apply" paths use: saving a Rule with "apply", and applying one from Rules. The database's `applyRule` calls it back once it knows how many Transactions it will file, before it files any.
- **If the snapshot can't be taken, nothing is filed** and the Parent is told to try again, as a Fresh start stops when its snapshot fails. (A Rule saved with "apply" is itself saved by then; it just hasn't been applied.)
- **Pruned at once:** straight after the apply, that kind alone is pruned to its cap (the nightly run would do the same); snapshots of other kinds aren't looked at then. A failed prune is logged and left for the night.
- **No note** names the Rule: it may be a Parent's private one, and the history is the same for both Parents. The row says which Parent applied it.
- **No migration:** `household_snapshots.kind` is plain text with no CHECK in the database; the list of kinds lives in the code's schema only.
- **Not covered:** Transactions that categorization files by a Rule on its own (after an import, or "Look again"); those are not a Parent applying a Rule.

## Privacy

A snapshot holds both Parents' data, including each one's Personal Allowance. So its contents are never shown or downloaded: the history shows only when, kind, who, the note, size and a few counts (Transactions, Buckets, Goals, Accounts). Download your data (#62, ADR-0028) stays the way to take data out. (The brief for phase 78a suggested a download; the issue's privacy rule wins.) Server logs name the snapshot and its counts, never rows.

Either Parent may take or (later) restore one; a restore will tell both.

## Restore

"Restore" on a snapshot in the history replaces the Household's rows with the snapshot's. Either Parent may.

- **Confirmation:** a sheet says what happens, then the Parent types the Household's name (checked again on the server), as Fresh start does.
- **Refused plainly, before anything is touched,** when the file belongs to another Household, has another `format`, or was taken under another `migration` than the newest applied. There is no mapper from an older schema yet, so an older snapshot is refused ("taken before Noodle's last update changed how data is stored") and the history marks it "Can't be restored". A mapper can be added per migration when one is worth writing. Also refused while a Fresh start is scheduled or running, or another restore is under way.
- **Before restore:** a `before-restore` snapshot is taken first, in the request. Its id is the restore Workflow's instance id, which is how the page follows progress.
- **The Workflow** (`noodle-restore`, `SnapshotRestoreWorkflow`), each step retried alone: check the file; disconnect banks linked since the snapshot (their rows are about to go, and a link left behind would keep running at the bank); clear the Household Agent's held work; clear the Household's rows as a Fresh start does (the Household, its members, its Fresh starts and its snapshot list stay); put back members; put back each table, parents before children; put back the Household's own row (its settings and emergency Goal) last.
- **Batches and counts:** rows go in with the column names they were stored under, as many rows per statement as D1's 100 bound values allow. Each table's step deletes the Household's rows in it first, so a retry starts clean, and fails when the count afterwards isn't the snapshot's.
- **Only this Household:** every delete is scoped to the Household's id, and a snapshot row carrying another Household's id is refused before anything is deleted (unit-tested with two Households in one database).
- **Members are added or updated, never removed:** a Parent who joined after the snapshot keeps their way in. The Household's name and settings go back to the snapshot's.
- **Files are not touched:** statements and receipts stay in R2, so the restored rows' keys still resolve; a Fresh start in between leaves the files its snapshots refer to (Files, below). The files the rows about to go refer to are noted as held, for the `before-restore` snapshot.
- **Not restored:** the snapshot list and Fresh starts.
- **The merchant index is built again.** Before the rows are cleared the index forgets the Household's merchants (as a Fresh start does), so nothing learned since the snapshot is left pointing at a Bucket that no longer exists. After the rows are back, last of all, it learns again from them: each merchant in `merchant_vectors` with the Bucket of the newest imported Transaction a Parent settled for it (`learnedMerchantBuckets`), which is what teaching it wrote in the first place. Twenty merchants a step; each vector's id is made from the Household and the merchant, so a retry or a second run writes the same vectors over. It never fails the restore: if the embedding model is down it is logged, and merchants are learned again one at a time as Transactions are assigned. A merchant whose only teaching Transaction is gone, or was taught under its statement name before it was given a clean name, is not learned again.
- **Telling people:** open screens refetch; the other Parent gets a Nudge and an email (their verified address in Clerk, the path the Check-in email uses). The Parent who restored sees it finish on the page.
- **If it stops part way** (retries used up), the page says so; the `before-restore` snapshot holds what was there, and restoring either one again starts clean.

## Fresh start and Delete Household

**Fresh start** keeps `household_snapshots` (with the Household and its members), so the history survives it, and its Workflow takes a `before-fresh-start` snapshot before it clears anything. So a Fresh start can be undone, and its sheet says so instead of "This can't be undone": for up to 90 days (the before-action retention above) the Household can be put back from Snapshots. Bank links were removed at the bank, so banks need connecting again. Statement and receipt files that a kept snapshot refers to are no longer deleted by the Fresh start (Files, below), so a restore finds them, and the sheet now says so (858d552): "Noodle takes a snapshot first. For up to 90 days you can put your Household back from Snapshots in Household settings. Statement and Receipt files come back with it: Noodle keeps them for as long as a snapshot needs them. Banks need connecting again." The Danger zone card in Household settings says the same in short: "Noodle takes a snapshot first: for up to 90 days you can put your Household back from Snapshots, statement and Receipt files included. Banks need connecting again." Both take their 90 from `SNAPSHOT_KEPT_DAYS`.

**Delete Household** removes the rows and every snapshot under `households/<id>/`. Before that, its Workflow keeps one last snapshot, unless the Parent ticked "Also delete backups" on the confirming sheet (then nothing is kept):

- It is the same file as any snapshot, written to `deleted-households/<householdId>/<fresh start id>.json.gz`, outside the prefix the delete empties, with `deleteAfter` in its metadata. It has no row anywhere: the history's rows go with the Household.
- The nightly run deletes every file under `deleted-households/` uploaded 30 or more days ago (`pruneFinalSnapshots`, unit-tested; `FINAL_SNAPSHOT_DAYS`). It goes by R2's upload time, so it needs no table and can't be left behind by a deleted row.
- **No Parent can restore it.** The Household and its members are gone, so nobody can sign in to it, and the restore Workflow needs a Household to restore into. Only the operator can put it back, by hand: make the Household and member rows from the file's `households` and `members` tables, then insert the rest (`restoreHouseholdRows`). There is no tool or screen for this. So the sheet promises only what is true: "This can’t be undone. Noodle keeps one last snapshot for 30 days, then deletes it. You can’t put it back yourself. On the next step you can choose to delete it too." (The 30 is `FINAL_SNAPSHOT_DAYS`.) It no longer says "in case you write to us" (858d552): nothing in the app stands behind that, as there is no tool or screen for putting one back. The next step is the "Also delete backups" tick; left unticked it says "One last snapshot is kept for 30 days, then deleted."
- **The trade-off:** by default a deleted Household's data (both Parents', Personal Allowances included) exists for up to 30 more days in `noodle-backups`, readable only by the operator, against a family deleting by mistake, or one Parent deleting what the other wanted kept, with no way back. The tick gives the stricter promise to a Parent who wants it. Bank links, the merchant index and the Agent's state are deleted at once either way; statement and receipt files the last snapshot refers to stay as long as it does (Files, below), and with the tick every file goes at once; and the whole-database backups (ADR-0032) hold the Household until they expire, whatever is ticked.
- The choice travels in the Workflow's params, not a column: it is made once, by the Parent who confirms, and the other Parent can still cancel during the day's wait.


## Files: kept while a snapshot needs them

A snapshot refers to statement and Receipt files by their keys in R2 (`STATEMENTS`); it doesn't copy them. So a file must outlive the rows that pointed at it for as long as a kept snapshot refers to it, and go once none does.

- **Which files a snapshot refers to** is read from its rows by value, not by column: every text value that is a key under one of the Household's file prefixes (`referencedFiles` in `@noodle/domain`). A new table that keeps a file is covered without being listed.
- **A Fresh start** deletes at once every file no snapshot in the Household's history refers to (downloads always: no row holds their key), and leaves the rest. The sweep two minutes later does the same. What it left is written to a list beside the snapshots, `households/<id>/held-files.json` in `noodle-backups`. No table, no migration.
- **A restore** adds the files the `before-restore` snapshot refers to, since the rows pointing at them are about to go without their files being deleted.
- **Each night, after pruning,** every file on a Household's list is checked (`splitHeldFiles`, unit-tested): kept while the Household's rows as they are now refer to it (a restore brought them back) or any snapshot still in the history does; deleted otherwise, which is the night its last snapshot expired. A snapshot whose file can't be read stops that Household's check: nothing is deleted on a guess.
- **Delete Household** keeps the files its one last snapshot refers to and deletes the rest; with "Also delete backups" there is no last snapshot, so every file goes at once, as before. No list is kept (it would go with the Household's snapshots): when the nightly run removes a last snapshot at 30 days, it first deletes every file under that Household's prefixes, and only if no Household with that id exists.
- **Only held files are ever deleted this way.** The nightly run doesn't go looking for files nothing points at; it only goes through the list. A file deleted by other means (removing an Import) is unaffected, and still goes even when a snapshot refers to it.
