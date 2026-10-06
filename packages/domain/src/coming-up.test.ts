import { describe, expect, it } from "vitest";
import {
	byNextDue,
	comingUp,
	type DayKey,
	lumpsIn,
	lumpyMonths,
	matchCharges,
	monthlyEquivalent,
	nextDueDate,
	type PlanRecords,
	planForMonth,
	yearlyCost,
} from "./index";

type Records = Pick<PlanRecords, "commitments" | "commitmentTerms">;

const records: Records = {
	commitments: [
		{ id: "01-mortgage", name: "Mortgage", fromMonth: "2026-01", endedFromMonth: null },
		{ id: "02-daycare", name: "Daycare", fromMonth: "2026-01", endedFromMonth: null },
		{ id: "03-insurance", name: "Car insurance", fromMonth: "2026-01", endedFromMonth: null },
		{ id: "04-gym", name: "Gym", fromMonth: "2026-01", endedFromMonth: "2026-10" },
	],
	commitmentTerms: [
		{
			commitmentId: "01-mortgage",
			month: "2026-01",
			amount: 250_000,
			cadence: "monthly",
			dueDate: "2026-01-01",
		},
		// From October, the mortgage goes up.
		{
			commitmentId: "01-mortgage",
			month: "2026-10",
			amount: 255_000,
			cadence: "monthly",
			dueDate: "2026-10-01",
		},
		// Every other Friday: Sep 4 and 18, Oct 2, 16 and 30.
		{
			commitmentId: "02-daycare",
			month: "2026-01",
			amount: 60_000,
			cadence: "biweekly",
			dueDate: "2026-09-04",
		},
		{
			commitmentId: "03-insurance",
			month: "2026-01",
			amount: 114_000,
			cadence: "annual",
			dueDate: "2027-03-15",
		},
		{
			commitmentId: "04-gym",
			month: "2026-01",
			amount: 5_000,
			cadence: "monthly",
			dueDate: "2026-01-28",
		},
	],
};

const charge = (commitmentId: string, amount: number, date: DayKey) => ({
	commitmentId,
	amount,
	date,
});

describe("comingUp", () => {
	it("lists what's due in the next 30 days by date, across the month's end", () => {
		const dues = comingUp(records, [], "2026-09-20", 30);
		expect(dues.map((d) => [d.date, d.name, d.amount])).toEqual([
			["2026-09-28", "Gym", 5_000],
			["2026-10-01", "Mortgage", 255_000],
			["2026-10-02", "Daycare", 60_000],
			["2026-10-16", "Daycare", 60_000],
		]);
		expect(dues.every((d) => d.status === "due" && d.paid === 0)).toBe(true);
	});

	it("counts today and the 29 days after it", () => {
		expect(comingUp(records, [], "2026-09-18", 30).map((d) => d.date)).toEqual([
			"2026-09-18",
			"2026-09-28",
			"2026-10-01",
			"2026-10-02",
			"2026-10-16",
		]);
		expect(comingUp(records, [], "2026-09-18", 1).map((d) => d.date)).toEqual(["2026-09-18"]);
	});

	it("marks each due date paid, partly paid, or due from its month's charges, in order", () => {
		const charges = [
			// Paid ahead: September's first daycare, and October's first and part of its second.
			charge("02-daycare", 60_000, "2026-09-03"),
			charge("02-daycare", 60_000, "2026-10-01"),
			charge("02-daycare", 20_000, "2026-10-01"),
			// A September charge doesn't pay October's mortgage.
			charge("01-mortgage", 255_000, "2026-09-30"),
		];
		const dues = comingUp(records, charges, "2026-09-02", 30);
		expect(dues.map((d) => [d.date, d.name, d.status, d.paid])).toEqual([
			["2026-09-04", "Daycare", "paid", 60_000],
			["2026-09-18", "Daycare", "due", 0],
			["2026-09-28", "Gym", "due", 0],
			["2026-10-01", "Mortgage", "due", 0],
		]);
		expect(
			comingUp(records, charges, "2026-10-01", 20).map((d) => [d.date, d.name, d.status, d.paid]),
		).toEqual([
			["2026-10-01", "Mortgage", "due", 0],
			["2026-10-02", "Daycare", "paid", 60_000],
			["2026-10-16", "Daycare", "partly-paid", 20_000],
		]);
	});

	it("shows an annual Commitment only when it's due within the days", () => {
		expect(comingUp(records, [], "2026-09-20", 30).some((d) => d.name === "Car insurance")).toBe(
			false,
		);
		const march = comingUp(records, [], "2027-02-20", 30).filter((d) => d.name === "Car insurance");
		expect(march).toEqual([
			{
				commitmentId: "03-insurance",
				name: "Car insurance",
				date: "2027-03-15",
				amount: 114_000,
				paid: 0,
				status: "due",
			},
		]);
	});

	it("keeps an end-of-month due day on the last day of shorter months", () => {
		const rent: Records = {
			commitments: [{ id: "rent", name: "Rent", fromMonth: "2026-01", endedFromMonth: null }],
			commitmentTerms: [
				{
					commitmentId: "rent",
					month: "2026-01",
					amount: 200_000,
					cadence: "monthly",
					dueDate: "2026-01-31",
				},
			],
		};
		expect(comingUp(rent, [], "2027-02-10", 30).map((d) => d.date)).toEqual(["2027-02-28"]);
		expect(comingUp(rent, [], "2027-03-01", 61).map((d) => d.date)).toEqual([
			"2027-03-31",
			"2027-04-30",
		]);
	});

	it("leaves out a Commitment once it has ended", () => {
		expect(comingUp(records, [], "2026-10-20", 30).some((d) => d.name === "Gym")).toBe(false);
	});
});

describe("matchCharges", () => {
	it("sets each charge against the due date it paid, and says whether it was on time", () => {
		const charges = [
			{ ...charge("02-daycare", 60_000, "2026-10-02"), id: "a" },
			{ ...charge("02-daycare", 60_000, "2026-10-19"), id: "b" },
			{ ...charge("02-daycare", 60_000, "2026-10-29"), id: "c" },
			// A fourth charge in a month with three due dates pays none of them.
			{ ...charge("02-daycare", 10_000, "2026-10-31"), id: "d" },
			{ ...charge("01-mortgage", 255_000, "2026-10-01"), id: "e" },
		];
		expect(
			matchCharges(records, "02-daycare", charges).map((c) => [c.id, c.dueDate, c.onTime]),
		).toEqual([
			["d", null, null],
			["c", "2026-10-30", true],
			["b", "2026-10-16", false],
			["a", "2026-10-02", true],
		]);
	});

	it("matches nothing in a month an annual Commitment isn't due", () => {
		const charges = [
			charge("03-insurance", 114_000, "2027-02-27"),
			charge("03-insurance", 114_000, "2028-03-20"),
		];
		expect(matchCharges(records, "03-insurance", charges)).toEqual([
			{ ...charges[1], dueDate: "2028-03-15", onTime: false },
			{ ...charges[0], dueDate: null, onTime: null },
		]);
	});
});

describe("lumpy months", () => {
	it("finds an annual Commitment in the month it's due", () => {
		const plan = planForMonth({ ...empty, ...records }, "2027-03");
		expect(lumpsIn(plan)).toEqual([
			{
				commitmentId: "03-insurance",
				name: "Car insurance",
				cadence: "annual",
				extra: 114_000,
				dueDates: ["2027-03-15"],
			},
		]);
	});

	it("finds a biweekly Commitment in a month with three due dates, and only then", () => {
		expect(lumpsIn(planForMonth({ ...empty, ...records }, "2026-10"))).toEqual([
			{
				commitmentId: "02-daycare",
				name: "Daycare",
				cadence: "biweekly",
				extra: 60_000,
				dueDates: ["2026-10-02", "2026-10-16", "2026-10-30"],
			},
		]);
		expect(lumpsIn(planForMonth({ ...empty, ...records }, "2026-11"))).toEqual([]);
	});

	it("lists the lumpy months ahead with their causes, largest first", () => {
		expect(
			lumpyMonths(records, "2026-09", 12).map(({ month, lumps }) => [
				month,
				lumps.map((l) => l.name),
			]),
		).toEqual([
			["2026-10", ["Daycare"]],
			["2027-03", ["Car insurance"]],
			["2027-04", ["Daycare"]],
		]);
	});
});

const empty: PlanRecords = {
	baselines: [],
	buckets: [],
	allowances: [],
	commitments: [],
	commitmentTerms: [],
	rolling: [],
};

describe("a Commitment's cost", () => {
	it("is its amount times how often it's due in a year, and a twelfth of that a month", () => {
		expect(yearlyCost({ amount: 250_000, cadence: "monthly" })).toBe(3_000_000);
		expect(yearlyCost({ amount: 60_000, cadence: "biweekly" })).toBe(1_560_000);
		expect(yearlyCost({ amount: 114_000, cadence: "annual" })).toBe(114_000);
		expect(monthlyEquivalent({ amount: 114_000, cadence: "annual" })).toBe(9_500);
		expect(monthlyEquivalent({ amount: 60_000, cadence: "biweekly" })).toBe(130_000);
	});
});

describe("next due date", () => {
	it("is the first due day on or after a day, whatever the cadence", () => {
		const monthly = { cadence: "monthly", dueDate: "2026-01-31" } as const;
		expect(nextDueDate(monthly, "2026-09-30")).toBe("2026-09-30");
		expect(nextDueDate(monthly, "2026-10-01")).toBe("2026-10-31");
		expect(nextDueDate({ cadence: "biweekly", dueDate: "2026-09-04" }, "2026-09-05")).toBe(
			"2026-09-18",
		);
		expect(nextDueDate({ cadence: "annual", dueDate: "2025-03-15" }, "2026-03-16")).toBe(
			"2027-03-15",
		);
	});

	it("orders Commitments soonest first, then as they were added", () => {
		const plan = planForMonth({ ...empty, ...records }, "2026-09");
		expect(plan.commitments.map((c) => c.name)).toEqual([
			"Mortgage",
			"Daycare",
			"Gym",
			"Car insurance",
		]);
		expect(byNextDue(plan.commitments, "2026-09-05").map((c) => c.name)).toEqual([
			"Daycare",
			"Gym",
			"Mortgage",
			"Car insurance",
		]);
	});
});

describe("Paid back into a Commitment (issue 132)", () => {
	const paid = { commitmentId: "01-mortgage", amount: 250_000, date: "2026-09-01" as DayKey };
	const back = {
		commitmentId: "01-mortgage",
		amount: -100_000,
		date: "2026-09-10" as DayKey,
		paidBack: true as const,
	};

	it("doesn't make a paid due date read partly paid", () => {
		const [due] = comingUp(records, [paid, back], "2026-09-01", 1);
		expect(due).toMatchObject({ commitmentId: "01-mortgage", paid: 250_000, status: "paid" });
	});

	it("isn't one of its payments", () => {
		expect(matchCharges(records, "01-mortgage", [paid, back])).toEqual([
			{ ...paid, dueDate: "2026-09-01", onTime: true },
		]);
	});
});
