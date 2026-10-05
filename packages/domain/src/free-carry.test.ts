import { describe, expect, it } from "vitest";
import {
	aboveKeepBack,
	freeCarriedIn,
	freeCarries,
	freeCarryMonths,
	freeCarrySince,
} from "./free-carry";
import type { MonthKey } from "./month";
import { monthState } from "./month-state";
import { type PlanRecords, planForMonth } from "./plan";

// Take-home pay $5,000, Groceries $1,000: every month ends with $4,000 in Free to Spend.
const plan = (extra: Partial<PlanRecords> = {}): PlanRecords => ({
	baselines: [{ month: "2026-01", amount: 5000_00 }],
	buckets: [
		{
			id: "groceries",
			name: "Groceries",
			color: 1,
			position: 0,
			fromMonth: "2026-01",
			archivedFromMonth: null,
		},
	],
	allowances: [{ bucketId: "groceries", month: "2026-01", amount: 1000_00 }],
	commitments: [],
	commitmentTerms: [],
	rolling: [],
	...extra,
});

const carriedInto = (records: PlanRecords, month: MonthKey, moves = {}) =>
	freeCarriedIn({ records, outOfFree: [], extraToFree: [], month, ...moves });

describe("Free to Spend that builds up", () => {
	it("starts fresh by default: nothing is carried, whatever earlier months left", () => {
		expect(carriedInto(plan(), "2026-06")).toBe(0);
		expect(freeCarrySince(plan(), "2026-06")).toBeNull();
		expect(freeCarries(plan(), "2026-06")).toBe(false);
		expect(carriedInto(plan({ freeCarries: [] }), "2026-06")).toBe(0);
	});

	it("carries what a month ended with into the next", () => {
		const records = plan({ freeCarries: [{ month: "2026-01", carries: true }] });
		expect(carriedInto(records, "2026-02")).toBe(4000_00);
	});

	it("builds up over several months", () => {
		const records = plan({ freeCarries: [{ month: "2026-01", carries: true }] });
		expect(carriedInto(records, "2026-04")).toBe(12000_00);
		expect(
			freeCarryMonths({
				records,
				outOfFree: [],
				extraToFree: [],
				from: "2026-01",
				to: "2026-03",
			}),
		).toEqual([
			{ month: "2026-01", carries: true, carriedIn: 0, left: 4000_00, carriedOut: 4000_00 },
			{ month: "2026-02", carries: true, carriedIn: 4000_00, left: 8000_00, carriedOut: 8000_00 },
			{
				month: "2026-03",
				carries: true,
				carriedIn: 8000_00,
				left: 12000_00,
				carriedOut: 12000_00,
			},
		]);
	});

	it("starts from the month a Parent turned it on: older months' leftovers are not pulled in", () => {
		const records = plan({ freeCarries: [{ month: "2026-03", carries: true }] });
		expect(freeCarrySince(records, "2026-03")).toBeNull();
		expect(carriedInto(records, "2026-03")).toBe(0);
		expect(freeCarrySince(records, "2026-05")).toBe("2026-03");
		expect(carriedInto(records, "2026-04")).toBe(4000_00);
		expect(carriedInto(records, "2026-05")).toBe(8000_00);
	});

	it("takes Covers from Free to Spend and Goal funding out before carrying", () => {
		const records = plan({ freeCarries: [{ month: "2026-01", carries: true }] });
		const outOfFree = [
			{ month: "2026-01" as const, amount: 300_00 },
			{ month: "2026-01" as const, amount: 200_00 },
			// Out of the month being asked about: no part of what's carried into it.
			{ month: "2026-02" as const, amount: 999_00 },
		];
		expect(carriedInto(records, "2026-02", { outOfFree })).toBe(3500_00);
	});

	it("carries Extra income a Parent left in an ended month's Free to Spend", () => {
		const records = plan({ freeCarries: [{ month: "2026-01", carries: true }] });
		const extraToFree = [{ month: "2026-01" as const, amount: 250_00 }];
		expect(carriedInto(records, "2026-02", { extraToFree })).toBe(4250_00);
		expect(carriedInto(records, "2026-03", { extraToFree })).toBe(8250_00);
	});

	it("carries nothing out of a month that ends below zero: the next starts clean", () => {
		const records = plan({
			freeCarries: [{ month: "2026-01", carries: true }],
			// February alone plans $9,000 into Groceries: $4,000 over, even with January's $4,000.
			allowances: [
				{ bucketId: "groceries", month: "2026-01", amount: 1000_00 },
				{ bucketId: "groceries", month: "2026-02", amount: 13500_00 },
				{ bucketId: "groceries", month: "2026-03", amount: 1000_00 },
			],
		});
		const months = freeCarryMonths({
			records,
			outOfFree: [],
			extraToFree: [],
			from: "2026-01",
			to: "2026-03",
		});
		expect(months[1]).toMatchObject({ carriedIn: 4000_00, left: -4500_00, carriedOut: 0 });
		expect(carriedInto(records, "2026-03")).toBe(0);
		// March is not charged February's shortfall, and builds up again from its own leftover.
		expect(carriedInto(records, "2026-04")).toBe(4000_00);
	});

	it("lets carried-in money absorb an over-planned month, carrying on what remains", () => {
		const records = plan({
			freeCarries: [{ month: "2026-01", carries: true }],
			allowances: [
				{ bucketId: "groceries", month: "2026-01", amount: 1000_00 },
				{ bucketId: "groceries", month: "2026-02", amount: 6000_00 },
			],
		});
		// February alone is −$1,000; with January's $4,000 it ends with $3,000.
		expect(carriedInto(records, "2026-03")).toBe(3000_00);
	});

	it("stops carrying from the month it's turned off, and keeps what earlier months built", () => {
		const records = plan({
			freeCarries: [
				{ month: "2026-01", carries: true },
				{ month: "2026-03", carries: false },
				{ month: "2026-05", carries: true },
			],
		});
		expect(carriedInto(records, "2026-02")).toBe(4000_00);
		expect(carriedInto(records, "2026-03")).toBe(8000_00);
		// March has it, and ends with it.
		expect(carriedInto(records, "2026-04")).toBe(0);
		expect(carriedInto(records, "2026-05")).toBe(0);
		// Turned on again in May: only May's own leftover, nothing from before.
		expect(freeCarrySince(records, "2026-06")).toBe("2026-05");
		expect(carriedInto(records, "2026-06")).toBe(4000_00);
	});

	it("counts a Commitment each time it's due in a month, not once", () => {
		const records = plan({
			freeCarries: [{ month: "2026-01", carries: true }],
			commitments: [{ id: "sitter", name: "Sitter", fromMonth: "2026-01", endedFromMonth: null }],
			// Biweekly from Jan 2: due Jan 2, 16 and 30, so January takes it three times.
			commitmentTerms: [
				{
					commitmentId: "sitter",
					month: "2026-01",
					amount: 100_00,
					cadence: "biweekly",
					dueDate: "2026-01-02",
				},
			],
		});
		expect(carriedInto(records, "2026-02")).toBe(3700_00);
	});
});

describe("the month's state", () => {
	const records = plan();

	it("is unchanged when nothing is carried in", () => {
		const state = monthState({
			plan: planForMonth(records, "2026-02"),
			spending: [],
			asOf: "2026-02-10",
		});
		expect(state.freeToSpend).toBe(4000_00);
		expect(state.freeCarriedIn).toBe(0);
	});

	it("adds what was carried in to Free to Spend", () => {
		const state = monthState({
			plan: planForMonth(records, "2026-02"),
			spending: [],
			goalFunding: [{ goalId: "trip", amount: 500_00, month: "2026-02" }],
			freeCarriedIn: 4000_00,
			asOf: "2026-02-10",
		});
		expect(state.freeCarriedIn).toBe(4000_00);
		expect(state.freeToSpend).toBe(7500_00);
	});

	it("ends each month with what the walk says it carries on", () => {
		const carrying = plan({ freeCarries: [{ month: "2026-01", carries: true }] });
		const february = monthState({
			plan: planForMonth(carrying, "2026-02"),
			spending: [],
			freeCarriedIn: carriedInto(carrying, "2026-02"),
			asOf: "2026-02-28",
		});
		expect(carriedInto(carrying, "2026-03")).toBe(february.freeToSpend);
	});
});

describe("keeping some back", () => {
	it("offers what's left above the kept-back amount", () => {
		expect(aboveKeepBack({ left: 412_00, keepBack: 100_00 })).toBe(312_00);
		expect(aboveKeepBack({ left: 412_00, keepBack: 0 })).toBe(412_00);
	});

	it("offers nothing at or below it, or from a month below zero", () => {
		expect(aboveKeepBack({ left: 100_00, keepBack: 100_00 })).toBe(0);
		expect(aboveKeepBack({ left: 40_00, keepBack: 100_00 })).toBe(0);
		expect(aboveKeepBack({ left: -50_00, keepBack: 0 })).toBe(0);
	});

	it("treats a kept-back amount below zero as none", () => {
		expect(aboveKeepBack({ left: 412_00, keepBack: -5 })).toBe(412_00);
	});
});
