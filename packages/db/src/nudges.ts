import {
	type Cents,
	type DayKey,
	defaultNudgePreferences,
	type NudgePreferences,
} from "@noodle/domain";
import { and, eq, exists, sql } from "drizzle-orm";
import type { Db } from "./index";
import { type Viewer, visibleTo } from "./privacy";
import {
	buckets,
	households,
	members,
	nudgePreferences,
	pushSubscriptions,
	transactions,
} from "./schema";

// Nudge preferences and the Web Push subscriptions Nudges go to. Every query is scoped by
// household_id; a Parent's own member ID only ever comes from their session.

type PreferencesRow = typeof nudgePreferences.$inferSelect;

const toPreferences = (row: PreferencesRow | null, householdTimeZone: string): NudgePreferences =>
	row
		? {
				bucketPace: row.bucketPace,
				otherParentQuickAdds: row.otherParentQuickAdds,
				windfalls: row.windfalls,
				quietHours:
					row.quietStart === null || row.quietEnd === null
						? null
						: { start: row.quietStart, end: row.quietEnd },
				timeZone: row.timeZone,
			}
		: defaultNudgePreferences(householdTimeZone);

/** A Parent's Nudge preferences, or the defaults if they've never saved any. */
export async function loadNudgePreferences(
	db: Db,
	household: { id: string; timeZone: string },
	memberId: string,
): Promise<NudgePreferences> {
	const [row] = await db
		.select()
		.from(nudgePreferences)
		.where(
			and(eq(nudgePreferences.householdId, household.id), eq(nudgePreferences.memberId, memberId)),
		);
	return toPreferences(row ?? null, household.timeZone);
}

/** Replaces a Parent's Nudge preferences. Saving the same ones twice changes nothing. */
export async function saveNudgePreferences(
	db: Db,
	input: { householdId: string; memberId: string; preferences: NudgePreferences },
): Promise<void> {
	const { preferences } = input;
	const values = {
		bucketPace: preferences.bucketPace,
		otherParentQuickAdds: preferences.otherParentQuickAdds,
		windfalls: preferences.windfalls,
		quietStart: preferences.quietHours?.start ?? null,
		quietEnd: preferences.quietHours?.end ?? null,
		timeZone: preferences.timeZone,
		updatedAt: sql`(unixepoch() * 1000)`,
	};
	await db
		.insert(nudgePreferences)
		.values({ memberId: input.memberId, householdId: input.householdId, ...values })
		.onConflictDoUpdate({
			target: nudgePreferences.memberId,
			set: values,
			// A member ID only ever arrives with its own Household, but never cross one.
			setWhere: eq(nudgePreferences.householdId, input.householdId),
		});
}

/** A device's Web Push subscription, as the browser gives it. */
export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

/**
 * Sends a Parent's Nudges to a device. Idempotent per endpoint; a device another Parent had
 * turned Nudges on for is theirs now, since only one person uses a browser's notifications.
 */
export async function savePushSubscription(
	db: Db,
	input: PushSubscriptionKeys & { householdId: string; memberId: string },
): Promise<void> {
	const owner = {
		householdId: input.householdId,
		memberId: input.memberId,
		p256dh: input.p256dh,
		auth: input.auth,
	};
	await db
		.insert(pushSubscriptions)
		.values({ endpoint: input.endpoint, ...owner })
		.onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: owner });
}

/** Stops a Parent's Nudges going to a device. Only their own. */
export async function removePushSubscription(
	db: Db,
	input: { householdId: string; memberId: string; endpoint: string },
): Promise<void> {
	await db
		.delete(pushSubscriptions)
		.where(
			and(
				eq(pushSubscriptions.endpoint, input.endpoint),
				eq(pushSubscriptions.householdId, input.householdId),
				eq(pushSubscriptions.memberId, input.memberId),
			),
		);
}

/** The devices a Parent's Nudges go to. */
export async function loadPushSubscriptions(
	db: Db,
	householdId: string,
	memberId: string,
): Promise<PushSubscriptionKeys[]> {
	return db
		.select({
			endpoint: pushSubscriptions.endpoint,
			p256dh: pushSubscriptions.p256dh,
			auth: pushSubscriptions.auth,
		})
		.from(pushSubscriptions)
		.where(
			and(eq(pushSubscriptions.householdId, householdId), eq(pushSubscriptions.memberId, memberId)),
		);
}

/** Forgets a subscription its push service says is gone (the Parent turned notifications off). */
export async function forgetPushSubscription(
	db: Db,
	householdId: string,
	endpoint: string,
): Promise<void> {
	await db
		.delete(pushSubscriptions)
		.where(
			and(eq(pushSubscriptions.householdId, householdId), eq(pushSubscriptions.endpoint, endpoint)),
		);
}

/** A Parent who could get a Nudge: one with Nudges on for at least one device. */
export type NudgeRecipient = { memberId: string; name: string; preferences: NudgePreferences };

/** The Household's time zone and the Parents who could get its Nudges, or null if it's gone. */
export async function loadNudgeRecipients(
	db: Db,
	householdId: string,
): Promise<{ timeZone: string; recipients: NudgeRecipient[] } | null> {
	const [household] = await db
		.select({ timeZone: households.timeZone })
		.from(households)
		.where(eq(households.id, householdId));
	if (!household) return null;
	const rows = await db
		.select({ memberId: members.id, name: members.name, preferences: nudgePreferences })
		.from(members)
		.leftJoin(nudgePreferences, eq(nudgePreferences.memberId, members.id))
		.where(
			and(
				eq(members.householdId, householdId),
				eq(members.kind, "parent"),
				exists(
					db
						.select({ one: sql`1` })
						.from(pushSubscriptions)
						.where(
							and(
								eq(pushSubscriptions.memberId, members.id),
								eq(pushSubscriptions.householdId, householdId),
							),
						),
				),
			),
		);
	return {
		timeZone: household.timeZone,
		recipients: rows.map((row) => ({
			memberId: row.memberId,
			name: row.name,
			preferences: toPreferences(row.preferences, household.timeZone),
		})),
	};
}

/** A Quick Add as a Nudge about it needs it: its amount, note, Bucket, and who entered it. */
export type QuickAddForNudge = {
	id: string;
	date: DayKey;
	amount: Cents;
	note: string | null;
	bucketId: string;
	bucketName: string;
	createdBy: { memberId: string; name: string };
};

/**
 * A Quick Add, for a Nudge to `viewer` about it; null if they mustn't see it (it's in the other
 * Parent's Personal Allowance), it isn't a Quick Add, or it has no single Bucket (split since, or
 * spent from a Goal).
 * Read for the Parent it's for, like every read of Transactions (ADR-0003).
 */
export async function loadQuickAddForNudge(
	db: Db,
	viewer: Viewer,
	transactionId: string,
): Promise<QuickAddForNudge | null> {
	const [row] = await db
		.select({
			id: transactions.id,
			date: transactions.date,
			amount: transactions.amountCents,
			note: transactions.note,
			bucketId: buckets.id,
			bucketName: buckets.name,
			memberId: members.id,
			memberName: members.name,
		})
		.from(transactions)
		.innerJoin(buckets, eq(buckets.id, transactions.bucketId))
		.innerJoin(members, eq(members.id, transactions.createdByMemberId))
		.where(
			and(
				eq(transactions.id, transactionId),
				visibleTo(viewer),
				eq(transactions.source, "quick-add"),
			),
		);
	if (!row) return null;
	return {
		id: row.id,
		date: row.date as DayKey,
		amount: row.amount,
		note: row.note,
		bucketId: row.bucketId,
		bucketName: row.bucketName,
		createdBy: { memberId: row.memberId, name: row.memberName },
	};
}
