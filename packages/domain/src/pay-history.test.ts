import { describe, expect, test } from "vitest";
import type { Cents } from "./money";
import type { DayKey, MonthKey } from "./month";
import { payHistory } from "./pay-history";
import type { PayLine } from "./pay-range";

const WREN = "wren";
const month = "2026-10" as MonthKey;
const pay = (date: string, dollars: number, whosePay: string | null = WREN): PayLine => ({
	amount: (dollars * 100) as Cents,
	date: date as DayKey,
	whosePay,
});

describe("payHistory", () => {
	test("with no Income there are thirteen months of nothing, none counted, and no figures", () => {
		const history = payHistory([], WREN, month);
		expect(history.months).toHaveLength(13);
		expect(history.months[0]?.month).toBe("2025-10");
		expect(history.months.at(-1)?.month).toBe("2026-10");
		expect(history.counted).toBe(0);
		expect(history.recent).toBeNull();
		expect(history.year).toBeNull();
		expect(history.low).toBeNull();
		expect(history.high).toBeNull();
	});

	test("one ended month is its own average, lowest and highest", () => {
		const history = payHistory([pay("2026-09-12", 3200)], WREN, month);
		expect(history.counted).toBe(1);
		expect(history.recent).toEqual({ average: 320_000, months: 1 });
		expect(history.year).toBeNull();
		expect(history.low).toEqual({ month: "2026-09", total: 320_000 });
		expect(history.high).toEqual({ month: "2026-09", total: 320_000 });
	});

	test("the month looked at is shown and is in no figure", () => {
		const history = payHistory([pay("2026-10-03", 9000)], WREN, month);
		expect(history.months.at(-1)).toEqual({ month, total: 900_000, counted: false });
		expect(history.counted).toBe(0);
		expect(history.recent).toBeNull();
	});

	test("months before the first Income don't count; a month of nothing after it counts as $0", () => {
		const history = payHistory(
			[pay("2026-06-20", 4000), pay("2026-08-05", 2000), pay("2026-09-28", 3000)],
			WREN,
			month,
		);
		expect(history.months.filter((m) => m.counted).map((m) => m.month)).toEqual([
			"2026-06",
			"2026-07",
			"2026-08",
			"2026-09",
		]);
		expect(history.recent).toEqual({ average: 225_000, months: 4 });
		expect(history.low).toEqual({ month: "2026-07", total: 0 });
		expect(history.high).toEqual({ month: "2026-06", total: 400_000 });
	});

	test("a full year has the average of the last six and of all twelve", () => {
		const lines = Array.from({ length: 12 }, (_, i) =>
			pay(
				`${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, "0")}-15`,
				1000 * (i + 1),
			),
		);
		const history = payHistory(lines, WREN, month);
		expect(history.counted).toBe(12);
		// Oct 2025 is $1,000 … Sep 2026 is $12,000.
		expect(history.recent).toEqual({ average: 950_000, months: 6 });
		expect(history.year).toEqual({ average: 650_000, months: 12 });
		expect(history.low).toEqual({ month: "2025-10", total: 100_000 });
		expect(history.high).toEqual({ month: "2026-09", total: 1_200_000 });
	});

	test("only that Parent's pay is read, a paycheck in its pay day's month, and nothing older", () => {
		const history = payHistory(
			[
				pay("2026-09-10", 500, "robin"),
				pay("2026-09-10", 700, null),
				{ ...pay("2026-08-31", 1500), payDay: "2026-09-01" as DayKey },
				pay("2025-09-30", 8000),
			],
			WREN,
			month,
		);
		expect(history.counted).toBe(1);
		expect(history.low).toEqual({ month: "2026-09", total: 150_000 });
	});
});
