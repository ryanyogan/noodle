import type { Cadence, Cents, DayKey, DraftLabels, MonthKey } from "@noodle/domain";
import { and, eq, isNull } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { commitmentAdd } from "./commitments";
import type { Db } from "./index";
import { baselineLog, bucketAdd } from "./plan";
import { nextColor } from "./scenarios";
import { baselines, planDraftDecisions, planDrafts } from "./schema";

// The first Plan's draft: what a model said about a Household's history, and each Parent's
// decisions on its suggestions. Adding a suggestion writes it to the Plan the way adding it by
// hand does (with its Plan change, ADR-0014), in the same batch as the decision that hides it.

export type PlanDraftState = {
	labels: DraftLabels;
	/** A Parent is done with the draft: it no longer shows. */
	finished: boolean;
	/** The keys of the suggestions added or skipped. */
	decided: Set<string>;
};

/** The Household's draft, or null when it never had one. */
export async function loadPlanDraft(db: Db, householdId: string): Promise<PlanDraftState | null> {
	const [draft, decisions] = await Promise.all([
		db
			.select({ labels: planDrafts.labels, finishedAt: planDrafts.finishedAt })
			.from(planDrafts)
			.where(eq(planDrafts.householdId, householdId))
			.get(),
		db
			.select({ key: planDraftDecisions.key })
			.from(planDraftDecisions)
			.where(eq(planDraftDecisions.householdId, householdId)),
	]);
	if (!draft) return null;
	return {
		labels: draft.labels,
		finished: draft.finishedAt !== null,
		decided: new Set(decisions.map((d) => d.key)),
	};
}

/**
 * Keeps what a model said about the Household's history, starting its draft if it has none.
 * `labels` replaces what was kept: the caller merges in what was said before.
 */
export async function saveDraftLabels(
	db: Db,
	householdId: string,
	labels: DraftLabels,
): Promise<void> {
	await db
		.insert(planDrafts)
		.values({ householdId, labels })
		.onConflictDoUpdate({ target: planDrafts.householdId, set: { labels } });
}

export type DraftCommitmentToAdd = {
	key: string;
	commitmentId: string;
	name: string;
	amountCents: Cents;
	cadence: Cadence;
	dueDate: DayKey;
};

export type DraftBucketToAdd = {
	key: string;
	bucketId: string;
	name: string;
	allowanceCents: Cents;
};

/**
 * Adds suggestions to the Plan from `month` on, as the Parent `memberId` left them, and skips
 * others (by key), in one batch. The first decision on a suggestion stands; each add is
 * idempotent per its client-generated ID, so a retried save adds nothing twice.
 */
export async function decideDraft(
	db: Db,
	input: {
		householdId: string;
		memberId: string;
		month: MonthKey;
		baselineCents?: Cents | null;
		commitments?: DraftCommitmentToAdd[];
		buckets?: DraftBucketToAdd[];
		skipped?: string[];
	},
): Promise<void> {
	const { householdId, memberId, month } = input;
	const writes: BatchItem<"sqlite">[] = [];
	const decide = (key: string, decision: "added" | "skipped") =>
		writes.push(
			db
				.insert(planDraftDecisions)
				.values({ householdId, key, decision, memberId })
				.onConflictDoNothing(),
		);
	if (input.baselineCents != null) {
		const amountCents = input.baselineCents;
		writes.push(
			baselineLog(db, { householdId, memberId, month, amountCents }),
			db
				.insert(baselines)
				.values({ householdId, month, amountCents })
				.onConflictDoUpdate({
					target: [baselines.householdId, baselines.month],
					set: { amountCents },
				}),
		);
		decide("baseline", "added");
	}
	for (const { key, ...commitment } of input.commitments ?? []) {
		writes.push(...commitmentAdd(db, { householdId, memberId, month, ...commitment }));
		decide(key, "added");
	}
	for (const { key, ...bucket } of input.buckets ?? []) {
		// Each takes the next colour in turn, counting the ones added before it in the batch.
		writes.push(
			...bucketAdd(db, { householdId, memberId, month, ...bucket, color: nextColor(householdId) }),
		);
		decide(key, "added");
	}
	for (const key of input.skipped ?? []) decide(key, "skipped");
	const [first, ...rest] = writes;
	if (first) await db.batch([first, ...rest]);
}

/** A Parent is done with the draft: it stops showing, whatever is left in it. */
export async function finishDraft(db: Db, householdId: string, memberId: string): Promise<void> {
	await db
		.update(planDrafts)
		.set({ finishedAt: new Date(), finishedByMemberId: memberId })
		.where(and(eq(planDrafts.householdId, householdId), isNull(planDrafts.finishedAt)));
}
