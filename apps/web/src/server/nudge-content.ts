import type { NudgeRecipient, QuickAddForNudge } from "@noodle/db";
import {
	type BucketState,
	type Cents,
	type MonthKey,
	monthOfDay,
	type NudgeKind,
	nudgeDeliveryTime,
	wantsNudge,
} from "@noodle/domain";
import { formatMoney, monthName } from "../format";

// What each Nudge says, and who it goes to when. Pure, so the Household Agent's decisions are
// unit-tested; the Agent does the reading and the Queue does the sending.

/** What a device shows for a Nudge, and where tapping it goes. */
export type NudgeMessage = {
	kind: NudgeKind;
	title: string;
	body: string;
	/** Showing a Nudge with the same tag replaces the earlier one, so a repeat never stacks. */
	tag: string;
	url: string;
};

const days = (count: number) => `${count} ${count === 1 ? "day" : "days"}`;

/** A Bucket passing Pace: only its totals. */
export function bucketPaceNudge(bucket: BucketState, month: MonthKey, daysLeft: number): PaceNudge {
	const over = bucket.left < 0;
	const nudge: NudgeMessage = {
		kind: "bucket-pace",
		title: over ? `${bucket.name} is over its allowance` : `${bucket.name} is ahead of Pace`,
		body: over
			? `${formatMoney(-bucket.left)} over, with ${days(daysLeft)} of ${monthName(month)} to go.`
			: `${formatMoney(bucket.left)} left, with ${days(daysLeft)} of ${monthName(month)} to go.`,
		tag: `bucket-pace:${bucket.id}:${month}`,
		url: `/month/${month}`,
	};
	return bucket.owner ? { nudge, owner: bucket.owner } : { nudge };
}

// Personal Allowance privacy (ADR-0003) for Nudges. A Nudge carries a single Transaction's
// details (its amount, note, Bucket) only as a `VisibleQuickAdd`: the Quick Add as read for that
// one recipient through `visibleTo` (loadQuickAddForNudge), so another Parent's Personal
// Allowance never reaches them. Totals (a Bucket passing Pace) aren't Transaction-level; a
// Personal Allowance's still Nudge only its owner.

/** A Quick Add read for the Parent a Nudge would go to, with what they may see of it. */
export type VisibleQuickAdd = { recipientId: string; transaction: QuickAddForNudge };

/** The other Parent's Quick Add. */
export function quickAddNudge({ transaction }: VisibleQuickAdd): NudgeMessage {
	return {
		kind: "quick-add",
		title: `${transaction.createdBy.name} added ${formatMoney(transaction.amount)} to ${transaction.bucketName}`,
		body: transaction.note ?? "Quick Add",
		tag: `quick-add:${transaction.id}`,
		url: `/month/${monthOfDay(transaction.date)}`,
	};
}

/** A month's Windfall that started or grew, and the Parents whose income made it grow. */
export type WindfallArrived = {
	month: MonthKey;
	/** How much it grew by since it was last Nudged. */
	grew: Cents;
	/** The month's whole Windfall now. */
	windfall: Cents;
	recordedBy: readonly string[];
};

/**
 * Whether income recorded in a month makes its Windfall worth a Nudge: only when the Windfall is
 * now more than the most it was Nudged at, so each increase Nudges once. A retried write, income
 * that stays within the Baseline, or income removed and recorded again changes nothing.
 */
export function windfallArrived(
	month: MonthKey,
	windfall: Cents,
	nudgedAt: Cents,
	recordedBy: readonly string[],
): WindfallArrived | null {
	return windfall > nudgedAt ? { month, grew: windfall - nudgedAt, windfall, recordedBy } : null;
}

/** A month's Windfall starting or growing: only Household totals, never who was paid what. */
export function windfallNudge(windfall: WindfallArrived): NudgeMessage {
	const started = windfall.grew === windfall.windfall;
	return {
		kind: "windfall",
		title: started
			? `A ${formatMoney(windfall.windfall)} Windfall arrived`
			: `${monthName(windfall.month)}’s Windfall grew by ${formatMoney(windfall.grew)}`,
		body: started
			? "Decide where it goes at your next Check-in."
			: `It’s ${formatMoney(windfall.windfall)} now. Decide where it goes at your next Check-in.`,
		// One per month: a later increase replaces the earlier Nudge on a device rather than stacking.
		tag: `windfall:${windfall.month}`,
		url: `/month/${windfall.month}`,
	};
}

/** What a Parent sees when they send themselves a test. */
export const testNudge = (): NudgeMessage => ({
	kind: "test",
	title: "Nudges are on",
	body: "This is how Noodle lets you know when something needs you.",
	tag: "test",
	url: "/household",
});

/** A Bucket that just passed Pace; `owner` when it's a Parent's Personal Allowance. */
export type PaceNudge = { nudge: NudgeMessage; owner?: string };

/** Something that happened in the Household, which may be worth a Nudge to some Parents. */
export type RaisedNudges = {
	/** Buckets that just passed Pace, as Nudges for every Parent who wants them. */
	pace: PaceNudge[];
	/** Quick Adds, each read for a Parent who may get a Nudge about it. */
	quickAdds: VisibleQuickAdd[];
	/** Months whose Windfall started or grew. */
	windfalls: WindfallArrived[];
};

/** A Nudge for one Parent, and when it may reach them (epoch ms). */
export type ScheduledNudge = { memberId: string; nudge: NudgeMessage; deliverAt: number };

/**
 * Who gets which Nudges, and when: each Parent only the kinds they want, never their own Quick
 * Adds or a Windfall grown only by their own income, only what was read for them, nobody else's
 * Personal Allowance, and after their quiet hours.
 */
export function scheduleNudges(
	raised: RaisedNudges,
	recipients: readonly NudgeRecipient[],
	now: Date,
): ScheduledNudge[] {
	const scheduled: ScheduledNudge[] = [];
	for (const { memberId, preferences } of recipients) {
		const nudges: NudgeMessage[] = [];
		if (wantsNudge(preferences, "bucket-pace")) {
			for (const { nudge, owner } of raised.pace) {
				if (owner === undefined || owner === memberId) nudges.push(nudge);
			}
		}
		if (wantsNudge(preferences, "quick-add")) {
			for (const quickAdd of raised.quickAdds) {
				if (quickAdd.recipientId !== memberId) continue;
				if (quickAdd.transaction.createdBy.memberId === memberId) continue;
				nudges.push(quickAddNudge(quickAdd));
			}
		}
		if (wantsNudge(preferences, "windfall")) {
			for (const windfall of raised.windfalls) {
				// They saw the Windfall grow as they recorded the income.
				if (windfall.recordedBy.every((id) => id === memberId)) continue;
				nudges.push(windfallNudge(windfall));
			}
		}
		const deliverAt = nudgeDeliveryTime(
			now,
			preferences.quietHours,
			preferences.timeZone,
		).getTime();
		for (const nudge of nudges) scheduled.push({ memberId, nudge, deliverAt });
	}
	return scheduled;
}
