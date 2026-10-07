import type { LogRow } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addGoal,
	addPersonalAllowance,
	archiveAccount,
	clearHouseholdRows,
	createHouseholdForParent,
	type Db,
	deleteMoneyInRule,
	deleteRule,
	forgetCardPayment,
	listLogEvents,
	loadLog,
	markBankConnectionDisconnected,
	removeBankConnection,
	restoreAccount,
	saveMoneyInRule,
	setAllowance,
	setTakeHomePay,
} from "./index";
import {
	accounts,
	bankConnections,
	cardPaymentRules,
	freshStarts,
	householdSnapshots,
	logEvents,
	members,
	moneyInPairs,
	moneyInRules,
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
		case "money-in-rule":
			return `money-in:${row.pattern}→${row.pair ? "pair" : row.kind}`;
		case "card-payment-rule":
			return `card-payment:${row.pattern}→${row.cardName}`;
		case "event":
			return `${row.event}:${row.name}→${row.detail}`;
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

	describe("what is removed (issue 141)", () => {
		it("a removed Rule still shows as made, by who made it and when, and as removed", async () => {
			await deleteRule(db, alex, "rule-shared");
			const rows = await whole(alex, { item: "rule" });
			// The Rules here were made on days in 2027, so today's removal sorts as the oldest.
			expect(rows.map(said)).toEqual([
				"rule:jeweler→Alex’s Personal Allowance",
				"rule-made:costco→Groceries",
				"rule-removed:costco→Groceries",
			]);
			// Made by Sam on the day she made it; removed by Alex just now.
			expect(rows[1]).toMatchObject({ memberName: "Sam", at: later(1).getTime(), item: "rule" });
			expect(rows[2]).toMatchObject({ memberName: "Alex", item: "rule", month: null });
			expect(Math.abs((rows[2]?.at ?? 0) - Date.now())).toBeLessThan(60_000);
			expect(await db.select().from(rules)).toHaveLength(1);
			// Removing it again, or one that was never there, writes nothing more.
			await deleteRule(db, alex, "rule-shared");
			await deleteRule(db, alex, "no-such-rule");
			expect(await db.select().from(logEvents)).toHaveLength(2);
			// Sam, who made it, reads the same two rows.
			expect((await whole(sam, { item: "rule" })).map(said)).toEqual([
				"rule-made:costco→Groceries",
				"rule-removed:costco→Groceries",
			]);
			expect((await whole(alex, { memberId: "sam", item: "rule" })).map(said)).toEqual([
				"rule-made:costco→Groceries",
			]);
		});

		it("never shows the other Parent a removed Rule into a Personal Allowance, nor lets them remove it", async () => {
			// Sam can't see it, so she can't remove it, and nothing is recorded.
			await deleteRule(db, sam, "rule-private");
			expect(await db.select().from(logEvents)).toHaveLength(0);
			expect(await db.select().from(rules)).toHaveLength(2);

			await deleteRule(db, alex, "rule-private");
			expect((await whole(alex, { item: "rule" })).map(said)).toEqual([
				"rule-made:jeweler→Alex’s Personal Allowance",
				"rule:costco→Groceries",
				"rule-removed:jeweler→Alex’s Personal Allowance",
			]);
			for (const filter of [{}, { item: "rule" }, { memberId: "alex" }] as const) {
				for (const sort of [
					{ by: "when", desc: true },
					{ by: "who", desc: false },
				] as const) {
					const sent = JSON.stringify(await whole(sam, { ...filter, sort }));
					expect(sent).not.toContain("jeweler");
					expect(sent).not.toContain("Personal Allowance");
					expect(sent).not.toContain("rule-private");
				}
			}
			expect(JSON.stringify(await listLogEvents(db, sam))).not.toContain("jeweler");
			expect(
				(await listLogEvents(db, alex)).map((e) => `${e.kind}:${e.name}:${e.memberName}`).sort(),
			).toEqual(["rule-made:jeweler:Alex", "rule-removed:jeweler:Alex"]);
		});

		it("has Rules for money in and card payments remembered, as made and as removed", async () => {
			await db.insert(accounts).values([
				{ id: "checking", householdId, name: "Checking", kind: "checking" },
				{ id: "visa", householdId, name: "Visa", kind: "credit-card" },
			] as (typeof accounts.$inferInsert)[]);
			await saveMoneyInRule(db, sam, { ruleId: "pay", wording: "ACME PAYROLL", kind: "income" });
			await db.insert(moneyInRules).values({
				id: "pair",
				householdId,
				pattern: "zelle from savings",
				kind: "transfer",
				createdByMemberId: "alex",
				intoAccountId: "checking",
				otherAccountId: "visa",
				createdAt: later(6),
			});
			await db.insert(cardPaymentRules).values({
				id: "card",
				householdId,
				pattern: "visa payment",
				accountId: "visa",
				createdByMemberId: "sam",
				createdAt: later(7),
			});
			await db
				.update(moneyInRules)
				.set({ createdAt: later(8) })
				.where(eq(moneyInRules.id, "pay"));
			expect((await whole(sam, { item: "rule" })).map(said).slice(0, 3)).toEqual([
				"money-in:acme payroll→income",
				"card-payment:visa payment→Visa",
				"money-in:zelle from savings→pair",
			]);
			expect((await whole(alex, { memberId: "sam", item: "rule" })).map(said)).toEqual([
				"money-in:acme payroll→income",
				"card-payment:visa payment→Visa",
				"rule:costco→Groceries",
			]);

			await deleteMoneyInRule(db, householdId, "pay", "alex");
			await deleteMoneyInRule(db, householdId, "pair", "alex");
			await forgetCardPayment(db, householdId, "visa payment", "alex");
			await forgetCardPayment(db, householdId, "visa payment", "alex");
			expect(await db.select().from(moneyInRules)).toHaveLength(0);
			expect(await db.select().from(cardPaymentRules)).toHaveLength(0);
			const rows = await whole(alex, { item: "rule" });
			expect(
				rows
					.map(said)
					.filter((s) => !s.startsWith("rule:"))
					.sort(),
			).toEqual([
				"card-payment-rule-made:visa payment→Visa",
				"card-payment-rule-removed:visa payment→Visa",
				"money-in-rule-made:acme payroll→income",
				"money-in-rule-made:zelle from savings→pair",
				"money-in-rule-removed:acme payroll→income",
				"money-in-rule-removed:zelle from savings→pair",
			]);
			const made = rows.find((r) => r.key === "event:pay:made");
			expect(made).toMatchObject({ memberName: "Sam", at: later(8).getTime() });
			expect(rows.find((r) => r.key === "event:pay:removed")).toMatchObject({ memberName: "Alex" });
			// Another Household's removal with the same IDs touches nothing here.
			await deleteMoneyInRule(db, "elsewhere", "pay", "alex");
			expect(await db.select().from(logEvents)).toHaveLength(6);
		});

		it("has a remembered pair of Accounts from either home, as made and as removed", async () => {
			await db.insert(accounts).values([
				{ id: "checking", householdId, name: "Checking", kind: "checking" },
				{ id: "savings", householdId, name: "Savings", kind: "savings" },
			] as (typeof accounts.$inferInsert)[]);
			// Kept before pairs had their own table, and after.
			await db.insert(moneyInRules).values({
				id: "old",
				householdId,
				pattern: "old transfer",
				kind: "transfer",
				createdByMemberId: "alex",
				intoAccountId: "checking",
				otherAccountId: "savings",
				createdAt: later(6),
			});
			await db.insert(moneyInPairs).values([
				{
					id: "new",
					householdId,
					pattern: "new transfer",
					intoAccountId: "checking",
					otherAccountId: "savings",
					createdByMemberId: "sam",
					createdAt: later(7),
				},
				{
					id: "new-2",
					householdId,
					pattern: "new transfer",
					intoAccountId: "savings",
					otherAccountId: "checking",
					createdByMemberId: "sam",
					createdAt: later(8),
				},
			]);
			const live = await whole(alex, { item: "rule" }, 2);
			expect(live.map(said).slice(0, 3)).toEqual([
				"money-in:new transfer→pair",
				"money-in:new transfer→pair",
				"money-in:old transfer→pair",
			]);
			expect(live.slice(0, 2).map((r) => [r.key, r.memberName, r.at])).toEqual([
				["money-in-pair:new-2", "Sam", later(8).getTime()],
				["money-in-pair:new", "Sam", later(7).getTime()],
			]);
			expect(new Set(live.map((r) => r.key)).size).toBe(live.length);
			expect((await whole(alex, { memberId: "sam", item: "rule" })).map(said).slice(0, 2)).toEqual([
				"money-in:new transfer→pair",
				"money-in:new transfer→pair",
			]);
			expect((await whole(alex, { item: "bucket" })).map(said)).not.toContain(
				"money-in:new transfer→pair",
			);

			// One pair removed on its own; the other goes when the wording is stated plainly.
			await deleteMoneyInRule(db, householdId, "new", "alex");
			await deleteMoneyInRule(db, householdId, "new", "alex");
			await deleteMoneyInRule(db, "elsewhere", "new-2", "alex");
			await saveMoneyInRule(db, alex, { ruleId: "plain", wording: "NEW TRANSFER", kind: "income" });
			await saveMoneyInRule(db, alex, {
				ruleId: "plain-2",
				wording: "OLD TRANSFER",
				kind: "income",
			});
			expect(await db.select().from(moneyInPairs)).toHaveLength(0);
			const rows = await whole(alex, { item: "rule" });
			expect(
				rows
					.map((r) => `${said(r)} by ${r.memberName}`)
					.filter((s) => s.startsWith("money-in"))
					.sort(),
			).toEqual([
				"money-in-rule-made:new transfer→pair by Sam",
				"money-in-rule-made:new transfer→pair by Sam",
				"money-in-rule-made:old transfer→pair by Alex",
				"money-in-rule-removed:new transfer→pair by Alex",
				"money-in-rule-removed:new transfer→pair by Alex",
				"money-in-rule-removed:old transfer→pair by Alex",
				"money-in:new transfer→income by Alex",
				"money-in:old transfer→income by Alex",
			]);
			expect(rows.find((r) => r.key === "event:new-2:made")).toMatchObject({
				at: later(8).getTime(),
			});
			// The plain Rule that took the old pair's place is recorded on its own when it goes.
			await deleteMoneyInRule(db, householdId, "old", "sam");
			expect(
				(await listLogEvents(db, alex))
					.filter((e) => e.name === "old transfer")
					.map((e) => `${e.kind}:${e.detail}:${e.memberName}`)
					.sort(),
			).toEqual([
				"money-in-rule-made:income:Alex",
				"money-in-rule-made:pair:Alex",
				"money-in-rule-removed:income:Sam",
				"money-in-rule-removed:pair:Alex",
			]);
		});

		it("has a Bank Connection disconnected, by a Parent or at the bank, and an Account archived", async () => {
			expect(await markBankConnectionDisconnected(db, householdId, "bank")).toBe(true);
			expect(await markBankConnectionDisconnected(db, householdId, "bank")).toBe(false);
			expect(await removeBankConnection(db, householdId, "bank", "alex")).toBe(true);
			expect(await removeBankConnection(db, householdId, "bank", "alex")).toBe(false);
			const bank = await whole(alex, { item: "bank-connection" });
			expect(bank.map(said).sort()).toEqual([
				"bank-connection-disconnected:First Bank→null",
				"bank-connection-removed:First Bank→null",
				"bank:First Bank",
			]);
			expect(
				bank.find((r) => r.source === "event" && r.event === "bank-connection-removed"),
			).toMatchObject({
				memberName: "Alex",
			});
			expect(
				bank.find((r) => r.source === "event" && r.event === "bank-connection-disconnected"),
			).toMatchObject({ memberName: null, memberId: null });

			await db.insert(accounts).values({
				id: "old-card",
				householdId,
				name: "Old card",
				kind: "credit-card",
			} as typeof accounts.$inferInsert);
			const now = new Date();
			expect(
				await archiveAccount(db, { householdId, accountId: "old-card", memberId: "sam", now }),
			).toEqual({ ok: true });
			// Archived already: refused, and nothing more is recorded.
			expect(
				await archiveAccount(db, { householdId, accountId: "old-card", memberId: "sam" }),
			).toMatchObject({ ok: false });
			const archived = await whole(alex, { item: "account" });
			expect(archived.map(said)).toEqual(["account-archived:Old card→null"]);
			expect(archived[0]).toMatchObject({ memberName: "Sam", item: "account", at: now.getTime() });
			expect(await whole(alex, { item: "account", month: "2026-10" })).toEqual([]);

			// Brought back: on record too, once.
			const back = new Date(now.getTime() + 1000);
			expect(
				await restoreAccount(db, { householdId: "elsewhere", accountId: "old-card", now: back }),
			).toBe(false);
			expect(
				await restoreAccount(db, {
					householdId,
					accountId: "old-card",
					memberId: "alex",
					now: back,
				}),
			).toBe(true);
			expect(
				await restoreAccount(db, { householdId, accountId: "old-card", memberId: "alex" }),
			).toBe(false);
			const account = await whole(alex, { item: "account" });
			expect(account.map((r) => `${said(r)} by ${r.memberName}`)).toEqual([
				"account-restored:Old card→null by Alex",
				"account-archived:Old card→null by Sam",
			]);
			expect(account[0]).toMatchObject({ item: "account", at: back.getTime() });
		});

		it("says a Bank Connection was disconnected since only when no record of it says so", async () => {
			const connected = async () =>
				(await whole(alex, { item: "bank-connection" })).find(
					(r) => r.source === "bank-connection",
				);
			expect(await connected()).toMatchObject({ disconnected: false });
			// Disconnected before the Log kept its own record: only the row says so.
			await db
				.update(bankConnections)
				.set({ status: "disconnected" })
				.where(eq(bankConnections.id, "bank"));
			expect(await connected()).toMatchObject({ disconnected: true });
			await db
				.update(bankConnections)
				.set({ status: "ready" })
				.where(eq(bankConnections.id, "bank"));
			// Disconnected since: its own row says it, so "Connected" doesn't say it again.
			expect(await removeBankConnection(db, householdId, "bank", "alex")).toBe(true);
			expect(await connected()).toMatchObject({ disconnected: false });
			expect((await whole(alex, { item: "bank-connection" })).map(said).sort()).toEqual([
				"bank-connection-removed:First Bank→null",
				"bank:First Bank",
			]);
		});

		it("pages every order whole with removed things in it", async () => {
			await deleteRule(db, alex, "rule-shared");
			await removeBankConnection(db, householdId, "bank", "sam");
			await saveMoneyInRule(db, sam, { ruleId: "pay", wording: "ACME PAYROLL", kind: "income" });
			for (const sort of [
				{ by: "when", desc: true },
				{ by: "when", desc: false },
				{ by: "who", desc: false },
				{ by: "who", desc: true },
			] as const) {
				const all = (await whole(alex, { sort })).map((r) => r.key);
				expect(all).toHaveLength(13);
				expect(new Set(all).size).toBe(13);
				for (const limit of [1, 2, 3, 7]) {
					expect((await whole(alex, { sort }, limit)).map((r) => r.key)).toEqual(all);
				}
			}
		});

		it("is kept through a Fresh start, and cleared when the Household is deleted", async () => {
			await deleteRule(db, alex, "rule-shared");
			await removeBankConnection(db, householdId, "bank", "sam");
			await clearHouseholdRows(db, householdId, "fresh-start");
			expect((await whole()).map(said).sort()).toEqual([
				"bank-connection-removed:First Bank→null",
				"fresh-start:cancelled",
				"rule-made:costco→Groceries",
				"rule-removed:costco→Groceries",
				"snapshot:manual",
			]);
			await clearHouseholdRows(db, householdId, "delete");
			expect(await db.select().from(logEvents)).toHaveLength(0);
		});
	});

	it("orders by who the same in the database and in the merge, with accents and emoji in names", async () => {
		// "ﬁ" (U+FB01) sorts after an emoji in UTF-16 and before it by code point, as SQLite has it.
		await db.update(members).set({ name: "ﬁona" }).where(eq(members.id, "alex"));
		await db.update(members).set({ name: "😀 Sam" }).where(eq(members.id, "sam"));
		await db.insert(members).values([
			{ id: "em", householdId, kind: "parent", name: "Émile", clerkUserId: "clerk-em" },
			{ id: "zo", householdId, kind: "parent", name: "Zoë", clerkUserId: "clerk-zo" },
		]);
		await setAllowance(db, {
			householdId,
			memberId: "em",
			bucketId: "groceries",
			month: "2026-11",
			amountCents: 1,
		});
		await db.insert(rules).values({
			id: "rule-zo",
			householdId,
			pattern: "aldi",
			bucketId: "groceries",
			createdByMemberId: "zo",
			createdAt: later(9),
		});
		const order = ["Zoë", "Émile", "ﬁona", "😀 Sam"];
		for (const desc of [false, true]) {
			const sort = { by: "who", desc } as const;
			const all = await whole(alex, { sort });
			const names = all.map((r) => r.memberName);
			expect([...new Set(names)]).toEqual(desc ? [...order].reverse() : order);
			for (const limit of [1, 2, 3]) {
				expect((await whole(alex, { sort }, limit)).map((r) => r.key)).toEqual(
					all.map((r) => r.key),
				);
			}
		}
	});
});
