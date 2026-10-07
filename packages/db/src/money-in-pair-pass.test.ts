import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	createHouseholdForParent,
	type Db,
	deleteMoneyInRule,
	householdsAwaitingMoneyInPairPass,
	loadLog,
	loadMoneyInRules,
	runMoneyInPairPass,
	runMoneyInPairPasses,
} from "./index";
import {
	accounts,
	householdPasses,
	income,
	logEvents,
	moneyInPairs,
	moneyInRules,
	transfers,
} from "./schema";
import { testDb } from "./test-db";

// The one-time pass of issue 142: a pair of Accounts remembered before pairs had a table of their
// own (kept on `money_in_rules`) is carried there as it was made: the same id, Parent and day, so
// the Log goes on saying when it was made and by whom.

const householdId = "household";
const viewer = { householdId, memberId: "alex" };
const made = new Date(Date.UTC(2026, 8, 14, 15, 30));

let db: Db;
let nextId = 0;
const newId = () => `run-${++nextId}`;

/** A pair kept the old way: on the money-in Rule itself. */
const oldPair = (
	id: string,
	pattern: string,
	more: Partial<typeof moneyInRules.$inferInsert> = {},
) =>
	db.insert(moneyInRules).values({
		id,
		householdId,
		pattern,
		kind: "transfer",
		createdByMemberId: "alex",
		intoAccountId: "checking",
		otherAccountId: "savings",
		createdAt: made,
		...more,
	});

const ruleRows = () =>
	db.select().from(moneyInRules).where(eq(moneyInRules.householdId, householdId));
const pairRows = () =>
	db.select().from(moneyInPairs).where(eq(moneyInPairs.householdId, householdId));
const inLog = async () =>
	(await loadLog(db, viewer, { item: "rule" })).rows.map((row) => [
		row.key,
		row.source === "money-in-rule" ? `${row.pattern}→${row.pair ? "pair" : row.kind}` : row.source,
		row.memberName,
		row.at,
	]);

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(accounts).values([
		{ id: "checking", householdId, name: "Checking", kind: "checking" },
		{ id: "savings", householdId, name: "Savings", kind: "savings" },
	] as (typeof accounts.$inferInsert)[]);
});

describe("the one-time pass that carries remembered pairs of Accounts to their own table", () => {
	it("carries an old pair as it was made, and leaves plain Rules alone", async () => {
		await oldPair("old", "transfer from savings");
		await db.insert(moneyInRules).values({
			id: "plain",
			householdId,
			pattern: "acme payroll",
			kind: "income",
			createdByMemberId: "alex",
			createdAt: made,
		});
		const rulesBefore = await loadMoneyInRules(db, householdId);
		expect(await householdsAwaitingMoneyInPairPass(db)).toEqual([householdId]);

		expect(await runMoneyInPairPass(db, householdId, { runId: "run-a" })).toEqual({
			ran: true,
			carried: 1,
		});

		expect(await pairRows()).toEqual([
			{
				id: "old",
				householdId,
				pattern: "transfer from savings",
				intoAccountId: "checking",
				otherAccountId: "savings",
				createdByMemberId: "alex",
				createdAt: made,
			},
		]);
		expect((await ruleRows()).map((row) => row.id)).toEqual(["plain"]);
		// What Noodle reads the Rules as is the same as before.
		expect(await loadMoneyInRules(db, householdId)).toEqual(rulesBefore);
		// The Log has it once, made when and by whom it was, like any pair remembered since.
		expect((await inLog()).filter(([, said]) => said === "transfer from savings→pair")).toEqual([
			["money-in-pair:old", "transfer from savings→pair", "Alex", made.getTime()],
		]);
		expect(await db.select().from(logEvents)).toEqual([]);
		expect(await householdsAwaitingMoneyInPairPass(db)).toEqual([]);
		const [marker] = await db.select().from(householdPasses);
		expect(marker).toMatchObject({ runId: "run-a", changed: 1, snapshotId: null });
	});

	it("runs once: a pair that turns up in the old home afterwards stays there", async () => {
		expect(await runMoneyInPairPass(db, householdId, { runId: "run-a" })).toEqual({
			ran: true,
			carried: 0,
		});
		await oldPair("old", "transfer from savings");
		expect(await runMoneyInPairPass(db, householdId, { runId: "run-b" })).toEqual({
			ran: false,
			carried: 0,
		});
		expect(await pairRows()).toEqual([]);
		expect((await ruleRows()).map((row) => row.id)).toEqual(["old"]);
	});

	it("leaves an old pair whose wording and Account have been remembered again since", async () => {
		await oldPair("old", "transfer from savings");
		await db.insert(moneyInPairs).values({
			id: "said-again",
			householdId,
			pattern: "transfer from savings",
			intoAccountId: "checking",
			otherAccountId: "savings",
			createdByMemberId: "alex",
			createdAt: new Date(Date.UTC(2026, 9, 6)),
		});
		expect(await runMoneyInPairPass(db, householdId, { runId: "run-a" })).toEqual({
			ran: true,
			carried: 0,
		});
		expect((await pairRows()).map((row) => row.id)).toEqual(["said-again"]);
		expect((await ruleRows()).map((row) => row.id)).toEqual(["old"]);
	});

	it("touches no money: lines and Transfers are as they were", async () => {
		await oldPair("old", "transfer from savings");
		await db.insert(income).values({
			id: "in-august",
			householdId,
			date: "2026-08-03",
			amountCents: 50_000,
			note: "TRANSFER FROM SAVINGS",
			accountId: "checking",
		} as typeof income.$inferInsert);
		const before = [await db.select().from(income), await db.select().from(transfers)];
		await runMoneyInPairPass(db, householdId, { runId: "run-a" });
		expect([await db.select().from(income), await db.select().from(transfers)]).toEqual(before);
	});

	it("a carried pair removed later is in the Log as made on its first day", async () => {
		await oldPair("old", "transfer from savings");
		await runMoneyInPairPass(db, householdId, { runId: "run-a" });
		await deleteMoneyInRule(db, householdId, "old", "alex");
		const events = await db.select().from(logEvents);
		expect(events.map((event) => [event.id, event.kind, event.createdAt.getTime()])).toContainEqual(
			["old:pair:made", "money-in-rule-made", made.getTime()],
		);
	});

	it("runs for every Household still waiting, each once", async () => {
		await oldPair("old", "transfer from savings");
		expect(await runMoneyInPairPasses(db, newId)).toEqual({ households: 1, carried: 1, failed: 0 });
		expect(await runMoneyInPairPasses(db, newId)).toEqual({ households: 0, carried: 0, failed: 0 });
	});
});
