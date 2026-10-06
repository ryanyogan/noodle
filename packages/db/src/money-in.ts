import {
	type Cents,
	type DayKey,
	type MoneyInKind,
	type MoneyInRule,
	merchantKey,
	moneyInKindOf,
	monthOfDay,
} from "@noodle/domain";
import { and, eq, gte, isNull, lt, ne, type SQL, sql } from "drizzle-orm";
import { incomeCounts } from "./counting";
import { decidedSql, extraIncomeSql } from "./extra-income";
import type { Db } from "./index";
import { income, moneyInRules, transfers } from "./schema";
import { transferRow } from "./transfers";

// Money in has a kind (ADR-0057): Income, a Refund, Paid back, a Transfer or Between us. Money in
// is a row in `income` whatever its kind; only Income counts (incomeCounts in counting.ts). The
// kind is read from what is already kept: a Transfer the row is the arriving side of (Between us
// when that Transfer says so), else `income.kind` (Refund, Paid back), else Income. A line with
// person-to-person wording waits in Review (`needs_review`) and counts nowhere until a Parent says
// what it is. Income is the Household's, never private. Every query is scoped by household_id.

/** A money-in line with its kind. */
export type MoneyInLine = {
	id: string;
	amount: Cents;
	date: DayKey;
	note: string | null;
	kind: MoneyInKind;
	/** Waiting in Review for a Parent to say its kind; `kind` is then only what it would be. */
	needsReview: boolean;
	/** Goes up with every change of kind (ADR-0041). */
	version: number;
	/** The Account it came into; null when a Parent typed it in. */
	accountId: string | null;
	/** A Parent typed it in, so its amount and date may be changed. */
	typed: boolean;
	/** The Transfer that makes it a Transfer or Between us. */
	transferId: string | null;
};

export type MoneyInFilter = {
	/** From this day. */
	from?: DayKey;
	/** Up to, not including, this day. */
	until?: DayKey;
	/** Only the lines waiting in Review. */
	review?: boolean;
	id?: string;
};

/** Money-in lines of every kind, newest first. */
export async function loadMoneyIn(
	db: Db,
	householdId: string,
	filter: MoneyInFilter = {},
): Promise<MoneyInLine[]> {
	const rows = await db
		.select({
			id: income.id,
			amount: income.amountCents,
			date: income.date,
			note: income.note,
			stored: income.kind,
			needsReview: income.needsReview,
			version: income.version,
			accountId: income.accountId,
			createdBy: income.createdByMemberId,
			transferId: transfers.id,
			reason: transfers.reason,
		})
		.from(income)
		.leftJoin(transfers, and(eq(transfers.inIncomeId, income.id), isNull(transfers.removedAt)))
		.where(
			and(
				eq(income.householdId, householdId),
				filter.id ? eq(income.id, filter.id) : undefined,
				filter.from ? gte(income.date, filter.from) : undefined,
				filter.until ? lt(income.date, filter.until) : undefined,
				filter.review
					? and(eq(income.needsReview, true), isNull(transfers.id), isNull(income.kind))
					: undefined,
			),
		)
		.orderBy(sql`${income.date} desc`, sql`${income.id} desc`);
	return rows.map((row) => ({
		id: row.id,
		amount: row.amount as Cents,
		// Dates are always written as DayKeys.
		date: row.date as DayKey,
		note: row.note,
		kind: moneyInKindOf({
			stored: row.stored,
			transfer: row.transferId ? { reason: row.reason } : null,
		}),
		needsReview: row.needsReview && !row.transferId && !row.stored,
		version: row.version,
		accountId: row.accountId,
		typed: row.createdBy !== null && row.accountId === null,
		transferId: row.transferId,
	}));
}

/** What kind one money-in line is, with the line; null when it isn't the Household's. */
export async function loadMoneyInLine(
	db: Db,
	householdId: string,
	incomeId: string,
): Promise<MoneyInLine | null> {
	return (await loadMoneyIn(db, householdId, { id: incomeId }))[0] ?? null;
}

/** The money-in lines waiting in Review, newest first. */
export const loadMoneyInReview = (db: Db, householdId: string) =>
	loadMoneyIn(db, householdId, { review: true });

export type MoneyInKindResult =
	| { ok: true; line: MoneyInLine; months: string[] }
	/**
	 * `extra-income`: its month's Extra income already went somewhere and needs this Income
	 * (ADR-0052); `changed-elsewhere`: it was changed on another screen, `current` is how it is now.
	 */
	| { ok: false; reason: "refused" | "extra-income" }
	| { ok: false; reason: "changed-elsewhere"; current: MoneyInLine };

/**
 * A Parent says what kind a money-in line is; saying it for a line waiting in Review takes it out
 * of Review. A change away from Income is refused while what's already been decided of its
 * month's Extra income would no longer be covered without it (ADR-0052). `expectedVersion` is the
 * version the Parent was looking at (ADR-0041); without it the change is made on the line as it
 * is. `transferId` is the Transfer written when the kind is Transfer or Between us; a Transfer it
 * was a side of before is unmarked. Saying the kind it already has changes nothing.
 */
export async function changeMoneyInKind(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: { incomeId: string; kind: MoneyInKind; transferId: string; expectedVersion?: number },
): Promise<MoneyInKindResult> {
	const { householdId } = viewer;
	const before = await loadMoneyInLine(db, householdId, input.incomeId);
	if (!before) return { ok: false, reason: "refused" };
	const month = monthOfDay(before.date);
	const settled = before.kind === input.kind && !before.needsReview;
	if (input.expectedVersion !== undefined && before.version !== input.expectedVersion) {
		// A retry of this change after it landed is still this change.
		if (settled && before.version === input.expectedVersion + 1)
			return { ok: true, line: before, months: [month] };
		return { ok: false, reason: "changed-elsewhere", current: before };
	}
	if (settled) return { ok: true, line: before, months: [month] };

	const own = and(eq(income.id, input.incomeId), eq(income.householdId, householdId)) as SQL;
	const next = before.version + 1;
	const landed = sql`exists (select 1 from income n where n.id = ${input.incomeId}
		and n.household_id = ${householdId} and n.version = ${next})`;
	// The guard is part of the write, so the other Parent deciding Extra income can't slip between.
	const covered =
		input.kind === "income"
			? undefined
			: sql`(not ${incomeCounts()} or ${extraIncomeSql(householdId, month, sql.raw("income.amount_cents"))} >= ${decidedSql(householdId, month)})`;
	const toTransfer = input.kind === "transfer" || input.kind === "between-us";
	await db.batch([
		db
			.update(income)
			.set({
				kind: input.kind === "refund" || input.kind === "paid-back" ? input.kind : null,
				needsReview: false,
				version: sql`${income.version} + 1`,
			})
			.where(and(own, eq(income.version, before.version), covered)),
		db
			.update(transfers)
			.set({ removedAt: sql`(unixepoch() * 1000)`, removedByMemberId: viewer.memberId })
			.where(
				and(
					eq(transfers.householdId, householdId),
					eq(transfers.inIncomeId, input.incomeId),
					isNull(transfers.removedAt),
					ne(transfers.id, input.transferId),
					landed,
				),
			),
		...(toTransfer
			? [
					db
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
										reason: input.kind === "between-us" ? "between-us" : null,
									}),
								)
								.from(income)
								.where(and(own, eq(income.version, next))),
						)
						.onConflictDoNothing(),
				]
			: []),
	]);
	const after = await loadMoneyInLine(db, householdId, input.incomeId);
	if (!after) return { ok: false, reason: "refused" };
	if (after.version === next && after.kind === input.kind)
		return { ok: true, line: after, months: [month] };
	if (after.version !== before.version)
		return { ok: false, reason: "changed-elsewhere", current: after };
	return { ok: false, reason: "extra-income" };
}

/** A Rule for money in, as kept. */
export type StoredMoneyInRule = MoneyInRule & { id: string };

/** The Household's Rules for money in. */
export async function loadMoneyInRules(db: Db, householdId: string): Promise<StoredMoneyInRule[]> {
	return db
		.select({ id: moneyInRules.id, pattern: moneyInRules.pattern, kind: moneyInRules.kind })
		.from(moneyInRules)
		.where(eq(moneyInRules.householdId, householdId))
		.orderBy(moneyInRules.pattern);
}

/**
 * A Parent states that money in with this wording is always one kind: `wording` is a bank's line
 * (or a pattern already), kept as its merchantKey. One Rule per wording: stating it again changes
 * its kind. Returns the pattern kept, or null when the wording says nothing.
 */
export async function saveMoneyInRule(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: { ruleId: string; wording: string; kind: MoneyInKind },
): Promise<string | null> {
	const pattern = input.wording.trim() ? merchantKey(input.wording) : "";
	if (!pattern) return null;
	await db
		.insert(moneyInRules)
		.values({
			id: input.ruleId,
			householdId: viewer.householdId,
			pattern,
			kind: input.kind,
			createdByMemberId: viewer.memberId,
		})
		.onConflictDoUpdate({
			target: [moneyInRules.householdId, moneyInRules.pattern],
			set: { kind: input.kind },
		});
	return pattern;
}

/** Removes a Rule for money in; lines it already decided stay as they are. */
export async function deleteMoneyInRule(db: Db, householdId: string, ruleId: string) {
	await db
		.delete(moneyInRules)
		.where(and(eq(moneyInRules.id, ruleId), eq(moneyInRules.householdId, householdId)));
}

/**
 * After an Import: money in that a Rule says is a Transfer or Between us, and that paired with
 * nothing, is marked alone. Never a line that was in a Transfer before (an unmarked one is not
 * marked again), so running it twice changes nothing.
 */
export async function markMoneyInByRule(
	db: Db,
	householdId: string,
	lines: { id: string; kind: MoneyInKind }[],
	newId: () => string,
): Promise<void> {
	const marks = lines
		.filter((line) => line.kind === "transfer" || line.kind === "between-us")
		.map((line) => ({ id: newId(), incomeId: line.id, reason: line.kind }));
	if (marks.length === 0) return;
	const field = (name: string) => sql`json_extract(value, ${`$.${name}`})`;
	await db
		.insert(transfers)
		.select(
			db
				.select(
					transferRow({
						id: field("id"),
						householdId,
						outId: null,
						inTransactionId: null,
						inIncomeId: field("incomeId"),
						createdBy: null,
						reasonSql: sql`case when ${field("reason")} = 'between-us' then 'between-us' end`,
					}),
				)
				.from(sql`json_each(${JSON.stringify(marks)})`)
				.where(
					sql`exists (select 1 from income i where i.id = ${field("incomeId")}
						and i.household_id = ${householdId} and i.kind is null)
					and not exists (select 1 from transfers x where x.in_income_id = ${field("incomeId")})`,
				),
		)
		.onConflictDoNothing();
}
