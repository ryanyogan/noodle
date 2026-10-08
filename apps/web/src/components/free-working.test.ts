import { describe, expect, it } from "vitest";
import { freeLedgerRows } from "./free-working";

const bucket = (allowance: number, owner?: string) =>
	({ allowance, owner }) as unknown as Parameters<typeof freeLedgerRows>[0]["buckets"][number];

const state = (over: Partial<Parameters<typeof freeLedgerRows>[0]> = {}) => ({
	baseline: 500000,
	extraToFreeToSpend: 0,
	freeCarriedIn: 0,
	buckets: [bucket(120000), bucket(30000)],
	committed: 180000,
	fundedGoals: 0,
	movedToBuckets: 0,
	...over,
});

const sum = (rows: { amount: number }[]) => rows.reduce((total, row) => total + row.amount, 0);

describe("freeLedgerRows", () => {
	it("lists take-home pay, then Commitments and Buckets taken off, and nothing that is zero", () => {
		const rows = freeLedgerRows(state(), "September");
		expect(rows.map((r) => [r.label, r.amount])).toEqual([
			["Take-home pay", 500000],
			["Commitments", -180000],
			["Buckets", -150000],
		]);
		expect(sum(rows)).toBe(170000);
	});

	it("adds Extra income and what was carried over, and takes off every other part", () => {
		const rows = freeLedgerRows(
			state({
				extraToFreeToSpend: 20000,
				freeCarriedIn: 131000,
				buckets: [bucket(120000), bucket(15000, "parent")],
				fundedGoals: 15000,
				movedToBuckets: 5000,
			}),
			"September",
		);
		expect(rows.map((r) => [r.label, r.amount])).toEqual([
			["Take-home pay", 500000],
			["Extra income added", 20000],
			["Carried over from September", 131000],
			["Commitments", -180000],
			["Buckets", -120000],
			["Personal Allowances", -15000],
			["Goal funding", -15000],
			["Moved into Buckets", -5000],
		]);
		expect(sum(rows)).toBe(316000);
	});

	it("says a shortfall carried over as short, taken off", () => {
		const rows = freeLedgerRows(state({ freeCarriedIn: -23000 }), "September");
		expect(rows[1]).toEqual({
			key: "carried-over",
			label: "Short carried over from September",
			amount: -23000,
		});
	});

	it("keeps Commitments and Buckets even at nothing", () => {
		const rows = freeLedgerRows(state({ committed: 0, buckets: [] }), "September");
		expect(rows.map((r) => r.label)).toEqual(["Take-home pay", "Commitments", "Buckets"]);
	});
});
