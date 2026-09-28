import { describe, expect, it } from "vitest";
import { type BucketUse, type DayKey, daysBetween, likelyBucketOrder } from "./index";

const buckets = ["groceries", "eating", "hockey", "fun"].map((id) => ({ id }));
const ids = (list: { id: string }[]) => list.map((b) => b.id);
const use = (bucketId: string, date: DayKey): BucketUse => ({ bucketId, date });

describe("likelyBucketOrder: Buckets in the order the next Quick Add most likely uses", () => {
	it("keeps the Plan's order with no history", () => {
		expect(ids(likelyBucketOrder(buckets, [], "2026-09-15"))).toEqual([
			"groceries",
			"eating",
			"hockey",
			"fun",
		]);
	});

	it("puts the most used Buckets first and keeps Plan order among ties", () => {
		const uses = [
			use("fun", "2026-09-14"),
			use("fun", "2026-09-14"),
			use("hockey", "2026-09-14"),
			use("eating", "2026-09-14"),
		];
		expect(ids(likelyBucketOrder(buckets, uses, "2026-09-15"))).toEqual([
			"fun",
			"eating",
			"hockey",
			"groceries",
		]);
	});

	it("weighs recent uses above older ones", () => {
		// Three uses six weeks ago count less than two this week.
		const uses = [
			use("groceries", "2026-08-04"),
			use("groceries", "2026-08-04"),
			use("groceries", "2026-08-04"),
			use("hockey", "2026-09-13"),
			use("hockey", "2026-09-14"),
		];
		expect(ids(likelyBucketOrder(buckets, uses, "2026-09-15")).slice(0, 2)).toEqual([
			"hockey",
			"groceries",
		]);
	});

	it("counts across month and year boundaries", () => {
		const uses = [use("fun", "2025-12-31"), use("eating", "2025-12-01")];
		expect(ids(likelyBucketOrder(buckets, uses, "2026-01-02")).slice(0, 2)).toEqual([
			"fun",
			"eating",
		]);
	});

	it("ignores uses of Buckets no longer in the Plan", () => {
		const uses = [use("archived", "2026-09-14"), use("hockey", "2026-09-01")];
		expect(ids(likelyBucketOrder(buckets, uses, "2026-09-15"))).toEqual([
			"hockey",
			"groceries",
			"eating",
			"fun",
		]);
	});
});

describe("daysBetween", () => {
	it.each([
		["2026-09-14", "2026-09-15", 1],
		["2026-09-15", "2026-09-14", -1],
		["2026-02-28", "2026-03-01", 1],
		["2028-02-28", "2028-03-01", 2],
		["2026-12-31", "2027-01-01", 1],
	] as const)("%s to %s is %i", (from, to, days) => {
		expect(daysBetween(from, to)).toBe(days);
	});
});
