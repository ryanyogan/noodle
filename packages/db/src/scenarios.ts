import {
	addedUntil,
	addMonths,
	type CommitmentTerms,
	changedTerms,
	dueDateFrom,
	isAssumption,
	type MonthKey,
	type PlanScope,
	rangeFrom,
	readScenarioChanges,
	SCENARIO_VERSION,
	type ScenarioChange,
	type ScenarioChangeOf,
	type ScenarioChangeV1,
	upgradeChanges,
	whyNotApplicable,
} from "@noodle/domain";
import { and, desc, eq, inArray, isNull, lte, type SQL, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { alias } from "drizzle-orm/sqlite-core";
import { commitmentAdd, commitmentEnd, inPlanFor, ownCommitment, termsLog } from "./commitments";
import { goalInsert, goalLog, targetFor } from "./goals";
import type { Db } from "./index";
import {
	allowanceLog,
	allowanceWrite,
	bucketAdd,
	bucketArchive,
	changeableBucket,
	takeHomePayLog,
} from "./plan";
import type { Author } from "./plan-log";
import {
	baselines,
	bucketAllowances,
	buckets,
	commitments,
	commitmentTerms,
	goals,
	members,
	scenarios,
} from "./schema";

// A Household's Scenarios: named sets of Changes explored against the Plan. Every query is scoped
// by household_id; Scenario IDs from the client are only ever used together with it. Saving is
// idempotent per the client's ULID, so a retried save lands once. Changes are saved as versioned
// JSON ({ version: 2, levers }); v1 Scenarios (a bare array) are upgraded as they load. Applying
// one records when, and by which Parent, on the Scenario.

export type ScenarioRecord = {
	id: string;
	name: string;
	levers: ScenarioChange[];
	updatedAt: number;
	/** The Parent who made it, by name; null if they've left the Household. */
	createdBy: string | null;
	/** When it was last applied to the Plan, and by which Parent; null until it is. */
	appliedAt: number | null;
	appliedBy: string | null;
};

/**
 * The Household's Scenarios, most recently changed first. `month` is the Household's current
 * month, which v1 Changes held from.
 */
export async function loadScenarios(
	db: Db,
	householdId: string,
	month: MonthKey,
): Promise<ScenarioRecord[]> {
	const creator = alias(members, "creator");
	const applier = alias(members, "applier");
	const rows = await db
		.select({
			id: scenarios.id,
			name: scenarios.name,
			levers: scenarios.levers,
			updatedAt: scenarios.updatedAt,
			createdBy: creator.name,
			appliedAt: scenarios.appliedAt,
			appliedBy: applier.name,
		})
		.from(scenarios)
		.leftJoin(creator, eq(creator.id, scenarios.createdByMemberId))
		.leftJoin(applier, eq(applier.id, scenarios.appliedByMemberId))
		.where(eq(scenarios.householdId, householdId))
		.orderBy(desc(scenarios.updatedAt), desc(scenarios.id));
	const levers = await withSubjectNames(
		db,
		householdId,
		rows.map((row) => readScenarioChanges(row.levers, month)),
	);
	return rows.map((row, i) => ({
		...row,
		levers: levers[i] ?? [],
		updatedAt: row.updatedAt.getTime(),
		appliedAt: row.appliedAt?.getTime() ?? null,
	}));
}

type ScenarioInput = {
	householdId: string;
	memberId: string;
	scenarioId: string;
	name: string;
	levers: ScenarioChange[];
};

/**
 * Creates a Scenario, or renames it and replaces its Changes; it counts as changed only if its
 * name or Changes did. `applied` also records that `memberId` applied it now. Another
 * Household's Scenario ID changes nothing.
 */
function scenarioWrite(db: Db, input: ScenarioInput, applied: boolean) {
	const changes = { version: SCENARIO_VERSION, levers: input.levers } as const;
	const now = sql`(unixepoch() * 1000)`;
	const appliedBy = applied ? { appliedAt: now, appliedByMemberId: input.memberId } : {};
	return db
		.insert(scenarios)
		.values({
			id: input.scenarioId,
			householdId: input.householdId,
			name: input.name,
			levers: changes,
			createdByMemberId: input.memberId,
			...appliedBy,
		})
		.onConflictDoUpdate({
			target: scenarios.id,
			set: {
				name: input.name,
				levers: changes,
				updatedAt: sql`case when ${scenarios.name} is excluded.name and ${scenarios.levers} is excluded.levers then ${scenarios.updatedAt} else ${now} end`,
				...appliedBy,
			},
			setWhere: eq(scenarios.householdId, input.householdId),
		});
}

/**
 * Creates a Scenario, or renames it and replaces its Changes. Saving another Household's
 * Scenario ID changes nothing.
 */
export async function saveScenario(db: Db, input: ScenarioInput): Promise<void> {
	const [levers = input.levers] = await withSubjectNames(db, input.householdId, [input.levers]);
	await scenarioWrite(db, { ...input, levers }, false);
}

/** Where a Change's subject is kept (a Bucket, Commitment or Goal) and its ID; none for the rest. */
function subjectOf(
	change: ScenarioChange,
): { kind: "bucket" | "commitment" | "goal"; id: string } | null {
	switch (change.kind) {
		case "allowance":
		case "archive-bucket":
			return { kind: "bucket", id: change.bucketId };
		case "commitment-terms":
		case "end-commitment":
			return { kind: "commitment", id: change.commitmentId };
		case "goal":
			return { kind: "goal", id: change.goalId };
		default:
			return null;
	}
}

/**
 * Each Change named by its subject as the Household has it now, archived or not (#51), so the
 * Change still says what it changed once its Bucket, Commitment or Goal is archived. A subject no
 * longer stored at all keeps the name the Change was last saved with.
 */
export async function withSubjectNames(
	db: Db,
	householdId: string,
	lists: readonly ScenarioChange[][],
): Promise<ScenarioChange[][]> {
	const wanted = new Set(lists.flat().flatMap((change) => subjectOf(change)?.kind ?? []));
	if (wanted.size === 0) return lists.map((list) => list);
	const none = Promise.resolve([] as { id: string; name: string }[]);
	const [bucketNames, commitmentNames, goalNames] = await Promise.all([
		wanted.has("bucket")
			? db
					.select({ id: buckets.id, name: buckets.name })
					.from(buckets)
					.where(eq(buckets.householdId, householdId))
			: none,
		wanted.has("commitment")
			? db
					.select({ id: commitments.id, name: commitments.name })
					.from(commitments)
					.where(eq(commitments.householdId, householdId))
			: none,
		wanted.has("goal")
			? db
					.select({ id: goals.id, name: goals.name })
					.from(goals)
					.where(eq(goals.householdId, householdId))
			: none,
	]);
	const names = {
		bucket: new Map(bucketNames.map((r) => [r.id, r.name])),
		commitment: new Map(commitmentNames.map((r) => [r.id, r.name])),
		goal: new Map(goalNames.map((r) => [r.id, r.name])),
	};
	return lists.map((list) =>
		list.map((change) => {
			const subject = subjectOf(change);
			const name = subject ? names[subject.kind].get(subject.id) : undefined;
			return name ? { ...change, subjectName: name } : change;
		}),
	);
}

export async function deleteScenario(
	db: Db,
	input: { householdId: string; scenarioId: string },
): Promise<void> {
	await db
		.delete(scenarios)
		.where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.householdId, input.householdId)));
}

/** A Change that can't be applied (see whyNotApplicable); nothing was written. */
export class ScenarioChangeNotApplicable extends Error {}

type Batch = BatchItem<"sqlite">[];

/**
 * Makes Changes the real Plan from `month` (the Household's current month) on, all at once or
 * not at all, as effective-dated writes (ADR-0009). Each Change's range starts no earlier than
 * `month`. A value (take-home pay, an allowance, a Commitment's terms) is written at the range's
 * first month, and when the range ends, the Plan's value at its end is written back there first.
 * Commitments and Buckets are added and ended or archived; Goals are changed or added. Muted
 * Changes and assumptions (a one-off, growth) are left out, a Change whose range is over is
 * skipped, and any other Change that can't be applied (whyNotApplicable) refuses the lot. Every
 * write is the Plan's own, guarded to the Household and the Parent `memberId` (only its Parent
 * sets a Personal Allowance), and idempotent, so applying again changes nothing. v1 Changes are
 * upgraded first. With `scenario`, the Scenario `scenarioId` is saved as it is and marked
 * applied by `memberId` in the same batch.
 */
async function applyNamed(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		/** The Scenario applied, if it was saved; its Plan changes name it. */
		scenarioId?: string | null;
		/** The Scenario as it's applied (all its Changes, muted too), to save with it. */
		scenario?: { name: string; levers: ScenarioChange[] };
		month: MonthKey;
		levers: readonly (ScenarioChange | ScenarioChangeV1)[];
	},
): Promise<void> {
	const { householdId, memberId, month, scenarioId, scenario } = input;
	const author: Author = { memberId, source: "scenario", scenarioId: scenarioId ?? null };
	const changes = upgradeChanges(input.levers, month).filter((l) => !l.muted && !isAssumption(l));
	for (const change of changes) {
		const why = whyNotApplicable(change, month);
		if (why !== null) throw new ScenarioChangeNotApplicable(why);
	}

	// A Commitment's new terms build on the terms in force when they start, read here and
	// written only if no one changed them in between.
	const termChanges = changes.filter(
		(l): l is ScenarioChangeOf<"commitment-terms"> => l.kind === "commitment-terms",
	);
	const termRows =
		termChanges.length === 0
			? []
			: await db
					.select({
						commitmentId: commitmentTerms.commitmentId,
						month: commitmentTerms.month,
						amount: commitmentTerms.amountCents,
						cadence: commitmentTerms.cadence,
						dueDate: commitmentTerms.dueDate,
					})
					.from(commitmentTerms)
					.where(
						and(
							eq(commitmentTerms.householdId, householdId),
							inArray(
								commitmentTerms.commitmentId,
								termChanges.map((l) => l.commitmentId),
							),
						),
					);

	const writes: Batch = [];
	if (scenarioId && scenario) {
		writes.push(scenarioWrite(db, { householdId, memberId, scenarioId, ...scenario }, true));
	}
	for (const change of changes) {
		const range = rangeFrom(change, month);
		if (range === null) continue;
		const { from, until } = range;
		// Each Plan change goes in the batch just before its write.
		const logged = { ...author, householdId, month: from, scope: scopeOf(from, until), until };
		switch (change.kind) {
			case "baseline":
				writes.push(takeHomePayLog(db, { ...logged, amountCents: change.amount }));
				if (until !== null) writes.push(takeHomePayBack(db, householdId, until));
				writes.push(
					db
						.insert(baselines)
						.values({ householdId, month: from, amountCents: change.amount })
						.onConflictDoUpdate({
							target: [baselines.householdId, baselines.month],
							set: { amountCents: change.amount },
						}),
				);
				break;
			case "allowance": {
				const bucket = { householdId, memberId, bucketId: change.bucketId };
				writes.push(
					allowanceLog(db, { ...logged, bucketId: change.bucketId, amountCents: change.amount }),
				);
				if (until !== null) writes.push(allowanceBack(db, bucket, until));
				writes.push(allowanceWrite(db, { ...bucket, month: from, amountCents: change.amount }));
				break;
			}
			case "commitment-terms": {
				const rows = termRows.filter((r) => r.commitmentId === change.commitmentId);
				const read = rows.reduce<(typeof rows)[number] | undefined>(
					(found, r) => (r.month <= from && (!found || r.month > found.month) ? r : found),
					undefined,
				);
				if (!read) break;
				const was = read as { month: string } & CommitmentTerms;
				const terms = changedTerms(was, change, from);
				const guard = termsGuard({ from, read: was });
				writes.push(
					termsLog(
						db,
						{
							...logged,
							commitmentId: change.commitmentId,
							amountCents: terms.amount,
							cadence: terms.cadence,
							dueDate: terms.dueDate,
						},
						guard,
					),
				);
				if (until !== null) writes.push(termsBack(db, householdId, change.commitmentId, until));
				writes.push(
					termsWrite(db, { householdId, commitmentId: change.commitmentId, from, guard, terms }),
				);
				break;
			}
			case "end-commitment":
				writes.push(
					...commitmentEnd(db, {
						...author,
						householdId,
						commitmentId: change.commitmentId,
						month: from,
					}),
				);
				break;
			case "add-commitment": {
				// Its term runs from the month it's added.
				const termEnd = addedUntil({ ...change, fromMonth: from });
				writes.push(
					...commitmentAdd(db, {
						...author,
						householdId,
						commitmentId: change.commitmentId,
						name: change.name,
						month: from,
						endedFromMonth: termEnd ?? null,
						amountCents: change.amount,
						cadence: change.cadence,
						dueDate: dueDateFrom(change.cadence, from, change.dueDay),
					}),
				);
				break;
			}
			case "add-bucket":
				writes.push(
					...bucketAdd(db, {
						...author,
						householdId,
						bucketId: change.bucketId,
						name: change.name,
						color: change.color ?? nextColor(householdId),
						month: from,
						archivedFromMonth: until,
						allowanceCents: change.amount,
						rolling: change.rolling,
					}),
				);
				break;
			case "archive-bucket":
				writes.push(
					...bucketArchive(db, { ...author, householdId, bucketId: change.bucketId, month: from }),
				);
				break;
			case "goal": {
				const target = {
					...logged,
					goalId: change.goalId,
					targetCents: change.target,
					targetDate: change.targetDate,
				};
				writes.push(
					goalLog(db, target, isNull(goals.archivedAt)),
					db
						.update(goals)
						.set({ targetCents: targetFor(change.target), targetDate: change.targetDate })
						.where(
							and(
								eq(goals.id, change.goalId),
								eq(goals.householdId, householdId),
								isNull(goals.archivedAt),
							),
						),
				);
				break;
			}
			case "add-goal":
				if (change.accountId === undefined) break;
				writes.push(
					goalInsert(db, {
						householdId,
						goalId: change.goalId,
						accountId: change.accountId,
						name: change.name,
						targetCents: change.target,
						targetDate: change.targetDate,
						fromMonth: from,
					}),
				);
				break;
			case "one-off":
			case "growth":
				// Left out above.
				break;
		}
	}
	const [first, ...rest] = writes;
	if (first) await db.batch([first, ...rest]);
}

/** A Change's range as a Plan change's scope: one month is "just" it; its end goes in `until`. */
const scopeOf = (from: MonthKey, until: MonthKey | null): PlanScope =>
	until === addMonths(from, 1) ? "just" : "from-on";

/** The next Bucket colour in turn (1–8) for the Household. */
export const nextColor = (householdId: string): SQL =>
	sql`(select count(*) % 8 + 1 from ${buckets} where ${buckets.householdId} = ${householdId})`;

/** Writes take-home pay in force at `until` back at `until`, unless a month set there already. */
const takeHomePayBack = (db: Db, householdId: string, until: MonthKey) =>
	db
		.insert(baselines)
		.select(
			db
				.select({
					householdId: baselines.householdId,
					month: sql<string>`${until}`.as("month"),
					amountCents: baselines.amountCents,
				})
				.from(baselines)
				.where(and(eq(baselines.householdId, householdId), lte(baselines.month, until)))
				.orderBy(desc(baselines.month))
				.limit(1),
		)
		.onConflictDoNothing({ target: [baselines.householdId, baselines.month] });

/** Writes a Bucket's allowance in force at `until` back at `until`, as allowanceWrite guards. */
const allowanceBack = (
	db: Db,
	bucket: { householdId: string; memberId: string; bucketId: string },
	until: MonthKey,
) =>
	db
		.insert(bucketAllowances)
		.select(
			db
				.select({
					householdId: buckets.householdId,
					bucketId: buckets.id,
					month: sql<string>`${until}`.as("month"),
					amountCents:
						sql<number>`coalesce((select ${bucketAllowances.amountCents} from ${bucketAllowances} where ${bucketAllowances.bucketId} = ${buckets.id} and ${bucketAllowances.month} <= ${until} order by ${bucketAllowances.month} desc limit 1), 0)`.as(
							"amount_cents",
						),
				})
				.from(buckets)
				.where(changeableBucket(bucket)),
		)
		.onConflictDoNothing({ target: [bucketAllowances.bucketId, bucketAllowances.month] });

/** Writes a Commitment's terms in force at `until` back at `until`. */
const termsBack = (db: Db, householdId: string, commitmentId: string, until: MonthKey) =>
	db
		.insert(commitmentTerms)
		.select(
			db
				.select({
					householdId: commitmentTerms.householdId,
					commitmentId: commitmentTerms.commitmentId,
					month: sql<string>`${until}`.as("month"),
					amountCents: commitmentTerms.amountCents,
					cadence: commitmentTerms.cadence,
					dueDate: commitmentTerms.dueDate,
				})
				.from(commitmentTerms)
				.where(
					and(
						eq(commitmentTerms.householdId, householdId),
						eq(commitmentTerms.commitmentId, commitmentId),
						lte(commitmentTerms.month, until),
					),
				)
				.orderBy(desc(commitmentTerms.month))
				.limit(1),
		)
		.onConflictDoNothing({ target: [commitmentTerms.commitmentId, commitmentTerms.month] });

/**
 * Guards new terms from `from` to land only if the Commitment is in the Plan then and its terms
 * in force are still the ones `read` (no one changed them since).
 */
const termsGuard = (input: { from: MonthKey; read: { month: string } & CommitmentTerms }) => {
	const { read, from } = input;
	const unchanged = sql`exists (select 1 from ${commitmentTerms} where ${commitmentTerms.commitmentId} = ${commitments.id} and ${commitmentTerms.month} = ${read.month} and ${commitmentTerms.amountCents} = ${read.amount} and ${commitmentTerms.cadence} = ${read.cadence} and ${commitmentTerms.dueDate} = ${read.dueDate})
		and not exists (select 1 from ${commitmentTerms} where ${commitmentTerms.commitmentId} = ${commitments.id} and ${commitmentTerms.month} > ${read.month} and ${commitmentTerms.month} <= ${from})`;
	return and(inPlanFor(from), unchanged);
};

/** Sets a Commitment's terms from `from`, as termsGuard allows. */
const termsWrite = (
	db: Db,
	input: {
		householdId: string;
		commitmentId: string;
		from: MonthKey;
		guard: SQL | undefined;
		terms: CommitmentTerms;
	},
) => {
	const { terms, from } = input;
	return db
		.insert(commitmentTerms)
		.select(
			db
				.select({
					householdId: commitments.householdId,
					commitmentId: commitments.id,
					month: sql<string>`${from}`.as("month"),
					amountCents: sql<number>`${terms.amount}`.as("amount_cents"),
					cadence: sql<CommitmentTerms["cadence"]>`${terms.cadence}`.as("cadence"),
					dueDate: sql<string>`${terms.dueDate}`.as("due_date"),
				})
				.from(commitments)
				.where(and(ownCommitment(input.householdId, input.commitmentId), input.guard)),
		)
		.onConflictDoUpdate({
			target: [commitmentTerms.commitmentId, commitmentTerms.month],
			set: { amountCents: terms.amount, cadence: terms.cadence, dueDate: terms.dueDate },
		});
};

/** applyChanges (see applyNamed), the Scenario saved with its Changes' subjects named (#51). */
export async function applyChanges(db: Db, input: Parameters<typeof applyNamed>[1]) {
	const scenario = input.scenario && {
		...input.scenario,
		levers:
			(await withSubjectNames(db, input.householdId, [input.scenario.levers]))[0] ??
			input.scenario.levers,
	};
	return applyNamed(db, { ...input, scenario });
}
