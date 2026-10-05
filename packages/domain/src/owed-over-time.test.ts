import { describe, expect, it } from "vitest";
import { owedOn, owedOverTime } from "./goals";
import type { DayKey } from "./month";

// What was owed over time on a card or loan a Commitment pays down (issue 93, ADR-0050).

const day = (d: string) => d as DayKey;
const balances = [
	{ amount: 200_000, day: day("2026-10-01") },
	{ amount: 150_000, day: day("2026-11-03") },
];
const payments = [
	{ amount: 25_000, date: day("2026-11-03") },
	{ amount: 50_000, date: day("2026-10-09") },
	{ amount: 10_000, date: day("2026-10-01") },
	{ amount: 26_000, date: day("2026-10-20") },
	{ amount: 40_000, date: day("2026-11-10") },
];

describe("owedOverTime", () => {
	it("takes each later payment off the balance before it, until the next balance", () => {
		expect(owedOverTime(balances, payments, false)).toEqual([
			{ amount: 200_000, day: "2026-10-01" },
			{ amount: 150_000, day: "2026-10-09" },
			{ amount: 124_000, day: "2026-10-20" },
			{ amount: 150_000, day: "2026-11-03" },
			{ amount: 110_000, day: "2026-11-10" },
		]);
	});

	it("leaves a payment on a balance's own day in that balance", () => {
		const points = owedOverTime([{ amount: 200_000, day: day("2026-10-01") }], payments, false);
		expect(points.map((p) => p.day)).not.toContain("2026-10-01".concat("x"));
		expect(points.filter((p) => p.day === "2026-10-01")).toEqual([
			{ amount: 200_000, day: "2026-10-01" },
		]);
	});

	it("ends on what's owed now", () => {
		const latest = balances.at(-1) ?? null;
		expect(owedOverTime(balances, payments, false).at(-1)?.amount).toBe(
			owedOn(latest, payments, false),
		);
	});

	it("is only the bank's balances for a connected Account", () => {
		expect(owedOverTime(balances, payments, true)).toEqual(balances);
	});

	it("is empty without a balance", () => {
		expect(owedOverTime([], payments, false)).toEqual([]);
	});
});
