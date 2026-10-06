import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { monthOfDay } from "@noodle/domain";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import type { Db } from "./index";
import { changeMoneyInKind, loadMoneyInLine } from "./money-in";
import { income, transfers } from "./schema";

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
	// One way to change the kind of money in (money-in.ts): it carries the guard, and takes a line
	// out of Review. Money that is already a side of a Transfer is left alone, as it always was.
	const line = await loadMoneyInLine(db, viewer.householdId, input.incomeId);
	if (!line || line.transferId) {
		return line?.transferId === input.transferId && line.kind === "between-us"
			? { ok: true, months: [monthOfDay(line.date)] }
			: { ok: false, reason: "refused" };
	}
	const result = await changeMoneyInKind(db, viewer, { ...input, kind: "between-us" });
	if (result.ok) return { ok: true, months: result.months };
	return { ok: false, reason: result.reason === "extra-income" ? "extra-income" : "refused" };
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
