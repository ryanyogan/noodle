import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	acceptInvite,
	createHouseholdForParent,
	type Db,
	findInviteByTokenHash,
	findInviteForEmails,
	inviteParent,
	listParents,
} from "./index";
import { hashInviteToken, inviteExpiresAt, newInviteToken } from "./invite-token";
import { testDb } from "./test-db";

const householdId = "01HOUSEHOLD0000000000000000";
const now = new Date("2026-10-03T12:00:00Z");
let db: Db;

async function invite(email: string, inviteId = `invite-${email}`) {
	const token = newInviteToken();
	const tokenHash = await hashInviteToken(token);
	const result = await inviteParent(db, {
		inviteId,
		householdId,
		email,
		invitedByMemberId: "alex",
		inviterEmails: ["alex@example.com"],
		tokenHash,
		expiresAt: inviteExpiresAt(now),
	});
	expect(result.ok).toBe(true);
	return { token, tokenHash, inviteId };
}

const accept = (clerkUserId: string, tokenHash: string, at = now) =>
	acceptInvite(db, {
		invite: { tokenHash },
		clerkUserId,
		parentId: `parent-${clerkUserId}`,
		parentName: clerkUserId,
		now: at,
	});

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "user_alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
});

describe("invite links", () => {
	it("store only the token's hash and find the invite by it", async () => {
		const { token, tokenHash } = await invite("Sam@Example.com");
		const found = await findInviteByTokenHash(db, tokenHash, now);
		expect(found).toEqual({
			state: "open",
			email: "sam@example.com",
			householdId,
			householdName: "The Rinks",
			hasRoom: true,
		});
		expect(JSON.stringify(await db.query.invites.findMany())).not.toContain(token);
		expect(
			(await findInviteByTokenHash(db, await hashInviteToken(token.slice(1)), now)).state,
		).toBe("not-found");
	});

	it("join whoever holds the link, whatever their email, once", async () => {
		const { tokenHash } = await invite("sam@example.com");
		const joined = await accept("user_jo", tokenHash);
		expect(joined.ok).toBe(true);
		expect((await listParents(db, householdId)).map((p) => p.name)).toEqual(["Alex", "user_jo"]);
		expect((await findInviteByTokenHash(db, tokenHash, now)).state).toBe("used");
		// Accepting again as the same person is a no-op; anyone else is refused.
		expect((await accept("user_jo", tokenHash)).ok).toBe(true);
		expect(await accept("user_kim", tokenHash)).toEqual({ ok: false, reason: "invite-unusable" });
		expect(await listParents(db, householdId)).toHaveLength(2);
	});

	it("stop working after 7 days, by link and by email", async () => {
		const { tokenHash } = await invite("sam@example.com");
		const late = inviteExpiresAt(now);
		expect((await findInviteByTokenHash(db, tokenHash, late)).state).toBe("expired");
		expect(await findInviteForEmails(db, ["sam@example.com"], late)).toBeNull();
		expect(await findInviteForEmails(db, ["sam@example.com"], now)).not.toBeNull();
		expect(await accept("user_sam", tokenHash, late)).toEqual({
			ok: false,
			reason: "invite-unusable",
		});
		expect(
			await acceptInvite(db, {
				invite: { inviteId: "invite-sam@example.com", emails: ["sam@example.com"] },
				clerkUserId: "user_sam",
				parentId: "sam",
				parentName: "Sam",
				now: late,
			}),
		).toEqual({ ok: false, reason: "invite-unusable" });
	});

	it("stop working once the invite is replaced", async () => {
		const first = await invite("sam@example.com");
		await invite("jo@example.com");
		expect((await findInviteByTokenHash(db, first.tokenHash, now)).state).toBe("not-found");
		expect(await accept("user_sam", first.tokenHash)).toEqual({
			ok: false,
			reason: "invite-unusable",
		});
	});

	it("never add a third Parent", async () => {
		const { tokenHash } = await invite("sam@example.com");
		await createHouseholdForParent(db, {
			clerkUserId: "user_other",
			householdId: "01OTHER000000000000000000000",
			householdName: "Others",
			timeZone: "America/Chicago",
			parentId: "other",
			parentName: "Other",
		});
		// Someone already in another Household can't join with it.
		expect(await accept("user_other", tokenHash)).toEqual({
			ok: false,
			reason: "in-another-household",
		});
		// Fill the Household behind the invite's back, then the link has no room left.
		await db.run(
			sql`insert into members (id, household_id, kind, name, clerk_user_id) values ('kim', ${householdId}, 'parent', 'Kim', 'user_kim')`,
		);
		expect(await findInviteByTokenHash(db, tokenHash, now)).toMatchObject({
			state: "open",
			hasRoom: false,
		});
		expect(await accept("user_sam", tokenHash)).toEqual({ ok: false, reason: "invite-unusable" });
		expect(await listParents(db, householdId)).toHaveLength(2);
	});
});
