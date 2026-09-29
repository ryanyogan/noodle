import type { BankLine } from "@noodle/domain";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { addBankConnection, createHouseholdForParent, type Db, syncBankLines } from "./index";
import { transactions } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const parentId = "parent";

let db: Db;
let ids = 0;

beforeEach(async () => {
	db = testDb();
	ids = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	await addBankConnection(db, {
		householdId,
		connectionId: "conn-1",
		provider: "plaid",
		externalId: "item-1",
		institution: "First Platypus Bank",
		credential: "v1:sealed",
		createdByMemberId: parentId,
		accounts: [
			{
				accountId: "card",
				balanceId: "card-b",
				account: { externalId: "acc-cc", name: "Card", kind: "credit-card", balance: null },
			},
		],
	});
});

const line = (bankId: string, date: string, amount: number, extra: Partial<BankLine> = {}) =>
	({
		accountExternalId: "acc-cc",
		bankId,
		date,
		amount,
		description: "Netflix",
		...extra,
	}) as BankLine;

const sync = (importId: string, lines: BankLine[], removed: string[] = []) =>
	syncBankLines(db, {
		householdId,
		connectionId: "conn-1",
		accountId: "card",
		importId,
		lines,
		removed,
		createdByMemberId: parentId,
		newId: () => `id-${++ids}`,
	});

const rows = () =>
	db
		.select({
			id: transactions.id,
			externalId: transactions.externalId,
			date: transactions.date,
			amountCents: transactions.amountCents,
			pending: transactions.pending,
			note: transactions.note,
		})
		.from(transactions)
		.orderBy(asc(transactions.date), asc(transactions.id));

describe("syncBankLines", () => {
	it("brings a pending charge in as pending, then lets its posted copy take over its row", async () => {
		const first = await sync("imp-1", [line("p1", "2026-09-10", -9_99, { pending: true })]);
		expect(first).toMatchObject({ importId: "imp-1", changed: 0, removed: 0, months: ["2026-09"] });
		const [pending] = await rows();
		expect(pending).toMatchObject({ pending: true, externalId: "id:p1" });
		await db
			.update(transactions)
			.set({ note: "Kids' profile" })
			.where(eq(transactions.id, pending?.id ?? ""));

		// Posted a day later, for a little more, and the pending line is gone.
		const second = await sync(
			"imp-2",
			[line("t1", "2026-09-11", -10_49, { replaces: "p1" })],
			["p1"],
		);
		expect(second).toMatchObject({ importId: null, changed: 1, removed: 0 });
		expect(await rows()).toEqual([
			{
				id: pending?.id,
				externalId: "id:t1",
				date: "2026-09-11",
				amountCents: pending ? Math.sign(pending.amountCents) * 10_49 : 0,
				pending: false,
				note: "Kids' profile",
			},
		]);

		// The same sync again changes nothing twice.
		expect(
			await sync("imp-3", [line("t1", "2026-09-11", -10_49, { replaces: "p1" })], ["p1"]),
		).toMatchObject({ importId: null, changed: 0, removed: 0 });
		expect(await rows()).toHaveLength(1);
	});

	it("drops a pending row whose posted copy is in already", async () => {
		await sync("imp-1", [line("p1", "2026-09-10", -9_99, { pending: true })]);
		await sync("imp-2", [line("t1", "2026-09-11", -9_99)]);
		expect(await rows()).toHaveLength(2);
		await sync("imp-3", [line("t1", "2026-09-11", -9_99, { replaces: "p1" })], ["p1"]);
		expect(await rows()).toMatchObject([{ externalId: "id:t1", pending: false }]);
	});

	it("moves a modified line, and deletes one the bank removed", async () => {
		await sync("imp-1", [line("t1", "2026-09-10", -20_00), line("t2", "2026-09-12", -5_00)]);
		const result = await sync("imp-2", [line("t1", "2026-08-31", -21_00)], ["t2"]);
		expect(result).toMatchObject({ changed: 1, removed: 1, months: ["2026-08", "2026-09"] });
		expect(await rows()).toMatchObject([{ externalId: "id:t1", date: "2026-08-31" }]);
	});

	it("is null for an Account that isn't the Bank Connection's", async () => {
		expect(
			await syncBankLines(db, {
				householdId,
				connectionId: "conn-other",
				accountId: "card",
				importId: "imp-1",
				lines: [line("t1", "2026-09-10", -1_00)],
				removed: [],
				createdByMemberId: parentId,
				newId: () => "x",
			}),
		).toBeNull();
	});
});
