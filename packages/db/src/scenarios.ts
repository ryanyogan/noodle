import { addMonths, type DayKey, type Lever, type MonthKey } from "@noodle/domain";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { commitmentAdd, commitmentEnd } from "./commitments";
import type { Db } from "./index";
import { allowanceWrite } from "./plan";
import { goals, scenarios } from "./schema";

// A Household's Scenarios: named sets of Levers explored against the Plan. Every query is scoped
// by household_id; Scenario IDs from the client are only ever used together with it. Saving is
// idempotent per the client's ULID, so a retried save lands once.

export type ScenarioRecord = { id: string; name: string; levers: Lever[]; updatedAt: number };

/** The Household's Scenarios, most recently changed first. */
export async function loadScenarios(db: Db, householdId: string): Promise<ScenarioRecord[]> {
	const rows = await db
		.select({
			id: scenarios.id,
			name: scenarios.name,
			levers: scenarios.levers,
			updatedAt: scenarios.updatedAt,
		})
		.from(scenarios)
		.where(eq(scenarios.householdId, householdId))
		.orderBy(desc(scenarios.updatedAt), desc(scenarios.id));
	return rows.map((row) => ({ ...row, updatedAt: row.updatedAt.getTime() }));
}

/**
 * Creates a Scenario, or renames it and replaces its Levers. Saving another Household's
 * Scenario ID changes nothing.
 */
export async function saveScenario(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		scenarioId: string;
		name: string;
		levers: Lever[];
	},
): Promise<void> {
	await db
		.insert(scenarios)
		.values({
			id: input.scenarioId,
			householdId: input.householdId,
			name: input.name,
			levers: input.levers,
			createdByMemberId: input.memberId,
		})
		.onConflictDoUpdate({
			target: scenarios.id,
			set: { name: input.name, levers: input.levers, updatedAt: sql`(unixepoch() * 1000)` },
			setWhere: eq(scenarios.householdId, input.householdId),
		});
}

export async function deleteScenario(
	db: Db,
	input: { householdId: string; scenarioId: string },
): Promise<void> {
	await db
		.delete(scenarios)
		.where(and(eq(scenarios.id, input.scenarioId), eq(scenarios.householdId, input.householdId)));
}

/**
 * Makes Levers the real Plan from `month` (the Household's current month) on, all at once or
 * not at all: each allowance is set from `month`, each Commitment ended from its month (never
 * earlier than `month`), each Goal given its target and date, and each new Commitment added
 * from its month (never earlier than `month`), due monthly on the 1st, ending after its term.
 * Every write is the Plan's own, guarded to the Household and the Parent `memberId` (only its
 * Parent sets a Personal Allowance), and idempotent, so applying again changes nothing.
 */
export async function applyLevers(
	db: Db,
	input: { householdId: string; memberId: string; month: MonthKey; levers: Lever[] },
): Promise<void> {
	const { householdId, memberId, month } = input;
	const writes = input.levers.flatMap(
		(lever): BatchItem<"sqlite"> | readonly BatchItem<"sqlite">[] => {
			if (lever.kind === "add-commitment") {
				const from = lever.fromMonth < month ? month : lever.fromMonth;
				return commitmentAdd(db, {
					householdId,
					commitmentId: lever.commitmentId,
					name: lever.name,
					month: from,
					endedFromMonth: lever.months === null ? null : addMonths(from, lever.months),
					amountCents: lever.amount,
					cadence: "monthly",
					dueDate: `${from}-01` as DayKey,
				});
			}
			if (lever.kind === "allowance") {
				return allowanceWrite(db, {
					householdId,
					memberId,
					bucketId: lever.bucketId,
					month,
					amountCents: lever.amount,
				});
			}
			if (lever.kind === "end-commitment") {
				return commitmentEnd(db, {
					householdId,
					commitmentId: lever.commitmentId,
					month: lever.fromMonth < month ? month : lever.fromMonth,
				});
			}
			return db
				.update(goals)
				.set({ targetCents: lever.target, targetDate: lever.targetDate })
				.where(
					and(
						eq(goals.id, lever.goalId),
						eq(goals.householdId, householdId),
						isNull(goals.archivedAt),
					),
				);
		},
	);
	const [first, ...rest] = writes;
	if (first) await db.batch([first, ...rest]);
}
