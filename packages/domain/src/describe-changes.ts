import type { ScenarioChange, ScenarioChangeOf } from "./changes";
import type { Cadence } from "./commitments";
import type { Cents } from "./money";
import { type DayKey, type MonthKey, monthOfDay } from "./month";

// Changes in plain words, as "Your changes" lists them: "Daycare $1,400 → ended from Sep 2027".
// Each says what the Plan has now, what the Scenario makes it, and the months it holds for.

/** What Changes change, as the Plan has them this month: the words describe Changes against it. */
export type ScenarioChangeSubjects = {
	/** The Household's current month: a Change from then (or earlier) needs no "from". */
	month: MonthKey;
	baseline: Cents | null;
	/** `owner`: set for a Personal Allowance, the Parent it belongs to. */
	buckets: readonly { id: string; name: string; allowance: Cents; owner?: string }[];
	commitments: readonly { id: string; name: string; amount: Cents; cadence: Cadence }[];
	goals: readonly { id: string; name: string; target: Cents; targetDate: DayKey | null }[];
	/**
	 * The Parent reading: a Change on the other Parent's Personal Allowance reads only as
	 * "Personal Allowance changed", with no amounts or months (ADR-0003). Unset: no one's is hidden.
	 */
	viewer?: string;
};

/** What the other Parent's Personal Allowance reads as, wherever a Change changes it. */
export const OTHER_PERSONAL_ALLOWANCE = "Personal Allowance";

/** The Bucket a Change changes, if it's the other Parent's Personal Allowance. */
const othersAllowance = (subjects: ScenarioChangeSubjects, bucketId: string) => {
	const bucket = subjects.buckets.find((b) => b.id === bucketId);
	return bucket?.owner !== undefined &&
		subjects.viewer !== undefined &&
		bucket.owner !== subjects.viewer
		? bucket
		: undefined;
};

export type ScenarioChangeDescription = {
	text: string;
	/**
	 * The Bucket, Commitment or Goal it changes is no longer in the Plan, and no other Change adds
	 * it: it changes nothing, and is flagged rather than dropped.
	 */
	gone: boolean;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mar 2027". */
export const shortMonthName = (month: MonthKey) =>
	`${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const dollarsAndCents = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 0,
	maximumFractionDigits: 2,
});

/** "$1,400" or "$12.50"; negatives use a true minus sign. */
export function money(cents: Cents): string {
	const text = dollarsAndCents.format(Math.abs(cents) / 100).replace(/\.(\d)$/, ".$10");
	return cents < 0 ? `−${text}` : text;
}

export const cadenceWords: Record<Cadence, string> = {
	monthly: "a month",
	biweekly: "every two weeks",
	annual: "a year",
};

/** "1st", "12th", "22nd" for a day of the month. */
export const ordinal = (day: number) =>
	day >= 11 && day <= 13 ? `${day}th` : `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;

/** " from Mar 2027 until Aug 2028", " until Aug 2028" (from now), or "" (from now, for good). */
function rangeWords(scenarioChange: ScenarioChange, month: MonthKey): string {
	const from =
		scenarioChange.fromMonth > month ? ` from ${shortMonthName(scenarioChange.fromMonth)}` : "";
	const until = scenarioChange.untilMonth
		? ` until ${shortMonthName(scenarioChange.untilMonth)}`
		: "";
	return `${from}${until}`;
}

export const goalWords = (target: Cents, targetDate: DayKey | null) =>
	`${money(target)} ${targetDate ? `by ${shortMonthName(monthOfDay(targetDate))}` : "with no date"}`;

/** "Eating out (archived)": a Change's subject by its saved name once it's gone, else `fallback`. */
const archived = (scenarioChange: ScenarioChange, fallback: string) =>
	scenarioChange.subjectName ? `${scenarioChange.subjectName} (archived)` : fallback;

/** The name of a Commitment a Change adds, if one does. */
const addedCommitment = (changes: readonly ScenarioChange[], id: string) =>
	changes.find(
		(l): l is ScenarioChangeOf<"add-commitment"> =>
			l.kind === "add-commitment" && l.commitmentId === id,
	);

const addedBucket = (changes: readonly ScenarioChange[], id: string) =>
	changes.find(
		(l): l is ScenarioChangeOf<"add-bucket"> => l.kind === "add-bucket" && l.bucketId === id,
	);

/**
 * A Change in words, against the Plan as it stands (`subjects`) and the Scenario's other Changes
 * (which may add the Commitment or Bucket it ends).
 */
export function describeChange(
	scenarioChange: ScenarioChange,
	subjects: ScenarioChangeSubjects,
	changes: readonly ScenarioChange[] = [],
): ScenarioChangeDescription {
	const range = rangeWords(scenarioChange, subjects.month);
	const described = (text: string, gone = false): ScenarioChangeDescription => ({ text, gone });
	if (
		(scenarioChange.kind === "allowance" || scenarioChange.kind === "archive-bucket") &&
		othersAllowance(subjects, scenarioChange.bucketId)
	) {
		return described(`${OTHER_PERSONAL_ALLOWANCE} changed`);
	}

	switch (scenarioChange.kind) {
		case "baseline":
			return described(
				subjects.baseline === null
					? `Income ${money(scenarioChange.amount)} a month${range}`
					: `Income ${money(subjects.baseline)} → ${money(scenarioChange.amount)} a month${range}`,
			);
		case "allowance": {
			const bucket = subjects.buckets.find((b) => b.id === scenarioChange.bucketId);
			return bucket
				? described(
						`${bucket.name} ${money(bucket.allowance)} → ${money(scenarioChange.amount)} a month${range}`,
					)
				: described(
						`${archived(scenarioChange, "A Bucket’s allowance")} ${money(scenarioChange.amount)} a month${range}`,
						true,
					);
		}
		case "commitment-terms": {
			const commitment = subjects.commitments.find((c) => c.id === scenarioChange.commitmentId);
			const due = scenarioChange.dueDay ? `, due on the ${ordinal(scenarioChange.dueDay)}` : "";
			if (!commitment) {
				const amount =
					scenarioChange.amount === undefined ? "new terms" : money(scenarioChange.amount);
				return described(
					`${archived(scenarioChange, "A Commitment’s")} ${amount}${due}${range}`,
					true,
				);
			}
			const before = `${money(commitment.amount)} ${cadenceWords[commitment.cadence]}`;
			const after = `${money(scenarioChange.amount ?? commitment.amount)} ${cadenceWords[scenarioChange.cadence ?? commitment.cadence]}`;
			// "$1,400 → $1,200 a month" when only the amount changes.
			const change =
				(scenarioChange.cadence ?? commitment.cadence) === commitment.cadence
					? `${money(commitment.amount)} → ${after}`
					: `${before} → ${after}`;
			return described(`${commitment.name} ${change}${due}${range}`);
		}
		case "end-commitment": {
			const commitment = subjects.commitments.find((c) => c.id === scenarioChange.commitmentId);
			if (commitment) {
				return described(`${commitment.name} ${money(commitment.amount)} → ended${range}`);
			}
			const added = addedCommitment(changes, scenarioChange.commitmentId);
			return added
				? described(`${added.name} → ended${range}`)
				: described(`${archived(scenarioChange, "A Commitment")} ended${range}`, true);
		}
		case "add-commitment": {
			const term = scenarioChange.months === null ? "" : ` for ${scenarioChange.months} months`;
			return described(
				`New Commitment: ${scenarioChange.name} ${money(scenarioChange.amount)} ${cadenceWords[scenarioChange.cadence]}${term}${range}`,
			);
		}
		case "one-off":
			return described(
				`One-off ${scenarioChange.flow}: ${scenarioChange.name} ${money(scenarioChange.amount)} in ${shortMonthName(scenarioChange.fromMonth)}`,
			);
		case "add-bucket":
			return described(
				`New Bucket: ${scenarioChange.name} ${money(scenarioChange.amount)} a month${range}`,
			);
		case "archive-bucket": {
			const bucket = subjects.buckets.find((b) => b.id === scenarioChange.bucketId);
			if (bucket) return described(`${bucket.name} ${money(bucket.allowance)} → archived${range}`);
			const added = addedBucket(changes, scenarioChange.bucketId);
			return added
				? described(`${added.name} → archived${range}`)
				: described(
						scenarioChange.subjectName
							? `${archived(scenarioChange, "")}${range}`
							: `A Bucket archived${range}`,
						true,
					);
		}
		case "goal": {
			const goal = subjects.goals.find((g) => g.id === scenarioChange.goalId);
			const after = goalWords(scenarioChange.target, scenarioChange.targetDate);
			return goal
				? described(`${goal.name} ${goalWords(goal.target, goal.targetDate)} → ${after}${range}`)
				: described(`${archived(scenarioChange, "A Goal")} ${after}${range}`, true);
		}
		case "add-goal":
			return described(
				`New Goal: ${scenarioChange.name} ${goalWords(scenarioChange.target, scenarioChange.targetDate)}${range}`,
			);
		case "growth":
			return described(
				`Raises ${scenarioChange.incomePct}% and inflation ${scenarioChange.costsPct}% a year${range}`,
			);
	}
}

/**
 * What a Change changes, in a word or two: "Daycare", "Income", "New roof", "Growth". Warnings
 * name the change responsible by it.
 */
export function changeName(
	scenarioChange: ScenarioChange,
	subjects: ScenarioChangeSubjects,
	changes: readonly ScenarioChange[] = [],
): string {
	switch (scenarioChange.kind) {
		case "baseline":
			return "Income";
		case "allowance":
		case "archive-bucket":
			if (othersAllowance(subjects, scenarioChange.bucketId)) return OTHER_PERSONAL_ALLOWANCE;
			return (
				subjects.buckets.find((b) => b.id === scenarioChange.bucketId)?.name ??
				addedBucket(changes, scenarioChange.bucketId)?.name ??
				archived(scenarioChange, "A Bucket")
			);
		case "commitment-terms":
		case "end-commitment":
			return (
				subjects.commitments.find((c) => c.id === scenarioChange.commitmentId)?.name ??
				addedCommitment(changes, scenarioChange.commitmentId)?.name ??
				archived(scenarioChange, "A Commitment")
			);
		case "goal":
			return (
				subjects.goals.find((g) => g.id === scenarioChange.goalId)?.name ??
				changes.find(
					(l): l is ScenarioChangeOf<"add-goal"> =>
						l.kind === "add-goal" && l.goalId === scenarioChange.goalId,
				)?.name ??
				archived(scenarioChange, "A Goal")
			);
		case "add-commitment":
		case "one-off":
		case "add-bucket":
		case "add-goal":
			return scenarioChange.name;
		case "growth":
			return "Growth";
	}
}
