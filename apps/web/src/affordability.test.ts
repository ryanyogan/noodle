import { describe, expect, test } from "vitest";
import { goalAccount, goalDate, guessRole, purchaseLevers, startMonth } from "./affordability";

describe("guessRole", () => {
	test("a home replaces rent or a mortgage, and counts loans and cards as debts", () => {
		expect(guessRole("Rent", "home")).toBe("replaced");
		expect(guessRole("Mortgage", "home")).toBe("replaced");
		expect(guessRole("Car loan", "home")).toBe("debt");
		expect(guessRole("Student loans", "home")).toBe("debt");
		expect(guessRole("Visa card", "home")).toBe("debt");
		expect(guessRole("Daycare", "home")).toBe("stays");
	});

	test("a car replaces today's car payment", () => {
		expect(guessRole("Car payment", "car")).toBe("replaced");
		expect(guessRole("Auto loan", "car")).toBe("replaced");
		expect(guessRole("Rent", "car")).toBe("stays");
	});
});

describe("startMonth", () => {
	test("is next month at the soonest, when the cash is ready, within the year", () => {
		expect(startMonth("2026-09", "2026-09")).toBe("2026-10");
		expect(startMonth("2026-09", null)).toBe("2026-10");
		expect(startMonth("2026-09", "2027-03")).toBe("2027-03");
		expect(startMonth("2026-09", "2028-01")).toBe("2027-08");
	});
});

describe("purchaseLevers", () => {
	test("adds each new cost from the month, and cancels what it replaces from then", () => {
		expect(
			purchaseLevers({
				from: "2026-10",
				costs: [
					{ commitmentId: "loan", name: "Car loan", amount: 59_404, months: 60 },
					{ commitmentId: "running", name: "Car running costs", amount: 0, months: null },
				],
				replaced: ["old-car"],
			}),
		).toEqual([
			{
				kind: "add-commitment",
				commitmentId: "loan",
				name: "Car loan",
				amount: 59_404,
				fromMonth: "2026-10",
				months: 60,
			},
			{ kind: "end-commitment", commitmentId: "old-car", fromMonth: "2026-10" },
		]);
	});
});

describe("goalDate and goalAccount", () => {
	test("dates a Goal at the end of the month its money is ready, not if it's ready now", () => {
		expect(goalDate("2026-09", "2027-06")).toBe("2027-06-30");
		expect(goalDate("2026-09", "2026-09")).toBeNull();
		expect(goalDate("2026-09", null)).toBeNull();
	});

	test("backs it with the first chosen Earmark's Account, or the first that holds money", () => {
		const accounts = [
			{ id: "card", holdsMoney: false },
			{ id: "checking", holdsMoney: true },
			{ id: "savings", holdsMoney: true },
		];
		expect(goalAccount(accounts, [{ accountId: "savings" }])).toBe("savings");
		expect(goalAccount(accounts, [])).toBe("checking");
		expect(goalAccount([{ id: "card", holdsMoney: false }], [])).toBeNull();
	});
});
