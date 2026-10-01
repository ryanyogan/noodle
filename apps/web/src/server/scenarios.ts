import {
	applyChanges,
	deleteScenario as deleteScenarioInDb,
	loadPlanRecords,
	loadScenarios,
	type ScenarioRecord,
	saveScenario as saveScenarioInDb,
} from "@noodle/db";
import {
	activeChanges,
	addMonths,
	CADENCES,
	dayKeyAt,
	isAssumption,
	MAX_CENTS,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	monthKeyAt,
	monthOfDay,
	type PlanRecords,
	type ScenarioChange,
	type ScenarioChangeV1,
	upgradeChanges,
	whyNotApplicable,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { commitmentNameSchema } from "./commitments";
import { getDb } from "./db";
import { goalNameSchema } from "./goals";
import { householdMiddleware } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { bucketNameSchema } from "./plan";
import { dayKeySchema, ulidSchema } from "./schemas";

// Scenarios and the Plan they're projected from. Saving is idempotent per the client's ULID, so
// the client can retry it safely; applying writes only the Plan's own idempotent changes.

export type { ScenarioRecord };

/**
 * The Plan's records from now to as far as a Scenario projects, with the Household's current
 * month: the client resolves and projects them with @noodle/domain as the Changes move.
 */
export type PlanAheadData = { month: MonthKey; records: PlanRecords };

const centsSchema = z.number().int().min(0).max(MAX_CENTS);
const positiveCentsSchema = z.number().int().min(1).max(MAX_CENTS);
const dueDaySchema = z.number().int().min(1).max(31);
const pctSchema = z.number().min(-50).max(50);

/** A v2 Change's fields plus its range of months, and whether it's muted. */
const ranged = <S extends z.ZodRawShape>(shape: S) =>
	z.object({
		...shape,
		fromMonth: monthKeySchema,
		untilMonth: monthKeySchema.optional(),
		muted: z.boolean().optional(),
	});

const changeV2Schema = z.discriminatedUnion("kind", [
	ranged({ kind: z.literal("baseline"), amount: centsSchema }),
	ranged({ kind: z.literal("allowance"), bucketId: ulidSchema, amount: centsSchema }),
	ranged({
		kind: z.literal("commitment-terms"),
		commitmentId: ulidSchema,
		amount: positiveCentsSchema.optional(),
		cadence: z.enum(CADENCES).optional(),
		dueDay: dueDaySchema.optional(),
	}),
	ranged({ kind: z.literal("end-commitment"), commitmentId: ulidSchema }),
	ranged({
		kind: z.literal("add-commitment"),
		commitmentId: ulidSchema,
		name: commitmentNameSchema,
		amount: positiveCentsSchema,
		cadence: z.enum(CADENCES),
		dueDay: dueDaySchema,
		months: z.number().int().min(1).max(600).nullable(),
	}),
	// A one-off is in `fromMonth` only, so it has no `untilMonth`.
	z.object({
		kind: z.literal("one-off"),
		oneOffId: ulidSchema,
		name: commitmentNameSchema,
		amount: positiveCentsSchema,
		flow: z.enum(["expense", "income"]),
		fromMonth: monthKeySchema,
		muted: z.boolean().optional(),
	}),
	ranged({
		kind: z.literal("add-bucket"),
		bucketId: ulidSchema,
		name: bucketNameSchema,
		amount: centsSchema,
		rolling: z.boolean().optional(),
		color: z.number().int().min(1).max(8).optional(),
	}),
	ranged({ kind: z.literal("archive-bucket"), bucketId: ulidSchema }),
	ranged({
		kind: z.literal("goal"),
		goalId: ulidSchema,
		target: positiveCentsSchema,
		targetDate: dayKeySchema.nullable(),
	}),
	ranged({
		kind: z.literal("add-goal"),
		goalId: ulidSchema,
		name: goalNameSchema,
		target: positiveCentsSchema,
		targetDate: dayKeySchema.nullable(),
		accountId: ulidSchema.optional(),
	}),
	ranged({ kind: z.literal("growth"), incomePct: pctSchema, costsPct: pctSchema }),
]);

/** Changes as v1 Scenarios (and clients) sent them, upgraded before use. */
const changeV1Schema = z.discriminatedUnion("kind", [
	z.object({ kind: z.literal("allowance"), bucketId: ulidSchema, amount: centsSchema }),
	z.object({
		kind: z.literal("end-commitment"),
		commitmentId: ulidSchema,
		fromMonth: monthKeySchema,
	}),
	z.object({
		kind: z.literal("goal"),
		goalId: ulidSchema,
		target: positiveCentsSchema,
		targetDate: dayKeySchema.nullable(),
	}),
	z.object({
		kind: z.literal("add-commitment"),
		commitmentId: ulidSchema,
		name: commitmentNameSchema,
		amount: positiveCentsSchema,
		fromMonth: monthKeySchema,
		months: z.number().int().min(1).max(600).nullable(),
	}),
]);

const changeSchema: z.ZodType<ScenarioChange | ScenarioChangeV1> = z
	.union([changeV2Schema, changeV1Schema])
	.refine(
		(change) =>
			!("untilMonth" in change) ||
			change.untilMonth === undefined ||
			change.untilMonth > change.fromMonth,
		{
			message: "A change’s range must end after it starts.",
		},
	);

const changesSchema = z.array(changeSchema).max(200);
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
	.handler(({ context }) =>
		loadScenarios(
			getDb(),
			context.household.id,
			monthKeyAt(new Date(), context.household.timeZone),
		),
	);

/** Creates a Scenario, or renames it and replaces its Changes. */
export const saveScenario = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ scenarioId: ulidSchema, name: scenarioNameSchema, levers: changesSchema }))
	.handler(async ({ data, context }) => {
		const month = monthKeyAt(new Date(), context.household.timeZone);
		await saveScenarioInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			...data,
			levers: upgradeChanges(data.levers, month),
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

/**
 * Makes a Scenario's Changes the real Plan from this month on, all at once, and records who
 * applied it and when; muted Changes and assumptions (one-offs, growth) aren't applied. The
 * Scenario is saved as it's applied, with all its Changes.
 */
export const applyScenario = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ scenarioId: ulidSchema, name: scenarioNameSchema, levers: changesSchema }))
	.handler(async ({ data, context }) => {
		const today = dayKeyAt(new Date(), context.household.timeZone);
		const month = monthOfDay(today);
		const changes = upgradeChanges(data.levers, month);
		const applied = activeChanges(changes).filter((l) => !isAssumption(l));
		for (const change of applied) {
			const why = whyNotApplicable(change, month);
			if (why !== null) throw new Error(why);
		}
		if (
			applied.some(
				(l) =>
					(l.kind === "goal" || l.kind === "add-goal") &&
					l.targetDate !== null &&
					l.targetDate < today,
			)
		) {
			throw new Error("A Goal’s target date can’t be in the past.");
		}
		await applyChanges(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			scenarioId: data.scenarioId,
			scenario: { name: data.name, levers: changes },
			month,
			levers: applied,
		});
		await notifyHousehold(context.household.id, ["months", "goals", "scenarios"]);
	});
