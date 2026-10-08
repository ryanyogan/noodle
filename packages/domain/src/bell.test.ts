import { describe, expect, it } from "vitest";
import {
	type BellRelease,
	bell,
	nudgeIsRecorded,
	type RecordedNudge,
	startingBellSeen,
} from "./bell";

const timeZone = "America/Chicago";

const releases: BellRelease[] = [
	{ date: "2026-10-08", title: "A bell for what's new" },
	{ date: "2026-10-06", title: "Loans" },
	{ date: "2026-10-01", title: "Reports" },
];

const nudge = (
	id: string,
	sentAt: string,
	title = "Groceries is ahead of pace",
): RecordedNudge => ({
	id,
	kind: "bucket-pace",
	title,
	body: "$40 left, with 9 days of October to go.",
	url: "/month/2026-10",
	sentAt: Date.parse(sentAt),
});

describe("bell", () => {
	it("meets a Parent who never opened it with the latest release only", () => {
		expect(startingBellSeen(releases)).toEqual({ nudgesUpTo: 0, release: "2026-10-06" });
		const { rows, unread } = bell({ seen: null, releases, nudges: [], timeZone });
		expect(rows).toEqual([
			{
				key: "release:2026-10-08",
				type: "release",
				day: "2026-10-08",
				title: "A bell for what's new",
				body: null,
				url: "/household/changelog#2026-10-08",
				unread: true,
			},
		]);
		expect(unread).toBe(1);
	});

	it("has nothing new once the latest release was seen", () => {
		const seen = { nudgesUpTo: 0, release: "2026-10-08" };
		expect(bell({ seen, releases, nudges: [], timeZone })).toEqual({ rows: [], unread: 0, seen });
	});

	it("lists every release since the one last seen, newest first", () => {
		const { rows } = bell({
			seen: { nudgesUpTo: 0, release: "2026-10-01" },
			releases,
			nudges: [],
			timeZone,
		});
		expect(rows.map((row) => row.day)).toEqual(["2026-10-08", "2026-10-06"]);
	});

	it("counts a release as unseen on its own day, whenever the bell was last opened", () => {
		// Opened in the morning with the release before it as the latest; this one went out later.
		const seen = { nudgesUpTo: Date.parse("2026-10-08T14:00:00Z"), release: "2026-10-06" };
		expect(bell({ seen, releases, nudges: [], timeZone }).unread).toBe(1);
	});

	it("keeps a read Nudge listed and counts only those sent since", () => {
		const { rows, unread, seen } = bell({
			seen: { nudgesUpTo: Date.parse("2026-10-07T12:00:00Z"), release: "2026-10-08" },
			releases,
			nudges: [nudge("b", "2026-10-07T18:00:00Z"), nudge("a", "2026-10-07T12:00:00Z")],
			timeZone,
		});
		expect(rows.map((row) => [row.key, row.unread])).toEqual([
			["nudge:b", true],
			["nudge:a", false],
		]);
		expect(unread).toBe(1);
		expect(seen).toEqual({ nudgesUpTo: Date.parse("2026-10-07T18:00:00Z"), release: "2026-10-08" });
	});

	it("puts a Nudge on the Household's day, and a release before that day's Nudges", () => {
		const { rows } = bell({
			seen: null,
			releases,
			// 03:00 UTC on the 9th is still the 8th in Chicago.
			nudges: [nudge("late", "2026-10-09T03:00:00Z"), nudge("next", "2026-10-09T15:00:00Z")],
			timeZone,
		});
		expect(rows.map((row) => [row.key, row.day])).toEqual([
			["nudge:next", "2026-10-09"],
			["release:2026-10-08", "2026-10-08"],
			["nudge:late", "2026-10-08"],
		]);
	});

	it("lists no more than its limit and counts only what it lists", () => {
		const nudges = Array.from({ length: 5 }, (_, i) =>
			nudge(`n${i}`, `2026-10-0${5 - i}T15:00:00Z`),
		);
		const { rows, unread, seen } = bell({ seen: null, releases, nudges, timeZone, limit: 3 });
		expect(rows.map((row) => row.key)).toEqual(["release:2026-10-08", "nudge:n0", "nudge:n1"]);
		expect(unread).toBe(3);
		// Opening it reads them all, listed or not.
		expect(seen.nudgesUpTo).toBe(Date.parse("2026-10-05T15:00:00Z"));
	});

	it("never goes back on what was read", () => {
		const seen = { nudgesUpTo: Date.parse("2026-10-07T12:00:00Z"), release: "2026-10-08" };
		expect(bell({ seen, releases: [], nudges: [], timeZone }).seen).toEqual(seen);
	});
});

describe("nudgeIsRecorded", () => {
	it("leaves out the test Nudge and the update Nudge, which the bell says as a release", () => {
		expect(nudgeIsRecorded("test")).toBe(false);
		expect(nudgeIsRecorded("app-update")).toBe(false);
		expect(nudgeIsRecorded("check-in")).toBe(true);
		expect(nudgeIsRecorded("quick-add")).toBe(true);
	});
});
