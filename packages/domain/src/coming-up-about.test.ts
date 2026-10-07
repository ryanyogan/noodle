import { describe, expect, it } from "vitest";
import { comingUp, type PlanRecords } from "./index";

// Coming up knows which bills vary (issue 135), so a row can say "About".

const records: Pick<PlanRecords, "commitments" | "commitmentTerms"> = {
	commitments: [
		{ id: "power", name: "Power", fromMonth: "2026-01", endedFromMonth: null, about: true },
		{ id: "rent", name: "Rent", fromMonth: "2026-01", endedFromMonth: null },
	],
	commitmentTerms: [
		{
			commitmentId: "power",
			month: "2026-01",
			amount: 14_000,
			cadence: "monthly",
			dueDate: "2026-01-15",
		},
		{
			commitmentId: "rent",
			month: "2026-01",
			amount: 200_000,
			cadence: "monthly",
			dueDate: "2026-01-20",
		},
	],
};

describe("Coming up for a bill that varies", () => {
	it("marks an about Commitment's due date, and no other", () => {
		const dues = comingUp(records, [], "2026-10-01", 30);
		expect(dues.map((due) => [due.name, due.amount, due.about])).toEqual([
			["Power", 14_000, true],
			["Rent", 200_000, undefined],
		]);
		expect("about" in (dues[1] ?? {})).toBe(false);
	});
});

// A bill that varies is paid by its charge, whatever the charge came to (review of issue 135).
describe("Coming up for a bill that varies, once its charge is in", () => {
	const power = (charges: Parameters<typeof comingUp>[1]) =>
		comingUp(records, charges, "2026-10-01", 30).find((due) => due.name === "Power");

	it("is paid when the charge came in under what the Plan sets aside", () => {
		expect(
			power([{ commitmentId: "power", amount: 12_500 as never, date: "2026-10-14" }]),
		).toMatchObject({ status: "paid", paid: 12_500, amount: 14_000 });
	});

	it("is paid when the charge came in over, and says what it came to", () => {
		expect(
			power([{ commitmentId: "power", amount: 17_500 as never, date: "2026-10-16" }]),
		).toMatchObject({ status: "paid", paid: 17_500 });
	});

	it("is still due with no charge, or with only money Paid back", () => {
		expect(power([])).toMatchObject({ status: "due", paid: 0 });
		expect(
			power([
				{ commitmentId: "power", amount: -2_000 as never, date: "2026-10-03", paidBack: true },
			]),
		).toMatchObject({ status: "due", paid: 0 });
	});

	it("is still due when the charge was last month's", () => {
		expect(
			power([{ commitmentId: "power", amount: 12_500 as never, date: "2026-09-14" }]),
		).toMatchObject({ status: "due", paid: 0 });
	});

	it("leaves a bill that is the same each time partly paid by part of it", () => {
		const dues = comingUp(
			records,
			[{ commitmentId: "rent", amount: 50_000 as never, date: "2026-10-02" }],
			"2026-10-01",
			30,
		);
		expect(dues.find((due) => due.name === "Rent")).toMatchObject({
			status: "partly-paid",
			paid: 50_000,
		});
	});
});
