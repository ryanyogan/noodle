import { env } from "cloudflare:workers";
import { getDb } from "./db";
import { newestMigration, pruneFinalSnapshots, takeNightlySnapshots } from "./snapshot-store";

/**
 * The nightly cron's step: a snapshot of every Household, then pruning (ADR-0035), and the end of
 * deleted Households' last snapshots. Kept out of
 * snapshots.ts, which the Household page imports: a plain export there stays in the browser's
 * copy and takes `cloudflare:workers` with it.
 */
export async function runNightlySnapshots(now: Date) {
	const deps = { db: getDb(), bucket: env.BACKUPS, migration: await newestMigration(env.DB) };
	const result = await takeNightlySnapshots(deps, now);
	console.log("Nightly snapshots", JSON.stringify(result));
	// Deleted Households' last snapshots, once their 30 days are up.
	try {
		const gone = await pruneFinalSnapshots(env.BACKUPS, now);
		if (gone.length > 0) console.log("Last snapshots removed", JSON.stringify({ n: gone.length }));
	} catch (error) {
		console.error("Couldn’t remove deleted Households’ last snapshots", error);
	}
}
