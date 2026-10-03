// Invite links (#60): `/invite/<token>`. The token is 32 random bytes (256 bits) in base64url,
// made once when a Parent invites and shown only then. Only its SHA-256 hash is stored, so a copy
// of the database can't be turned into working links. A link works once, for INVITE_LINK_DAYS.

/** How long an invite link works. */
export const INVITE_LINK_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 32 bytes in base64url, no padding: 43 characters. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

/** A new random token for an invite link. */
export function newInviteToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replace(/=+$/, "");
}

/** Whether `token` could be one newInviteToken made: anything else is never looked up. */
export function isInviteTokenShape(token: unknown): token is string {
	return typeof token === "string" && TOKEN_SHAPE.test(token);
}

/** The token's SHA-256 hash in lowercase hex: what the database stores and looks up. */
export async function hashInviteToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** When a link made at `now` stops working. */
export function inviteExpiresAt(now: Date): Date {
	return new Date(now.getTime() + INVITE_LINK_DAYS * DAY_MS);
}

/**
 * Compares two strings in time that depends only on their length, not on where they first
 * differ, so timing can't reveal how much of a hash matched.
 */
export function constantTimeEqual(a: string, b: string): boolean {
	let diff = a.length ^ b.length;
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
	}
	return diff === 0;
}

export type InviteLinkState = "open" | "used" | "expired" | "not-found";

/**
 * What a link finds: the stored invite whose hash matches (null when none does, because it was
 * replaced, cancelled or never made), already accepted, past its expiry, or still open.
 */
export function inviteLinkState(
	invite: {
		tokenHash: string | null;
		expiresAt: Date | null;
		acceptedByMemberId: string | null;
	} | null,
	tokenHash: string,
	now: Date,
): InviteLinkState {
	if (!invite?.tokenHash || !constantTimeEqual(invite.tokenHash, tokenHash)) return "not-found";
	if (invite.acceptedByMemberId) return "used";
	if (invite.expiresAt && invite.expiresAt.getTime() <= now.getTime()) return "expired";
	return "open";
}
