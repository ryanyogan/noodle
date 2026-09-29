import { describe, expect, it } from "vitest";
import {
	addedUntil,
	changedTerms,
	dueDateFrom,
	holdsIn,
	type Lever,
	rangeFrom,
	whyNotApplicable,
} from "./index";

describe("Lever ranges", () => {
	it("hold from fromMonth up to, not including, untilMonth", () => {
		const range = { fromMonth: "2027-03", untilMonth: "2027-06" } as const;
		expect(
			["2027-02", "2027-03", "2027-05", "2027-06"].map((m) => holdsIn(range, m as never)),
		).toEqual([false, true, true, false]);
		expect(holdsIn({ fromMonth: "2027-03" }, "2031-01")).toBe(true);
	});

	it("hold from the current month when they began earlier, and not at all once over", () => {
		expect(rangeFrom({ fromMonth: "2026-06" }, "2026-09")).toEqual({
			from: "2026-09",
			until: null,
		});
		expect(rangeFrom({ fromMonth: "2026-10", untilMonth: "2027-01" }, "2026-09")).toEqual({
			from: "2026-10",
			until: "2027-01",
		});
		expect(rangeFrom({ fromMonth: "2026-06", untilMonth: "2026-09" }, "2026-09")).toBeNull();
	});

	it("end a new Commitment at the earlier of its term and untilMonth", () => {
		const loan: Lever = {
			kind: "add-commitment",
			commitmentId: "car",
			name: "Car",
			amount: 1,
			cadence: "monthly",
			dueDay: 1,
			fromMonth: "2027-01",
			months: 60,
		};
		expect(addedUntil(loan)).toBe("2032-01");
		expect(addedUntil({ ...loan, untilMonth: "2028-01" })).toBe("2028-01");
		expect(addedUntil({ ...loan, months: null })).toBeUndefined();
		expect(addedUntil({ ...loan, months: 6, untilMonth: "2028-01" })).toBe("2027-07");
	});
});

describe("dueDateFrom: a Commitment's schedule from a due day", () => {
	it("monthly: in a month that has the day, so the 31st stays the 31st", () => {
		expect(dueDateFrom("monthly", "2027-03", 15)).toBe("2027-03-15");
		expect(dueDateFrom("monthly", "2027-02", 31)).toBe("2027-03-31");
	});

	it("biweekly: that day of the first month", () => {
		expect(dueDateFrom("biweekly", "2027-02", 30)).toBe("2027-02-28");
	});

	it("annual: the next time its month comes round", () => {
		expect(dueDateFrom("annual", "2027-03", 10)).toBe("2027-03-10");
		expect(dueDateFrom("annual", "2027-03", 10, "01")).toBe("2028-01-10");
		expect(dueDateFrom("annual", "2027-03", 10, "11")).toBe("2027-11-10");
	});
});

describe("changedTerms", () => {
	const mortgage = { amount: 300_000, cadence: "monthly", dueDate: "2026-09-05" } as const;

	it("keeps the schedule when only the amount changes", () => {
		expect(changedTerms(mortgage, { amount: 250_000 }, "2027-01")).toEqual({
			...mortgage,
			amount: 250_000,
		});
	});

	it("keeps the day when only the cadence changes", () => {
		expect(changedTerms(mortgage, { cadence: "biweekly" }, "2027-01")).toEqual({
			amount: 300_000,
			cadence: "biweekly",
			dueDate: "2027-01-05",
		});
	});

	it("keeps an annual Commitment's month when only its day changes", () => {
		const insurance = { amount: 120_000, cadence: "annual", dueDate: "2026-11-15" } as const;
		expect(changedTerms(insurance, { dueDay: 1 }, "2027-01")).toEqual({
			...insurance,
			dueDate: "2027-11-01",
		});
	});
});

describe("whyNotApplicable: what applying can make the real Plan", () => {
	const month = "2026-09";

	it("applies what the Plan stores, over a range where it can write the old value back", () => {
		const levers: Lever[] = [
			{ kind: "baseline", amount: 1, fromMonth: "2026-10", untilMonth: "2027-01" },
			{ kind: "allowance", bucketId: "b", amount: 1, fromMonth: month, untilMonth: "2027-01" },
			{
				kind: "commitment-terms",
				commitmentId: "c",
				amount: 1,
				fromMonth: month,
				untilMonth: "2027-01",
			},
			{ kind: "end-commitment", commitmentId: "c", fromMonth: month },
			{
				kind: "add-commitment",
				commitmentId: "n",
				name: "N",
				amount: 1,
				cadence: "biweekly",
				dueDay: 3,
				fromMonth: month,
				months: 12,
			},
			{
				kind: "add-bucket",
				bucketId: "b2",
				name: "B",
				amount: 1,
				fromMonth: month,
				untilMonth: "2027-01",
			},
			{ kind: "archive-bucket", bucketId: "b", fromMonth: "2026-12" },
			{ kind: "goal", goalId: "g", target: 1, targetDate: null, fromMonth: month },
			{
				kind: "add-goal",
				goalId: "g2",
				name: "G",
				target: 1,
				targetDate: null,
				fromMonth: month,
				accountId: "a",
			},
		];
		expect(levers.map((l) => whyNotApplicable(l, month))).toEqual(levers.map(() => null));
	});

	it("refuses one-offs and growth, which aren't part of the Plan", () => {
		expect(
			whyNotApplicable(
				{
					kind: "one-off",
					oneOffId: "o",
					name: "Roof",
					amount: 1,
					flow: "expense",
					fromMonth: month,
				},
				month,
			),
		).toMatch(/Goal/);
		expect(
			whyNotApplicable({ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: month }, month),
		).not.toBeNull();
	});

	it("refuses changes the Plan can't store for a while only", () => {
		const until = { fromMonth: month, untilMonth: "2027-01" } as const;
		expect(
			whyNotApplicable({ kind: "end-commitment", commitmentId: "c", ...until }, month),
		).not.toBeNull();
		expect(
			whyNotApplicable({ kind: "archive-bucket", bucketId: "b", ...until }, month),
		).not.toBeNull();
		expect(
			whyNotApplicable({ kind: "goal", goalId: "g", target: 1, targetDate: null, ...until }, month),
		).not.toBeNull();
		expect(
			whyNotApplicable(
				{ kind: "goal", goalId: "g", target: 1, targetDate: null, fromMonth: "2026-12" },
				month,
			),
		).not.toBeNull();
	});

	it("needs an Account for a new Goal", () => {
		expect(
			whyNotApplicable(
				{ kind: "add-goal", goalId: "g", name: "G", target: 1, targetDate: null, fromMonth: month },
				month,
			),
		).toMatch(/Account/);
	});
});
