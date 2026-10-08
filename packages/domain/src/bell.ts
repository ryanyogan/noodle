import { type DayKey, dayKeyAt } from "./month";
import type { NudgeKind } from "./nudges";

// The bell (issue 157, ADR-0065): what it lists for one Parent and what of that is unread. Pure;
// the Nudges come from what was recorded for that Parent, the releases from the Changelog.

/** Nudges that are never recorded: a test a Parent sent themselves, and "Noodle was updated", which the bell says as the release itself. */
export const NUDGES_NOT_RECORDED: readonly NudgeKind[] = ["test", "app-update"];

/** Whether a Nudge of this kind is recorded for the bell when it is sent. */
export const nudgeIsRecorded = (kind: NudgeKind) => !NUDGES_NOT_RECORDED.includes(kind);

/** How many rows the bell lists at most; the Changelog has every release. */
export const BELL_LIMIT = 20;

/** A Nudge recorded for a Parent, as the bell lists it. */
export type RecordedNudge = {
	id: string;
	kind: NudgeKind;
	title: string;
	body: string;
	url: string;
	/** When it was sent (epoch ms). */
	sentAt: number;
};

/** A release as the bell needs it: its day (`YYYY-MM-DD`, which is its anchor too) and title. */
export type BellRelease = { date: string; title: string };

/**
 * How far a Parent has read: Nudges sent up to `nudgesUpTo` (epoch ms), and releases up to the
 * one of `release` (its day). Two marks, since a release has only a day: one going out in the
 * afternoon would otherwise count as read by a Parent who opened the bell that morning.
 */
export type BellSeen = { nudgesUpTo: number; release: string | null };

/** One row of the bell: a release, or a Nudge that was sent. */
export type BellRow = {
	/** Stable among the rows. */
	key: string;
	type: "release" | "nudge";
	day: DayKey;
	title: string;
	/** A Nudge's second line; a release has none. */
	body: string | null;
	/** Where it leads: a path in the app. */
	url: string;
	unread: boolean;
};

export type Bell = {
	/** Newest first, `BELL_LIMIT` at most. */
	rows: BellRow[];
	/** How many of the rows are unread. */
	unread: number;
	/** What to keep as read once these rows have been shown. */
	seen: BellSeen;
};

/** Where a release is on the Changelog page. */
export const releaseUrl = (date: string) => `/household/changelog#${date}`;

/**
 * Where a Parent who has never opened the bell starts: everything but the latest release is read,
 * so nobody is met by every release there has ever been. Nudges start unread: none is recorded
 * before a Parent could have opened the bell.
 */
export function startingBellSeen(releases: readonly BellRelease[]): BellSeen {
	return { nudgesUpTo: 0, release: releases[1]?.date ?? null };
}

/**
 * The bell for one Parent: the releases they haven't seen and the Nudges sent to them, newest
 * first. A release is listed only until it has been seen (the Changelog keeps it); a Nudge stays,
 * read, so one that was dismissed on a device can be found again. On one day a release comes
 * before that day's Nudges.
 */
export function bell({
	seen,
	releases,
	nudges,
	timeZone,
	limit = BELL_LIMIT,
}: {
	/** Null for a Parent who has never opened it. */
	seen: BellSeen | null;
	/** Newest first. */
	releases: readonly BellRelease[];
	nudges: readonly RecordedNudge[];
	/** The Household's, for the day a Nudge was sent on. */
	timeZone: string;
	limit?: number;
}): Bell {
	const from = seen ?? startingBellSeen(releases);
	const unseenRelease = (release: BellRelease) =>
		from.release === null || release.date > from.release;
	const rows: (BellRow & { at: number })[] = [
		...releases.filter(unseenRelease).map((release) => ({
			key: `release:${release.date}`,
			type: "release" as const,
			day: release.date as DayKey,
			title: release.title,
			body: null,
			url: releaseUrl(release.date),
			unread: true,
			at: Number.POSITIVE_INFINITY,
		})),
		...nudges.map((nudge) => ({
			key: `nudge:${nudge.id}`,
			type: "nudge" as const,
			day: dayKeyAt(new Date(nudge.sentAt), timeZone),
			title: nudge.title,
			body: nudge.body,
			url: nudge.url,
			unread: nudge.sentAt > from.nudgesUpTo,
			at: nudge.sentAt,
		})),
	]
		.sort((a, b) => (a.day === b.day ? b.at - a.at : a.day < b.day ? 1 : -1))
		.slice(0, limit);
	return {
		rows: rows.map(({ at: _at, ...row }) => row),
		unread: rows.filter((row) => row.unread).length,
		seen: {
			nudgesUpTo: Math.max(from.nudgesUpTo, ...nudges.map((nudge) => nudge.sentAt)),
			release: releases[0]?.date ?? from.release,
		},
	};
}
