import { type CommitmentTerms, dueDatesIn } from "./commitments";
import {
	cadenceWords,
	describeLever,
	goalWords,
	type LeverSubjects,
	money,
	OTHER_PERSONAL_ALLOWANCE,
	ordinal,
	shortMonthName,
} from "./describe-levers";
import {
	addedTerms,
	addedUntil,
	changedTerms,
	isAssumption,
	type Lever,
	rangeFrom,
	whyNotApplicable,
} from "./levers";
import type { Cents } from "./money";
import type { MonthKey } from "./month";
import { effective, type PlanRecords, planForMonth } from "./plan";

// What applying a Scenario will write to the Plan, in words, before a Parent confirms it: each
// Lever's Plan changes exactly as applyLevers (in @noodle/db) makes them, effective-dated
// (ADR-0009). A value is written at the first month of the Lever's range and holds until a later
// month the Plan set on its own; a range's end writes the Plan's value back there.

export type ApplyPreview = {
	/** Each Lever applying changes, by index in the Scenario's Levers, and its Plan changes. */
	changes: { lever: number; lines: string[] }[];
	/**
	 * Levers applying leaves out, and why: muted ones, assumptions (a one-off, growth), ones that
	 * change nothing, and ones whose Bucket, Commitment or Goal is no longer in the Plan. `asGoal`:
	 * a one-off expense, which can become a Goal to save for it instead.
	 */
	leftOut: { lever: number; text: string; reason: string; asGoal: boolean }[];
	/** What must change before the Scenario can be applied (see whyNotApplicable). */
	blocked: { lever: number; reason: string }[];
};

export type ApplyPreviewInput = {
	records: PlanRecords;
	/** The Household's current month: applying starts no earlier. */
	month: MonthKey;
	levers: readonly Lever[];
	/** The Parent applying: only they change their Personal Allowance, and see its amounts. */
	viewer: string;
	goals: LeverSubjects["goals"];
	accounts: readonly { id: string; name: string }[];
};

const from = (month: MonthKey) => `from ${shortMonthName(month)}`;

/**
 * " until Dec 2026, which has its own" when the Plan set a later month on its own before the
 * range ends (its value holds from then), else "".
 */
function ownLater<T extends { month: MonthKey }>(
	records: readonly T[],
	start: MonthKey,
	until: MonthKey | null,
): { words: string; next: MonthKey | null } {
	const next = records
		.map((r) => r.month)
		.filter((m) => m > start && (until === null || m < until))
		.sort()[0];
	return next === undefined
		? { words: "", next: null }
		: { words: ` until ${shortMonthName(next)}, which has its own`, next };
}

const termsWords = (terms: CommitmentTerms) =>
	`${money(terms.amount)} ${cadenceWords[terms.cadence]}`;

const sameTerms = (a: CommitmentTerms, b: CommitmentTerms) =>
	a.amount === b.amount && a.cadence === b.cadence && a.dueDate === b.dueDate;

/** What applying `levers` from `month` writes to the Plan, what it leaves out, and what blocks it. */
export function applyPreview(input: ApplyPreviewInput): ApplyPreview {
	const { records, month, levers, viewer } = input;
	const preview: ApplyPreview = { changes: [], leftOut: [], blocked: [] };
	const subjects: LeverSubjects = {
		...planForMonth(records, month),
		goals: input.goals,
		viewer,
	};

	for (const [index, lever] of levers.entries()) {
		const text = describeLever(lever, subjects, levers).text;
		const leave = (reason: string, asGoal = false) => {
			preview.leftOut.push({ lever: index, text, reason, asGoal });
		};
		if (lever.muted) {
			leave("Muted, so it isn’t applied.");
			continue;
		}
		if (isAssumption(lever)) {
			leave(
				whyNotApplicable(lever, month) ?? "",
				lever.kind === "one-off" && lever.flow === "expense",
			);
			continue;
		}
		const why = whyNotApplicable(lever, month);
		if (why !== null) {
			preview.blocked.push({ lever: index, reason: why });
			continue;
		}
		const range = rangeFrom(lever, month);
		const lines = range === null ? "Its months are over." : changeLines(lever, range, input);
		if (typeof lines === "string") leave(lines);
		else preview.changes.push({ lever: index, lines });
	}
	return preview;
}

/** A Lever's Plan changes in words, or why it changes nothing. */
function changeLines(
	lever: Lever,
	range: { from: MonthKey; until: MonthKey | null },
	input: ApplyPreviewInput,
): string[] | string {
	const { records, viewer, levers } = input;
	const { from: start, until } = range;
	const gone = "It’s no longer in the Plan.";
	const unchanged = "It’s already the Plan.";
	const plan = planForMonth(records, start);

	/** A value set from `start`, holding until the Plan's own later value or `until`. */
	const valueLines = <T extends { month: MonthKey }>(input: {
		name: string;
		own: readonly T[];
		before: string;
		after: string;
		/** The value in force at `until`, which comes back then. */
		back: () => string;
	}) => {
		const later = ownLater(input.own, start, until);
		const lines = [`${input.name} ${input.before} → ${input.after} ${from(start)}${later.words}`];
		if (until !== null && later.next === null) {
			lines.push(`${input.name} back to ${input.back()} ${from(until)}`);
		}
		return lines;
	};

	switch (lever.kind) {
		case "baseline": {
			const before = plan.baseline;
			if (before === lever.amount) return unchanged;
			const back = effective(records.baselines, until ?? start)?.amount ?? null;
			return valueLines({
				name: "Income",
				own: records.baselines,
				before: before === null ? "not set" : money(before),
				after: `${money(lever.amount)} a month`,
				back: () => (back === null ? "not set" : `${money(back)} a month`),
			});
		}
		case "allowance": {
			const bucket = plan.buckets.find((b) => b.id === lever.bucketId);
			if (!bucket) return gone;
			if (bucket.owner !== undefined && bucket.owner !== viewer) {
				return `Only its Parent changes their ${OTHER_PERSONAL_ALLOWANCE}.`;
			}
			if (bucket.allowance === lever.amount) return unchanged;
			const own = records.allowances.filter((a) => a.bucketId === bucket.id);
			const back = (effective(own, until ?? start)?.amount ?? 0) as Cents;
			return valueLines({
				name: bucket.name,
				own,
				before: money(bucket.allowance),
				after: `${money(lever.amount)} a month`,
				back: () => `${money(back)} a month`,
			});
		}
		case "commitment-terms": {
			const commitment = plan.commitments.find((c) => c.id === lever.commitmentId);
			if (!commitment) return gone;
			const terms = changedTerms(commitment, lever, start);
			if (sameTerms(terms, commitment)) return unchanged;
			const own = records.commitmentTerms.filter((t) => t.commitmentId === commitment.id);
			const due =
				terms.dueDate === commitment.dueDate
					? ""
					: `, due the ${ordinal(Number(terms.dueDate.slice(8)))}`;
			const back = effective(own, until ?? start);
			return valueLines({
				name: commitment.name,
				own,
				before: termsWords(commitment),
				after: `${termsWords(terms)}${due}`,
				back: () => (back ? termsWords(back) : "its terms"),
			});
		}
		case "end-commitment": {
			const commitment = plan.commitments.find((c) => c.id === lever.commitmentId);
			const added = levers.find(
				(l) => l.kind === "add-commitment" && l.commitmentId === lever.commitmentId,
			);
			if (!commitment && !added) return gone;
			const name = commitment?.name ?? (added?.kind === "add-commitment" ? added.name : "");
			return [`${name} ends: out of the Plan ${from(start)}`];
		}
		case "add-commitment": {
			if (records.commitments.some((c) => c.id === lever.commitmentId)) return unchanged;
			const terms = addedTerms({ ...lever, fromMonth: start });
			const ends = addedUntil({ ...lever, fromMonth: start });
			const firstDue = dueDatesIn(terms, start)[0] ?? terms.dueDate;
			return [
				`New Commitment ${lever.name}: ${termsWords(terms)}, due the ${ordinal(Number(firstDue.slice(8)))}, ${from(start)}${ends ? ` until ${shortMonthName(ends)}` : ""}`,
			];
		}
		case "add-bucket": {
			if (records.buckets.some((b) => b.id === lever.bucketId)) return unchanged;
			const kind = lever.rolling ? "Rolling" : "Fresh-start";
			return [
				`New Bucket ${lever.name}: ${money(lever.amount)} a month, ${kind}, ${from(start)}${until ? ` until ${shortMonthName(until)}` : ""}`,
			];
		}
		case "archive-bucket": {
			const bucket = plan.buckets.find((b) => b.id === lever.bucketId);
			const added = levers.find((l) => l.kind === "add-bucket" && l.bucketId === lever.bucketId);
			if (bucket?.owner !== undefined) return "A Personal Allowance isn’t archived.";
			if (!bucket && !added) return gone;
			const name = bucket?.name ?? (added?.kind === "add-bucket" ? added.name : "");
			return [`${name} archived: out of the Plan ${from(start)}`];
		}
		case "goal": {
			const goal = input.goals.find((g) => g.id === lever.goalId);
			if (!goal) return gone;
			if (goal.target === lever.target && goal.targetDate === lever.targetDate) return unchanged;
			return [
				`${goal.name} ${goalWords(goal.target, goal.targetDate)} → ${goalWords(lever.target, lever.targetDate)}`,
			];
		}
		case "add-goal": {
			if (input.goals.some((g) => g.id === lever.goalId)) return unchanged;
			const account = input.accounts.find((a) => a.id === lever.accountId);
			return [
				`New Goal ${lever.name}: ${goalWords(lever.target, lever.targetDate)}${account ? `, kept in ${account.name}` : ""}`,
			];
		}
		case "one-off":
		case "growth":
			return whyNotApplicable(lever, start) ?? "";
	}
}
