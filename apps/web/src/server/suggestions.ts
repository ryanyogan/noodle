import { waitUntil } from "cloudflare:workers";
import {
	acceptSuggestionAdding,
	type Db,
	decideSuggestion as decideSuggestionInDb,
	loadOpenSuggestion,
	loadOpenSuggestions,
	loadPlanRecords,
	type SuggestionItem,
	saveRule,
	updateCommitment as updateCommitmentInDb,
	type Viewer,
} from "@noodle/db";
import { CADENCES, type Cadence, type DayKey, dayKeyAt, monthOfDay } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { encodeTime, ulid } from "ulid";
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

const decisionSchema = z.object({
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
});

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * The ID of the Bucket or Commitment that adding this suggestion makes (#76): always the same for
 * the suggestion as it stands, so a second Add (a double tap, or a retry after the signal dropped)
 * writes the same one again, which the add ignores, and never a duplicate. Shaped like a ULID. A
 * suggestion opened again later (its `updatedAt` moves) gets a new one.
 */
export async function addedId(row: { id: string; updatedAt: Date }): Promise<string> {
	const at = row.updatedAt.getTime();
	const hash = new Uint8Array(
		await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${row.id}|${at}`)),
	);
	return encodeTime(at, 10) + Array.from(hash.subarray(0, 16), (b) => CROCKFORD[b % 32]).join("");
}

/**
 * Adds or dismisses ("Not now") a suggestion. Idempotent: a decided one does nothing again, and
 * adding the same open one twice makes one Bucket or Commitment. `terms` are what the Parent
 * changed before adding a new Bucket or Commitment (name, amount, schedule).
 *
 * The decision is durable before anything else happens: a new Bucket or Commitment lands in the
 * same batch as the suggestion's "accepted" mark, and telling background AI and the Household's
 * open screens is left to `defer` (waitUntil), where a failure can't undo or fail the decision.
 */
export async function applyDecision(
	db: Db,
	who: { viewer: Viewer; timeZone: string },
	data: z.infer<typeof decisionSchema>,
	defer: (work: Promise<unknown>) => void = waitUntil,
): Promise<void> {
	const { viewer } = who;
	const { householdId, memberId } = viewer;
	const after = (work: () => Promise<unknown>) => {
		const failed = (error: unknown) => console.error("Couldn’t follow up a suggestion", error);
		try {
			defer(Promise.resolve().then(work).catch(failed));
		} catch (error) {
			failed(error);
		}
	};
	const row = await loadOpenSuggestion(db, viewer, data.suggestionId);
	if (row?.status !== "open") return;
	if (data.decision === "not-now") {
		await decideSuggestionInDb(db, viewer, row.id, "dismissed");
		after(() => notifyHousehold(householdId, ["suggestions"]));
		return;
	}
	const month = monthOfDay(dayKeyAt(new Date(), who.timeZone));
	const suggested = row.payload as Terms;
	const edited =
		row.kind === "new-bucket" || row.kind === "new-commitment" ? data.terms : undefined;
	const terms: Terms = {
		...suggested,
		...edited,
		cadence: edited?.cadence ?? suggested.cadence,
		dueDate: (edited?.dueDate as DayKey | undefined) ?? suggested.dueDate,
	};
	const name = terms.name.slice(0, 40);
	if (row.kind === "new-bucket") {
		const plan = await loadPlanRecords(db, householdId, month);
		await acceptSuggestionAdding(db, viewer, row.id, {
			bucket: {
				householdId,
				memberId,
				bucketId: await addedId(row),
				name,
				color: (plan.buckets.length % 8) + 1,
				month,
				allowanceCents: terms.amountCents,
			},
		});
		after(async () => {
			await queueAi({ ...viewer, kind: "buckets-changed" });
			await notifyHousehold(householdId, ["months", "suggestions"]);
		});
	} else if (row.kind === "new-commitment") {
		const commitmentId = await addedId(row);
		await acceptSuggestionAdding(db, viewer, row.id, {
			commitment: {
				householdId,
				memberId,
				commitmentId,
				month,
				name,
				amountCents: terms.amountCents,
				cadence: terms.cadence,
				dueDate: terms.dueDate,
			},
		});
		after(async () => {
			await queueAi({ ...viewer, kind: "commitment-changed", ids: [commitmentId] });
			await notifyHousehold(householdId, ["months", "suggestions"]);
		});
	} else if (row.kind === "commitment-amount") {
		// Setting the same terms again changes nothing, so a second Update is safe.
		const commitmentId = terms.commitmentId as string;
		await updateCommitmentInDb(db, {
			householdId,
			memberId,
			commitmentId,
			month,
			name,
			amountCents: terms.amountCents,
			cadence: terms.cadence,
			dueDate: terms.dueDate,
		});
		await decideSuggestionInDb(db, viewer, row.id, "accepted");
		after(async () => {
			await queueAi({ ...viewer, kind: "commitment-changed", ids: [commitmentId] });
			await notifyHousehold(householdId, ["months", "suggestions"]);
		});
	} else if (row.kind === "rule") {
		// The same write as stating a Rule on Review: into this Parent's own Personal Allowance
		// it's private to them (ADR-0003); a Bucket they can't assign to makes nothing. One Rule per
		// merchant, so a second Add changes nothing.
		const saved = await saveRule(db, {
			id: ulid(),
			householdId,
			memberId,
			pattern: terms.merchant ?? terms.name,
			bucketId: terms.bucketId ?? "",
		});
		if (!saved.ok) return;
		await decideSuggestionInDb(db, viewer, row.id, "accepted");
		after(async () => {
			await queueAi({ ...viewer, kind: "rule-added" });
			if (!saved.private) await notifyHousehold(householdId, ["rules"]);
			await notifyHousehold(householdId, ["months", "suggestions"]);
		});
	}
}

export const decideSuggestion = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(decisionSchema)
	.handler(({ data, context }) =>
		applyDecision(
			getDb(),
			{ viewer: viewerOf(context), timeZone: context.household.timeZone },
			data,
		),
	);
