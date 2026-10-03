import {
	createHouseholdForParent,
	findInviteForEmails,
	findMembershipByClerkUser,
	type InviteToJoin,
	setHouseholdDetails,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { currentUserId, requireUserId, verifiedEmails } from "./auth";
import { getDb } from "./db";
import { type HouseholdSummary, householdMiddleware, toHouseholdSummary } from "./household";
import { ulidSchema } from "./schemas";

export type Viewer =
	| { signedIn: false }
	// `parentId`: the signed-in Parent's own Member ID.
	| { signedIn: true; household: HouseholdSummary; parentId: string; invite: null }
	// Not in a Household yet: possibly invited to join one.
	| { signedIn: true; household: null; invite: InviteToJoin | null };

/** Who is looking: used by route guards to redirect to sign in or Household creation. */
export const getViewer = createServerFn({ method: "GET" }).handler(async (): Promise<Viewer> => {
	const userId = await currentUserId();
	if (!userId) return { signedIn: false };
	const db = getDb();
	const membership = await findMembershipByClerkUser(db, userId);
	if (membership) {
		return {
			signedIn: true,
			household: toHouseholdSummary(membership.household),
			parentId: membership.parent.id,
			invite: null,
		};
	}
	const invite = await findInviteForEmails(db, await verifiedEmails(userId));
	return { signedIn: true, household: null, invite };
});

export const timeZoneSchema = z.string().refine((zone) => {
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

/** Household settings: the Household's name and time zone, which both Parents share. */
export const updateHousehold = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ name: z.string().trim().min(1).max(80), timeZone: timeZoneSchema }))
	.handler(async ({ data, context }) => {
		await setHouseholdDetails(getDb(), context.household.id, data);
	});
