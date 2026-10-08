import type { Cents, DayKey, ExpectedPaycheck } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { formDays, paycheckAmount, paycheckMeta, payText, scheduleOf } from "./pay-days";

// How Plan › Income says a Parent's pay and each expected paycheck (issue 156).

const cents = (dollars: number) => (dollars * 100) as Cents;

describe("payText", () => {
	it("says a salary's paycheck and its pay days", () => {
		expect(
			payText({ paycheck: cents(2500), schedule: { kind: "twice-a-month", days: [1, 15] } }),
		).toBe("Salary · $2,500 a paycheck · Twice a month, on the 1st and the 15th");
		expect(payText({ paycheck: cents(4000.5), schedule: { kind: "monthly", day: 22 } })).toBe(
			"Salary · $4,000.50 a paycheck · Monthly, on the 22nd",
		);
	});

	it("says hourly when nothing is set", () => {
		expect(payText(null)).toBe("Hourly, or pay that varies");
	});
});

describe("scheduleOf", () => {
	it("makes monthly from the first day alone", () => {
		expect(scheduleOf("monthly", 28, 28)).toEqual({ kind: "monthly", day: 28 });
	});

	it("puts the earlier of two pay days first", () => {
		expect(scheduleOf("twice-a-month", 20, 5)).toEqual({ kind: "twice-a-month", days: [5, 20] });
	});

	it("is nothing for the same day twice", () => {
		expect(scheduleOf("twice-a-month", 15, 15)).toBeNull();
	});
});

describe("formDays", () => {
	it("starts from the 1st and the 15th", () => {
		expect(formDays(undefined)).toEqual([1, 15]);
	});

	it("starts from the schedule's own days", () => {
		expect(formDays({ kind: "twice-a-month", days: [5, 20] })).toEqual([5, 20]);
		expect(formDays({ kind: "monthly", day: 28 })).toEqual([28, 15]);
	});

	it("offers a second day that isn't the monthly one", () => {
		expect(formDays({ kind: "monthly", day: 15 })).toEqual([15, 1]);
	});
});

describe("an expected paycheck's row", () => {
	const day = "2026-10-01" as DayKey;
	const paid: ExpectedPaycheck = {
		day,
		expected: cents(2500),
		state: "in",
		lineId: "line",
		amount: cents(2480.55),
		postedOn: "2026-09-30" as DayKey,
	};

	it("says what came in and the day it posted", () => {
		expect(paycheckMeta(paid, "Sam")).toBe("Posted Sep 30");
		expect(paycheckAmount(paid)).toBe(cents(2480.55));
	});

	it("says what to expect until then", () => {
		const waiting: ExpectedPaycheck = { day, expected: cents(2500), state: "expected" };
		expect(paycheckMeta(waiting, "Sam")).toBe("About $2,500");
		expect(paycheckAmount(waiting)).toBe(cents(2500));
	});

	it("says what was looked for once its days are over", () => {
		const late: ExpectedPaycheck = { day, expected: cents(2500), state: "late" };
		expect(paycheckMeta(late, "Sam")).toBe("No Income marked as Sam’s pay near this day");
	});
});
