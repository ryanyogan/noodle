import { createHouseholdForParent, findMembershipByClerkUser } from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { currentUserId, requireUserId } from "./auth";
import { getDb } from "./db";
import { type HouseholdSummary, toHouseholdSummary } from "./household";

export type Viewer = { signedIn: false } | { signedIn: true; household: HouseholdSummary | null };

/** Who is looking: used by route guards to redirect to sign in or Household creation. */
export const getViewer = createServerFn({ method: "GET" }).handler(async (): Promise<Viewer> => {
	const userId = await currentUserId();
	if (!userId) return { signedIn: false };
	const membership = await findMembershipByClerkUser(getDb(), userId);
	return {
		signedIn: true,
		household: membership ? toHouseholdSummary(membership.household) : null,
	};
});

const ulidSchema = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, "Expected a ULID");

const timeZoneSchema = z.string().refine((zone) => {
	try {
		new Intl.DateTimeFormat("en-US", { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}, "Expected an IANA time zone");

export const createHousehold = createServerFn({ method: "POST" })
	.validator(
		z.object({
			householdId: ulidSchema,
			parentId: ulidSchema,
			householdName: z.string().trim().min(1).max(80),
			parentName: z.string().trim().min(1).max(80),
			timeZone: timeZoneSchema,
		}),
	)
	.handler(async ({ data }) => {
		const clerkUserId = await requireUserId();
		const { household } = await createHouseholdForParent(getDb(), { ...data, clerkUserId });
		return toHouseholdSummary(household);
	});
