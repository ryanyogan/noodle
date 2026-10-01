import {
	completeCheckIn as completeCheckInInDb,
	type Db,
	loadCheckIns,
	loadInsights,
	loadReview,
	setCheckInDay as setCheckInDayInDb,
} from "@noodle/db";
import {
	addMonths,
	type CheckInCard,
	type CheckInWaiting,
	checkInCards,
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
	return {
		review: review.total,
		insights: insights.filter((insight) => insight.status === "new").map((i) => i.title),
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
	cards: CheckInCard[];
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
		const [waiting, parents] = await Promise.all([
			loadCheckInWaiting(db, context.household, context.parent.id, now),
			loadCheckIns(db, context.household.id, week),
		]);
		const me = parents.find((parent) => parent.memberId === context.parent.id);
		const other = parents.find((parent) => parent.memberId !== context.parent.id);
		return {
			week,
			checkInDay: context.household.checkInDay,
			cards: checkInCards(waiting),
			completedAt: me?.completedAt?.getTime() ?? null,
			otherParent: other
				? { name: other.name, completedAt: other.completedAt?.getTime() ?? null }
				: null,
		};
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
