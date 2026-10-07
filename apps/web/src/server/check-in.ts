import {
	completeCheckIn as completeCheckInInDb,
	type Db,
	loadCheckInDoers,
	loadCheckInStack,
	loadCheckIns,
	loadInsights,
	loadReview,
	setCheckInDay as setCheckInDayInDb,
	startCheckInStack as startCheckInStackInDb,
} from "@noodle/db";
import {
	addMonths,
	type CheckInCard,
	type CheckInCardKind,
	type CheckInDoer,
	type CheckInStackCard,
	type CheckInStarted,
	type CheckInWaiting,
	checkInCards,
	checkInStack,
	checkInStarted,
	checkInUnstarted,
	checkInWeek,
	type DayKey,
	dayKeyAt,
	isWeekday,
	monthCloseProposal,
	monthKeyAt,
	monthState,
	type Weekday,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware, viewerOf } from "./household";
import { loadMonth } from "./month";
import { notifyHousehold } from "./notify";

// The weekly Check-in. What waits in it is read for the Parent looking, like every read
// (ADR-0003): their Review, the Insights they may see, and the Household's leftovers and
// Extra income, which never include a Personal Allowance. Finishing it is theirs alone; the other
// Parent sees only that, and when.

/** What waits for a Parent: Review, new Insights, last month's Sweeps while it's open, Extra income. */
export async function loadCheckInWaiting(
	db: Db,
	household: Pick<HouseholdSummary, "id" | "timeZone">,
	memberId: string,
	now: Date,
): Promise<CheckInWaiting> {
	const viewer = viewerOf({ household, parent: { id: memberId } });
	const current = monthKeyAt(now, household.timeZone);
	const last = addMonths(current, -1);
	const [review, insights, lastMonth, thisMonth] = await Promise.all([
		loadReview(db, viewer, 0),
		loadInsights(db, viewer),
		loadMonth(db, household, memberId, last),
		loadMonth(db, household, memberId, current),
	]);
	const lastState = monthState(lastMonth);
	const fresh = insights.filter((insight) => insight.status === "new");
	return {
		review: review.total,
		insights: fresh.map((insight) => insight.title),
		insightIds: fresh.map((insight) => insight.id),
		monthClose: lastMonth.closed ? null : monthCloseProposal(lastState),
		windfalls: [
			{ month: last, amount: lastState.windfallLeft },
			{ month: current, amount: monthState(thisMonth).windfallLeft },
		],
	};
}

/** The Check-in as a Parent sees it this week. */
export type CheckInView = {
	/** The Check-in day that starts this week. */
	week: DayKey;
	checkInDay: Weekday;
	/** The Parent looking, so a card they dealt with can say "You". */
	me: string;
	/**
	 * The week's stack: every card that has waited for this Parent this week, in the Household's
	 * order, waiting or dealt with, then any waiting now that hasn't joined it yet.
	 */
	stack: CheckInStackCard[];
	/** Something waits that the week's stack doesn't hold yet: the page asks for it to be started. */
	unstarted: boolean;
	/** When this Parent finished this week's Check-in (epoch ms); null while they haven't. */
	completedAt: number | null;
	/** The other Parent, if there is one, and when they finished this week's. */
	otherParent: { name: string; completedAt: number | null } | null;
};

type HouseholdContext = {
	household: HouseholdSummary & { checkInDay: Weekday };
	parent: { id: string };
};

const thisWeek = ({ household }: HouseholdContext, now: Date) =>
	checkInWeek(dayKeyAt(now, household.timeZone), household.checkInDay);

export const getCheckIn = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<CheckInView> => {
		const db = getDb();
		const now = new Date();
		const week = thisWeek(context, now);
		const viewer = viewerOf(context);
		const [waiting, parents, rows] = await Promise.all([
			loadCheckInWaiting(db, context.household, context.parent.id, now),
			loadCheckIns(db, context.household.id, week),
			loadCheckInStack(db, viewer, week),
		]);
		const cards = checkInCards(waiting);
		// Who dealt with each card nothing waits on any more, by name, where there's a record.
		const dealt = rows.filter((row) => !cards.some((card) => card.kind === row.kind));
		const doers = await loadCheckInDoers(db, viewer, dealt);
		const named: Partial<Record<CheckInCardKind, CheckInDoer[]>> = {};
		for (const [kind, ids] of Object.entries(doers) as [CheckInCardKind, string[]][]) {
			named[kind] = parents
				.filter((parent) => ids.includes(parent.memberId))
				.map((parent) => ({ memberId: parent.memberId, name: parent.name }));
		}
		// Each card as it started, without when: the page has no use for it.
		const started = rows.map(({ startedAt: _, ...start }): CheckInStarted => start);
		const me = parents.find((parent) => parent.memberId === context.parent.id);
		const other = parents.find((parent) => parent.memberId !== context.parent.id);
		return {
			week,
			checkInDay: context.household.checkInDay,
			me: context.parent.id,
			stack: checkInStack(started, cards, named),
			unstarted: checkInUnstarted(started, cards).length > 0,
			completedAt: me?.completedAt?.getTime() ?? null,
			otherParent: other
				? { name: other.name, completedAt: other.completedAt?.getTime() ?? null }
				: null,
		};
	});

/**
 * Adds to `week`'s stack whatever waits for a Parent and hasn't joined it yet, as it is now.
 * `cards` when the caller has just read them for that Parent. Returns how many joined.
 */
export async function startCheckInStackFor(
	db: Db,
	household: Pick<HouseholdSummary, "id" | "timeZone">,
	memberId: string,
	week: DayKey,
	now: Date,
	cards?: readonly CheckInCard[],
): Promise<number> {
	const waiting = cards ?? checkInCards(await loadCheckInWaiting(db, household, memberId, now));
	if (waiting.length === 0) return 0;
	return startCheckInStackInDb(db, {
		householdId: household.id,
		memberId,
		week,
		cards: waiting.map(checkInStarted),
		now,
	});
}

/**
 * Starts this week's stack, or adds what has appeared since: for every Parent of the Household,
 * each read as themselves, so both meet the same cards in the same order whoever opens the
 * Check-in first. The page asks for this when its read says something hasn't joined; the read
 * itself never writes. Idempotent.
 */
export const startCheckInStack = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const db = getDb();
		const now = new Date();
		const week = thisWeek(context, now);
		const parents = await loadCheckIns(db, context.household.id, week);
		const joined = await Promise.all(
			parents.map((parent) =>
				startCheckInStackFor(db, context.household, parent.memberId, week, now),
			),
		);
		if (joined.some((count) => count > 0))
			await notifyHousehold(context.household.id, ["check-in"]);
	});

/** Whether the signed-in Parent has done this week's Check-in, for the sidebar and This Month. */
export type CheckInStatus = {
	done: boolean;
	/** Today is the Check-in day: the week's Check-in starts today. */
	today: boolean;
};

/** This week's Check-in, as the app's frame shows it: only whether this Parent has done it. */
export const getCheckInStatus = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<CheckInStatus> => {
		const now = new Date();
		const week = thisWeek(context, now);
		const parents = await loadCheckIns(getDb(), context.household.id, week);
		const me = parents.find((parent) => parent.memberId === context.parent.id);
		return {
			done: Boolean(me?.completedAt),
			today: week === dayKeyAt(now, context.household.timeZone),
		};
	});

/** Finishes this week's Check-in for the signed-in Parent. Idempotent. */
export const completeCheckIn = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const recorded = await completeCheckInInDb(getDb(), {
			...viewerOf(context),
			week: thisWeek(context, new Date()),
		});
		if (recorded) await notifyHousehold(context.household.id, ["check-in"]);
	});

/** Chooses the day of the week the Household's Check-in falls on. */
export const setCheckInDay = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ day: z.number().refine(isWeekday) }))
	.handler(async ({ data, context }) => {
		await setCheckInDayInDb(getDb(), context.household.id, data.day as Weekday);
		await notifyHousehold(context.household.id, ["check-in"]);
	});
