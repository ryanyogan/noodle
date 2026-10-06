import type { DayKey, StatementLine } from "@noodle/domain";
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
} from "./index";
import { transactions, transfers } from "./schema";
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
