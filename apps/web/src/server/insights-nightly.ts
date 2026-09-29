import { env } from "cloudflare:workers";
import { listHouseholds } from "@noodle/db";
import { dayKeyAt } from "@noodle/domain";
import { ulid } from "ulid";
import { getDb } from "./db";
import { stubInsightModel, workersAiInsightModel } from "./insights-model";
import { type InsightDeps, lookForHouseholdInsights } from "./insights-run";
import { notifyHousehold } from "./notify";

// The nightly look for Insights, which the Worker's cron starts (server.ts), in every Household.

export function insightDeps(): InsightDeps {
	return {
		db: getDb(),
		model: __AI_STUB__ ? stubInsightModel : workersAiInsightModel(env.AI, env.AI_GATEWAY_ID),
		newId: ulid,
	};
}

/** How many Households one nightly run looks at, at most: it bounds the run's model calls. */
const MAX_HOUSEHOLDS = 500;

/** The nightly run: every Household in turn, for each of its Parents. One failing skips only it. */
export async function startInsights(now: Date): Promise<void> {
	const deps = insightDeps();
	const households = (await listHouseholds(deps.db)).slice(0, MAX_HOUSEHOLDS);
	for (const household of households) {
		try {
			const started = Date.now();
			const added = await lookForHouseholdInsights(
				deps,
				household.id,
				dayKeyAt(now, household.timeZone),
			);
			console.log(`Insights for ${household.id}: ${added} new, ${Date.now() - started} ms`);
			if (added > 0) await notifyHousehold(household.id, ["insights"]);
		} catch (error) {
			console.error(`Couldn’t look for Insights for ${household.id}`, error);
		}
	}
}
