import type { DraftBucket, DraftCommitment } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import { setupInstanceId } from "./server/setup-run";
import { type SetupAnswers, type SetupBill, type SetupBucket, setupUnsaved } from "./setup";
import { mergeDraftBills, startingBills } from "./setup-bills";
import { mergeDraftBuckets, startingBuckets } from "./starter-buckets";

const bill = (over: Partial<SetupBill> = {}): SetupBill => ({
	key: "rent",
	id: "c1",
	name: "Mortgage or rent",
	amountCents: 150_000,
	cadence: "monthly",
	dueDay: 1,
	ticked: true,
	...over,
});
const bucket = (over: Partial<SetupBucket> = {}): SetupBucket => ({
	key: "groceries",
	id: "b1",
	name: "Groceries",
	amountCents: 80_000,
	rolling: false,
	personal: false,
	kept: true,
	...over,
});
const answers: SetupAnswers = {
	path: "hand",
	takeHomePayCents: 500_000,
	bills: [bill(), bill({ key: "phone", id: "c2", name: "Phone", ticked: false })],
	buckets: [bucket(), bucket({ key: "mine", id: "b2", name: "Alex’s money", personal: true })],
};

describe("what Done checks before finishing", () => {
	test("nothing is unsaved when every answer is on the Plan", () => {
		const plan = {
			baseline: 500_000,
			commitments: [{ id: "c1", name: "Mortgage or rent" }],
			buckets: [{ id: "b1", name: "Groceries" }],
		};
		expect(setupUnsaved(answers, plan)).toEqual([]);
	});

	test("names the steps whose answers are missing from the Plan", () => {
		expect(setupUnsaved(answers, { baseline: null, commitments: [], buckets: [] })).toEqual([
			2, 3, 4,
		]);
	});

	test("an item the Plan already had under the same name counts as there", () => {
		const plan = {
			baseline: 500_000,
			commitments: [{ id: "other", name: "mortgage or rent " }],
			buckets: [{ id: "other", name: "GROCERIES" }],
		};
		expect(setupUnsaved(answers, plan)).toEqual([]);
	});

	test("skipped steps, unticked bills and yearly bills aren't asked for", () => {
		expect(
			setupUnsaved({ path: "hand" }, { baseline: null, commitments: [], buckets: [] }),
		).toEqual([]);
		const yearly = { ...answers, bills: [bill({ cadence: "annual" })] };
		expect(
			setupUnsaved(yearly, { baseline: 1, commitments: [], buckets: [{ id: "b1", name: "x" }] }),
		).toEqual([]);
	});
});

test("each run of setup gets its own Workflow instance; the first keeps the old id", () => {
	expect(setupInstanceId("h1")).toBe("setup-h1");
	expect(setupInstanceId("h1", 0)).toBe("setup-h1");
	expect(setupInstanceId("h1", 2)).toBe("setup-h1-2");
});

describe("suggestions that arrive after a step was saved", () => {
	const format = (cents: number) => String(cents / 100);

	test("fill a saved bill nobody typed in, and leave a typed one alone", () => {
		const saved = [
			bill({
				key: "phone",
				id: "c2",
				name: "Phone",
				amountCents: 0,
				ticked: false,
				touched: false,
			}),
			bill({ key: "own-1", id: "c3", name: "Netflix", amountCents: 1500, touched: true }),
		];
		const draft = [
			{ key: "d1", name: "Phone", merchant: "Verizon", description: "", amount: 8000 },
			{ key: "d2", name: "Netflix", merchant: "Netflix", description: "", amount: 1999 },
		].map((found) => ({ ...found, cadence: "monthly", dueDate: "2026-10-12" }));
		const rows = mergeDraftBills(
			startingBills(saved, format),
			draft as unknown as DraftCommitment[],
			format,
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ ticked: true, amountCents: 8000, dueDay: 12, suggested: true });
		expect(rows[1]).toMatchObject({ name: "Netflix", amountCents: 1500, suggested: false });
	});

	test("fill a saved Bucket nobody typed in, and leave a typed one alone", () => {
		const saved = [
			bucket({ amountCents: 99_000, touched: false }),
			bucket({ key: "gas", id: "b3", name: "Fuel", amountCents: 20_000, touched: true }),
		];
		const draft = [
			{ key: "k1", name: "Groceries", allowance: 76_000 },
			{ key: "k2", name: "Fuel", allowance: 30_000 },
		];
		const rows = mergeDraftBuckets(
			startingBuckets(saved, "Alex", format),
			draft as unknown as DraftBucket[],
			format,
		);
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({ amountCents: 76_000, suggested: "spending" });
		expect(rows[1]).toMatchObject({ name: "Fuel", amountCents: 20_000, suggested: null });
	});

	test("a row saved before this was tracked counts as typed", () => {
		expect(startingBills([bill()], format)[0]?.touched).toBe(true);
		expect(startingBuckets([bucket()], "Alex", format)[0]?.touched).toBe(true);
	});
});
