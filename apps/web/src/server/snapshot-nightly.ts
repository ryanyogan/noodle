import { env } from "cloudflare:workers";
import { getDb } from "./db";
import { newestMigration, takeNightlySnapshots } from "./snapshot-store";

/**
 * The nightly cron's step: a snapshot of every Household, then pruning (ADR-0035). Kept out of
 * snapshots.ts, which the Household page imports: a plain export there stays in the browser's
 * copy and takes `cloudflare:workers` with it.
 */
export async function runNightlySnapshots(now: Date) {
	const deps = { db: getDb(), bucket: env.BACKUPS, migration: await newestMigration(env.DB) };
	const result = await takeNightlySnapshots(deps, now);
	console.log("Nightly snapshots", JSON.stringify(result));
}
