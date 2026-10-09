import type { Cents, DayKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { quickAddCounts, quickAddedText, withQuickAdd } from "./quick-add";
import type { MonthData } from "./server/month";

// "Someone's paying part of this back" on Quick Add (issue 158): the part Owed back never counts
// as spending (ADR-0058, revised 2026-10-08), so the Bucket drains by the Household's share at once.

const casey = { id: "o1", who: "Casey", memberId: null, amountCents: 2_000 as Cents };
const added = {
	transactionId: "t1",
	bucketId: "kids",
	bucketName: "Kids",
	amountCents: 4_000,
	note: "",
	forMemberIds: [],
	date: "2026-10-08" as DayKey,
};

describe("what a Quick Add counts as spending", () => {
	it("is all of it when nobody is paying any back", () => {
		expect(quickAddCounts(added)).toBe(4_000);
	});

	it("is the Household's share when someone is paying part back", () => {
		expect(quickAddCounts({ ...added, owedBack: casey })).toBe(2_000);
	});

	it("is nothing when someone is paying all of it back", () => {
		expect(quickAddCounts({ ...added, owedBack: { ...casey, amountCents: 4_000 as Cents } })).toBe(
			0,
		);
	});

	it("is all of it on a Receipt dated before the Owed back part stopped counting", () => {
		expect(quickAddCounts({ ...added, date: "2026-09-30" as DayKey, owedBack: casey })).toBe(4_000);
	});

	it("lands in the month's spending at the Household's share", () => {
		const month = { spending: [] } as unknown as MonthData;
		expect(withQuickAdd(month, { ...added, owedBack: casey }).spending).toEqual([
			{ id: "t1", bucketId: "kids", amount: 2_000, date: "2026-10-08", for: [] },
		]);
	});
});

describe("what is said once a Quick Add is saved", () => {
	it("is the whole amount and its Bucket", () => {
		expect(quickAddedText(added)).toBe("$40 added to Kids");
	});

	it("says the part owed back, and by whom", () => {
		expect(quickAddedText({ ...added, owedBack: casey })).toBe(
			"$40 added to Kids · $20 owed back by Casey",
		);
	});
});
