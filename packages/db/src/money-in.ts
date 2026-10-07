import {
	type Cents,
	type DayKey,
	type MoneyInKind,
	type MoneyInRule,
	merchantKey,
	moneyInKindOf,
	moneyInRuleFor,
	monthOfDay,
} from "@noodle/domain";
import { type AnyColumn, and, eq, gte, isNull, lt, ne, type SQL, sql } from "drizzle-orm";
import { incomeCounts } from "./counting";
import { endedBefore, lineEndedRestores } from "./ended-months";
import { decidedSql, extraIncomeSql } from "./extra-income";
import type { Db } from "./index";
import {
	moneyInPairRemovedEvents,
	moneyInRulePairForgottenEvents,
	moneyInRuleRemovedEvents,
} from "./log-events";
import {
	accounts,
	income,
	members,
	moneyInPairs,
	moneyInRules,
	paidBackMatches,
	refundLinks,
	transactions,
	transfers,
} from "./schema";
import { transferable, transferRow } from "./transfers";

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
	/** That Transfer has its other side in Noodle (money out of another Account). */
	paired: boolean;
	/** The Account a one-sided Transfer says it came from, once a Parent named it. */
	otherAccountId: string | null;
	/** Whose pay it is: a Parent's ID, or null for the Household. */
	whosePay: string | null;
	/**
	 * The day the bank took it back, or changed it, after money back through it had counted in a
	 * month that has ended: it is kept as it was so that month doesn't change (issue 141).
	 */
	bankTookBackOn: DayKey | null;
	/** What the bank says it is now, when it only changed the amount; null when it took it back. */
	bankAmount: Cents | null;
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
			whosePay: income.payMemberId,
			bankTookBackOn: income.bankTookBackOn,
			bankAmount: income.bankAmountCents,
			transferId: transfers.id,
			reason: transfers.reason,
			outId: transfers.outTransactionId,
			otherAccountId: transfers.otherAccountId,
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
		paired: row.outId !== null,
		otherAccountId: row.otherAccountId,
		whosePay: row.whosePay,
		bankTookBackOn: row.bankTookBackOn as DayKey | null,
		bankAmount: row.bankAmount as Cents | null,
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
	 * (ADR-0052); `changed-elsewhere`: it was changed on another screen, `current` is how it is now;
	 * `month-ended`: what it Paid back, or the purchase it is a Refund for, got the money in a month
	 * that has ended, which never changes (ADR-0058); `matched`: the new amount is less than what
	 * the line has already settled.
	 */
	/** `over-purchase`: a linked Refund raised above what its purchase cost. */
	| {
			ok: false;
			reason: "refused" | "extra-income" | "month-ended" | "matched" | "over-purchase";
	  }
	| { ok: false; reason: "changed-elsewhere"; current: MoneyInLine };

/**
 * A Parent says what kind a money-in line is; saying it for a line waiting in Review takes it out
 * of Review. A change away from Income is refused while what's already been decided of its
 * month's Extra income would no longer be covered without it (ADR-0052). `expectedVersion` is the
 * version the Parent was looking at (ADR-0041); without it the change is made on the line as it
 * is. `transferId` is the Transfer written when the kind is Transfer or Between us; a Transfer it
 * was a side of before is unmarked. Saying the kind it already has changes nothing, except that
 * a line nobody had touched is from then on one a Parent decided (`decide`). Refused
 * (`month-ended`) once what the line restored counted in a month that has ended as of `today`.
 */
export async function changeMoneyInKind(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: {
		incomeId: string;
		kind: MoneyInKind;
		transferId: string;
		expectedVersion?: number;
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	},
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
	const own = and(eq(income.id, input.incomeId), eq(income.householdId, householdId)) as SQL;
	if (settled) return { ok: true, line: await decide(db, householdId, before), months: [month] };

	// Its matches, or its link to a purchase, would go with the kind: never from an ended month.
	const ended = lineEndedRestores(income.id, endedBefore(input.today));
	const frozen = async () =>
		(await db.select({ id: income.id }).from(income).where(and(own, ended))).length > 0;
	if (await frozen()) return { ok: false, reason: "month-ended" };
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
			.where(and(own, eq(income.version, before.version), covered, sql`not ${ended}`)),
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
		// A line that stops being Paid back settles nothing any more (ADR-0058).
		...(input.kind === "paid-back"
			? []
			: [
					db
						.delete(paidBackMatches)
						.where(
							and(
								eq(paidBackMatches.householdId, householdId),
								eq(paidBackMatches.incomeId, input.incomeId),
								landed,
							),
						),
				]),
		// A line that stops being a Refund is money back for no purchase any more.
		...(input.kind === "refund"
			? []
			: [
					db
						.delete(refundLinks)
						.where(
							and(
								eq(refundLinks.householdId, householdId),
								eq(refundLinks.incomeId, input.incomeId),
								landed,
							),
						),
				]),
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
	return { ok: false, reason: (await frozen()) ? "month-ended" : "extra-income" };
}

/**
 * A Parent looked at a line and left it as it is (confirmed it is Income, or said whose pay it
 * already was): from then on it is one a Parent decided, which its version says (ADR-0041), so
 * the one-time October pass leaves it alone (money-in-pass.ts). Only a line nobody had touched
 * moves on, once; a repeat changes nothing.
 */
async function decide(db: Db, householdId: string, line: MoneyInLine): Promise<MoneyInLine> {
	if (line.version !== 0) return line;
	await db
		.update(income)
		.set({ version: 1 })
		.where(and(eq(income.id, line.id), eq(income.householdId, householdId), eq(income.version, 0)));
	return (await loadMoneyInLine(db, householdId, line.id)) ?? line;
}

/** What a Parent may change on a money-in line besides its kind. Only what is given changes. */
export type MoneyInEdit = {
	/** A Parent's ID, or null for the Household. */
	whosePay?: string | null;
	note?: string | null;
	/** Only on money in a Parent typed in. */
	amountCents?: Cents;
	/** Only on money in a Parent typed in. */
	date?: DayKey;
};

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

/**
 * A Parent changes whose pay a money-in line is, its note, or, on a line they typed in, its
 * amount or date (issue 133). Made on the version the Parent was looking at (`expectedVersion`,
 * ADR-0041): a repeat of a change that landed is answered as saved, one made on a line that has
 * moved on is left alone. Refused (`extra-income`) while Extra income already decided in its
 * month would no longer be covered by the lower amount or without the line (ADR-0052's guard),
 * and (`matched`) when the new amount is less than what the line has already Paid back on
 * purchases. Saving it with nothing changed makes an untouched line one a Parent decided.
 */
export async function editMoneyIn(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: {
		incomeId: string;
		expectedVersion?: number;
		edit: MoneyInEdit;
		/** The Household's day; UTC's when left out. */
		today?: DayKey;
	},
): Promise<MoneyInKindResult> {
	const { householdId } = viewer;
	const before = await loadMoneyInLine(db, householdId, input.incomeId);
	if (!before) return { ok: false, reason: "refused" };
	const edit = { ...input.edit };
	if (edit.note !== undefined) edit.note = edit.note?.trim() || null;
	const month = monthOfDay(before.date);
	const toMonth = edit.date === undefined ? month : monthOfDay(edit.date);
	const months = month === toMonth ? [month] : [month, toMonth];
	const same =
		(edit.whosePay === undefined || edit.whosePay === before.whosePay) &&
		(edit.note === undefined || edit.note === before.note) &&
		(edit.amountCents === undefined || edit.amountCents === before.amount) &&
		(edit.date === undefined || edit.date === before.date);
	if (input.expectedVersion !== undefined && before.version !== input.expectedVersion) {
		// A retry of this change after it landed is still this change.
		if (same && before.version === input.expectedVersion + 1)
			return { ok: true, line: before, months };
		return { ok: false, reason: "changed-elsewhere", current: before };
	}
	if (same) return { ok: true, line: await decide(db, householdId, before), months };
	const typedOnly =
		(edit.amountCents !== undefined && edit.amountCents !== before.amount) ||
		(edit.date !== undefined && edit.date !== before.date);
	if (typedOnly && !before.typed) return { ok: false, reason: "refused" };
	if (
		edit.amountCents !== undefined &&
		!(Number.isInteger(edit.amountCents) && edit.amountCents > 0)
	)
		return { ok: false, reason: "refused" };
	if (edit.whosePay && !(await isParent(db, householdId, edit.whosePay)))
		return { ok: false, reason: "refused" };

	// It never restores more than it is: a lower amount stops at what it has settled already.
	const matchedSql = sql<number>`(select coalesce(sum(pm.amount_cents), 0) from paid_back_matches pm
		where pm.income_id = ${input.incomeId} and pm.household_id = ${householdId})`;
	const lower = edit.amountCents !== undefined && edit.amountCents < before.amount;
	const overMatched = async () => {
		if (!lower) return false;
		const [row] = await db
			.select({ matched: matchedSql.as("matched") })
			.from(income)
			.where(and(eq(income.id, input.incomeId), eq(income.householdId, householdId)));
		return (row?.matched ?? 0) > (edit.amountCents as number);
	};
	if (await overMatched()) return { ok: false, reason: "matched" };

	// A Refund linked to its purchase gives that purchase all of itself back: never more than the
	// purchase cost, and nothing of it changes once it counted in a month that has ended.
	if (edit.amountCents !== undefined && edit.amountCents !== before.amount) {
		const [link] = await db
			.select({
				countsOn: refundLinks.countsOn,
				cost: transactions.amountCents,
				others: sql<number>`(select coalesce(sum(oi.amount_cents), 0) from refund_links ol
					join income oi on oi.id = ol.income_id
					where ol.transaction_id = ${transactions.id} and ol.income_id <> ${input.incomeId})`.as(
					"others",
				),
			})
			.from(refundLinks)
			.innerJoin(transactions, eq(transactions.id, refundLinks.transactionId))
			.where(
				and(eq(refundLinks.incomeId, input.incomeId), eq(refundLinks.householdId, householdId)),
			);
		if (link && link.countsOn < endedBefore(input.today))
			return { ok: false, reason: "month-ended" };
		if (link && edit.amountCents > link.cost - link.others)
			return { ok: false, reason: "over-purchase" };
	}

	// What its month's Income loses by this: all of it when it leaves the month.
	const less =
		toMonth !== month ? before.amount : before.amount - (edit.amountCents ?? before.amount);
	const covered =
		less > 0
			? sql`(not ${incomeCounts()} or ${extraIncomeSql(householdId, month, less as Cents)} >= ${decidedSql(householdId, month)})`
			: undefined;
	const next = before.version + 1;
	await db
		.update(income)
		.set({
			...(edit.whosePay !== undefined ? { payMemberId: edit.whosePay } : {}),
			...(edit.note !== undefined ? { note: edit.note } : {}),
			...(edit.amountCents !== undefined ? { amountCents: edit.amountCents } : {}),
			...(edit.date !== undefined ? { date: edit.date } : {}),
			version: sql`${income.version} + 1`,
		})
		.where(
			and(
				eq(income.id, input.incomeId),
				eq(income.householdId, householdId),
				eq(income.version, before.version),
				covered,
				lower ? sql`${edit.amountCents} >= ${matchedSql}` : undefined,
			),
		);
	const after = await loadMoneyInLine(db, householdId, input.incomeId);
	if (!after) return { ok: false, reason: "refused" };
	if (after.version === next) return { ok: true, line: after, months };
	if (after.version !== before.version)
		return { ok: false, reason: "changed-elsewhere", current: after };
	return { ok: false, reason: (await overMatched()) ? "matched" : "extra-income" };
}

/**
 * "Always treat deposits from <name> as <Parent>'s pay": a Rule that money in with this wording
 * is Income and that Parent's (null: the Household's), which Imports follow from now on. The
 * deposits already here with that wording that are still the Household's become theirs too, so
 * the Parent's range has its months; one a Parent already gave to somebody is left alone.
 * Returns the pattern kept and how many lines changed, or null when the wording says nothing.
 */
export async function stateWhosePay(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: { ruleId: string; wording: string; payMemberId: string | null },
): Promise<{ pattern: string; changed: number } | null> {
	const { householdId } = viewer;
	if (input.payMemberId && !(await isParent(db, householdId, input.payMemberId))) return null;
	const pattern = await saveMoneyInRule(db, viewer, {
		ruleId: input.ruleId,
		wording: input.wording,
		kind: "income",
		payMemberId: input.payMemberId,
	});
	if (!pattern) return null;
	if (!input.payMemberId) return { pattern, changed: 0 };
	const open = await db
		.select({ id: income.id, note: income.note })
		.from(income)
		.where(
			and(eq(income.householdId, householdId), isNull(income.payMemberId), isNull(income.kind)),
		);
	const rule = [{ pattern, kind: "income" as const }];
	const ids = open.filter((row) => moneyInRuleFor(rule, row.note)).map((row) => row.id);
	if (ids.length === 0) return { pattern, changed: 0 };
	// One parameter for all of them: D1 caps a statement's bound parameters.
	await db
		.update(income)
		.set({ payMemberId: input.payMemberId, version: sql`${income.version} + 1` })
		.where(
			and(
				eq(income.householdId, householdId),
				isNull(income.payMemberId),
				sql`${income.id} in (select value from json_each(${JSON.stringify(ids)}))`,
			),
		);
	return { pattern, changed: ids.length };
}

/** A Rule for money in, as kept. */
export type StoredMoneyInRule = MoneyInRule & {
	id: string;
	/** For Income: the Parent whose pay it is; null for the Household. */
	payMemberId: string | null;
	/** A remembered pair of Accounts: only money into this Account, which came from the other. */
	intoAccountId: string | null;
	otherAccountId: string | null;
	intoAccountName: string | null;
	otherAccountName: string | null;
};

const accountName = (id: AnyColumn) =>
	sql<string | null>`(select a.name from accounts a where a.id = ${id})`;

/**
 * The Household's Rules for money in: one plain Rule a wording, and every remembered pair of
 * Accounts (one a wording and Account it arrives in, issue 141). A pair remembered before pairs
 * had their own table is still read from `money_in_rules`, unless one for the same wording and
 * Account has been remembered since.
 */
export async function loadMoneyInRules(db: Db, householdId: string): Promise<StoredMoneyInRule[]> {
	const [kept, pairs] = await db.batch([
		db
			.select({
				id: moneyInRules.id,
				pattern: moneyInRules.pattern,
				kind: moneyInRules.kind,
				intoAccountId: moneyInRules.intoAccountId,
				otherAccountId: moneyInRules.otherAccountId,
				intoAccountName: accountName(moneyInRules.intoAccountId),
				otherAccountName: accountName(moneyInRules.otherAccountId),
				payMemberId: moneyInRules.payMemberId,
			})
			.from(moneyInRules)
			.where(eq(moneyInRules.householdId, householdId)),
		db
			.select({
				id: moneyInPairs.id,
				pattern: moneyInPairs.pattern,
				intoAccountId: moneyInPairs.intoAccountId,
				otherAccountId: moneyInPairs.otherAccountId,
				intoAccountName: accountName(moneyInPairs.intoAccountId),
				otherAccountName: accountName(moneyInPairs.otherAccountId),
			})
			.from(moneyInPairs)
			.where(eq(moneyInPairs.householdId, householdId)),
	]);
	const paired = new Set(pairs.map((pair) => `${pair.pattern}\t${pair.intoAccountId}`));
	return [
		...kept.filter((rule) => !paired.has(`${rule.pattern}\t${rule.intoAccountId}`)),
		...pairs.map((pair) => ({ ...pair, kind: "transfer" as const, payMemberId: null })),
	].sort(
		(a, b) =>
			a.pattern.localeCompare(b.pattern) ||
			(a.intoAccountName ?? "").localeCompare(b.intoAccountName ?? "") ||
			a.id.localeCompare(b.id),
	);
}

/**
 * A Parent states that money in with this wording is always one kind: `wording` is a bank's line
 * (or a pattern already), kept as its merchantKey. One Rule per wording: stating it again changes
 * its kind. Returns the pattern kept, or null when the wording says nothing.
 */
export async function saveMoneyInRule(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: {
		ruleId: string;
		wording: string;
		kind: MoneyInKind;
		/** Whose pay Income with this wording is; left out, a Rule already there keeps its own. */
		payMemberId?: string | null;
	},
): Promise<string | null> {
	// Only Income has whose pay.
	const pay = input.kind === "income" ? input.payMemberId : null;
	const pattern = input.wording.trim() ? merchantKey(input.wording) : "";
	if (!pattern) return null;
	const thePairs = and(
		eq(moneyInPairs.householdId, viewer.householdId),
		eq(moneyInPairs.pattern, pattern),
	) as SQL;
	await db.batch([
		// The Log's record of the pairs this forgets, from either home, before they go.
		...moneyInPairRemovedEvents(db, thePairs, viewer.memberId),
		...moneyInRulePairForgottenEvents(db, viewer.householdId, pattern, viewer.memberId),
		db
			.insert(moneyInRules)
			.values({
				id: input.ruleId,
				householdId: viewer.householdId,
				pattern,
				kind: input.kind,
				payMemberId: pay ?? null,
				createdByMemberId: viewer.memberId,
			})
			.onConflictDoUpdate({
				target: [moneyInRules.householdId, moneyInRules.pattern],
				// Stating it plainly again forgets a remembered pair of Accounts.
				set: {
					kind: input.kind,
					intoAccountId: null,
					otherAccountId: null,
					...(pay === undefined ? {} : { payMemberId: pay }),
				},
			}),
		// Every pair the wording had, whichever Account it was into.
		db.delete(moneyInPairs).where(thePairs),
	]);
	return pattern;
}

/** The Household's Accounts by name, to say which one money came from. */
export async function loadMoneyInAccounts(db: Db, householdId: string) {
	return db
		.select({ id: accounts.id, name: accounts.name })
		.from(accounts)
		.where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)))
		.orderBy(accounts.name);
}

export type AccountPairResult =
	| { ok: true; pattern: string; line: MoneyInLine }
	| { ok: false; reason: "refused" };

/**
 * A remembered pair of Accounts (ADR-0057): a Parent says the Transfer this money-in line is came
 * from another of the Household's Accounts, and that money worded like it into the same Account
 * always does. The line's one-sided Transfer names that Account, and the Rule is kept: from the
 * next Import such money in is a Transfer, paired with the money out when Noodle has it and
 * naming the other Account when it doesn't. Refused for a line that isn't a one-sided Transfer
 * into an Account, or has no wording to remember.
 */
export async function rememberAccountPair(
	db: Db,
	viewer: { householdId: string; memberId: string },
	input: { incomeId: string; otherAccountId: string; ruleId: string },
): Promise<AccountPairResult> {
	const { householdId } = viewer;
	const line = await loadMoneyInLine(db, householdId, input.incomeId);
	const pattern = line?.note?.trim() ? merchantKey(line.note) : "";
	if (
		line?.kind !== "transfer" ||
		!line.transferId ||
		line.paired ||
		!line.accountId ||
		line.accountId === input.otherAccountId ||
		!pattern
	)
		return { ok: false, reason: "refused" };
	const [other] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(and(eq(accounts.id, input.otherAccountId), eq(accounts.householdId, householdId)));
	if (!other) return { ok: false, reason: "refused" };
	const pair = {
		intoAccountId: line.accountId,
		otherAccountId: other.id,
	};
	await db.batch([
		db
			.update(transfers)
			.set({ otherAccountId: other.id })
			.where(
				and(
					eq(transfers.id, line.transferId),
					eq(transfers.householdId, householdId),
					isNull(transfers.removedAt),
					isNull(transfers.outTransactionId),
				),
			),
		// One pair a wording and Account it arrives in: the same wording into another Account
		// keeps its own (issue 141). Said again for the same Account, it names the new one.
		db
			.insert(moneyInPairs)
			.values({
				id: input.ruleId,
				householdId,
				pattern,
				createdByMemberId: viewer.memberId,
				...pair,
			})
			.onConflictDoUpdate({
				target: [moneyInPairs.householdId, moneyInPairs.pattern, moneyInPairs.intoAccountId],
				set: { otherAccountId: pair.otherAccountId },
			}),
		// A pair for this wording and Account kept the old way is this one now.
		db
			.delete(moneyInRules)
			.where(
				and(
					eq(moneyInRules.householdId, householdId),
					eq(moneyInRules.pattern, pattern),
					eq(moneyInRules.intoAccountId, pair.intoAccountId),
				),
			),
	]);
	const after = await loadMoneyInLine(db, householdId, input.incomeId);
	return after ? { ok: true, pattern, line: after } : { ok: false, reason: "refused" };
}

const neverInTransfer = sql`not exists (select 1 from transfers x where x.in_income_id = ${income.id})`;
const daysApart = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b));

/**
 * Money in from a remembered pair of Accounts is paired with the same amount going out of the
 * other Account, however many days apart (the nearest when there are several). What finds no
 * such money out is left for markMoneyInByRule, which marks it alone.
 */
async function pairWithOtherAccount(
	db: Db,
	householdId: string,
	lines: { id: string; otherAccountId: string }[],
	newId: () => string,
): Promise<void> {
	for (const line of lines) {
		const mine = and(eq(income.id, line.id), eq(income.householdId, householdId)) as SQL;
		const [arrived] = await db
			.select({ amount: income.amountCents, date: income.date })
			.from(income)
			.where(and(mine, isNull(income.kind), neverInTransfer));
		if (!arrived) continue;
		const outs = await db
			.select({ id: transactions.id, date: transactions.date })
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(transactions.accountId, line.otherAccountId),
					eq(transactions.amountCents, arrived.amount),
					transferable,
				),
			);
		const [out] = outs.sort(
			(a, b) => daysApart(a.date, arrived.date) - daysApart(b.date, arrived.date),
		);
		if (!out) continue;
		await db
			.insert(transfers)
			.select(
				db
					.select(
						transferRow({
							id: newId(),
							householdId,
							outId: out.id,
							inTransactionId: null,
							inIncomeId: line.id,
							createdBy: null,
						}),
					)
					.from(income)
					.where(and(mine, isNull(income.kind), neverInTransfer)),
			)
			// The money out was paired by someone else meanwhile: this line is marked alone.
			.onConflictDoNothing();
	}
}

/** How many lines marked alone one Import looks at for money out that has since come in. */
const JOIN_LIMIT = 200;

/**
 * The other order (issue 131): money in was marked alone as a Transfer naming another Account,
 * and that Account's money out is imported afterwards. Each such line takes the same amount
 * going out of the Account it names, the nearest in days first, and its one-sided Transfer
 * becomes the pair; the money out no longer waits in Review as spending. A line a Parent unmarked
 * has no Transfer and is left alone. Running it twice changes nothing.
 */
async function joinPairsLater(db: Db, householdId: string): Promise<void> {
	const alone = await db
		.select({
			id: transfers.id,
			otherAccountId: transfers.otherAccountId,
			amount: income.amountCents,
			date: income.date,
		})
		.from(transfers)
		.innerJoin(income, eq(income.id, transfers.inIncomeId))
		.where(
			and(
				eq(transfers.householdId, householdId),
				eq(income.householdId, householdId),
				isNull(transfers.removedAt),
				isNull(transfers.outTransactionId),
				isNull(transfers.reason),
				sql`${transfers.otherAccountId} is not null`,
			),
		)
		.orderBy(income.date, transfers.id)
		.limit(JOIN_LIMIT);
	const candidates: { markId: string; outId: string; apart: number; date: string }[] = [];
	for (const mark of alone) {
		if (!mark.otherAccountId) continue;
		const outs = await db
			.select({ id: transactions.id, date: transactions.date })
			.from(transactions)
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(transactions.accountId, mark.otherAccountId),
					eq(transactions.amountCents, mark.amount),
					transferable,
				),
			);
		for (const out of outs)
			candidates.push({
				markId: mark.id,
				outId: out.id,
				apart: daysApart(out.date, mark.date),
				date: mark.date,
			});
	}
	// The nearest in days pair first, so two lines of the same amount each take their own.
	candidates.sort(
		(a, b) => a.apart - b.apart || a.date.localeCompare(b.date) || a.outId.localeCompare(b.outId),
	);
	const joined = new Set<string>();
	for (const { markId, outId } of candidates) {
		if (joined.has(markId) || joined.has(outId)) continue;
		joined.add(markId).add(outId);
		await db
			.update(transfers)
			.set({ outTransactionId: outId })
			.where(
				and(
					eq(transfers.id, markId),
					eq(transfers.householdId, householdId),
					isNull(transfers.removedAt),
					isNull(transfers.outTransactionId),
					// The money out was paired by someone else meanwhile: this line stays alone.
					sql`not exists (select 1 from transfers x where x.out_transaction_id = ${outId}
						and x.removed_at is null)`,
				),
			);
	}
}

/** Removes a Rule for money in, or one remembered pair of Accounts; lines already decided stay. */
export async function deleteMoneyInRule(
	db: Db,
	householdId: string,
	ruleId: string,
	memberId?: string,
) {
	const thePair = and(
		eq(moneyInPairs.id, ruleId),
		eq(moneyInPairs.householdId, householdId),
	) as SQL;
	await db.batch([
		...moneyInRuleRemovedEvents(db, householdId, ruleId, memberId),
		...moneyInPairRemovedEvents(db, thePair, memberId),
		db
			.delete(moneyInRules)
			.where(and(eq(moneyInRules.id, ruleId), eq(moneyInRules.householdId, householdId))),
		db.delete(moneyInPairs).where(thePair),
	]);
}

/**
 * After an Import: money in that a Rule says is a Transfer or Between us, and that paired with
 * nothing, is marked alone. Never a line that was in a Transfer before (an unmarked one is not
 * marked again), so running it twice changes nothing. A remembered pair of Accounts first looks
 * for its money out in the other Account, and names that Account when it marks the line alone.
 * Every Import, whatever it brought, also joins money out that has come in since to the lines
 * that were marked alone naming its Account (joinPairsLater).
 */
export async function markMoneyInByRule(
	db: Db,
	householdId: string,
	lines: { id: string; kind: MoneyInKind; otherAccountId?: string | null }[],
	newId: () => string,
): Promise<void> {
	const ruled = lines.filter((line) => line.kind === "transfer" || line.kind === "between-us");
	if (ruled.length === 0) return joinPairsLater(db, householdId);
	await pairWithOtherAccount(
		db,
		householdId,
		ruled.flatMap((line) =>
			line.kind === "transfer" && line.otherAccountId
				? [{ id: line.id, otherAccountId: line.otherAccountId }]
				: [],
		),
		newId,
	);
	const marks = ruled.map((line) => ({
		id: newId(),
		incomeId: line.id,
		reason: line.kind,
		other: line.kind === "transfer" ? (line.otherAccountId ?? null) : null,
	}));
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
						otherAccountId: sql`(select a.id from accounts a where a.id = ${field("other")}
							and a.household_id = ${householdId})`,
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
	await joinPairsLater(db, householdId);
}
