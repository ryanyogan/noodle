import { env } from "cloudflare:workers";
import type { AiEvent } from "./ai-coalescer";

/**
 * Tells the Household's Agent something happened that background AI may need to look at
 * (ADR-0027): Transactions arrived, a Bucket or Rule changed, and so on. The Agent waits for the
 * burst to settle, then files and looks again in one run. Call it once the write has landed in D1.
 * Never fails the write: an Import that misses this can still be filed by "Look again" in Review.
 */
export async function queueAi(event: AiEvent): Promise<void> {
	try {
		await env.HOUSEHOLD_AGENT.getByName(event.householdId).queueAi(event);
	} catch (error) {
		console.error("Couldn’t queue background AI", error);
	}
}
