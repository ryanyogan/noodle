import handler from "@tanstack/react-start/server-entry";
import { CAPTURE_PATH } from "./capture-path";
import { HOUSEHOLD_AGENT_PATH } from "./household-changes";
import { type CaptureMessage, consumeIngest, handleCapture } from "./server/capture";
import { connectToHouseholdAgent } from "./server/household-agent";
import { startInsights } from "./server/insights-nightly";
import { startMonthCloses } from "./server/month-close-workflow";
import { consumeNudges, type NudgeDelivery } from "./server/nudge-delivery";

// The Worker's entry: TanStack Start serves the app, and screens' WebSockets go to their
// Household Agent, which the Worker must export. It also consumes the Nudge Queue, and its cron
// starts each Household's Month-close Workflow (also exported); a nightly one looks for Insights.
// The iPhone Shortcut's captures arrive at their own endpoint and wait on the ingest Queue, which
// this Worker consumes too.
export { HouseholdAgent } from "./server/household-agent";
export { MonthCloseWorkflow } from "./server/month-close-workflow";

/** The nightly cron that looks for Insights (wrangler.jsonc); the other is Month-close's. */
const INSIGHTS_CRON = "0 9 * * *";

export default {
	fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === HOUSEHOLD_AGENT_PATH) return connectToHouseholdAgent(request);
		if (pathname === CAPTURE_PATH) return handleCapture(request);
		return handler.fetch(request);
	},
	queue(batch) {
		if (batch.queue === "noodle-ingest") {
			return consumeIngest(batch as MessageBatch<CaptureMessage>);
		}
		return consumeNudges(batch as MessageBatch<NudgeDelivery>);
	},
	scheduled(controller) {
		const now = new Date(controller.scheduledTime);
		if (controller.cron === INSIGHTS_CRON) return startInsights(now);
		return startMonthCloses(now);
	},
} satisfies ExportedHandler<Env, NudgeDelivery | CaptureMessage>;
