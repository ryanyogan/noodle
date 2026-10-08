import {
	addDays,
	type Cents,
	type DayKey,
	PAY_TO_COME_BEFORE_DAYS,
	type PayToCome,
	type PayToComeLine,
	payToComeChoices,
	payToComeIn,
	payToComeLeft,
	payToComeMatches,
} from "@noodle/domain";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import { incomeCounts } from "./counting";
import type { Db } from "./index";
import { income, members, payToCome, payToComeArrivals } from "./schema";

// Pay to come (issue 159, phase a; ADR-0066): pay a Parent whose pay varies has earned that is
// not in yet. It is the Household's, as Income is: both Parents read all of it and either records
// it for either. Nothing here writes Income or is read by anything that totals it, so it counts
// nowhere until the money arrives as Income of its own. The rules that say which line of Income
// is which Pay to come are in @noodle/domain (`payToComeMatches`, `payToComeChoices`); here they
// are written. An arrival is read only while its line still counts as Income, so a line that is
// removed, taken back by the bank or said to be something else leaves the pay waiting again.

/** One row for a Pay to come and a line of Income, whatever was last said of the two. */
const arrivalId = (payToComeId: string, incomeId: string) => `${payToComeId}:${incomeId}`;

/** Who it can be from: a name, not a note. */
export const PAY_FROM_MAX = 80;

/** The Household's Pay to come, in the order it was recorded, each with what it has arrived as. */
export async function loadPayToCome(db: Db, householdId: string): Promise<PayToCome[]> {
	const rows = await db
		.select()
		.from(payToCome)
		.where(eq(payToCome.householdId, householdId))
		.orderBy(payToCome.createdAt, payToCome.id);
	if (rows.length === 0) return [];
	const arrivals = await db
		.select({
			payToComeId: payToComeArrivals.payToComeId,
			incomeId: payToComeArrivals.incomeId,
			covers: payToComeArrivals.amountCents,
			notThis: payToComeArrivals.notThis,
			amount: income.amountCents,
			date: income.date,
		})
		.from(payToComeArrivals)
		.leftJoin(
			income,
			and(eq(income.id, payToComeArrivals.incomeId), eq(income.householdId, householdId)),
		)
		.where(
			and(
				eq(payToComeArrivals.householdId, householdId),
				sql`(${payToComeArrivals.notThis} = 1 or (${income.id} is not null and ${incomeCounts()}))`,
			),
		)
		.orderBy(income.date, payToComeArrivals.id);
	return rows.map((row) => {
		const own = arrivals.filter((arrival) => arrival.payToComeId === row.id);
		return {
			id: row.id,
			memberId: row.memberId,
			from: row.fromName,
			amount: row.amountCents as Cents,
			// Dates are always written as DayKeys.
			expectedOn: row.expectedOn as DayKey | null,
			recordedOn: row.recordedOn as DayKey,
			arrivals: own.flatMap((arrival) =>
				arrival.notThis || arrival.amount === null || arrival.date === null
					? []
					: [
							{
								incomeId: arrival.incomeId,
								covers: arrival.covers as Cents,
								amount: arrival.amount as Cents,
								date: arrival.date as DayKey,
							},
						],
			),
			notThis: own.filter((arrival) => arrival.notThis).map((arrival) => arrival.incomeId),
		};
	});
}

/**
 * The lines of Income a Pay to come can have arrived as: Income that counts, is not the pay for a
 * Pay day (that is a salaried Parent's paycheck), and landed no earlier than a Parent may pick
 * for the oldest of `pays` still waiting. None when nothing is waiting.
 */
export async function loadPayLines(
	db: Db,
	householdId: string,
	pays: readonly PayToCome[],
): Promise<PayToComeLine[]> {
	const waiting = pays.filter((pay) => payToComeLeft(pay) > 0);
	const [first] = waiting.map((pay) => pay.recordedOn).sort();
	if (!first) return [];
	const rows = await db
		.select({
			id: income.id,
			amount: income.amountCents,
			date: income.date,
			whosePay: income.payMemberId,
		})
		.from(income)
		.where(
			and(
				eq(income.householdId, householdId),
				gte(income.date, addDays(first, -PAY_TO_COME_BEFORE_DAYS)),
				isNull(income.payDay),
				incomeCounts(),
			),
		)
		.orderBy(income.date, income.id);
	return rows.map((row) => ({ ...row, amount: row.amount as Cents, date: row.date as DayKey }));
}

const isParent = async (db: Db, householdId: string, memberId: string) =>
	(
		await db
			.select({ id: members.id })
			.from(members)
			.where(
				and(
					eq(members.id, memberId),
					eq(members.householdId, householdId),
					eq(members.kind, "parent"),
				),
			)
	).length > 0;

const validFrom = (from: string) => {
	const name = from.trim();
	return name.length > 0 && name.length <= PAY_FROM_MAX ? name : null;
};

/**
 * Records pay a Parent has earned that is not in yet. Refused unless `memberId` is one of the
 * Household's Parents, it is from someone and for more than nothing.
 */
export async function addPayToCome(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: {
		id: string;
		memberId: string;
		from: string;
		amountCents: Cents;
		expectedOn: DayKey | null;
		/** The Household's day today. */
		recordedOn: DayKey;
	},
): Promise<{ ok: boolean }> {
	const from = validFrom(input.from);
	if (!from || input.amountCents <= 0) return { ok: false };
	if (!(await isParent(db, viewer.householdId, input.memberId))) return { ok: false };
	await db
		.insert(payToCome)
		.values({
			id: input.id,
			householdId: viewer.householdId,
			memberId: input.memberId,
			fromName: from,
			amountCents: input.amountCents,
			expectedOn: input.expectedOn,
			recordedOn: input.recordedOn,
			createdByMemberId: viewer.memberId,
		})
		// A retry of the same add is still that add.
		.onConflictDoNothing();
	return { ok: true };
}

export type PayToComeChanged =
	| { ok: true }
	/** `less-than-in`: the new amount is less than what has already arrived of it. */
	| { ok: false; reason: "refused" | "less-than-in" };

/** Changes who it is from, the amount or the day it is expected. */
export async function changePayToCome(
	db: Db,
	householdId: string,
	input: { id: string; from: string; amountCents: Cents; expectedOn: DayKey | null },
): Promise<PayToComeChanged> {
	const from = validFrom(input.from);
	if (!from || input.amountCents <= 0) return { ok: false, reason: "refused" };
	const before = (await loadPayToCome(db, householdId)).find((pay) => pay.id === input.id);
	if (!before) return { ok: false, reason: "refused" };
	if (input.amountCents < payToComeIn(before)) return { ok: false, reason: "less-than-in" };
	await db
		.update(payToCome)
		.set({ fromName: from, amountCents: input.amountCents, expectedOn: input.expectedOn })
		.where(and(eq(payToCome.id, input.id), eq(payToCome.householdId, householdId)));
	return { ok: true };
}

/** Removes one, with what it was said to have arrived as. The Income itself is never touched. */
export async function removePayToCome(
	db: Db,
	householdId: string,
	id: string,
): Promise<{ ok: boolean }> {
	const [, removed] = await db.batch([
		db
			.delete(payToComeArrivals)
			.where(
				and(eq(payToComeArrivals.payToComeId, id), eq(payToComeArrivals.householdId, householdId)),
			),
		db
			.delete(payToCome)
			.where(and(eq(payToCome.id, id), eq(payToCome.householdId, householdId)))
			.returning({ id: payToCome.id }),
	]);
	return { ok: removed.length > 0 };
}

/**
 * Keeps on the Household's Pay to come the Income it has just arrived as (`payToComeMatches`):
 * `only` the lines that have just arrived or changed, and only one that is the same Parent's pay
 * for exactly what is still to come, with nothing else it could be. Safe to run again: a line
 * that is already some pay's arrival is never given to another, in the rule and in the table.
 */
export async function matchPayToCome(
	db: Db,
	householdId: string,
	options: { only: readonly string[] },
): Promise<{ matched: number }> {
	if (options.only.length === 0) return { matched: 0 };
	const all = await loadPayToCome(db, householdId);
	const lines = await loadPayLines(db, householdId, all);
	const matches = payToComeMatches({ all, lines, only: options.only });
	for (const match of matches) {
		await db
			.insert(payToComeArrivals)
			.values({
				id: arrivalId(match.payToComeId, match.incomeId),
				householdId,
				payToComeId: match.payToComeId,
				incomeId: match.incomeId,
				amountCents: match.covers,
			})
			.onConflictDoNothing();
	}
	return { matched: matches.length };
}

/**
 * A Parent says a line of Income is a Pay to come arriving: `all` of what was still to come
 * (whatever the line's amount: a fee may have come off on the way), or a part, which leaves the
 * rest waiting. A line for as much or more is always all of it. Refused unless the line is one of
 * its choices (`payToComeChoices`). Income nobody had said whose pay it is becomes that Parent's.
 */
export async function sayPayArrived(
	db: Db,
	householdId: string,
	input: { payToComeId: string; incomeId: string; all: boolean },
): Promise<{ ok: boolean }> {
	const pays = await loadPayToCome(db, householdId);
	const pay = pays.find((one) => one.id === input.payToComeId);
	if (!pay) return { ok: false };
	// A retry of this after it landed is still this.
	if (pay.arrivals.some((arrival) => arrival.incomeId === input.incomeId)) return { ok: true };
	const lines = await loadPayLines(db, householdId, pays);
	const choice = payToComeChoices(pay, pays, lines).find(({ line }) => line.id === input.incomeId);
	if (!choice) return { ok: false };
	const left = payToComeLeft(pay);
	const covers = input.all || choice.line.amount >= left ? left : choice.line.amount;
	await db
		.insert(payToComeArrivals)
		.values({
			id: arrivalId(pay.id, choice.line.id),
			householdId,
			payToComeId: pay.id,
			incomeId: choice.line.id,
			amountCents: covers,
			byHand: true,
		})
		// The other Parent got there first with the same line: theirs stands.
		.onConflictDoNothing();
	const after = (await loadPayToCome(db, householdId)).find((one) => one.id === pay.id);
	if (!after?.arrivals.some((arrival) => arrival.incomeId === input.incomeId)) return { ok: false };
	if (choice.line.whosePay === null) {
		await db
			.update(income)
			.set({ payMemberId: pay.memberId })
			.where(
				and(
					eq(income.id, choice.line.id),
					eq(income.householdId, householdId),
					isNull(income.payMemberId),
				),
			);
	}
	return { ok: true };
}

/**
 * A Parent says a line of Income is not a Pay to come arriving: the answer to an offer, and the
 * undo of an arrival, by the rule or by hand. The pay waits again for what that line covered, and
 * the line is never offered or matched to it again. The Income itself is never touched.
 */
export async function sayNotThisPay(
	db: Db,
	householdId: string,
	input: { payToComeId: string; incomeId: string },
): Promise<{ ok: boolean }> {
	const [pay] = await db
		.select({ id: payToCome.id })
		.from(payToCome)
		.where(and(eq(payToCome.id, input.payToComeId), eq(payToCome.householdId, householdId)));
	if (!pay) return { ok: false };
	await db
		.insert(payToComeArrivals)
		.values({
			id: arrivalId(pay.id, input.incomeId),
			householdId,
			payToComeId: pay.id,
			incomeId: input.incomeId,
			amountCents: 0,
			notThis: true,
			byHand: true,
		})
		.onConflictDoUpdate({
			target: [payToComeArrivals.payToComeId, payToComeArrivals.incomeId],
			set: { amountCents: 0, notThis: true, byHand: true },
		});
	return { ok: true };
}
