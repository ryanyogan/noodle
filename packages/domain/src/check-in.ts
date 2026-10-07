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

/** A month's Extra income still to decide. */
export type PendingExtraIncome = { month: MonthKey; amount: Cents };

/** What waits for one Parent, read for them: nothing of the other Parent's Personal Allowance. */
export type CheckInWaiting = {
	/** How many Transactions wait in Review. */
	review: number;
	/** The titles of Insights nobody has decided on yet. */
	insights: string[];
	/** Those Insights' IDs, in the titles' order, when the reader has them. */
	insightIds?: string[];
	/** The last month that ended, while it hasn't closed; null once it has. */
	monthClose: MonthCloseProposal | null;
	/** Each month's Extra income still to decide. */
	windfalls: PendingExtraIncome[];
};

/** One card of the stack. Each is a summary that leads to where it's decided. */
export type CheckInCard =
	| { kind: "review"; count: number }
	| { kind: "insights"; titles: string[]; ids?: string[] }
	| { kind: "sweeps"; month: MonthKey; leftovers: Leftover[]; total: Cents }
	| { kind: "windfalls"; windfalls: PendingExtraIncome[]; total: Cents };

export type CheckInCardKind = CheckInCard["kind"];

const sum = (amounts: Cents[]) => amounts.reduce((total, amount) => total + amount, 0);

/**
 * The stack, in order: Review, Insights, Sweeps, Extra income. A card with nothing in it is left
 * out, so a quiet week has no cards at all.
 */
export function checkInCards(waiting: CheckInWaiting): CheckInCard[] {
	const cards: CheckInCard[] = [];
	if (waiting.review > 0) cards.push({ kind: "review", count: waiting.review });
	if (waiting.insights.length > 0) {
		cards.push({
			kind: "insights",
			titles: waiting.insights,
			...(waiting.insightIds ? { ids: waiting.insightIds } : {}),
		});
	}
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

/** How many things wait in all: each Transaction in Review, Insight, leftover, and Extra income. */
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

/** The stack's fixed order, which cards that start together keep. */
export const CHECK_IN_ORDER: readonly CheckInCardKind[] = [
	"review",
	"insights",
	"sweeps",
	"windfalls",
];

/**
 * What a card held when it joined the week's stack, kept so the card can still say what was
 * dealt with once nothing on it waits. Read for one Parent, like the card itself.
 */
export type CheckInStarted =
	| { kind: "review"; count: number }
	| { kind: "insights"; count: number; ids: string[] }
	| { kind: "sweeps"; month: MonthKey; total: Cents }
	| { kind: "windfalls"; months: MonthKey[]; total: Cents };

/** What to keep of a waiting card as it joins the week's stack. */
export function checkInStarted(card: CheckInCard): CheckInStarted {
	switch (card.kind) {
		case "review":
			return { kind: "review", count: card.count };
		case "insights":
			return { kind: "insights", count: card.titles.length, ids: card.ids ?? [] };
		case "sweeps":
			return { kind: "sweeps", month: card.month, total: card.total };
		case "windfalls":
			return {
				kind: "windfalls",
				months: card.windfalls.map((extraIncome) => extraIncome.month),
				total: card.total,
			};
	}
}

/** A Parent who dealt with a card. */
export type CheckInDoer = { memberId: string; name: string };

/**
 * One card of the week's stack: still waiting, or dealt with (it joined the stack and nothing
 * on it waits any more), with who is on record as having done it; nobody when no record says.
 */
export type CheckInStackCard =
	| { state: "waiting"; kind: CheckInCardKind; card: CheckInCard }
	| { state: "dealt"; kind: CheckInCardKind; started: CheckInStarted; by: CheckInDoer[] };

/**
 * The week's stack: the cards it started with, in the order they joined, then any card waiting
 * now that hasn't joined yet (in the fixed order), so a card that first appears mid-week is at
 * the end. A card that joined stays for the week: waiting while something on it waits (again),
 * dealt with otherwise.
 */
export function checkInStack(
	started: readonly CheckInStarted[],
	cards: readonly CheckInCard[],
	doers: Partial<Record<CheckInCardKind, CheckInDoer[]>> = {},
): CheckInStackCard[] {
	const waiting = new Map(cards.map((card) => [card.kind, card]));
	const stack: CheckInStackCard[] = [];
	const joined = new Set<CheckInCardKind>();
	for (const start of started) {
		if (joined.has(start.kind)) continue;
		joined.add(start.kind);
		const card = waiting.get(start.kind);
		stack.push(
			card
				? { state: "waiting", kind: card.kind, card }
				: { state: "dealt", kind: start.kind, started: start, by: doers[start.kind] ?? [] },
		);
	}
	for (const kind of CHECK_IN_ORDER) {
		const card = waiting.get(kind);
		if (card && !joined.has(kind)) stack.push({ state: "waiting", kind, card });
	}
	return stack;
}

/** The waiting cards the week's stack doesn't hold yet: what starting it would add. */
export function checkInUnstarted(
	started: readonly CheckInStarted[],
	cards: readonly CheckInCard[],
): CheckInCard[] {
	const joined = new Set(started.map((start) => start.kind));
	return cards.filter((card) => !joined.has(card.kind));
}

/** Where a Parent is in the stack: on a card (`position` of `of`, from 1), or done. */
export type CheckInStep =
	| { kind: "card"; card: CheckInStackCard; position: number; of: number; last: boolean }
	| { kind: "done" };

/**
 * The card to show next: the first the Parent hasn't moved past, dealt with or not, so a card
 * dealt with is still met (as its one line) and counted. Following cards by kind, not position,
 * keeps their place whatever happens to the others meanwhile. Done once every card is past,
 * straight away when there are none.
 */
export function checkInStep(
	stack: readonly CheckInStackCard[],
	past: readonly CheckInCardKind[],
): CheckInStep {
	const index = stack.findIndex((card) => !past.includes(card.kind));
	const card = stack[index];
	if (!card) return { kind: "done" };
	return {
		kind: "card",
		card,
		position: index + 1,
		of: stack.length,
		last: index === stack.length - 1,
	};
}
