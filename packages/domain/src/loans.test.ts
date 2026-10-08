import { describe, expect, it } from "vitest";
import {
	type DayKey,
	dueDateOn,
	endsAfter,
	loanPaid,
	loanSchedule,
	MAX_SCHEDULED_PAYMENTS,
	nextLoanDue,
	paymentsLeft,
	paymentsUntil,
	scheduleFrom,
} from "./index";

const day = (d: string) => d as DayKey;
const schedule = (input: Partial<Parameters<typeof loanSchedule>[0]> & { owed: number | null }) =>
	loanSchedule({ payment: null, dueDay: 15, endsOn: null, from: day("2026-10-08"), ...input });

describe("paymentsLeft", () => {
	it("is what's owed over the payment, rounded up for a smaller last one", () => {
		expect(paymentsLeft(20_000, 5_000)).toBe(4);
		expect(paymentsLeft(20_001, 5_000)).toBe(5);
		expect(paymentsLeft(4_999, 5_000)).toBe(1);
	});

	it("is none when nothing is owed or there is no payment", () => {
		expect(paymentsLeft(0, 5_000)).toBe(0);
		expect(paymentsLeft(-100, 5_000)).toBe(0);
		expect(paymentsLeft(20_000, 0)).toBe(0);
	});
});

describe("nextLoanDue", () => {
	it("is this month's due day while it hasn't passed, today included", () => {
		expect(nextLoanDue(15, day("2026-10-08"))).toBe("2026-10-15");
		expect(nextLoanDue(15, day("2026-10-15"))).toBe("2026-10-15");
	});

	it("is next month's once it has, over a year's end", () => {
		expect(nextLoanDue(15, day("2026-10-16"))).toBe("2026-11-15");
		expect(nextLoanDue(5, day("2026-12-20"))).toBe("2027-01-05");
	});

	it("is the month's last day when the month lacks the due day", () => {
		expect(nextLoanDue(31, day("2027-02-10"))).toBe("2027-02-28");
		expect(nextLoanDue(31, day("2028-02-10"))).toBe("2028-02-29");
		expect(nextLoanDue(31, day("2026-11-30"))).toBe("2026-11-30");
	});
});

describe("scheduleFrom", () => {
	it("is today with no payment this month", () => {
		expect(scheduleFrom(day("2026-10-08"), null)).toBe("2026-10-08");
		expect(scheduleFrom(day("2026-10-08"), day("2026-09-15"))).toBe("2026-10-08");
	});

	it("is the first of next month once this month's payment is in", () => {
		expect(scheduleFrom(day("2026-10-08"), day("2026-10-02"))).toBe("2026-11-01");
		expect(scheduleFrom(day("2026-12-08"), day("2026-12-08"))).toBe("2027-01-01");
	});
});

describe("paymentsUntil and endsAfter", () => {
	it("count the due days up to the end, and find the end from a count", () => {
		expect(paymentsUntil(day("2027-01-15"), 15, day("2026-10-08"))).toBe(4);
		expect(endsAfter(4, 15, day("2026-10-08"))).toBe("2027-01-15");
		expect(paymentsUntil(day("2027-01-14"), 15, day("2026-10-08"))).toBe(3);
		expect(paymentsUntil(day("2026-10-15"), 15, day("2026-10-08"))).toBe(1);
		expect(endsAfter(1, 15, day("2026-10-08"))).toBe("2026-10-15");
	});

	it("start next month when this month's due day has passed", () => {
		expect(paymentsUntil(day("2027-01-15"), 15, day("2026-10-20"))).toBe(3);
		expect(endsAfter(3, 15, day("2026-10-20"))).toBe("2027-01-15");
	});

	it("count none when the end comes before the next due day", () => {
		expect(paymentsUntil(day("2026-10-10"), 15, day("2026-10-08"))).toBe(0);
		expect(paymentsUntil(day("2026-01-15"), 15, day("2026-10-08"))).toBe(0);
	});

	it("keep to the last day of a month that lacks the due day", () => {
		expect(endsAfter(2, 31, day("2027-01-10"))).toBe("2027-02-28");
		expect(paymentsUntil(day("2027-02-28"), 31, day("2027-01-10"))).toBe(2);
	});
});

describe("dueDateOn", () => {
	it("is the due day in this month when the month has it", () => {
		expect(dueDateOn(15, day("2026-10-08"))).toBe("2026-10-15");
		expect(dueDateOn(5, day("2026-10-08"))).toBe("2026-10-05");
	});

	it("moves to the first month that has the day, so the 31st stays the 31st", () => {
		expect(dueDateOn(31, day("2027-02-10"))).toBe("2027-03-31");
		expect(dueDateOn(30, day("2027-02-10"))).toBe("2027-03-30");
		expect(dueDateOn(31, day("2026-11-10"))).toBe("2026-12-31");
	});
});

describe("loanSchedule", () => {
	it("lists equal payments on the due day, the last on the day it is paid off", () => {
		expect(schedule({ owed: 20_000, payment: 5_000 })).toEqual({
			payments: [
				{ date: "2026-10-15", amount: 5_000 },
				{ date: "2026-11-15", amount: 5_000 },
				{ date: "2026-12-15", amount: 5_000 },
				{ date: "2027-01-15", amount: 5_000 },
			],
			count: 4,
			paidOffOn: "2027-01-15",
		});
	});

	it("makes the last payment the remainder", () => {
		const result = schedule({ owed: 12_345, payment: 5_000 });
		expect(result?.payments.map((p) => p.amount)).toEqual([5_000, 5_000, 2_345]);
		expect(result?.paidOffOn).toBe("2026-12-15");
	});

	it("is one payment of what's owed when that is less than the payment", () => {
		expect(schedule({ owed: 1_200, payment: 5_000 })).toEqual({
			payments: [{ date: "2026-10-15", amount: 1_200 }],
			count: 1,
			paidOffOn: "2026-10-15",
		});
	});

	it("starts next month once this month's due day has passed", () => {
		const result = schedule({ owed: 10_000, payment: 5_000, from: day("2026-10-16") });
		expect(result?.payments.map((p) => p.date)).toEqual(["2026-11-15", "2026-12-15"]);
	});

	it("uses the last day of a month that lacks the due day", () => {
		const result = schedule({
			owed: 40_000,
			payment: 10_000,
			dueDay: 31,
			from: day("2027-01-05"),
		});
		expect(result?.payments.map((p) => p.date)).toEqual([
			"2027-01-31",
			"2027-02-28",
			"2027-03-31",
			"2027-04-30",
		]);
		expect(result?.paidOffOn).toBe("2027-04-30");
	});

	it("has no payments and no payoff date for a loan already paid off", () => {
		expect(schedule({ owed: 0, payment: 5_000 })).toEqual({
			payments: [],
			count: 0,
			paidOffOn: null,
		});
		expect(schedule({ owed: -500, payment: 5_000 })?.count).toBe(0);
		expect(schedule({ owed: 0 })?.count).toBe(0);
	});

	it("spreads what's owed up to the day it ends when no payment is given, the remainder last", () => {
		expect(schedule({ owed: 10_000, endsOn: day("2026-12-15") })).toEqual({
			payments: [
				{ date: "2026-10-15", amount: 3_333 },
				{ date: "2026-11-15", amount: 3_333 },
				{ date: "2026-12-15", amount: 3_334 },
			],
			count: 3,
			paidOffOn: "2026-12-15",
		});
	});

	it("is one payment of everything when the end has passed", () => {
		expect(schedule({ owed: 10_000, endsOn: day("2026-01-15") })).toEqual({
			payments: [{ date: "2026-10-15", amount: 10_000 }],
			count: 1,
			paidOffOn: "2026-10-15",
		});
	});

	it("goes by the payment when both a payment and an end are given", () => {
		const result = schedule({ owed: 10_000, payment: 5_000, endsOn: day("2027-06-15") });
		expect(result?.count).toBe(2);
		expect(result?.paidOffOn).toBe("2026-11-15");
	});

	it("says nothing without what's owed, a due day, or a payment or end", () => {
		expect(schedule({ owed: null, payment: 5_000 })).toBeNull();
		expect(schedule({ owed: 10_000, payment: 5_000, dueDay: null })).toBeNull();
		expect(schedule({ owed: 10_000 })).toBeNull();
		expect(schedule({ owed: 10_000, payment: 0 })).toBeNull();
	});

	it("always adds up to what's owed", () => {
		for (const [owed, payment] of [
			[100_000, 3_333],
			[1, 5_000],
			[250_000, 41_667],
		] as const) {
			const result = schedule({ owed, payment });
			expect(result?.payments.reduce((sum, p) => sum + p.amount, 0)).toBe(owed);
			expect(result?.count).toBe(Math.ceil(owed / payment));
		}
	});

	it("lists at most fifty years of payments, and still says when it is paid off", () => {
		const result = schedule({ owed: 120_000, payment: 100 });
		expect(result?.payments).toHaveLength(MAX_SCHEDULED_PAYMENTS);
		expect(result?.count).toBe(1_200);
		// 1,200 payments from October 2026: the last is 1,199 months on.
		expect(result?.paidOffOn).toBe("2126-09-15");
	});
});

describe("loanPaid", () => {
	it("is what was borrowed less what's owed, never below $0", () => {
		expect(loanPaid(20_000, 15_000)).toBe(5_000);
		expect(loanPaid(20_000, 25_000)).toBe(0);
		expect(loanPaid(null, 15_000)).toBeNull();
		expect(loanPaid(20_000, null)).toBeNull();
	});
});
