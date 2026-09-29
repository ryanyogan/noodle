import {
	addMonths,
	type Cadence,
	type Cents,
	type Charge,
	type DayKey,
	type MonthKey,
	type PlanScope,
	restoreAfterJust,
} from "@noodle/domain";
import { and, eq, gt, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { counts } from "./counting";
import type { Db } from "./index";
import { type Viewer, visibleTo } from "./privacy";
import { commitments, commitmentTerms, splits, transactions } from "./schema";

// A Household's Commitments and the payments recorded against them. Every query is scoped by
// household_id; Commitment IDs from the client are only ever used together with it. Writes are
// idempotent (ADR-0004), so a retried save lands once.

type Terms = { amountCents: Cents; cadence: Cadence; dueDate: DayKey };

/** Guards a write to only land if the Commitment belongs to the Household. */
export const ownCommitment = (householdId: string, commitmentId: string) =>
	and(eq(commitments.id, commitmentId), eq(commitments.householdId, householdId));

/** Guards a write to only land if the Commitment is in the Plan for `month`. */
export const inPlanFor = (month: string) =>
	and(
		lte(commitments.fromMonth, month),
		or(isNull(commitments.endedFromMonth), gt(commitments.endedFromMonth, month)),
	);

/** insert into commitment_terms select … from commitments where <it's the Household's> */
const termsFor = (
	db: Db,
	input: { householdId: string; commitmentId: string; month: MonthKey } & Terms,
) =>
	db.insert(commitmentTerms).select(
		db
			.select({
				householdId: commitments.householdId,
				commitmentId: commitments.id,
				month: sql<string>`${input.month}`.as("month"),
				amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
				cadence: sql<Cadence>`${input.cadence}`.as("cadence"),
				dueDate: sql<string>`${input.dueDate}`.as("due_date"),
			})
			.from(commitments)
			.where(ownCommitment(input.householdId, input.commitmentId)),
	);

/**
 * Adds a Commitment to the Plan from `month` onward on its first terms. Idempotent per
 * `commitmentId`: a retry leaves the first attempt's Commitment as it was.
 */
export async function addCommitment(
	db: Db,
	input: { householdId: string; commitmentId: string; name: string; month: MonthKey } & Terms,
): Promise<void> {
	await db.batch(commitmentAdd(db, input));
}

/**
 * addCommitment as statements, for writing them in a batch with others; `endedFromMonth` also
 * sets when it ends (a loan's last month + 1), null for good.
 */
export const commitmentAdd = (
	db: Db,
	input: {
		householdId: string;
		commitmentId: string;
		name: string;
		month: MonthKey;
		endedFromMonth?: MonthKey | null;
	} & Terms,
) =>
	[
		db
			.insert(commitments)
			.values({
				id: input.commitmentId,
				householdId: input.householdId,
				name: input.name,
				fromMonth: input.month,
				endedFromMonth: input.endedFromMonth ?? null,
			})
			.onConflictDoNothing({ target: commitments.id }),
		termsFor(db, input).onConflictDoNothing({
			target: [commitmentTerms.commitmentId, commitmentTerms.month],
		}),
	] as const;

/**
 * Renames a Commitment (in every month) and sets its terms from `month` onward, or for `scope`
 * "just" that month only: the next month goes back to the terms in force before, unless it has
 * its own. Setting them again for the same month replaces them.
 */
export async function updateCommitment(
	db: Db,
	input: {
		householdId: string;
		commitmentId: string;
		name: string;
		month: MonthKey;
		scope?: PlanScope;
	} & Terms,
): Promise<void> {
	const rename = db
		.update(commitments)
		.set({ name: input.name })
		.where(ownCommitment(input.householdId, input.commitmentId));
	const write = termsFor(db, input).onConflictDoUpdate({
		target: [commitmentTerms.commitmentId, commitmentTerms.month],
		set: { amountCents: input.amountCents, cadence: input.cadence, dueDate: input.dueDate },
	});
	const series =
		input.scope === "just"
			? await db
					.select({
						month: commitmentTerms.month,
						amountCents: commitmentTerms.amountCents,
						cadence: commitmentTerms.cadence,
						dueDate: commitmentTerms.dueDate,
					})
					.from(commitmentTerms)
					.where(
						and(
							eq(commitmentTerms.householdId, input.householdId),
							eq(commitmentTerms.commitmentId, input.commitmentId),
							lte(commitmentTerms.month, addMonths(input.month, 1)),
						),
					)
			: [];
	const restore = restoreAfterJust(series as ({ month: MonthKey } & Terms)[], input.month);
	if (!restore) {
		await db.batch([rename, write]);
		return;
	}
	await db.batch([
		rename,
		// Guarded like the change itself; the next month's own terms always win, even ones
		// written since the read above.
		termsFor(db, { ...input, ...restore }).onConflictDoNothing({
			target: [commitmentTerms.commitmentId, commitmentTerms.month],
		}),
		write,
	]);
}

/**
 * Takes a Commitment out of the Plan from `month` onward; earlier months keep it. Ending it
 * from a later month than it already was is a no-op.
 */
export async function endCommitment(db: Db, input: EndCommitmentInput): Promise<void> {
	await commitmentEnd(db, input);
}

type EndCommitmentInput = { householdId: string; commitmentId: string; month: MonthKey };

/** endCommitment as a statement, for writing it in a batch with others. */
export const commitmentEnd = (db: Db, input: EndCommitmentInput) =>
	db
		.update(commitments)
		.set({ endedFromMonth: input.month })
		.where(
			and(
				ownCommitment(input.householdId, input.commitmentId),
				or(isNull(commitments.endedFromMonth), gt(commitments.endedFromMonth, input.month)),
			),
		);

/** A payment recorded against a Commitment, with the Transaction's ID. */
export type CommitmentCharge = Charge & { id: string };

/**
 * The month's Transactions assigned to Commitments, whole or through Splits, as `viewer` may see
 * them. A split Transaction's Splits paying the same Commitment are one charge of it (see
 * assignedParts in @noodle/domain).
 */
export async function loadCharges(
	db: Db,
	viewer: Viewer,
	month: MonthKey,
): Promise<CommitmentCharge[]> {
	const inMonth = and(
		visibleTo(viewer),
		counts(),
		gte(transactions.date, `${month}-01`),
		lte(transactions.date, `${month}-31`),
	);
	const [whole, split] = await db.batch([
		db
			.select({
				id: transactions.id,
				commitmentId: transactions.commitmentId,
				amount: transactions.amountCents,
				date: transactions.date,
			})
			.from(transactions)
			.where(and(inMonth, isNotNull(transactions.commitmentId))),
		db
			.select({
				id: splits.transactionId,
				commitmentId: splits.commitmentId,
				amount: sql<number>`sum(${splits.amountCents})`,
				date: transactions.date,
			})
			.from(splits)
			.innerJoin(transactions, eq(transactions.id, splits.transactionId))
			.where(
				and(inMonth, eq(splits.householdId, viewer.householdId), isNotNull(splits.commitmentId)),
			)
			.groupBy(splits.transactionId, splits.commitmentId),
	]);
	// commitment_id is filtered to non-null, and dates are always written as DayKeys.
	return [...whole, ...split] as CommitmentCharge[];
}

export type CommitmentPaymentResult = { ok: true } | { ok: false; reason: "not-in-plan" };

/**
 * Records a payment of a Commitment as a Quick Add: a Transaction of `amountCents` on `date`,
 * assigned to the Commitment. Idempotent per `transactionId`. It is only written if, at write
 * time, the Commitment belongs to the Household and is in the Plan for `date`'s month.
 */
export async function addCommitmentPayment(
	db: Db,
	input: {
		householdId: string;
		transactionId: string;
		commitmentId: string;
		date: DayKey;
		amountCents: Cents;
		createdByMemberId: string;
	},
): Promise<CommitmentPaymentResult> {
	await db
		.insert(transactions)
		.select(
			db
				.select({
					id: sql<string>`${input.transactionId}`.as("id"),
					householdId: commitments.householdId,
					source: sql<"quick-add">`'quick-add'`.as("source"),
					date: sql<string>`${input.date}`.as("date"),
					amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
					bucketId: sql<string | null>`null`.as("bucket_id"),
					note: sql<string | null>`null`.as("note"),
					createdByMemberId: sql<string>`${input.createdByMemberId}`.as("created_by_member_id"),
					createdAt: sql<Date>`(unixepoch() * 1000)`.as("created_at"),
					// Selected in the table's column order: insert … select is positional.
					commitmentId: commitments.id,
					accountId: sql<string | null>`null`.as("account_id"),
					goalId: sql<string | null>`null`.as("goal_id"),
					importId: sql<string | null>`null`.as("import_id"),
					externalId: sql<string | null>`null`.as("external_id"),
					capturedVia: sql<string | null>`null`.as("captured_via"),
				})
				.from(commitments)
				.where(
					and(
						ownCommitment(input.householdId, input.commitmentId),
						inPlanFor(input.date.slice(0, 7)),
					),
				),
		)
		.onConflictDoNothing({ target: transactions.id });
	// Either this call or an earlier attempt with the same ID wrote it, or it was refused.
	const [written] = await db
		.select({ id: transactions.id })
		.from(transactions)
		.where(
			and(
				eq(transactions.id, input.transactionId),
				eq(transactions.householdId, input.householdId),
			),
		);
	return written ? { ok: true } : { ok: false, reason: "not-in-plan" };
}
