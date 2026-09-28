import type { NudgeRecipient, QuickAddForNudge } from "@noodle/db";
import { type BucketState, type DayKey, defaultNudgePreferences } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import {
	bucketPaceNudge,
	quickAddNudge,
	scheduleNudges,
	type VisibleQuickAdd,
} from "./nudge-content";

const alex = "member-alex";
const sam = "member-sam";

const transaction: QuickAddForNudge = {
	id: "tx-1",
	date: "2026-09-10" as DayKey,
	amount: 4_250,
	note: "Costco run",
	bucketId: "groceries",
	bucketName: "Groceries",
	createdBy: { memberId: alex, name: "Alex" },
};

/** Alex's Quick Add, as read for `recipientId`. */
const readFor = (recipientId: string): VisibleQuickAdd => ({ recipientId, transaction });

const recipient = (
	memberId: string,
	preferences: Partial<NudgeRecipient["preferences"]> = {},
): NudgeRecipient => ({
	memberId,
	name: memberId,
	preferences: {
		...defaultNudgePreferences("America/Chicago"),
		quietHours: null,
		...preferences,
	},
});

const groceries = (left: number): BucketState =>
	({ id: "groceries", name: "Groceries", left }) as BucketState;
const alexsAllowance = { id: "alex-pa", name: "Alex", left: 1_000, owner: alex } as BucketState;

// 2026-09-10 15:00 in Chicago (CDT, UTC−5).
const afternoon = new Date("2026-09-10T20:00:00Z");

describe("messages", () => {
	it("says who added what to which Bucket, and opens its month", () => {
		expect(quickAddNudge(readFor(sam))).toEqual({
			kind: "quick-add",
			title: "Alex added $42.50 to Groceries",
			body: "Costco run",
			tag: "quick-add:tx-1",
			url: "/month/2026-09",
		});
	});

	it("tells a Bucket ahead of Pace from one that's over", () => {
		expect(bucketPaceNudge(groceries(12_000), "2026-09", 20).nudge).toMatchObject({
			title: "Groceries is ahead of Pace",
			body: "$120 left, with 20 days of September to go.",
			tag: "bucket-pace:groceries:2026-09",
		});
		expect(bucketPaceNudge(groceries(-1_500), "2026-09", 1).nudge.title).toBe(
			"Groceries is over its allowance",
		);
		expect(bucketPaceNudge(groceries(-1_500), "2026-09", 1).nudge.body).toBe(
			"$15 over, with 1 day of September to go.",
		);
	});
});

describe("scheduleNudges", () => {
	const pace = bucketPaceNudge(groceries(12_000), "2026-09", 20);

	it("sends a Quick Add only to the Parent who didn't enter it, and only if they want it", () => {
		const scheduled = scheduleNudges(
			{ pace: [], quickAdds: [readFor(alex), readFor(sam)] },
			[recipient(alex, { otherParentQuickAdds: true }), recipient(sam)],
			afternoon,
		);
		// Sam doesn't want Quick Adds by default; Alex entered it.
		expect(scheduled).toEqual([]);

		const wanted = scheduleNudges(
			{ pace: [], quickAdds: [readFor(alex), readFor(sam)] },
			[
				recipient(alex, { otherParentQuickAdds: true }),
				recipient(sam, { otherParentQuickAdds: true }),
			],
			afternoon,
		);
		expect(wanted.map(({ memberId, nudge }) => [memberId, nudge.tag])).toEqual([
			[sam, "quick-add:tx-1"],
		]);
	});

	it("gives a Parent only a Quick Add read for them", () => {
		// Read for Alex alone: Sam couldn't see it (it's in Alex's Personal Allowance).
		const scheduled = scheduleNudges(
			{ pace: [], quickAdds: [readFor(alex)] },
			[recipient(sam, { otherParentQuickAdds: true })],
			afternoon,
		);
		expect(scheduled).toEqual([]);
	});

	it("tells only its owner that a Personal Allowance passed Pace", () => {
		const allowance = bucketPaceNudge(alexsAllowance, "2026-09", 20);
		const scheduled = scheduleNudges(
			{ pace: [allowance], quickAdds: [] },
			[recipient(alex), recipient(sam)],
			afternoon,
		);
		expect(scheduled.map(({ memberId }) => memberId)).toEqual([alex]);
	});

	it("sends a Bucket passing Pace to every Parent who wants it", () => {
		const scheduled = scheduleNudges(
			{ pace: [pace], quickAdds: [] },
			[recipient(alex), recipient(sam, { bucketPace: false })],
			afternoon,
		);
		expect(scheduled).toEqual([
			{ memberId: alex, nudge: pace.nudge, deliverAt: afternoon.getTime() },
		]);
	});

	it("holds a Nudge until the Parent's quiet hours end, in their own time zone", () => {
		// 22:00 in Chicago; quiet 21:00–07:00.
		const night = new Date("2026-09-11T03:00:00Z");
		const quiet = { start: 21 * 60, end: 7 * 60 };
		const scheduled = scheduleNudges(
			{ pace: [pace], quickAdds: [] },
			[
				recipient(alex, { quietHours: quiet }),
				// Sam is in London, where it's 04:00: quiet until 07:00 there.
				recipient(sam, { quietHours: quiet, timeZone: "Europe/London" }),
			],
			night,
		);
		expect(scheduled.map(({ memberId, deliverAt }) => [memberId, new Date(deliverAt)])).toEqual([
			[alex, new Date("2026-09-11T12:00:00Z")],
			[sam, new Date("2026-09-11T06:00:00Z")],
		]);
	});
});
