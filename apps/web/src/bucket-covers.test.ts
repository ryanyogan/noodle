import type { PlanMove } from "@noodle/db";
import type { MonthKey } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import { coversOfBucket } from "./bucket-covers";

const october = "2026-10" as MonthKey;
const september = "2026-09" as MonthKey;

const move = (
	id: string,
	fromBucketId: string | null,
	toBucketId: string,
	amount = 4_000,
	month = october,
): PlanMove => ({ id, fromBucketId, toBucketId, amount, month });

describe("a Bucket's Covers for a month", () => {
	test("money that came into it from another Bucket", () => {
		const cover = move("m1", "fun", "kids");
		expect(coversOfBucket([cover], "kids", october)).toEqual([
			{ move: cover, direction: "into", otherBucketId: "fun" },
		]);
	});

	test("money that went out of it to cover another Bucket", () => {
		const cover = move("m1", "fun", "kids");
		expect(coversOfBucket([cover], "fun", october)).toEqual([
			{ move: cover, direction: "out", otherBucketId: "kids" },
		]);
	});

	test("a Cover from Free to Spend is on the covered Bucket's page, with no Bucket on the other side", () => {
		const cover = move("m1", null, "kids");
		expect(coversOfBucket([cover], "kids", october)).toEqual([
			{ move: cover, direction: "into", otherBucketId: null },
		]);
		expect(coversOfBucket([cover], "fun", october)).toEqual([]);
	});

	test("Covers between other Buckets are left out", () => {
		expect(coversOfBucket([move("m1", "fun", "kids")], "groceries", october)).toEqual([]);
	});

	test("another month's Covers are left out", () => {
		const moves = [move("m1", "fun", "kids", 4_000, september), move("m2", "fun", "kids", 1_500)];
		expect(coversOfBucket(moves, "kids", october).map((c) => c.move.id)).toEqual(["m2"]);
		expect(coversOfBucket(moves, "fun", september).map((c) => c.move.id)).toEqual(["m1"]);
	});

	test("an undone Cover, gone from the month's Moves, is no longer listed", () => {
		const moves = [move("m1", "fun", "kids"), move("m2", null, "kids", 2_000)];
		const afterUndo = moves.filter((m) => m.id !== "m1");
		expect(coversOfBucket(afterUndo, "kids", october).map((c) => c.move.id)).toEqual(["m2"]);
		expect(coversOfBucket(afterUndo, "fun", october)).toEqual([]);
	});

	test("both sides are listed in the order they happened", () => {
		const moves = [
			move("m1", "fun", "kids"),
			move("m2", "kids", "groceries"),
			move("m3", null, "kids"),
		];
		expect(coversOfBucket(moves, "kids", october).map((c) => [c.move.id, c.direction])).toEqual([
			["m1", "into"],
			["m2", "out"],
			["m3", "into"],
		]);
	});
});
