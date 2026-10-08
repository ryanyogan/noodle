import {
	type Cents,
	countsOn,
	type DayKey,
	type MonthKey,
	monthOfDay,
	nearbyPayDays,
	type PayDayMatch,
	payDayMatches,
} from "@noodle/domain";
import { and, eq, isNull, type SQL, sql } from "drizzle-orm";
import { incomeCounts, incomeCountsRaw } from "./counting";
import { decidedSql, extraIncomeSql } from "./extra-income";
import type { Db } from "./index";
import {
	closedAmong,
	loadMoneyInLine,
	type MoneyInKindResult,
	type MoneyInLine,
	notClosed,
} from "./money-in";
import { loadParentPay } from "./parent-pay";
import { income } from "./schema";

// A paycheck counts on its pay day (issue 156, phase 2; ADR-0063). Income that is a salaried
// Parent's pay and landed near a pay day has that pay day kept on it (`income.pay_day`), and from
// then on counts in the pay day's month (incomeCountsOn in counting.ts). The rule that says which
// line is which paycheck is `payDayMatches` in @noodle/domain; here it is written, guarded like
// any change that moves Income between months: Extra income already decided in the month it
// leaves stays covered (ADR-0052), and a month that has been closed is never moved into or out
// of. The automatic write leaves such a line where it is and says so; a Parent's own is refused.

/** A line the automatic rule left where it is, and why. */
export type PayDayNotMoved = {
	lineId: string;
	note: string | null;
	amount: Cents;
	/** The day it landed, which it still counts on. */
	date: DayKey;
	/** The pay day it would be the pay for. */
	payDay: DayKey;
	/**
	 * `month-closed`: `month` has been closed. `extra-income`: Extra income already decided in
	 * `month` needs it.
	 */
	reason: "month-closed" | "extra-income";
	month: MonthKey;
};

export type PayDaysMatched = {
	/** How many lines were given a pay day. */
	matched: number;
	/** The months whose Income changed. */
	months: MonthKey[];
	notMoved: PayDayNotMoved[];
};

/** Extra income already decided in `month` is still covered without the row being written. */
const stillCovered = (householdId: string, month: MonthKey): SQL =>
	sql`${extraIncomeSql(householdId, month, sql.raw("income.amount_cents"))} >= ${decidedSql(householdId, month)}`;

/** No other line of Income that counts is already `memberId`'s pay for `day`. */
const payDayFree = (householdId: string, memberId: string, day: DayKey): SQL =>
	sql`not exists (select 1 from income o where o.household_id = ${householdId}
		and o.pay_member_id = ${memberId} and o.pay_day = ${day} and o.id <> income.id
		and ${sql.raw(incomeCountsRaw("o.id"))})`;

/**
 * Keeps on the Household's Income the pay days it should have (`payDayMatches`): all of it, or
 * `only` the lines that have just arrived or changed. With `claim` (a Parent has just said how
 * they are paid) a line nobody has said whose pay it is becomes the Parent's whose paycheck it
 * can only be. Safe to run again: a line with a pay day, or one a Parent spoke for by hand, is
 * never touched. A line that would change month is skipped, not failed, while a month it would
 * leave or join has been closed, or Extra income decided in the month it would leave needs it.
 */
export async function matchPayDays(
	db: Db,
	householdId: string,
	options: { claim?: boolean; only?: readonly string[] } = {},
): Promise<PayDaysMatched> {
	const none: PayDaysMatched = { matched: 0, months: [], notMoved: [] };
	if (options.only && options.only.length === 0) return none;
	const parents = (await loadParentPay(db, householdId)).flatMap((parent) =>
		parent.pay ? [{ memberId: parent.memberId, pay: parent.pay }] : [],
	);
	if (parents.length === 0) return none;
	const rows = await db
		.select({
			id: income.id,
			amount: income.amountCents,
			date: income.date,
			note: income.note,
			whosePay: income.payMemberId,
			payDay: income.payDay,
			byHand: income.payDayByHand,
		})
		.from(income)
		.where(and(eq(income.householdId, householdId), incomeCounts()))
		.orderBy(income.date, income.id);
	const lines = rows.map((row) => ({
		...row,
		amount: row.amount as Cents,
		// Dates are always written as DayKeys.
		date: row.date as DayKey,
		payDay: row.payDay as DayKey | null,
		byHand: row.byHand === true,
	}));
	const matches = payDayMatches({ parents, lines, claim: options.claim, only: options.only });
	if (matches.length === 0) return none;
	const lineOf = new Map(lines.map((line) => [line.id, line]));
	const moveOf = (match: PayDayMatch) => {
		const from = monthOfDay((lineOf.get(match.lineId) as { date: DayKey }).date);
		return { from, to: monthOfDay(match.payDay) };
	};
	// One after another, each seeing the ones before it: two paychecks leaving the same month are
	// each held to what that month's Extra income still needs.
	const writes = matches.map((match) => {
		const { from, to } = moveOf(match);
		return db
			.update(income)
			.set({ payDay: match.payDay, ...(match.claims ? { payMemberId: match.memberId } : {}) })
			.where(
				and(
					eq(income.id, match.lineId),
					eq(income.householdId, householdId),
					isNull(income.payDay),
					isNull(income.payDayByHand),
					incomeCounts(),
					// Whose pay it was read as: never over what a Parent has said since.
					match.claims ? isNull(income.payMemberId) : eq(income.payMemberId, match.memberId),
					payDayFree(householdId, match.memberId, match.payDay),
					from === to ? undefined : notClosed(householdId, [from, to]),
					from === to ? undefined : stillCovered(householdId, from),
				),
			);
	});
	const BATCH = 50;
	for (let at = 0; at < writes.length; at += BATCH) {
		const [first, ...rest] = writes.slice(at, at + BATCH);
		if (first) await db.batch([first, ...rest]);
	}
	const kept = new Set(
		(
			await db
				.select({ id: income.id })
				.from(income)
				.where(
					and(
						eq(income.householdId, householdId),
						sql`${income.payDay} is not null`,
						// One parameter however many: D1 caps a statement's bound parameters.
						sql`${income.id} in (select value from json_each(${JSON.stringify(matches.map((m) => m.lineId))}))`,
					),
				)
		).map((row) => row.id),
	);
	const months = new Set<MonthKey>();
	const left: { match: PayDayMatch; from: MonthKey; to: MonthKey }[] = [];
	for (const match of matches) {
		const { from, to } = moveOf(match);
		if (kept.has(match.lineId)) {
			months.add(from);
			months.add(to);
		} else if (from !== to) left.push({ match, from, to });
	}
	const closed = new Set(
		left.length > 0
			? await closedAmong(db, householdId, [...new Set(left.flatMap(({ from, to }) => [from, to]))])
			: [],
	);
	const notMoved = left.map(({ match, from, to }): PayDayNotMoved => {
		const line = lineOf.get(match.lineId) as (typeof lines)[number];
		const shut = closed.has(from) ? from : closed.has(to) ? to : null;
		return {
			lineId: line.id,
			note: line.note,
			amount: line.amount,
			date: line.date,
			payDay: match.payDay,
			reason: shut ? "month-closed" : "extra-income",
			month: shut ?? from,
		};
	});
	return { matched: kept.size, months: [...months].sort(), notMoved };
}

/** A pay day a line can be said to be the pay for; `taken` when another line already is. */
export type PayDayChoice = { day: DayKey; taken: boolean };

/**
 * The pay days a Parent can say `line` is the pay for: the nearby pay days of the Parent whose
 * pay it is, earliest first. None unless it is Income that counts and that Parent is on a salary.
 */
export async function loadPayDayChoices(
	db: Db,
	householdId: string,
	line: MoneyInLine,
): Promise<PayDayChoice[]> {
	if (line.kind !== "income" || line.needsReview || !line.whosePay) return [];
	const parent = (await loadParentPay(db, householdId)).find((p) => p.memberId === line.whosePay);
	if (!parent?.pay) return [];
	const days = nearbyPayDays(parent.pay.schedule, line.date);
	const others = await db
		.select({ day: income.payDay })
		.from(income)
		.where(
			and(
				eq(income.householdId, householdId),
				eq(income.payMemberId, line.whosePay),
				sql`${income.payDay} in (select value from json_each(${JSON.stringify(days)}))`,
				sql`${income.id} <> ${line.id}`,
				incomeCounts(),
			),
		);
	const taken = new Set(others.map((row) => row.day));
	return days.map((day) => ({ day, taken: taken.has(day) }));
}

/**
 * A Parent says by hand which pay day a line of Income is the pay for, or (`payDay` null) that it
 * is "Not a paycheck for a pay day"; either way the automatic rule never touches the line again.
 * Works on a bank line as on a typed one: only the month it counts in changes, never its date or
 * amount. Made on the version the Parent was looking at (ADR-0041), and refused like a change of
 * date: `extra-income` while Extra income already decided in the month it would leave needs it
 * (ADR-0052), `month-closed` when a month it would leave or join has been closed, `refused` when
 * the day is not a nearby pay day of the Parent whose pay it is, or is another line's already.
 */
export async function setPayDayByHand(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: { incomeId: string; payDay: DayKey | null; expectedVersion?: number },
): Promise<MoneyInKindResult> {
	const { householdId } = viewer;
	const before = await loadMoneyInLine(db, householdId, input.incomeId);
	if (before?.kind !== "income" || before.needsReview) return { ok: false, reason: "refused" };
	const month = monthOfDay(countsOn(before));
	const toMonth = monthOfDay(input.payDay ?? before.date);
	const months = [...new Set([month, toMonth, monthOfDay(before.date)])];
	const same = before.payDayByHand && before.payDay === input.payDay;
	if (input.expectedVersion !== undefined && before.version !== input.expectedVersion) {
		// A retry of this change after it landed is still this change.
		if (same && before.version === input.expectedVersion + 1)
			return { ok: true, line: before, months };
		return { ok: false, reason: "changed-elsewhere", current: before };
	}
	if (same) return { ok: true, line: before, months };
	const whosePay = before.whosePay;
	if (input.payDay !== null) {
		const choices = await loadPayDayChoices(db, householdId, before);
		if (!whosePay || !choices.some((choice) => choice.day === input.payDay && !choice.taken))
			return { ok: false, reason: "refused" };
	}
	const moves = month !== toMonth;
	const next = before.version + 1;
	await db
		.update(income)
		.set({ payDay: input.payDay, payDayByHand: true, version: sql`${income.version} + 1` })
		.where(
			and(
				eq(income.id, input.incomeId),
				eq(income.householdId, householdId),
				eq(income.version, before.version),
				incomeCounts(),
				input.payDay !== null && whosePay
					? payDayFree(householdId, whosePay, input.payDay)
					: undefined,
				// The guards are part of the write, so the other Parent can't slip between.
				moves ? notClosed(householdId, [month, toMonth]) : undefined,
				moves ? stillCovered(householdId, month) : undefined,
			),
		);
	const after = await loadMoneyInLine(db, householdId, input.incomeId);
	if (!after) return { ok: false, reason: "refused" };
	if (after.version === next) return { ok: true, line: after, months };
	if (after.version !== before.version)
		return { ok: false, reason: "changed-elsewhere", current: after };
	if (moves && (await closedAmong(db, householdId, [month, toMonth])).length > 0)
		return { ok: false, reason: "month-closed" };
	return { ok: false, reason: moves ? "extra-income" : "refused" };
}
