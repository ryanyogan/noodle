import type { Cents } from "./money";
import { addDays, type DayKey, type MonthKey } from "./month";
import type { Leftover, MonthCloseProposal } from "./month-close";
import { minuteOfDayAt, nextLocalMinute } from "./nudges";

// The weekly Check-in: which week it is, what waits for a Parent in it, and where they are in
// its short stack of cards. Nothing here reads or writes; the app gathers what waits for one
// Parent (only what they may see) and hands it in.

/** A day of the week, 0 for Sunday to 6 for Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** Before the Parents choose: Sunday. */
export const DEFAULT_CHECK_IN_DAY: Weekday = 0;

export const isWeekday = (value: number): value is Weekday =>
	Number.isInteger(value) && value >= 0 && value <= 6;

/** The day of the week a calendar day falls on. */
export const weekdayOf = (day: DayKey): Weekday =>
	new Date(`${day}T00:00:00Z`).getUTCDay() as Weekday;

export const isCheckInDay = (today: DayKey, checkInDay: Weekday) => weekdayOf(today) === checkInDay;

/**
 * The week `today` belongs to, named by the Check-in day that starts it: the latest Check-in day
 * on or before `today`. A Check-in finished any day of that week counts for it. Choosing another
 * day starts a new week at once, so a Check-in already done may need doing again.
 */
export function checkInWeek(today: DayKey, checkInDay: Weekday): DayKey {
	return addDays(today, -((weekdayOf(today) - checkInDay + 7) % 7));
}

/** The Check-in Nudge lands at 9 AM, in the Household's time zone, on its Check-in day. */
export const CHECK_IN_MINUTE = 9 * 60;

/** When the Check-in Nudge raised at `now` should land: at 9 AM, or at once when that's passed. */
export function checkInNudgeTime(now: Date, timeZone: string): Date {
	return minuteOfDayAt(now, timeZone) >= CHECK_IN_MINUTE
		? now
		: nextLocalMinute(now, CHECK_IN_MINUTE, timeZone);
}

/** A month's Windfall still to decide. */
export type PendingExtraIncome = { month: MonthKey; amount: Cents };

/** What waits for one Parent, read for them: nothing of the other Parent's Personal Allowance. */
export type CheckInWaiting = {
	/** How many Transactions wait in Review. */
	review: number;
	/** The titles of Insights nobody has decided on yet. */
	insights: string[];
	/** The last month that ended, while it hasn't closed; null once it has. */
	monthClose: MonthCloseProposal | null;
	/** Each month's Windfall still to decide. */
	windfalls: PendingExtraIncome[];
};

/** One card of the stack. Each is a summary that leads to where it's decided. */
export type CheckInCard =
	| { kind: "review"; count: number }
	| { kind: "insights"; titles: string[] }
	| { kind: "sweeps"; month: MonthKey; leftovers: Leftover[]; total: Cents }
	| { kind: "windfalls"; windfalls: PendingExtraIncome[]; total: Cents };

export type CheckInCardKind = CheckInCard["kind"];

const sum = (amounts: Cents[]) => amounts.reduce((total, amount) => total + amount, 0);

/**
 * The stack, in order: Review, Insights, Sweeps, Windfalls. A card with nothing in it is left
 * out, so a quiet week has no cards at all.
 */
export function checkInCards(waiting: CheckInWaiting): CheckInCard[] {
	const cards: CheckInCard[] = [];
	if (waiting.review > 0) cards.push({ kind: "review", count: waiting.review });
	if (waiting.insights.length > 0) cards.push({ kind: "insights", titles: waiting.insights });
	const close = waiting.monthClose;
	if (close && close.leftovers.length > 0) {
		cards.push({
			kind: "sweeps",
			month: close.month,
			leftovers: close.leftovers,
			total: sum(close.leftovers.map((leftover) => leftover.amount)),
		});
	}
	const extraIncomes = waiting.windfalls
		.filter((extraIncome) => extraIncome.amount > 0)
		.sort((a, b) => a.month.localeCompare(b.month));
	if (extraIncomes.length > 0) {
		cards.push({
			kind: "windfalls",
			windfalls: extraIncomes,
			total: sum(extraIncomes.map((w) => w.amount)),
		});
	}
	return cards;
}

/** How many things wait in all: each Transaction in Review, Insight, leftover, and Windfall. */
export function checkInCount(cards: readonly CheckInCard[]): number {
	return sum(cards.map(waitingOn));
}

const waitingOn = (card: CheckInCard): number => {
	switch (card.kind) {
		case "review":
			return card.count;
		case "insights":
			return card.titles.length;
		case "sweeps":
			return card.leftovers.length;
		case "windfalls":
			return card.windfalls.length;
	}
};

/** Where a Parent is in the stack: on a card (`position` of `of`, from 1), or done. */
export type CheckInStep =
	| { kind: "card"; card: CheckInCard; position: number; of: number; last: boolean }
	| { kind: "done" };

/**
 * The card to show next: the first the Parent hasn't moved past. Following cards by kind, not
 * position, keeps their place when a card empties meanwhile (the other Parent cleared Review).
 * Done once every card is past, straight away when there are none.
 */
export function checkInStep(
	cards: readonly CheckInCard[],
	past: readonly CheckInCardKind[],
): CheckInStep {
	const index = cards.findIndex((card) => !past.includes(card.kind));
	const card = cards[index];
	if (!card) return { kind: "done" };
	return {
		kind: "card",
		card,
		position: index + 1,
		of: cards.length,
		last: index === cards.length - 1,
	};
}
