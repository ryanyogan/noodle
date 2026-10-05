# Nightly D1 backup to R2, in a Workflow, with Time Travel bookmarks

Status: superseded by ADR-0039 (2026-10-04). The nightly export never completed in production (the D1 export API refused the token) and was removed; D1 Time Travel, the bookmark before each migration (below, still in place) and Household snapshots (ADR-0035) protect the data now. The rest is kept as the record of what was built.

Production has one D1 database, `noodle`. D1 Time Travel restores it to any minute in the last 30 days, but it lives inside the same database and account: a bad migration found late, a bug that quietly writes bad data for weeks, or an account mistake has no way back. So every night a whole-database export is kept outside the database, in its own R2 bucket, and the deploy records a Time Travel bookmark before each remote migration (#79).

## The Backup Workflow, not a GitHub Actions cron

`wrangler d1 export --remote` in a scheduled GitHub Action would work, but Actions minutes are limited (CI already runs E2E on every push) and it would put production credentials in another place. Instead the existing nightly cron (`0 9 * * *`, 09:00 UTC, about 3–4 am Central, the quietest hour) starts a Backup Workflow (`BACKUP`, `noodle-backup`) first, before the Bank Connection syncs and Insights. Its instance id is `backup-YYYY-MM-DD`, so a retried cron never starts a second one.

The Workflow:

1. Counts each table's rows in the live database (one `count(*)` each, in a batch) and reads the newest `d1_migrations` name.
2. Calls the D1 export API, `POST /client/v4/accounts/:account/d1/database/:db/export` with `{"output_format":"polling"}`, then posts again with `current_bookmark` set to the `at_bookmark` it answered until `status` is `complete` (backing off to 10 seconds between polls; `error` fails it). The result's `signed_url` serves the SQL for one hour; the Workflow fetches it and streams it into R2 (a `FixedLengthStream` sized from `Content-Length`), so the dump never sits whole in memory.
3. Checks the stored object: there, non-empty, and with a `CREATE TABLE` for every live table (read a line at a time).
4. Writes the manifest beside it: bytes, the export's Time Travel bookmark, the migration, rows per table, start time and duration.
5. On the 1st, copies both to `d1/monthly/YYYY-MM.*`.

Any failure, after the retries, emails the operator (`BACKUP_ALERT_TO`, through `sendEmail`, ADR-0026) and logs. A night that never ran is caught by the next night's cron, which looks for the previous night's manifest before starting its own run and emails when it's missing.

The export API, checked against Cloudflare's docs in October 2026: a running export blocks other queries on the database for its duration (hence 3–4 am, and the manifest records the duration so it can be watched as the data grows); virtual tables such as FTS5 can't be exported; very large int64 values lose precision. The API reference doesn't name the token permission it needs.

## Credentials

The Worker calls the API with a user API token in the `D1_EXPORT_TOKEN` secret, scoped to this one account with only D1 permission (Read; if the export endpoint refuses Read, D1 Edit, still nothing else). The account and database ids are plain vars. Without the token (or either id) the Workflow stops at once without exporting. Only the first such night emails the operator, saying which setting is missing; later nights only log, so a token set some days after deploy costs one email, not one a night. The bucket remembers this in `state/backup.json` (outside the locked `d1/` prefix, so it can be overwritten): whether that email went, cleared when a backup is next stored so a later lapse emails again, and the last night skipped, so once the token is set the missed-night check doesn't report the token-less nights (it doesn't check at all while a setting is missing). The token is made in the dashboard and set with `wrangler secret put`, never committed or printed.

## Retention and the lock

`noodle-backups` is a bucket of its own, separate from `noodle-statements`, so nothing the app does to Parents' files can touch it. Rules set with wrangler (they're bucket settings, not code):

- Lifecycle `daily-30-days`: objects under `d1/2` (`d1/YYYY/…`, nightly dumps and manifests) expire after 30 days.
- Lifecycle `monthly-12-months`: `d1/monthly/` expires after 370 days, so 12 monthly copies are kept.
- Lifecycle `abort-stale-uploads`: unfinished multipart uploads go after a day.
- Bucket lock `backups-14-days`: nothing under `d1/` can be deleted or overwritten for 14 days, by the app, a mistaken command or a stolen token. Because overwrites are refused, the Workflow keeps what an earlier try stored rather than writing it again.

There's no size cap rule in R2; the manifest's `bytes` is the thing to watch. At about a few MB a night this costs nothing worth counting.

## Time Travel bookmarks

Status: superseded by ADR-0039 (2026-10-04). The nightly export never completed in production (the D1 export API refused the token) and was removed; D1 Time Travel, the bookmark before each migration (below, still in place) and Household snapshots (ADR-0035) protect the data now. The rest is kept as the record of what was built.

The deploy job runs `wrangler d1 time-travel info noodle` before `db:migrate:remote` and writes the bookmark to the job log and summary, so a bad migration can be rolled back to exactly the moment before it. How to restore either way is `docs/runbooks/restore.md`.
