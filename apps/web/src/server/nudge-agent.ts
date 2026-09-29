import { env } from "cloudflare:workers";
import { loadNudgeRecipients, loadQuickAddForNudge } from "@noodle/db";
import {
	bucketsPassingPace,
	type Cents,
	type DayKey,
	type MonthKey,
	monthKeyAt,
	monthState,
	wantsNudge,
} from "@noodle/domain";
import type { HouseholdChange } from "../household-changes";
import { getDb } from "./db";
import { loadMonth } from "./month";
import {
	bucketPaceNudge,
	type RaisedNudges,
	type ScheduledNudge,
	scheduleNudges,
	windfallArrived,
} from "./nudge-content";
import type { NudgeDelivery } from "./nudge-delivery";

/** Something a write did that may be worth a Nudge, beyond what it changed. */
export type HouseholdEvent =
	| { type: "quick-add"; transactionId: string }
	/** Income recorded in a month, which may have started or grown its Windfall. */
	| { type: "income"; month: MonthKey; recordedBy: string };

/** Writes that land within this long of each other are looked at together. */
const SETTLE_MS = 3_000;

/** What's still to look at, and a week's Check-in Nudges still to be held. */
type Pending = { checkPace: boolean; events: HouseholdEvent[]; checkIns: ScheduledNudge[] };

const HOUSEHOLD_KEY = "household-id";
const PENDING_KEY = "nudges:pending";
const SCHEDULED_KEY = "nudges:scheduled";
const PAST_PACE_PREFIX = "nudges:past-pace:";
const WINDFALL_PREFIX = "nudges:windfall:";
const CHECK_IN_KEY = "nudges:check-in-week";

/**
 * The Household Agent's Nudges (ADR-0007). After a write, it looks at what changed a moment
 * later (so a burst of writes is looked at once), decides which Parents to Nudge, holds each
 * until that Parent's quiet hours end, and hands them to the Nudge Queue to deliver. It keeps
 * what it needs in the Agent's own storage: what's still to look at, the Nudges it's holding,
 * which Buckets were past Pace last time, so a Bucket nudges once per crossing, the most each
 * month's Windfall was Nudged at, so it nudges once per increase, and the last week it took
 * Check-in Nudges for, so each week's go out once.
 */
export class HouseholdNudges {
	constructor(private readonly storage: DurableObjectStorage) {}

	private get kv() {
		return this.storage.kv;
	}

	private pending(): Pending {
		const pending = this.kv.get<Partial<Pending>>(PENDING_KEY);
		return {
			checkPace: pending?.checkPace ?? false,
			events: pending?.events ?? [],
			checkIns: pending?.checkIns ?? [],
		};
	}

	private addPending(more: Pending) {
		const pending = this.pending();
		// A retried write raises the same event again; it's still one thing that happened.
		const events = new Map(
			[...pending.events, ...more.events].map((event) => [JSON.stringify(event), event]),
		);
		this.kv.put(PENDING_KEY, {
			checkPace: pending.checkPace || more.checkPace,
			events: [...events.values()],
			checkIns: [...pending.checkIns, ...more.checkIns],
		} satisfies Pending);
	}

	private hasPending({ checkPace, events, checkIns }: Pending) {
		return checkPace || events.length > 0 || checkIns.length > 0;
	}

	private async wakeBy(time: number) {
		const alarm = await this.storage.getAlarm();
		if (alarm === null || alarm > time) await this.storage.setAlarm(time);
	}

	/** Notes a write to look at shortly. Any change to a month may move a Bucket past Pace. */
	async raise(householdId: string, changes: readonly HouseholdChange[], events: HouseholdEvent[]) {
		const checkPace = changes.some((change) => change === "months" || change.startsWith("month:"));
		if (!checkPace && events.length === 0) return;
		this.kv.put(HOUSEHOLD_KEY, householdId);
		this.addPending({ checkPace, events, checkIns: [] });
		await this.wakeBy(Date.now() + SETTLE_MS);
	}

	/**
	 * Holds a week's Check-in Nudges until they're due, once per week however often it's asked
	 * (a nightly run may be retried). Returns whether this call took them.
	 */
	async checkIn(householdId: string, week: DayKey, nudges: ScheduledNudge[]): Promise<boolean> {
		if (this.kv.get<DayKey>(CHECK_IN_KEY) === week) return false;
		this.kv.put(CHECK_IN_KEY, week);
		this.kv.put(HOUSEHOLD_KEY, householdId);
		// Handed to the alarm, the only thing that changes what's held.
		this.addPending({ checkPace: false, events: [], checkIns: nudges });
		await this.wakeBy(Date.now());
		return true;
	}

	/** Runs on the Agent's alarm: decides on anything pending, then sends what's due. */
	async run(now = new Date()) {
		const householdId = this.kv.get<string>(HOUSEHOLD_KEY);
		if (!householdId) return;
		// Taken now, so writes noted while this runs wait for the next run rather than being lost.
		const pending = this.pending();
		this.kv.delete(PENDING_KEY);
		try {
			if (pending.checkPace || pending.events.length > 0) {
				const decided = await decideNudges(
					householdId,
					pending,
					{ pastPace: this.pastPace, windfallNudgedAt: this.windfallNudgedAt },
					now,
				);
				if (decided.pastPace) this.rememberPastPace(decided.pastPace.month, decided.pastPace.ids);
				for (const { month, windfall } of decided.windfalls) this.rememberWindfall(month, windfall);
				this.kv.put(SCHEDULED_KEY, [...this.scheduled(), ...decided.scheduled]);
			}
			if (pending.checkIns.length > 0) {
				this.kv.put(SCHEDULED_KEY, [...this.scheduled(), ...pending.checkIns]);
			}
		} catch (error) {
			// The alarm retries; decide again then.
			this.addPending(pending);
			throw error;
		}

		// Only this alarm handler (one run at a time) changes what's held.
		const scheduled = this.scheduled();
		const isDue = (nudge: ScheduledNudge) => nudge.deliverAt <= now.getTime();
		const due = scheduled.filter(isDue);
		const deliveries = due.map(({ memberId, nudge }) => ({
			body: { householdId, memberId, nudge } satisfies NudgeDelivery,
		}));
		for (let i = 0; i < deliveries.length; i += 100) {
			await env.NUDGE_QUEUE.sendBatch(deliveries.slice(i, i + 100));
		}
		const held = scheduled.filter((nudge) => !isDue(nudge));
		this.kv.put(SCHEDULED_KEY, held);

		const next = this.hasPending(this.pending())
			? Date.now() + SETTLE_MS
			: Math.min(...held.map((nudge) => nudge.deliverAt));
		if (Number.isFinite(next)) await this.storage.setAlarm(next);
	}

	private scheduled(): ScheduledNudge[] {
		return this.kv.get<ScheduledNudge[]>(SCHEDULED_KEY) ?? [];
	}

	private readonly pastPace = (month: MonthKey): string[] =>
		this.kv.get<string[]>(`${PAST_PACE_PREFIX}${month}`) ?? [];

	private readonly windfallNudgedAt = (month: MonthKey): Cents =>
		this.kv.get<Cents>(`${WINDFALL_PREFIX}${month}`) ?? 0;

	/** Remembers what a month's Windfall was Nudged at, forgetting earlier months'. */
	private rememberWindfall(month: MonthKey, windfall: Cents) {
		for (const [key] of this.kv.list({ prefix: WINDFALL_PREFIX })) {
			if (key < `${WINDFALL_PREFIX}${month}`) this.kv.delete(key);
		}
		this.kv.put(`${WINDFALL_PREFIX}${month}`, windfall);
	}

	/** Remembers this month's Buckets past Pace, forgetting earlier months'. */
	private rememberPastPace(month: MonthKey, ids: string[]) {
		for (const [key] of this.kv.list({ prefix: PAST_PACE_PREFIX })) this.kv.delete(key);
		this.kv.put(`${PAST_PACE_PREFIX}${month}`, ids);
	}
}

/** Reads what's needed from D1 and decides which Nudges go to whom, and when. */
async function decideNudges(
	householdId: string,
	pending: Pending,
	before: {
		pastPace: (month: MonthKey) => string[];
		windfallNudgedAt: (month: MonthKey) => Cents;
	},
	now: Date,
): Promise<{
	scheduled: ScheduledNudge[];
	pastPace?: { month: MonthKey; ids: string[] };
	windfalls: { month: MonthKey; windfall: Cents }[];
}> {
	const db = getDb();
	const household = await loadNudgeRecipients(db, householdId);
	// Nobody to Nudge: whatever happened is looked at afresh once someone turns Nudges on.
	if (!household || household.recipients.length === 0) return { scheduled: [], windfalls: [] };

	const { recipients, timeZone } = household;
	const raised: RaisedNudges = { pace: [], quickAdds: [], windfalls: [] };
	let pastPace: { month: MonthKey; ids: string[] } | undefined;
	const windfalls: { month: MonthKey; windfall: Cents }[] = [];
	const [anyone] = recipients;
	// The month as a Parent sees it: charges, Moves, income, and what rolled over included. Every
	// Bucket's totals, Personal Allowances' too, and the Windfall are the same whichever Parent
	// it's read for.
	const stateOf = async (month: MonthKey, memberId: string) =>
		monthState(await loadMonth(db, { id: householdId, timeZone }, memberId, month));
	if (pending.checkPace && anyone) {
		const month = monthKeyAt(now, timeZone);
		const state = await stateOf(month, anyone.memberId);
		const check = bucketsPassingPace(state, before.pastPace(month));
		raised.pace = check.nudge.map((bucket) => bucketPaceNudge(bucket, month, state.daysLeft));
		pastPace = { month, ids: check.pastPace };
	}
	// Who recorded income in each month.
	const incomeIn = new Map<MonthKey, string[]>();
	for (const event of pending.events) {
		if (event.type === "income") {
			incomeIn.set(event.month, [...(incomeIn.get(event.month) ?? []), event.recordedBy]);
		}
	}
	for (const [month, recordedBy] of incomeIn) {
		if (!anyone) break;
		const { windfall } = await stateOf(month, anyone.memberId);
		const arrived = windfallArrived(month, windfall, before.windfallNudgedAt(month), recordedBy);
		if (arrived) {
			raised.windfalls.push(arrived);
			windfalls.push({ month, windfall });
		}
	}
	for (const event of pending.events) {
		if (event.type !== "quick-add") continue;
		// Read for each Parent who'd get it, so each sees only what they may (ADR-0003).
		for (const { memberId } of recipients.filter(({ preferences }) =>
			wantsNudge(preferences, "quick-add"),
		)) {
			const transaction = await loadQuickAddForNudge(
				db,
				{ householdId, memberId },
				event.transactionId,
			);
			if (transaction) raised.quickAdds.push({ recipientId: memberId, transaction });
		}
	}
	return { scheduled: scheduleNudges(raised, household.recipients, now), pastPace, windfalls };
}
