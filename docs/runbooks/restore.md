# Restoring the D1 database

The way back for the whole database is **D1 Time Travel** (ADR-0039): any minute in the last 30 days (Workers Paid; 7 days on Free). There is no older copy and no copy outside Cloudflare. For one Household's mistake, don't use this: a Parent restores a **Household snapshot** from Household → Your data → Snapshots (ADR-0035), which touches nobody else.

Run every command from `apps/web` (it has the Wrangler config), logged in to the Noodle account (`npx wrangler whoami`).

> **Danger.** Time Travel restores **in place**: it overwrites the live `noodle` database that every Parent uses. It can't restore into a second database to look first. Everything written after the restore point is lost, for every Household. Do it only on purpose, after taking a bookmark (step 1), and tell the Parents first.

## 1. Always first: note where you are

```sh
npx wrangler d1 time-travel info noodle
```

Write the bookmark down. It's the way back if the restore itself turns out wrong.

## 2. Find the point to go back to

- **Before a deploy's migration:** open the deploy run in GitHub Actions (the `deploy` job of the CI workflow, on `main`). The "Record the Time Travel bookmark" step's log, and the run's Summary under "D1 Time Travel bookmark before migrating", show the bookmark taken just before `db:migrate:remote`. From the command line: `gh run list --branch main --workflow ci.yml`, then `gh run view <run id> --log | grep -i bookmark`. GitHub keeps logs about 90 days; Time Travel only reaches 30.
- **Before a time:** `npx wrangler d1 time-travel info noodle --timestamp=2026-10-03T08:55:00Z` shows the bookmark for that moment (a Unix timestamp works too).

A bookmark older than 30 days can't be used.

## 3. Look before you restore (as far as that's possible)

Time Travel can't show you the database as it was; it can only put it back. What you can do first:

- Query the live database to see what is wrong now: `npx wrangler d1 execute noodle --remote --command="SELECT count(*) FROM transactions"`.
- Keep a copy of the present, in case something written after the restore point is wanted later: `npx wrangler d1 export noodle --remote --output=./before-restore.sql`. It blocks the database while it runs, so pick a quiet moment. The file holds every Household's data: keep it off shared disks and delete it when done. It can be loaded into a scratch database (`npx wrangler d1 create noodle-restore-check`, then `npx wrangler d1 execute noodle-restore-check --remote --file=./before-restore.sql`) to pick rows out of. Never point these at `noodle`.

## 4. ⚠️ PRODUCTION — restore

```sh
npx wrangler d1 time-travel restore noodle --bookmark=<bookmark>
# or
npx wrangler d1 time-travel restore noodle --timestamp=<RFC3339 or Unix time>
```

Wrangler prints the bookmark from just before the restore. Write it down too: restoring to it undoes the restore.

## 5. Afterwards

- **Schema.** If the restore went back past a migration, the code deployed now expects the newer schema. Either redeploy the commit from before that migration, or run `bun run db:migrate:remote` again to bring the database forward.
- **Check.** Sign in, open This Month, and compare a few counts with what you expected.
- **What a restore doesn't put back.** Only D1 goes back in time. Statement and Receipt files in R2, Household snapshots' files, the merchant index, the Household Agents' state and bank links at Plaid stay as they are now. Rows may point at files deleted since, and the snapshot list (a table) may name snapshot files pruned since, or miss ones taken since.

## What this can't do

- Go back more than 30 days.
- Bring back a database that was deleted (assume its Time Travel history goes with it; Cloudflare's docs don't say).
- Help if the Cloudflare account itself is lost. There is no copy anywhere else (ADR-0039).

## Drills

A Time Travel restore can't be rehearsed without overwriting production, so there is no monthly drill for it. Two things can be checked safely: step 1 answers with a bookmark, and the last deploy's Summary shows one. The Household snapshot drill, all local, is `docs/runbooks/snapshot-restore-drill.md`.

| Date | What was checked | Result |
| --- | --- | --- |
| _none yet_ | | |
