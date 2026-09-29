import {
	type Db,
	insightFingerprint,
	knownFingerprints,
	listParents,
	loadInsightSpends,
	loadPlanRecords,
	type NewInsight,
	recordInsights,
	type Viewer,
} from "@noodle/db";
import {
	addDays,
	type DayKey,
	findInsights,
	type InsightCandidate,
	monthOfDay,
	planForMonth,
	services,
} from "@noodle/domain";
import { type InsightModel, type InsightToWord, MAX_NAMES } from "./insights-model";

// Looking for Insights, apart from the Worker so unit tests can run it with fakes. A run is made
// for each Parent as the Viewer (ADR-0003): the detectors and the model see only what that Parent
// may see, so the other Parent's Personal Allowance never reaches a model call made for them.
// An Insight resting on a Parent's own Personal Allowance is stored as theirs alone, and worded in
// a call of its own, apart from the Household's, so private names can't leak into shared wording.
// Findings the Household already has (new, accepted, or dismissed) are skipped before the model
// sees them, which keeps a nightly run to a few calls: one to group names, one or two to word.

export type InsightDeps = { db: Db; model: InsightModel; newId: () => string };

/** How far back a run reads spending: a year and a bit, for yearly patterns. */
const LOOK_BACK_DAYS = 400;
/** How many new Insights a run words and stores for one Parent at most. */
export const MAX_NEW_INSIGHTS = 8;

/** Looks for Insights as `viewer` sees the Household on `asOf`; returns how many were added. */
export async function lookForInsights(
	deps: InsightDeps,
	viewer: Viewer,
	asOf: DayKey,
): Promise<number> {
	const { db, model } = deps;
	const month = monthOfDay(asOf);
	const [spends, records] = await Promise.all([
		loadInsightSpends(db, viewer, addDays(asOf, -LOOK_BACK_DAYS)),
		loadPlanRecords(db, viewer.householdId, month),
	]);
	const inputs = { spends, commitments: planForMonth(records, month).commitments, asOf };

	// The model groups the priciest services' names, by code.
	const named = services(inputs)
		.sort((a, b) => b.yearly - a.yearly)
		.slice(0, MAX_NAMES)
		.map((service, i) => ({ code: `s${i + 1}`, name: service.name, key: service.key }));
	const keyOf = new Map(named.map((n) => [n.code, n.key]));
	const groups = await model
		.group(named.map(({ code, name }) => ({ code, name })))
		.catch((error) => {
			console.error("Couldn’t group services for Insights", error);
			return [] as string[][];
		});
	const found = findInsights(
		inputs,
		groups.map((codes) => codes.flatMap((code) => keyOf.get(code) ?? [])),
	);

	const ownerOf = (c: InsightCandidate) => (c.private ? viewer.memberId : null);
	const stored = (c: InsightCandidate) => insightFingerprint(ownerOf(c), c.fingerprint);
	const known = await knownFingerprints(db, viewer.householdId, found.map(stored));
	const fresh = found.filter((c) => !known.has(stored(c))).slice(0, MAX_NEW_INSIGHTS);
	if (fresh.length === 0) return 0;

	const worded = new Map<InsightCandidate, { title: string; body: string }>();
	for (const own of [false, true]) {
		const batch = fresh.filter((c) => c.private === own);
		if (batch.length === 0) continue;
		const toWord: InsightToWord[] = batch.map((c, i) => ({
			code: `i${i + 1}`,
			kind: c.kind,
			subjects: c.subjects,
			title: c.title,
			body: c.body,
		}));
		const wordings = await model.word(toWord).catch((error) => {
			console.error("Couldn’t word Insights", error);
			return [];
		});
		for (const wording of wordings) {
			const c = batch[Number(wording.code.slice(1)) - 1];
			if (c) worded.set(c, wording);
		}
	}

	return recordInsights(
		db,
		fresh.map(
			(c): NewInsight => ({
				id: deps.newId(),
				householdId: viewer.householdId,
				ownerMemberId: ownerOf(c),
				kind: c.kind,
				title: worded.get(c)?.title ?? c.title,
				body: worded.get(c)?.body ?? c.body,
				yearlyImpactCents: c.yearlyImpact,
				transactionIds: c.transactionIds,
				commitmentIds: c.commitmentIds,
				fingerprint: c.fingerprint,
			}),
		),
	);
}

/** Looks for Insights for each of the Household's Parents in turn; returns how many were added. */
export async function lookForHouseholdInsights(
	deps: InsightDeps,
	householdId: string,
	asOf: DayKey,
): Promise<number> {
	let added = 0;
	for (const parent of await listParents(deps.db, householdId)) {
		added += await lookForInsights(deps, { householdId, memberId: parent.id }, asOf);
	}
	return added;
}
