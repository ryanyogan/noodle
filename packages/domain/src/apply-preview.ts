import {
	addedTerms,
	addedUntil,
	type Change,
	changedTerms,
	isAssumption,
	rangeFrom,
	whyNotApplicable,
} from "./changes";
import { type CommitmentTerms, dueDatesIn } from "./commitments";
import {
	type ChangeSubjects,
	cadenceWords,
	describeChange,
	goalWords,
	money,
	OTHER_PERSONAL_ALLOWANCE,
	ordinal,
	shortMonthName,
} from "./describe-changes";
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
	levers: readonly Change[];
	/** The Parent applying: only they change their Personal Allowance, and see its amounts. */
	viewer: string;
	goals: ChangeSubjects["goals"];
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
	const subjects: ChangeSubjects = {
		...planForMonth(records, month),
		goals: input.goals,
		viewer,
	};

	for (const [index, change] of levers.entries()) {
		const text = describeChange(change, subjects, levers).text;
		const leave = (reason: string, asGoal = false) => {
			preview.leftOut.push({ lever: index, text, reason, asGoal });
		};
		if (change.muted) {
			leave("Muted, so it isn’t applied.");
			continue;
		}
		if (isAssumption(change)) {
			leave(
				whyNotApplicable(change, month) ?? "",
				change.kind === "one-off" && change.flow === "expense",
			);
			continue;
		}
		const why = whyNotApplicable(change, month);
		if (why !== null) {
			preview.blocked.push({ lever: index, reason: why });
			continue;
		}
		const range = rangeFrom(change, month);
		const lines = range === null ? "Its months are over." : changeLines(change, range, input);
		if (typeof lines === "string") leave(lines);
		else preview.changes.push({ lever: index, lines });
	}
	return preview;
}

/** A Lever's Plan changes in words, or why it changes nothing. */
function changeLines(
	change: Change,
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

	switch (change.kind) {
		case "baseline": {
			const before = plan.baseline;
			if (before === change.amount) return unchanged;
			const back = effective(records.baselines, until ?? start)?.amount ?? null;
			return valueLines({
				name: "Income",
				own: records.baselines,
				before: before === null ? "not set" : money(before),
				after: `${money(change.amount)} a month`,
				back: () => (back === null ? "not set" : `${money(back)} a month`),
			});
		}
		case "allowance": {
			const bucket = plan.buckets.find((b) => b.id === change.bucketId);
			if (!bucket) return gone;
			if (bucket.owner !== undefined && bucket.owner !== viewer) {
				return `Only its Parent changes their ${OTHER_PERSONAL_ALLOWANCE}.`;
			}
			if (bucket.allowance === change.amount) return unchanged;
			const own = records.allowances.filter((a) => a.bucketId === bucket.id);
			const back = (effective(own, until ?? start)?.amount ?? 0) as Cents;
			return valueLines({
				name: bucket.name,
				own,
				before: money(bucket.allowance),
				after: `${money(change.amount)} a month`,
				back: () => `${money(back)} a month`,
			});
		}
		case "commitment-terms": {
			const commitment = plan.commitments.find((c) => c.id === change.commitmentId);
			if (!commitment) return gone;
			const terms = changedTerms(commitment, change, start);
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
			const commitment = plan.commitments.find((c) => c.id === change.commitmentId);
			const added = levers.find(
				(l) => l.kind === "add-commitment" && l.commitmentId === change.commitmentId,
			);
			if (!commitment && !added) return gone;
			const name = commitment?.name ?? (added?.kind === "add-commitment" ? added.name : "");
			return [`${name} ends: out of the Plan ${from(start)}`];
		}
		case "add-commitment": {
			if (records.commitments.some((c) => c.id === change.commitmentId)) return unchanged;
			const terms = addedTerms({ ...change, fromMonth: start });
			const ends = addedUntil({ ...change, fromMonth: start });
			const firstDue = dueDatesIn(terms, start)[0] ?? terms.dueDate;
			return [
				`New Commitment ${change.name}: ${termsWords(terms)}, due the ${ordinal(Number(firstDue.slice(8)))}, ${from(start)}${ends ? ` until ${shortMonthName(ends)}` : ""}`,
			];
		}
		case "add-bucket": {
			if (records.buckets.some((b) => b.id === change.bucketId)) return unchanged;
			const kind = change.rolling ? "Rolling" : "Fresh-start";
			return [
				`New Bucket ${change.name}: ${money(change.amount)} a month, ${kind}, ${from(start)}${until ? ` until ${shortMonthName(until)}` : ""}`,
			];
		}
		case "archive-bucket": {
			const bucket = plan.buckets.find((b) => b.id === change.bucketId);
			const added = levers.find((l) => l.kind === "add-bucket" && l.bucketId === change.bucketId);
			if (bucket?.owner !== undefined) return "A Personal Allowance isn’t archived.";
			if (!bucket && !added) return gone;
			const name = bucket?.name ?? (added?.kind === "add-bucket" ? added.name : "");
			return [`${name} archived: out of the Plan ${from(start)}`];
		}
		case "goal": {
			const goal = input.goals.find((g) => g.id === change.goalId);
			if (!goal) return gone;
			if (goal.target === change.target && goal.targetDate === change.targetDate) return unchanged;
			return [
				`${goal.name} ${goalWords(goal.target, goal.targetDate)} → ${goalWords(change.target, change.targetDate)}`,
			];
		}
		case "add-goal": {
			if (input.goals.some((g) => g.id === change.goalId)) return unchanged;
			const account = input.accounts.find((a) => a.id === change.accountId);
			return [
				`New Goal ${change.name}: ${goalWords(change.target, change.targetDate)}${account ? `, kept in ${account.name}` : ""}`,
			];
		}
		case "one-off":
		case "growth":
			return whyNotApplicable(change, start) ?? "";
	}
}
