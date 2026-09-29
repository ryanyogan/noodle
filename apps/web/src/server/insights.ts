import { decideInsight as decideInsightInDb, type InsightItem, loadInsights } from "@noodle/db";
import { dayKeyAt } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware, viewerOf } from "./household";
import { insightDeps } from "./insights-nightly";
import { lookForHouseholdInsights } from "./insights-run";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

// Insights for the screen: a Parent can ask for the nightly look now (for local dev and E2E, or
// after a big Import). Parents read the ones they may see and accept or dismiss them; neither
// changes money or the Plan. Accepting an Overlap only offers the usual end-Commitment flow.

/** The Insights the Parent may read that weren't dismissed, new ones first. */
export const getInsights = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(({ context }): Promise<InsightItem[]> => loadInsights(getDb(), viewerOf(context)));

/** "Look for Insights now": the nightly run, for this Household only. Returns how many were added. */
export const lookForInsightsNow = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }): Promise<number> => {
		const added = await lookForHouseholdInsights(
			insightDeps(),
			context.household.id,
			dayKeyAt(new Date(), context.household.timeZone),
		);
		if (added > 0) await notifyHousehold(context.household.id, ["insights"]);
		return added;
	});

/** Accepts or dismisses an Insight. Idempotent; a dismissed Insight never returns. */
export const decideInsight = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ id: ulidSchema, status: z.enum(["accepted", "dismissed"]) }))
	.handler(async ({ data, context }) => {
		const changed = await decideInsightInDb(getDb(), viewerOf(context), data);
		if (changed) await notifyHousehold(context.household.id, ["insights"]);
	});
