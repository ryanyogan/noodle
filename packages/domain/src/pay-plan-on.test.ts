import { describe, expect, test } from "vitest";
import type { Cents } from "./money";
import type { DayKey, MonthKey } from "./month";
import { payHistory } from "./pay-history";
import { planOn, planOnDiffers, planOnTakeHome } from "./pay-plan-on";
import { type PayLine, payRanges } from "./pay-range";

const WREN = "wren";
const month = "2026-10" as MonthKey;
const pay = (date: string, dollars: number, whosePay: string | null = WREN): PayLine => ({
	amount: (dollars * 100) as Cents,
	date: date as DayKey,
	whosePay,
});
/** One payment mid-month for each amount, the last of them in September 2026. */
const months = (dollars: number[], whosePay: string | null = WREN) =>
	dollars.flatMap((amount, i) => {
		const at = 9 - (dollars.length - i);
		const m = ((at + 12) % 12) + 1;
		const year = at >= 0 ? 2026 : 2025;
		return amount > 0 ? [pay(`${year}-${String(m).padStart(2, "0")}-15`, amount, whosePay)] : [];
	});
const suggest = (dollars: number[]) => planOn(payHistory(months(dollars), WREN, month));

describe("planOn", () => {
	test("nothing is suggested with no history, one month, or five", () => {
		expect(suggest([])).toBeNull();
		expect(suggest([3000])).toBeNull();
		expect(suggest([3000, 3100, 2900, 3300, 3200])).toBeNull();
	});

	test("with six months it is the second-lowest, and the lowest is left out", () => {
		expect(suggest([4000, 900, 3100, 5200, 3600, 4400])).toEqual({
			amount: 310_000,
			of: 6,
			atLeast: 5,
			below: { month: "2026-05", total: 90_000 },
		});
	});

	test("over a year one freak month doesn't set it, and a second low month does", () => {
		const year = [4000, 4200, 3900, 5000, 4100, 0, 4300, 4800, 3800, 4500, 4000, 4600];
		expect(suggest(year)).toMatchObject({ amount: 380_000, of: 12, atLeast: 11 });
		expect(suggest(year)?.below).toEqual({ month: "2026-03", total: 0 });
		const twice = [...year];
		twice[9] = 0;
		expect(suggest(twice)).toEqual({ amount: 0, of: 12, atLeast: 12, below: null });
	});

	test("when the two lowest months are the same, nothing is left out", () => {
		expect(suggest([3000, 3000, 3500, 4000, 4500, 5000])).toEqual({
			amount: 300_000,
			of: 6,
			atLeast: 6,
			below: null,
		});
	});

	test("the month being read is never in it", () => {
		const lines = [...months([4000, 4100, 4200, 4300, 4400, 4500]), pay("2026-10-02", 100)];
		expect(planOn(payHistory(lines, WREN, month))?.amount).toBe(410_000);
	});
});

describe("planOnTakeHome", () => {
	test("adds what the other Parent's pay can be counted on for, and leaves out the same Parent's range", () => {
		const lines = [
			...months([4000, 900, 3100, 5200, 3600, 4400]),
			...months([4200, 4200, 4200], "robin"),
		];
		const amount = planOn(payHistory(lines, WREN, month))?.amount ?? (0 as Cents);
		expect(planOnTakeHome([{ memberId: WREN, amount }], payRanges(lines, month))).toEqual({
			takeHome: 730_000,
			others: 420_000,
		});
	});

	test("is offered only when it is more than a few dollars from the take-home pay", () => {
		expect(planOnDiffers(730_000 as Cents, 700_000 as Cents)).toBe(true);
		expect(planOnDiffers(730_000 as Cents, 728_000 as Cents)).toBe(false);
		expect(planOnDiffers(730_000 as Cents, null)).toBe(true);
		expect(planOnDiffers(0 as Cents, 700_000 as Cents)).toBe(false);
	});
});
