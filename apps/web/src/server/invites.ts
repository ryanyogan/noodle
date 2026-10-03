import {
	acceptInvite as acceptInviteInDb,
	findInviteByTokenHash,
	findMembershipByClerkUser,
	findOpenInvite,
	hashInviteToken,
	inviteExpiresAt,
	inviteParent as inviteParentInDb,
	isInviteTokenShape,
	listParents,
	MAX_PARENTS,
	newInviteToken,
	normalizeEmail,
} from "@noodle/db";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { currentUserId, primaryEmail, requireUserId, verifiedEmails } from "./auth";
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
		// Each Parent's email, from Clerk: which login is whose, once both have joined.
		const emails = await Promise.all(
			parents.map((parent) => (parent.clerkUserId ? primaryEmail(parent.clerkUserId) : null)),
		);
		return {
			parents: parents.map(({ id, name }, i) => ({ id, name, email: emails[i] ?? null })),
			invitedEmail: invite?.email ?? null,
			hasAllParents: parents.length >= MAX_PARENTS,
		};
	});

export const inviteParent = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ inviteId: ulidSchema, email: z.email().max(254) }))
	.handler(async ({ data, context }) => {
		// The link's token is shown once, here; only its hash is kept (#60).
		const token = newInviteToken();
		const result = await inviteParentInDb(getDb(), {
			inviteId: data.inviteId,
			householdId: context.household.id,
			email: data.email,
			invitedByMemberId: context.parent.id,
			inviterEmails: await verifiedEmails(await requireUserId()),
			tokenHash: await hashInviteToken(token),
			expiresAt: inviteExpiresAt(new Date()),
		});
		if (!result.ok) return result;
		await notifyHousehold(context.household.id, ["parents"]);
		return { ok: true as const, email: result.invite.email, linkPath: `/invite/${token}` };
	});

/** Joins from /welcome: the open invite addressed to one of the signed-in user's verified emails. */
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
			invite: { inviteId: data.inviteId, emails: await verifiedEmails(clerkUserId) },
			parentId: data.parentId,
			parentName: data.parentName,
			clerkUserId,
			now: new Date(),
		});
		if (!result.ok) return result;
		const { household } = result.membership;
		await notifyHousehold(household.id, ["parents"]);
		return { ok: true as const, household: toHouseholdSummary(household) };
	});

const tokenSchema = z.object({ token: z.string().max(64) });

/**
 * The invite a link points at (`/sign-up?invite=<token>`), for someone not signed in yet: the
 * email to fill in and the Household's name. A missing, malformed, used, expired or replaced
 * link gives null, and the page is plain sign-up.
 */
export const getInviteForSignUp = createServerFn({ method: "GET" })
	.validator(z.object({ invite: z.string().max(64).optional() }))
	.handler(async ({ data }) => {
		if (!isInviteTokenShape(data.invite)) return null;
		const invite = await findInviteByTokenHash(
			getDb(),
			await hashInviteToken(data.invite),
			new Date(),
		);
		if (invite.state !== "open" || !invite.hasRoom) return null;
		return { email: invite.email, householdName: invite.householdName, token: data.invite };
	});

export type InviteLink =
	| { state: "not-found" | "used" | "expired"; signedIn: boolean }
	| {
			state: "open";
			signedIn: false;
			householdName: string;
	  }
	| {
			state: "open";
			signedIn: true;
			householdName: string;
			email: string;
			hasRoom: boolean;
			/** Whether the invite went to one of the signed-in user's verified emails. */
			forThem: boolean;
			/** Which Household the signed-in user is in already, if any. */
			member: "this" | "other" | null;
	  };

/** What `/invite/<token>` shows: works signed in or out. */
export const getInviteLink = createServerFn({ method: "GET" })
	.validator(tokenSchema)
	.handler(async ({ data }): Promise<InviteLink> => {
		const userId = await currentUserId();
		const signedIn = userId !== null;
		if (!isInviteTokenShape(data.token)) return { state: "not-found", signedIn };
		const db = getDb();
		const invite = await findInviteByTokenHash(db, await hashInviteToken(data.token), new Date());
		const membership = userId ? await findMembershipByClerkUser(db, userId) : null;
		if (invite.state === "not-found") return { state: "not-found", signedIn };
		// Opening the link again after joining goes into the Household, like signing in does.
		if (membership && membership.household.id === invite.householdId) {
			return {
				state: "open",
				signedIn: true,
				householdName: invite.householdName,
				email: invite.email,
				hasRoom: false,
				forThem: true,
				member: "this",
			};
		}
		if (invite.state !== "open") return { state: invite.state, signedIn };
		if (!userId) return { state: "open", signedIn: false, householdName: invite.householdName };
		const emails = (await verifiedEmails(userId)).map(normalizeEmail);
		return {
			state: "open",
			signedIn: true,
			householdName: invite.householdName,
			email: invite.email,
			hasRoom: invite.hasRoom,
			forThem: emails.includes(invite.email),
			member: membership ? "other" : null,
		};
	});

/** Joins through a link: whoever holds it, whatever their email (the page asks first). */
export const acceptInviteLink = createServerFn({ method: "POST" })
	.validator(
		tokenSchema.extend({ parentId: ulidSchema, parentName: z.string().trim().min(1).max(80) }),
	)
	.handler(async ({ data }) => {
		const clerkUserId = await requireUserId();
		if (!isInviteTokenShape(data.token))
			return { ok: false as const, reason: "invite-unusable" as const };
		const result = await acceptInviteInDb(getDb(), {
			invite: { tokenHash: await hashInviteToken(data.token) },
			parentId: data.parentId,
			parentName: data.parentName,
			clerkUserId,
			now: new Date(),
		});
		if (!result.ok) return result;
		const { household } = result.membership;
		await notifyHousehold(household.id, ["parents"]);
		return { ok: true as const, household: toHouseholdSummary(household) };
	});
