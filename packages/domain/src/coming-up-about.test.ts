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
