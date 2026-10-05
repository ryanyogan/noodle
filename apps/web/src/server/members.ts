import {
	addChild as addChildInDb,
	listMembers,
	loadPlanRecords,
	loadSpendingEarlierInYear,
	type MemberSummary,
	removeChild as removeChildInDb,
	updateChild as updateChildInDb,
	updateParent as updateParentInDb,
} from "@noodle/db";
import { type ForTotals, forTotals } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { personalRenames } from "../starter-buckets";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// The Household's Members and what was spent For them. Each change is idempotent, so the client
// can retry any of them safely.

const childNameSchema = z.string().trim().min(1).max(40);
const colorSchema = z.number().int().min(1).max(8);
// As /welcome's "Your name".
const parentNameSchema = z.string().trim().min(1).max(80);

/** Every Member, Parents and Children, removed Children included (they still name old spending). */
export const getMembers = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }): Promise<MemberSummary[]> => listMembers(getDb(), context.household.id));

export const addChild = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ memberId: ulidSchema, name: childNameSchema, color: colorSchema }))
	.handler(async ({ data, context }) => {
		await addChildInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["members"]);
	});

export const updateChild = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			memberId: ulidSchema,
			name: childNameSchema.optional(),
			color: colorSchema.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		await updateChildInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["members"]);
	});

/**
 * A Parent's own name and colour (issue 104). Only theirs: naming the other Parent is refused.
 * This is the name Noodle shows; their sign-in (Clerk) is untouched.
 */
export const updateParent = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			memberId: ulidSchema,
			name: parentNameSchema.optional(),
			color: colorSchema.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const saved = await updateParentInDb(getDb(), {
			householdId: context.household.id,
			byParentId: context.parent.id,
			...data,
			bucketRenames: data.name === undefined ? [] : personalRenames(context.parent.name, data.name),
		});
		if (!saved) throw new Error("A Parent changes only their own name and colour");
		// Their name is on both Parents' screens: For and Reports (members), Household settings and
		// "still to set" (parents), who has done the Check-in, and their Personal Allowance's name.
		await notifyHousehold(context.household.id, [
			"members",
			"parents",
			"check-in",
			...(data.name === undefined ? [] : (["months"] as const)),
		]);
	});

export const removeChild = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ memberId: ulidSchema }))
	.handler(async ({ data, context }) => {
		await removeChildInDb(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, ["members"]);
	});

export type ForTotalsEarlier = {
	totals: ForTotals;
	/** Every Bucket the totals can name, archived ones included. */
	buckets: { id: string; name: string; color: number }[];
};

/**
 * What was spent For each Member in `month`'s year before `month`. The client adds the month's
 * own spending (from its cached inputs, so it moves with every optimistic edit) for the year
 * to date.
 */
export const getForTotalsEarlierInYear = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.validator(z.object({ month: monthKeySchema }))
	.handler(async ({ data, context }): Promise<ForTotalsEarlier> => {
		const db = getDb();
		const [spending, records] = await Promise.all([
			loadSpendingEarlierInYear(db, viewerOf(context), data.month),
			loadPlanRecords(db, context.household.id, data.month),
		]);
		return {
			totals: forTotals(spending),
			buckets: records.buckets.map(({ id, name, color }) => ({ id, name, color })),
		};
	});
