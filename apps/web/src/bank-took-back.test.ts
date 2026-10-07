import type { Cents, DayKey, MonthKey } from "@noodle/domain";
import { describe, expect, it } from "vitest";
import { BANK_TOOK_BACK_WORD, bankTookBackText } from "./bank-took-back";

// What a line the bank took back, or changed, after its month ended says (issue 141).

const line = (over: { bankTookBackOn?: DayKey | null; bankAmount?: Cents | null } = {}) => ({
	date: "2026-09-18" as DayKey,
	...over,
});

describe("a line the bank took back", () => {
	it("says nothing on a line the bank left alone", () => {
		expect(bankTookBackText(line(), "2026-10-07")).toBeNull();
		expect(bankTookBackText(line({ bankTookBackOn: null }), "2026-10-07")).toBeNull();
	});

	it("says the day it was taken back and the month that stays as it was", () => {
		expect(bankTookBackText(line({ bankTookBackOn: "2026-10-03" as DayKey }), "2026-10-07")).toBe(
			"The bank took this back on Sat, Oct 3. It stays here so September doesn’t change.",
		);
	});

	it("says today and yesterday as the rest of the app does, without an “on”", () => {
		expect(bankTookBackText(line({ bankTookBackOn: "2026-10-07" as DayKey }), "2026-10-07")).toBe(
			"The bank took this back today. It stays here so September doesn’t change.",
		);
		expect(bankTookBackText(line({ bankTookBackOn: "2026-10-06" as DayKey }), "2026-10-07")).toBe(
			"The bank took this back yesterday. It stays here so September doesn’t change.",
		);
	});

	it("says a plain date where a row has no today to go by, never “today” for the day itself", () => {
		expect(bankTookBackText(line({ bankTookBackOn: "2026-10-03" as DayKey }))).toBe(
			"The bank took this back on Oct 3. It stays here so September doesn’t change.",
		);
	});

	it("says what the bank changed the amount to instead, when it lowered it", () => {
		expect(
			bankTookBackText(
				line({ bankTookBackOn: "2026-10-03" as DayKey, bankAmount: 2_000 as Cents }),
				"2026-10-07",
			),
		).toBe(
			"The bank changed this to $20 on Sat, Oct 3. It stays as it was so September doesn’t change.",
		);
		// Money back the bank lowered is stored as it is spent: negative.
		expect(
			bankTookBackText(
				line({ bankTookBackOn: "2026-10-03" as DayKey, bankAmount: -1_250 as Cents }),
			),
		).toBe(
			"The bank changed this to $12.50 on Oct 3. It stays as it was so September doesn’t change.",
		);
	});

	const taken = line({ bankTookBackOn: "2026-10-03" as DayKey });
	const months = (...restored: string[]) =>
		bankTookBackText(taken, "2026-10-07", restored as MonthKey[])?.split(". ")[1];

	it("names its own month alone when its money back counted there, or nowhere", () => {
		expect(months()).toBe("It stays here so September doesn’t change.");
		expect(months("2026-09")).toBe("It stays here so September doesn’t change.");
	});

	it("names both months when its money back counted in a later one", () => {
		expect(months("2026-10")).toBe("It stays here so September and October don’t change.");
		expect(
			bankTookBackText({ ...taken, bankAmount: 2_000 as Cents }, "2026-10-07", [
				"2026-10" as MonthKey,
			]),
		).toBe(
			"The bank changed this to $20 on Sat, Oct 3. It stays as it was so September and October don’t change.",
		);
	});

	it("names three months each once and oldest first, whatever order they come in", () => {
		expect(months("2026-11", "2026-10", "2026-11", "2026-09")).toBe(
			"It stays here so September, October and November don’t change.",
		);
		expect(months("2026-08", "2026-10")).toBe(
			"It stays here so August, September and October don’t change.",
		);
	});

	it("is one quiet word on the row", () => {
		expect(BANK_TOOK_BACK_WORD).toBe("Kept");
	});
});
