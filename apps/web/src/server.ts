import handler from "@tanstack/react-start/server-entry";
import { CAPTURE_PATH } from "./capture-path";
import { HOUSEHOLD_AGENT_PATH } from "./household-changes";
import { startBankSyncs } from "./server/bank-import-workflow";
import { consumeIngest, handleCapture, type IngestMessage } from "./server/capture";
import { startCheckIns } from "./server/check-in-weekly";
import { connectToHouseholdAgent } from "./server/household-agent";
import { startInsights } from "./server/insights-nightly";
import { startMonthCloses } from "./server/month-close-workflow";
import { consumeNudges, type NudgeDelivery } from "./server/nudge-delivery";
import { startPerkRechecks } from "./server/perk-research-workflow";
import { handlePlaidWebhook, PLAID_WEBHOOK_PATH } from "./server/plaid-webhook";
import { handleReceiptEmail } from "./server/receipt-worker";

// The Worker's entry: TanStack Start serves the app, and screens' WebSockets go to their
// Household Agent, which the Worker must export. It also consumes the Nudge Queue, and its cron
// starts each Household's Month-close Workflow (also exported); a nightly one looks for Insights,
// re-checks Perks a month old (the Perk research Workflow, also exported), then starts the weekly
// Check-in wherever it's Check-in day. The iPhone Shortcut's captures arrive at their own
// endpoint and wait on the ingest Queue, which this Worker consumes too; Receipts forwarded to a
// Household's Receipt address arrive by email and wait there as well, as does each Bank
// Connection to read, which the Import Workflow (also exported) brings in: when Plaid's webhook
// (its own endpoint) says there's news, and every night for all of them. The Setup Workflow (also
// exported) does a new Household's slow setup work while the get-started wizard goes on.
export { ImportWorkflow } from "./server/bank-import-workflow";
export { HouseholdAgent } from "./server/household-agent";
export { MonthCloseWorkflow } from "./server/month-close-workflow";
export { PerkResearchWorkflow } from "./server/perk-research-workflow";
export { SetupWorkflow } from "./server/setup-workflow";

/**
 * The nightly cron: Bank Connections' daily sync, Insights, Perk re-checks, then Check-ins
 * (wrangler.jsonc); the other is Month-close's.
 */
const NIGHTLY_CRON = "0 9 * * *";

export default {
	fetch(request) {
		const { pathname } = new URL(request.url);
		if (pathname === HOUSEHOLD_AGENT_PATH) return connectToHouseholdAgent(request);
		if (pathname === CAPTURE_PATH) return handleCapture(request);
		if (pathname === PLAID_WEBHOOK_PATH) return handlePlaidWebhook(request);
		return handler.fetch(request);
	},
	queue(batch) {
		if (batch.queue === "noodle-ingest") {
			return consumeIngest(batch as MessageBatch<IngestMessage>);
		}
		return consumeNudges(batch as MessageBatch<NudgeDelivery>);
	},
	email(message) {
		return handleReceiptEmail(message);
	},
	async scheduled(controller) {
		const now = new Date(controller.scheduledTime);
		if (controller.cron === NIGHTLY_CRON) {
			await startBankSyncs(now).catch((error) =>
				console.error("Couldn’t start Bank Connections’ daily sync", error),
			);
			// Insights first, so the Check-in counts what they found.
			await startInsights(now).catch((error) => console.error("Couldn’t look for Insights", error));
			await startPerkRechecks(now).catch((error) =>
				console.error("Couldn’t start Perk re-checks", error),
			);
			return startCheckIns(now);
		}
		return startMonthCloses(now);
	},
} satisfies ExportedHandler<Env, NudgeDelivery | IngestMessage>;
