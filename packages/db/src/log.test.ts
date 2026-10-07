import type { LogRow } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addGoal,
	addPersonalAllowance,
	clearHouseholdRows,
	createHouseholdForParent,
	type Db,
	loadLog,
	setAllowance,
	setTakeHomePay,
} from "./index";
import {
	accounts,
	bankConnections,
	freshStarts,
	householdSnapshots,
	members,
	rules,
} from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };
const sam = { householdId, memberId: "sam" };

let db: Db;

/** A day in January 2027, later for a larger `n`: after every Plan change the tests make. */
const later = (n: number) => new Date(Date.UTC(2027, 0, n));

/** What a row says, short enough to compare lists of. */
const said = (row: LogRow) => {
	switch (row.source) {
		case "plan":
			return `${row.change.kind}:${row.change.targetName ?? "-"}`;
		case "rule":
			return `rule:${row.pattern}→${row.targetName}`;
		case "snapshot":
			return `snapshot:${row.kind}`;
		case "fresh-start":
			return `fresh-start:${row.status}`;
		case "bank-connection":
			return `bank:${row.institution}`;
	}
};

/** Every page of the Log for `viewer`, `limit` rows at a time. */
async function whole(viewer = alex, filter: Parameters<typeof loadLog>[2] = {}, limit = 50) {
	const rows: LogRow[] = [];
	let after: Awaited<ReturnType<typeof loadLog>>["next"] = null;
	do {
		const page = await loadLog(db, viewer, { ...filter, limit, after: after ?? undefined });
		expect(page.rows.length).toBeLessThanOrEqual(limit);
		rows.push(...page.rows);
		after = page.next;
	} while (after);
	return rows;
}

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
		allowanceCents: 23_456,
	});
	await setAllowance(db, { ...alex, bucketId: "alex-pa", month: "2026-10", amountCents: 27_890 });
	await setAllowance(db, { ...sam, bucketId: "groceries", month: "2026-10", amountCents: 130_000 });
	await db.insert(rules).values([
		{
			id: "rule-shared",
			householdId,
			pattern: "costco",
			bucketId: "groceries",
			createdByMemberId: "sam",
			createdAt: later(1),
		},
		{
			id: "rule-private",
			householdId,
			pattern: "jeweler",
			bucketId: "alex-pa",
			createdByMemberId: "alex",
			ownerMemberId: "alex",
			createdAt: later(2),
		},
	]);
	const snapshot = { householdId, key: "k", bytes: 1, format: 1, rowCounts: {} };
	await db.insert(householdSnapshots).values([
		{ ...snapshot, id: "snap-night", kind: "nightly", takenBy: null, createdAt: later(3) },
		{
			...snapshot,
			id: "snap-hand",
			kind: "manual",
			takenBy: "sam",
			note: "Before the move",
			createdAt: later(3),
		},
	]);
	await db.insert(freshStarts).values({
		id: "fresh",
		householdId,
		level: "fresh-start",
		requestedBy: "alex",
		runAt: later(5),
		status: "cancelled",
		createdAt: later(4),
	});
	await db.insert(bankConnections).values({
		id: "bank",
		householdId,
		provider: "plaid",
		externalId: "item",
		institution: "First Bank",
		credential: "x",
		status: "ready",
		createdByMemberId: "sam",
		createdAt: later(3),
	});
});

describe("The Log", () => {
	it("lists every change newest first, with who made it and what it was before", async () => {
		const rows = await whole();
		expect(rows.map(said)).toEqual([
			"fresh-start:cancelled",
			"snapshot:manual",
			"bank:First Bank",
			"rule:jeweler→Alex’s Personal Allowance",
			"rule:costco→Groceries",
			"allowance:Groceries",
			"allowance:Alex’s Personal Allowance",
			"bucket-add:Alex’s Personal Allowance",
			"bucket-add:Groceries",
			"baseline:-",
		]);
		expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
		const groceries = rows[5];
		expect(groceries).toMatchObject({
			source: "plan",
			memberId: "sam",
			memberName: "Sam",
			item: "bucket",
			month: "2026-10",
			change: { before: { amount: 120_000 }, after: { amount: 130_000 } },
		});
		expect(rows[0]).toMatchObject({ memberName: "Alex", item: "fresh-start", month: null });
		expect(rows[1]).toMatchObject({ memberName: "Sam", note: "Before the move" });
		expect(rows[2]).toMatchObject({ memberName: "Sam", disconnected: false });
		expect(rows[9]).toMatchObject({ item: "take-home-pay", month });
	});

	it("gives the other Parent's Personal Allowance only as changed, and none of its Rules", async () => {
		const rows = await whole(sam);
		expect(rows.map(said)).toEqual([
			"fresh-start:cancelled",
			"snapshot:manual",
			"bank:First Bank",
			"rule:costco→Groceries",
			"allowance:Groceries",
			"personal-allowance:-",
			"personal-allowance:-",
			"bucket-add:Groceries",
			"baseline:-",
		]);
		// Nothing of it leaves the database: no amounts, no name, no Rule's wording.
		const sent = JSON.stringify(rows);
		expect(sent).not.toContain("Personal Allowance");
		expect(sent).not.toContain("jeweler");
		expect(sent).not.toContain("23456");
		expect(sent).not.toContain("27890");
		const hidden = rows.filter(
			(r) => r.source === "plan" && r.change.kind === "personal-allowance",
		);
		expect(hidden).toHaveLength(2);
		for (const row of hidden) {
			expect(row).toMatchObject({ memberName: "Alex", item: "bucket" });
			expect(row.source === "plan" && [row.change.before, row.change.after]).toEqual([null, null]);
		}
		// Narrowing by kind or person never brings them back in the clear, nor drops them.
		expect((await whole(sam, { item: "bucket" })).map(said)).toEqual([
			"allowance:Groceries",
			"personal-allowance:-",
			"personal-allowance:-",
			"bucket-add:Groceries",
		]);
		expect((await whole(sam, { item: "rule" })).map(said)).toEqual(["rule:costco→Groceries"]);
		expect((await whole(sam, { memberId: "alex" })).map(said)).toEqual([
			"fresh-start:cancelled",
			"personal-allowance:-",
			"personal-allowance:-",
			"bucket-add:Groceries",
			"baseline:-",
		]);
		// Her own she sees whole.
		expect((await whole(alex, { item: "rule" })).map(said)).toEqual([
			"rule:jeweler→Alex’s Personal Allowance",
			"rule:costco→Groceries",
		]);
	});

	it("comes a page at a time, with nothing twice and nothing missed", async () => {
		const all = (await whole()).map((r) => r.key);
		for (const limit of [1, 2, 3, 7]) {
			expect((await whole(alex, {}, limit)).map((r) => r.key)).toEqual(all);
		}
		const first = await loadLog(db, alex, { limit: 4 });
		expect(first.rows).toHaveLength(4);
		expect(first.next).not.toBeNull();
		expect((await loadLog(db, alex, { limit: 10 })).next).toBeNull();
	});

	it("sorts by when and by who, either way, and pages each order whole", async () => {
		const newest = (await whole()).map((r) => r.key);
		const oldest = (await whole(alex, { sort: { by: "when", desc: false } })).map((r) => r.key);
		expect(oldest).toEqual([...newest].reverse());

		const byWho = await whole(alex, { sort: { by: "who", desc: false } });
		const names = byWho.map((r) => r.memberName);
		expect(names).toEqual([...names].sort());
		expect(new Set(names)).toEqual(new Set(["Alex", "Sam"]));
		// Each Parent's changes are newest first, in the order the whole Log has them.
		for (const name of ["Alex", "Sam"]) {
			expect(byWho.filter((r) => r.memberName === name).map((r) => r.key)).toEqual(
				(await whole()).filter((r) => r.memberName === name).map((r) => r.key),
			);
		}
		const zToA = await whole(alex, { sort: { by: "who", desc: true } });
		expect(zToA.map((r) => r.memberName)).toEqual([...names].reverse().sort().reverse());
		expect(zToA[0]?.memberName).toBe("Sam");

		for (const sort of [
			{ by: "when", desc: false },
			{ by: "who", desc: false },
			{ by: "who", desc: true },
		] as const) {
			const all = (await whole(alex, { sort })).map((r) => r.key);
			expect(all).toHaveLength(newest.length);
			for (const limit of [1, 2, 3, 7]) {
				expect((await whole(alex, { sort }, limit)).map((r) => r.key)).toEqual(all);
			}
		}
	});

	it("after a Fresh start keeps the Fresh start and the snapshots; what it cleared is gone", async () => {
		await clearHouseholdRows(db, householdId, "fresh-start");
		expect((await whole()).map(said)).toEqual(["fresh-start:cancelled", "snapshot:manual"]);
		// Who asked for it and who took the snapshot still read: Members are kept.
		expect((await whole()).map((r) => r.memberName)).toEqual(["Alex", "Sam"]);
	});

	it("narrows to who, to a kind of item, and to the month a change takes effect", async () => {
		expect((await whole(alex, { memberId: "sam" })).map(said)).toEqual([
			"snapshot:manual",
			"bank:First Bank",
			"rule:costco→Groceries",
			"allowance:Groceries",
		]);
		expect((await whole(alex, { item: "take-home-pay" })).map(said)).toEqual(["baseline:-"]);
		expect((await whole(alex, { item: "snapshot" })).map(said)).toEqual(["snapshot:manual"]);
		expect((await whole(alex, { item: "bank-connection" })).map(said)).toEqual(["bank:First Bank"]);
		expect((await whole(alex, { item: "fresh-start" })).map(said)).toEqual([
			"fresh-start:cancelled",
		]);
		// Only Plan changes take effect in a month.
		expect((await whole(alex, { month: "2026-10" })).map(said)).toEqual([
			"allowance:Groceries",
			"allowance:Alex’s Personal Allowance",
		]);
		expect(
			(await whole(alex, { month: "2026-10", memberId: "sam", item: "bucket" })).map(said),
		).toEqual(["allowance:Groceries"]);
		expect(await whole(alex, { month: "2026-10", item: "rule" })).toEqual([]);
	});

	it("names a Goal's changes as a Goal's, and keeps to its own Household", async () => {
		await db.insert(accounts).values({
			id: "savings",
			householdId,
			name: "Savings",
			kind: "savings",
		} as typeof accounts.$inferInsert);
		await addGoal(db, {
			householdId,
			goalId: "trip",
			accountId: "savings",
			name: "Trip",
			targetCents: 300_000,
			targetDate: null,
			fromMonth: month,
			claimId: "claim",
			claimCents: 0,
			createdByMemberId: "alex",
		});
		expect((await whole(alex, { item: "goal" })).map(said)).toEqual(["goal-add:Trip"]);
		expect(await whole({ householdId: "elsewhere", memberId: "alex" })).toEqual([]);
	});
});
