import { describe, expect, it } from "vitest";
import { applyPreview } from "./apply-preview";
import {
	describeLever,
	type Lever,
	type LeverSubjects,
	leverName,
	oneOffAsGoal,
	type PlanRecords,
} from "./index";

const month = "2026-09";

const records: PlanRecords = {
	baselines: [
		{ month: "2026-01", amount: 900_000 },
		{ month: "2027-06", amount: 950_000 },
	],
	buckets: [
		{
			id: "groceries",
			name: "Groceries",
			color: 1,
			position: 0,
			fromMonth: "2026-01",
			archivedFromMonth: null,
		},
		{
			id: "alex-fun",
			name: "Alex’s money",
			color: 2,
			position: 1,
			fromMonth: "2026-01",
			archivedFromMonth: null,
			owner: "alex",
		},
		{
			id: "sam-fun",
			name: "Sam’s money",
			color: 3,
			position: 2,
			fromMonth: "2026-01",
			archivedFromMonth: null,
			owner: "sam",
		},
	],
	allowances: [
		{ bucketId: "groceries", month: "2026-01", amount: 80_000 },
		{ bucketId: "alex-fun", month: "2026-01", amount: 20_000 },
		{ bucketId: "sam-fun", month: "2026-01", amount: 20_000 },
	],
	commitments: [
		{ id: "daycare", name: "Daycare", fromMonth: "2026-01", endedFromMonth: null },
		{ id: "gone", name: "Gym", fromMonth: "2026-01", endedFromMonth: "2026-06" },
	],
	commitmentTerms: [
		{
			commitmentId: "daycare",
			month: "2026-01",
			amount: 140_000,
			cadence: "monthly",
			dueDate: "2026-01-05",
		},
		{
			commitmentId: "gone",
			month: "2026-01",
			amount: 5_000,
			cadence: "monthly",
			dueDate: "2026-01-05",
		},
	],
	rolling: [],
};

const goals = [
	{ id: "college", name: "College", target: 5_000_000, targetDate: "2030-08-31" as const },
];
const accounts = [{ id: "savings", name: "Savings" }];

const preview = (scenarioChanges: Lever[], viewer = "sam") =>
	applyPreview({ records, month, levers: scenarioChanges, viewer, goals, accounts });

const lines = (change: Lever, viewer?: string) =>
	preview([change], viewer).changes.flatMap((c) => c.lines);

describe("applyPreview: exactly what applying writes to the Plan", () => {
	it("writes a value from its first month, and the Plan's back when its range ends", () => {
		expect(
			lines({
				kind: "allowance",
				bucketId: "groceries",
				amount: 90_000,
				fromMonth: "2026-10",
				untilMonth: "2027-01",
			}),
		).toEqual([
			"Groceries $800 → $900 a month from Oct 2026",
			"Groceries back to $800 a month from Jan 2027",
		]);
	});

	it("stops at a later month the Plan set on its own, which keeps its value", () => {
		expect(lines({ kind: "baseline", amount: 1_000_000, fromMonth: month })).toEqual([
			"Income $9,000 → $10,000 a month from Sep 2026 until Jun 2027, which has its own",
		]);
		expect(
			lines({ kind: "baseline", amount: 1_000_000, fromMonth: month, untilMonth: "2028-01" }),
		).toEqual(["Income $9,000 → $10,000 a month from Sep 2026 until Jun 2027, which has its own"]);
	});

	it("changes a Commitment's terms, and ends, adds and archives from their month", () => {
		expect(
			lines({
				kind: "commitment-terms",
				commitmentId: "daycare",
				amount: 120_000,
				fromMonth: "2027-01",
				untilMonth: "2027-09",
			}),
		).toEqual([
			"Daycare $1,400 a month → $1,200 a month from Jan 2027",
			"Daycare back to $1,400 a month from Sep 2027",
		]);
		expect(
			lines({ kind: "end-commitment", commitmentId: "daycare", fromMonth: "2027-09" }),
		).toEqual(["Daycare ends: out of the Plan from Sep 2027"]);
		expect(
			lines({
				kind: "add-commitment",
				commitmentId: "car",
				name: "Car loan",
				amount: 45_000,
				cadence: "monthly",
				dueDay: 15,
				fromMonth: "2026-10",
				months: 60,
			}),
		).toEqual([
			"New Commitment Car loan: $450 a month, due the 15th, from Oct 2026 until Oct 2031",
		]);
		expect(
			lines({
				kind: "add-bucket",
				bucketId: "hockey",
				name: "Hockey",
				amount: 15_000,
				rolling: true,
				fromMonth: month,
			}),
		).toEqual(["New Bucket Hockey: $150 a month, Rolling, from Sep 2026"]);
		expect(lines({ kind: "archive-bucket", bucketId: "groceries", fromMonth: "2027-01" })).toEqual([
			"Groceries archived: out of the Plan from Jan 2027",
		]);
	});

	it("changes a Goal, and adds one in its Account", () => {
		expect(
			lines({
				kind: "goal",
				goalId: "college",
				target: 6_000_000,
				targetDate: "2031-08-31",
				fromMonth: month,
			}),
		).toEqual(["College $50,000 by Aug 2030 → $60,000 by Aug 2031"]);
		expect(
			lines({
				kind: "add-goal",
				goalId: "roof",
				name: "Roof",
				target: 300_000,
				targetDate: "2027-05-01",
				fromMonth: month,
				accountId: "savings",
			}),
		).toEqual(["New Goal Roof: $3,000 by May 2027, kept in Savings"]);
	});

	it("leaves out assumptions, offering a one-off expense as a Goal", () => {
		const roof: Lever = {
			kind: "one-off",
			oneOffId: "roof",
			name: "Roof",
			amount: 300_000,
			flow: "expense",
			fromMonth: "2027-05",
		};
		const result = preview([
			roof,
			{ ...roof, oneOffId: "bonus", name: "Bonus", flow: "income" },
			{ kind: "growth", incomePct: 3, costsPct: 2, fromMonth: month },
		]);
		expect(result.changes).toEqual([]);
		expect(result.blocked).toEqual([]);
		expect(result.leftOut.map((l) => [l.lever, l.asGoal])).toEqual([
			[0, true],
			[1, false],
			[2, false],
		]);
	});

	it("leaves out what changes nothing, is muted or is no longer in the Plan", () => {
		const result = preview([
			{ kind: "allowance", bucketId: "groceries", amount: 80_000, fromMonth: month },
			{ kind: "baseline", amount: 1, fromMonth: month, muted: true },
			{ kind: "end-commitment", commitmentId: "gone", fromMonth: month },
		]);
		expect(result.changes).toEqual([]);
		expect(result.leftOut.map((l) => l.reason)).toEqual([
			"It’s already the Plan.",
			"Muted, so it isn’t applied.",
			"It’s no longer in the Plan.",
		]);
	});

	it("is blocked by a change the Plan can't store for a while only", () => {
		const result = preview([
			{
				kind: "end-commitment",
				commitmentId: "daycare",
				fromMonth: month,
				untilMonth: "2027-01",
			},
		]);
		expect(result.blocked).toEqual([
			{
				lever: 0,
				reason: "Ending a Commitment for a while can’t be applied. End it for good instead.",
			},
		]);
	});

	it("never changes, nor says the amounts of, the other Parent's Personal Allowance", () => {
		const theirs: Lever = {
			kind: "allowance",
			bucketId: "alex-fun",
			amount: 35_000,
			fromMonth: month,
		};
		const result = preview([theirs]);
		expect(result.changes).toEqual([]);
		expect(result.leftOut).toEqual([
			{
				lever: 0,
				text: "Personal Allowance changed",
				reason: "Only its Parent changes their Personal Allowance.",
				asGoal: false,
			},
		]);
		expect(lines(theirs, "alex")).toEqual(["Alex’s money $200 → $350 a month from Sep 2026"]);
	});
});

describe("oneOffAsGoal: “Make it a Goal”", () => {
	const roof = {
		kind: "one-off",
		oneOffId: "roof",
		name: "Roof",
		amount: 300_000,
		flow: "expense",
		fromMonth: "2027-05",
	} as const;

	it("saves its amount from this month, due the first of its month", () => {
		expect(oneOffAsGoal(roof, { goalId: "g", month, accountId: "savings" })).toEqual({
			kind: "add-goal",
			goalId: "g",
			name: "Roof",
			target: 300_000,
			targetDate: "2027-05-01",
			fromMonth: month,
			accountId: "savings",
		});
	});

	it("is due at the end of this month for a one-off this month", () => {
		expect(oneOffAsGoal({ ...roof, fromMonth: month }, { goalId: "g", month }).targetDate).toBe(
			"2026-09-30",
		);
	});
});

describe("Levers on the other Parent's Personal Allowance", () => {
	const subjects: LeverSubjects = {
		month,
		baseline: 900_000,
		buckets: [
			{ id: "alex-fun", name: "Alex’s money", allowance: 20_000, owner: "alex" },
			{ id: "sam-fun", name: "Sam’s money", allowance: 20_000, owner: "sam" },
		],
		commitments: [],
		goals: [],
		viewer: "sam",
	};
	const allowance = (bucketId: string): Lever => ({
		kind: "allowance",
		bucketId,
		amount: 35_000,
		fromMonth: "2027-01",
	});

	it("read only as “Personal Allowance changed”, with no amounts or months", () => {
		expect(describeLever(allowance("alex-fun"), subjects).text).toBe("Personal Allowance changed");
		expect(leverName(allowance("alex-fun"), subjects)).toBe("Personal Allowance");
	});

	it("read in full for their own Parent", () => {
		expect(describeLever(allowance("sam-fun"), subjects).text).toBe(
			"Sam’s money $200 → $350 a month from Jan 2027",
		);
	});
});
