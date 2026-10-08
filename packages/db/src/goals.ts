import {
	type AccountKind,
	type AccountWithdrawal,
	type BalanceCheck,
	type BalanceUpdate,
	balanceCheck,
	CARD_PAYMENT_DAYS,
	type Cents,
	type DayKey,
	dayKeyAt,
	dueDateOn,
	type GoalFunding,
	type GoalKind,
	holdsMoney,
	type LoanFacts,
	type MonthKey,
	monthOfDay,
	type OwedPayment,
	owedOn,
	type PurchasesGetIn,
	type SetAsideChange,
	statementCheckDue,
} from "@noodle/domain";
import {
	and,
	asc,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	lte,
	ne,
	notExists,
	type SQL,
	sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";
import type { ArchivedAccount } from "./account-archive";
import { commitmentAdd, commitmentTermsSet, inPlanFor, mayPayDown } from "./commitments";
import { counts, countsRaw } from "./counting";
import type { Db } from "./index";
import { freeToSpendSql } from "./moves";
import { type Author, logChange } from "./plan-log";
import { partlyPrivate, type Viewer, visibleSplit, visibleTo } from "./privacy";
import {
	accountBalances,
	accounts,
	buckets,
	commitments,
	commitmentTerms,
	earmarkClaims,
	goals,
	households,
	moves,
	splits,
	transactions,
	transfers,
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
		/** The day the balance was true: a statement's closing date, or today; null when unknown. */
		asOf?: DayKey | null;
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
					// Selected in the table's column order: insert … select is positional.
					asOf: sql<string | null>`${input.asOf ?? null}`.as("as_of"),
				})
				.from(accounts)
				.where(ownAccount(input.householdId, input.accountId)),
		)
		.onConflictDoNothing({ target: accountBalances.id });

/**
 * A monthly Commitment for an Account's payments (issue 153): what one payment is, a day it is
 * due (dueDateOn in @noodle/domain), and the Household's current month, which it is in the Plan
 * from.
 */
export type PaymentCommitment = {
	commitmentId: string;
	amountCents: Cents;
	dueDate: DayKey;
	month: MonthKey;
	/** Today in the Household's time zone, for whether Noodle follows a card. */
	today: DayKey;
};

/**
 * The statements that add a monthly Commitment paying `account` down, named after it: one Plan
 * change ("commitment-add", saying what it pays down). It lands only while the Account may be
 * paid down this way (mayPayDown: the Household's card or loan in use, and not a card Noodle
 * follows) and no Commitment still in the Plan pays it down already.
 */
const paymentCommitmentAdd = (
	db: Db,
	input: PaymentCommitment & {
		householdId: string;
		memberId: string;
		account: { id: string; name: string };
	},
) =>
	commitmentAdd(
		db,
		{
			householdId: input.householdId,
			memberId: input.memberId,
			commitmentId: input.commitmentId,
			name: input.account.name,
			month: input.month,
			amountCents: input.amountCents,
			cadence: "monthly",
			dueDate: input.dueDate,
			paysDown: { accountId: input.account.id, name: input.account.name },
		},
		and(
			mayPayDown({
				householdId: input.householdId,
				accountId: input.account.id,
				carriedBalance: false,
				today: input.today,
			}),
			sql`not exists (select 1 from ${commitments} where ${and(
				eq(commitments.householdId, input.householdId),
				eq(commitments.accountId, input.account.id),
				ne(commitments.id, input.commitmentId),
				inPlanFor(input.month),
			)})`,
		),
	);

/**
 * Adds an Account, with its balance when one is given, a loan's facts, and (with `commitment`) a
 * monthly Commitment for its payments, all in one batch: every write lands or none does.
 * Idempotent per `accountId`, `balanceId` and the Commitment's ID: a retry leaves the first
 * attempt's Account as it was.
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
		/** The day the balance is from: today in the Household's time zone. */
		asOf?: DayKey | null;
		/** For a credit card: how its purchases get into Noodle, as the Parent answered. */
		purchases?: PurchasesGetIn | null;
		/** Whose it is: a Parent of the Household, else the Household's (ADR-0059). */
		whoseMemberId?: string | null;
		/** For a loan: what the Parent said about it. Kept on no other kind. */
		loan?: LoanFacts | null;
		/** A monthly Commitment for its payments, for a loan or a card Noodle doesn't follow. */
		commitment?: PaymentCommitment | null;
	},
): Promise<void> {
	const loan = input.kind === "loan" ? (input.loan ?? null) : null;
	const insertAccount = db
		.insert(accounts)
		.values({
			id: input.accountId,
			householdId: input.householdId,
			name: input.name,
			kind: input.kind,
			purchases: input.kind === "credit-card" ? (input.purchases ?? null) : null,
			whoseMemberId: input.whoseMemberId ? parentOf(input.householdId, input.whoseMemberId) : null,
			borrowedCents: loan?.borrowed ?? null,
			paymentCents: loan?.payment ?? null,
			dueDay: loan?.dueDay ?? null,
			endsOn: loan?.endsOn ?? null,
		})
		.onConflictDoNothing({ target: accounts.id });
	await db.batch([
		insertAccount,
		...(input.balanceCents === null
			? []
			: [insertBalance(db, { ...input, amountCents: input.balanceCents })]),
		...(input.commitment && !holdsMoney(input.kind)
			? paymentCommitmentAdd(db, {
					...input.commitment,
					householdId: input.householdId,
					memberId: input.createdByMemberId,
					account: { id: input.accountId, name: input.name },
				})
			: []),
	]);
}

/** The Commitment a change to a loan's payment or due day changed with it. */
export type LoanCommitmentChange = { id: string; name: string; amountCents: Cents; dueDay: number };

/**
 * Records a loan's facts (issue 153): what was borrowed, the payment, its due day and the day it
 * ends, each null for "not said". Refused unless it is the Household's loan, in use.
 *
 * With `plan`, a payment or due day that differs from the terms of a monthly Commitment in the
 * Plan paying the loan down changes those terms from `plan.month` on in the same batch: one Plan
 * change ("commitment-terms"), undone as any other, so the loan and its Commitment say the same.
 * The Commitment changed is handed back. A fact left unsaid leaves that term as it is.
 */
export async function setLoanFacts(
	db: Db,
	input: { householdId: string; accountId: string } & LoanFacts & {
			plan?: { memberId: string; month: MonthKey; today: DayKey };
		},
): Promise<{ ok: boolean; commitment?: LoanCommitmentChange }> {
	const { plan } = input;
	const ownLoan = and(
		ownAccount(input.householdId, input.accountId),
		eq(accounts.kind, "loan"),
		isNull(accounts.archivedAt),
	);
	const paying =
		plan && (input.payment !== null || input.dueDay !== null)
			? await db
					.select({
						commitmentId: commitmentTerms.commitmentId,
						name: commitments.name,
						month: commitmentTerms.month,
						amountCents: commitmentTerms.amountCents,
						cadence: commitmentTerms.cadence,
						dueDate: commitmentTerms.dueDate,
					})
					.from(commitmentTerms)
					.innerJoin(commitments, eq(commitments.id, commitmentTerms.commitmentId))
					.innerJoin(accounts, eq(accounts.id, commitments.accountId))
					.where(
						and(
							eq(commitments.householdId, input.householdId),
							eq(commitments.accountId, input.accountId),
							inPlanFor(plan.month),
							lte(commitmentTerms.month, plan.month),
							ownLoan,
						),
					)
					.orderBy(desc(commitmentTerms.month))
			: [];
	const changes: (LoanCommitmentChange & { dueDate: DayKey })[] = [];
	for (const terms of paying) {
		// The terms in force this month are the first read for each Commitment.
		if (paying.find((row) => row.commitmentId === terms.commitmentId) !== terms) continue;
		if (terms.cadence !== "monthly" || !plan) continue;
		const dueDay = input.dueDay ?? Number(terms.dueDate.slice(8));
		const dueDate =
			Number(terms.dueDate.slice(8)) === dueDay
				? (terms.dueDate as DayKey)
				: dueDateOn(dueDay, plan.today);
		const amountCents = input.payment ?? terms.amountCents;
		if (amountCents === terms.amountCents && dueDate === terms.dueDate) continue;
		changes.push({ id: terms.commitmentId, name: terms.name, amountCents, dueDay, dueDate });
	}
	const [changed] = await db.batch([
		db
			.update(accounts)
			.set({
				borrowedCents: input.borrowed,
				paymentCents: input.payment,
				dueDay: input.dueDay,
				endsOn: input.endsOn,
			})
			.where(ownLoan)
			.returning({ id: accounts.id }),
		...(plan
			? changes.flatMap((change) =>
					commitmentTermsSet(db, {
						householdId: input.householdId,
						memberId: plan.memberId,
						commitmentId: change.id,
						month: plan.month,
						amountCents: change.amountCents,
						cadence: "monthly",
						dueDate: change.dueDate,
					}),
				)
			: []),
	]);
	const [first] = changes;
	return {
		ok: changed.length > 0,
		...(first
			? {
					commitment: {
						id: first.id,
						name: first.name,
						amountCents: first.amountCents,
						dueDay: first.dueDay,
					},
				}
			: {}),
	};
}

export type PaymentCommitmentResult =
	| { ok: true }
	/**
	 * "not-found": the Account isn't the Household's card or loan in use. "refused": a card Noodle
	 * follows (paying it is a Transfer), or a Commitment in the Plan pays it down already.
	 */
	| { ok: false; reason: "not-found" | "refused" };

/**
 * Adds a monthly Commitment for the payments of an Account the Household has already, named
 * after it (issue 153). For a loan the payment and its due day become its facts in the same
 * batch, so its schedule and the Commitment say the same. Idempotent per `commitmentId`.
 */
export async function addPaymentCommitment(
	db: Db,
	input: PaymentCommitment & {
		householdId: string;
		memberId: string;
		accountId: string;
		/** The day of the month it is due, 1 to 31: the loan's fact. */
		dueDay: number;
	},
): Promise<PaymentCommitmentResult> {
	const own = and(ownAccount(input.householdId, input.accountId), isNull(accounts.archivedAt));
	const [account] = await db
		.select({ id: accounts.id, name: accounts.name, kind: accounts.kind })
		.from(accounts)
		.where(own);
	if (!account || holdsMoney(account.kind)) return { ok: false, reason: "not-found" };
	const added = sql`exists (select 1 from ${commitments} where ${and(
		eq(commitments.id, input.commitmentId),
		eq(commitments.accountId, input.accountId),
	)})`;
	await db.batch([
		...paymentCommitmentAdd(db, { ...input, account }),
		// Last, and only once the Commitment is there: a refusal leaves the loan's facts alone.
		db
			.update(accounts)
			.set({ paymentCents: input.amountCents, dueDay: input.dueDay })
			.where(and(own, eq(accounts.kind, "loan"), added)),
	]);
	const [row] = await db
		.select({ id: commitments.id })
		.from(commitments)
		.where(
			and(
				eq(commitments.id, input.commitmentId),
				eq(commitments.householdId, input.householdId),
				eq(commitments.accountId, input.accountId),
			),
		);
	return row ? { ok: true } : { ok: false, reason: "refused" };
}

/**
 * Records how a credit card's purchases get into Noodle (statements, by hand, or not at all), and
 * for one kept by hand the day of the month its statement closes. Refused unless it is the
 * Household's credit card, in use.
 */
export async function setCardKept(
	db: Db,
	input: {
		householdId: string;
		accountId: string;
		purchases: PurchasesGetIn;
		/** 1 to 31; left as it is when not given. */
		statementDay?: number | null;
	},
): Promise<{ ok: boolean }> {
	const changed = await db
		.update(accounts)
		.set({
			purchases: input.purchases,
			...(input.statementDay === undefined ? {} : { statementDay: input.statementDay }),
		})
		.where(
			and(
				ownAccount(input.householdId, input.accountId),
				eq(accounts.kind, "credit-card"),
				isNull(accounts.archivedAt),
			),
		)
		.returning({ id: accounts.id });
	return { ok: changed.length > 0 };
}

/** `memberId` when it is a Parent of the Household, else null: whose an Account may be. */
const parentOf = (householdId: string, memberId: string) =>
	sql<string | null>`(select m.id from members m where m.id = ${memberId}
		and m.household_id = ${householdId} and m.kind = 'parent')`;

/**
 * Says whose an Account is (ADR-0059): one of the Household's Parents, or null for the
 * Household's. Refused unless the Account is the Household's and the Member is one of its Parents.
 */
export async function setAccountWhose(
	db: Db,
	input: { householdId: string; accountId: string; whoseMemberId: string | null },
): Promise<{ ok: boolean }> {
	const { householdId, whoseMemberId } = input;
	const changed = await db
		.update(accounts)
		.set({ whoseMemberId })
		.where(
			and(
				ownAccount(householdId, input.accountId),
				whoseMemberId === null
					? undefined
					: sql`${parentOf(householdId, whoseMemberId)} is not null`,
			),
		)
		.returning({ id: accounts.id });
	return { ok: changed.length > 0 };
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
 * Records an Account's balance as a Parent entered it, true on `asOf` (a statement's closing
 * date, or today). Idempotent per `balanceId`. Refused unless the Account is the Household's.
 */
export async function updateAccountBalance(
	db: Db,
	input: {
		householdId: string;
		balanceId: string;
		accountId: string;
		amountCents: Cents;
		createdByMemberId: string;
		asOf?: DayKey | null;
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
						// Not an archived Account (ADR-0046).
						isNull(accounts.archivedAt),
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
			isNull(accounts.archivedAt),
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

/** The day a balance was true: its `as_of`, else the day it was recorded in the Household's time zone. */
const balanceDay = (row: { asOf: string | null; at: Date }, timeZone: string): DayKey =>
	(row.asOf as DayKey | null) ?? dayKeyAt(row.at, timeZone);

/**
 * What's owed now on a credit card or loan, as SQL: owedOn's twin (goals.test.ts holds it to
 * it). Its latest balance, and for an Account kept by hand less the payments filed in
 * Commitments that pay it down and dated after the balance's day. SQLite knows no time zones, so
 * the day of a balance without an `as_of` is `fallbackDay`, read by the caller just before
 * (readOwed); without one it's the UTC day.
 */
export const owedSql = (accountId: SQL | string, fallbackDay: DayKey | null = null) => {
	const day = sql`coalesce(b.as_of, ${fallbackDay}, date(b.created_at / 1000, 'unixepoch'))`;
	return sql<number | null>`(select case when oa.bank_connection_id is not null then b.amount_cents
		else b.amount_cents
			- coalesce((select sum(t.amount_cents) from transactions t
				inner join commitments c on c.id = t.commitment_id
				where c.account_id = b.account_id and t.household_id = b.household_id
				and t.date > ${day} and ${sql.raw(countsRaw("t.id"))}), 0)
			- coalesce((select sum(s.amount_cents) from splits s
				inner join transactions t on t.id = s.transaction_id
				inner join commitments c on c.id = s.commitment_id
				where c.account_id = b.account_id and s.household_id = b.household_id
				and t.date > ${day} and ${sql.raw(countsRaw("t.id"))}), 0)
			+ case when oa.purchases = 'hand' then
				coalesce((select sum(t.amount_cents) from transactions t
					where t.account_id = b.account_id and t.household_id = b.household_id
					and t.date > ${day} and ${sql.raw(NOT_MATCHED_QUICK_ADD("t.id"))}), 0)
				- coalesce((select sum(t.amount_cents) from transfers x
					inner join transactions t on t.id = x.out_transaction_id
					where x.other_account_id = b.account_id and x.household_id = b.household_id
					and x.removed_at is null and x.in_transaction_id is null and t.date > ${day}
					and ${sql.raw(SENT_ONCE)}), 0)
			else 0 end
		end
		from account_balances b inner join accounts oa on oa.id = b.account_id
		where b.account_id = ${accountId} order by b.created_at desc, b.id desc limit 1)`;
};

/**
 * The payments filed in Commitments that pay down a card or loan (ADR-0050), whole Transactions
 * then Splits, for the whole Household: a Commitment has no owner, and what's owed is one figure
 * for both Parents.
 */
const paymentQueries = (db: Db, householdId: string, accountId?: string) =>
	[
		db
			.select({
				id: transactions.id,
				accountId: commitments.accountId,
				// Not commitments.id: D1 hands a batch its rows keyed by column name, so two "id"s collapse
				// into one and every column after it shifts.
				commitmentId: transactions.commitmentId,
				amount: transactions.amountCents,
				date: transactions.date,
			})
			.from(transactions)
			.innerJoin(commitments, eq(commitments.id, transactions.commitmentId))
			.where(
				and(
					eq(transactions.householdId, householdId),
					accountId ? eq(commitments.accountId, accountId) : isNotNull(commitments.accountId),
					counts(),
				),
			),
		db
			.select({
				id: splits.transactionId,
				accountId: commitments.accountId,
				commitmentId: splits.commitmentId,
				amount: splits.amountCents,
				date: transactions.date,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.innerJoin(commitments, eq(commitments.id, splits.commitmentId))
			.where(
				and(
					eq(splits.householdId, householdId),
					accountId ? eq(commitments.accountId, accountId) : isNotNull(commitments.accountId),
					counts(),
				),
			),
	] as const;

/**
 * A line on a card kept by hand counts toward what's owed once: a Quick Add its statement's copy
 * was Matched with gives way to the copy, which is on the card and is the bank's own figure.
 */
const NOT_MATCHED_QUICK_ADD = (id: string) =>
	`not exists (select 1 from matches where matches.quick_add_id = ${id} and matches.removed_at is null)`;

/** A line on a card that is marked as a Transfer with no other side: a payment's card side, alone. */
const MARKED_ALONE = (id: string) =>
	`exists (select 1 from transfers ma where ma.in_transaction_id = ${id} and ma.removed_at is null
		and ma.out_transaction_id is null)`;

/**
 * sentOnce's twin, for a payment `t` in Transfer `x` naming the card of balance `b`: it still
 * comes off unless a line on the card marked alone already stands for it (same amount, within
 * CARD_PAYMENT_DAYS), each such line standing for the earliest payment only.
 */
const SENT_ONCE = `(select count(*) from transactions ct
		where ct.account_id = b.account_id and ct.household_id = b.household_id
		and ct.amount_cents = -t.amount_cents
		and abs(julianday(ct.date) - julianday(t.date)) <= ${CARD_PAYMENT_DAYS}
		and ${NOT_MATCHED_QUICK_ADD("ct.id")} and ${MARKED_ALONE("ct.id")})
	<= (select count(*) from transfers x2 inner join transactions t2 on t2.id = x2.out_transaction_id
		where x2.other_account_id = b.account_id and x2.household_id = b.household_id
		and x2.removed_at is null and x2.in_transaction_id is null
		and t2.amount_cents = t.amount_cents
		and abs(julianday(t2.date) - julianday(t.date)) <= ${CARD_PAYMENT_DAYS}
		and (t2.date < t.date or (t2.date = t.date and t2.id < t.id)))`;

/**
 * What moves what's owed on a card whose purchases are kept by hand (issue 136), for the whole
 * Household: every line recorded on the card (bought above 0, money back or a payment received
 * below), then the payments marked as a Transfer naming the card whose card side Noodle can't see.
 */
const byHandQueries = (db: Db, householdId: string, accountId?: string) =>
	[
		db
			.select({
				accountId: transactions.accountId,
				amount: transactions.amountCents,
				date: transactions.date,
				// A payment's card side marked on its own (sentOnce): 1 or 0.
				alone: sql<boolean>`${sql.raw(MARKED_ALONE('"transactions"."id"'))}`.as("alone"),
			})
			.from(transactions)
			.innerJoin(accounts, eq(accounts.id, transactions.accountId))
			.where(
				and(
					eq(transactions.householdId, householdId),
					eq(accounts.purchases, "hand"),
					isNull(accounts.bankConnectionId),
					accountId ? eq(transactions.accountId, accountId) : undefined,
					sql.raw(NOT_MATCHED_QUICK_ADD('"transactions"."id"')),
				),
			),
		db
			.select({
				id: transactions.id,
				accountId: transfers.otherAccountId,
				amount: transactions.amountCents,
				date: transactions.date,
			})
			.from(transfers)
			.innerJoin(transactions, eq(transactions.id, transfers.outTransactionId))
			.innerJoin(accounts, eq(accounts.id, transfers.otherAccountId))
			.where(
				and(
					eq(transfers.householdId, householdId),
					isNull(transfers.removedAt),
					isNull(transfers.inTransactionId),
					eq(accounts.purchases, "hand"),
					accountId ? eq(transfers.otherAccountId, accountId) : undefined,
				),
			),
	] as const;

const transferIn = alias(transactions, "transfer_in");

/**
 * Every payment marked as a Transfer to one of the Household's cards or loans, however the card
 * is kept: one naming the card alone (its card side isn't in Noodle), and one paired with the
 * card's own line from its bank or statement. For the card's page; only byHandQueries' move
 * what's owed.
 */
const cardTransfersQuery = (db: Db, householdId: string) =>
	db
		.select({
			id: transactions.id,
			accountId: sql<string>`coalesce(${transferIn.accountId}, ${transfers.otherAccountId})`.as(
				"card_id",
			),
			amount: transactions.amountCents,
			date: transactions.date,
		})
		.from(transfers)
		.innerJoin(transactions, eq(transactions.id, transfers.outTransactionId))
		.leftJoin(transferIn, eq(transferIn.id, transfers.inTransactionId))
		.innerJoin(
			accounts,
			sql`${accounts.id} = coalesce(${transferIn.accountId}, ${transfers.otherAccountId})`,
		)
		.where(
			and(
				eq(transfers.householdId, householdId),
				isNull(transfers.removedAt),
				inArray(accounts.kind, ["credit-card", "loan"]),
			),
		);

/**
 * What's owed now on one of the Household's Accounts (owedOn), and its latest balance's day.
 * With `upTo`, what was owed at the end of that day: later payments and purchases are left out.
 */
async function readOwed(
	db: Db,
	input: {
		householdId: string;
		accountId: string;
		upTo?: DayKey;
		/** A balance to read as if it weren't recorded yet: the one a balance check is writing. */
		notBalanceId?: string;
	},
): Promise<{ owed: Cents | null; day: DayKey | null }> {
	const [balanceRows, accountRows, whole, split, bought, sent] = await db.batch([
		db
			.select({
				amount: accountBalances.amountCents,
				at: accountBalances.createdAt,
				asOf: accountBalances.asOf,
			})
			.from(accountBalances)
			.where(
				and(
					eq(accountBalances.accountId, input.accountId),
					eq(accountBalances.householdId, input.householdId),
					input.notBalanceId ? ne(accountBalances.id, input.notBalanceId) : undefined,
				),
			)
			.orderBy(desc(accountBalances.createdAt), desc(accountBalances.id))
			.limit(1),
		db
			.select({ bankConnectionId: accounts.bankConnectionId, timeZone: households.timeZone })
			.from(accounts)
			.innerJoin(households, eq(households.id, accounts.householdId))
			.where(ownAccount(input.householdId, input.accountId)),
		...paymentQueries(db, input.householdId, input.accountId),
		...byHandQueries(db, input.householdId, input.accountId),
	]);
	const [balance] = balanceRows;
	const [account] = accountRows;
	if (!balance || !account) return { owed: null, day: null };
	const day = balanceDay(balance, account.timeZone);
	const upTo = input.upTo;
	const by = (rows: readonly { amount: number; date: string }[]) =>
		(upTo ? rows.filter((row) => row.date <= upTo) : rows) as OwedPayment[];
	const owed = owedOn(
		{ amount: balance.amount, day },
		by([...whole, ...split, ...sent.map((row) => ({ ...row, sent: true }))]),
		account.bankConnectionId !== null,
		by(bought),
	);
	return { owed, day };
}

/**
 * The monthly balance check on a card (issue 136): compares the statement's balance a Parent
 * typed, true on `asOf`, with what Noodle had recorded as owed at the end of that day, then
 * records the statement's as the card's balance, the new starting point (ADR-0050). Idempotent
 * per `balanceId`: sent again, it compares with what was recorded before this check's own
 * balance, so the answer is the first one.
 */
export async function checkStatementBalance(
	db: Db,
	input: {
		householdId: string;
		accountId: string;
		balanceId: string;
		statementCents: Cents;
		asOf: DayKey;
		createdByMemberId: string;
	},
): Promise<{ ok: true; check: BalanceCheck; recordedCents: Cents | null } | { ok: false }> {
	const [account] = await db
		.select({ id: accounts.id })
		.from(accounts)
		.where(
			and(
				ownAccount(input.householdId, input.accountId),
				inArray(accounts.kind, ["credit-card", "loan"]),
				isNull(accounts.archivedAt),
			),
		);
	if (!account) return { ok: false };
	const { owed } = await readOwed(db, {
		householdId: input.householdId,
		accountId: input.accountId,
		upTo: input.asOf,
		notBalanceId: input.balanceId,
	});
	await insertBalance(db, { ...input, amountCents: input.statementCents });
	return { ok: true, check: balanceCheck(input.statementCents, owed), recordedCents: owed };
}

/** The statement day a card kept by hand is due a balance check for (statementCheckDue), else null. */
export const balanceCheckDue = (
	account: {
		purchases: PurchasesGetIn | null;
		statementDay: number | null;
		bankConnectionId: string | null;
		latestBalance: { day?: DayKey } | null;
	},
	today: DayKey,
): DayKey | null =>
	account.purchases === "hand" && account.bankConnectionId === null
		? statementCheckDue({
				statementDay: account.statementDay,
				today,
				lastBalanceDay: account.latestBalance?.day ?? null,
			})
		: null;

/** What's owed now on one of the Household's credit cards or loans (owedOn); null without a balance. */
export async function owedNow(
	db: Db,
	input: { householdId: string; accountId: string },
): Promise<Cents | null> {
	return (await readOwed(db, input)).owed;
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
	const { day } = await readOwed(db, input);
	const guard = and(
		ownAccount(input.householdId, input.accountId),
		inArray(accounts.kind, ["credit-card", "loan"]),
		isNull(accounts.archivedAt),
		sql`${input.targetCents} > 0`,
		sql`${owedSql(sql`${accounts.id}`, day)} = ${input.targetCents}`,
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
	const [goal] = await db
		.select({ accountId: goals.accountId })
		.from(goals)
		.where(ownGoal(input.householdId, input.goalId));
	if (!goal) return { ok: false, reason: "refused" };
	const { day } = await readOwed(db, { householdId: input.householdId, accountId: goal.accountId });
	const guard = and(
		ownGoal(input.householdId, input.goalId),
		eq(goals.kind, "payoff"),
		isNull(goals.completedAt),
		isNull(goals.archivedAt),
		sql`${input.owedCents} > 0`,
		sql`${owedSql(sql`${goals.accountId}`, day)} = ${input.owedCents}`,
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
		/** What earlier months carried into `month`'s Free to Spend (see loadFreeCarriedIn). */
		freeCarriedInCents?: Cents;
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
						sql`${freeToSpendSql(householdId, month, input.freeCarriedInCents)} >= ${input.amountCents}`,
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
					version: sql<number>`0`.as("version"),
					bankTookBackOn: sql<string | null>`null`.as("bank_took_back_on"),
					bankAmountCents: sql<number | null>`null`.as("bank_amount_cents"),
					reviewClearedByMemberId: sql<string | null>`null`.as("review_cleared_by_member_id"),
					reviewClearedAt: sql<Date | null>`null`.as("review_cleared_at"),
					bankDate: sql<string | null>`null`.as("bank_date"),
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
	/** The account number's last four digits, when known. */
	mask: string | null;
	kind: AccountKind;
	/** The latest balance a Parent entered, with the day it was true; null until one is. */
	latestBalance: BalanceUpdate | null;
	/**
	 * What's owed on a credit card or loan now (owedOn): its latest balance, less the payments
	 * filed since in Commitments that pay it down when it's kept by hand. Null for an Account that
	 * holds money, and until it has a balance.
	 */
	owed: Cents | null;
	/** The Bank Connection that brought it in; null for one entered by hand. */
	bankConnectionId: string | null;
	/** The last day a statement uploaded to it covers; null when none was. */
	lastStatementDate: DayKey | null;
	/** A credit card's answer to how its purchases get in; null until asked (cardKept). */
	purchases: PurchasesGetIn | null;
	/** The Wallet card name a Parent said is this Account; null until asked. */
	walletName: string | null;
	/** The day of the month its statement closes, for the monthly balance check; null until set. */
	statementDay: number | null;
	/** Whose it is: a Parent's Member id, or null for the Household's (ADR-0059). */
	whose: string | null;
	/** A loan's facts as a Parent said them (issue 153); left out for any other kind. */
	loan?: LoanFacts;
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
	/** When it was marked completed (epoch ms), or null. */
	completedAt: number | null;
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
	/**
	 * Every payment filed in a Commitment that pays down a card or loan (ADR-0050), oldest first
	 * by its day; `id` is its Transaction's.
	 */
	payments: (OwedPayment & { id: string; accountId: string; commitmentId: string })[];
	/**
	 * The payments marked as a Transfer to a card or loan, however it's kept; `id` is the paying
	 * Transaction's. `comesOff` on those that bring what's owed down: one naming a card kept by
	 * hand, whose card side Noodle can't see (issue 136). Optional so older fixtures needn't say.
	 */
	sent?: (OwedPayment & { id: string; accountId: string; comesOff?: boolean })[];
	/** The Goal the Household keeps for emergencies, if it has marked one. */
	emergencyGoalId: string | null;
	/**
	 * The Accounts a Parent archived (ADR-0046), the latest first: in none of `accounts`' lists,
	 * pickers or totals, listed only to be restored.
	 */
	archivedAccounts: ArchivedAccount[];
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
		archivedRows,
		paymentRows,
		splitPaymentRows,
		boughtRows,
		sentRows,
		cardTransferRows,
	] = await db.batch([
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				mask: accounts.mask,
				kind: accounts.kind,
				bankConnectionId: accounts.bankConnectionId,
				purchases: accounts.purchases,
				walletName: accounts.walletName,
				statementDay: accounts.statementDay,
				whose: accounts.whoseMemberId,
				borrowed: accounts.borrowedCents,
				payment: accounts.paymentCents,
				dueDay: accounts.dueDay,
				endsOn: accounts.endsOn,
				// Spelled out: inside a select's fields Drizzle leaves column names unqualified.
				lastStatementDate: sql<string | null>`(select max(i.last_date) from imports i
					where i.account_id = "accounts"."id" and i.source <> 'bank')`,
			})
			.from(accounts)
			// Archived Accounts are out of every list, picker and total built from these (ADR-0046).
			.where(and(eq(accounts.householdId, householdId), isNull(accounts.archivedAt)))
			.orderBy(asc(accounts.createdAt), asc(accounts.id)),
		db
			.select({
				accountId: accountBalances.accountId,
				amount: accountBalances.amountCents,
				at: accountBalances.createdAt,
				asOf: accountBalances.asOf,
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
			.select({ emergencyGoalId: households.emergencyGoalId, timeZone: households.timeZone })
			.from(households)
			.where(eq(households.id, householdId)),
		db
			.select({
				id: accounts.id,
				name: accounts.name,
				mask: accounts.mask,
				kind: accounts.kind,
				archivedAt: accounts.archivedAt,
			})
			.from(accounts)
			.where(and(eq(accounts.householdId, householdId), isNotNull(accounts.archivedAt)))
			.orderBy(desc(accounts.archivedAt), asc(accounts.id)),
		...paymentQueries(db, householdId),
		...byHandQueries(db, householdId),
		cardTransfersQuery(db, householdId),
	]);
	const spendingRows = [
		...wholeRows,
		// Transactions are recorded to the second: a Split counts as after a balance entered in
		// that same second, like a tie.
		...splitRows.map((row) => ({ ...row, at: new Date(row.at.getTime() + 999) })),
	];
	// Oldest first, so the last one per Account is its latest.
	const timeZone = householdRows[0]?.timeZone ?? "UTC";
	const latest = new Map<string, BalanceUpdate & { day: DayKey }>();
	for (const row of balanceRows) {
		latest.set(row.accountId, {
			amount: row.amount,
			at: row.at.getTime(),
			day: balanceDay(row, timeZone),
		});
	}
	// commitment.account_id is filtered to non-null; dates are always written as DayKeys.
	const payments = ([...paymentRows, ...splitPaymentRows] as GoalRecords["payments"]).sort(
		(a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
	);
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
		accounts: accountRows.map(({ borrowed, payment, dueDay, endsOn, ...row }) => {
			const latestBalance = latest.get(row.id) ?? null;
			return {
				...row,
				...(row.kind === "loan"
					? { loan: { borrowed, payment, dueDay, endsOn: endsOn as DayKey | null } }
					: {}),
				lastStatementDate: row.lastStatementDate as DayKey | null,
				latestBalance,
				owed: holdsMoney(row.kind)
					? null
					: owedOn(
							latestBalance,
							[
								...payments,
								...(sentRows as (OwedPayment & { accountId: string })[]).map((p) => ({
									...p,
									sent: true,
								})),
							].filter((p) => p.accountId === row.id),
							row.bankConnectionId !== null,
							(boughtRows as (OwedPayment & { accountId: string })[]).filter(
								(p) => p.accountId === row.id,
							),
						),
			};
		}),
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
			completedAt: row.completedAt?.getTime() ?? null,
			archived: row.archivedAt !== null,
		})),
		changes,
		owed: balanceRows
			.filter((row) => accountRows.some((a) => a.id === row.accountId && !holdsMoney(a.kind)))
			.map((row) => ({
				accountId: row.accountId,
				amount: row.amount,
				at: row.at.getTime(),
				day: balanceDay(row, timeZone),
			})),
		payments,
		sent: (cardTransferRows as (OwedPayment & { id: string; accountId: string })[]).map(
			({ id, accountId, amount, date }) => ({
				id,
				accountId,
				amount,
				date,
				comesOff: sentRows.some((row) => row.id === id),
			}),
		),
		emergencyGoalId: householdRows[0]?.emergencyGoalId ?? null,
		archivedAccounts: archivedRows.map((row) => ({
			...row,
			archivedAt: row.archivedAt?.getTime() ?? 0,
		})),
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
