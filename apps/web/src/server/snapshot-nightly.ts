import { env } from "cloudflare:workers";
import { getDb } from "./db";
import { releaseAllHeldFiles } from "./file-holds";
import { newestMigration, takeNightlySnapshots } from "./snapshot-store";

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
	// After pruning: statement and Receipt files a clear left for snapshots go once no kept
	// snapshot needs them, and deleted Households' last snapshots (with the files left for them)
	// once their 30 days are up.
	try {
		const result = await releaseAllHeldFiles(
			{ db: deps.db, backups: env.BACKUPS, files: env.STATEMENTS },
			now,
		);
		console.log("Held files", JSON.stringify(result));
	} catch (error) {
		console.error("Couldn’t release files held for snapshots", error);
	}
}
