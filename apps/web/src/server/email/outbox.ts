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
