import type { Cadence } from "./commitments";
import type { Lever, LeverOf } from "./levers";
import type { Cents } from "./money";
import { type DayKey, type MonthKey, monthOfDay } from "./month";

// Levers in plain words, as "Your changes" lists them: "Daycare $1,400 → ended from Sep 2027".
// Each says what the Plan has now, what the Scenario makes it, and the months it holds for.

/** What Levers change, as the Plan has them this month: the words describe Levers against it. */
export type LeverSubjects = {
	/** The Household's current month: a Lever from then (or earlier) needs no "from". */
	month: MonthKey;
	baseline: Cents | null;
	buckets: readonly { id: string; name: string; allowance: Cents }[];
	commitments: readonly { id: string; name: string; amount: Cents; cadence: Cadence }[];
	goals: readonly { id: string; name: string; target: Cents; targetDate: DayKey | null }[];
};

export type LeverDescription = {
	text: string;
	/**
	 * The Bucket, Commitment or Goal it changes is no longer in the Plan, and no other Lever adds
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
function money(cents: Cents): string {
	const text = dollarsAndCents.format(Math.abs(cents) / 100).replace(/\.(\d)$/, ".$10");
	return cents < 0 ? `−${text}` : text;
}

const cadenceWords: Record<Cadence, string> = {
	monthly: "a month",
	biweekly: "every two weeks",
	annual: "a year",
};

/** "1st", "12th", "22nd" for a day of the month. */
const ordinal = (day: number) =>
	day >= 11 && day <= 13 ? `${day}th` : `${day}${["th", "st", "nd", "rd"][day % 10] ?? "th"}`;

/** " from Mar 2027 until Aug 2028", " until Aug 2028" (from now), or "" (from now, for good). */
function rangeWords(lever: Lever, month: MonthKey): string {
	const from = lever.fromMonth > month ? ` from ${shortMonthName(lever.fromMonth)}` : "";
	const until = lever.untilMonth ? ` until ${shortMonthName(lever.untilMonth)}` : "";
	return `${from}${until}`;
}

const goalWords = (target: Cents, targetDate: DayKey | null) =>
	`${money(target)} ${targetDate ? `by ${shortMonthName(monthOfDay(targetDate))}` : "with no date"}`;

/** The name of a Commitment a Lever adds, if one does. */
const addedCommitment = (levers: readonly Lever[], id: string) =>
	levers.find(
		(l): l is LeverOf<"add-commitment"> => l.kind === "add-commitment" && l.commitmentId === id,
	);

const addedBucket = (levers: readonly Lever[], id: string) =>
	levers.find((l): l is LeverOf<"add-bucket"> => l.kind === "add-bucket" && l.bucketId === id);

/**
 * A Lever in words, against the Plan as it stands (`subjects`) and the Scenario's other Levers
 * (which may add the Commitment or Bucket it ends).
 */
export function describeLever(
	lever: Lever,
	subjects: LeverSubjects,
	levers: readonly Lever[] = [],
): LeverDescription {
	const range = rangeWords(lever, subjects.month);
	const described = (text: string, gone = false): LeverDescription => ({ text, gone });

	switch (lever.kind) {
		case "baseline":
			return described(
				subjects.baseline === null
					? `Income ${money(lever.amount)} a month${range}`
					: `Income ${money(subjects.baseline)} → ${money(lever.amount)} a month${range}`,
			);
		case "allowance": {
			const bucket = subjects.buckets.find((b) => b.id === lever.bucketId);
			return bucket
				? described(
						`${bucket.name} ${money(bucket.allowance)} → ${money(lever.amount)} a month${range}`,
					)
				: described(`A Bucket’s allowance ${money(lever.amount)} a month${range}`, true);
		}
		case "commitment-terms": {
			const commitment = subjects.commitments.find((c) => c.id === lever.commitmentId);
			const due = lever.dueDay ? `, due on the ${ordinal(lever.dueDay)}` : "";
			if (!commitment) {
				const amount = lever.amount === undefined ? "new terms" : money(lever.amount);
				return described(`A Commitment’s ${amount}${due}${range}`, true);
			}
			const before = `${money(commitment.amount)} ${cadenceWords[commitment.cadence]}`;
			const after = `${money(lever.amount ?? commitment.amount)} ${cadenceWords[lever.cadence ?? commitment.cadence]}`;
			// "$1,400 → $1,200 a month" when only the amount changes.
			const change =
				(lever.cadence ?? commitment.cadence) === commitment.cadence
					? `${money(commitment.amount)} → ${after}`
					: `${before} → ${after}`;
			return described(`${commitment.name} ${change}${due}${range}`);
		}
		case "end-commitment": {
			const commitment = subjects.commitments.find((c) => c.id === lever.commitmentId);
			if (commitment) {
				return described(`${commitment.name} ${money(commitment.amount)} → ended${range}`);
			}
			const added = addedCommitment(levers, lever.commitmentId);
			return added
				? described(`${added.name} → ended${range}`)
				: described(`A Commitment ended${range}`, true);
		}
		case "add-commitment": {
			const term = lever.months === null ? "" : ` for ${lever.months} months`;
			return described(
				`New Commitment: ${lever.name} ${money(lever.amount)} ${cadenceWords[lever.cadence]}${term}${range}`,
			);
		}
		case "one-off":
			return described(
				`One-off ${lever.flow}: ${lever.name} ${money(lever.amount)} in ${shortMonthName(lever.fromMonth)}`,
			);
		case "add-bucket":
			return described(`New Bucket: ${lever.name} ${money(lever.amount)} a month${range}`);
		case "archive-bucket": {
			const bucket = subjects.buckets.find((b) => b.id === lever.bucketId);
			if (bucket) return described(`${bucket.name} ${money(bucket.allowance)} → archived${range}`);
			const added = addedBucket(levers, lever.bucketId);
			return added
				? described(`${added.name} → archived${range}`)
				: described(`A Bucket archived${range}`, true);
		}
		case "goal": {
			const goal = subjects.goals.find((g) => g.id === lever.goalId);
			const after = goalWords(lever.target, lever.targetDate);
			return goal
				? described(`${goal.name} ${goalWords(goal.target, goal.targetDate)} → ${after}${range}`)
				: described(`A Goal ${after}${range}`, true);
		}
		case "add-goal":
			return described(
				`New Goal: ${lever.name} ${goalWords(lever.target, lever.targetDate)}${range}`,
			);
		case "growth":
			return described(
				`Raises ${lever.incomePct}% and inflation ${lever.costsPct}% a year${range}`,
			);
	}
}
