import { env, waitUntil } from "cloudflare:workers";
import type { Viewer } from "@noodle/db";
import { dayKeyAt } from "@noodle/domain";
import { getDb } from "./db";
import { notifyHousehold } from "./notify";
import { stubDraftModel, workersAiDraftModel } from "./plan-draft-model";
import { labelPlanDraft, type PlanDraftDeps } from "./plan-draft-run";

// Drafting the first Plan in the Worker, after new history has landed and the response has gone
// (waitUntil), like categorization: the model takes a few seconds. When it's done, the
// Household's screens are told to refetch the draft.

function draftDeps(): PlanDraftDeps {
	return {
		db: getDb(),
		model: __AI_STUB__ ? stubDraftModel : workersAiDraftModel(env.AI, env.AI_GATEWAY_ID),
	};
}

/**
 * Drafts the first Plan from the Household's history after new history came in, for the Parent
 * who brought it in: a statement today, a Bank Connection later. Does nothing once the Plan is set
 * up or a Parent finished the draft.
 */
export function draftPlanAfterImport(viewer: Viewer, timeZone: string): void {
	waitUntil(
		(async () => {
			try {
				const findings = await labelPlanDraft(draftDeps(), viewer, dayKeyAt(new Date(), timeZone));
				if (findings) await notifyHousehold(viewer.householdId, ["plan-draft"]);
			} catch (error) {
				console.error("Couldn’t draft the Plan", error);
			}
		})(),
	);
}
