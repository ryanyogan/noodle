import { type DayKey, merchantKey, type StatementLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	changeMoneyInKind,
	createHouseholdForParent,
	type Db,
	deleteMoneyInRule,
	importStatement,
	loadMoneyIn,
	loadMoneyInRules,
	rememberAccountPair,
	saveMoneyInRule,
} from "./index";
import { income, moneyInRules, transactions, transfers } from "./schema";
import { testDb } from "./test-db";

// A remembered pair of Accounts (issue 131, ADR-0057): "money from Gusto into Chase is always a
// Transfer", whatever the days, and one-sided naming Gusto when only Chase is seen.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const GUSTO = "GUSTO ACME CORP";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

const importInto = (accountId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId: newId(),
		accountId,
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: parentId,
		newId,
	});

const on = async (date: DayKey) => {
	const found = (await loadMoneyIn(db, householdId)).find((row) => row.date === date);
	if (!found) throw new Error(`no money in on ${date}`);
	return found;
};

/** The first Gusto line lands as Income; a Parent calls it a Transfer and names Gusto. */
async function remember() {
	await importInto("chase", [line("2026-09-03", 250_000, GUSTO)]);
	const first = await on("2026-09-03");
	expect(first.kind).toBe("income");
	await changeMoneyInKind(db, viewer, {
		incomeId: first.id,
		kind: "transfer",
		transferId: newId(),
	});
	return rememberAccountPair(db, viewer, {
		incomeId: first.id,
		otherAccountId: "gusto",
		ruleId: "pair-rule",
	});
}

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	for (const [accountId, name] of [
		["chase", "Chase"],
		["gusto", "Gusto"],
		["savings", "Savings"],
	] as const)
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind: accountId === "savings" ? "savings" : "checking",
			balanceCents: 0,
			balanceId: `${accountId}-balance`,
			createdByMemberId: parentId,
		});
});

describe("a remembered pair of Accounts", () => {
	it("names the other Account on the line and keeps the Rule", async () => {
		const result = await remember();
		expect(result.ok).toBe(true);
		const first = await on("2026-09-03");
		expect(first).toMatchObject({ kind: "transfer", paired: false, otherAccountId: "gusto" });
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{
				id: "pair-rule",
				kind: "transfer",
				intoAccountId: "chase",
				otherAccountId: "gusto",
				intoAccountName: "Chase",
				otherAccountName: "Gusto",
			},
		]);
	});

	it("marks later money in alone, naming the other Account, when only one side is seen", async () => {
		await remember();
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		expect(await on("2026-09-17")).toMatchObject({
			kind: "transfer",
			needsReview: false,
			paired: false,
			otherAccountId: "gusto",
		});
	});

	it("pairs with the money out of the other Account however many days apart", async () => {
		await remember();
		await importInto("gusto", [
			line("2026-09-20", -270_000, "PAYOUT"),
			line("2026-10-01", -270_000, "PAYOUT"),
		]);
		await importInto("chase", [line("2026-10-19", 270_000, GUSTO)]);
		const arrived = await on("2026-10-19");
		expect(arrived).toMatchObject({ kind: "transfer", paired: true });
		// The nearest of the two, and only that one.
		const [pair] = await db
			.select({ date: transactions.date })
			.from(transfers)
			.innerJoin(transactions, eq(transactions.id, transfers.outTransactionId))
			.where(eq(transfers.inIncomeId, arrived.id));
		expect(pair?.date).toBe("2026-10-01");
	});

	it("joins the money out that is imported after the money in was marked alone", async () => {
		await remember();
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		expect(await on("2026-09-17")).toMatchObject({ paired: false, otherAccountId: "gusto" });
		// Gusto's own statement comes in later: both payouts, and one that is nothing of Chase's.
		await importInto("gusto", [
			line("2026-09-02", -250_000, "PAYOUT"),
			line("2026-09-16", -261_300, "PAYOUT"),
			line("2026-09-20", -4_000, "FEE"),
		]);
		expect(await on("2026-09-03")).toMatchObject({ kind: "transfer", paired: true });
		expect(await on("2026-09-17")).toMatchObject({ kind: "transfer", paired: true });
		const outs = await db
			.select({ date: transactions.date, income: transfers.inIncomeId })
			.from(transfers)
			.innerJoin(transactions, eq(transactions.id, transfers.outTransactionId))
			.orderBy(transactions.date);
		expect(outs.map((out) => out.date)).toEqual(["2026-09-02", "2026-09-16"]);
		// Each line keeps its one Transfer: nothing was marked twice.
		expect(await db.select({ id: transfers.id }).from(transfers)).toHaveLength(2);
	});

	it("gives each line marked alone its own money out, the nearest", async () => {
		await remember();
		await importInto("chase", [
			line("2026-09-17", 250_000, GUSTO),
			line("2026-10-01", 250_000, GUSTO),
		]);
		await importInto("gusto", [
			line("2026-09-30", -250_000, "PAYOUT"),
			line("2026-09-16", -250_000, "PAYOUT"),
		]);
		const pairs = await db
			.select({ into: income.date, out: transactions.date })
			.from(transfers)
			.innerJoin(transactions, eq(transactions.id, transfers.outTransactionId))
			.innerJoin(income, eq(income.id, transfers.inIncomeId))
			.orderBy(income.date);
		// Two payouts for three lines: the nearest pairs, and one line stays alone.
		expect(pairs).toEqual([
			{ into: "2026-09-17", out: "2026-09-16" },
			{ into: "2026-10-01", out: "2026-09-30" },
		]);
		expect(await on("2026-09-03")).toMatchObject({ paired: false, otherAccountId: "gusto" });
	});

	it("leaves a line a Parent unmarked alone when its money out comes in", async () => {
		await remember();
		const first = await on("2026-09-03");
		await changeMoneyInKind(db, viewer, {
			incomeId: first.id,
			kind: "income",
			transferId: newId(),
		});
		// Too many days apart to be found as a Transfer by amount and day.
		await importInto("gusto", [line("2026-08-01", -250_000, "PAYOUT")]);
		expect(await on("2026-09-03")).toMatchObject({ kind: "income", paired: false });
	});

	it("speaks only for money into its own Account", async () => {
		await remember();
		await importInto("savings", [line("2026-09-18", 5_000, GUSTO)]);
		expect((await on("2026-09-18")).kind).toBe("income");
	});

	it("stops once the Rule is removed", async () => {
		await remember();
		await deleteMoneyInRule(db, householdId, "pair-rule");
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		expect((await on("2026-09-17")).kind).toBe("income");
	});

	it("is refused for a line that isn't a Transfer, or for the Account it came into", async () => {
		await importInto("chase", [line("2026-09-03", 250_000, GUSTO)]);
		const first = await on("2026-09-03");
		const ask = (otherAccountId: string) =>
			rememberAccountPair(db, viewer, { incomeId: first.id, otherAccountId, ruleId: newId() });
		expect(await ask("gusto")).toEqual({ ok: false, reason: "refused" });
		await changeMoneyInKind(db, viewer, {
			incomeId: first.id,
			kind: "transfer",
			transferId: newId(),
		});
		expect(await ask("chase")).toEqual({ ok: false, reason: "refused" });
		expect(await ask("someone-elses")).toEqual({ ok: false, reason: "refused" });
		expect(await loadMoneyInRules(db, householdId)).toEqual([]);
	});
});

describe("the same wording into two Accounts", () => {
	/** Gusto into Savings too: a second pair, from Chase this time. */
	async function rememberSavings() {
		await importInto("savings", [line("2026-09-04", 40_000, GUSTO)]);
		const first = await on("2026-09-04");
		await changeMoneyInKind(db, viewer, {
			incomeId: first.id,
			kind: "transfer",
			transferId: newId(),
		});
		return rememberAccountPair(db, viewer, {
			incomeId: first.id,
			otherAccountId: "chase",
			ruleId: "pair-savings",
		});
	}

	it("holds a pair for each, and each speaks for its own Account", async () => {
		await remember();
		expect(await rememberSavings()).toMatchObject({ ok: true });
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ id: "pair-rule", kind: "transfer", intoAccountName: "Chase", otherAccountName: "Gusto" },
			{
				id: "pair-savings",
				kind: "transfer",
				intoAccountName: "Savings",
				otherAccountName: "Chase",
			},
		]);
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		await importInto("savings", [line("2026-09-18", 41_000, GUSTO)]);
		expect(await on("2026-09-17")).toMatchObject({ kind: "transfer", otherAccountId: "gusto" });
		expect(await on("2026-09-18")).toMatchObject({ kind: "transfer", otherAccountId: "chase" });
	});

	it("removes one pair at a time", async () => {
		await remember();
		await rememberSavings();
		await deleteMoneyInRule(db, householdId, "pair-rule");
		expect((await loadMoneyInRules(db, householdId)).map((rule) => rule.id)).toEqual([
			"pair-savings",
		]);
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		await importInto("savings", [line("2026-09-18", 41_000, GUSTO)]);
		expect((await on("2026-09-17")).kind).toBe("income");
		expect((await on("2026-09-18")).kind).toBe("transfer");
	});

	it("said again for the same Account, names the new one and stays one pair", async () => {
		await remember();
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		const again = await on("2026-09-17");
		expect(again).toMatchObject({ kind: "transfer", paired: false });
		expect(
			await rememberAccountPair(db, viewer, {
				incomeId: again.id,
				otherAccountId: "savings",
				ruleId: "pair-again",
			}),
		).toMatchObject({ ok: true });
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ id: "pair-rule", intoAccountName: "Chase", otherAccountName: "Savings" },
		]);
	});

	it("keeps a plain Rule for the wording beside a pair, and the pair speaks for its Account", async () => {
		await saveMoneyInRule(db, viewer, { ruleId: "plain", wording: GUSTO, kind: "paid-back" });
		await importInto("chase", [line("2026-09-03", 250_000, GUSTO)]);
		const first = await on("2026-09-03");
		expect(first.kind).toBe("paid-back");
		await changeMoneyInKind(db, viewer, {
			incomeId: first.id,
			kind: "transfer",
			transferId: newId(),
		});
		await rememberAccountPair(db, viewer, {
			incomeId: first.id,
			otherAccountId: "gusto",
			ruleId: "pair-rule",
		});
		expect((await loadMoneyInRules(db, householdId)).map((rule) => rule.id).sort()).toEqual([
			"pair-rule",
			"plain",
		]);
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		await importInto("savings", [line("2026-09-18", 41_000, GUSTO)]);
		expect((await on("2026-09-17")).kind).toBe("transfer");
		expect((await on("2026-09-18")).kind).toBe("paid-back");
		// Stating the wording plainly again forgets its pairs.
		await saveMoneyInRule(db, viewer, { ruleId: "plain-2", wording: GUSTO, kind: "income" });
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ id: "plain", kind: "income", intoAccountId: null },
		]);
	});

	it("still reads, applies and removes a pair remembered before pairs had their own table", async () => {
		const old = (id: string, intoAccountId: string) =>
			db.insert(moneyInRules).values({
				id,
				householdId,
				pattern: merchantKey(GUSTO),
				kind: "transfer",
				intoAccountId,
				otherAccountId: "gusto",
			});
		await old("old-pair", "chase");
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ id: "old-pair", kind: "transfer", intoAccountName: "Chase", otherAccountName: "Gusto" },
		]);
		await importInto("chase", [line("2026-09-17", 261_300, GUSTO)]);
		const marked = await on("2026-09-17");
		expect(marked).toMatchObject({ kind: "transfer", paired: false });
		// Said again for Chase, it is one pair still, in the pairs' own table.
		expect(
			await rememberAccountPair(db, viewer, {
				incomeId: marked.id,
				otherAccountId: "savings",
				ruleId: "pair-rule",
			}),
		).toMatchObject({ ok: true });
		expect(await loadMoneyInRules(db, householdId)).toMatchObject([
			{ id: "pair-rule", intoAccountName: "Chase", otherAccountName: "Savings" },
		]);
		expect(await db.select().from(moneyInRules)).toEqual([]);
		// And an old one is removed like any other.
		await db.delete(moneyInRules);
		await deleteMoneyInRule(db, householdId, "pair-rule");
		await old("old-savings", "savings");
		await deleteMoneyInRule(db, householdId, "old-savings");
		expect(await loadMoneyInRules(db, householdId)).toEqual([]);
	});
});
