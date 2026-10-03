import { env, waitUntil } from "cloudflare:workers";
import type { Viewer } from "@noodle/db";
import { queueAi } from "./ai-queue";
import {
	memoryMerchants,
	stubClassifier,
	vectorizeMerchants,
	workersAiClassifier,
} from "./categorize-model";
import {
	type CategorizeDeps,
	type CategorizeResult,
	categorizeImport,
	describeResult,
	lookAgainAtReview,
	settleAssignment,
} from "./categorize-run";
import { getDb } from "./db";
import { type MerchantNamer, stubNamer, workersAiNamer } from "./merchant-model";
import { notifyHousehold } from "./notify";

// Categorization in the Worker. New Transactions (an upload, a bank sync, a Quick Add or receipt)
// are filed by background AI (ADR-0027): the write sends the Household's Agent an event, and the
// Agent files everything new in one run about a minute later, then tells the Household's screens
// to refetch, so filed Transactions appear with their marker. Setup's first history is still
// categorized in its Workflow, which shows that step. "Look again" in Review runs here directly.

/** The fake merchant index for AI_MODEL=stub, kept for as long as the dev server runs. */
const stubMerchants = memoryMerchants();

/** Merchant names for background AI's first step: the normaliser's own guess under AI_MODEL=stub. */
export function merchantNamer(): MerchantNamer {
	return __AI_STUB__ ? stubNamer : workersAiNamer(env.AI, env.AI_GATEWAY_ID);
}

export function categorizeDeps(): CategorizeDeps {
	if (__AI_STUB__) return { db: getDb(), classifier: stubClassifier, merchants: stubMerchants };
	return {
		db: getDb(),
		classifier: workersAiClassifier(env.AI, env.AI_GATEWAY_ID),
		// Typed as the Vectorize beta binding by `wrangler types`; the index is a current one.
		merchants: vectorizeMerchants(env.AI, env.AI_GATEWAY_ID, env.MERCHANTS as unknown as Vectorize),
	};
}

/**
 * Categorizes an Import for the Parent who brought it in, and tells the Household once it's done.
 * Awaited where nothing is waiting on a response (the Import Workflow). Never throws: what it
 * can't file stays unassigned.
 */
export async function categorizeImported(viewer: Viewer, importId: string): Promise<void> {
	try {
		const started = Date.now();
		const result = await categorizeImport(categorizeDeps(), viewer, importId);
		console.log(
			`Categorized Import ${importId}: ${describeResult(result)}, ${Date.now() - started} ms`,
		);
		if (result.filed + result.review === 0) return;
		// Filing changes spending, which carries into later months.
		await notifyHousehold(viewer.householdId, ["months", "for-earlier", "bucket-uses"]);
	} catch (error) {
		console.error("Couldn’t categorize an Import", error);
	}
}

/**
 * Looks again at what waits in Review that this Parent imported, against the Plan as it is now,
 * and tells the Household when anything changed. Throws, for a Parent who asked to see it fail.
 */
export async function lookAgain(viewer: Viewer): Promise<CategorizeResult> {
	const started = Date.now();
	const result = await lookAgainAtReview(categorizeDeps(), viewer);
	console.log(
		`Looked again at Review for ${viewer.memberId}: ${describeResult(result)}, ${Date.now() - started} ms`,
	);
	if (result.filed + result.review > 0) {
		await notifyHousehold(viewer.householdId, ["months", "for-earlier", "bucket-uses"]);
	}
	return result;
}

/**
 * A Parent changed or confirmed a Transaction: it leaves categorization now, and an imported one's
 * merchant is learned for its Bucket after the response has gone. Never fails the edit.
 */
export async function afterAssignment(viewer: Viewer, transactionId: string): Promise<void> {
	try {
		const { teach } = await settleAssignment(categorizeDeps(), viewer, transactionId);
		waitUntil(teach().catch((error: unknown) => console.error("Couldn’t learn a merchant", error)));
		// A learning signal for background AI's later steps (ADR-0027).
		await queueAi({ ...viewer, kind: "filed-by-hand", ids: [transactionId] });
	} catch (error) {
		console.error("Couldn’t settle a Transaction’s categorization", error);
	}
}
