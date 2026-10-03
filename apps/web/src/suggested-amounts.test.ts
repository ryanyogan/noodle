import { describe, expect, test } from "vitest";
import type { SetupBucket } from "./setup";
import { unappliedSuggestions } from "./suggested-amounts";

const bucket = (key: string, name: string, extra: Partial<SetupBucket> = {}): SetupBucket => ({
	key,
	id: `id-${key}`,
	name,
	amountCents: 0,
	rolling: false,
	personal: false,
	kept: true,
	touched: false,
	...extra,
});

const saved = [
	bucket("groceries", "Groceries"),
	bucket("dining", "Dining out"),
	bucket("fun", "Fun", { touched: true, amountCents: 5_000 }),
	bucket("personal", "Ryan’s Personal Allowance", { personal: true }),
];
const plan = [
	{ id: "id-groceries", allowance: 0 },
	{ id: "id-dining", allowance: 0 },
	{ id: "id-fun", allowance: 5_000 },
	{ id: "id-personal", allowance: 0 },
];

describe("Apply suggested amounts (#72)", () => {
	test("starter Buckets setup wrote before take-home pay get their share of what's left", () => {
		const found = unappliedSuggestions({
			answers: { buckets: saved },
			takeHomeCents: 400_000,
			plan,
			edited: new Set(),
		});
		expect(found).toEqual([
			{ bucketId: "id-groceries", name: "Groceries", fromCents: 0, toCents: 120_000 },
			{ bucketId: "id-dining", name: "Dining out", fromCents: 0, toCents: 32_000 },
		]);
	});

	test("what's left is after the wizard's ticked bills", () => {
		const found = unappliedSuggestions({
			answers: {
				buckets: [saved[0] as SetupBucket],
				bills: [
					{
						key: "rent",
						id: "rent",
						name: "Rent",
						amountCents: 200_000,
						cadence: "monthly",
						dueDay: 1,
						ticked: true,
					},
				],
			},
			takeHomeCents: 400_000,
			plan,
			edited: new Set(),
		});
		expect(found[0]?.toCents).toBe(60_000);
	});

	test("a Bucket edited since, or no longer at setup's amount, is never changed", () => {
		const found = unappliedSuggestions({
			answers: { buckets: saved },
			takeHomeCents: 400_000,
			plan: [
				{ id: "id-groceries", allowance: 0 },
				{ id: "id-dining", allowance: 25_000 },
			],
			edited: new Set(["id-groceries"]),
		});
		expect(found).toEqual([]);
	});

	test("nothing without take-home pay, typed rows, plan-draft rows or older saves", () => {
		const base = { plan, edited: new Set<string>() };
		expect(
			unappliedSuggestions({ ...base, answers: { buckets: saved }, takeHomeCents: null }),
		).toEqual([]);
		const others = [
			bucket("groceries", "Groceries", { draftKey: "d1" }),
			bucket("dining", "Dining out", { touched: undefined }),
		];
		expect(
			unappliedSuggestions({ ...base, answers: { buckets: others }, takeHomeCents: 400_000 }),
		).toEqual([]);
	});

	test("once applied, the amount differs from setup's and the Bucket drops out", () => {
		const found = unappliedSuggestions({
			answers: { buckets: [saved[0] as SetupBucket] },
			takeHomeCents: 400_000,
			plan: [{ id: "id-groceries", allowance: 120_000 }],
			edited: new Set(["id-groceries"]),
		});
		expect(found).toEqual([]);
	});
});
