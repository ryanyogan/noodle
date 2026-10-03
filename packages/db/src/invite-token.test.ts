import { describe, expect, it } from "vitest";
import {
	constantTimeEqual,
	hashInviteToken,
	inviteExpiresAt,
	inviteLinkState,
	isInviteTokenShape,
	newInviteToken,
} from "./invite-token";

describe("invite tokens", () => {
	it("are 256 random bits in base64url, different every time", () => {
		const tokens = new Set(Array.from({ length: 200 }, newInviteToken));
		expect(tokens.size).toBe(200);
		for (const token of tokens) expect(isInviteTokenShape(token)).toBe(true);
		expect(isInviteTokenShape("01ARZ3NDEKTSV4RRFFQ69G5FAV")).toBe(false);
		expect(isInviteTokenShape(`${newInviteToken()}=`)).toBe(false);
		expect(isInviteTokenShape(undefined)).toBe(false);
	});

	it("are stored as their SHA-256 hash, never as themselves", async () => {
		expect(await hashInviteToken("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
		const token = newInviteToken();
		const hash = await hashInviteToken(token);
		expect(hash).toMatch(/^[0-9a-f]{64}$/);
		expect(hash).not.toContain(token);
		expect(await hashInviteToken(token)).toBe(hash);
	});

	it("compare whole strings, whatever their length", () => {
		expect(constantTimeEqual("abcd", "abcd")).toBe(true);
		expect(constantTimeEqual("abcd", "abce")).toBe(false);
		expect(constantTimeEqual("abcd", "abc")).toBe(false);
		expect(constantTimeEqual("", "a")).toBe(false);
		expect(constantTimeEqual("", "")).toBe(true);
	});

	it("work for 7 days, once", async () => {
		const now = new Date("2026-10-03T12:00:00Z");
		const expiresAt = inviteExpiresAt(now);
		expect(expiresAt.toISOString()).toBe("2026-10-10T12:00:00.000Z");
		const tokenHash = await hashInviteToken("t");
		const open = { tokenHash, expiresAt, acceptedByMemberId: null };
		expect(inviteLinkState(open, tokenHash, now)).toBe("open");
		expect(inviteLinkState(open, tokenHash, new Date(expiresAt.getTime() - 1))).toBe("open");
		expect(inviteLinkState(open, tokenHash, expiresAt)).toBe("expired");
		expect(inviteLinkState({ ...open, acceptedByMemberId: "sam" }, tokenHash, now)).toBe("used");
		expect(inviteLinkState(open, await hashInviteToken("u"), now)).toBe("not-found");
		expect(inviteLinkState(null, tokenHash, now)).toBe("not-found");
		expect(inviteLinkState({ ...open, tokenHash: null }, tokenHash, now)).toBe("not-found");
	});
});
