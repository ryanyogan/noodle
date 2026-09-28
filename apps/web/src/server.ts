import handler from "@tanstack/react-start/server-entry";
import { HOUSEHOLD_AGENT_PATH } from "./household-changes";
import { connectToHouseholdAgent } from "./server/household-agent";
import { consumeNudges, type NudgeDelivery } from "./server/nudge-delivery";

// The Worker's entry: TanStack Start serves the app, and screens' WebSockets go to their
// Household Agent, which the Worker must export. It also consumes the Nudge Queue.
export { HouseholdAgent } from "./server/household-agent";

export default {
	fetch(request) {
		if (new URL(request.url).pathname === HOUSEHOLD_AGENT_PATH) {
			return connectToHouseholdAgent(request);
		}
		return handler.fetch(request);
	},
	queue(batch) {
		return consumeNudges(batch);
	},
} satisfies ExportedHandler<Env, NudgeDelivery>;
