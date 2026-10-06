import { type DraftCommitment, draftVaries } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import type { SetupBill } from "./setup";
import { mergeDraftBills, planBillWrites, startingBills } from "./setup-bills";

// Setup's Bills step offers "about" for a bill that varies (issue 135).

const format = (cents: number) => String(cents / 100);
const found = (name: string, description: string, about?: true): DraftCommitment => ({
	key: `commitment:${name.toLowerCase()}`,
	merchant: name.toLowerCase(),
	name,
	description,
	amount: 15_800,
	cadence: "monthly",
	dueDate: "2026-09-15",
	transactionIds: [],
	...(about ? { about } : {}),
});

describe("bills that vary in Setup", () => {
	it("starts Utilities as about, and no other common bill", () => {
		const about = startingBills(undefined, format).filter((row) => row.about);
		expect(about.map((row) => row.key)).toEqual(["utilities"]);
	});

	it("keeps what was saved, about or not", () => {
		const saved = startingBills(undefined, format).map(
			(row): SetupBill => ({ ...row, about: row.key === "phone" }),
		);
		const about = startingBills(saved, format).filter((row) => row.about);
		expect(about.map((row) => row.key)).toEqual(["phone"]);
	});

	it("a utility found in the spending is about, in the Utilities row or its own", () => {
		const rows = mergeDraftBills(
			startingBills(undefined, format),
			[
				found("PG&E", "PG&E ENERGY", true),
				found("City Sanitation", "CITY SANITATION DEPT", true),
				found("Gym", "PLANET FITNESS"),
			],
			format,
		);
		const drafted = rows.filter((row) => row.draftKey).map((row) => [row.name, row.about]);
		expect(drafted).toEqual([
			["Utilities", true],
			["City Sanitation", true],
			["Gym", undefined],
		]);
	});

	it("knows a utility by its name or the bank's wording", () => {
		expect(draftVaries("Duke Energy", "DUKE ENERGY PAYMENT")).toBe(true);
		expect(draftVaries("City of Austin", "CITY OF AUSTIN WATER")).toBe(true);
		expect(draftVaries("Verizon", "VERIZON WIRELESS")).toBe(false);
		expect(draftVaries("Netflix", "NETFLIX.COM")).toBe(false);
	});

	it("saves a bill again when only about changed", () => {
		const [bill] = startingBills(undefined, format).map(
			(row): SetupBill => ({ ...row, ticked: true, amountCents: 14_000 }),
		);
		if (!bill) throw new Error("no bill");
		const writes = planBillWrites([bill], [{ ...bill, about: true }], []);
		expect(writes.update.map((b) => b.about)).toEqual([true]);
		expect(planBillWrites([bill], [bill], []).update).toEqual([]);
	});
});
