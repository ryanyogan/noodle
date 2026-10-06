import {
	addMonths,
	type Cents,
	cleanGroupName,
	type MonthKey,
	type PlanRecords,
	type PlanScope,
	restoreAfterJust,
} from "@noodle/domain";
import { and, eq, gt, isNull, lt, lte, or, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import type { Db } from "./index";
import { type Author, inForce, logChange } from "./plan-log";
import { assignableBy } from "./privacy";
import {
	baselines,
	bucketAllowances,
	bucketRolling,
	buckets,
	commitments,
	commitmentTerms,
	households,
	planChanges as planChangeRows,
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
	const [takeHomePayRows, bucketRows, allowanceRows, commitmentRows, termRows, carriesOverRows] =
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
					group: buckets.groupName,
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
					accountId: commitments.accountId,
					carriedBalance: commitments.carriedBalance,
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
		baselines: takeHomePayRows as PlanRecords["baselines"],
		buckets: bucketRows as PlanRecords["buckets"],
		allowances: allowanceRows as PlanRecords["allowances"],
		commitments: commitmentRows as PlanRecords["commitments"],
		commitmentTerms: termRows as PlanRecords["commitmentTerms"],
		rolling: carriesOverRows as PlanRecords["rolling"],
	};
}

/** `until`: the month a Scenario's change over a range stops, for its Plan change. */
type Ranged = { scope?: PlanScope; until?: MonthKey | null };

const untilOf = (input: Ranged) => (input.until ? { until: input.until } : {});

type TakeHomePayInput = Author & { householdId: string; month: MonthKey; amountCents: Cents };

/** The Plan change for setting take-home pay, written before it. */
export const takeHomePayLog = (db: Db, input: TakeHomePayInput & Ranged) => {
	const was = inForce(
		baselines,
		baselines.amountCents,
		baselines.month,
		eq(baselines.householdId, input.householdId),
		input.month,
	);
	return logChange(
		db,
		households,
		and(eq(households.id, input.householdId), sql`${was} is not ${input.amountCents}`),
		{
			...input,
			kind: "baseline",
			targetId: null,
			before: sql`json_object('amount', ${was})`,
			after: { amount: input.amountCents, ...untilOf(input) },
		},
	);
};

/**
 * Sets take-home pay from `month` onward, or for `scope` "just" that month only: the next month
 * goes back to take-home pay in force before, unless it has its own. Setting it again for the same
 * month replaces it.
 */
export async function setTakeHomePay(
	db: Db,
	input: TakeHomePayInput & { scope?: PlanScope },
): Promise<void> {
	const { householdId, month, amountCents } = input;
	const log = takeHomePayLog(db, input);
	const write = db
		.insert(baselines)
		.values({ householdId, month, amountCents })
		.onConflictDoUpdate({
			target: [baselines.householdId, baselines.month],
			set: { amountCents },
		});
	if (input.scope !== "just") {
		await db.batch([log, write]);
		return;
	}
	const series = await db
		.select({ month: baselines.month, amountCents: baselines.amountCents })
		.from(baselines)
		.where(and(eq(baselines.householdId, householdId), lte(baselines.month, addMonths(month, 1))));
	const restore = restoreAfterJust(series as { month: MonthKey; amountCents: Cents }[], month);
	if (!restore) {
		await db.batch([log, write]);
		return;
	}
	await db.batch([
		log,
		// The next month's own take-home pay always wins, even one written since the read above.
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
	input: Author & {
		householdId: string;
		bucketId: string;
		name: string;
		color: number;
		month: MonthKey;
		allowanceCents: Cents;
		/** Carries over from the start; a new Bucket resets monthly unless a Parent says. */
		rolling?: boolean;
	},
): Promise<void> {
	await db.batch(bucketAdd(db, input));
}

/**
 * Several new Buckets in one batch (#57's Add Buckets sheet): each is added, with its Plan change,
 * as addBucket adds one, so a Bucket already there by ID is skipped and the rest still land.
 */
export async function addBuckets(
	db: Db,
	input: Author & {
		householdId: string;
		month: MonthKey;
		buckets: {
			bucketId: string;
			name: string;
			color: number;
			allowanceCents: Cents;
			rolling?: boolean;
		}[];
	},
): Promise<void> {
	const { buckets: rows, ...rest } = input;
	const writes: BatchItem<"sqlite">[] = rows.flatMap((bucket) =>
		bucketAdd(db, { ...rest, ...bucket }),
	);
	if (writes.length === 0) return;
	await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}

/**
 * addBucket as statements, for writing them in a batch with others; `color` may be SQL (say,
 * the next colour in turn), `archivedFromMonth` also sets when it leaves the Plan, and `rolling`
 * makes it carries over from the start.
 */
export const bucketAdd = (
	db: Db,
	input: Author & {
		householdId: string;
		bucketId: string;
		name: string;
		color: number | SQL;
		month: MonthKey;
		archivedFromMonth?: MonthKey | null;
		allowanceCents: Cents;
		rolling?: boolean;
	},
) =>
	[
		logChange(
			db,
			households,
			and(
				eq(households.id, input.householdId),
				sql`not exists (select 1 from ${buckets} where ${buckets.id} = ${input.bucketId})`,
			),
			{
				...input,
				kind: "bucket-add",
				targetId: input.bucketId,
				before: null,
				after: {
					name: input.name,
					amount: input.allowanceCents,
					...(input.rolling ? { rolling: true } : {}),
					...untilOf({ until: input.archivedFromMonth }),
				},
			},
		),
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
		...(input.rolling
			? [
					db
						.insert(bucketRolling)
						.select(
							db
								.select({
									householdId: buckets.householdId,
									bucketId: buckets.id,
									month: sql<string>`${input.month}`.as("month"),
									rolling: sql<boolean>`1`.as("rolling"),
								})
								.from(buckets)
								.where(ownBucket(input.householdId, input.bucketId)),
						)
						.onConflictDoNothing({ target: [bucketRolling.bucketId, bucketRolling.month] }),
				]
			: []),
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
		logChange(
			db,
			households,
			and(
				eq(households.id, input.householdId),
				sql`not exists (select 1 from ${buckets} where ${buckets.id} = ${input.bucketId} or ${buckets.ownerMemberId} = ${input.memberId})`,
			),
			{
				...input,
				kind: "bucket-add",
				targetId: input.bucketId,
				before: null,
				after: { name: input.name, amount: input.allowanceCents },
				owner: input.memberId,
			},
		),
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

/**
 * Renames or recolours a Bucket (in every month), or puts it in a group (issue 98), for the Parent
 * `memberId`; `month` (the Household's current one) is when its Plan change says a rename
 * happened. `group` null, or a name that is empty once trimmed, takes it out of its group. A group
 * changes no figure, so like a colour it writes no Plan change; a Personal Allowance has none.
 */
export async function updateBucket(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		bucketId: string;
		month: MonthKey;
		name?: string;
		color?: number;
		group?: string | null;
	},
): Promise<void> {
	const { name, color } = input;
	if (name === undefined && color === undefined && input.group === undefined) return;
	const group = cleanGroupName(input.group);
	const groupName =
		input.group === undefined
			? undefined
			: group === null
				? null
				: sql<string | null>`case when ${buckets.ownerMemberId} is null then ${group} end`;
	const write = db.update(buckets).set({ name, color, groupName }).where(changeableBucket(input));
	if (name === undefined) {
		await write;
		return;
	}
	await db.batch([
		logChange(db, buckets, and(changeableBucket(input), sql`${buckets.name} is not ${name}`), {
			...input,
			kind: "bucket-rename",
			targetId: input.bucketId,
			before: sql`json_object('name', ${buckets.name})`,
			after: { name },
			owner: buckets.ownerMemberId,
		}),
		write,
	]);
}

/**
 * Renames a group of the Household's Buckets (issue 98): every Bucket in `from` goes to `to`, in
 * one statement. `to` null, or empty once trimmed, takes them all out of it; a `to` that is
 * another group's name joins the two. Returns how many Buckets it was.
 */
export async function renameBucketGroup(
	db: Db,
	input: { householdId: string; from: string; to: string | null },
): Promise<number> {
	const changed = await db
		.update(buckets)
		.set({ groupName: cleanGroupName(input.to) })
		.where(and(eq(buckets.householdId, input.householdId), eq(buckets.groupName, input.from)))
		.returning({ id: buckets.id });
	return changed.length;
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
	const log = allowanceLog(db, input);
	if (input.scope !== "just") {
		await db.batch([log, allowanceWrite(db, input)]);
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
		await db.batch([log, allowanceWrite(db, input)]);
		return;
	}
	await db.batch([
		log,
		// Guarded like the change itself; the next month's own allowance always wins, even one
		// written since the read above.
		allowanceInsert(db, { ...input, ...restore }).onConflictDoNothing({
			target: [bucketAllowances.bucketId, bucketAllowances.month],
		}),
		allowanceWrite(db, input),
	]);
}

type AllowanceInput = Author & {
	householdId: string;
	bucketId: string;
	month: MonthKey;
	amountCents: Cents;
};

/** The Plan change for setting a Bucket's allowance, written before it with the same guard. */
export const allowanceLog = (db: Db, input: AllowanceInput & Ranged) => {
	const was = inForce(
		bucketAllowances,
		bucketAllowances.amountCents,
		bucketAllowances.month,
		eq(bucketAllowances.bucketId, buckets.id),
		input.month,
	);
	return logChange(
		db,
		buckets,
		and(changeableBucket(input), sql`${was} is not ${input.amountCents}`),
		{
			...input,
			kind: "allowance",
			targetId: input.bucketId,
			before: sql`json_object('amount', ${was})`,
			after: { amount: input.amountCents, ...untilOf(input) },
			owner: buckets.ownerMemberId,
		},
	);
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
 * Sets a Bucket carries over or resets monthly from `month` onward, for the Parent `memberId`. Setting it
 * again for the same month replaces it.
 */
export async function setCarriesOver(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		bucketId: string;
		month: MonthKey;
		rolling: boolean;
	},
): Promise<void> {
	const was = inForce(
		bucketRolling,
		bucketRolling.rolling,
		bucketRolling.month,
		eq(bucketRolling.bucketId, buckets.id),
		input.month,
	);
	const log = logChange(
		db,
		buckets,
		and(changeableBucket(input), sql`coalesce(${was}, 0) is not ${input.rolling ? 1 : 0}`),
		{
			...input,
			kind: "rolling",
			targetId: input.bucketId,
			before: { rolling: !input.rolling },
			after: { rolling: input.rolling },
			owner: buckets.ownerMemberId,
		},
	);
	const write = db
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
	await db.batch([log, write]);
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
	await db.batch(bucketArchive(db, input));
}

type ArchiveBucketInput = Author & { householdId: string; bucketId: string; month: MonthKey };

/**
 * Brings an archived Bucket back into the Plan from `month` on, with `amountCents` as its
 * allowance. The months it was out of the Plan keep it out in effect: from the month it was
 * archived to the one before `month`, its allowance is $0 (a Bucket is archived from one month
 * on, not over a range, so those months now list it at $0, which changes no number). A Personal
 * Allowance is never archived; one not archived is left as it is.
 */
export async function restoreBucket(
	db: Db,
	input: Author & { householdId: string; bucketId: string; month: MonthKey; amountCents: Cents },
): Promise<boolean> {
	const [bucket] = await db
		.select({ archivedFromMonth: buckets.archivedFromMonth })
		.from(buckets)
		.where(and(ownBucket(input.householdId, input.bucketId), isNull(buckets.ownerMemberId)));
	const archivedFrom = bucket?.archivedFromMonth as MonthKey | null | undefined;
	if (!archivedFrom) return false;
	const restorable = and(
		ownBucket(input.householdId, input.bucketId),
		isNull(buckets.ownerMemberId),
		eq(buckets.archivedFromMonth, archivedFrom),
	);
	const gap =
		archivedFrom < input.month
			? [
					// The months between keep nothing of their own.
					db
						.delete(bucketAllowances)
						.where(
							and(
								eq(bucketAllowances.householdId, input.householdId),
								eq(bucketAllowances.bucketId, input.bucketId),
								gt(bucketAllowances.month, archivedFrom),
								lt(bucketAllowances.month, input.month),
								sql`exists (select 1 from ${buckets} where ${restorable})`,
							),
						),
					restoredAllowance(db, archivedFrom, 0, restorable),
				]
			: [];
	await db.batch([
		logChange(db, buckets, restorable, {
			...input,
			kind: "bucket-restore",
			targetId: input.bucketId,
			before: null,
			after: { amount: input.amountCents },
		}),
		...gap,
		restoredAllowance(db, input.month, input.amountCents, restorable),
		db.update(buckets).set({ archivedFromMonth: null }).where(restorable),
	]);
	return true;
}

/** An allowance a restore writes, while the Bucket is still archived as it was read. */
const restoredAllowance = (
	db: Db,
	month: MonthKey,
	amountCents: Cents,
	restorable: SQL | undefined,
) =>
	db
		.insert(bucketAllowances)
		.select(
			db
				.select({
					householdId: buckets.householdId,
					bucketId: buckets.id,
					month: sql<string>`${month}`.as("month"),
					amountCents: sql<number>`${amountCents}`.as("amount_cents"),
				})
				.from(buckets)
				.where(restorable),
		)
		.onConflictDoUpdate({
			target: [bucketAllowances.bucketId, bucketAllowances.month],
			set: { amountCents },
		});

/** archiveBucket as statements (its Plan change, then itself), for a batch with others. */
export const bucketArchive = (db: Db, input: ArchiveBucketInput) => {
	const archivable = and(
		ownBucket(input.householdId, input.bucketId),
		isNull(buckets.ownerMemberId),
		or(isNull(buckets.archivedFromMonth), gt(buckets.archivedFromMonth, input.month)),
	);
	return [
		logChange(db, buckets, archivable, {
			...input,
			kind: "bucket-archive",
			targetId: input.bucketId,
			before: null,
			after: null,
		}),
		db.update(buckets).set({ archivedFromMonth: input.month }).where(archivable),
	] as const;
};

/**
 * The Parents of a Household who have a Personal Allowance. Only that one exists is shared with
 * the other Parent, never its amount or spending (ADR-0003).
 */
export async function parentsWithPersonalAllowance(db: Db, householdId: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ owner: buckets.ownerMemberId })
		.from(buckets)
		.where(and(eq(buckets.householdId, householdId), sql`${buckets.ownerMemberId} is not null`));
	return rows.flatMap((row) => (row.owner ? [row.owner] : []));
}

/**
 * The Buckets whose allowance a Parent has changed since they were added: any "allowance" Plan
 * change. Ids only (ADR-0003). "Apply suggested amounts" never touches these (#72).
 */
export async function bucketsWithAllowanceChanges(db: Db, householdId: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ id: planChangeRows.targetId })
		.from(planChangeRows)
		.where(and(eq(planChangeRows.householdId, householdId), eq(planChangeRows.kind, "allowance")));
	return rows.flatMap((row) => (row.id ? [row.id] : []));
}

/** Sets several Buckets' allowances from `month` onward in one batch, so it's one change (#72). */
export async function setAllowances(
	db: Db,
	input: Author & {
		householdId: string;
		month: MonthKey;
		items: { bucketId: string; amountCents: Cents }[];
	},
): Promise<void> {
	const writes = input.items.flatMap(({ bucketId, amountCents }) => {
		const one = { ...input, bucketId, amountCents };
		return [allowanceLog(db, one), allowanceWrite(db, one)];
	});
	const [first, ...rest] = writes;
	if (!first) return;
	await db.batch([first, ...rest] as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
}
