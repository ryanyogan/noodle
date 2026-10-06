import { householdsAwaitingMoneyInPass, runMoneyInPass } from "@noodle/db";
import { ulid } from "ulid";
import { type SnapshotDeps, takeSnapshot } from "./snapshot-store";

/**
 * The one-time pass of ADR-0057, for every Household it hasn't run for: October 2026's
 * person-to-person money in goes back to Review, after a snapshot of the Household. It runs from
 * the nightly cron; once it has run for a Household it never does again, so most nights this
 * reads one empty list. One Household failing is logged and tried again the next night.
 */
export async function runMoneyInPasses(deps: SnapshotDeps, now: Date) {
	const waiting = await householdsAwaitingMoneyInPass(deps.db);
	let changed = 0;
	let failed = 0;
	for (const householdId of waiting) {
		try {
			const result = await runMoneyInPass(deps.db, householdId, {
				runId: ulid(),
				snapshot: async () =>
					(
						await takeSnapshot(deps, {
							householdId,
							kind: "manual",
							note: "Before October’s money in went back to Review",
							now,
						})
					).id,
			});
			changed += result.changed;
		} catch (error) {
			failed++;
			console.error(`Couldn’t run the money-in pass for Household ${householdId}`, error);
		}
	}
	return { households: waiting.length, changed, failed };
}
