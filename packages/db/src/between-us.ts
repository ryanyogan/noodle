import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { monthOfDay } from "@noodle/domain";
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { incomeCounts } from "./counting";
import { decidedSql, extraIncomeSql } from "./extra-income";
import type { Db } from "./index";
import { income, transfers } from "./schema";
import { transferRow } from "./transfers";

// Money between the two Parents (ADR-0052): one Parent sent the other money, and only the side
// that arrived is in Noodle. A Parent marks that income as "Between us": a Transfer with only its
// income side, so it is neither Income nor Extra income (incomeCounts) and nothing is spent.
// Money out to the other Parent is markTransfer with the same reason. Nothing marks either on
// its own. Every query is scoped by household_id.

/** Income a Parent marked as between the two of them, with the Transfer that says so. */
export type BetweenUsIncome = {
	id: string;
	amount: Cents;
	date: DayKey;
	note: string | null;
	transferId: string;
};

export type IncomeTransferResult =
	| { ok: true; months: string[] }
	/** `extra-income`: its month's Extra income already went somewhere and needs this income. */
	| { ok: false; reason: "refused" | "extra-income" };

/**
 * A Parent marks income as money from the other Parent: it stops counting as Income. Refused, as
 * removing it would be, while what's already been decided of its month's Extra income would no
 * longer be covered without it; and when it's already a side of a Transfer. Idempotent per
 * `transferId`.
 */
export async function markIncomeTransfer(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: { transferId: string; incomeId: string },
): Promise<IncomeTransferResult> {
	const { householdId } = viewer;
	const own = and(eq(income.id, input.incomeId), eq(income.householdId, householdId));
	const [row] = await db
		.select({
			date: income.date,
			counts: sql<boolean>`${incomeCounts()}`.mapWith(Boolean),
		})
		.from(income)
		.where(own);
	if (!row) return { ok: false, reason: "refused" };
	// Dates are always written as DayKeys.
	const month = monthOfDay(row.date as DayKey);
	await db
		.insert(transfers)
		.select(
			db
				.select(
					transferRow({
						id: input.transferId,
						householdId,
						outId: null,
						inTransactionId: null,
						inIncomeId: input.incomeId,
						createdBy: viewer.memberId,
						reason: "between-us",
					}),
				)
				.from(income)
				.where(
					and(
						own,
						incomeCounts(),
						sql`${extraIncomeSql(householdId, month, sql.raw("income.amount_cents"))} >= ${decidedSql(householdId, month)}`,
					),
				),
		)
		.onConflictDoNothing();
	const [marked] = await db
		.select({ id: transfers.id })
		.from(transfers)
		.where(
			and(
				eq(transfers.id, input.transferId),
				eq(transfers.householdId, householdId),
				eq(transfers.inIncomeId, input.incomeId),
				isNull(transfers.removedAt),
			),
		);
	if (marked) return { ok: true, months: [month] };
	return { ok: false, reason: row.counts ? "extra-income" : "refused" };
}

/**
 * Income marked as between the two Parents, received in months from `from` up to, not including,
 * `until`, oldest first: listed beside the month's Income, outside its total.
 */
export async function loadBetweenUsIncome(
	db: Db,
	householdId: string,
	from: MonthKey,
	until: MonthKey,
): Promise<BetweenUsIncome[]> {
	const rows = await db
		.select({
			id: income.id,
			amount: income.amountCents,
			date: income.date,
			note: income.note,
			transferId: transfers.id,
		})
		.from(transfers)
		.innerJoin(income, eq(income.id, transfers.inIncomeId))
		.where(
			and(
				eq(transfers.householdId, householdId),
				eq(income.householdId, householdId),
				isNull(transfers.removedAt),
				eq(transfers.reason, "between-us"),
				gte(income.date, `${from}-01`),
				lt(income.date, `${until}-01`),
			),
		)
		.orderBy(income.date, income.id);
	// Dates are always written as DayKeys.
	return rows as BetweenUsIncome[];
}
