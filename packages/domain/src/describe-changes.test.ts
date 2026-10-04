import { describe, expect, it } from "vitest";
import {
	changeName,
	describeChange,
	type ScenarioChange,
	type ScenarioChangeSubjects,
} from "./index";

const subjects: ScenarioChangeSubjects = {
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

const text = (change: ScenarioChange, changes: ScenarioChange[] = []) =>
	describeChange(change, subjects, changes).text;

describe("changeName", () => {
	it("names what a Change changes in a word or two, for warnings to point at", () => {
		const name = (change: ScenarioChange, changes: ScenarioChange[] = []) =>
			changeName(change, subjects, changes);
		expect(name({ kind: "end-commitment", commitmentId: "daycare", fromMonth: "2027-09" })).toBe(
			"Daycare",
		);
		expect(name({ kind: "allowance", bucketId: "hockey", amount: 0, fromMonth: "2026-09" })).toBe(
			"Hockey",
		);
		expect(name({ kind: "baseline", amount: 1, fromMonth: "2026-09" })).toBe("Income");
		expect(
			name({
				kind: "one-off",
				oneOffId: "roof",
				name: "New roof",
				amount: 300_000,
				flow: "expense",
				fromMonth: "2027-05",
			}),
		).toBe("New roof");
		// A Change on a Goal another Change adds takes that Goal's name.
		const boat: ScenarioChange = {
			kind: "add-goal",
			goalId: "boat",
			name: "Boat",
			target: 1,
			targetDate: null,
			fromMonth: "2026-09",
		};
		expect(
			name({ kind: "goal", goalId: "boat", target: 2, targetDate: null, fromMonth: "2026-09" }, [
				boat,
			]),
		).toBe("Boat");
		expect(name({ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: "2026-09" })).toBe(
			"Growth",
		);
	});
});

describe("describeChange", () => {
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

	it("leaves out “from” for a Change from this month (or earlier)", () => {
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

	it("names a Commitment or Bucket another Change adds", () => {
		const car: ScenarioChange = {
			kind: "add-commitment",
			commitmentId: "car",
			name: "Car loan",
			amount: 45_000,
			cadence: "monthly",
			dueDay: 1,
			months: null,
			fromMonth: "2026-09",
		};
		const ended: ScenarioChange = {
			kind: "end-commitment",
			commitmentId: "car",
			fromMonth: "2027-09",
		};
		expect(describeChange(ended, subjects, [car, ended])).toEqual({
			text: "Car loan → ended from Sep 2027",
			gone: false,
		});
	});

	it("flags a Change whose Bucket, Commitment or Goal is no longer in the Plan", () => {
		for (const change of [
			{ kind: "allowance", bucketId: "gone", amount: 1_000, fromMonth: "2026-09" },
			{ kind: "archive-bucket", bucketId: "gone", fromMonth: "2026-09" },
			{ kind: "commitment-terms", commitmentId: "gone", amount: 1_000, fromMonth: "2026-09" },
			{ kind: "end-commitment", commitmentId: "gone", fromMonth: "2026-09" },
			{ kind: "goal", goalId: "gone", target: 1_000, targetDate: null, fromMonth: "2026-09" },
		] satisfies ScenarioChange[]) {
			expect(describeChange(change, subjects).gone).toBe(true);
		}
		expect(
			describeChange({ kind: "baseline", amount: 1, fromMonth: "2026-09" }, subjects).gone,
		).toBe(false);
	});
});

describe("a Change whose Bucket, Commitment or Goal is gone (#51)", () => {
	const gone: ScenarioChangeSubjects = { ...subjects, buckets: [], commitments: [], goals: [] };
	const fromMonth = "2026-09";
	it("is named by its subject's saved name, marked archived", () => {
		const allowance: ScenarioChange = {
			kind: "allowance",
			bucketId: "eating-out",
			amount: 30_000,
			fromMonth,
			subjectName: "Eating out",
		};
		const described = describeChange(allowance, gone);
		expect(described.gone).toBe(true);
		expect(described.text).toMatch(/^Eating out \(archived\) \$300/);
		expect(changeName(allowance, gone)).toBe("Eating out (archived)");
		expect(
			describeChange(
				{ kind: "end-commitment", commitmentId: "daycare", fromMonth, subjectName: "Daycare" },
				gone,
			).text,
		).toBe("Daycare (archived) ended");
		expect(
			describeChange(
				{ kind: "archive-bucket", bucketId: "eating-out", fromMonth, subjectName: "Eating out" },
				gone,
			).text,
		).toBe("Eating out (archived)");
		const goal: ScenarioChange = {
			kind: "goal",
			goalId: "college",
			target: 100_000,
			targetDate: null,
			fromMonth,
			subjectName: "College",
		};
		expect(describeChange(goal, gone).text).toMatch(/^College \(archived\) /);
		expect(changeName(goal, gone)).toBe("College (archived)");
	});
	it("reads as before without a saved name, and by its current name while its subject is there", () => {
		const allowance: ScenarioChange = {
			kind: "allowance",
			bucketId: "groceries",
			amount: 30_000,
			fromMonth,
		};
		expect(changeName(allowance, gone)).toBe("A Bucket");
		expect(changeName({ ...allowance, subjectName: "Food" }, subjects)).toBe("Groceries");
	});
	it("never shows the other Parent's archived or deleted Personal Allowance, by name or amount (ADR-0003)", () => {
		const theirs = { subjectName: "Sam’s fun money", subjectOwner: "sam" };
		const allowance: ScenarioChange = {
			kind: "allowance",
			bucketId: "sam-allowance",
			amount: 12_345,
			fromMonth,
			...theirs,
		};
		const archive: ScenarioChange = {
			kind: "archive-bucket",
			bucketId: "sam-allowance",
			fromMonth,
			...theirs,
		};
		for (const change of [allowance, archive]) {
			for (const viewer of ["alex"]) {
				const described = describeChange(change, { ...gone, viewer });
				expect(described.text).toBe("Personal Allowance changed");
				expect(described.text).not.toMatch(/Sam|123/);
				expect(changeName(change, { ...gone, viewer })).toBe("Personal Allowance");
			}
		}
		// Its owner still reads it by its saved name.
		expect(describeChange(allowance, { ...gone, viewer: "sam" }).text).toMatch(
			/^Sam’s fun money \(archived\) \$123\.45/,
		);
	});
});
