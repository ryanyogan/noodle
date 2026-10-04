import { type Db, learnedMerchantBuckets } from "@noodle/db";
import type { MerchantIndex } from "./categorize-model";

// Building a Household's merchant index again from its rows (#78, ADR-0035). After a snapshot is
// restored the index is out of step: it was emptied for the Household before its rows were
// replaced, and the restored rows say what it had been taught. Learning writes each merchant's
// vector under an id made from the Household and the merchant, so running this twice, or again
// after a failure part way, leaves the same index.

export type LearnedMerchant = { merchant: string; bucketId: string };

/** How many merchants one Workflow step teaches: each is a call to the embedding model. */
export const RELEARN_BATCH = 20;

export function relearnBatches(learned: LearnedMerchant[]): LearnedMerchant[][] {
	const batches: LearnedMerchant[][] = [];
	for (let i = 0; i < learned.length; i += RELEARN_BATCH)
		batches.push(learned.slice(i, i + RELEARN_BATCH));
	return batches;
}

/** Teaches the index each merchant's Bucket, replacing what it knew of that merchant. */
export async function relearnMerchants(
	index: Pick<MerchantIndex, "learn">,
	householdId: string,
	learned: LearnedMerchant[],
): Promise<number> {
	for (const { merchant, bucketId } of learned) await index.learn(householdId, merchant, bucketId);
	return learned.length;
}

/** The whole rebuild in one go, for where there are no Workflow steps to split it over. */
export async function rebuildMerchantIndex(
	deps: { db: Db; merchants: Pick<MerchantIndex, "learn"> },
	householdId: string,
): Promise<number> {
	return relearnMerchants(
		deps.merchants,
		householdId,
		await learnedMerchantBuckets(deps.db, householdId),
	);
}
