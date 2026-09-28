import { env } from "cloudflare:workers";
import type { HouseholdChange } from "../household-changes";

/**
 * Tells the Household's open screens what a write changed (ADR-0007), so they refetch it. Call it
 * once the write has landed in D1. Never fails the write: a screen that misses this still sees
 * the change on its next read.
 */
export async function notifyHousehold(
	householdId: string,
	changes: HouseholdChange[],
): Promise<void> {
	try {
		await env.HOUSEHOLD_AGENT.getByName(householdId).notify(changes);
	} catch (error) {
		console.error("Couldn’t notify the Household Agent", error);
	}
}
