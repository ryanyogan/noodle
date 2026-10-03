import { parseChangePreset } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { exploreTriesFor, type InsightItem } from "./insights";

const current = "2026-09";
const insight = (
	kind: InsightItem["kind"],
	commitments: InsightItem["commitments"],
	amounts: number[] = [],
): Pick<InsightItem, "kind" | "commitments" | "transactions"> => ({
	kind,
	commitments,
	transactions: amounts.map((amount, i) => ({
		id: `t${i}`,
		date: "2026-09-01",
		amount,
		note: null,
		merchantName: null,
	})),
});
const disney = { id: "disney", name: "Disney+", endedFromMonth: null };
const hulu = { id: "hulu", name: "Hulu", endedFromMonth: null };

describe("exploreTriesFor", () => {
	it("tries an Overlap as ending each of its Commitments still in the Plan", () => {
		const ended = { ...hulu, endedFromMonth: "2026-09" };
		expect(exploreTriesFor(insight("duplicate-service", [disney, hulu]), current)).toEqual([
			{ name: "Without Disney+", preset: "end-commitment:disney:2026-09" },
			{ name: "Without Hulu", preset: "end-commitment:hulu:2026-09" },
		]);
		expect(exploreTriesFor(insight("duplicate-service", [disney, ended]), current)).toEqual([
			{ name: "Without Disney+", preset: "end-commitment:disney:2026-09" },
		]);
	});

	it("tries a Commitment not charged lately as ending it", () => {
		expect(exploreTriesFor(insight("unused", [hulu]), current)).toEqual([
			{ name: "Without Hulu", preset: "end-commitment:hulu:2026-09" },
		]);
	});

	it("tries a price increase as the Commitment at its latest charge", () => {
		const tries = exploreTriesFor(insight("price-increase", [hulu], [1_999, 1_799]), current);
		expect(tries).toEqual([
			{ name: "Hulu at $19.99", preset: "commitment-terms:hulu:1999:2026-09" },
		]);
		// Explore reads it back as the same Change.
		expect(parseChangePreset(tries[0]?.preset ?? "", current)).toEqual({
			kind: "commitment-terms",
			commitmentId: "hulu",
			amount: 1_999,
			fromMonth: current,
		});
	});

	it("has nothing to try for the same charge twice, or a merchant's price", () => {
		expect(exploreTriesFor(insight("duplicate-charge", [hulu], [1_799, 1_799]), current)).toEqual(
			[],
		);
		expect(exploreTriesFor(insight("price-increase", [], [1_999, 1_799]), current)).toEqual([]);
	});
});
