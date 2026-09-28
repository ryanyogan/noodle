import handler from "@tanstack/react-start/server-entry";
import { HOUSEHOLD_AGENT_PATH } from "./household-changes";
import { connectToHouseholdAgent } from "./server/household-agent";

// The Worker's entry: TanStack Start serves the app, and screens' WebSockets go to their
// Household Agent, which the Worker must export.
export { HouseholdAgent } from "./server/household-agent";

export default {
	fetch(request) {
		if (new URL(request.url).pathname === HOUSEHOLD_AGENT_PATH) {
			return connectToHouseholdAgent(request);
		}
		return handler.fetch(request);
	},
} satisfies ExportedHandler<Env>;
