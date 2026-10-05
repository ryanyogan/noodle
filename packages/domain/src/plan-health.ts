import { type Income, incomeCheck } from "./extra-income";
import { type GoalKind, goalProgress, projectionGoalOf, type SetAsideChange } from "./goals";
import type { Cents } from "./money";
import { addMonths, type DayKey, type MonthKey, monthOfDay } from "./month";
import { type PlanRecords, planForMonth } from "./plan";
import { planHabits, planVsActual, projectedCompletion } from "./reports";
import { planAhead, project } from "./scenario";

// Plan health: what in the Plan is likely to go wrong, each warning pointing at its fix.
//
// - Free to Spend below zero in a month ahead: the Plan projected with no Changes (planAhead),
//   over the next 12 months.
// - Income behind take-home pay this month, from mid-month on (incomeCheck).
// - A Bucket over its allowance in most of the last 6 months (Reports' planHabits). The other
//   Parent's Personal Allowance is theirs alone to set, so it's never flagged to this one.
// - A dated Goal that won't reach its target by its date at the pace of its last 6 months
//   (projectedCompletion). A Goal added this month hasn't had time to show a pace.
//   A payoff Goal's pace is how far what's owed has come down since it was added (ADR-0019).
// - A Commitment that pays down a credit card Noodle has since begun to follow (ADR-0050): what's
//   bought on the card is in the Buckets now, so its payments would count twice, unless the
//   Commitment is a set payment on a balance being carried.
//
// Every Commitment has a due date (the Plan can't store one without), so none is flagged for it.

/** How many months ahead a negative Free to Spend is looked for. */
export const HEALTH_MONTHS_AHEAD = 12;

/** How many finished months a Bucket's habit is judged over. */
export const HEALTH_HABIT_MONTHS = 6;

export type PlanWarning =
	| {
			kind: "negative-ahead";
			/** The first month ahead whose Free to Spend is below zero. */
			month: MonthKey;
			freeToSpend: Cents;
			/** How many of the months ahead are below zero. */
			months: number;
	  }
	| { kind: "income-behind"; month: MonthKey; short: Cents; received: Cents; expected: Cents }
	| {
			kind: "bucket-over";
			bucketId: string;
			name: string;
			/** Months over, of `months` judged. */
			over: number;
			months: number;
			/** Spent beyond the allowance over those months (less any months under). */
			gap: Cents;
	  }
	| {
			kind: "goal-late";
			goalId: string;
			name: string;
			targetDate: DayKey;
			/** When it gets there at its recent pace; null when it isn't growing. */
			reachedIn: MonthKey | null;
	  }
	| {
			kind: "card-followed";
			commitmentId: string;
			/** The Commitment's name. */
			name: string;
			accountId: string;
			/** The card's name. */
			account: string;
			/** It syncs with its bank; otherwise its purchases were imported lately. */
			connected: boolean;
	  };

/** A credit card of the Household's, as Plan health reads it. */
export type HealthCard = {
	id: string;
	name: string;
	connected: boolean;
	/** Noodle sees what's bought on it: connected, or with purchases imported lately. */
	followed: boolean;
};

/**
 * The Commitments that pay down a card Noodle now follows without being a set payment on a balance
 * being carried: each would count the card's purchases a second time. A loan is never followed.
 */
export function cardsNowFollowed(
	commitments: readonly {
		id: string;
		name: string;
		accountId?: string | null;
		carriedBalance?: boolean;
	}[],
	cards: readonly HealthCard[],
): Extract<PlanWarning, { kind: "card-followed" }>[] {
	const followed = new Map(cards.filter((card) => card.followed).map((card) => [card.id, card]));
	return commitments.flatMap((commitment) => {
		const card = commitment.accountId ? followed.get(commitment.accountId) : undefined;
		if (!card || commitment.carriedBalance) return [];
		return [
			{
				kind: "card-followed" as const,
				commitmentId: commitment.id,
				name: commitment.name,
				accountId: card.id,
				account: card.name,
				connected: card.connected,
			},
		];
	});
}

export type HealthGoal = {
	id: string;
	name: string;
	target: Cents;
	targetDate: DayKey | null;
	fromMonth: MonthKey;
	/** A payoff Goal is judged by what's owed now (ADR-0019). */
	kind?: GoalKind;
	owed?: Cents | null;
};

/**
 * The Plan's health for `parentId` as of `asOf`. `records` must reach 12 months past `asOf`'s
 * month; `goals` are the active ones; `income` covers this month and last; `spent` covers the
 * finished months judged, per Bucket.
 */
export function planHealth({
	asOf,
	parentId,
	records,
	goals,
	changes,
	income,
	spent,
	cards = [],
}: {
	asOf: DayKey;
	parentId: string;
	records: PlanRecords;
	goals: readonly HealthGoal[];
	changes: readonly SetAsideChange[];
	income: readonly Income[];
	spent: readonly { bucketId: string; month: MonthKey; amount: Cents }[];
	/** The Household's credit cards in use; left out, no Commitment is checked against them. */
	cards?: readonly HealthCard[];
}): PlanWarning[] {
	const month = monthOfDay(asOf);
	const warnings: PlanWarning[] = [];

	const ahead = planAhead(
		records,
		goals.map((goal) => projectionGoalOf(goal, changes, month)),
		month,
		HEALTH_MONTHS_AHEAD + 1,
	);
	const negative = project(ahead)
		.months.slice(1)
		.filter((m) => m.freeToSpend < 0);
	const firstNegative = negative[0];
	if (firstNegative) {
		warnings.push({
			kind: "negative-ahead",
			month: firstNegative.month,
			freeToSpend: firstNegative.freeToSpend,
			months: negative.length,
		});
	}

	const check = incomeCheck({
		baseline: planForMonth(records, month).baseline,
		income: [...income],
		month,
		asOf,
	});
	if (check?.below) {
		warnings.push({
			kind: "income-behind",
			month,
			short: check.short,
			received: check.received,
			expected: check.expected,
		});
	}

	const months = Array.from({ length: HEALTH_HABIT_MONTHS }, (_, i) =>
		addMonths(month, i - HEALTH_HABIT_MONTHS),
	);
	const theirs = new Set(
		records.buckets.filter((b) => b.owner && b.owner !== parentId).map((b) => b.id),
	);
	const current = new Map(planForMonth(records, month).buckets.map((b) => [b.id, b.name]));
	for (const habit of planHabits(planVsActual(records, [...spent], months))) {
		const name = current.get(habit.bucketId);
		// A Bucket no longer in the Plan has nothing left to fix.
		if (habit.habit !== "over" || theirs.has(habit.bucketId) || name === undefined) continue;
		warnings.push({
			kind: "bucket-over",
			bucketId: habit.bucketId,
			name,
			over: habit.over,
			months: habit.months,
			gap: habit.gap,
		});
	}

	for (const goal of goals) {
		if (goal.targetDate === null || goal.fromMonth >= month) continue;
		if (goalProgress(goal, changes, month).status === "reached") continue;
		const reachedIn = projectedCompletion(goal, changes, month);
		if (reachedIn !== null && reachedIn <= monthOfDay(goal.targetDate)) continue;
		warnings.push({
			kind: "goal-late",
			goalId: goal.id,
			name: goal.name,
			targetDate: goal.targetDate,
			reachedIn,
		});
	}

	warnings.push(...cardsNowFollowed(planForMonth(records, month).commitments, cards));
	return warnings;
}
