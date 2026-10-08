import { beforeEach, describe, expect, it } from "vitest";
import {
	createHouseholdForParent,
	type Db,
	loadBell,
	loadNudgeRecipients,
	markBellSeen,
	recordSentNudges,
	SENT_NUDGES_KEPT_MS,
	type SentNudge,
	type Viewer,
} from "./index";
import { members, sentNudges } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };
const kim: Viewer = { householdId: "other", memberId: "kim" };

let db: Db;

const at = (iso: string) => new Date(iso);

const nudge = (memberId: string, title: string, more: Partial<SentNudge> = {}): SentNudge => ({
	memberId,
	kind: "bucket-pace",
	title,
	body: "$40 left, with 9 days of October to go.",
	url: "/month/2026-10",
	...more,
});

const titles = async (viewer: Viewer) =>
	(await loadBell(db, viewer)).nudges.map((sent) => sent.title);

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-kim",
		householdId: "other",
		householdName: "The Vales",
		timeZone: "America/Chicago",
		parentId: "kim",
		parentName: "Kim",
	});
});

describe("the bell's Nudges", () => {
	it("records a Nudge for the Parent it was sent to, and lists theirs newest first", async () => {
		await recordSentNudges(
			db,
			householdId,
			[nudge("alex", "Groceries is ahead of pace"), nudge("sam", "Groceries is ahead of pace")],
			at("2026-10-07T15:00:00Z"),
		);
		await recordSentNudges(
			db,
			householdId,
			[nudge("alex", "Time for your Check-in", { kind: "check-in", url: "/check-in" })],
			at("2026-10-08T14:00:00Z"),
		);

		const { nudges, seen } = await loadBell(db, alex);
		expect(seen).toBeNull();
		expect(nudges.map(({ id: _id, ...sent }) => sent)).toEqual([
			{
				kind: "check-in",
				title: "Time for your Check-in",
				body: "$40 left, with 9 days of October to go.",
				url: "/check-in",
				sentAt: Date.parse("2026-10-08T14:00:00Z"),
			},
			{
				kind: "bucket-pace",
				title: "Groceries is ahead of pace",
				body: "$40 left, with 9 days of October to go.",
				url: "/month/2026-10",
				sentAt: Date.parse("2026-10-07T15:00:00Z"),
			},
		]);
		expect(await titles(sam)).toEqual(["Groceries is ahead of pace"]);
	});

	it("keeps a Nudge about a Personal Allowance to its owner (ADR-0003)", async () => {
		// As the Agent sends it: Alex's Personal Allowance passing Pace goes to Alex alone.
		await recordSentNudges(
			db,
			householdId,
			[nudge("alex", "Alex’s spending is over its allowance")],
			at("2026-10-07T15:00:00Z"),
		);
		expect(await titles(alex)).toEqual(["Alex’s spending is over its allowance"]);
		expect(await titles(sam)).toEqual([]);
		// Nor by asking for another Parent's under one's own Household, or another Household's.
		expect(await titles({ householdId: "other", memberId: "alex" })).toEqual([]);
		expect(await titles(kim)).toEqual([]);
	});

	it("doesn't record the test Nudge or the update Nudge", async () => {
		const recorded = await recordSentNudges(
			db,
			householdId,
			[
				nudge("alex", "Nudges are on", { kind: "test" }),
				nudge("alex", "Noodle was updated", { kind: "app-update" }),
			],
			at("2026-10-07T15:00:00Z"),
		);
		expect(recorded).toBe(0);
		expect(await titles(alex)).toEqual([]);
	});

	it("lists the latest only, and drops its own Household's once they are old", async () => {
		const first = at("2026-08-01T15:00:00Z");
		await recordSentNudges(db, householdId, [nudge("alex", "Old")], first);
		await recordSentNudges(db, "other", [nudge("kim", "Theirs")], first);
		const later = new Date(first.getTime() + SENT_NUDGES_KEPT_MS + 1);
		await recordSentNudges(
			db,
			householdId,
			Array.from({ length: 14 }, (_, i) => nudge("alex", `New ${i}`)),
			later,
		);
		expect(await titles(alex)).toHaveLength(14);
		expect(await titles(alex)).not.toContain("Old");
		expect((await loadBell(db, alex, 3)).nudges).toHaveLength(3);
		expect(await titles(kim)).toEqual(["Theirs"]);
		expect(await db.select().from(sentNudges)).toHaveLength(15);
	});
});

describe("how far a Parent has read the bell", () => {
	it("is kept for that Parent alone", async () => {
		const seen = { nudgesUpTo: Date.parse("2026-10-07T15:00:00Z"), release: "2026-10-06" };
		await markBellSeen(db, alex, seen);
		expect((await loadBell(db, alex)).seen).toEqual(seen);
		expect((await loadBell(db, sam)).seen).toBeNull();
		expect((await loadBell(db, kim)).seen).toBeNull();
	});

	it("only moves forward", async () => {
		await markBellSeen(db, alex, { nudgesUpTo: 2_000, release: "2026-10-06" });
		// An older mark from the other device, arriving late.
		await markBellSeen(db, alex, { nudgesUpTo: 1_000, release: "2026-10-01" });
		expect((await loadBell(db, alex)).seen).toEqual({ nudgesUpTo: 2_000, release: "2026-10-06" });
		await markBellSeen(db, alex, { nudgesUpTo: 3_000, release: null });
		expect((await loadBell(db, alex)).seen).toEqual({ nudgesUpTo: 3_000, release: "2026-10-06" });
		await markBellSeen(db, alex, { nudgesUpTo: 3_000, release: "2026-10-08" });
		expect((await loadBell(db, alex)).seen).toEqual({ nudgesUpTo: 3_000, release: "2026-10-08" });
	});

	it("can't be set under another Household", async () => {
		await markBellSeen(db, alex, { nudgesUpTo: 2_000, release: "2026-10-06" });
		await markBellSeen(
			db,
			{ householdId: "other", memberId: "alex" },
			{
				nudgesUpTo: 9_000,
				release: "2026-10-08",
			},
		);
		expect((await loadBell(db, alex)).seen).toEqual({ nudgesUpTo: 2_000, release: "2026-10-06" });
	});
});

describe("who a Nudge could go to", () => {
	it("is every Parent, with a device for Nudges or without, and no Child", async () => {
		await db.insert(members).values({ id: "mo", householdId, kind: "child", name: "Mo" });
		const household = await loadNudgeRecipients(db, householdId);
		expect(household?.recipients.map((recipient) => recipient.memberId)).toEqual(["alex", "sam"]);
	});
});
