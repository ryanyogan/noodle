import {
	type Db,
	loadIncome,
	loadInsightSpends,
	loadPlanDraft,
	loadPlanRecords,
	saveDraftLabels,
	type Viewer,
} from "@noodle/db";
import {
	addDays,
	addMonths,
	type DayKey,
	type DraftFindings,
	draftFindings,
	draftIsEmpty,
	draftPlan,
	merchantsToLabel,
	monthOfDay,
	type Plan,
	type PlanDraft,
	planForMonth,
} from "@noodle/domain";
import type { DraftModel } from "./plan-draft-model";

// Drafting the first Plan, apart from the Worker so unit tests can run it with fakes. Whatever
// brought the history in (a statement today, a Bank Connection later) calls `labelPlanDraft`
// once it has landed. Plain code reads the history as the Parent who brought it in (the Viewer),
// skipping their own Personal Allowance, so nothing private is named or stored for the Household
// (ADR-0003). The model only names what it's shown, and each merchant is named once: a later
// statement asks about the new ones only.

export type PlanDraftDeps = { db: Db; model: DraftModel };

/** How far back the history is loaded: the draft's days, and a month's slack for its end. */
const LOAD_DAYS = 130;

async function loadHistory(db: Db, viewer: Viewer, asOf: DayKey) {
	const from = addDays(asOf, -LOAD_DAYS);
	const month = monthOfDay(asOf);
	const [spends, income, records] = await Promise.all([
		loadInsightSpends(db, viewer, from),
		loadIncome(db, viewer.householdId, monthOfDay(from), addMonths(month, 1)),
		loadPlanRecords(db, viewer.householdId, month),
	]);
	const findings = draftFindings({
		spends,
		income: income.map(({ id, date, amount, note }) => ({ id, date, amount, note: note ?? "" })),
	});
	return { findings, plan: planForMonth(records, month) };
}

/** Whether the Plan still needs setting up: no Baseline, or no Buckets but Personal Allowances. */
const needsSetUp = (plan: Plan) =>
	plan.baseline === null || plan.buckets.every((bucket) => bucket.owner !== undefined);

/**
 * Names what the Household's history on `asOf` holds, for its first Plan's draft: only while
 * the Plan still needs setting up, or once a draft has started (a later statement adds to it).
 * Returns what it found, or null when it didn't draft. If the model fails, the draft still starts,
 * with plain names and everything in Everyday.
 */
export async function labelPlanDraft(
	deps: PlanDraftDeps,
	viewer: Viewer,
	asOf: DayKey,
): Promise<DraftFindings | null> {
	const { db, model } = deps;
	const draft = await loadPlanDraft(db, viewer.householdId);
	if (draft?.finished) return null;
	const { findings, plan } = await loadHistory(db, viewer, asOf);
	if (!findings || (!draft && !needsSetUp(plan))) return null;

	const labels = draft?.labels ?? { buckets: {}, names: {} };
	const { toSort, toName } = merchantsToLabel(findings);
	const unlabelled = (line: { key: string }) => !(line.key in labels.names);
	const sort = toSort.filter(unlabelled);
	const name = toName.filter(unlabelled);
	const said =
		sort.length + name.length === 0
			? { buckets: {}, names: {} }
			: await model.label(sort, name).catch((error: unknown) => {
					console.error("Couldn’t label the Plan’s draft", error);
					return { buckets: {}, names: {} };
				});
	await saveDraftLabels(db, viewer.householdId, {
		buckets: { ...labels.buckets, ...said.buckets },
		names: { ...labels.names, ...said.names },
	});
	return findings;
}

/**
 * The first Plan's draft as `viewer` sees it on `asOf`: what's left to add or skip. Null when
 * there's none, a Parent finished it, or nothing is left in it.
 */
export async function buildPlanDraft(
	db: Db,
	viewer: Viewer,
	asOf: DayKey,
): Promise<PlanDraft | null> {
	const draft = await loadPlanDraft(db, viewer.householdId);
	if (!draft || draft.finished) return null;
	const { findings, plan } = await loadHistory(db, viewer, asOf);
	if (!findings) return null;
	const drafted = draftPlan(findings, draft.labels, plan, draft.decided);
	return draftIsEmpty(drafted) ? null : drafted;
}
