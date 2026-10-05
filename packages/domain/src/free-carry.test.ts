import { describe, expect, it } from "vitest";
import {
	type CarryInputs,
	firstCarryMonth,
	freeCarriedIn,
	freeCarryMonths,
	type MonthKey,
	monthState,
	type PlanRecords,
	planForMonth,
	planHealth,
	yearGrid,
} from "./index";

// Take-home pay $5,000 from August 2026 with a $4,400 Bucket: each month's own figure is $600.
// From November the Bucket is $5,012.20, so November's own figure is −$12.20 (the Parent's case).
const records: PlanRecords = {
	baselines: [{ month: "2026-08", amount: 500_000 }],
	buckets: [
		{
			id: "fun",
			name: "Fun",
			color: 1,
			position: 0,
			fromMonth: "2026-08",
			archivedFromMonth: null,
			owner: null,
		},
	],
	allowances: [
		{ bucketId: "fun", month: "2026-08", amount: 440_000 },
		{ bucketId: "fun", month: "2026-11", amount: 501_220 },
	],
	rolling: [],
	commitments: [],
	commitmentTerms: [],
};
const none: Pick<CarryInputs, "actual" | "incomeReceived" | "outOfFree" | "extraToFree"> = {
	actual: [],
	incomeReceived: [],
	outOfFree: [],
	extraToFree: [],
};
/** Income was received in every month given an actual, unless the test says which months had any. */
const received = (actual: CarryInputs["actual"]) =>
	actual.map(({ month }) => ({ month, amount: 1 }));
const walk = (current: MonthKey, to: MonthKey, inputs: Partial<typeof none> = {}) =>
	freeCarryMonths({
		records,
		current,
		...none,
		incomeReceived: received(inputs.actual ?? []),
		...inputs,
		to,
	});

describe("Free to Spend carried over (issue 113)", () => {
	it("starts at the first month with a Plan, which is carried nothing", () => {
		expect(firstCarryMonth(records, "2026-10")).toBe("2026-08");
		expect(firstCarryMonth(records, "2026-07")).toBeNull();
		expect(walk("2026-08", "2026-08")).toEqual([
			{ month: "2026-08", ended: false, carriedIn: 0, own: 60_000, left: 60_000 },
		]);
		expect(freeCarriedIn({ records, current: "2026-08", ...none, month: "2026-08" })).toBe(0);
	});

	it("ignores months before the first Plan, whatever happened in them", () => {
		const months = walk("2026-10", "2026-10", {
			actual: [
				{ month: "2026-05", amount: 900_000 },
				{ month: "2026-07", amount: -300_000 },
				{ month: "2026-08", amount: 10_000 },
				{ month: "2026-09", amount: 20_000 },
			],
		});
		expect(months.map((m) => m.month)).toEqual(["2026-08", "2026-09", "2026-10"]);
		expect(months[2]).toMatchObject({ carriedIn: 30_000, left: 90_000 });
	});

	it("carries a surplus into the next month", () => {
		const carried = freeCarriedIn({
			records,
			current: "2026-10",
			...none,
			actual: [
				{ month: "2026-08", amount: 60_000 },
				{ month: "2026-09", amount: 60_000 },
			],
			incomeReceived: [
				{ month: "2026-08", amount: 500_000 },
				{ month: "2026-09", amount: 500_000 },
			],
			month: "2026-10",
		});
		expect(carried).toBe(120_000);
	});

	it("carries a shortfall too, and it stays until a later month makes it up", () => {
		const months = walk("2026-10", "2026-10", {
			actual: [
				{ month: "2026-08", amount: -100_000 },
				{ month: "2026-09", amount: 25_000 },
			],
		});
		expect(months.map((m) => [m.carriedIn, m.left])).toEqual([
			[0, -100_000],
			[-100_000, -75_000],
			[-75_000, -15_000],
		]);
	});

	it("an ended month hands on what it actually ended with, not what its Plan left", () => {
		// September's Plan leaves $600, but $900 more was spent than planned: it ended $300 short.
		const months = walk("2026-10", "2026-10", {
			actual: [
				{ month: "2026-08", amount: 60_000 },
				{ month: "2026-09", amount: -30_000 },
			],
			// An ended month's Moves are already in its actual: they are not counted again.
			outOfFree: [{ month: "2026-09", amount: 5_000 }],
		});
		expect(months[1]).toMatchObject({ ended: true, own: -30_000, left: 30_000 });
		expect(months[2]).toMatchObject({ ended: false, carriedIn: 30_000, own: 60_000 });
	});

	it("an ended month with no income recorded hands on only what it was carried", () => {
		// A Household that only uses Quick Add: $4,000 spent in September and no income recorded,
		// so its actual is −$4,000. It must not become a shortfall that grows every month.
		const actual = [
			{ month: "2026-08" as const, amount: 60_000 },
			{ month: "2026-09" as const, amount: -400_000 },
		];
		const quickAddOnly = walk("2026-10", "2026-10", {
			actual,
			incomeReceived: [{ month: "2026-08", amount: 500_000 }],
		});
		expect(quickAddOnly[1]).toMatchObject({ ended: true, carriedIn: 60_000, own: 0, left: 60_000 });
		expect(quickAddOnly[2]).toMatchObject({ carriedIn: 60_000, left: 120_000 });
		// With $1 of income recorded the month is on the books: it hands on its actual.
		const onTheBooks = walk("2026-10", "2026-10", {
			actual,
			incomeReceived: [
				{ month: "2026-08", amount: 500_000 },
				{ month: "2026-09", amount: 100 },
			],
		});
		expect(onTheBooks[1]).toMatchObject({ own: -400_000, left: -340_000 });
		// Income recorded and taken back out again (a total of zero) is no income.
		const netZero = walk("2026-10", "2026-10", {
			actual,
			incomeReceived: [
				{ month: "2026-08", amount: 500_000 },
				{ month: "2026-09", amount: 0 },
			],
		});
		expect(netZero[1]).toMatchObject({ own: 0, left: 60_000 });
	});

	it("the Household's month uses its Plan figure, with its Moves and Extra income", () => {
		const months = walk("2026-10", "2026-10", {
			actual: [{ month: "2026-08", amount: 60_000 }],
			outOfFree: [{ month: "2026-10", amount: 10_000 }],
			extraToFree: [{ month: "2026-10", amount: 4_000 }],
		});
		expect(months[2]).toMatchObject({ carriedIn: 60_000, own: 54_000, left: 114_000 });
		const state = monthState({
			plan: planForMonth(records, "2026-10"),
			spending: [],
			freeCarriedIn: months[2]?.carriedIn,
			asOf: "2026-10-05",
		});
		expect(state.freeToSpend).toBe(120_000);
		expect(state.freeCarriedIn).toBe(60_000);
	});

	it("months ahead chain: a month the ones before cover is neither short nor flagged", () => {
		const carry = walk("2026-10", "2026-10", {
			actual: [
				{ month: "2026-08", amount: 0 },
				{ month: "2026-09", amount: 0 },
			],
		});
		// October leaves $600; November on its own is −$12.20.
		expect(walk("2026-10", "2026-11").at(-1)).toMatchObject({ own: -1_220, left: 58_780 });
		const months = yearGrid({
			year: 2026,
			current: "2026-10",
			records,
			goals: [],
			actuals: { spending: [], income: [], goalFunding: [] },
			freeCarry: carry,
		});
		const at = (month: MonthKey) => months.find((m) => m.month === month);
		expect(at("2026-10")).toMatchObject({ carriedIn: 0, plan: { freeToSpend: 60_000 } });
		expect(at("2026-11")).toMatchObject({ carriedIn: 60_000, plan: { freeToSpend: 58_780 } });
		expect(at("2026-12")).toMatchObject({ carriedIn: 58_780, plan: { freeToSpend: 57_560 } });
		const health = (freeHandedOn?: number) =>
			planHealth({
				asOf: "2026-10-05",
				parentId: "alex",
				records: { ...records },
				goals: [],
				changes: [],
				income: [],
				spent: [],
				freeHandedOn,
			}).filter((w) => w.kind === "negative-ahead");
		expect(health(carry.at(-1)?.left)).toEqual([]);
		// On its own November would be flagged, and with a shortfall carried it is.
		expect(health()).toMatchObject([{ month: "2026-11", freeToSpend: -1_220 }]);
		expect(health(-50_000)).toMatchObject([{ month: "2026-11", freeToSpend: -51_220 }]);
	});
});
