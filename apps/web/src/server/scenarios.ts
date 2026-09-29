import {
	applyLevers,
	deleteScenario as deleteScenarioInDb,
	loadPlanRecords,
	loadScenarios,
	type ScenarioRecord,
	saveScenario as saveScenarioInDb,
} from "@noodle/db";
import {
	addMonths,
	dayKeyAt,
	type Lever,
	MAX_CENTS,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	monthKeyAt,
	type PlanRecords,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { dayKeySchema, ulidSchema } from "./schemas";

// Scenarios and the Plan they're projected from. Saving is idempotent per the client's ULID, so
// the client can retry it safely; applying writes only the Plan's own idempotent changes.

export type { ScenarioRecord };

/**
 * The Plan's records from now to as far as a Scenario projects, with the Household's current
 * month: the client resolves and projects them with @noodle/domain as the Levers move.
 */
export type PlanAheadData = { month: MonthKey; records: PlanRecords };

const leverSchema: z.ZodType<Lever> = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("allowance"),
		bucketId: ulidSchema,
		amount: z.number().int().min(0).max(MAX_CENTS),
	}),
	z.object({
		kind: z.literal("end-commitment"),
		commitmentId: ulidSchema,
		fromMonth: monthKeySchema,
	}),
	z.object({
		kind: z.literal("goal"),
		goalId: ulidSchema,
		target: z.number().int().min(1).max(MAX_CENTS),
		targetDate: dayKeySchema.nullable(),
	}),
]);

const leversSchema = z.array(leverSchema).max(200);
const scenarioNameSchema = z.string().trim().min(1).max(40);

export const getPlanAhead = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<PlanAheadData> => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		const last = addMonths(month, MAX_PROJECTION_MONTHS - 1);
		return { month, records: await loadPlanRecords(getDb(), context.household.id, last) };
	});

export const getScenarios = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }) => loadScenarios(getDb(), context.household.id));

/** Creates a Scenario, or renames it and replaces its Levers. */
export const saveScenario = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ scenarioId: ulidSchema, name: scenarioNameSchema, levers: leversSchema }))
	.handler(async ({ data, context }) => {
		await saveScenarioInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
		});
		await notifyHousehold(context.household.id, ["scenarios"]);
	});

export const deleteScenario = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ scenarioId: ulidSchema }))
	.handler(async ({ data, context }) => {
		await deleteScenarioInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["scenarios"]);
	});

/** Makes a Scenario's Levers the real Plan from this month on, all at once. */
export const applyScenario = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ levers: leversSchema }))
	.handler(async ({ data, context }) => {
		const today = dayKeyAt(new Date(), context.household.timeZone);
		if (
			data.levers.some((l) => l.kind === "goal" && l.targetDate !== null && l.targetDate < today)
		) {
			throw new Error("A Goal’s target date can’t be in the past.");
		}
		await applyLevers(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			month: monthKeyAt(new Date(), context.household.timeZone),
			levers: data.levers,
		});
		await notifyHousehold(context.household.id, ["months", "goals"]);
	});
