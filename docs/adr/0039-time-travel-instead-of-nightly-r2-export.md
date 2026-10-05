# D1 Time Travel instead of a nightly export to R2

Supersedes ADR-0032 (2026-10-04, #79).

ADR-0032 kept a whole-database export in R2 every night, made by a Backup Workflow calling the D1 export API. It never completed once in production: the export API refused the token. The Parent's decision: "I'm pretty sure Cloudflare already does Time Travel backups so we can remove nightly R2 backups." So the export is gone: the Workflow, its code and tests, its vars and its place in the nightly cron. Nothing was lost by removing it, since it had stored nothing.

## What protects the data now

1. **D1 Time Travel**, for the whole database. It is always on, with nothing to enable, and restores `noodle` to any minute in the last 30 days. Checked against Cloudflare's Time Travel page on 2026-10-04: "up to 30 days in the past (Workers Paid plan) or 7 days (Workers Free plan)", and "Bookmarks older than 30 days are invalid and cannot be used as a restore point." Noodle is on Workers Paid; if the plan ever drops to Free, this becomes 7 days.
2. **The bookmark before each migration.** The deploy job runs `wrangler d1 time-travel info noodle` just before `db:migrate:remote` and writes the bookmark to the job log and the run summary (`.github/workflows/ci.yml`, "Record the Time Travel bookmark"). A bad migration can be rolled back to exactly the moment before it. This part of ADR-0032 stays.
3. **Household snapshots** (ADR-0035), for one Household's mistakes: a Fresh start, a bad bulk Rule apply, a Parent wanting last week back. Taken nightly, by hand and before risky actions; a Parent restores one themselves, and no other Household is touched. They live in R2 `noodle-backups`, which stays for them.

How to restore is `docs/runbooks/restore.md`.

## What we give up

Said plainly, because these are real:

- **No copy older than 30 days.** Bad data that goes unnoticed for more than 30 days can't be undone for the whole database. The oldest Household snapshots reach back about 10 weeks (14 nightly, then one a week for 8 weeks), but only for a Household's own rows, and only if the schema hasn't changed since (ADR-0035 refuses a snapshot taken under an older migration).
- **No copy outside Cloudflare,** and none outside this one account. Time Travel and the snapshots both live there. If the account is lost, locked or emptied, there is nothing elsewhere.
- **No copy outside the database.** Time Travel is the database's own history. If the `noodle` database is deleted, we must assume its history goes with it. Cloudflare's Time Travel page doesn't say either way: **to confirm**. Household snapshots would survive (they are in R2), but putting them into a new database is hand work for the operator, with no tool.
- **A restore is all or nothing, and in place.** Time Travel overwrites the live database; it can't restore into a second database to look first (Cloudflare: "a destructive operation, and overwrites the database in place"; cloning is "in the future"). Everything every Household wrote after the restore point is lost. The restore itself can be undone, with the bookmark Wrangler prints.
- **No dump to read.** There is no SQL file to open, diff or import somewhere else. `wrangler d1 export noodle --remote` by hand still makes one when wanted (it blocks the database while it runs).
- **Nobody is emailed.** The export's failed-night email is gone with it. Time Travel has nothing to fail nightly, but nothing tells us if it stops working either.

## Why this is acceptable for now

Noodle serves one family and has one operator. The export was complexity that had never worked, plus a long-lived API token for D1 kept as a secret. The likely accidents (a bad migration, a bad import, a Fresh start regretted) are all found within days and are covered by 1 to 3. The unlikely ones (the account lost, the database deleted, damage found after a month) are not covered, and we know it.

If that stops being acceptable (more Households, or data nobody could re-enter), the cheapest step back is a scheduled `wrangler d1 export` to somewhere outside the account, not the Workflow again.

## What is left behind in Cloudflare

Code and config only were removed. For the operator to remove by hand if wished: the `D1_EXPORT_TOKEN` secret and the API token behind it, `BACKUP_ALERT_TO`, the `noodle-backup` Workflow (a deploy doesn't delete a Workflow that left the config), and the `d1/` lifecycle and lock rules on `noodle-backups`. The bucket itself stays: Household snapshots use it.
