import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	acceptInvite,
	cancelInvite,
	createHouseholdForParent,
	type Db,
	findInviteByTokenHash,
	findInviteForEmails,
	findOpenInvite,
	inviteParent,
	listParents,
	resendInvite,
} from "./index";
import { checkSend, hashInviteToken, inviteExpiresAt, newInviteToken } from "./invite-token";
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

describe("resend and cancel", () => {
	const minutes = (count: number) => new Date(now.getTime() + count * 60_000);
	async function resend(at: Date) {
		const token = newInviteToken();
		const tokenHash = await hashInviteToken(token);
		const result = await resendInvite(db, {
			householdId,
			tokenHash,
			expiresAt: inviteExpiresAt(at),
			now: at,
		});
		return { result, token, tokenHash };
	}

	it("resend gives a new link, starts the 7 days again, and the old link stops working", async () => {
		const first = await invite("sam@example.com");
		const later = new Date(now.getTime() + 6 * 86_400_000);
		const second = await resend(later);
		expect(second.result).toMatchObject({
			ok: true,
			invite: { id: first.inviteId, sentAt: later },
		});
		expect((await findOpenInvite(db, householdId))?.expiresAt).toEqual(inviteExpiresAt(later));
		expect((await findInviteByTokenHash(db, first.tokenHash, later)).state).toBe("not-found");
		expect((await findInviteByTokenHash(db, second.tokenHash, later)).state).toBe("open");
		expect((await accept("user_sam", first.tokenHash, later)).ok).toBe(false);
		expect((await accept("user_sam", second.tokenHash, later)).ok).toBe(true);
	});

	it("resend brings back an expired invite", async () => {
		const first = await invite("sam@example.com");
		const expired = new Date(now.getTime() + 8 * 86_400_000);
		expect((await findInviteByTokenHash(db, first.tokenHash, expired)).state).toBe("expired");
		const second = await resend(expired);
		expect((await findInviteByTokenHash(db, second.tokenHash, expired)).state).toBe("open");
	});

	it("resend waits a minute between emails and sends at most 5 a day", async () => {
		await inviteParent(db, {
			inviteId: "invite-1",
			householdId,
			email: "sam@example.com",
			invitedByMemberId: "alex",
			inviterEmails: [],
			tokenHash: await hashInviteToken(newInviteToken()),
			expiresAt: inviteExpiresAt(now),
			now,
		});
		expect((await resend(minutes(0.5))).result).toEqual({ ok: false, reason: "too-soon" });
		for (const at of [1, 2, 3, 4]) expect((await resend(minutes(at))).result.ok).toBe(true);
		expect((await resend(minutes(10))).result).toEqual({ ok: false, reason: "daily-limit" });
		// A new invite counts too, so swapping emails doesn't get round it.
		const swapped = await inviteParent(db, {
			inviteId: "invite-2",
			householdId,
			email: "sam2@example.com",
			invitedByMemberId: "alex",
			inviterEmails: [],
			tokenHash: await hashInviteToken(newInviteToken()),
			expiresAt: inviteExpiresAt(now),
			now: minutes(11),
		});
		expect(swapped).toEqual({ ok: false, reason: "daily-limit" });
		// The next UTC day starts again.
		expect((await resend(new Date("2026-10-04T00:01:00Z"))).result.ok).toBe(true);
	});

	it("resend without an open invite finds nothing", async () => {
		expect((await resend(now)).result).toEqual({ ok: false, reason: "no-invite" });
	});

	it("cancel removes the invite, and its link finds nothing", async () => {
		const first = await invite("sam@example.com");
		await cancelInvite(db, householdId);
		expect(await findOpenInvite(db, householdId)).toBeNull();
		expect((await findInviteByTokenHash(db, first.tokenHash, now)).state).toBe("not-found");
		expect((await accept("user_sam", first.tokenHash)).ok).toBe(false);
	});
});

describe("checkSend", () => {
	const at = (iso: string) => new Date(iso);
	it("allows the first email, then counts by UTC day", () => {
		expect(checkSend(null, now, { wait: true })).toEqual({ ok: true, sendsThatDay: 1 });
		expect(
			checkSend({ sentAt: at("2026-10-03T11:00:00Z"), sendsThatDay: 2 }, now, { wait: true }),
		).toEqual({ ok: true, sendsThatDay: 3 });
		expect(
			checkSend({ sentAt: at("2026-10-02T23:59:00Z"), sendsThatDay: 5 }, now, { wait: true }),
		).toEqual({ ok: true, sendsThatDay: 1 });
	});
	it("waits a minute only when asked", () => {
		const last = { sentAt: at("2026-10-03T11:59:30Z"), sendsThatDay: 1 };
		expect(checkSend(last, now, { wait: true })).toEqual({ ok: false, reason: "too-soon" });
		expect(checkSend(last, now, { wait: false })).toEqual({ ok: true, sendsThatDay: 2 });
	});
});
