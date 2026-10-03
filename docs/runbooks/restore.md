# Restoring the D1 database

Two ways back (ADR-0032): **Time Travel** for anything in the last 30 days, and the **nightly dumps** in R2 `noodle-backups` for anything older or if Time Travel itself is gone. Run every command from `apps/web` (it has the Wrangler config), logged in to the Noodle account (`npx wrangler whoami`).

> **Danger.** Anything marked ⚠️ PRODUCTION overwrites the live `noodle` database that both Parents use. Everything written after the restore point is lost. Do it only on purpose, after taking a bookmark (step 1 below), and tell the Parents first.

## 1. Always first: note where you are

```sh
npx wrangler d1 time-travel info noodle
```

Write the bookmark down. It's the way back if the restore itself turns out wrong.

## 2. Time Travel (the last 30 days)

Find the point to go back to:

- **Before a deploy's migration:** open the deploy run in GitHub Actions; the "Record the Time Travel bookmark" step's log and the run summary show the bookmark taken just before `db:migrate:remote`.
- **Before a time:** `npx wrangler d1 time-travel info noodle --timestamp=2026-10-03T08:55:00Z` shows the bookmark for that moment (a Unix timestamp works too).
- **A nightly backup's moment:** each manifest (`d1/YYYY/MM/DD.json`) has the `bookmark` its export was taken at.

⚠️ PRODUCTION — restore:

```sh
npx wrangler d1 time-travel restore noodle --bookmark=<bookmark>
# or
npx wrangler d1 time-travel restore noodle --timestamp=<RFC3339 or Unix time>
```

Wrangler prints the bookmark from just before the restore, so a restore can itself be undone the same way. If the restore went back past a migration, the code deployed now expects the newer schema: redeploy the commit that matches (the manifest's or the deploy's `migration`), or run `bun run db:migrate:remote` again.

## 3. From a nightly dump

Dumps are `d1/YYYY/MM/DD.sql` (30 days) and `d1/monthly/YYYY-MM.sql` (12 months), each with a `.json` manifest of row counts, migration and bookmark.

```sh
npx wrangler r2 object get noodle-backups/d1/2026/10/03.json --remote --pipe
npx wrangler r2 object get noodle-backups/d1/2026/10/03.sql --remote --file=./restore.sql
```

### 3a. Into the scratch database (safe; the monthly drill)

```sh
npx wrangler d1 create noodle-restore-check        # once; answer "no" to adding a binding
npx wrangler d1 execute noodle-restore-check --remote --file=./restore.sql
npx wrangler d1 execute noodle-restore-check --remote --command="SELECT count(*) FROM transactions"
```

Compare the counts with the manifest's `tables`. To start a drill afresh, delete and re-create `noodle-restore-check` (never `noodle`). Record each drill below.

### 3b. ⚠️ PRODUCTION — into `noodle`

Only when Time Travel can't reach the point you need. The dump has `CREATE TABLE` statements, so the tables must not exist first; that means emptying production.

1. Take the bookmark (section 1). It's the way back if this goes wrong.
2. Import the dump into `noodle-restore-check` first (3a) and check it there.
3. Drop every table in `noodle` (list them with `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'`, then `DROP TABLE` each, children first or with `PRAGMA foreign_keys=OFF`).
4. `npx wrangler d1 execute noodle --remote --file=./restore.sql`
5. Compare row counts with the manifest, then deploy the commit whose newest migration matches the manifest's `migration` (or run `bun run db:migrate:remote` to bring it forward).

## Backup emails

A failed or missing night emails `BACKUP_ALERT_TO`. If `D1_EXPORT_TOKEN` (or an id) isn't set, only the first night emails; later nights only log ("Backup for … skipped") until it's set, and those nights aren't reported as missed afterwards. `noodle-backups/state/backup.json` holds that memory; deleting it only means the next night without the token emails again.

## Drills

| Date | Dump | Result |
| --- | --- | --- |
| _none yet_ | | |
