import { describe, expect, it } from "vitest";
import { byDoNow, perkDoNow, perkPeriod, perkStanding } from "./perk-standing";

const perk = (over: Partial<Parameters<typeof perkStanding>[0]> = {}) => ({
	kind: "cost" as const,
	valueCents: 1500,
	renews: "monthly" as const,
	uses: [],
	spentOn: [],
	...over,
});

describe("perkPeriod", () => {
	it("knows when each renewal resets", () => {
		expect(perkPeriod("monthly", "2026-12-14")).toEqual({
			start: "2026-12-01",
			resets: "2027-01-01",
		});
		expect(perkPeriod("quarterly", "2026-11-02")).toEqual({
			start: "2026-10-01",
			resets: "2027-01-01",
		});
		expect(perkPeriod("yearly", "2026-10-04")).toEqual({
			start: "2026-01-01",
			resets: "2027-01-01",
		});
		expect(perkPeriod("every-4-years", "2026-10-04")).toEqual({
			start: "2022-10-05",
			resets: null,
		});
		expect(perkPeriod("per-trip", "2026-10-04")).toBeNull();
	});
});

describe("perkStanding", () => {
	it("counts a use marked by hand this month, and each month used this year", () => {
		const standing = perkStanding(
			perk({
				uses: [
					{ id: "a", on: "2026-10-02", note: "Airport" },
					{ id: "b", on: "2026-08-20", note: null },
					{ id: "c", on: "2025-12-20", note: null },
				],
			}),
			"2026-10-04",
		);
		expect(standing.usedThisPeriod).toMatchObject({
			on: "2026-10-02",
			how: "by-hand",
			note: "Airport",
		});
		expect(standing.daysLeft).toBe(28);
		expect(standing.yearlyValueCents).toBe(18000);
		expect(standing.usedThisYearCents).toBe(3000);
	});

	it("takes a matching charge as a use of a cost it pays for, never of a service", () => {
		expect(perkStanding(perk({ spentOn: ["2026-10-01"] }), "2026-10-04").usedThisPeriod?.how).toBe(
			"spending",
		);
		expect(
			perkStanding(perk({ kind: "service", spentOn: ["2026-10-01"] }), "2026-10-04").usedThisPeriod,
		).toBeNull();
	});

	it("puts the soonest to reset first under Do now, and leaves out what was used", () => {
		const asOf = "2026-10-04";
		const monthly = { valueCents: 1500, standing: perkStanding(perk(), asOf) };
		const yearly = {
			valueCents: 20000,
			standing: perkStanding(perk({ renews: "yearly", valueCents: 20000 }), asOf),
		};
		const fourYears = {
			valueCents: 12000,
			standing: perkStanding(perk({ renews: "every-4-years", valueCents: 12000 }), asOf),
		};
		expect([fourYears, yearly, monthly].sort(byDoNow)).toEqual([monthly, yearly, fourYears]);
		const used = perkStanding(perk({ uses: [{ id: "a", on: asOf, note: null }] }), asOf);
		expect(perkDoNow(used, "monthly")).toBe(false);
		expect(perkDoNow(monthly.standing, "monthly")).toBe(true);
	});
});
