import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addAccount, addBucket, createHouseholdForParent, setTakeHomePay } from "./index";
import { applyRule, saveRule } from "./rules";
import { categorizations, members, rules, transactionFor, transactions } from "./schema";
import { exportHouseholdRows } from "./snapshots";
import { testDb } from "./test-db";

// Applying a Rule to a big Household (issue 88): what it costs as the Household grows. The test
// database is SQLite as D1 is, so the shape of the cost is D1's; the times are this machine's.

const householdId = "household";
const month = "2026-09";
const alex = { householdId, memberId: "alex" };

/** D1's cap on one bound value (and one row): 2,000,000 bytes. */
const D1_MAX_VALUE_BYTES = 2_000_000;

const id = (n: number) => `01J${String(n).padStart(23, "0")}`;

/** A Household with `matching` unassigned Costco lines and `others` unassigned lines elsewhere. */
async function household(matching: number, others: number) {
	const db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values({ id: "maya", householdId, kind: "child", name: "Maya" });
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 50_000,
	});
	await addAccount(db, {
		householdId,
		accountId: "card",
		name: "Visa",
		kind: "credit-card",
		balanceCents: 0,
		balanceId: "balance-card",
		createdByMemberId: "alex",
	});
	const rows = Array.from({ length: matching + others }, (_, n) => ({
		id: id(n),
		householdId,
		source: "import" as const,
		date: `2026-${n % 2 ? "09" : "10"}-${String((n % 28) + 1).padStart(2, "0")}`,
		amountCents: 4_200 + n,
		note: n < matching ? `COSTCO WHSE #${n % 40}` : `SHOP ${n}`,
		accountId: "card",
		createdByMemberId: "alex",
	}));
	// Ten rows a statement: eight columns each, under SQLite's and D1's parameter caps.
	for (let i = 0; i < rows.length; i += 10)
		await db.insert(transactions).values(rows.slice(i, i + 10));
	await saveRule(db, {
		id: "costco",
		householdId,
		memberId: "alex",
		pattern: "costco",
		bucketId: "groceries",
		forMemberIds: ["maya"],
	});
	return db;
}

async function timed<T>(work: () => Promise<T>): Promise<[T, number]> {
	const start = performance.now();
	const result = await work();
	return [result, performance.now() - start];
}

describe("applying a Rule to many Transactions", () => {
	it("files thousands at once, with For, a count on the Rule and one categorization each", async () => {
		const db = await household(3_000, 500);
		const result = await applyRule(db, alex, "costco");
		expect(result).toEqual({ filed: 3_000, months: ["2026-09", "2026-10"] });
		const filed = await db
			.select({ id: transactions.id, version: transactions.version })
			.from(transactions)
			.where(
				and(eq(transactions.householdId, householdId), eq(transactions.bucketId, "groceries")),
			);
		expect(filed).toHaveLength(3_000);
		// Each changed once: a screen holding the old version is told it's out of date.
		expect(new Set(filed.map((row) => row.version))).toEqual(new Set([1]));
		expect(await db.select().from(transactionFor)).toHaveLength(3_000);
		expect(
			await db.select().from(categorizations).where(eq(categorizations.outcome, "filed")),
		).toHaveLength(3_000);
		const [rule] = await db.select().from(rules).where(eq(rules.id, "costco"));
		expect(rule?.matchedCount).toBe(3_000);
		// The other 500 are untouched, and a second apply finds nothing left.
		expect(await applyRule(db, alex, "costco")).toEqual({ filed: 0, months: [] });
	}, 60_000);

	it("costs in step with how many it files, not with their square", async () => {
		const times: Record<number, number> = {};
		for (const n of [2_000, 8_000]) {
			const db = await household(n, n);
			const [result, ms] = await timed(() => applyRule(db, alex, "costco"));
			expect(result.filed).toBe(n);
			times[n] = ms;
		}
		console.info("Rule apply", JSON.stringify(times));
		// Four times the Transactions: about four times the work. Sixteen times would be the
		// square; ten leaves room for a busy machine.
		// (Before issue 88's fix, 4,000 took 59 seconds against 3 for 1,000.)
		expect((times[8_000] as number) / (times[2_000] as number)).toBeLessThan(10);
		expect(times[8_000] as number).toBeLessThan(5_000);
	}, 120_000);

	it("takes its snapshot's rows in step with the Household's size", async () => {
		const db = await household(4_000, 4_000);
		const [{ rowCounts }, ms] = await timed(() => exportHouseholdRows(db, householdId));
		console.info("Snapshot rows for 8,000 Transactions", `${Math.round(ms)} ms`);
		expect(rowCounts.transactions).toBe(8_000);
		expect(ms).toBeLessThan(5_000);
	}, 60_000);

	it("keeps every bound value under D1's cap however many it files", async () => {
		const db = await household(12_000, 0);
		const seen: number[] = [];
		const spy = db as unknown as {
			batch: (queries: { toSQL(): { params: unknown[] } }[]) => unknown;
		};
		const batch = spy.batch.bind(db);
		spy.batch = (queries) => {
			for (const query of queries)
				for (const param of query.toSQL().params)
					if (typeof param === "string") seen.push(new TextEncoder().encode(param).length);
			return batch(queries);
		};
		expect((await applyRule(db, alex, "costco")).filed).toBe(12_000);
		expect(seen.length).toBeGreaterThan(0);
		expect(Math.max(...seen)).toBeLessThan(D1_MAX_VALUE_BYTES);
	}, 120_000);
});
