import { env } from "cloudflare:workers";
import { normalizeEmail } from "@noodle/db";
import type { SendResult } from "./send";
import type { Email } from "./templates";

// The dev outbox: where emails go instead of out, with AI_MODEL=stub (E2E) or in local dev without
// the `send_email` binding. Kept in the local R2 bucket under dev-outbox/, so it outlives a reload
// of the dev server, and read back through /api/dev/outbox, which exists only in stub builds.

export const DEV_OUTBOX_PATH = "/api/dev/outbox";

/** Sending to this address fails, so tests can see "Couldn't send". */
export const FAILING_ADDRESS = "fail@example.com";

export type OutboxEmail = Email & { to: string; sentAt: string };

const prefix = (to: string) => `dev-outbox/${normalizeEmail(to)}/`;

export async function recordInOutbox(
	bucket: R2Bucket,
	to: string,
	email: Email,
): Promise<SendResult> {
	if (normalizeEmail(to) === FAILING_ADDRESS) return { ok: false, reason: "failed" };
	const sentAt = new Date().toISOString();
	const entry: OutboxEmail = { ...email, to, sentAt };
	await bucket.put(`${prefix(to)}${sentAt}-${crypto.randomUUID()}.json`, JSON.stringify(entry));
	return { ok: true };
}

/** GET /api/dev/outbox?to=a@b.com: the emails sent to that address, oldest first. */
export async function handleDevOutbox(request: Request): Promise<Response> {
	const bucket = env.STATEMENTS;
	const to = new URL(request.url).searchParams.get("to");
	if (!to) return Response.json({ error: "Add ?to=<email>" }, { status: 400 });
	const listed = await bucket.list({ prefix: prefix(to) });
	const keys = listed.objects.map((object) => object.key).sort();
	const emails = await Promise.all(
		keys.map(async (key) => (await (await bucket.get(key))?.json()) as OutboxEmail),
	);
	return Response.json(emails.filter(Boolean));
}

export const DEV_INVITE_AGE_PATH = "/api/dev/invite-age";

/**
 * POST /api/dev/invite-age?to=a@b.com&days=3: makes the open invite to that address look sent
 * `days` ago, its expiry moved back as far, so E2E can wait out Resend's minute and see an
 * expired invite without waiting days. Only with AI_MODEL=stub, like the outbox.
 */
export async function handleDevInviteAge(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const to = url.searchParams.get("to");
	const days = Number(url.searchParams.get("days"));
	if (request.method !== "POST" || !to || !Number.isFinite(days)) {
		return Response.json({ error: "POST ?to=<email>&days=<n>" }, { status: 400 });
	}
	const ms = Math.round(days * 86_400_000);
	await env.DB.prepare(
		`update invites set sent_at = coalesce(sent_at, created_at) - ?1, created_at = created_at - ?1,
		 expires_at = expires_at - ?1 where email = ?2 and accepted_by_member_id is null`,
	)
		.bind(ms, normalizeEmail(to))
		.run();
	return Response.json({ ok: true });
}
