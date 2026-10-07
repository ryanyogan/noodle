import type { BucketState, MonthState } from "./month-state";

// When a Nudge is worth sending, and when it may reach a Parent. The Household Agent decides
// with these; nothing here knows how a Nudge is delivered.

/**
 * What a Nudge is about. `check-in` is the weekly Check-in's; `test` is one a Parent sends
 * themselves to check a device.
 */
export type NudgeKind =
	| "bucket-pace"
	| "quick-add"
	| "windfall"
	| "check-in"
	| "test"
	/** The app was updated (issue 140): about the app itself, so always wanted, once a deploy. */
	| "app-update";

/**
 * A daily window when a Parent gets no Nudges, as minutes after local midnight (0–1439). It
 * crosses midnight when `start` is after `end` (22:00–07:00); `start` equal to `end` is empty.
 */
export type QuietHours = { start: number; end: number };

/** Which Nudges one Parent wants, and when they're quiet. Each Parent sets their own. */
export type NudgePreferences = {
	bucketPace: boolean;
	otherParentQuickAdds: boolean;
	windfalls: boolean;
	quietHours: QuietHours | null;
	/** The IANA zone the quiet hours are in: the Parent's own, which may differ from the Household's. */
	timeZone: string;
};

/**
 * Before a Parent has chosen: Buckets passing Pace and Extra income, never the other Parent's
 * Quick Adds, and quiet from 9 PM to 7 AM in the Household's time zone.
 */
export const defaultNudgePreferences = (timeZone: string): NudgePreferences => ({
	bucketPace: true,
	otherParentQuickAdds: false,
	windfalls: true,
	quietHours: { start: 21 * 60, end: 7 * 60 },
	timeZone,
});

/**
 * Whether a Parent wants this kind of Nudge at all. The Check-in's is always wanted: it's the one
 * time a week the app asks for attention. So is a test.
 */
export function wantsNudge(preferences: NudgePreferences, kind: NudgeKind): boolean {
	switch (kind) {
		case "bucket-pace":
			return preferences.bucketPace;
		case "quick-add":
			return preferences.otherParentQuickAdds;
		case "windfall":
			return preferences.windfalls;
		case "check-in":
		case "test":
		case "app-update":
			return true;
	}
}

const MINUTES_PER_DAY = 24 * 60;
const MINUTE_MS = 60_000;

/** Minutes after local midnight at an instant in an IANA time zone, 0–1439. */
export function minuteOfDayAt(instant: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hour: "2-digit",
		minute: "2-digit",
		hourCycle: "h23",
	}).formatToParts(instant);
	const part = (type: Intl.DateTimeFormatPartTypes) =>
		Number(parts.find((p) => p.type === type)?.value ?? 0);
	return part("hour") * 60 + part("minute");
}

/** Whether an instant falls in the quiet hours, read in their time zone. */
export function isQuietAt(instant: Date, quietHours: QuietHours | null, timeZone: string): boolean {
	if (!quietHours || quietHours.start === quietHours.end) return false;
	const minute = minuteOfDayAt(instant, timeZone);
	const { start, end } = quietHours;
	return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/**
 * The first instant after `after` when the local time in `timeZone` reaches `minute`. Across a
 * daylight saving change it lands on the new offset's wall-clock time; when that time is skipped
 * (clocks springing forward over it), an hour later on the new clock.
 */
export function nextLocalMinute(after: Date, minute: number, timeZone: string): Date {
	const start = Math.floor(after.getTime() / MINUTE_MS) * MINUTE_MS;
	const wait = (minute - minuteOfDayAt(after, timeZone) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	let candidate = start + (wait || MINUTES_PER_DAY) * MINUTE_MS;
	// The wait assumed today's UTC offset holds; correct for any change on the way.
	const tried: number[] = [];
	for (let i = 0; i < 3; i++) {
		const drift = minute - minuteOfDayAt(new Date(candidate), timeZone);
		const shortest = ((drift + MINUTES_PER_DAY * 1.5) % MINUTES_PER_DAY) - MINUTES_PER_DAY / 2;
		if (shortest === 0) return new Date(candidate);
		tried.push(candidate);
		candidate += shortest * MINUTE_MS;
	}
	// A skipped local time flips between an hour early and an hour late: take late.
	return new Date(Math.max(...tried, candidate));
}

/**
 * When a Nudge raised at `now` should reach a Parent: at once, or when their quiet hours end.
 */
export function nudgeDeliveryTime(
	now: Date,
	quietHours: QuietHours | null,
	timeZone: string,
): Date {
	if (!quietHours || !isQuietAt(now, quietHours, timeZone)) return now;
	return nextLocalMinute(now, quietHours.end, timeZone);
}

/**
 * Passing Pace is only worth a Nudge while there's time to do something about it: at least this
 * many days of the month still to come.
 */
export const PACE_NUDGE_MIN_DAYS_LEFT = 7;

/** Whether a Bucket is past Pace: spent faster than it allows, or over its allowance. */
const isPastPace = (bucket: BucketState) => bucket.allowance > 0 && bucket.status !== "on-pace";

/**
 * Which Buckets have just passed Pace, given those that were past it when last checked. A Bucket
 * nudges once per crossing: it isn't nudged again until a check finds it back on Pace. Returns
 * the Buckets to nudge about and the Buckets past Pace now, to remember for the next check.
 */
export function bucketsPassingPace(
	state: MonthState,
	pastPaceBefore: readonly string[],
): { nudge: BucketState[]; pastPace: string[] } {
	const before = new Set(pastPaceBefore);
	const pastPace = state.buckets.filter(isPastPace);
	return {
		nudge:
			state.daysLeft >= PACE_NUDGE_MIN_DAYS_LEFT
				? pastPace.filter((bucket) => !before.has(bucket.id))
				: [],
		pastPace: pastPace.map((bucket) => bucket.id),
	};
}
