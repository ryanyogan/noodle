import { env } from "cloudflare:workers";
import { z } from "zod";
import { CLEAR_STEPS, runClearStep } from "./fresh-start-clear";
import { clearDeps } from "./fresh-start-workflow";

// A Parent back to having no Household, for E2E (#81): a worker signs one Parent in once and
// every test starts from /welcome, so between tests the Household that Parent made (or joined)
// goes, with everything in it, through the same steps as Delete Household. Only with
// AI_MODEL=stub (server.ts), so not in production builds.

export const DEV_RESET_HOUSEHOLD_PATH = "/api/dev/reset-household";

const devResetSchema = z.object({ clerkUserId: z.string().trim().min(1).max(100) });

/** POST {clerkUserId}: deletes the Household that Clerk user is a Parent of, if there is one. */
export async function handleDevResetHousehold(request: Request): Promise<Response> {
	if (request.method !== "POST") return new Response("POST only", { status: 405 });
	const parsed = devResetSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success) return Response.json(parsed.error.issues, { status: 400 });
	try {
		const { results } = await env.DB.prepare(
			"SELECT household_id AS householdId FROM members WHERE clerk_user_id = ?",
		)
			.bind(parsed.data.clerkUserId)
			.all<{ householdId: string }>();
		const skipped: string[] = [];
		for (const { householdId } of results) {
			const deps = clearDeps(householdId);
			for (const { key } of CLEAR_STEPS) {
				try {
					await runClearStep(deps, key, householdId, "delete");
				} catch (error) {
					// The rows are what puts the Parent back on /welcome; a test's fake bank or a file
					// that won't go must not fail the next test.
					if (key === "rows") throw error;
					skipped.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
				}
			}
		}
		return Response.json({ cleared: results.length, skipped });
	} catch (error) {
		return new Response(error instanceof Error ? error.message : String(error), { status: 500 });
	}
}
