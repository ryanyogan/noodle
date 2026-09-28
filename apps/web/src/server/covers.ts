import { addCover, undoMove } from "@noodle/db";
import {
	type Cents,
	leftToMove,
	MAX_CENTS,
	type MonthKey,
	monthKeyAt,
	monthState,
} from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware } from "./household";
import { loadMonth, monthKeySchema } from "./month";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

/** Covers happen within the current month: earlier months are closed, later ones haven't begun. */
function assertCurrentMonth(household: Pick<HouseholdSummary, "timeZone">, month: MonthKey) {
	if (month !== monthKeyAt(new Date(), household.timeZone)) {
		throw new Error("Only this month’s Buckets can be covered.");
	}
}

/** Refused when the source no longer has the amount left; `left` is what it has. */
export type CoverOutcome = { ok: true } | { ok: false; left: Cents };

/**
 * Covers an overspent Bucket: Moves `amountCents` to it from another Bucket, or from Free to
 * Spend when `fromBucketId` is null. Idempotent per `moveId` (a client ULID). The source must
 * have that much left: checked first, then re-guarded inside the write (ADR-0004), so a
 * concurrent write by the other Parent can't overdraw it.
 */
export const coverBucket = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z
			.object({
				moveId: ulidSchema,
				month: monthKeySchema,
				fromBucketId: ulidSchema.nullable(),
				toBucketId: ulidSchema,
				amountCents: z.number().int().min(1).max(MAX_CENTS),
			})
			.refine((cover) => cover.fromBucketId !== cover.toBucketId, "A Bucket can’t cover itself"),
	)
	.handler(async ({ data, context }): Promise<CoverOutcome> => {
		const { household } = context;
		assertCurrentMonth(household, data.month);
		const db = getDb();
		const leftNow = async () => {
			const month = await loadMonth(db, household, data.month);
			// A retry mustn't count its own earlier attempt against the source.
			const state = monthState({
				...month,
				moves: month.moves.filter((m) => m.id !== data.moveId),
			});
			if (!state.buckets.some((b) => b.id === data.toBucketId)) return null;
			return leftToMove(state, data.fromBucketId);
		};
		const left = await leftNow();
		if (left === null) throw new Error("That Bucket isn’t in this month’s Plan.");
		if (left < data.amountCents) return { ok: false, left: Math.max(0, left) };
		const result = await addCover(db, {
			householdId: household.id,
			moveId: data.moveId,
			month: data.month,
			fromBucketId: data.fromBucketId,
			toBucketId: data.toBucketId,
			amountCents: data.amountCents,
			createdByMemberId: context.parent.id,
		});
		// Another write got there between the check and this one.
		if (!result.ok) return { ok: false, left: Math.max(0, (await leftNow()) ?? 0) };
		await notifyHousehold(household.id, [`month:${data.month}`]);
		return { ok: true };
	});

/** Undoes a Cover, putting the money back where it came from. Undoing it again changes nothing. */
export const undoCover = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ moveId: ulidSchema, month: monthKeySchema }))
	.handler(async ({ data, context }) => {
		assertCurrentMonth(context.household, data.month);
		await undoMove(getDb(), { householdId: context.household.id, ...data });
		await notifyHousehold(context.household.id, [`month:${data.month}`]);
	});
