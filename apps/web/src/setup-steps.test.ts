import type { DraftBucket, DraftCommitment, MonthKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { setupAnswersSchema } from "./setup";
import {
	billsMonthly,
	dueDateFor,
	mergeDraftBills,
	planBillWrites,
	startingBills,
} from "./setup-bills";
import {
	bucketsTotal,
	mergeDraftBuckets,
	planBucketWrites,
	scaleBuckets,
	startingBuckets,
} from "./starter-buckets";

const format = (cents: number) => String(cents / 100);
const strip = <T extends { amount: string; touched: boolean; suggested: unknown }>(row: T) => {
	const { amount: _a, touched: _t, suggested: _s, ...rest } = row;
	return rest;
};

const netflix = {
	key: "netflix",
	name: "Netflix",
	merchant: "NETFLIX.COM",
	description: "NETFLIX.COM",
	amount: 1599,
	cadence: "monthly",
	dueDate: "2026-09-12",
	transactionIds: [],
} as unknown as DraftCommitment;

describe("the wizard's bills", () => {
	it("starts with the common bills, unticked", () => {
		const rows = startingBills(undefined, format);
		expect(rows.map((row) => row.name)).toEqual([
			"Mortgage or rent",
			"Utilities",
			"Phone",
			"Internet",
			"Car payment",
			"Insurance",
			"Daycare",
			"Streaming",
		]);
		expect(rows.every((row) => !row.ticked)).toBe(true);
	});

	it("fills a common bill from a detected Commitment, once, and leaves typed rows alone", () => {
		const rows = startingBills(undefined, format).map((row) =>
			row.key === "streaming"
				? { ...row, ticked: true, amount: "20", amountCents: 2000, touched: true }
				: row,
		);
		const merged = mergeDraftBills(rows, [netflix], format);
		// Streaming was typed in, so Netflix gets a row of its own.
		expect(merged.find((row) => row.key === "streaming")?.amountCents).toBe(2000);
		const own = merged.find((row) => row.draftKey === "netflix");
		expect(own).toMatchObject({ name: "Netflix", ticked: true, amountCents: 1599, dueDay: 12 });
		expect(mergeDraftBills(merged, [netflix], format)).toHaveLength(merged.length);

		const untouched = mergeDraftBills(startingBills(undefined, format), [netflix], format);
		expect(untouched).toHaveLength(8);
		expect(untouched.find((row) => row.key === "streaming")).toMatchObject({
			ticked: true,
			suggested: true,
			amountCents: 1599,
		});
	});

	it("adds once, then only updates what changed, and ends what was unticked", () => {
		const rows = startingBills(undefined, format).map(strip);
		const rent = { ...rows[0], ticked: true, amountCents: 150000 } as (typeof rows)[number];
		const first = planBillWrites(undefined, [rent, ...rows.slice(1)], []);
		expect(first.add.map((bill) => bill.name)).toEqual(["Mortgage or rent"]);
		expect(first.update).toEqual([]);

		const again = planBillWrites(first.rows, first.rows, []);
		expect([again.add, again.update, again.end, again.accept]).toEqual([[], [], [], []]);

		const raised = first.rows.map((bill) =>
			bill.key === "housing" ? { ...bill, amountCents: 160000 } : bill,
		);
		expect(planBillWrites(first.rows, raised, []).update).toHaveLength(1);

		const unticked = first.rows.map((bill) => ({ ...bill, ticked: false }));
		const ended = planBillWrites(first.rows, unticked, []);
		expect(ended.end).toEqual([rent.id]);
		// Ticking it again later makes a new Commitment, not the ended one.
		expect(ended.rows[0]?.id).not.toBe(rent.id);
	});

	it("updates a Commitment the Plan already has by that name instead of adding one", () => {
		const rows = startingBills(undefined, format).map(strip);
		const phone = { ...rows[2], ticked: true, amountCents: 8000 } as (typeof rows)[number];
		const writes = planBillWrites(undefined, [phone], [{ id: "existing", name: "phone" }]);
		expect(writes.add).toEqual([]);
		expect(writes.update.map((bill) => bill.id)).toEqual(["existing"]);
		expect(writes.rows[0]?.id).toBe("existing");
	});

	it("totals a month and clamps the due day to the month", () => {
		expect(
			billsMonthly([
				{ ticked: true, amountCents: 1200, cadence: "annual" },
				{ ticked: true, amountCents: 600, cadence: "biweekly" },
				{ ticked: false, amountCents: 999, cadence: "monthly" },
			]),
		).toBe(100 + 1300);
		expect(dueDateFor({ dueDay: 31 }, "2026-02" as MonthKey)).toBe("2026-02-28");
		expect(dueDateFor({ dueDay: 12, dueDate: "2026-09-12" }, "2026-10" as MonthKey)).toBe(
			"2026-09-12",
		);
	});
});

describe("the starter Buckets", () => {
	it("starts with the list, Gifts carrying over, and one Personal Allowance", () => {
		const rows = startingBuckets(undefined, "Alex", format);
		expect(rows.map((row) => row.name)).toEqual([
			"Groceries",
			"Dining out",
			"Gas",
			"Household",
			"Kids",
			"Fun",
			"Gifts",
			"Alex’s money",
		]);
		expect(rows.filter((row) => row.rolling).map((row) => row.name)).toEqual(["Gifts"]);
		expect(rows.filter((row) => row.personal)).toHaveLength(1);
	});

	it("scales amounts from what's left, in whole tens, leaving some unplanned", () => {
		const rows = scaleBuckets(startingBuckets(undefined, "Alex", format), 300000, format);
		expect(rows[0]).toMatchObject({ amountCents: 90000, amount: "900", suggested: "scaled" });
		expect(rows.every((row) => row.amountCents % 1000 === 0)).toBe(true);
		expect(bucketsTotal(rows)).toBeLessThan(300000);
		// Nothing left: no amounts.
		expect(bucketsTotal(scaleBuckets(startingBuckets(undefined, "Alex", format), 0, format))).toBe(
			0,
		);
	});

	it("takes the plan draft's amounts without overwriting what was typed", () => {
		const start = scaleBuckets(startingBuckets(undefined, "Alex", format), 300000, format);
		const typed = start.map((row) =>
			row.key === "dining" ? { ...row, amount: "50", amountCents: 5000, touched: true } : row,
		);
		const draft = [
			{ key: "b1", name: "Groceries", allowance: 64000 },
			{ key: "b2", name: "Dining out", allowance: 31000 },
			{ key: "b3", name: "Pets", allowance: 9000 },
		] as unknown as DraftBucket[];
		const merged = mergeDraftBuckets(typed, draft, format);
		expect(merged.find((row) => row.key === "groceries")).toMatchObject({
			amountCents: 64000,
			suggested: "spending",
		});
		expect(merged.find((row) => row.key === "dining")?.amountCents).toBe(5000);
		expect(merged.find((row) => row.name === "Pets")).toMatchObject({
			kept: true,
			amountCents: 9000,
		});
		expect(mergeDraftBuckets(merged, draft, format)).toHaveLength(merged.length);
	});

	it("adds once, then changes only what changed, and archives what was removed", () => {
		const rows = startingBuckets(undefined, "Alex", format).map(strip);
		const first = planBucketWrites(undefined, rows, [], "me");
		expect(first.add).toHaveLength(7);
		expect(first.addPersonal).toHaveLength(1);

		const again = planBucketWrites(first.rows, first.rows, [], "me");
		expect(Object.values({ ...again, rows: [] }).every((list) => list.length === 0)).toBe(true);

		const changed = first.rows.map((row) =>
			row.key === "gas"
				? { ...row, name: "Fuel", amountCents: 12000, rolling: true }
				: row.key === "fun"
					? { ...row, kept: false }
					: row,
		);
		const writes = planBucketWrites(first.rows, changed, [], "me");
		expect(writes.add).toEqual([]);
		expect(writes.rename.map((row) => row.name)).toEqual(["Fuel"]);
		expect(writes.amount).toHaveLength(1);
		expect(writes.rolling).toHaveLength(1);
		expect(writes.archive).toEqual([rows.find((row) => row.key === "fun")?.id]);
	});

	it("reuses a Bucket the Plan has by name, and the Parent's own Personal Allowance", () => {
		const rows = startingBuckets(undefined, "Alex", format).map(strip);
		const writes = planBucketWrites(
			undefined,
			rows,
			[
				{ id: "g", name: "groceries", allowance: 0, rolling: false },
				{ id: "mine", name: "Alex", allowance: 0, rolling: false, owner: "me" },
				{ id: "theirs", name: "Sam", allowance: 0, rolling: false, owner: "them" },
			],
			"me",
		);
		expect(writes.add).toHaveLength(6);
		expect(writes.addPersonal).toEqual([]);
		expect(writes.rename.map((row) => row.id)).toEqual(["mine"]);
		expect(writes.rows.find((row) => row.key === "groceries")?.id).toBe("g");
	});
});

describe("saved answers", () => {
	it("accepts what the steps save", () => {
		const bills = startingBills(undefined, format).map(strip);
		const buckets = startingBuckets(undefined, "Alex", format).map(strip);
		expect(setupAnswersSchema.safeParse({ path: "hand", bills, buckets }).success).toBe(true);
	});
});
