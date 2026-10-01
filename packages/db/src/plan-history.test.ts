import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addCommitment,
	addGoal,
	addPersonalAllowance,
	applyChanges,
	archiveBucket,
	createHouseholdForParent,
	type Db,
	endCommitment,
	loadPlanChanges,
	setAllowance,
	setCarriesOver,
	setTakeHomePay,
	updateBucket,
	updateCommitment,
	updateGoal,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;

/** The Household's Plan changes as `viewer` sees them, oldest first. */
const history = async (viewer = alex, filter: { month?: "2026-09" | "2026-10" } = {}) =>
	(await loadPlanChanges(db, viewer, filter)).changes.slice().reverse();

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await setTakeHomePay(db, { ...alex, month, amountCents: 900_000 });
	await addBucket(db, {
		...alex,
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	await addPersonalAllowance(db, {
		...alex,
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month,
		allowanceCents: 20_000,
	});
	await addCommitment(db, {
		...alex,
		commitmentId: "daycare",
		name: "Daycare",
		month,
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-09-05",
	});
});

describe("Plan changes", () => {
	it("appends one per Plan write, with who, what, from → to, month and scope", async () => {
		await setTakeHomePay(db, { ...sam, month: "2026-10", amountCents: 950_000, scope: "just" });
		await setAllowance(db, { ...sam, bucketId: "groceries", month, amountCents: 130_000 });
		await setCarriesOver(db, { ...sam, bucketId: "groceries", month, rolling: true });
		await updateBucket(db, { ...sam, bucketId: "groceries", month, name: "Food" });
		await updateCommitment(db, {
			...sam,
			commitmentId: "daycare",
			name: "Daycare",
			month: "2026-10",
			amountCents: 65_000,
			cadence: "monthly",
			dueDate: "2026-09-05",
		});
		await updateCommitment(db, {
			...sam,
			commitmentId: "daycare",
			name: "Preschool",
			month: "2026-10",
			amountCents: 65_000,
			cadence: "monthly",
			dueDate: "2026-09-05",
		});
		await endCommitment(db, { ...sam, commitmentId: "daycare", month: "2026-12" });
		await archiveBucket(db, { ...sam, bucketId: "groceries", month: "2027-01" });

		const changes = await history();
		expect(
			changes.map(({ memberName, kind, targetId, targetName, month, scope, before, after }) => ({
				memberName,
				kind,
				targetId,
				targetName,
				month,
				scope,
				before,
				after,
			})),
		).toEqual([
			// The setup: the Plan's first values are Plan changes too.
			{
				memberName: "Alex",
				kind: "baseline",
				targetId: null,
				targetName: null,
				month,
				scope: "from-on",
				before: { amount: null },
				after: { amount: 900_000 },
			},
			{
				memberName: "Alex",
				kind: "bucket-add",
				targetId: "groceries",
				targetName: "Food",
				month,
				scope: "from-on",
				before: null,
				after: { name: "Groceries", amount: 120_000 },
			},
			{
				memberName: "Alex",
				kind: "bucket-add",
				targetId: "alex-pa",
				targetName: "Alex’s Personal Allowance",
				month,
				scope: "from-on",
				before: null,
				after: { name: "Alex’s Personal Allowance", amount: 20_000 },
			},
			{
				memberName: "Alex",
				kind: "commitment-add",
				targetId: "daycare",
				targetName: "Preschool",
				month,
				scope: "from-on",
				before: null,
				after: { name: "Daycare", amount: 60_000, cadence: "monthly", dueDate: "2026-09-05" },
			},
			{
				memberName: "Sam",
				kind: "baseline",
				targetId: null,
				targetName: null,
				month: "2026-10",
				scope: "just",
				before: { amount: 900_000 },
				after: { amount: 950_000 },
			},
			{
				memberName: "Sam",
				kind: "allowance",
				targetId: "groceries",
				targetName: "Food",
				month,
				scope: "from-on",
				before: { amount: 120_000 },
				after: { amount: 130_000 },
			},
			{
				memberName: "Sam",
				kind: "rolling",
				targetId: "groceries",
				targetName: "Food",
				month,
				scope: "from-on",
				before: { rolling: false },
				after: { rolling: true },
			},
			{
				memberName: "Sam",
				kind: "bucket-rename",
				targetId: "groceries",
				targetName: "Food",
				month,
				scope: "from-on",
				before: { name: "Groceries" },
				after: { name: "Food" },
			},
			{
				memberName: "Sam",
				kind: "commitment-terms",
				targetId: "daycare",
				targetName: "Preschool",
				month: "2026-10",
				scope: "from-on",
				before: { amount: 60_000, cadence: "monthly", dueDate: "2026-09-05" },
				after: { amount: 65_000, cadence: "monthly", dueDate: "2026-09-05" },
			},
			// The second save changed only the name.
			{
				memberName: "Sam",
				kind: "commitment-rename",
				targetId: "daycare",
				targetName: "Preschool",
				month: "2026-10",
				scope: "from-on",
				before: { name: "Daycare" },
				after: { name: "Preschool" },
			},
			{
				memberName: "Sam",
				kind: "commitment-end",
				targetId: "daycare",
				targetName: "Preschool",
				month: "2026-12",
				scope: "from-on",
				before: null,
				after: null,
			},
			{
				memberName: "Sam",
				kind: "bucket-archive",
				targetId: "groceries",
				targetName: "Food",
				month: "2027-01",
				scope: "from-on",
				before: null,
				after: null,
			},
		]);
		expect(changes.every((c) => c.source === "plan" && c.scenarioId === null)).toBe(true);
	});

	it("logs a Goal added, once, and its new target and date", async () => {
		await addAccount(db, {
			householdId,
			accountId: "savings",
			name: "Savings",
			kind: "savings",
			balanceCents: 500_000,
			balanceId: "balance",
			createdByMemberId: "alex",
		});
		const add = {
			householdId,
			goalId: "car",
			accountId: "savings",
			name: "Car",
			targetCents: 1_000_000,
			targetDate: null,
			fromMonth: month,
			claimId: "claim",
			claimCents: 0,
			createdByMemberId: "alex",
		} as const;
		await addGoal(db, add);
		await addGoal(db, add);
		const goal = { ...sam, goalId: "car", month, name: "Car" } as const;
		await updateGoal(db, { ...goal, targetCents: 1_200_000, targetDate: "2027-06-30" });
		// A rename alone isn't a change to the Plan.
		await updateGoal(db, {
			...goal,
			name: "New car",
			targetCents: 1_200_000,
			targetDate: "2027-06-30",
		});

		const goals = (await history()).filter((c) => c.kind.startsWith("goal"));
		expect(goals).toMatchObject([
			{
				kind: "goal-add",
				memberName: "Alex",
				month,
				before: null,
				after: { name: "Car", target: 1_000_000, targetDate: null },
			},
			{
				memberName: "Sam",
				targetName: "New car",
				before: { target: 1_000_000, targetDate: null },
				after: { target: 1_200_000, targetDate: "2027-06-30" },
			},
		]);
	});

	it("logs a Scenario's Changes as its own, with each range's end", async () => {
		await applyChanges(db, {
			...sam,
			scenarioId: "tighter",
			month,
			levers: [
				{
					kind: "allowance",
					bucketId: "groceries",
					amount: 90_000,
					fromMonth: "2026-10",
					untilMonth: "2026-11",
				},
				{ kind: "baseline", amount: 1_000_000, fromMonth: "2026-10", untilMonth: "2027-01" },
				{ kind: "end-commitment", commitmentId: "daycare", fromMonth: "2027-06" },
			],
		});
		const applied = (await history()).filter((c) => c.source === "scenario");
		expect(applied).toMatchObject([
			{
				kind: "allowance",
				month: "2026-10",
				scope: "just",
				after: { amount: 90_000, until: "2026-11" },
			},
			{
				kind: "baseline",
				month: "2026-10",
				scope: "from-on",
				after: { amount: 1_000_000, until: "2027-01" },
			},
			{ kind: "commitment-end", month: "2027-06", scope: "from-on" },
		]);
		expect(applied.every((c) => c.scenarioId === "tighter" && c.memberName === "Sam")).toBe(true);
		// Never saved, so it has no name.
		expect(applied.every((c) => c.scenarioName === null)).toBe(true);
	});

	it("names the Scenario a change was applied from", async () => {
		const scenarioChanges = [{ kind: "baseline", amount: 1_000_000, fromMonth: month }] as const;
		await applyChanges(db, {
			...sam,
			scenarioId: "raise",
			scenario: { name: "Raise", levers: [...scenarioChanges] },
			month,
			levers: scenarioChanges,
		});
		expect((await history()).filter((c) => c.source === "scenario")).toMatchObject([
			{ kind: "baseline", scenarioName: "Raise" },
		]);
	});

	it("logs a retried or unchanged write once", async () => {
		const change = { ...alex, bucketId: "groceries", month, amountCents: 130_000 } as const;
		await setAllowance(db, change);
		await setAllowance(db, change);
		await setCarriesOver(db, { ...alex, bucketId: "groceries", month, rolling: false });
		await archiveBucket(db, { ...alex, bucketId: "groceries", month: "2026-12" });
		await archiveBucket(db, { ...alex, bucketId: "groceries", month: "2026-12" });
		await addBucket(db, {
			...alex,
			bucketId: "groceries",
			name: "Groceries again",
			color: 1,
			month,
			allowanceCents: 1,
		});
		const kinds = (await history()).map((c) => c.kind);
		expect(kinds.filter((k) => k === "allowance")).toHaveLength(1);
		expect(kinds.filter((k) => k === "rolling")).toHaveLength(0);
		expect(kinds.filter((k) => k === "bucket-archive")).toHaveLength(1);
		expect(kinds.filter((k) => k === "bucket-add")).toHaveLength(2);
	});

	it("logs nothing for a write that was refused", async () => {
		const before = (await history()).length;
		// Only Alex sets Alex's Personal Allowance, and each Parent has one.
		await setAllowance(db, { ...sam, bucketId: "alex-pa", month, amountCents: 99_000 });
		await setCarriesOver(db, { ...sam, bucketId: "alex-pa", month, rolling: true });
		await updateBucket(db, { ...sam, bucketId: "alex-pa", month, name: "Mine now" });
		await addPersonalAllowance(db, {
			...alex,
			bucketId: "second-pa",
			name: "Another",
			color: 3,
			month,
			allowanceCents: 1,
		});
		// A Personal Allowance isn't archived, and another Household's Bucket isn't this one's.
		await archiveBucket(db, { ...alex, bucketId: "alex-pa", month: "2026-12" });
		await setAllowance(db, {
			householdId: "elsewhere",
			memberId: "alex",
			bucketId: "groceries",
			month,
			amountCents: 1,
		});
		expect(await history()).toHaveLength(before);
	});

	it("shows the other Parent only that a Personal Allowance changed", async () => {
		await setAllowance(db, { ...alex, bucketId: "alex-pa", month: "2026-10", amountCents: 25_000 });
		await updateBucket(db, { ...alex, bucketId: "alex-pa", month, name: "Hobbies" });

		const own = (await history(alex)).filter((c) => c.targetId === "alex-pa");
		expect(own.map((c) => [c.kind, c.targetName, c.after])).toEqual([
			["bucket-add", "Hobbies", { name: "Alex’s Personal Allowance", amount: 20_000 }],
			["allowance", "Hobbies", { amount: 25_000 }],
			["bucket-rename", "Hobbies", { name: "Hobbies" }],
		]);

		const theirs = (await history(sam)).filter((c) => c.targetId === "alex-pa");
		expect(theirs).toHaveLength(3);
		for (const change of theirs) {
			expect(change).toMatchObject({
				kind: "personal-allowance",
				memberName: "Alex",
				targetName: null,
				before: null,
				after: null,
			});
		}
		expect(JSON.stringify(theirs)).not.toMatch(/Hobbies|\b25000\b|\b20000\b/);
	});

	it("reads one month's changes, or one item's, and when history starts", async () => {
		await setAllowance(db, { ...alex, bucketId: "groceries", month: "2026-10", amountCents: 1 });
		await setTakeHomePay(db, { ...alex, month: "2026-10", amountCents: 2 });

		const october = await loadPlanChanges(db, alex, { month: "2026-10" });
		expect(october.changes.map((c) => c.kind)).toEqual(["baseline", "allowance"]);
		expect(october.historyStart).toBeTypeOf("number");

		const groceries = await loadPlanChanges(db, alex, { targetId: "groceries" });
		expect(groceries.changes.map((c) => c.kind)).toEqual(["allowance", "bucket-add"]);

		const elsewhere = await loadPlanChanges(db, { householdId: "elsewhere", memberId: "x" }, {});
		expect(elsewhere).toEqual({ changes: [], historyStart: null });
	});
});
