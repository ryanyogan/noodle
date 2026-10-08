import { type DayKey, EVERYONE, forTotals, spendingFor } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addChild,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadSpendCells,
	loadSpendingBetween,
	loadTransactionsPage,
	setTakeHomePay,
	splitTransaction,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

// Reports › People for every Member (issue 155): what was spent For each person and For Everyone,
// by Bucket, adds up to each Bucket's own total in Reports; a Bucket's Transactions narrowed by
// who they were For are the ones behind a figure; and a Parent's Personal Allowance stays theirs.

const householdId = "household";
const month = "2026-09";
const from = "2026-09-01" as DayKey;
const until = "2026-10-01" as DayKey;
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;

const quickAdd = (
	by: { householdId: string; memberId: string },
	transactionId: string,
	bucketId: string,
	amountCents: number,
	forMemberIds: string[],
) =>
	addQuickAdd(db, {
		householdId: by.householdId,
		transactionId,
		bucketId,
		date: "2026-09-12",
		amountCents,
		note: transactionId,
		forMemberIds,
		createdByMemberId: by.memberId,
	});

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
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, color] of [
		["health", 1],
		["food", 3],
	] as const)
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId,
			name: bucketId,
			color,
			month,
			allowanceCents: 120_000,
		});
	for (const parent of [alex, sam])
		await addPersonalAllowance(db, {
			householdId,
			memberId: parent.memberId,
			bucketId: `${parent.memberId}-pa`,
			name: `${parent.memberId}’s Personal Allowance`,
			color: 2,
			month,
			allowanceCents: 20_000,
		});
	await addChild(db, { householdId, memberId: "leo", name: "Leo", color: 3 });
	await addChild(db, { householdId, memberId: "maya", name: "Maya", color: 4 });

	// For one Child, one Parent, two and three people together (odd cents), and Everyone.
	await quickAdd(alex, "dentist", "health", 6_400, ["maya"]);
	await quickAdd(alex, "physio", "health", 9_000, ["sam"]);
	await quickAdd(alex, "pharmacy", "health", 3_001, ["maya", "leo"]);
	await quickAdd(sam, "checkups", "health", 10_000, ["maya", "leo", "alex"]);
	await quickAdd(alex, "groceries", "food", 18_642, []);
	await quickAdd(sam, "lunches", "food", 2_500, ["leo"]);
	// One purchase split across both Buckets, each Split For someone else.
	await quickAdd(alex, "big-box", "food", 5_001, []);
	await splitTransaction(db, {
		householdId,
		memberId: "alex",
		transactionId: "big-box",
		amountCents: 5_001,
		note: "big-box",
		splits: [
			{ id: "big-box-a", amountCents: 2_000, assignment: { bucketId: "health" }, forMemberIds: [] },
			{
				id: "big-box-b",
				amountCents: 3_001,
				assignment: { bucketId: "food" },
				forMemberIds: ["alex", "sam"],
			},
		],
	});
	// Each Parent's own Personal Allowance, For themselves and For a Child (a gift).
	await quickAdd(sam, "sam-gift", "sam-pa", 4_500, ["leo"]);
	await quickAdd(sam, "sam-coffee", "sam-pa", 700, ["sam"]);
	await quickAdd(alex, "alex-book", "alex-pa", 1_900, ["alex"]);
});

const totalsFor = async (viewer: typeof alex) =>
	forTotals(await loadSpendingBetween(db, viewer, from, until));

const listed = async (viewer: typeof alex, bucketId: string | undefined, forMember: string) =>
	(await loadTransactionsPage(db, viewer, { month, bucketId, forMember, limit: 50 })).transactions;

describe("what was spent For each person, by Bucket", () => {
	it("shares spending For several people evenly, to the cent", async () => {
		const { members: people, household } = await totalsFor(alex);
		// Health: $30.01 between two and $100.00 between three leave an odd cent each, which one of
		// the people it was For takes; the others' shares are a cent less.
		const health = (who: string) => people[who]?.buckets.health ?? 0;
		expect([3_333, 3_334]).toContain(health("alex"));
		expect([1_500 + 3_333, 1_501 + 3_333, 1_500 + 3_334]).toContain(health("leo"));
		expect(health("maya") - 6_400).toBeGreaterThanOrEqual(1_500 + 3_333);
		expect(health("maya") + health("leo") + health("alex")).toBe(6_400 + 3_001 + 10_000);
		expect(people.sam?.buckets.health).toBe(9_000);
		expect(household.buckets.health).toBe(2_000);
		// Food: Everyone is its own line, never shared out between the people.
		expect(household.buckets.food).toBe(18_642);
		expect(people.leo?.buckets.food).toBe(2_500);
		expect((people.alex?.buckets.food ?? 0) + (people.sam?.buckets.food ?? 0)).toBe(3_001);
	});

	it("adds up, people and Everyone together, to each Bucket's own total in Reports", async () => {
		for (const viewer of [alex, sam]) {
			const totals = await totalsFor(viewer);
			const { cells, privateMonths } = await loadSpendCells(
				db,
				{ viewer, range: { from, until }, filters: {} },
				"all",
			);
			const reported = new Map<string, number>();
			for (const cell of [...cells, ...privateMonths])
				reported.set(cell.target, (reported.get(cell.target) ?? 0) + cell.amount);
			expect([...reported.keys()].sort()).toEqual(
				["alex-pa", "food", "health", "sam-pa"].map((id) => `bucket:${id}`),
			);
			for (const [target, amount] of reported) {
				const bucketId = target.slice("bucket:".length);
				const byPerson = [totals.household, ...Object.values(totals.members)].reduce(
					(sum, person) => sum + (person.buckets[bucketId] ?? 0),
					0,
				);
				expect(byPerson, `${viewer.memberId} ${bucketId}`).toBe(amount);
			}
		}
	});

	it("leaves another Household's spending out", async () => {
		const before = await totalsFor(alex);
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-robin",
			householdId: "other",
			householdName: "The Lakes",
			timeZone: "America/Chicago",
			parentId: "robin",
			parentName: "Robin",
		});
		await setTakeHomePay(db, {
			householdId: "other",
			memberId: "robin",
			month,
			amountCents: 500_000,
		});
		await addBucket(db, {
			householdId: "other",
			memberId: "robin",
			bucketId: "other-health",
			name: "health",
			color: 1,
			month,
			allowanceCents: 50_000,
		});
		await quickAdd(
			{ householdId: "other", memberId: "robin" },
			"other-dentist",
			"other-health",
			7_700,
			["robin"],
		);
		expect(await totalsFor(alex)).toEqual(before);
		expect(await listed({ householdId, memberId: "alex" }, "other-health", "robin")).toEqual([]);
		expect(await listed({ householdId: "other", memberId: "robin" }, "health", "maya")).toEqual([]);
	});
});

describe("a Bucket's Transactions narrowed by who they were For", () => {
	it("lists only that person's, and their shares add up to the person's figure", async () => {
		const spending = await loadSpendingBetween(db, alex, from, until);
		const totals = forTotals(spending);
		for (const who of ["maya", "leo", "alex", "sam", EVERYONE]) {
			for (const bucketId of ["health", "food"]) {
				const rows = await listed(alex, bucketId, who);
				const behind = spendingFor(
					spending.filter((spend) => spend.bucketId === bucketId),
					who,
				);
				// The same Transactions as the figure counts, and no others.
				expect(rows.map((row) => row.id).sort(), `${who} ${bucketId}`).toEqual(
					[...new Set(behind.map((spend) => spend.id))].sort(),
				);
				const figure = who === EVERYONE ? totals.household : totals.members[who];
				expect(behind.reduce((sum, spend) => sum + spend.amount, 0)).toBe(
					figure?.buckets[bucketId] ?? 0,
				);
			}
		}
		expect((await listed(alex, "health", "maya")).map((row) => row.id).sort()).toEqual([
			"checkups",
			"dentist",
			"pharmacy",
		]);
		expect((await listed(alex, "food", EVERYONE)).map((row) => row.id)).toEqual(["groceries"]);
	});
});

describe("a Parent's Personal Allowance in the People report", () => {
	it("gives the other Parent its total For Everyone and nothing under any person", async () => {
		const mine = await totalsFor(sam);
		expect(mine.members.leo?.buckets["sam-pa"]).toBe(4_500);
		expect(mine.members.sam?.buckets["sam-pa"]).toBe(700);

		const theirs = await totalsFor(alex);
		// One total, the whole Household's: who it was For would say what it was.
		expect(theirs.household.buckets["sam-pa"]).toBe(5_200);
		for (const person of Object.values(theirs.members))
			expect(person.buckets["sam-pa"]).toBeUndefined();
		// Leo's and Sam's totals as Alex sees them leave it out; Alex's own allowance is still Alex's.
		expect(theirs.members.leo?.total).toBe((mine.members.leo?.total ?? 0) - 4_500);
		expect(theirs.members.sam?.total).toBe((mine.members.sam?.total ?? 0) - 700);
		expect(theirs.members.alex?.buckets["alex-pa"]).toBe(1_900);

		const spending = await loadSpendingBetween(db, alex, from, until);
		expect(spending.map((spend) => spend.id)).not.toContain("sam-gift");
		expect(spending.map((spend) => spend.id)).not.toContain("sam-coffee");
	});

	it("lists none of it for the other Parent, narrowed by its Bucket or by who it was For", async () => {
		expect((await listed(sam, "sam-pa", "leo")).map((row) => row.id)).toEqual(["sam-gift"]);
		for (const who of ["leo", "sam", "maya", "alex", EVERYONE]) {
			expect(await listed(alex, "sam-pa", who), who).toEqual([]);
			const everywhere = (await listed(alex, undefined, who)).map((row) => row.id);
			expect(everywhere).not.toContain("sam-gift");
			expect(everywhere).not.toContain("sam-coffee");
		}
		// And the same the other way round.
		expect(await listed(sam, "alex-pa", "alex")).toEqual([]);
	});
});
