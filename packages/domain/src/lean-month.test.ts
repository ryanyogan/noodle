import { describe, expect, test } from "vitest";
import { leanMonth } from "./lean-month";
import type { Cents } from "./money";
import type { DayKey, MonthKey } from "./month";

const month = "2026-10" as MonthKey;
const cents = (dollars: number) => (dollars * 100) as Cents;
const pay = (dollars: number, expectedOn: string | null) => ({
	left: cents(dollars),
	expectedOn: expectedOn as DayKey | null,
});
const read = (
	over: Partial<{
		baseline: Cents | null;
		received: Cents;
		asOf: string;
		varies: boolean;
		waiting: ReturnType<typeof pay>[];
	}> = {},
) =>
	leanMonth({
		baseline: cents(4000),
		received: cents(2800),
		month,
		varies: true,
		waiting: [],
		...over,
		asOf: (over.asOf ?? "2026-10-08") as DayKey,
	});

describe("leanMonth", () => {
	test("says nothing early in a month with no pay to come, however little is in", () => {
		expect(read()).toBeNull();
		expect(read({ received: cents(0) })).toBeNull();
		expect(read({ asOf: "2026-10-26" })).toBeNull();
	});

	test("with pay to come it says what is in so far, and what is expected against the gap", () => {
		expect(read({ waiting: [pay(1500, "2026-10-24"), pay(1000, "2026-10-17")] })).toEqual({
			planned: 400_000,
			inSoFar: 280_000,
			gap: 120_000,
			short: false,
			daysLeft: 23,
			toCome: 250_000,
			by: "2026-10-24",
			overdue: false,
			noDay: 0,
			after: 0,
		});
	});

	test("pay expected next month isn't set against the gap; late pay and pay with no day are told apart", () => {
		const lean = read({
			waiting: [pay(500, "2026-09-20"), pay(900, "2026-11-05"), pay(300, null)],
		});
		expect(lean).toMatchObject({
			toCome: 50_000,
			by: "2026-09-20",
			overdue: true,
			noDay: 30_000,
			after: 70_000,
		});
	});

	test("it is short only in the month's last five days, and then with no pay to come as well", () => {
		expect(read({ asOf: "2026-10-27" })).toMatchObject({ short: true, daysLeft: 4, toCome: 0 });
		expect(read({ asOf: "2026-10-31" })).toMatchObject({ short: true, daysLeft: 0, by: null });
		expect(read({ asOf: "2026-10-27", varies: false })).toBeNull();
		expect(read({ asOf: "2026-10-27", varies: false, waiting: [pay(200, null)] })).toMatchObject({
			short: true,
			noDay: 20_000,
		});
	});

	test("a month with nothing in yet is still only what is in so far", () => {
		expect(read({ received: cents(0), waiting: [pay(1000, "2026-10-20")] })).toMatchObject({
			inSoFar: 0,
			gap: 400_000,
			short: false,
			after: 300_000,
		});
	});

	test("nothing to say with no take-home pay, in another month, or within a few dollars", () => {
		const waiting = [pay(1000, "2026-10-20")];
		expect(read({ baseline: null, waiting })).toBeNull();
		expect(read({ asOf: "2026-11-02", waiting })).toBeNull();
		expect(read({ received: cents(3980), waiting })).toBeNull();
		expect(read({ received: cents(5200), waiting })).toBeNull();
		expect(read({ waiting: [pay(0, "2026-10-20")] })).toBeNull();
	});
});
