import {
	acceptInvite as acceptInviteInDb,
	findOpenInvite,
	inviteParent as inviteParentInDb,
	listParents,
	MAX_PARENTS,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireUserId, verifiedEmails } from "./auth";
import { getDb } from "./db";
import { householdMiddleware, toHouseholdSummary } from "./household";
import { notifyHousehold } from "./notify";
import { ulidSchema } from "./schemas";

/** The Household's Parents and its open invite, if any. */
export const getHouseholdParents = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		const db = getDb();
		const [parents, invite] = await Promise.all([
			listParents(db, context.household.id),
			findOpenInvite(db, context.household.id),
		]);
		return {
			parents: parents.map(({ id, name }) => ({ id, name })),
			invitedEmail: invite?.email ?? null,
			hasAllParents: parents.length >= MAX_PARENTS,
		};
	});

export const inviteParent = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ inviteId: ulidSchema, email: z.email().max(254) }))
	.handler(async ({ data, context }) => {
		const result = await inviteParentInDb(getDb(), {
			inviteId: data.inviteId,
			householdId: context.household.id,
			email: data.email,
			invitedByMemberId: context.parent.id,
			inviterEmails: await verifiedEmails(await requireUserId()),
		});
		if (!result.ok) return result;
		await notifyHousehold(context.household.id, ["parents"]);
		return { ok: true as const, email: result.invite.email };
	});

export const acceptInvite = createServerFn({ method: "POST" })
	.validator(
		z.object({
			// Chosen by the client, but only usable if it is addressed to one of the
			// signed-in user's Clerk-verified emails, which the database re-checks.
			inviteId: ulidSchema,
			parentId: ulidSchema,
			parentName: z.string().trim().min(1).max(80),
		}),
	)
	.handler(async ({ data }) => {
		const clerkUserId = await requireUserId();
		const result = await acceptInviteInDb(getDb(), {
			...data,
			clerkUserId,
			emails: await verifiedEmails(clerkUserId),
		});
		if (!result.ok) return result;
		const { household } = result.membership;
		await notifyHousehold(household.id, ["parents"]);
		return { ok: true as const, household: toHouseholdSummary(household) };
	});
