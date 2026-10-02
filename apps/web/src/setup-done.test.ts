import { describe, expect, test } from "vitest";
import { setupInstanceId } from "./server/setup-run";
import { type SetupAnswers, type SetupBill, type SetupBucket, setupUnsaved } from "./setup";

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
