import { type DayKey, type MonthKey, merchantKey, type StatementLine } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addCommitment,
	applyRule,
	createHouseholdForParent,
	type Db,
	fileCardPayment,
	importStatement,
	listRules,
	loadCardPaymentRules,
	loadTransactionsPage,
	markCardPayment,
	markCardPayments,
	undoCardPaymentFiling,
	undoCardPaymentMarks,
	undoCardPaymentRemembered,
	unmarkTransfer,
} from "./index";
import { saveRule } from "./rules";
import { ruleFor, rules, transactions, transfers } from "./schema";
import { testDb } from "./test-db";

// The card's side of a payment (issue 136): statements go in through importStatement, as an
// upload does, and what a line is read back as is what the Transactions list says.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	for (const [accountId, name, kind] of [
		["checking", "Checking", "checking"],
		["card", "Visa", "credit-card"],
		["loan", "Car loan", "loan"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 0,
			balanceId: `${accountId}-balance`,
			createdByMemberId: parentId,
		});
	}
});

/** A statement line: money out of the Account is negative, money in positive. */
const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

const importInto = (accountId: string, importId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId,
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

/** The month's Transactions' Transfers, by note. */
async function listed() {
	const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
	return new Map(page.transactions.map((row) => [row.note, row.transfer]));
}

const count = async (table: typeof transfers | typeof transactions) =>
	(await db.select({ n: sql<number>`count(*)` }).from(table))[0]?.n;

const oneSided = { from: null, to: "Visa", reason: null };
const paired = { from: "Checking", to: "Visa", reason: null };

describe("A payment arriving on a card", () => {
	it("is a Transfer on its own when the paying Account isn't in Noodle; a refund stays money back", async () => {
		const result = await importInto("card", "i-1", [
			line("2026-09-11", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-12", 2_000, "AMAZON.COM AMZN.COM/BILL WA"),
			line("2026-09-13", 1_500, "CASH BACK REWARD"),
			line("2026-09-14", -3_000, "REI"),
		]);
		expect(result.ok && result.transfers).toBe(1);
		const rows = await listed();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(oneSided);
		expect(rows.get("AMAZON.COM AMZN.COM/BILL WA")).toBeNull();
		expect(rows.get("CASH BACK REWARD")).toBeNull();
		expect(rows.get("REI")).toBeNull();
	});

	it("pairs with the paying Account's line of the same amount, whatever the days", async () => {
		await importInto("checking", "i-1", [line("2026-09-02", -50_000, "CHASE CREDIT CRD AUTOPAY")]);
		await importInto("card", "i-2", [line("2026-09-20", 50_000, "AUTOPAY PAYMENT - THANK YOU")]);
		const rows = await listed();
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toEqual(paired);
		expect(rows.get("AUTOPAY PAYMENT - THANK YOU")).toEqual(paired);
	});

	it("finds its paying line when that comes in later", async () => {
		await importInto("card", "i-1", [line("2026-09-20", 50_000, "ONLINE PAYMENT - THANK YOU")]);
		expect((await listed()).get("ONLINE PAYMENT - THANK YOU")).toEqual(oneSided);
		await importInto("checking", "i-2", [line("2026-09-02", -50_000, "VISA ONLINE PAYMENT")]);
		const rows = await listed();
		expect(rows.get("VISA ONLINE PAYMENT")).toEqual(paired);
		expect(rows.get("ONLINE PAYMENT - THANK YOU")).toEqual(paired);
		expect(await count(transfers)).toBe(1);
	});

	it("takes the nearest paying line, and never a purchase that only costs the same", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-01", -50_000, "VISA AUTOPAY PAYMENT 1"),
			line("2026-09-12", -50_000, "VISA AUTOPAY PAYMENT 2"),
			line("2026-09-05", -42_000, "COSTCO WHSE #1042"),
		]);
		await importInto("card", "i-2", [
			line("2026-09-19", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-25", 42_000, "PAYMENT RECEIVED"),
		]);
		const rows = await listed();
		expect(rows.get("VISA AUTOPAY PAYMENT 2")).toEqual(paired);
		expect(rows.get("VISA AUTOPAY PAYMENT 1")).toBeNull();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(paired);
		expect(rows.get("COSTCO WHSE #1042")).toBeNull();
		expect(rows.get("PAYMENT RECEIVED")).toEqual(oneSided);
	});

	it("leaves money arriving on a loan as it was", async () => {
		await importInto("loan", "i-1", [line("2026-09-11", 50_000, "PAYMENT RECEIVED")]);
		expect((await listed()).get("PAYMENT RECEIVED")).toBeNull();
	});
});

describe("The pass over card lines already in Noodle", () => {
	/** Lines as they were before this was built: imported, and marked as nothing. */
	async function asItWas() {
		await importInto("checking", "i-1", [
			line("2026-09-02", -50_000, "CHASE CREDIT CRD AUTOPAY"),
			line("2026-09-03", -9_900, "VISA ONLINE PAYMENT"),
		]);
		await importInto("card", "i-2", [
			line("2026-09-20", 50_000, "PAYMENT THANK YOU"),
			line("2026-09-21", 7_500, "MOBILE PAYMENT - THANK YOU"),
			line("2026-09-22", 2_000, "TARGET REFUND"),
		]);
		await db.delete(transfers);
	}

	it("marks the payments, deletes nothing, and does nothing the second time", async () => {
		await asItWas();
		const lines = await count(transactions);
		const first = await markCardPayments(db, householdId, newId);
		expect(first).toEqual({ marked: 2, months: ["2026-09"] });
		const rows = await listed();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(paired);
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toEqual(paired);
		expect(rows.get("MOBILE PAYMENT - THANK YOU")).toEqual(oneSided);
		expect(rows.get("TARGET REFUND")).toBeNull();
		expect(rows.get("VISA ONLINE PAYMENT")).toBeNull();

		const marks = await db.select().from(transfers);
		expect(await markCardPayments(db, householdId, newId)).toEqual({ marked: 0, months: [] });
		expect(await db.select().from(transfers)).toEqual(marks);
		expect(await count(transactions)).toBe(lines);
	});

	it("is undone by unmarking, and a line a Parent unmarked is never marked again", async () => {
		await asItWas();
		await markCardPayments(db, householdId, newId);
		const marks = await db.select().from(transfers);
		for (const mark of marks) {
			expect(await unmarkTransfer(db, viewer, mark.id)).toMatchObject({ ok: true });
		}
		expect(await markCardPayments(db, householdId, newId)).toEqual({ marked: 0, months: [] });
		const rows = await listed();
		expect(rows.get("PAYMENT THANK YOU")).toBeNull();
		expect(rows.get("MOBILE PAYMENT - THANK YOU")).toBeNull();
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toBeNull();
	});

	it("never pairs with a paying line a Parent unmarked", async () => {
		await importInto("checking", "i-1", [line("2026-09-10", -50_000, "CHASE CREDIT CRD AUTOPAY")]);
		await importInto("card", "i-2", [line("2026-09-11", 50_000, "REI RETURN")]);
		const [pair] = await db.select().from(transfers);
		expect(pair).toBeDefined();
		await unmarkTransfer(db, viewer, pair?.id ?? "");
		await importInto("card", "i-3", [line("2026-09-25", 50_000, "PAYMENT THANK YOU")]);
		const rows = await listed();
		expect(rows.get("CHASE CREDIT CRD AUTOPAY")).toBeNull();
		expect(rows.get("PAYMENT THANK YOU")).toEqual(oneSided);
	});
});

describe("It's a card payment, remembered for the card's wording", () => {
	const idOf = async (note: string) => {
		const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
		return page.transactions.find((row) => row.note === note)?.id as string;
	};
	const marksOf = async (note: string) => {
		const id = await idOf(note);
		return (await db.select().from(transfers)).filter((row) => row.outTransactionId === id);
	};

	it("marks the line as a Transfer naming the card, and later payments mark themselves", async () => {
		await importInto("checking", "i-1", [line("2026-09-03", -9_900, "CARDMEMBER SERV WEB PYMT")]);
		const answered = await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: await idOf("CARDMEMBER SERV WEB PYMT"),
			cardAccountId: "card",
			ruleId: "r-1",
		});
		expect(answered).toMatchObject({ ok: true, months: ["2026-09"] });
		expect(await marksOf("CARDMEMBER SERV WEB PYMT")).toMatchObject([
			{ id: "t-1", otherAccountId: "card", createdByMemberId: parentId, removedAt: null },
		]);
		expect(await loadCardPaymentRules(db, householdId)).toMatchObject([
			{ id: "r-1", accountId: "card", card: "Visa" },
		]);

		const later = await importInto("checking", "i-2", [
			line("2026-09-28", -12_345, "CARDMEMBER SERV WEB PYMT"),
			line("2026-09-28", -4_000, "COSTCO WHSE #1042"),
		]);
		expect(later.ok && later.transfers).toBe(1);
		const marks = (await db.select().from(transfers)).filter((row) => row.id !== "t-1");
		expect(marks).toMatchObject([
			{ otherAccountId: "card", createdByMemberId: null, inTransactionId: null },
		]);

		// Undo is unmarking, and a line a Parent unmarked isn't marked again.
		expect(await unmarkTransfer(db, viewer, marks[0]?.id ?? "")).toMatchObject({ ok: true });
		const again = await importInto("checking", "i-3", [line("2026-09-29", -500, "REI")]);
		expect(again.ok && again.transfers).toBe(0);
		expect(
			(await db.select().from(transfers)).filter((row) => row.removedAt === null),
		).toHaveLength(1);
	});

	it("remembers a card that isn't in Noodle too, and changes its mind when told again", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-03", -9_900, "CARDMEMBER SERV WEB PYMT"),
			line("2026-09-10", -8_800, "CARDMEMBER SERV WEB PYMT"),
		]);
		const [first, second] = (await loadTransactionsPage(db, viewer, { month, limit: 50 }))
			.transactions;
		await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: first?.id ?? "",
			cardAccountId: null,
			ruleId: "r-1",
		});
		expect(await loadCardPaymentRules(db, householdId)).toMatchObject([{ accountId: null }]);
		await markCardPayment(db, viewer, {
			transferId: "t-2",
			transactionId: second?.id ?? "",
			cardAccountId: "card",
			ruleId: "r-2",
		});
		expect(await loadCardPaymentRules(db, householdId)).toMatchObject([
			{ id: "r-1", accountId: "card" },
		]);
	});

	it("refuses an Account that isn't a credit card, and money back", async () => {
		await importInto("checking", "i-1", [line("2026-09-03", -9_900, "CARDMEMBER SERV WEB PYMT")]);
		await importInto("card", "i-2", [line("2026-09-20", 2_000, "TARGET REFUND")]);
		for (const [note, cardAccountId] of [
			["CARDMEMBER SERV WEB PYMT", "loan"],
			["CARDMEMBER SERV WEB PYMT", "nobody's"],
			["TARGET REFUND", "card"],
		] as const) {
			expect(
				await markCardPayment(db, viewer, {
					transferId: "t-1",
					transactionId: await idOf(note),
					cardAccountId,
					ruleId: "r-1",
				}),
			).toEqual({ ok: false, reason: "refused" });
		}
		expect(await count(transfers)).toBe(0);
		expect(await loadCardPaymentRules(db, householdId)).toEqual([]);
	});
});

describe("An answer covers the lines already here that say the same", () => {
	const idOf = async (note: string, amount: number) => {
		const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
		return page.transactions.find((row) => row.note === note && row.amountCents === amount)
			?.id as string;
	};
	const live = async () =>
		(await db.select().from(transfers)).filter((row) => row.removedAt === null);

	it("marks them as Transfers to the card in the same answer, and its Undo takes them back", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-03", -9_900, "CARDMEMBER SERV WEB PYMT"),
			line("2026-09-12", -4_400, "CARDMEMBER SERV WEB PYMT"),
			line("2026-09-13", -4_000, "COSTCO WHSE #1042"),
		]);
		const answer = {
			transferId: "t-1",
			transactionId: await idOf("CARDMEMBER SERV WEB PYMT", 9_900),
			cardAccountId: "card",
			ruleId: "r-1",
			newId,
		};
		const answered = await markCardPayment(db, viewer, answer);
		expect(answered.ok && answered.also).toHaveLength(1);
		expect(await live()).toHaveLength(2);
		expect((await listed()).get("COSTCO WHSE #1042")).toBeNull();

		// Undo: the line answered is unmarked, the others' marks go, so answering again marks them.
		await unmarkTransfer(db, viewer, "t-1");
		await undoCardPaymentMarks(db, householdId, (answered.ok && answered.also) || []);
		expect(await live()).toHaveLength(0);
		const again = await markCardPayment(db, viewer, { ...answer, transferId: "t-2" });
		expect(again.ok && again.also).toHaveLength(1);
		expect(await live()).toHaveLength(2);
	});
});

describe("Undo of a remembered card payment puts back what was remembered before", () => {
	const rowsOf = async () =>
		(await loadTransactionsPage(db, viewer, { month, limit: 50 })).transactions;
	const WORDING = "CARDMEMBER SERV WEB PYMT";

	beforeEach(async () => {
		await importInto("checking", "i-1", [
			line("2026-09-03", -9_900, WORDING),
			line("2026-09-10", -8_800, WORDING),
		]);
	});

	it("forgets a wording that was new with the answer", async () => {
		const [first] = await rowsOf();
		const answer = await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: first?.id ?? "",
			cardAccountId: "card",
			ruleId: "r-1",
		});
		expect(answer).toMatchObject({ ok: true, remembered: merchantKey(WORDING) });
		expect(answer.replaced).toBeUndefined();
		await undoCardPaymentRemembered(db, householdId, merchantKey(WORDING), answer.replaced);
		expect(await loadCardPaymentRules(db, householdId)).toEqual([]);
	});

	it("names the earlier card again when the answer replaced it", async () => {
		const [first, second] = await rowsOf();
		await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: first?.id ?? "",
			cardAccountId: null,
			ruleId: "r-1",
		});
		const answer = await markCardPayment(db, viewer, {
			transferId: "t-2",
			transactionId: second?.id ?? "",
			cardAccountId: "card",
			ruleId: "r-2",
		});
		expect(answer.replaced).toEqual({ accountId: null });
		await undoCardPaymentRemembered(db, householdId, merchantKey(WORDING), answer.replaced);
		expect(await loadCardPaymentRules(db, householdId)).toMatchObject([
			{ id: "r-1", accountId: null },
		]);
	});

	it("says nothing was replaced when the same answer is sent again", async () => {
		const [first] = await rowsOf();
		const send = () =>
			markCardPayment(db, viewer, {
				transferId: "t-1",
				transactionId: first?.id ?? "",
				cardAccountId: "card",
				ruleId: "r-1",
			});
		await send();
		expect((await send()).replaced).toBeUndefined();
	});

	it("never names an Account that isn't one of the Household's cards", async () => {
		const [first] = await rowsOf();
		await markCardPayment(db, viewer, {
			transferId: "t-1",
			transactionId: first?.id ?? "",
			cardAccountId: null,
			ruleId: "r-1",
		});
		await undoCardPaymentRemembered(db, householdId, merchantKey(WORDING), {
			accountId: "checking",
		});
		expect(await loadCardPaymentRules(db, householdId)).toMatchObject([{ accountId: null }]);
	});
});

describe("A payment to a card whose payment is the spending", () => {
	const rowOf = async (amount: number) => {
		const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
		return page.transactions.find((row) => row.amountCents === amount);
	};
	const WORDING = "APPLECARD GSBANK PAYMENT 8841";

	beforeEach(async () => {
		await addCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "apple",
			name: "Apple Card",
			month,
			amountCents: 30_000,
			cadence: "monthly",
			dueDate: "2026-09-05",
		});
	});

	it("is filed in the Commitment with the lines worded like it, and the Rule files later ones", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-05", -30_000, WORDING),
			line("2026-09-19", -5_000, WORDING),
			line("2026-09-20", -4_000, "COSTCO WHSE #1042"),
		]);
		const opened = (await rowOf(30_000))?.id as string;
		const filing = await fileCardPayment(db, viewer, {
			transactionId: opened,
			commitmentId: "apple",
			ruleId: "rule-1",
		});
		expect(filing).toMatchObject({ ok: true, filed: 2, months: [month], ruleId: "rule-1" });
		expect((await rowOf(30_000))?.commitmentId).toBe("apple");
		expect((await rowOf(5_000))?.commitmentId).toBe("apple");
		expect((await rowOf(4_000))?.commitmentId).toBeNull();
		expect(await listRules(db, viewer)).toMatchObject([{ id: "rule-1" }]);

		// A payment that comes in later says the same: the Rule stated for the wording takes it.
		await importInto("checking", "i-2", [line("2026-09-27", -6_100, WORDING)]);
		expect(await applyRule(db, viewer, "rule-1")).toMatchObject({ filed: 1 });
		expect((await rowOf(6_100))?.commitmentId).toBe("apple");
	});

	it("is undone whole: the lines go back and the wording is forgotten", async () => {
		await importInto("checking", "i-1", [
			line("2026-09-05", -30_000, WORDING),
			line("2026-09-19", -5_000, WORDING),
		]);
		const filing = await fileCardPayment(db, viewer, {
			transactionId: (await rowOf(30_000))?.id as string,
			commitmentId: "apple",
			ruleId: "rule-1",
		});
		if (!filing.ok) throw new Error("not filed");
		expect(await undoCardPaymentFiling(db, viewer, filing)).toEqual({ restored: 2 });
		expect((await rowOf(30_000))?.commitmentId).toBeNull();
		expect((await rowOf(5_000))?.commitmentId).toBeNull();
		expect(await listRules(db, viewer)).toEqual([]);
	});

	it("files well over a hundred lines that say the same, and undoes them", async () => {
		// D1 binds at most 100 parameters to a statement: the lines must travel as one list.
		const many = Array.from({ length: 130 }, (_, index) =>
			line("2026-09-12", -1_000 - index, WORDING),
		);
		await importInto("checking", "i-1", [line("2026-09-05", -30_000, WORDING), ...many]);
		// The list's pages are 50 long, so the line is read straight from the table.
		const [{ id: opened } = { id: undefined }] = await db
			.select({ id: transactions.id })
			.from(transactions)
			.where(sql`${transactions.amountCents} = 30000`);
		if (!opened) throw new Error("the payment isn't listed");
		const filing = await fileCardPayment(db, viewer, {
			transactionId: opened,
			commitmentId: "apple",
			ruleId: "rule-1",
		});
		expect(filing).toMatchObject({ ok: true, filed: 131, months: [month] });
		if (!filing.ok) throw new Error("not filed");
		expect(await undoCardPaymentFiling(db, viewer, filing)).toEqual({ restored: 131 });
	});

	it("puts an earlier Rule for the wording back on Undo: its target and who it's For", async () => {
		await addCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "old",
			name: "Cards",
			month,
			amountCents: 10_000,
			cadence: "monthly",
			dueDate: "2026-09-09",
		});
		const stated = await saveRule(db, {
			id: "rule-0",
			householdId,
			memberId: parentId,
			pattern: WORDING,
			bucketId: null,
			commitmentId: "old",
			forMemberIds: [parentId],
		});
		expect(stated).toMatchObject({ ok: true, ruleId: "rule-0" });
		await importInto("checking", "i-1", [line("2026-09-05", -30_000, WORDING)]);
		const filing = await fileCardPayment(db, viewer, {
			transactionId: (await rowOf(30_000))?.id as string,
			commitmentId: "apple",
			ruleId: "rule-1",
		});
		if (!filing.ok) throw new Error("not filed");
		// The Rule for a wording is one row: the answer changed where it files.
		expect(filing).toMatchObject({
			ruleId: "rule-0",
			ruleBefore: { bucketId: null, commitmentId: "old", for: [parentId] },
		});
		expect(await db.select({ to: rules.commitmentId }).from(rules)).toEqual([{ to: "apple" }]);

		await undoCardPaymentFiling(db, viewer, filing);
		expect((await rowOf(30_000))?.commitmentId).toBeNull();
		expect(await db.select({ id: rules.id, to: rules.commitmentId }).from(rules)).toEqual([
			{ id: "rule-0", to: "old" },
		]);
		expect(await db.select({ member: ruleFor.memberId }).from(ruleFor)).toEqual([
			{ member: parentId },
		]);
	});

	it("says no Rule was there before when it states a new one", async () => {
		await importInto("checking", "i-1", [line("2026-09-05", -30_000, WORDING)]);
		const filing = await fileCardPayment(db, viewer, {
			transactionId: (await rowOf(30_000))?.id as string,
			commitmentId: "apple",
			ruleId: "rule-1",
		});
		expect(filing).toMatchObject({ ok: true, ruleBefore: null, stays: false });
	});

	it("leaves a payment in a month that has ended as it is, and files the later ones", async () => {
		await importInto("checking", "i-1", [
			line("2026-08-05", -30_000, WORDING),
			line("2026-09-05", -31_000, WORDING),
		]);
		const august = await loadTransactionsPage(db, viewer, { month: "2026-08", limit: 50 });
		const filing = await fileCardPayment(db, viewer, {
			transactionId: august.transactions[0]?.id as string,
			commitmentId: "apple",
			ruleId: "rule-1",
			leaveBefore: month,
		});
		expect(filing).toMatchObject({
			ok: true,
			stays: true,
			lineMonth: "2026-08",
			filed: 1,
			months: [month],
			ruleId: "rule-1",
		});
		const after = await loadTransactionsPage(db, viewer, { month: "2026-08", limit: 50 });
		expect(after.transactions[0]?.commitmentId).toBeNull();
		expect((await rowOf(31_000))?.commitmentId).toBe("apple");

		if (!filing.ok) throw new Error("not filed");
		expect(await undoCardPaymentFiling(db, viewer, filing)).toEqual({ restored: 1 });
		expect((await rowOf(31_000))?.commitmentId).toBeNull();
		expect(await listRules(db, viewer)).toEqual([]);
	});

	it("refuses money back, and a Commitment that isn't in the line's month", async () => {
		// Money back on the card is a Transaction; money into checking would be Income instead.
		await importInto("card", "i-0", [line("2026-09-05", 2_000, "REFUND")]);
		await importInto("checking", "i-1", [line("2026-08-05", -30_000, WORDING)]);
		const refund = (await rowOf(-2_000))?.id;
		if (!refund) throw new Error("the money back isn't listed");
		expect(
			await fileCardPayment(db, viewer, {
				transactionId: refund,
				commitmentId: "apple",
				ruleId: "rule-1",
			}),
		).toEqual({ ok: false });
		const august = await loadTransactionsPage(db, viewer, { month: "2026-08", limit: 50 });
		expect(
			await fileCardPayment(db, viewer, {
				transactionId: august.transactions[0]?.id as string,
				commitmentId: "apple",
				ruleId: "rule-1",
			}),
		).toEqual({ ok: false });
		expect(await listRules(db, viewer)).toEqual([]);
	});
});
