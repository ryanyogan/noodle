import {
	addMonths,
	type Cents,
	type MonthKey,
	type PlanRecords,
	type PlanScope,
	restoreAfterJust,
} from "@noodle/domain";
import { and, eq, gt, isNull, lte, or, type SQL, sql } from "drizzle-orm";
import type { Db } from "./index";
import { assignableBy } from "./privacy";
import {
	baselines,
	bucketAllowances,
	bucketRolling,
	buckets,
	commitments,
	commitmentTerms,
} from "./schema";

// The Plan's records for a Household (ADR-0004: effective-dated rows, written idempotently so a
// retried save lands once). Every query is scoped by household_id; bucket IDs from the client
// are only ever used together with it.

/** Every Plan record that can affect `month` or earlier, for planForMonth. */
export async function loadPlanRecords(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<PlanRecords> {
	const [baselineRows, bucketRows, allowanceRows, commitmentRows, termRows, rollingRows] =
		await db.batch([
			db
				.select({ month: baselines.month, amount: baselines.amountCents })
				.from(baselines)
				.where(and(eq(baselines.householdId, householdId), lte(baselines.month, month))),
			db
				.select({
					id: buckets.id,
					name: buckets.name,
					color: buckets.color,
					position: buckets.position,
					fromMonth: buckets.fromMonth,
					archivedFromMonth: buckets.archivedFromMonth,
					owner: buckets.ownerMemberId,
				})
				.from(buckets)
				.where(and(eq(buckets.householdId, householdId), lte(buckets.fromMonth, month))),
			db
				.select({
					bucketId: bucketAllowances.bucketId,
					month: bucketAllowances.month,
					amount: bucketAllowances.amountCents,
				})
				.from(bucketAllowances)
				.where(
					and(eq(bucketAllowances.householdId, householdId), lte(bucketAllowances.month, month)),
				),
			db
				.select({
					id: commitments.id,
					name: commitments.name,
					fromMonth: commitments.fromMonth,
					endedFromMonth: commitments.endedFromMonth,
				})
				.from(commitments)
				.where(and(eq(commitments.householdId, householdId), lte(commitments.fromMonth, month))),
			db
				.select({
					commitmentId: commitmentTerms.commitmentId,
					month: commitmentTerms.month,
					amount: commitmentTerms.amountCents,
					cadence: commitmentTerms.cadence,
					dueDate: commitmentTerms.dueDate,
				})
				.from(commitmentTerms)
				.where(
					and(eq(commitmentTerms.householdId, householdId), lte(commitmentTerms.month, month)),
				),
			db
				.select({
					bucketId: bucketRolling.bucketId,
					month: bucketRolling.month,
					rolling: bucketRolling.rolling,
				})
				.from(bucketRolling)
				.where(and(eq(bucketRolling.householdId, householdId), lte(bucketRolling.month, month))),
		]);
	// Months and days are always written as MonthKeys and DayKeys by the functions that write them.
	return {
		baselines: baselineRows as PlanRecords["baselines"],
		buckets: bucketRows as PlanRecords["buckets"],
		allowances: allowanceRows as PlanRecords["allowances"],
		commitments: commitmentRows as PlanRecords["commitments"],
		commitmentTerms: termRows as PlanRecords["commitmentTerms"],
		rolling: rollingRows as PlanRecords["rolling"],
	};
}

/**
 * Sets the Baseline from `month` onward, or for `scope` "just" that month only: the next month
 * goes back to the Baseline in force before, unless it has its own. Setting it again for the same
 * month replaces it.
 */
export async function setBaseline(
	db: Db,
	input: { householdId: string; month: MonthKey; amountCents: Cents; scope?: PlanScope },
): Promise<void> {
	const { householdId, month, amountCents } = input;
	const write = db
		.insert(baselines)
		.values({ householdId, month, amountCents })
		.onConflictDoUpdate({
			target: [baselines.householdId, baselines.month],
			set: { amountCents },
		});
	if (input.scope !== "just") {
		await write;
		return;
	}
	const series = await db
		.select({ month: baselines.month, amountCents: baselines.amountCents })
		.from(baselines)
		.where(and(eq(baselines.householdId, householdId), lte(baselines.month, addMonths(month, 1))));
	const restore = restoreAfterJust(series as { month: MonthKey; amountCents: Cents }[], month);
	if (!restore) {
		await write;
		return;
	}
	await db.batch([
		// The next month's own Baseline always wins, even one written since the read above.
		db
			.insert(baselines)
			.values({ householdId, ...restore })
			.onConflictDoNothing({ target: [baselines.householdId, baselines.month] }),
		write,
	]);
}

/** Guards a write to only land if the Bucket belongs to the Household. */
const ownBucket = (householdId: string, bucketId: string) =>
	and(eq(buckets.id, bucketId), eq(buckets.householdId, householdId));

/**
 * Guards a change to a Bucket to only land if it belongs to the Household and the Parent
 * `memberId` may change it: a Personal Allowance is set only by its own Parent.
 */
export const changeableBucket = (input: {
	householdId: string;
	bucketId: string;
	memberId: string;
}) => and(ownBucket(input.householdId, input.bucketId), assignableBy(input.memberId));

/**
 * Adds a Bucket to the Plan from `month` onward, placed last, with its first allowance.
 * Idempotent per `bucketId`: a retry leaves the first attempt's Bucket as it was.
 */
export async function addBucket(
	db: Db,
	input: {
		householdId: string;
		bucketId: string;
		name: string;
		color: number;
		month: MonthKey;
		allowanceCents: Cents;
	},
): Promise<void> {
	await db.batch(bucketAdd(db, input));
}

/**
 * addBucket as statements, for writing them in a batch with others; `color` may be SQL (say,
 * the next colour in turn), and `archivedFromMonth` also sets when it leaves the Plan.
 */
export const bucketAdd = (
	db: Db,
	input: {
		householdId: string;
		bucketId: string;
		name: string;
		color: number | SQL;
		month: MonthKey;
		archivedFromMonth?: MonthKey | null;
		allowanceCents: Cents;
	},
) =>
	[
		db
			.insert(buckets)
			.values({
				id: input.bucketId,
				householdId: input.householdId,
				name: input.name,
				color: input.color,
				position: sql`(select coalesce(max(${buckets.position}), 0) + 1 from ${buckets} where ${buckets.householdId} = ${input.householdId})`,
				fromMonth: input.month,
				archivedFromMonth: input.archivedFromMonth ?? null,
			})
			.onConflictDoNothing({ target: buckets.id }),
		db
			.insert(bucketAllowances)
			.select(
				db
					.select({
						householdId: buckets.householdId,
						bucketId: buckets.id,
						month: sql<string>`${input.month}`.as("month"),
						amountCents: sql<number>`${input.allowanceCents}`.as("amount_cents"),
					})
					.from(buckets)
					.where(ownBucket(input.householdId, input.bucketId)),
			)
			.onConflictDoNothing({ target: [bucketAllowances.bucketId, bucketAllowances.month] }),
	] as const;

/**
 * Adds the Parent `memberId`'s Personal Allowance to the Plan from `month` onward, placed last,
 * with its first allowance. Each Parent has one: idempotent per `bucketId`, and a second one for
 * the same Parent (say, from another tab) is refused, leaving the first as it was.
 */
export async function addPersonalAllowance(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		bucketId: string;
		name: string;
		color: number;
		month: MonthKey;
		allowanceCents: Cents;
	},
): Promise<void> {
	await db.batch([
		db
			.insert(buckets)
			.values({
				id: input.bucketId,
				householdId: input.householdId,
				name: input.name,
				color: input.color,
				position: sql`(select coalesce(max(${buckets.position}), 0) + 1 from ${buckets} where ${buckets.householdId} = ${input.householdId})`,
				fromMonth: input.month,
				ownerMemberId: input.memberId,
			})
			// The Bucket's ID, or the Parent already having one.
			.onConflictDoNothing(),
		db
			.insert(bucketAllowances)
			.select(
				db
					.select({
						householdId: buckets.householdId,
						bucketId: buckets.id,
						month: sql<string>`${input.month}`.as("month"),
						amountCents: sql<number>`${input.allowanceCents}`.as("amount_cents"),
					})
					.from(buckets)
					.where(
						and(
							ownBucket(input.householdId, input.bucketId),
							eq(buckets.ownerMemberId, input.memberId),
						),
					),
			)
			.onConflictDoNothing({ target: [bucketAllowances.bucketId, bucketAllowances.month] }),
	]);
}

/** Renames or recolours a Bucket (in every month), for the Parent `memberId`. */
export async function updateBucket(
	db: Db,
	input: { householdId: string; memberId: string; bucketId: string; name?: string; color?: number },
): Promise<void> {
	const { name, color } = input;
	if (name === undefined && color === undefined) return;
	await db.update(buckets).set({ name, color }).where(changeableBucket(input));
}

/**
 * Sets a Bucket's allowance from `month` onward, for the Parent `memberId`, or for `scope` "just"
 * that month only: the next month goes back to the allowance in force before, unless it has its
 * own. Setting it again for the same month replaces it.
 */
export async function setAllowance(
	db: Db,
	input: AllowanceInput & { scope?: PlanScope },
): Promise<void> {
	if (input.scope !== "just") {
		await allowanceWrite(db, input);
		return;
	}
	const series = await db
		.select({ month: bucketAllowances.month, amountCents: bucketAllowances.amountCents })
		.from(bucketAllowances)
		.where(
			and(
				eq(bucketAllowances.householdId, input.householdId),
				eq(bucketAllowances.bucketId, input.bucketId),
				lte(bucketAllowances.month, addMonths(input.month, 1)),
			),
		);
	const restore = restoreAfterJust(
		series as { month: MonthKey; amountCents: Cents }[],
		input.month,
	);
	if (!restore) {
		await allowanceWrite(db, input);
		return;
	}
	await db.batch([
		// Guarded like the change itself; the next month's own allowance always wins, even one
		// written since the read above.
		allowanceInsert(db, { ...input, ...restore }).onConflictDoNothing({
			target: [bucketAllowances.bucketId, bucketAllowances.month],
		}),
		allowanceWrite(db, input),
	]);
}

type AllowanceInput = {
	householdId: string;
	memberId: string;
	bucketId: string;
	month: MonthKey;
	amountCents: Cents;
};

/** insert into bucket_allowances select … from buckets where <the Parent may change it> */
const allowanceInsert = (db: Db, input: AllowanceInput) =>
	db.insert(bucketAllowances).select(
		db
			.select({
				householdId: buckets.householdId,
				bucketId: buckets.id,
				month: sql<string>`${input.month}`.as("month"),
				amountCents: sql<number>`${input.amountCents}`.as("amount_cents"),
			})
			.from(buckets)
			.where(changeableBucket(input)),
	);

/** setAllowance from `month` onward as a statement, for writing it in a batch with others. */
export const allowanceWrite = (db: Db, input: AllowanceInput) =>
	allowanceInsert(db, input).onConflictDoUpdate({
		target: [bucketAllowances.bucketId, bucketAllowances.month],
		set: { amountCents: input.amountCents },
	});

/**
 * Sets a Bucket Rolling or Fresh-start from `month` onward, for the Parent `memberId`. Setting it
 * again for the same month replaces it.
 */
export async function setRolling(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		bucketId: string;
		month: MonthKey;
		rolling: boolean;
	},
): Promise<void> {
	await db
		.insert(bucketRolling)
		.select(
			db
				.select({
					householdId: buckets.householdId,
					bucketId: buckets.id,
					month: sql<string>`${input.month}`.as("month"),
					rolling: sql<boolean>`${input.rolling ? 1 : 0}`.as("rolling"),
				})
				.from(buckets)
				.where(changeableBucket(input)),
		)
		.onConflictDoUpdate({
			target: [bucketRolling.bucketId, bucketRolling.month],
			set: { rolling: input.rolling },
		});
}

/** Puts the Household's Buckets in the given order. IDs of other Households' Buckets are ignored. */
export async function reorderBuckets(
	db: Db,
	input: { householdId: string; bucketIds: string[] },
): Promise<void> {
	const [first, ...rest] = input.bucketIds.map((bucketId, index) =>
		db
			.update(buckets)
			.set({ position: index + 1 })
			.where(ownBucket(input.householdId, bucketId)),
	);
	if (first) await db.batch([first, ...rest]);
}

/**
 * Takes a Bucket out of the Plan from `month` onward; earlier months keep it. Archiving from a
 * later month than it already was is a no-op. A Personal Allowance stays: its Parent sets its
 * allowance to zero instead.
 */
export async function archiveBucket(db: Db, input: ArchiveBucketInput): Promise<void> {
	await bucketArchive(db, input);
}

type ArchiveBucketInput = { householdId: string; bucketId: string; month: MonthKey };

/** archiveBucket as a statement, for writing it in a batch with others. */
export const bucketArchive = (db: Db, input: ArchiveBucketInput) =>
	db
		.update(buckets)
		.set({ archivedFromMonth: input.month })
		.where(
			and(
				ownBucket(input.householdId, input.bucketId),
				isNull(buckets.ownerMemberId),
				or(isNull(buckets.archivedFromMonth), gt(buckets.archivedFromMonth, input.month)),
			),
		);
