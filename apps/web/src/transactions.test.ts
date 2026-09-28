import { forTotals, monthState } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import type { MonthData } from "./server/month";
import {
	type TransactionChange,
	type TransactionRow,
	withRowChange,
	withTransactionChange,
} from "./transactions";

const month: MonthData = {
	plan: {
		month: "2026-09",
		baseline: 500_000,
		commitments: [
			{
				id: "mortgage",
				name: "Mortgage",
				amount: 200_000,
				cadence: "monthly",
				dueDate: "2026-09-01",
			},
		],
		buckets: [
			{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000 },
			{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000 },
		],
	},
	spending: [
		{ id: "costco", bucketId: "groceries", amount: 18_642, date: "2026-09-13", for: [] },
		{ id: "skates", bucketId: "groceries", amount: 6_499, date: "2026-09-12", for: [] },
	],
	charges: [],
	moves: [],
	asOf: "2026-09-15",
	editable: true,
};

const skates: TransactionRow = {
	id: "skates",
	date: "2026-09-12",
	amountCents: 6_499,
	bucketId: "groceries",
	commitmentId: null,
	note: "Pro Hockey Life",
	for: [],
};

const change = (next: TransactionChange["next"]): TransactionChange => ({
	transaction: skates,
	label: "$64.99 (Pro Hockey Life)",
	next,
});

const spentIn = (data: MonthData) =>
	Object.fromEntries(monthState(data).buckets.map((b) => [b.id, b.spent]));

describe("withTransactionChange: editing reassigns spending in the month's state", () => {
	test("moving a Transaction to another Bucket moves its spending there", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 6_499,
				assignment: { bucketId: "hockey" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(month)).toEqual({ groceries: 25_141, hockey: 0 });
		expect(spentIn(edited)).toEqual({ groceries: 18_642, hockey: 6_499 });
		// Moving spending between Buckets doesn't change Free to Spend.
		expect(monthState(edited).freeToSpend).toBe(monthState(month).freeToSpend);
		expect(monthState(edited).leftInBuckets).toBe(monthState(month).leftInBuckets);
	});

	test("changing the amount changes what its Bucket has spent", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 5_000,
				assignment: { bucketId: "groceries" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(edited)).toEqual({ groceries: 23_642, hockey: 0 });
	});

	test("deleting a Transaction takes its spending out", () => {
		expect(spentIn(withTransactionChange(month, change(null)))).toEqual({
			groceries: 18_642,
			hockey: 0,
		});
	});

	test("assigning it to a Commitment moves it from the Bucket to that Commitment", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 6_499,
				assignment: { commitmentId: "mortgage" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(edited)).toEqual({ groceries: 18_642, hockey: 0 });
		expect(monthState(edited).commitments[0]?.actual).toBe(6_499);
	});

	test("changing who it was For moves it between Members' totals", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 6_499,
				assignment: { bucketId: "hockey" },
				note: null,
				forMemberIds: ["leo"],
			}),
		);
		expect(forTotals(edited.spending).members.leo).toEqual({
			total: 6_499,
			buckets: { hockey: 6_499 },
		});
		expect(forTotals(edited.spending).household.total).toBe(18_642);
	});

	test("editing twice lands once", () => {
		const next = {
			amountCents: 6_499,
			assignment: { bucketId: "hockey" },
			note: null,
			forMemberIds: [],
		};
		const once = withTransactionChange(month, change(next));
		expect(withTransactionChange(once, change(next)).spending).toHaveLength(2);
	});
});

describe("withRowChange: the list shows the change", () => {
	const list = {
		pageParams: [undefined],
		pages: [{ transactions: [skates], next: null }],
	};

	test("updates the row in place", () => {
		const edited = withRowChange(
			list,
			change({
				amountCents: 7_000,
				assignment: { bucketId: "hockey" },
				note: "Skates",
				forMemberIds: ["leo"],
			}),
		);
		expect(edited.pages[0]?.transactions[0]).toEqual({
			...skates,
			amountCents: 7_000,
			bucketId: "hockey",
			note: "Skates",
			for: ["leo"],
		});
	});

	test("drops a deleted row", () => {
		expect(withRowChange(list, change(null)).pages[0]?.transactions).toEqual([]);
	});
});
