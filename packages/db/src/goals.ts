import {
	type AccountKind,
	type AccountWithdrawal,
	type BalanceUpdate,
	type Cents,
	type DayKey,
	type GoalFunding,
	type GoalKind,
	holdsMoney,
	type MonthKey,
	monthOfDay,
	type SetAsideChange,
} from "@noodle/domain";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	notExists,
	type SQL,
	sql,
} from "drizzle-orm";
import { counts, countsRaw } from "./counting";
import type { Db } from "./index";
import { freeToSpendSql } from "./moves";
import { type Author, logChange } from "./plan-log";
import { partlyPrivate, type Viewer, visibleSplit, visibleTo } from "./privacy";
import {
	accountBalances,
	accounts,
	buckets,
	earmarkClaims,
	goals,
	households,
	moves,
	splits,
	transactions,
} from "./schema";

// Accounts, Goals, and what their Goals have set aside (ADR-0002). Money set aside is never stored: it is derived from
// appended claims, Goal funding Moves, and Transactions (or Splits) assigned to the Goal
// (ADR-0004). Every query is scoped by household_id; IDs from the client are only ever used
// together with it.

export type GoalWriteResult = { ok: true } | { ok: false; reason: "refused" };

const ownAccount = (householdId: string, accountId: string) =>
	and(eq(accounts.id, accountId), eq(accounts.householdId, householdId));

const ownGoal = (householdId: string, goalId: string) =>
	and(eq(goals.id, goalId), eq(goals.householdId, householdId));

const now = sql<Date>`(unixepoch() * 1000)`;

/**
 * Now, to the millisecond. An Account's balance is its latest entered balance less the Goal
 * spending recorded after it, so those two are ordered by more than the second.
 */
const nowMs = sql<Date>`cast(unixepoch('subsec') * 1000 as integer)`;

/**
 * A Goal's set-aside money, computed from the rows inside the write that depends on it, so a concurrent
 * write by the other Parent can't make it wrong: its claims, plus its Goal funding, less the
 * Transactions and Splits spent from it. Mirrors setAsideOf in @noodle/domain (goals.test.ts holds
 * it to it).
 */
export function setAsideSql(householdId: string, goalId: string | SQL): SQL {
	return sql`(coalesce((select sum(c.amount_cents) from earmark_claims c
			where c.household_id = ${householdId} and c.goal_id = ${goalId}), 0)
		+ coalesce((select sum(m.amount_cents) from moves m
			where m.household_id = ${householdId} and m.to_goal_id = ${goalId}), 0)
		- coalesce((select sum(t.amount_cents) from transactions t
			where t.household_id = ${householdId} and t.goal_id = ${goalId} and ${sql.raw(countsRaw("t.id"))}), 0)
		- coalesce((select sum(s.amount_cents) from splits s
			where s.household_id = ${householdId} and s.goal_id = ${goalId}
			and ${sql.raw(countsRaw("s.transaction_id"))}), 0))`;
}

/** Appends a balance for one of the Household's Accounts; the latest one is its balance. */
const insertBalance = (
	db: Db,
	input: {
		householdId: string;
		balanceId: string;
		accountId: string;
		amountCents: Cents;
		createdByMemberId: string;
	},
) =>
	db
		.insert(accountBalances)
		.select(
			db
				.select({
					id: sql<string>`${input.balanceId}`.as("id"),
					householdId: accounts.householdId,
					accountId: accounts.id,
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: nowMs.as("created_at"),
				})
				.from(accounts)
				.where(ownAccount(input.householdId, input.accountId)),
		)
		.onConflictDoNothing({ target: accountBalances.id });

/**
 * Adds an Account, with its balance when one is given. Idempotent per `accountId` and
 * `balanceId`: a retry leaves the first attempt's Account as it was.
 */
export async function addAccount(
	db: Db,
	input: {
		householdId: string;
		accountId: string;
		name: string;
		kind: AccountKind;
		balanceCents: Cents | null;
		balanceId: string;
		createdByMemberId: string;
	},
): Promise<void> {
	const insertAccount = db
		.insert(accounts)
		.values({
			id: input.accountId,
			householdId: input.householdId,
			name: input.name,
			kind: input.kind,
		})
		.onConflictDoNothing({ target: accounts.id });
	if (input.balanceCents === null) {
		await insertAccount;
		return;
	}
	await db.batch([insertAccount, insertBalance(db, { ...input, amountCents: input.balanceCents })]);
}

export async function renameAccount(
	db: Db,
	input: { householdId: string; accountId: string; name: string },
): Promise<void> {
	await db
		.update(accounts)
		.set({ name: input.name })
		.where(ownAccount(input.householdId, input.accountId));
}

/**
 * Records an Account's balance as a Parent entered it. Idempotent per `balanceId`. Refused
 * unless the Account is the Household's.
 */
export async function updateAccountBalance(
	db: Db,
	input: {
		householdId: string;
		balanceId: string;
		accountId: string;
		amountCents: Cents;
		createdByMemberId: string;
	},
): Promise<GoalWriteResult> {
	await insertBalance(db, input);
	const [written] = await db
		.select({ id: accountBalances.id })
		.from(accountBalances)
		.where(
			and(
				eq(accountBalances.id, input.balanceId),
				eq(accountBalances.householdId, input.householdId),
			),
		);
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

/** Appends a claim on not set aside money for a Goal that isn't archived (negative: a release). */
const insertClaim = (
	db: Db,
	input: {
		householdId: string;
		claimId: string;
		goalId: string;
		month: MonthKey;
		amountCents: Cents;
		createdByMemberId: string;
	},
	guard?: SQL,
) =>
	db
		.insert(earmarkClaims)
		.select(
			db
				.select({
					id: sql<string>`${input.claimId}`.as("id"),
					householdId: goals.householdId,
					goalId: goals.id,
					month: sql<string>`${input.month}`.as("month"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: now.as("created_at"),
				})
				.from(goals)
				.where(
					and(
						ownGoal(input.householdId, input.goalId),
						// A payoff Goal sets nothing aside (ADR-0019).
						eq(goals.kind, "save"),
						isNull(goals.archivedAt),
						guard,
					),
				),
		)
		.onConflictDoNothing({ target: earmarkClaims.id });

/**
 * addGoal's Goal as a statement (without a claim), for writing it in a batch with others:
 * refused unless the Account is the Household's checking or savings one.
 */
export const goalInsert = (
	db: Db,
	input: {
		householdId: string;
		goalId: string;
		accountId: string;
		name: string;
		targetCents: Cents;
		targetDate: DayKey | null;
		fromMonth: MonthKey;
	},
) =>
	db
		.insert(goals)
		.select(
			db
				.select({
					id: sql<string>`${input.goalId}`.as("id"),
					householdId: accounts.householdId,
					accountId: accounts.id,
					name: sql<string>`${input.name}`.as("name"),
					targetCents: sql<number>`${input.targetCents}`.as("target_cents"),
					targetDate: sql<string | null>`${input.targetDate}`.as("target_date"),
					fromMonth: sql<string>`${input.fromMonth}`.as("from_month"),
					completedAt: sql<Date | null>`null`.as("completed_at"),
					archivedAt: sql<Date | null>`null`.as("archived_at"),
					createdAt: now.as("created_at"),
					kind: sql<GoalKind>`'save'`.as("kind"),
				})
				.from(accounts)
				.where(
					and(
						ownAccount(input.householdId, input.accountId),
						inArray(accounts.kind, ["checking", "savings"]),
					),
				),
		)
		.onConflictDoNothing({ target: goals.id });

/**
 * Adds a Goal backed by one of the Household's checking or savings Accounts, from `fromMonth`
 * (the Household's current month), with `claimCents` of not set aside money already set aside for it
 * (0 for none). Idempotent per `goalId`: a retry leaves the first attempt's Goal as it was.
 * Refused unless, at write time, the Account is the Household's and holds money.
 */
export async function addGoal(
	db: Db,
	input: {
		householdId: string;
		goalId: string;
		accountId: string;
		name: string;
		targetCents: Cents;
		targetDate: DayKey | null;
		fromMonth: MonthKey;
		claimId: string;
		claimCents: Cents;
		createdByMemberId: string;
	},
): Promise<GoalWriteResult> {
	// The Plan change, under the insert's own guard and only while the Goal isn't there yet.
	const log = logChange(
		db,
		accounts,
		and(
			ownAccount(input.householdId, input.accountId),
			inArray(accounts.kind, ["checking", "savings"]),
			notExists(db.select({ id: goals.id }).from(goals).where(eq(goals.id, input.goalId))),
		),
		{
			householdId: input.householdId,
			memberId: input.createdByMemberId,
			kind: "goal-add",
			targetId: input.goalId,
			month: input.fromMonth,
			before: null,
			after: { name: input.name, target: input.targetCents, targetDate: input.targetDate },
		},
	);
	const insertGoal = goalInsert(db, input);
	if (input.claimCents === 0) {
		await db.batch([log, insertGoal]);
	} else {
		await db.batch([
			log,
			insertGoal,
			insertClaim(db, { ...input, month: input.fromMonth, amountCents: input.claimCents }),
		]);
	}
	// Either this call or an earlier attempt with the same ID wrote it, or it was refused.
	const [written] = await db
		.select({ id: goals.id })
		.from(goals)
		.where(ownGoal(input.householdId, input.goalId));
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

type GoalTargetInput = Author & {
	householdId: string;
	goalId: string;
	/** When the Plan change takes effect: the Household's current month, or a Scenario's. */
	month: MonthKey;
	targetCents: Cents;
	targetDate: DayKey | null;
};

/**
 * The Plan change for setting a Goal's target and date, written before them: only if the Goal
 * is the Household's (and matches `where`) and either differs.
 */
export const goalLog = (db: Db, input: GoalTargetInput, where?: SQL) => {
	const target = targetFor(input.targetCents);
	return logChange(
		db,
		goals,
		and(
			ownGoal(input.householdId, input.goalId),
			where,
			sql`(${goals.targetCents} is not ${target} or ${goals.targetDate} is not ${input.targetDate})`,
		),
		{
			...input,
			kind: "goal",
			targetId: input.goalId,
			before: sql`json_object('target', ${goals.targetCents}, 'targetDate', ${goals.targetDate})`,
			after: sql`json_object('target', ${target}, 'targetDate', ${input.targetDate})`,
		},
	);
};

/**
 * The target a Goal takes when set to `targetCents`: a payoff Goal's stays what was owed when it
 * was added (only "Start again from today's balance" changes it, restartPayoffGoal).
 */
export const targetFor = (targetCents: Cents) =>
	sql<number>`(case when ${goals.kind} = 'payoff' then ${goals.targetCents} else ${targetCents} end)`;

export async function updateGoal(db: Db, input: GoalTargetInput & { name: string }): Promise<void> {
	await db.batch([
		goalLog(db, input),
		db
			.update(goals)
			.set({
				name: input.name,
				targetCents: targetFor(input.targetCents),
				targetDate: input.targetDate,
			})
			.where(ownGoal(input.householdId, input.goalId)),
	]);
}

/** What's owed on one of the Household's credit cards or loans now: its latest balance, if any. */
export const latestBalanceSql = (accountId: SQL | string) =>
	sql<number | null>`(select b.amount_cents from account_balances b
		where b.account_id = ${accountId} order by b.created_at desc, b.id desc limit 1)`;

/** What's owed now on one of the Household's credit cards or loans; null without a balance. */
export async function owedNow(
	db: Db,
	input: { householdId: string; accountId: string },
): Promise<Cents | null> {
	const [row] = await db
		.select({ amount: accountBalances.amountCents })
		.from(accountBalances)
		.where(
			and(
				eq(accountBalances.accountId, input.accountId),
				eq(accountBalances.householdId, input.householdId),
			),
		)
		.orderBy(desc(accountBalances.createdAt), desc(accountBalances.id))
		.limit(1);
	return row?.amount ?? null;
}

/**
 * Adds a payoff Goal on one of the Household's credit cards or loans (ADR-0019), from
 * `fromMonth`, with `targetCents` what's owed on it now (owedNow). Idempotent per `goalId`.
 * Refused unless, at write time, the Account is the Household's card or loan, still owes exactly
 * `targetCents` (more than nothing), and has no other payoff Goal that's neither completed nor
 * archived.
 */
export async function addPayoffGoal(
	db: Db,
	input: {
		householdId: string;
		goalId: string;
		accountId: string;
		name: string;
		targetCents: Cents;
		targetDate: DayKey | null;
		fromMonth: MonthKey;
		createdByMemberId: string;
	},
): Promise<GoalWriteResult> {
	const guard = and(
		ownAccount(input.householdId, input.accountId),
		inArray(accounts.kind, ["credit-card", "loan"]),
		sql`${input.targetCents} > 0`,
		sql`${latestBalanceSql(sql`${accounts.id}`)} = ${input.targetCents}`,
		notExists(
			db
				.select({ id: goals.id })
				.from(goals)
				.where(
					and(
						eq(goals.accountId, input.accountId),
						eq(goals.kind, "payoff"),
						isNull(goals.completedAt),
						isNull(goals.archivedAt),
					),
				),
		),
	);
	await db.batch([
		logChange(
			db,
			accounts,
			and(
				guard,
				notExists(db.select({ id: goals.id }).from(goals).where(eq(goals.id, input.goalId))),
			),
			{
				householdId: input.householdId,
				memberId: input.createdByMemberId,
				kind: "goal-add",
				targetId: input.goalId,
				month: input.fromMonth,
				before: null,
				after: {
					name: input.name,
					target: input.targetCents,
					targetDate: input.targetDate,
				},
			},
		),
		db
			.insert(goals)
			.select(
				db
					.select({
						id: sql<string>`${input.goalId}`.as("id"),
						householdId: accounts.householdId,
						accountId: accounts.id,
						name: sql<string>`${input.name}`.as("name"),
						targetCents: sql<number>`${input.targetCents}`.as("target_cents"),
						targetDate: sql<string | null>`${input.targetDate}`.as("target_date"),
						fromMonth: sql<string>`${input.fromMonth}`.as("from_month"),
						completedAt: sql<Date | null>`null`.as("completed_at"),
						archivedAt: sql<Date | null>`null`.as("archived_at"),
						createdAt: now.as("created_at"),
						// Selected in the table's column order: insert … select is positional.
						kind: sql<GoalKind>`'payoff'`.as("kind"),
					})
					.from(accounts)
					.where(guard),
			)
			// The Goal's ID, or the one-active-payoff-Goal-per-Account index.
			.onConflictDoNothing(),
	]);
	const [written] = await db
		.select({ id: goals.id })
		.from(goals)
		.where(and(ownGoal(input.householdId, input.goalId), eq(goals.kind, "payoff")));
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

/**
 * Starts a payoff Goal again from today's balance (ADR-0019): its target becomes `owedCents`,
 * what's owed now, and its schedule starts in `month`, so nothing is paid down yet. A Plan change
 * like any target change. Refused unless, at write time, the Goal is the Household's active payoff
 * Goal and its card or loan still owes exactly `owedCents`, more than nothing.
 */
export async function restartPayoffGoal(
	db: Db,
	input: Author & { householdId: string; goalId: string; month: MonthKey; owedCents: Cents },
): Promise<GoalWriteResult> {
	const guard = and(
		ownGoal(input.householdId, input.goalId),
		eq(goals.kind, "payoff"),
		isNull(goals.completedAt),
		isNull(goals.archivedAt),
		sql`${input.owedCents} > 0`,
		sql`${latestBalanceSql(sql`${goals.accountId}`)} = ${input.owedCents}`,
	);
	await db.batch([
		logChange(
			db,
			goals,
			and(
				guard,
				sql`(${goals.targetCents} is not ${input.owedCents} or ${goals.fromMonth} is not ${input.month})`,
			),
			{
				...input,
				kind: "goal",
				targetId: input.goalId,
				before: sql`json_object('target', ${goals.targetCents}, 'targetDate', ${goals.targetDate})`,
				after: sql`json_object('target', ${input.owedCents}, 'targetDate', ${goals.targetDate})`,
			},
		),
		db.update(goals).set({ targetCents: input.owedCents, fromMonth: input.month }).where(guard),
	]);
	const [row] = await db
		.select({ target: goals.targetCents, fromMonth: goals.fromMonth })
		.from(goals)
		.where(ownGoal(input.householdId, input.goalId));
	return row?.target === input.owedCents && row.fromMonth === input.month
		? { ok: true }
		: { ok: false, reason: "refused" };
}

/** Marks a Goal completed. It keeps what it has set aside. Completing it again changes nothing. */
export async function completeGoal(
	db: Db,
	input: { householdId: string; goalId: string },
): Promise<void> {
	await db
		.update(goals)
		.set({ completedAt: now })
		.where(
			and(
				ownGoal(input.householdId, input.goalId),
				isNull(goals.completedAt),
				isNull(goals.archivedAt),
			),
		);
}

/** Archives a Goal, releasing what it has set aside to not set aside. Archiving it again changes nothing. */
export async function archiveGoal(
	db: Db,
	input: { householdId: string; goalId: string },
): Promise<void> {
	await db
		.update(goals)
		.set({ archivedAt: now })
		.where(and(ownGoal(input.householdId, input.goalId), isNull(goals.archivedAt)));
}

/**
 * Sets `amountCents` of not set aside money aside for a Goal, or releases it back to not set aside when
 * negative. Idempotent per `claimId`. Refused unless, at write time, the Goal is the Household's
 * and not archived, and a release is no more than what the Goal has set aside.
 */
export async function claimForGoal(
	db: Db,
	input: {
		householdId: string;
		claimId: string;
		goalId: string;
		month: MonthKey;
		amountCents: Cents;
		createdByMemberId: string;
	},
): Promise<GoalWriteResult> {
	await insertClaim(
		db,
		input,
		input.amountCents < 0
			? sql`${setAsideSql(input.householdId, input.goalId)} >= ${-input.amountCents}`
			: undefined,
	);
	const [written] = await db
		.select({ id: earmarkClaims.id })
		.from(earmarkClaims)
		.where(
			and(eq(earmarkClaims.id, input.claimId), eq(earmarkClaims.householdId, input.householdId)),
		);
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

/**
 * Records Goal funding: `amountCents` Moved from `month`'s Free to Spend into what a Goal has set aside.
 * Idempotent per `moveId`. Refused unless, at write time, the Goal is the Household's and still
 * active (neither completed nor archived), and Free to Spend has at least `amountCents` left.
 */
export async function fundGoal(
	db: Db,
	input: {
		householdId: string;
		moveId: string;
		goalId: string;
		month: MonthKey;
		amountCents: Cents;
		createdByMemberId: string;
	},
): Promise<GoalWriteResult> {
	const { householdId, month } = input;
	await db
		.insert(moves)
		.select(
			db
				.select({
					id: sql<string>`${input.moveId}`.as("id"),
					householdId: goals.householdId,
					kind: sql<"goal-funding">`'goal-funding'`.as("kind"),
					month: sql<string>`${month}`.as("month"),
					fromBucketId: sql<string | null>`null`.as("from_bucket_id"),
					toBucketId: sql<string | null>`null`.as("to_bucket_id"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: now.as("created_at"),
					// Selected in the table's column order: insert … select is positional.
					toGoalId: goals.id,
				})
				.from(goals)
				.where(
					and(
						ownGoal(householdId, input.goalId),
						isNull(goals.completedAt),
						isNull(goals.archivedAt),
						sql`${freeToSpendSql(householdId, month)} >= ${input.amountCents}`,
					),
				),
		)
		.onConflictDoNothing({ target: moves.id });
	const [written] = await db
		.select({ id: moves.id })
		.from(moves)
		.where(and(eq(moves.id, input.moveId), eq(moves.householdId, householdId)));
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

/**
 * Undoes Goal funding in `month` by removing its Move, returning the money to Free to Spend.
 * Refused if the Goal has since spent it (what it has set aside is less than the funding). Undoing one
 * already undone changes nothing.
 */
export async function undoGoalFunding(
	db: Db,
	input: { householdId: string; moveId: string; month: MonthKey },
): Promise<GoalWriteResult> {
	const own = and(
		eq(moves.id, input.moveId),
		eq(moves.householdId, input.householdId),
		eq(moves.month, input.month),
		eq(moves.kind, "goal-funding"),
	);
	await db.delete(moves).where(
		and(
			own,
			// Correlated with the Move being deleted (the subqueries alias their own `moves`).
			sql`${setAsideSql(input.householdId, sql.raw("moves.to_goal_id"))} >= ${sql.raw("moves.amount_cents")}`,
		),
	);
	const [left] = await db.select({ id: moves.id }).from(moves).where(own);
	return left ? { ok: false, reason: "refused" } : { ok: true };
}

/**
 * Records Goal spending: a Transaction of `amountCents` spent today out of what a Goal has set aside, from
 * its Account. It never touches a Bucket or Free to Spend. Idempotent per `transactionId`.
 * Refused unless, at write time, the Goal is the Household's and not archived, and what it has set aside
 * is at least `amountCents`.
 */
export async function spendGoal(
	db: Db,
	input: {
		householdId: string;
		transactionId: string;
		goalId: string;
		date: DayKey;
		amountCents: Cents;
		note: string | null;
		createdByMemberId: string;
	},
): Promise<GoalWriteResult> {
	const { householdId } = input;
	await db
		.insert(transactions)
		.select(
			db
				.select({
					id: sql<string>`${input.transactionId}`.as("id"),
					householdId: goals.householdId,
					source: sql<"quick-add">`'quick-add'`.as("source"),
					date: sql<string>`${input.date}`.as("date"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					bucketId: sql<string | null>`null`.as("bucket_id"),
					note: sql<string | null>`${input.note}`.as("note"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: nowMs.as("created_at"),
					// Selected in the table's column order: insert … select is positional.
					commitmentId: sql<string | null>`null`.as("commitment_id"),
					accountId: goals.accountId,
					goalId: goals.id,
					importId: sql<string | null>`null`.as("import_id"),
					externalId: sql<string | null>`null`.as("external_id"),
					capturedVia: sql<string | null>`null`.as("captured_via"),
					pending: sql<boolean>`0`.as("pending"),
					merchant: sql<string | null>`null`.as("merchant"),
				})
				.from(goals)
				.where(
					and(
						ownGoal(householdId, input.goalId),
						eq(goals.kind, "save"),
						isNull(goals.archivedAt),
						sql`${setAsideSql(householdId, input.goalId)} >= ${input.amountCents}`,
					),
				),
		)
		.onConflictDoNothing({ target: transactions.id });
	const [written] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(eq(transactions.id, input.transactionId), eq(transactions.householdId, householdId)),
		);
	return written ? { ok: true } : { ok: false, reason: "refused" };
}

export type AccountRecord = {
	id: string;
	name: string;
	kind: AccountKind;
	/** The latest balance a Parent entered; null until one is. */
	latestBalance: BalanceUpdate | null;
	/** The Bank Connection that brought it in; null for one entered by hand. */
	bankConnectionId: string | null;
	/** The last day a statement uploaded to it covers; null when none was. */
	lastStatementDate: DayKey | null;
};

export type GoalRecord = {
	id: string;
	/** "save", or "payoff": a credit card or loan paid down (ADR-0019). */
	kind: GoalKind;
	accountId: string;
	name: string;
	target: Cents;
	targetDate: DayKey | null;
	/** The month it was added. */
	fromMonth: MonthKey;
	completed: boolean;
	archived: boolean;
};

/** A change to what a Goal has set aside with its row's ID; Goal spending also has its day and note. */
export type GoalChange = SetAsideChange & {
	id: string;
	date?: DayKey;
	note?: string | null;
	/** For a Sweep, the Bucket whose leftover it was. */
	fromBucket?: string;
};

/** Everything the Goals and Accounts views derive their numbers from (see @noodle/domain). */
export type GoalRecords = {
	accounts: AccountRecord[];
	/**
	 * Goal spending taken out of each Account, for accountBalance: a Split's when its Transaction
	 * was recorded.
	 */
	withdrawals: (AccountWithdrawal & { accountId: string })[];
	goals: GoalRecord[];
	/** Every Goal's claims, funding, and spending, oldest first. */
	changes: GoalChange[];
	/**
	 * Every balance entered or brought in for the credit cards and loans, oldest first: what was
	 * owed over time, which a payoff Goal's history shows.
	 */
	owed: (BalanceUpdate & { accountId: string })[];
	/** The Goal the Household keeps for emergencies, if it has marked one. */
	emergencyGoalId: string | null;
};

/**
 * The Household's Accounts, Goals, and every change to what their Goals have set aside, as `viewer` may see them:
 * Goal spending is never in a Personal Allowance, but a Split's Transaction shows no note when
 * another of its Splits is in the other Parent's.
 */
export async function loadGoals(db: Db, viewer: Viewer): Promise<GoalRecords> {
	const { householdId } = viewer;
	const [
		accountRows,
		balanceRows,
		goalRows,
		claimRows,
		fundingRows,
		wholeRows,
		splitRows,
		householdRows,
	] = await db.batch([
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				kind: accounts.kind,
				bankConnectionId: accounts.bankConnectionId,
				// Spelled out: inside a select's fields Drizzle leaves column names unqualified.
				lastStatementDate: sql<string | null>`(select max(i.last_date) from imports i
					where i.account_id = "accounts"."id" and i.source <> 'bank')`,
			})
			.from(accounts)
			.where(eq(accounts.householdId, householdId))
			.orderBy(asc(accounts.createdAt), asc(accounts.id)),
		db
			.select({
				accountId: accountBalances.accountId,
				amount: accountBalances.amountCents,
				at: accountBalances.createdAt,
			})
			.from(accountBalances)
			.where(eq(accountBalances.householdId, householdId))
			.orderBy(asc(accountBalances.createdAt), asc(accountBalances.id)),
		db
			.select()
			.from(goals)
			.where(eq(goals.householdId, householdId))
			.orderBy(asc(goals.createdAt), asc(goals.id)),
		db
			.select({
				id: earmarkClaims.id,
				goalId: earmarkClaims.goalId,
				amount: earmarkClaims.amountCents,
				month: earmarkClaims.month,
			})
			.from(earmarkClaims)
			.where(eq(earmarkClaims.householdId, householdId)),
		db
			.select({
				id: moves.id,
				goalId: moves.toGoalId,
				amount: moves.amountCents,
				month: moves.month,
				moveKind: moves.kind,
				fromBucket: buckets.name,
			})
			.from(moves)
			.leftJoin(buckets, eq(buckets.id, moves.fromBucketId))
			.where(and(eq(moves.householdId, householdId), isNotNull(moves.toGoalId))),
		db
			.select({
				id: transactions.id,
				goalId: transactions.goalId,
				accountId: transactions.accountId,
				amount: transactions.amountCents,
				date: transactions.date,
				note: transactions.note,
				at: transactions.createdAt,
			})
			.from(transactions)
			.where(and(visibleTo(viewer), counts(), isNotNull(transactions.goalId))),
		db
			.select({
				id: splits.id,
				goalId: splits.goalId,
				accountId: goals.accountId,
				amount: splits.amountCents,
				date: transactions.date,
				note: sql<
					string | null
				>`case when ${partlyPrivate(viewer)} then null else ${transactions.note} end`,
				at: transactions.createdAt,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.innerJoin(goals, eq(goals.id, splits.goalId))
			.where(and(visibleSplit(viewer), visibleTo(viewer), counts(), isNotNull(splits.goalId))),
		db
			.select({ emergencyGoalId: households.emergencyGoalId })
			.from(households)
			.where(eq(households.id, householdId)),
	]);
	const spendingRows = [
		...wholeRows,
		// Transactions are recorded to the second: a Split counts as after a balance entered in
		// that same second, like a tie.
		...splitRows.map((row) => ({ ...row, at: new Date(row.at.getTime() + 999) })),
	];
	// Oldest first, so the last one per Account is its latest.
	const latest = new Map<string, BalanceUpdate>();
	for (const row of balanceRows) {
		latest.set(row.accountId, { amount: row.amount, at: row.at.getTime() });
	}
	// Goal IDs are filtered to non-null; months and days are always written as Month/DayKeys.
	const changes: GoalChange[] = [
		...claimRows.map((row) => ({ ...row, kind: "claim" as const }) as GoalChange),
		...fundingRows.map(
			({ moveKind, fromBucket, ...row }) =>
				({
					...row,
					kind: "funding" as const,
					...(moveKind === "windfall" || moveKind === "sweep" ? { from: moveKind } : {}),
					...(moveKind === "sweep" && fromBucket ? { fromBucket } : {}),
				}) as GoalChange,
		),
		...spendingRows.map(
			({ id, goalId, amount, date, note }) =>
				({
					id,
					goalId,
					kind: "spending",
					amount: -amount,
					month: monthOfDay(date as DayKey),
					date,
					note,
				}) as GoalChange,
		),
	].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return {
		accounts: accountRows.map((row) => ({
			...row,
			lastStatementDate: row.lastStatementDate as DayKey | null,
			latestBalance: latest.get(row.id) ?? null,
		})),
		withdrawals: spendingRows
			.filter((row) => row.accountId !== null)
			.map((row) => ({
				accountId: row.accountId as string,
				amount: row.amount,
				at: row.at.getTime(),
			})),
		goals: goalRows.map((row) => ({
			id: row.id,
			kind: row.kind,
			accountId: row.accountId,
			name: row.name,
			target: row.targetCents,
			targetDate: row.targetDate as DayKey | null,
			fromMonth: row.fromMonth as MonthKey,
			completed: row.completedAt !== null,
			archived: row.archivedAt !== null,
		})),
		changes,
		owed: balanceRows
			.filter((row) => accountRows.some((a) => a.id === row.accountId && !holdsMoney(a.kind)))
			.map((row) => ({ accountId: row.accountId, amount: row.amount, at: row.at.getTime() })),
		emergencyGoalId: householdRows[0]?.emergencyGoalId ?? null,
	};
}

/**
 * Goal funding in the Household's `month`, oldest first: from Free to Spend, or from the
 * Extra income (`windfall`).
 */
export async function loadGoalFunding(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<(GoalFunding & { id: string })[]> {
	const rows = await db
		.select({
			id: moves.id,
			goalId: moves.toGoalId,
			amount: moves.amountCents,
			month: moves.month,
			kind: moves.kind,
		})
		.from(moves)
		.where(
			and(
				eq(moves.householdId, householdId),
				eq(moves.month, month),
				isNotNull(moves.toGoalId),
				inArray(moves.kind, ["goal-funding", "windfall"]),
			),
		)
		.orderBy(moves.id);
	// to_goal_id is filtered to non-null, and months are always written as MonthKeys.
	return rows.map(({ kind, ...funding }) =>
		kind === "windfall" ? { ...funding, windfall: true } : funding,
	) as (GoalFunding & { id: string })[];
}

/**
 * Marks one of the Household's Goals as its emergency Goal, or clears it with null. Refused
 * (nothing changes) when the Goal isn't the Household's or is archived.
 */
export async function setEmergencyGoal(
	db: Db,
	input: { householdId: string; goalId: string | null },
): Promise<GoalWriteResult> {
	const { householdId, goalId } = input;
	if (goalId === null) {
		await db
			.update(households)
			.set({ emergencyGoalId: null })
			.where(eq(households.id, householdId));
		return { ok: true };
	}
	await db
		.update(households)
		.set({
			emergencyGoalId: sql`(select ${goals.id} from ${goals} where ${and(ownGoal(householdId, goalId), eq(goals.kind, "save"), isNull(goals.archivedAt))})`,
		})
		.where(
			and(
				eq(households.id, householdId),
				sql`exists (select 1 from ${goals} where ${and(ownGoal(householdId, goalId), eq(goals.kind, "save"), isNull(goals.archivedAt))})`,
			),
		);
	const [row] = await db
		.select({ id: households.emergencyGoalId })
		.from(households)
		.where(eq(households.id, householdId));
	return row?.id === goalId ? { ok: true } : { ok: false, reason: "refused" };
}
