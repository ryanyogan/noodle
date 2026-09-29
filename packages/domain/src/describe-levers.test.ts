import { describe, expect, it } from "vitest";
import { describeLever, type Lever, type LeverSubjects } from "./index";

const subjects: LeverSubjects = {
	month: "2026-09",
	baseline: 900_000,
	buckets: [
		{ id: "groceries", name: "Groceries", allowance: 80_000 },
		{ id: "hockey", name: "Hockey", allowance: 40_000 },
	],
	commitments: [
		{ id: "daycare", name: "Daycare", amount: 140_000, cadence: "monthly" },
		{ id: "insurance", name: "Insurance", amount: 120_000, cadence: "annual" },
	],
	goals: [{ id: "college", name: "College", target: 5_000_000, targetDate: "2030-08-31" }],
};

const text = (lever: Lever, levers: Lever[] = []) => describeLever(lever, subjects, levers).text;

describe("describeLever", () => {
	it("says what the Plan has, what the Scenario makes it, and when", () => {
		expect(text({ kind: "end-commitment", commitmentId: "daycare", fromMonth: "2027-09" })).toBe(
			"Daycare $1,400 → ended from Sep 2027",
		);
		expect(
			text({
				kind: "allowance",
				bucketId: "groceries",
				amount: 90_000,
				fromMonth: "2027-03",
				untilMonth: "2028-08",
			}),
		).toBe("Groceries $800 → $900 a month from Mar 2027 until Aug 2028");
		expect(text({ kind: "baseline", amount: 1_025_050, fromMonth: "2027-01" })).toBe(
			"Income $9,000 → $10,250.50 a month from Jan 2027",
		);
	});

	it("leaves out “from” for a Lever from this month (or earlier)", () => {
		expect(text({ kind: "allowance", bucketId: "hockey", amount: 0, fromMonth: "2026-09" })).toBe(
			"Hockey $400 → $0 a month",
		);
		expect(
			text({
				kind: "archive-bucket",
				bucketId: "hockey",
				fromMonth: "2026-01",
				untilMonth: "2027-01",
			}),
		).toBe("Hockey $400 → archived until Jan 2027");
	});

	it("names a Commitment's new amount, cadence and due day", () => {
		expect(
			text({
				kind: "commitment-terms",
				commitmentId: "daycare",
				amount: 120_000,
				fromMonth: "2026-09",
			}),
		).toBe("Daycare $1,400 → $1,200 a month");
		expect(
			text({
				kind: "commitment-terms",
				commitmentId: "daycare",
				amount: 70_000,
				cadence: "biweekly",
				dueDay: 22,
				fromMonth: "2026-09",
			}),
		).toBe("Daycare $1,400 a month → $700 every two weeks, due on the 22nd");
	});

	it("describes what a Scenario adds", () => {
		expect(
			text({
				kind: "add-commitment",
				commitmentId: "car",
				name: "Car loan",
				amount: 45_000,
				cadence: "monthly",
				dueDay: 1,
				months: 60,
				fromMonth: "2027-03",
			}),
		).toBe("New Commitment: Car loan $450 a month for 60 months from Mar 2027");
		expect(
			text({
				kind: "one-off",
				oneOffId: "roof",
				name: "Roof repair",
				amount: 300_000,
				flow: "expense",
				fromMonth: "2027-05",
			}),
		).toBe("One-off expense: Roof repair $3,000 in May 2027");
		expect(
			text({
				kind: "add-bucket",
				bucketId: "swim",
				name: "Swim",
				amount: 12_000,
				fromMonth: "2026-09",
			}),
		).toBe("New Bucket: Swim $120 a month");
		expect(
			text({
				kind: "add-goal",
				goalId: "trip",
				name: "Hawaii",
				target: 600_000,
				targetDate: null,
				fromMonth: "2026-09",
			}),
		).toBe("New Goal: Hawaii $6,000 with no date");
		expect(text({ kind: "growth", incomePct: 3, costsPct: 2.5, fromMonth: "2027-01" })).toBe(
			"Raises 3% and inflation 2.5% a year from Jan 2027",
		);
	});

	it("says when a Goal's date is cleared", () => {
		expect(
			text({
				kind: "goal",
				goalId: "college",
				target: 5_000_000,
				targetDate: null,
				fromMonth: "2026-09",
			}),
		).toBe("College $50,000 by Aug 2030 → $50,000 with no date");
	});

	it("names a Commitment or Bucket another Lever adds", () => {
		const car: Lever = {
			kind: "add-commitment",
			commitmentId: "car",
			name: "Car loan",
			amount: 45_000,
			cadence: "monthly",
			dueDay: 1,
			months: null,
			fromMonth: "2026-09",
		};
		const ended: Lever = { kind: "end-commitment", commitmentId: "car", fromMonth: "2027-09" };
		expect(describeLever(ended, subjects, [car, ended])).toEqual({
			text: "Car loan → ended from Sep 2027",
			gone: false,
		});
	});

	it("flags a Lever whose Bucket, Commitment or Goal is no longer in the Plan", () => {
		for (const lever of [
			{ kind: "allowance", bucketId: "gone", amount: 1_000, fromMonth: "2026-09" },
			{ kind: "archive-bucket", bucketId: "gone", fromMonth: "2026-09" },
			{ kind: "commitment-terms", commitmentId: "gone", amount: 1_000, fromMonth: "2026-09" },
			{ kind: "end-commitment", commitmentId: "gone", fromMonth: "2026-09" },
			{ kind: "goal", goalId: "gone", target: 1_000, targetDate: null, fromMonth: "2026-09" },
		] satisfies Lever[]) {
			expect(describeLever(lever, subjects).gone).toBe(true);
		}
		expect(
			describeLever({ kind: "baseline", amount: 1, fromMonth: "2026-09" }, subjects).gone,
		).toBe(false);
	});
});
