import { describe, expect, it } from "vitest";
import {
	type AssignedTransaction,
	assignedParts,
	forTotals,
	monthState,
	type Plan,
	type Split,
	splitRemainder,
	splitsBalance,
} from "./index";

const plan: Plan = {
	month: "2026-09",
	baseline: 900_000,
	commitments: [
		{
			id: "daycare",
			name: "Daycare",
			amount: 120_000,
			cadence: "monthly",
			dueDate: "2026-09-01",
		},
	],
	buckets: [
		{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
		{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000, rolling: false },
	],
};

const split = (assignment: Split["assignment"], amount: number, ...forIds: string[]): Split => ({
	amount,
	assignment,
	for: forIds,
});

/** A $250 Costco trip. */
const costco = (splits: Split[]): AssignedTransaction => ({
	date: "2026-09-12",
	amount: 25_000,
	assignment: { bucketId: "groceries" },
	for: [],
	splits,
});

/** The month's inputs from some Transactions, as the server and optimistic edits build them. */
function inputs(transactions: AssignedTransaction[]) {
	const parts = transactions.map(assignedParts);
	return {
		spending: parts.flatMap((part) => part.spending),
		charges: parts.flatMap((part) => part.charges),
	};
}

describe("splitRemainder and splitsBalance: Splits must add up to the Transaction", () => {
	it("says how much is left to assign, or how much too much", () => {
		expect(splitRemainder(25_000, [{ amount: 18_000 }])).toBe(7_000);
		expect(splitRemainder(25_000, [{ amount: 18_000 }, { amount: 7_000 }])).toBe(0);
		expect(splitRemainder(25_000, [{ amount: 18_000 }, { amount: 9_000 }])).toBe(-2_000);
	});

	it.each([
		["add up", [18_000, 7_000], true],
		["leave some unassigned", [18_000, 6_000], false],
		["take too much", [18_000, 9_000], false],
		["are just one", [25_000], false],
		["include nothing", [25_000, 0], false],
		["include a negative", [26_000, -1_000], false],
	] as const)("Splits that %s balance: %s", (_, amounts, expected) => {
		expect(
			splitsBalance(
				25_000,
				amounts.map((amount) => ({ amount })),
			),
		).toBe(expected);
	});
});

describe("assignedParts: what a Transaction adds to its month", () => {
	it("adds a whole Transaction to its one assignment, For its Members", () => {
		expect(assignedParts({ ...costco([]), for: ["leo"] })).toEqual({
			spending: [{ bucketId: "groceries", amount: 25_000, date: "2026-09-12", for: ["leo"] }],
			charges: [],
			goalSpending: [],
		});
	});

	it("adds each Split instead of the whole assignment", () => {
		const parts = assignedParts(
			costco([
				split({ bucketId: "groceries" }, 18_000),
				split({ bucketId: "hockey" }, 5_000, "leo"),
				split({ commitmentId: "daycare" }, 2_000, "maya"),
			]),
		);
		expect(parts.spending).toEqual([
			{ bucketId: "groceries", amount: 18_000, date: "2026-09-12", for: [] },
			{ bucketId: "hockey", amount: 5_000, date: "2026-09-12", for: ["leo"] },
		]);
		expect(parts.charges).toEqual([{ commitmentId: "daycare", amount: 2_000, date: "2026-09-12" }]);
	});

	it("counts Splits paying the same Commitment as one charge", () => {
		const parts = assignedParts(
			costco([
				split({ commitmentId: "daycare" }, 20_000, "leo"),
				split({ commitmentId: "daycare" }, 5_000, "maya"),
			]),
		);
		expect(parts.charges).toEqual([
			{ commitmentId: "daycare", amount: 25_000, date: "2026-09-12" },
		]);
	});

	it("adds nothing for a Transaction with no assignment and no Splits", () => {
		expect(assignedParts({ ...costco([]), assignment: null })).toEqual({
			spending: [],
			charges: [],
			goalSpending: [],
		});
	});

	it("takes a Split assigned to a Goal from its Earmark, never a Bucket or the month", () => {
		const parts = assignedParts(
			costco([
				split({ bucketId: "groceries" }, 15_000),
				split({ goalId: "vacation" }, 6_000, "leo"),
				split({ goalId: "vacation" }, 4_000),
			]),
		);
		expect(parts.spending).toEqual([
			{ bucketId: "groceries", amount: 15_000, date: "2026-09-12", for: [] },
		]);
		expect(parts.charges).toEqual([]);
		expect(parts.goalSpending).toEqual([
			{ goalId: "vacation", amount: 6_000, date: "2026-09-12" },
			{ goalId: "vacation", amount: 4_000, date: "2026-09-12" },
		]);
		const state = monthState({ plan, spending: parts.spending, asOf: "2026-09-15" });
		const without = monthState({ plan, spending: [], asOf: "2026-09-15" });
		expect(state.freeToSpend).toBe(without.freeToSpend);
		expect(state.leftInBuckets).toBe(without.leftInBuckets - 15_000);
	});
});

describe("Splits in the month's state and per-Member totals", () => {
	const splitCostco = costco([
		split({ bucketId: "groceries" }, 18_000),
		split({ bucketId: "hockey" }, 7_000, "leo"),
	]);

	it("spends each Split from its own Bucket", () => {
		const state = monthState({ plan, ...inputs([splitCostco]), asOf: "2026-09-15" });
		expect(state.buckets.map((b) => [b.id, b.spent, b.left])).toEqual([
			["groceries", 18_000, 102_000],
			["hockey", 7_000, 33_000],
		]);
		expect(state.leftInBuckets).toBe(135_000);
	});

	it("counts a Split paying a Commitment toward its actual", () => {
		const state = monthState({
			plan,
			...inputs([
				costco([
					split({ bucketId: "groceries" }, 5_000),
					split({ commitmentId: "daycare" }, 20_000),
				]),
			]),
			asOf: "2026-09-15",
		});
		expect(state.commitments[0]).toMatchObject({ actual: 20_000, charges: 1 });
		expect(state.buckets[0]?.spent).toBe(5_000);
	});

	it("credits each Split to its own Members, and the rest to the Household", () => {
		const totals = forTotals(inputs([splitCostco]).spending);
		expect(totals.household).toEqual({ total: 18_000, buckets: { groceries: 18_000 } });
		expect(totals.members).toEqual({ leo: { total: 7_000, buckets: { hockey: 7_000 } } });
	});

	it("goes back to the whole assignment once the Splits are removed", () => {
		const whole = { ...splitCostco, splits: [], for: ["maya"] };
		const state = monthState({ plan, ...inputs([whole]), asOf: "2026-09-15" });
		expect(state.buckets.map((b) => b.spent)).toEqual([25_000, 0]);
		expect(forTotals(inputs([whole]).spending).members).toEqual({
			maya: { total: 25_000, buckets: { groceries: 25_000 } },
		});
	});
});
