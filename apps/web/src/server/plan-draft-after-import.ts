import { env, waitUntil } from "cloudflare:workers";
import type { Viewer } from "@noodle/db";
import { dayKeyAt } from "@noodle/domain";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";
import { stubDraftModel, workersAiDraftModel } from "./plan-draft-model";
import { labelPlanDraft, type PlanDraftDeps } from "./plan-draft-run";

// Drafting the first Plan in the Worker, after new history has landed and the response has gone
// (waitUntil), like categorization: the model takes a few seconds; the Import Workflow awaits it
// instead. When it's done, the Household's screens are told to refetch the draft.

function draftDeps(): PlanDraftDeps {
	return {
		db: getDb(),
		model: __AI_STUB__ ? stubDraftModel : workersAiDraftModel(env.AI, env.AI_GATEWAY_ID),
	};
}

/**
 * Drafts the first Plan from the Household's history after new history came in, for the Parent
 * who brought it in (a statement), after the response has gone. Does nothing once the Plan is set
 * up or a Parent finished the draft.
 */
export function draftPlanAfterImport(viewer: Viewer, timeZone: string): void {
	waitUntil(draftPlan(viewer, timeZone));
}

/**
 * The same, awaited, where nothing is waiting on a response: the Import Workflow, for a Bank
 * Connection's Imports (a Workflow step should finish its work itself rather than hand it to
 * waitUntil, which may not outlive the step). Never throws.
 */
export async function draftPlan(viewer: Viewer, timeZone: string): Promise<void> {
	try {
		const findings = await labelPlanDraft(draftDeps(), viewer, dayKeyAt(new Date(), timeZone));
		if (findings) await notifyHousehold(viewer.householdId, ["plan-draft"]);
	} catch (error) {
		console.error("Couldn’t draft the Plan", error);
	}
}
