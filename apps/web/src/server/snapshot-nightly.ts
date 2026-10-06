import { env } from "cloudflare:workers";
import { runCardPaymentPasses } from "@noodle/db";
import { ulid } from "ulid";
import { getDb } from "./db";
import { releaseAllHeldFiles } from "./file-holds";
import { runMoneyInPasses } from "./money-in-pass";
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
	// Once per Household, ever (ADR-0057): October 2026's person-to-person money in back to Review.
	try {
		const passed = await runMoneyInPasses(deps, now);
		if (passed.households > 0) console.log("Money-in pass", JSON.stringify(passed));
	} catch (error) {
		console.error("Couldn’t run the money-in pass", error);
	}
	// Once per Household, ever (issue 136): payments on a card that came in reading "Money back"
	// are marked as Transfers. Nothing is deleted and "Unmark" undoes each, so no snapshot first.
	try {
		const paid = await runCardPaymentPasses(deps.db, ulid);
		if (paid.households > 0) console.log("Card-payment pass", JSON.stringify(paid));
	} catch (error) {
		console.error("Couldn’t run the card-payment pass", error);
	}
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
