import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addCapture,
	addQuickAdd,
	answerWalletCard,
	balanceCheckDue,
	checkStatementBalance,
	createCaptureToken,
	createHouseholdForParent,
	type Db,
	dismissWalletCard,
	importStatement,
	isCardKeptByHand,
	listBalanceCheckHouseholds,
	loadBalanceChecksDue,
	loadBalanceChecksPutAway,
	loadGoals,
	loadTransactionsPage,
	loadWalletQuestions,
	markBalanceChecksNudged,
	markCardPayment,
	markTransfer,
	owedNow,
	owedSql,
	putAwayBalanceCheck,
	setCardKept,
	setTakeHomePay,
	updateAccountBalance,
} from "./index";
import * as s from "./schema";
import { testDb } from "./test-db";

// A card kept by hand (issue 136, spec 130 item 8): an Apple Card no bank connection reaches. How
// its purchases get in is asked when it's added; a Wallet capture lands on it; the Quick Adds on
// it are the record and raise what's owed; a payment naming it brings what's owed down; and once
// a month its statement's balance is checked against what's recorded.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-09";

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const card = (accountId: string, name: string, purchases: "statements" | "hand" | "none" | null) =>
	addAccount(db, {
		householdId,
		accountId,
		name,
		kind: "credit-card",
		balanceCents: null,
		balanceId: `${accountId}-none`,
		createdByMemberId: parentId,
		purchases,
	});

const balance = (balanceId: string, accountId: string, amountCents: number, asOf: DayKey) =>
	updateAccountBalance(db, {
		householdId,
		balanceId,
		accountId,
		amountCents,
		createdByMemberId: parentId,
		asOf,
	});

const capture = (id: string, date: DayKey, amountCents: number, merchant: string, on?: string) =>
	addCapture(db, {
		tokenId: "token",
		householdId,
		memberId: parentId,
		transactionId: id,
		date,
		amountCents,
		merchant,
		card: on,
		newId,
	});

const quickAdd = (id: string, date: DayKey, amountCents: number, accountId: string | null) =>
	addQuickAdd(db, {
		householdId,
		transactionId: id,
		bucketId: "eating",
		date,
		amountCents,
		note: id,
		forMemberIds: [],
		createdByMemberId: parentId,
		accountId,
	});

const spent = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount: -amount,
	description,
	bankId: null,
});

const importLines = (importId: string, accountId: string, lines: StatementLine[]) =>
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

const accountOf = async (transactionId: string) =>
	(
		await db
			.select({ accountId: s.transactions.accountId })
			.from(s.transactions)
			.where(eq(s.transactions.id, transactionId))
	)[0]?.accountId ?? null;

/** Every way what's owed is read, which must agree. */
async function expectOwed(accountId: string, amount: number | null) {
	expect(await owedNow(db, { householdId, accountId })).toBe(amount);
	const [row] = await db
		.select({ owed: owedSql(accountId) })
		.from(s.households)
		.where(eq(s.households.id, householdId));
	expect(row?.owed ?? null).toBe(amount);
	const loaded = (await loadGoals(db, viewer)).accounts.find((a) => a.id === accountId);
	expect(loaded?.owed ?? null).toBe(amount);
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
	await setTakeHomePay(db, { householdId, memberId: parentId, month, amountCents: 600_000 });
	await addBucket(db, {
		householdId,
		memberId: parentId,
		bucketId: "eating",
		name: "Eating out",
		color: 1,
		month,
		allowanceCents: 40_000,
	});
	await addAccount(db, {
		householdId,
		accountId: "checking",
		name: "Checking",
		kind: "checking",
		balanceCents: null,
		balanceId: "checking-none",
		createdByMemberId: parentId,
		purchases: "hand",
	});
	await card("apple", "Apple Card", "hand");
	await card("freedom", "Chase Freedom", null);
	await card("store", "Store card", "none");
	await createCaptureToken(db, {
		householdId,
		memberId: parentId,
		tokenId: "token",
		tokenHash: "hash",
	});
});

describe("how a card's purchases get in", () => {
	it("is kept on the card when it's added, and never on an Account that isn't a card", async () => {
		const { accounts } = await loadGoals(db, viewer);
		const answers = Object.fromEntries(accounts.map((a) => [a.id, a.purchases]));
		expect(answers).toEqual({ checking: null, apple: "hand", freedom: null, store: "none" });
	});

	it("can be answered later, once, for a card added before the question existed", async () => {
		expect(
			await setCardKept(db, {
				householdId,
				accountId: "freedom",
				purchases: "statements",
				statementDay: 14,
			}),
		).toEqual({ ok: true });
		expect(
			await setCardKept(db, { householdId, accountId: "checking", purchases: "hand" }),
		).toEqual({ ok: false });
		expect(
			await setCardKept(db, { householdId: "another", accountId: "apple", purchases: "none" }),
		).toEqual({ ok: false });
		const freedom = (await loadGoals(db, viewer)).accounts.find((a) => a.id === "freedom");
		expect(freedom).toMatchObject({ purchases: "statements", statementDay: 14 });
	});
});

describe("a Wallet capture on a card kept by hand", () => {
	it("lands on the Account the card's name says", async () => {
		await capture("coffee", "2026-09-03", 575, "Blue Bottle Coffee", "Apple Card");
		expect(await accountOf("coffee")).toBe("apple");
		expect(await loadWalletQuestions(db, householdId)).toEqual([]);
	});

	it("lands on no Account without a card, as before", async () => {
		await capture("coffee", "2026-09-03", 575, "Blue Bottle Coffee");
		expect(await accountOf("coffee")).toBeNull();
		expect(await loadWalletQuestions(db, householdId)).toEqual([]);
	});

	it("asks once when the name is unclear, moves what was captured, and remembers the answer", async () => {
		await capture("coffee", "2026-09-03", 575, "Blue Bottle Coffee", "Titanium");
		await capture("lunch", "2026-09-04", 1_800, "Sweetgreen", "titanium");
		expect(await accountOf("coffee")).toBeNull();
		expect(await loadWalletQuestions(db, householdId)).toEqual([{ card: "Titanium", captures: 2 }]);

		expect(
			await answerWalletCard(db, { householdId: "another", card: "Titanium", accountId: "apple" }),
		).toEqual({ ok: false, moved: 0 });
		expect(
			await answerWalletCard(db, { householdId, card: "Titanium", accountId: "apple" }),
		).toEqual({ ok: true, moved: 2 });
		expect(await accountOf("coffee")).toBe("apple");
		expect(await accountOf("lunch")).toBe("apple");
		expect(await loadWalletQuestions(db, householdId)).toEqual([]);

		await capture("dinner", "2026-09-05", 4_000, "Zuni", "TITANIUM");
		expect(await accountOf("dinner")).toBe("apple");
		expect(await loadWalletQuestions(db, householdId)).toEqual([]);
	});

	it("isn't asked again for a name answered “None of these”, and those captures stay on no Account", async () => {
		await capture("coffee", "2026-09-03", 575, "Blue Bottle Coffee", "Debit");
		await capture("lunch", "2026-09-04", 1_800, "Sweetgreen", "Titanium");
		expect(await dismissWalletCard(db, { householdId: "another", card: "Debit" })).toEqual({
			ok: false,
		});
		expect(await dismissWalletCard(db, { householdId, card: " debit " })).toEqual({ ok: true });
		expect(await loadWalletQuestions(db, householdId)).toEqual([{ card: "Titanium", captures: 1 }]);

		await capture("dinner", "2026-09-05", 4_000, "Zuni", "DEBIT");
		expect(await accountOf("coffee")).toBeNull();
		expect(await accountOf("dinner")).toBeNull();
		expect(await loadWalletQuestions(db, householdId)).toEqual([{ card: "Titanium", captures: 1 }]);
	});
});

describe("what's owed on a card kept by hand", () => {
	beforeEach(async () => {
		await balance("apple-1", "apple", 50_000, "2026-09-01");
	});

	it("goes up with the Quick Adds on it after the balance's day", async () => {
		await quickAdd("same-day", "2026-09-01", 900, "apple");
		await expectOwed("apple", 50_000);
		await quickAdd("pizza", "2026-09-03", 4_200, "apple");
		await capture("coffee", "2026-09-04", 575, "Blue Bottle Coffee", "Apple Card");
		await quickAdd("elsewhere", "2026-09-04", 3_000, null);
		await expectOwed("apple", 54_775);
	});

	it("is the Quick Add's own record: its row says it's on a card kept by hand", async () => {
		await quickAdd("pizza", "2026-09-03", 4_200, "apple");
		await quickAdd("elsewhere", "2026-09-04", 3_000, null);
		const page = await loadTransactionsPage(db, viewer, { month, limit: 50 });
		const byHand = Object.fromEntries(page.transactions.map((row) => [row.id, row.byHand]));
		expect(byHand).toEqual({ pizza: true, elsewhere: false });
	});

	it("doesn't move on a card whose purchases don't get in, or one not asked about", async () => {
		await balance("store-1", "store", 20_000, "2026-09-01");
		await balance("freedom-1", "freedom", 30_000, "2026-09-01");
		await quickAdd("shoes", "2026-09-03", 6_000, "store");
		await quickAdd("gas", "2026-09-03", 4_000, "freedom");
		await expectOwed("store", 20_000);
		await expectOwed("freedom", 30_000);
	});

	it("comes down with a payment marked as a Transfer naming the card", async () => {
		await quickAdd("pizza", "2026-09-03", 4_200, "apple");
		await importLines("checking-1", "checking", [
			spent("2026-09-10", 20_000, "APPLECARD GSBANK PAYMENT"),
		]);
		const [payment] = await db
			.select({ id: s.transactions.id })
			.from(s.transactions)
			.where(eq(s.transactions.accountId, "checking"));
		const marked = await markCardPayment(db, viewer, {
			transferId: "transfer",
			transactionId: payment?.id ?? "",
			cardAccountId: "apple",
			ruleId: "rule",
		});
		expect(marked.ok).toBe(true);
		await expectOwed("apple", 34_200);
		// Listed for the card's page, under Payments.
		const goals = await loadGoals(db, viewer);
		expect(goals.sent).toEqual([
			{
				id: payment?.id,
				accountId: "apple",
				amount: 20_000,
				date: "2026-09-10",
				comesOff: true,
			},
		]);
	});

	it("counts a Quick Add once when the imported statement Matches it", async () => {
		await capture("coffee", "2026-09-04", 575, "Blue Bottle Coffee", "Apple Card");
		await quickAdd("pizza", "2026-09-03", 4_200, "apple");
		await importLines("apple-statement", "apple", [
			spent("2026-09-05", 575, "BLUE BOTTLE COFFEE OAKLAND"),
			spent("2026-09-06", 1_250, "TARTINE BAKERY"),
		]);
		const matched = await db.select({ quickAddId: s.matches.quickAddId }).from(s.matches);
		expect(matched).toEqual([{ quickAddId: "coffee" }]);
		// The coffee once (its statement line), the pizza that never Matched, and the bakery line.
		await expectOwed("apple", 50_000 + 575 + 4_200 + 1_250);
	});
});

describe("the monthly balance check", () => {
	beforeEach(async () => {
		await balance("apple-1", "apple", 50_000, "2026-09-01");
		await quickAdd("pizza", "2026-09-03", 4_200, "apple");
		await quickAdd("october", "2026-10-02", 1_000, "apple");
	});

	const check = (balanceId: string, statementCents: number) =>
		checkStatementBalance(db, {
			householdId,
			accountId: "apple",
			balanceId,
			statementCents,
			asOf: "2026-09-30",
			createdByMemberId: parentId,
		});

	it("is due from the statement's day until its balance is typed", async () => {
		await setCardKept(db, { householdId, accountId: "apple", purchases: "hand", statementDay: 30 });
		const apple = async () => {
			const found = (await loadGoals(db, viewer)).accounts.find((a) => a.id === "apple");
			if (!found) throw new Error("no Apple Card");
			return found;
		};
		expect(balanceCheckDue(await apple(), "2026-09-29")).toBeNull();
		expect(balanceCheckDue(await apple(), "2026-10-02")).toBe("2026-09-30");
		await check("apple-2", 54_200);
		expect(balanceCheckDue(await apple(), "2026-10-02")).toBeNull();
	});

	it("says “That matches” when the statement is what's recorded up to its day", async () => {
		expect(await check("apple-2", 54_200)).toEqual({
			ok: true,
			check: { kind: "matches" },
			recordedCents: 54_200,
		});
	});

	it("says how much higher the statement is, and takes it as the new starting point", async () => {
		expect(await check("apple-2", 62_620)).toEqual({
			ok: true,
			check: { kind: "higher", byCents: 8_420 },
			recordedCents: 54_200,
		});
		// The statement's balance, and what was bought after its day.
		await expectOwed("apple", 63_620);
	});

	it("is refused for an Account that isn't the Household's card or loan", async () => {
		expect(
			await checkStatementBalance(db, {
				householdId,
				accountId: "checking",
				balanceId: "x",
				statementCents: 1,
				asOf: "2026-09-30",
				createdByMemberId: parentId,
			}),
		).toEqual({ ok: false });
	});
});

describe("a payment comes off a card kept by hand once", () => {
	beforeEach(async () => {
		await balance("apple-1", "apple", 50_000, "2026-09-01");
	});

	/** Money arriving on a card, as its statement has it. */
	const received = (date: DayKey, amount: number, description: string): StatementLine => ({
		date,
		amount,
		description,
		bankId: null,
	});
	const lineOn = async (accountId: string, date: DayKey) => {
		const rows = await db
			.select({
				id: s.transactions.id,
				date: s.transactions.date,
				accountId: s.transactions.accountId,
			})
			.from(s.transactions);
		const found = rows.find((row) => row.accountId === accountId && row.date === date);
		if (!found) throw new Error(`no line on ${accountId} on ${date}`);
		return found.id;
	};
	const named = (transferId: string, transactionId: string, also = false) =>
		markCardPayment(db, viewer, {
			transferId,
			transactionId,
			cardAccountId: "apple",
			ruleId: `rule-${transferId}`,
			...(also ? { newId } : {}),
		});
	const live = async () =>
		(await db.select().from(s.transfers)).filter((row) => row.removedAt === null);

	it("when the checking side is named first and the card's statement comes later", async () => {
		await importLines("checking-1", "checking", [
			spent("2026-09-10", 20_000, "APPLECARD GSBANK PAYMENT"),
		]);
		const paying = await lineOn("checking", "2026-09-10");
		expect((await named("t-1", paying)).ok).toBe(true);
		await expectOwed("apple", 30_000);
		await importLines("apple-statement", "apple", [
			received("2026-09-11", 20_000, "PAYMENT THANK YOU"),
		]);
		await expectOwed("apple", 30_000);
		// One Transfer, the pair: the Parent's own mark, with the card's line as its other side.
		expect(await live()).toMatchObject([
			{
				id: "t-1",
				outTransactionId: paying,
				inTransactionId: await lineOn("apple", "2026-09-11"),
			},
		]);
	});

	it("when the card's statement comes first and the checking side is named a week later", async () => {
		await importLines("apple-statement", "apple", [
			received("2026-09-11", 20_000, "PAYMENT THANK YOU"),
		]);
		await expectOwed("apple", 30_000);
		await importLines("checking-1", "checking", [spent("2026-09-18", 20_000, "ACH DEBIT 0042")]);
		const paying = await lineOn("checking", "2026-09-18");
		expect((await named("t-1", paying)).ok).toBe(true);
		await expectOwed("apple", 30_000);
		expect(await live()).toMatchObject([
			{
				id: "t-1",
				outTransactionId: paying,
				inTransactionId: await lineOn("apple", "2026-09-11"),
			},
		]);
	});

	it("when each side was marked alone, more than four days apart", async () => {
		// The card's line doesn't read as a payment, so a Parent marked it themselves.
		await importLines("apple-statement", "apple", [received("2026-09-11", 20_000, "MISC 0042")]);
		const arrived = await lineOn("apple", "2026-09-11");
		await markTransfer(db, viewer, { transferId: "t-card", transactionId: arrived });
		await importLines("checking-1", "checking", [spent("2026-09-18", 20_000, "ACH DEBIT 0042")]);
		expect((await named("t-1", await lineOn("checking", "2026-09-18"))).ok).toBe(true);
		expect(await live()).toHaveLength(2);
		await expectOwed("apple", 30_000);
	});

	it("twice for two payments of the same amount in one month", async () => {
		await importLines("checking-1", "checking", [
			spent("2026-09-05", 20_000, "APPLECARD GSBANK PAYMENT"),
			spent("2026-09-19", 20_000, "APPLECARD GSBANK PAYMENT"),
		]);
		expect((await named("t-1", await lineOn("checking", "2026-09-05"), true)).ok).toBe(true);
		await expectOwed("apple", 10_000);
		// The first payment's card side arrives: the second is still a payment of its own.
		await importLines("apple-statement", "apple", [
			received("2026-09-06", 20_000, "PAYMENT THANK YOU"),
		]);
		await expectOwed("apple", 10_000);
		await importLines("apple-statement-2", "apple", [
			received("2026-09-20", 20_000, "PAYMENT THANK YOU"),
		]);
		await expectOwed("apple", 10_000);
		expect((await live()).map((row) => row.inTransactionId !== null)).toEqual([true, true]);
	});
});

describe("the monthly balance check, sent twice", () => {
	it("gives the first answer again, not “That matches”", async () => {
		await balance("apple-1", "apple", 50_000, "2026-09-01");
		await quickAdd("pizza", "2026-09-03", 4_200, "apple");
		const check = () =>
			checkStatementBalance(db, {
				householdId,
				accountId: "apple",
				balanceId: "apple-2",
				statementCents: 62_620,
				asOf: "2026-09-30",
				createdByMemberId: parentId,
			});
		const first = await check();
		expect(first).toEqual({
			ok: true,
			check: { kind: "higher", byCents: 8_420 },
			recordedCents: 54_200,
		});
		expect(await check()).toEqual(first);
		await expectOwed("apple", 62_620);
	});
});

describe("a Transfer to a card kept by statements", () => {
	it("is listed for the card's page, and leaves what's owed to its statements", async () => {
		await setCardKept(db, { householdId, accountId: "freedom", purchases: "statements" });
		await balance("freedom-1", "freedom", 30_000, "2026-09-01");
		await importLines("checking-1", "checking", [
			spent("2026-09-10", 20_000, "CHASE CARD PAYMENT"),
		]);
		const [payment] = await db
			.select({ id: s.transactions.id })
			.from(s.transactions)
			.where(eq(s.transactions.accountId, "checking"));
		const marked = await markCardPayment(db, viewer, {
			transferId: "transfer",
			transactionId: payment?.id ?? "",
			cardAccountId: "freedom",
			ruleId: "rule",
		});
		expect(marked.ok).toBe(true);
		const goals = await loadGoals(db, viewer);
		expect(goals.sent).toEqual([
			{
				id: payment?.id,
				accountId: "freedom",
				amount: 20_000,
				date: "2026-09-10",
				comesOff: false,
			},
		]);
		expect(goals.accounts.find((a) => a.id === "freedom")?.owed).toBe(30_000);
		expect(await owedNow(db, { householdId, accountId: "freedom" })).toBe(30_000);
	});
});

describe("asking for a statement's balance", () => {
	const household = { id: householdId, timeZone: "America/Chicago" };
	const due = (today: DayKey) => loadBalanceChecksDue(db, household, today);
	const apple = { accountId: "apple", name: "Apple Card" };

	beforeEach(async () => {
		await balance("apple-1", "apple", 50_000, "2026-09-01");
		await setCardKept(db, { householdId, accountId: "apple", purchases: "hand", statementDay: 30 });
	});

	it("is due once the statement has closed, on a card kept by hand with a statement day", async () => {
		expect(await due("2026-09-29")).toEqual([]);
		expect(await due("2026-10-01")).toEqual([
			{ ...apple, day: "2026-09-30", nudged: false, putAway: false },
		]);
		expect(await listBalanceCheckHouseholds(db)).toEqual([household]);
		// A card kept another way never is, whatever its statement day.
		await setCardKept(db, {
			householdId,
			accountId: "freedom",
			purchases: "statements",
			statementDay: 30,
		});
		expect((await due("2026-10-01")).map((c) => c.accountId)).toEqual(["apple"]);
	});

	it("records its Nudge once per statement, however often it's asked", async () => {
		const now = new Date("2026-10-01T09:00:00Z");
		const first = await markBalanceChecksNudged(db, householdId, await due("2026-10-01"), now);
		expect(first).toEqual([{ accountId: "apple", day: "2026-09-30" }]);
		expect(await due("2026-10-02")).toEqual([
			{ ...apple, day: "2026-09-30", nudged: true, putAway: false },
		]);
		expect(await markBalanceChecksNudged(db, householdId, await due("2026-10-02"), now)).toEqual(
			[],
		);
	});

	it("isn't due once the statement's balance is typed, and is again for the next statement", async () => {
		await markBalanceChecksNudged(db, householdId, await due("2026-10-01"), new Date());
		await checkStatementBalance(db, {
			householdId,
			accountId: "apple",
			balanceId: "apple-2",
			statementCents: 50_000,
			asOf: "2026-09-30",
			createdByMemberId: parentId,
		});
		expect(await due("2026-10-02")).toEqual([]);
		expect(await due("2026-10-30")).toEqual([
			{ ...apple, day: "2026-10-30", nudged: false, putAway: false },
		]);
	});

	it("stays put away for the Household until the next statement closes", async () => {
		expect(
			await putAwayBalanceCheck(db, { householdId, accountId: "apple", day: "2026-09-30" }),
		).toEqual({ ok: true });
		expect(await loadBalanceChecksPutAway(db, householdId)).toEqual(["apple:2026-09-30"]);
		expect(await due("2026-10-05")).toEqual([
			{ ...apple, day: "2026-09-30", nudged: false, putAway: true },
		]);
		// Put away before its Nudge went: taking the Nudge later keeps it put away.
		await markBalanceChecksNudged(db, householdId, await due("2026-10-05"), new Date());
		expect((await due("2026-10-05"))[0]).toMatchObject({ nudged: true, putAway: true });
		expect((await due("2026-10-30"))[0]).toMatchObject({
			day: "2026-10-30",
			nudged: false,
			putAway: false,
		});
	});

	it("can't be put away for another Household's card, or one not kept by hand", async () => {
		expect(
			await putAwayBalanceCheck(db, {
				householdId: "other",
				accountId: "apple",
				day: "2026-09-30",
			}),
		).toEqual({ ok: false });
		expect(
			await putAwayBalanceCheck(db, { householdId, accountId: "freedom", day: "2026-09-30" }),
		).toEqual({ ok: false });
		expect(await loadBalanceChecksPutAway(db, householdId)).toEqual([]);
	});

	it("knows a card kept by hand from every other Account", async () => {
		expect(await isCardKeptByHand(db, householdId, "apple")).toBe(true);
		// Not asked about, purchases never get in, a checking Account, another Household's.
		expect(await isCardKeptByHand(db, householdId, "freedom")).toBe(false);
		expect(await isCardKeptByHand(db, householdId, "store")).toBe(false);
		expect(await isCardKeptByHand(db, householdId, "checking")).toBe(false);
		expect(await isCardKeptByHand(db, "other", "apple")).toBe(false);
	});
});
