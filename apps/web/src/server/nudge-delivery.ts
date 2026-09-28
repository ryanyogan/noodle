import { env } from "cloudflare:workers";
import { forgetPushSubscription, loadPushSubscriptions } from "@noodle/db";
import { getDb } from "./db";
import type { NudgeMessage } from "./nudge-content";
import { type PushTarget, sendWebPush, type VapidKeys } from "./web-push";

/** A message on the Nudge Queue: one Nudge for one Parent, to every device they turned it on for. */
export type NudgeDelivery = { householdId: string; memberId: string; nudge: NudgeMessage };

/** How long a push service holds a Nudge for a device that's off: a Nudge is about now. */
const NUDGE_TTL_SECONDS = 12 * 60 * 60;

/** What delivering one Nudge needs; the Queue consumer passes the real ones, tests fakes. */
export type DeliveryDeps = {
	subscriptions: () => Promise<PushTarget[]>;
	send: (target: PushTarget, payload: string) => Promise<Response>;
	forget: (endpoint: string) => Promise<void>;
};

/**
 * Sends one Nudge to each of a Parent's devices. A device whose push service says its
 * subscription is gone is forgotten; `retry` when any device should be tried again later. A
 * retry sends to every device again, which is harmless: a device shows a repeat Nudge in place of
 * the first, by its tag.
 */
export async function deliverNudge(
	nudge: NudgeMessage,
	deps: DeliveryDeps,
): Promise<"delivered" | "retry"> {
	const payload = JSON.stringify(nudge);
	const results = await Promise.all(
		(await deps.subscriptions()).map(async (target) => {
			try {
				const response = await deps.send(target, payload);
				if (response.status === 404 || response.status === 410) {
					await deps.forget(target.endpoint);
					return "delivered";
				}
				if (response.status === 429 || response.status >= 500) return "retry";
				if (!response.ok) {
					// Refused for good (a bad key or payload): trying again won't help.
					console.error("A push service refused a Nudge", response.status, await response.text());
				}
				return "delivered";
			} catch (error) {
				console.error("Couldn’t reach a push service", error);
				return "retry";
			}
		}),
	);
	return results.includes("retry") ? "retry" : "delivered";
}

/** The app's VAPID keys from its secrets, or null while they aren't set. */
export function vapidKeys(): VapidKeys | null {
	const {
		VAPID_PUBLIC_KEY: publicKey,
		VAPID_PRIVATE_KEY: privateKey,
		VAPID_SUBJECT: subject,
	} = env;
	// Secrets are typed as always set, but a checkout without them has none.
	if (!publicKey || !privateKey || !subject) return null;
	return { publicKey, privateKey, subject };
}

/** The Nudge Queue's consumer: delivers each Nudge, retrying (with backoff) only what failed. */
export async function consumeNudges(batch: MessageBatch<NudgeDelivery>): Promise<void> {
	const vapid = vapidKeys();
	if (!vapid) {
		console.error("VAPID keys aren’t set, so Nudges can’t be sent");
		batch.ackAll();
		return;
	}
	const db = getDb();
	await Promise.all(
		batch.messages.map(async (message) => {
			const { householdId, memberId, nudge } = message.body;
			const outcome = await deliverNudge(nudge, {
				subscriptions: () => loadPushSubscriptions(db, householdId, memberId),
				send: (target, payload) =>
					sendWebPush(target, payload, vapid, { ttl: NUDGE_TTL_SECONDS, urgency: "normal" }),
				forget: (endpoint) => forgetPushSubscription(db, householdId, endpoint),
			}).catch((error) => {
				console.error("Couldn’t deliver a Nudge", error);
				return "retry" as const;
			});
			if (outcome === "retry") message.retry({ delaySeconds: 30 * 2 ** message.attempts });
			else message.ack();
		}),
	);
}
