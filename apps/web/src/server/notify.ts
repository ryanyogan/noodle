import { env } from "cloudflare:workers";
import type { HouseholdChange } from "../household-changes";
import type { HouseholdEvent } from "./nudge-agent";

/**
 * Tells the Household's open screens what a write changed (ADR-0007), so they refetch it. Call it
 * once the write has landed in D1. Never fails the write: a screen that misses this still sees
 * the change on its next read. `events` are what the write did that may be worth a Nudge, which the
 * Agent decides on shortly after.
 */
export async function notifyHousehold(
	householdId: string,
	changes: HouseholdChange[],
	events: HouseholdEvent[] = [],
): Promise<void> {
	try {
		await env.HOUSEHOLD_AGENT.getByName(householdId).notify(householdId, changes, events);
	} catch (error) {
		console.error("Couldn’t notify the Household Agent", error);
	}
}
