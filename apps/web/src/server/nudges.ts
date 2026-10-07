import { env } from "cloudflare:workers";
import {
	loadNudgePreferences,
	removePushSubscription as removePushSubscriptionInDb,
	saveNudgePreferences as saveNudgePreferencesInDb,
	savePushSubscription as savePushSubscriptionInDb,
} from "@noodle/db";
import type { NudgePreferences } from "@noodle/domain";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getDb } from "./db";
import { householdMiddleware } from "./household";
import { testNudge } from "./nudge-content";
import { type NudgeDelivery, vapidKeys } from "./nudge-delivery";
import { timeZoneSchema } from "./session";

// Each Parent's own Nudge settings: which Nudges they want, when they're quiet, and the devices
// they get them on. Nothing here is shared with the other Parent.

export type NudgeSettings = {
	/** What a device subscribes with; null while this server has no VAPID keys. */
	vapidPublicKey: string | null;
	preferences: NudgePreferences;
};

export const getNudgeSettings = createServerFn({ method: "GET" })
	.middleware([householdMiddleware])
	.handler(
		async ({ context }): Promise<NudgeSettings> => ({
			vapidPublicKey: vapidKeys()?.publicKey ?? null,
			preferences: await loadNudgePreferences(getDb(), context.household, context.parent.id),
		}),
	);

const minuteOfDay = z
	.number()
	.int()
	.min(0)
	.max(24 * 60 - 1);

export const saveNudgePreferences = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(
		z.object({
			bucketPace: z.boolean(),
			otherParentQuickAdds: z.boolean(),
			windfalls: z.boolean(),
			// On unless said: a page loaded before this Nudge existed doesn't send it.
			balanceChecks: z.boolean().default(true),
			quietHours: z.object({ start: minuteOfDay, end: minuteOfDay }).nullable(),
			timeZone: timeZoneSchema,
		}),
	)
	.handler(async ({ data, context }) => {
		await saveNudgePreferencesInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			preferences: data,
		});
	});

const base64Url = z.string().regex(/^[A-Za-z0-9_-]+$/, "Expected base64url");

/** A device's push subscription, as `PushSubscription.toJSON()` gives it. */
const subscriptionSchema = z.object({
	endpoint: z.url({ protocol: /^https$/ }).max(2048),
	keys: z.object({ p256dh: base64Url.max(100), auth: base64Url.max(50) }),
});

/** Sends this Parent's Nudges to this device. Saved again on each visit, in case it changed. */
export const savePushSubscription = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(subscriptionSchema)
	.handler(async ({ data, context }) => {
		await savePushSubscriptionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			endpoint: data.endpoint,
			p256dh: data.keys.p256dh,
			auth: data.keys.auth,
		});
	});

export const removePushSubscription = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.validator(z.object({ endpoint: z.string().max(2048) }))
	.handler(async ({ data, context }) => {
		await removePushSubscriptionInDb(getDb(), {
			householdId: context.household.id,
			memberId: context.parent.id,
			endpoint: data.endpoint,
		});
	});

/** Sends this Parent a Nudge now, through the same Queue as every other, whatever the hour. */
export const sendTestNudge = createServerFn({ method: "POST" })
	.middleware([householdMiddleware])
	.handler(async ({ context }) => {
		await env.NUDGE_QUEUE.send({
			householdId: context.household.id,
			memberId: context.parent.id,
			nudge: testNudge(),
		} satisfies NudgeDelivery);
	});
