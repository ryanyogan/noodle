import {
	addAccount as addAccountInDb,
	addGoal as addGoalInDb,
	addPayoffGoal as addPayoffGoalInDb,
	archiveGoal as archiveGoalInDb,
	claimForGoal as claimForGoalInDb,
	completeGoal as completeGoalInDb,
	fundGoal as fundGoalInDb,
	type GoalRecords,
	type GoalWriteResult,
	loadFreeCarriedInto,
	loadGoals,
	owedNow,
	renameAccount as renameAccountInDb,
	restartPayoffGoal as restartPayoffGoalInDb,
	setEmergencyGoal as setEmergencyGoalInDb,
	spendGoal as spendGoalInDb,
	undoGoalFunding as undoGoalFundingInDb,
	updateAccountBalance as updateAccountBalanceInDb,
	updateGoal as updateGoalInDb,
} from "@noodle/db";
import {
	ACCOUNT_KINDS,
	type Cents,
	type DayKey,
	dayKeyAt,
	GOAL_KINDS,
	MAX_CENTS,
	type MonthKey,
	monthKeyAt,
	monthState,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware, viewerOf } from "./household";
import { loadMonth, monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { dayKeySchema, ulidSchema } from "./schemas";

// Accounts, Goals and what their Goals have set aside. Each write is idempotent per its client ULID, so the client
// can retry it safely; a write the database guard refuses comes back as `{ ok: false }` rather
// than an error. The month and day are always the Household's, worked out here.

/**
 * Every Account, Goal and set-aside money change, with the Household's current month and today:
 * components derive balances, not set aside and progress from these with @noodle/domain, so an
 * optimistic edit updates every number the same way the server would.
 */
export type GoalsData = GoalRecords & { month: MonthKey; asOf: DayKey };

export type { GoalWriteResult };

/** Refused Goal funding says what Free to Spend had left, to explain why. */
export type FundGoalOutcome = { ok: true } | { ok: false; freeToSpend: Cents };

export const goalNameSchema = z.string().trim().min(1).max(40);
const amountSchema = z.number().int().min(1).max(MAX_CENTS);
const balanceSchema = z.number().int().min(0).max(MAX_CENTS);

const today = (household: Pick<HouseholdSummary, "timeZone">) =>
	dayKeyAt(new Date(), household.timeZone);

const currentMonth = (household: Pick<HouseholdSummary, "timeZone">) =>
	monthKeyAt(new Date(), household.timeZone);

/** Goal funding happens within the current month: earlier months are closed, later ones haven't begun. */
function assertCurrentMonth(household: Pick<HouseholdSummary, "timeZone">, month: MonthKey) {
	if (month !== currentMonth(household)) {
		throw new Error("Only this month’s Plan can fund a Goal.");
	}
}

function assertNotPast(household: Pick<HouseholdSummary, "timeZone">, targetDate: DayKey | null) {
	if (targetDate !== null && targetDate < today(household)) {
		throw new Error("A Goal’s target date can’t be in the past.");
	}
}

export const getGoals = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<GoalsData> => {
		const records = await loadGoals(getDb(), viewerOf(context));
		return { ...records, month: currentMonth(context.household), asOf: today(context.household) };
	});

/** Adds an Account, with its balance now if the Parent knows it. */
export const addAccount = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			accountId: ulidSchema,
			name: goalNameSchema,
			kind: z.enum(ACCOUNT_KINDS),
			/** For a credit card or loan, what's owed. */
			balanceCents: balanceSchema.nullable(),
			balanceId: ulidSchema,
		}),
	)
	.handler(async ({ data, context }) => {
		await addAccountInDb(getDb(), {
			householdId: context.household.id,
			createdByMemberId: context.parent.id,
			...data,
			asOf: today(context.household),
		});
		await notifyHousehold(context.household.id, ["goals"]);
	});

export const renameAccount = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ accountId: ulidSchema, name: goalNameSchema }))
	.handler(async ({ data, context }) => {
		await renameAccountInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["goals"]);
	});

/**
 * Records an Account's balance: as it is today, or as a statement had it on its closing date
 * (`asOf`, never later than today). Payments filed after that day in a Commitment that pays the
 * Account down come off what's owed (ADR-0050).
 */
export const updateAccountBalance = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			balanceId: ulidSchema,
			accountId: ulidSchema,
			amountCents: balanceSchema,
			asOf: dayKeySchema.optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const now = today(context.household);
		const result = await updateAccountBalanceInDb(getDb(), {
			householdId: context.household.id,
			createdByMemberId: context.parent.id,
			...data,
			asOf: data.asOf && data.asOf < now ? data.asOf : now,
		});
		if (result.ok) await notifyHousehold(context.household.id, ["goals"]);
		return result;
	});

/**
 * Adds a Goal from this month. A savings Goal is backed by a checking or savings Account, with
 * `claimCents` of the Account's not set aside money already set aside for it (0 for none). A
 * payoff Goal (ADR-0019) pays down a credit card or loan: its target is what's owed on it now,
 * read here (the client's `targetCents` only shows it until the refetch), and it sets nothing
 * aside. Refused when the card or loan owes nothing, or already has an active payoff Goal.
 */
export const addGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			goalId: ulidSchema,
			kind: z.enum(GOAL_KINDS).default("save"),
			accountId: ulidSchema,
			name: goalNameSchema,
			targetCents: amountSchema,
			targetDate: dayKeySchema.nullable(),
			claimId: ulidSchema,
			claimCents: balanceSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const { household } = context;
		assertNotPast(household, data.targetDate);
		const month = currentMonth(household);
		const db = getDb();
		let result: GoalWriteResult;
		if (data.kind === "payoff") {
			const owed = await owedNow(db, { householdId: household.id, accountId: data.accountId });
			result =
				owed === null || owed <= 0
					? { ok: false, reason: "refused" }
					: await addPayoffGoalInDb(db, {
							householdId: household.id,
							goalId: data.goalId,
							accountId: data.accountId,
							name: data.name,
							targetCents: owed,
							targetDate: data.targetDate,
							fromMonth: month,
							createdByMemberId: context.parent.id,
						});
		} else {
			result = await addGoalInDb(db, {
				householdId: household.id,
				fromMonth: month,
				createdByMemberId: context.parent.id,
				...data,
			});
		}
		// The month's Plan history has the new Goal.
		if (result.ok) await notifyHousehold(household.id, ["goals", `month:${month}`]);
		return result;
	});

/**
 * Starts a payoff Goal again from today's balance (ADR-0019): its target becomes what's owed on
 * its card or loan now, and its schedule starts this month. Refused when nothing is owed.
 */
export const restartPayoffGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ goalId: ulidSchema }))
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const { household } = context;
		const db = getDb();
		const { goals } = await loadGoals(db, viewerOf(context));
		const goal = goals.find((g) => g.id === data.goalId && g.kind === "payoff");
		const owed = goal
			? await owedNow(db, { householdId: household.id, accountId: goal.accountId })
			: null;
		if (!goal || owed === null || owed <= 0) return { ok: false, reason: "refused" };
		const month = currentMonth(household);
		const result = await restartPayoffGoalInDb(db, {
			householdId: household.id,
			memberId: context.parent.id,
			goalId: goal.id,
			month,
			owedCents: owed,
		});
		if (result.ok) await notifyHousehold(household.id, ["goals", `month:${month}`]);
		return result;
	});

/** Changes a Goal's name, target and target date. A past target date may only be kept, not set. */
export const updateGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			goalId: ulidSchema,
			name: goalNameSchema,
			targetCents: amountSchema,
			targetDate: dayKeySchema.nullable(),
		}),
	)
	.handler(async ({ data, context }) => {
		const { household } = context;
		const db = getDb();
		if (data.targetDate !== null && data.targetDate < today(household)) {
			const { goals } = await loadGoals(db, viewerOf(context));
			const goal = goals.find((g) => g.id === data.goalId);
			if (goal?.targetDate !== data.targetDate) assertNotPast(household, data.targetDate);
		}
		const month = currentMonth(household);
		await updateGoalInDb(db, {
			householdId: household.id,
			memberId: context.parent.id,
			month,
			...data,
		});
		// Its Plan change shows in this month's history.
		await notifyHousehold(household.id, ["goals", `month:${month}`]);
	});

/** Marks a Goal completed; it keeps what it has set aside. */
export const completeGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ goalId: ulidSchema }))
	.handler(async ({ data, context }) => {
		await completeGoalInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["goals"]);
	});

/** Archives a Goal, releasing what it has set aside to its Account's not set aside money. */
export const archiveGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ goalId: ulidSchema }))
	.handler(async ({ data, context }) => {
		await archiveGoalInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["goals"]);
	});

/**
 * Sets not set aside money aside for a Goal, or releases some of what it has set aside back (a negative
 * amount). Refused when releasing more than what's set aside, or when the Goal is archived.
 */
export const claimForGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			claimId: ulidSchema,
			goalId: ulidSchema,
			amountCents: z
				.number()
				.int()
				.min(-MAX_CENTS)
				.max(MAX_CENTS)
				.refine((amount) => amount !== 0, "Expected an amount"),
		}),
	)
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const { household } = context;
		const result = await claimForGoalInDb(getDb(), {
			householdId: household.id,
			month: currentMonth(household),
			createdByMemberId: context.parent.id,
			...data,
		});
		if (result.ok) await notifyHousehold(household.id, ["goals"]);
		return result;
	});

/**
 * Goal funding: Moves `amountCents` from this month's Free to Spend into what a Goal has set aside.
 * Refused unless Free to Spend has that much and the Goal is active.
 */
export const fundGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			moveId: ulidSchema,
			goalId: ulidSchema,
			month: monthKeySchema,
			amountCents: amountSchema,
		}),
	)
	.handler(async ({ data, context }): Promise<FundGoalOutcome> => {
		const { household } = context;
		assertCurrentMonth(household, data.month);
		const db = getDb();
		const result = await fundGoalInDb(db, {
			householdId: household.id,
			createdByMemberId: context.parent.id,
			// Free to Spend that builds up has last month's leftover to fund from (issue 113).
			freeCarriedInCents: await loadFreeCarriedInto(db, household.id, data.month),
			...data,
		});
		if (!result.ok) {
			const { freeToSpend } = monthState(
				await loadMonth(db, household, context.parent.id, data.month),
			);
			return { ok: false, freeToSpend: Math.max(0, freeToSpend) };
		}
		await notifyHousehold(household.id, ["goals", `month:${data.month}`]);
		return { ok: true };
	});

/**
 * Undoes Goal funding, putting the money back in Free to Spend. Refused once the Goal's
 * set-aside money is less than the funding (some of it was spent or released).
 */
export const undoGoalFunding = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ moveId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const { household } = context;
		assertCurrentMonth(household, data.month);
		const result = await undoGoalFundingInDb(getDb(), { householdId: household.id, ...data });
		if (result.ok) await notifyHousehold(household.id, ["goals", `month:${data.month}`]);
		return result;
	});

/**
 * Marks a Goal as the Household's emergency Goal (null clears it): suggested for Extra income, and
 * where resets monthly leftovers are Swept when nobody decides at month-close.
 */
export const setEmergencyGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ goalId: ulidSchema.nullable() }))
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const { household } = context;
		const result = await setEmergencyGoalInDb(getDb(), { householdId: household.id, ...data });
		if (result.ok) await notifyHousehold(household.id, ["goals"]);
		return result;
	});

/**
 * Records Goal spending today: a Transaction out of what the Goal has set aside and its Account, never a
 * Bucket or Free to Spend. Refused when it's more than what's set aside or the Goal is archived.
 */
export const spendGoal = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			transactionId: ulidSchema,
			goalId: ulidSchema,
			amountCents: amountSchema,
			note: z.string().trim().max(80).optional(),
		}),
	)
	.handler(async ({ data, context }): Promise<GoalWriteResult> => {
		const { household } = context;
		const date = today(household);
		const result = await spendGoalInDb(getDb(), {
			householdId: household.id,
			transactionId: data.transactionId,
			goalId: data.goalId,
			date,
			amountCents: data.amountCents,
			note: data.note || null,
			createdByMemberId: context.parent.id,
		});
		// The month's Transactions list shows it.
		if (result.ok) {
			await notifyHousehold(household.id, ["goals", `month:${currentMonth(household)}`]);
		}
		return result;
	});
