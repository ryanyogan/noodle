import {
	addBucket as addBucketInDb,
	addCommitment as addCommitmentInDb,
	decideSuggestion as decideSuggestionInDb,
	loadOpenSuggestion,
	loadOpenSuggestions,
	loadPlanRecords,
	type SuggestionItem,
	saveRule,
	updateCommitment as updateCommitmentInDb,
} from "@noodle/db";
import { CADENCES, type Cadence, type DayKey, dayKeyAt, monthOfDay } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { ulid } from "ulid";
import { z } from "zod";
import { queueAi } from "./ai-queue";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { notifyHousehold } from "./notify";
import { centsSchema } from "./plan";
import { dayKeySchema } from "./schemas";

// Suggestions (ADR-0027): each Parent reads the Household's open ones and their own (ADR-0003).
// Accepting one adds what it suggests to this month's Plan with the usual Plan change, through the
// same writes as adding it by hand; dismissing one keeps it away until its evidence changes a lot.

export const getSuggestions = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		({ context }): Promise<SuggestionItem[]> => loadOpenSuggestions(getDb(), viewerOf(context)),
	);

type Terms = {
	name: string;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
	commitmentId?: string;
	merchant?: string;
	bucketId?: string;
};

/**
 * Adds or dismisses ("Not now") a suggestion. Idempotent: a decided one does nothing again. `terms`
 * are what the Parent changed before adding a new Bucket or Commitment (name, amount, schedule).
 */
export const decideSuggestion = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			suggestionId: z.string().min(1).max(64),
			decision: z.enum(["add", "not-now"]),
			terms: z
				.object({
					name: z.string().trim().min(1).max(40),
					amountCents: centsSchema,
					cadence: z.enum(CADENCES as [Cadence, ...Cadence[]]).optional(),
					dueDate: dayKeySchema.optional(),
				})
				.optional(),
		}),
	)
	.handler(async ({ data, context }) => {
		const db = getDb();
		const viewer = viewerOf(context);
		const householdId = context.household.id;
		const memberId = context.parent.id;
		const row = await loadOpenSuggestion(db, viewer, data.suggestionId);
		if (row?.status !== "open") return;
		if (data.decision === "not-now") {
			await decideSuggestionInDb(db, viewer, row.id, "dismissed");
			await notifyHousehold(householdId, ["suggestions"]);
			return;
		}
		const month = monthOfDay(dayKeyAt(new Date(), context.household.timeZone));
		const suggested = row.payload as Terms;
		const edited =
			row.kind === "new-bucket" || row.kind === "new-commitment" ? data.terms : undefined;
		const terms: Terms = {
			...suggested,
			...edited,
			cadence: edited?.cadence ?? suggested.cadence,
			dueDate: (edited?.dueDate as DayKey | undefined) ?? suggested.dueDate,
		};
		if (row.kind === "new-bucket") {
			const plan = await loadPlanRecords(db, householdId, month);
			await addBucketInDb(db, {
				householdId,
				memberId,
				bucketId: ulid(),
				name: terms.name.slice(0, 40),
				color: (plan.buckets.length % 8) + 1,
				month,
				allowanceCents: terms.amountCents,
			});
			await queueAi({ ...viewer, kind: "buckets-changed" });
		} else if (row.kind === "new-commitment" || row.kind === "commitment-amount") {
			const commitmentId = row.kind === "new-commitment" ? ulid() : (terms.commitmentId as string);
			const write = row.kind === "new-commitment" ? addCommitmentInDb : updateCommitmentInDb;
			await write(db, {
				householdId,
				memberId,
				commitmentId,
				month,
				name: terms.name.slice(0, 40),
				amountCents: terms.amountCents,
				cadence: terms.cadence,
				dueDate: terms.dueDate,
			});
			await queueAi({ ...viewer, kind: "commitment-changed", ids: [commitmentId] });
		} else if (row.kind === "rule") {
			// The same write as stating a Rule on Review: into this Parent's own Personal Allowance
			// it's private to them (ADR-0003); a Bucket they can't assign to makes nothing.
			const saved = await saveRule(db, {
				id: ulid(),
				householdId,
				memberId,
				pattern: terms.merchant ?? terms.name,
				bucketId: terms.bucketId ?? "",
			});
			if (!saved.ok) return;
			await queueAi({ ...viewer, kind: "rule-added" });
			if (!saved.private) await notifyHousehold(householdId, ["rules"]);
		} else return;
		await decideSuggestionInDb(db, viewer, row.id, "accepted");
		await notifyHousehold(householdId, ["months", "suggestions"]);
	});
