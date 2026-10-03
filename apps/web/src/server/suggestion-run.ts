import {
	type Db,
	householdTimeZone,
	loadLearnInputs,
	loadSuggestionInputs,
	saveSuggestions,
} from "@noodle/db";
import {
	addDays,
	dayKeyAt,
	monthOfDay,
	spotBuckets,
	spotCommitments,
	spotRules,
} from "@noodle/domain";

// Background AI's suggestion step (ADR-0027): Suggest Buckets, Spot Commitments and Learn (Rules) over the
// Household's spending, saved idempotently. Deterministic (no model), so AI_MODEL=stub changes
// nothing here. Never logs a merchant.

/** Looks for suggestions now. Returns how many opened, changed or went. */
export async function spotSuggestions(
	db: Db,
	householdId: string,
	now = new Date(),
): Promise<number> {
	const today = dayKeyAt(now, await householdTimeZone(db, householdId));
	const inputs = await loadSuggestionInputs(
		db,
		householdId,
		addDays(today, -400),
		monthOfDay(today),
	);
	const learn = await loadLearnInputs(db, householdId, addDays(today, -400));
	return saveSuggestions(db, householdId, [
		...spotRules(learn.filings, learn.rules),
		...spotBuckets(inputs.lines, today, inputs.bucketNames),
		...spotCommitments(inputs.lines, inputs.commitments, today, inputs.bucketNames),
	]);
}
