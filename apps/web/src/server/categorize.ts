import { env, waitUntil } from "cloudflare:workers";
import type { Viewer } from "@noodle/db";
import {
	memoryMerchants,
	stubClassifier,
	vectorizeMerchants,
	workersAiClassifier,
} from "./categorize-model";
import {
	type CategorizeDeps,
	type CategorizeResult,
	categorizeCapture,
	categorizeImport,
	settleAssignment,
} from "./categorize-run";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";

// Categorization in the Worker. It runs after the upload has responded (waitUntil), not in it:
// the Import has already landed and the Parent sees its Transactions at once, while embedding,
// Vectorize, and the model take a few seconds for a statement. When it's done, the Household's
// screens are told to refetch, so filed Transactions appear with their marker. A statement's
// merchants go to the model in parallel prompts of ten, inside waitUntil's 30 seconds. A Bank
// Connection's Imports are categorized in the Import Workflow, which awaits it.

/** The fake merchant index for AI_MODEL=stub, kept for as long as the dev server runs. */
const stubMerchants = memoryMerchants();

function categorizeDeps(): CategorizeDeps {
	if (__AI_STUB__) return { db: getDb(), classifier: stubClassifier, merchants: stubMerchants };
	return {
		db: getDb(),
		classifier: workersAiClassifier(env.AI, env.AI_GATEWAY_ID),
		// Typed as the Vectorize beta binding by `wrangler types`; the index is a current one.
		merchants: vectorizeMerchants(env.AI, env.AI_GATEWAY_ID, env.MERCHANTS as unknown as Vectorize),
	};
}

/** Categorizes an Import for the Parent who brought it in, after the response has gone. */
export function categorizeAfterImport(viewer: Viewer, importId: string): void {
	waitUntil(categorizeImported(viewer, importId));
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
			`Categorized Import ${importId}: ${result.filed} filed, ${result.review} for Review, ${Date.now() - started} ms`,
		);
		if (result.filed + result.review === 0) return;
		// Filing changes spending, which carries into later months.
		await notifyHousehold(viewer.householdId, ["months", "for-earlier", "bucket-uses"]);
	} catch (error) {
		console.error("Couldn’t categorize an Import", error);
	}
}

/**
 * Categorizes a captured Quick Add for the Parent who captured it. The ingest Queue's consumer
 * already runs apart from any response, so this is awaited, not deferred. Never throws: a capture
 * it can't file stays unassigned, like one it isn't sure of.
 */
export async function categorizeCaptured(
	viewer: Viewer,
	transactionId: string,
): Promise<CategorizeResult> {
	try {
		return await categorizeCapture(categorizeDeps(), viewer, transactionId);
	} catch (error) {
		console.error("Couldn’t categorize a captured Quick Add", error);
		return { filed: 0, review: 0, months: [] };
	}
}

/**
 * A Parent changed or confirmed a Transaction: it leaves categorization now, and an imported one's
 * merchant is learned for its Bucket after the response has gone. Never fails the edit.
 */
export async function afterAssignment(viewer: Viewer, transactionId: string): Promise<void> {
	try {
		const { teach } = await settleAssignment(categorizeDeps(), viewer, transactionId);
		waitUntil(teach().catch((error: unknown) => console.error("Couldn’t learn a merchant", error)));
	} catch (error) {
		console.error("Couldn’t settle a Transaction’s categorization", error);
	}
}
