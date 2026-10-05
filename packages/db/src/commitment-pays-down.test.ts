import type { DayKey, MonthKey } from "@noodle/domain";
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { archiveAccount } from "./account-archive";
import { clearHouseholdRows, countHouseholdRows } from "./fresh-start";
import {
	addAccount,
	addCommitment,
	addCommitmentPayment,
	addPayoffGoal,
	createHouseholdForParent,
	type Db,
	followedCards,
	linkCommitment,
	loadGoals,
	loadPlanRecords,
	owedNow,
	owedSql,
	updateAccountBalance,
} from "./index";
import * as s from "./schema";
import { exportHouseholdRows, restoreHouseholdRows, SNAPSHOT_FORMAT } from "./snapshots";
import { testDb } from "./test-db";

// A Commitment can pay down a card or loan (issue 93, ADR-0050): the link and its guards, what's
// owed derived from the payments filed in it, and a linked Commitment through a snapshot and a
// Fresh start.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-10";
const today: DayKey = "2026-10-20";

let db: Db;

const account = (
	accountId: string,
	kind: "checking" | "credit-card" | "loan",
	home = householdId,
) =>
	addAccount(db, {
		householdId: home,
		accountId,
		name: accountId,
		kind,
		balanceCents: null,
		balanceId: `${accountId}-none`,
		createdByMemberId: home === householdId ? parentId : "other-parent",
	});

const balance = (balanceId: string, accountId: string, amountCents: number, asOf: DayKey | null) =>
	updateAccountBalance(db, {
		householdId,
		balanceId,
		accountId,
		amountCents,
		createdByMemberId: parentId,
		asOf,
	});

const commitment = (commitmentId: string) =>
	addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId,
		name: commitmentId,
		month: "2026-09",
		amountCents: 50_000,
		cadence: "monthly",
		dueDate: "2026-09-05",
	});

const link = (commitmentId: string, accountId: string | null, carriedBalance = false) =>
	linkCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId,
		accountId,
		carriedBalance,
		month,
		today,
	});

const pay = (transactionId: string, commitmentId: string, amountCents: number, date: DayKey) =>
	addCommitmentPayment(db, {
		householdId,
		transactionId,
		commitmentId,
		date,
		amountCents,
		createdByMemberId: parentId,
	});

const owed = (accountId: string) => owedNow(db, { householdId, accountId });

/** owedSql's own answer, with the same fallback day the guarded writes read first. */
async function owedBySql(accountId: string, fallbackDay: DayKey | null = null) {
	const [row] = await db
		.select({ owed: owedSql(accountId, fallbackDay) })
		.from(s.households)
		.where(eq(s.households.id, householdId));
	return row?.owed ?? null;
}

const loadedOwed = async (accountId: string) =>
	(await loadGoals(db, viewer)).accounts.find((a) => a.id === accountId)?.owed ?? null;

/** Every way what's owed is read, which must agree. */
async function expectOwed(accountId: string, amount: number | null) {
	expect(await owed(accountId)).toBe(amount);
	expect(await owedBySql(accountId)).toBe(amount);
	expect(await loadedOwed(accountId)).toBe(amount);
}

beforeEach(async () => {
	db = testDb();
	for (const [id, parent, clerk] of [
		[householdId, parentId, "clerk-user"],
		["other-household", "other-parent", "other-clerk-user"],
	] as const) {
		await createHouseholdForParent(db, {
			clerkUserId: clerk,
			householdId: id,
			householdName: id,
			timeZone: "America/Chicago",
			parentId: parent,
			parentName: parent,
		});
	}
	await account("amex", "credit-card");
	await account("car-loan", "loan");
	await account("checking", "checking");
	await commitment("amex-payment");
});

describe("what a Commitment pays down", () => {
	it("links to a card or loan, logs the Plan change once, and unlinks", async () => {
		expect(await link("amex-payment", "amex")).toEqual({ ok: true });
		expect(await link("amex-payment", "amex")).toEqual({ ok: true });
		const plan = await loadPlanRecords(db, householdId, month);
		expect(plan.commitments).toMatchObject([{ id: "amex-payment", accountId: "amex" }]);

		expect(await link("amex-payment", "car-loan")).toEqual({ ok: true });
		expect(await link("amex-payment", null)).toEqual({ ok: true });
		expect(await link("amex-payment", null)).toEqual({ ok: true });
		const changes = await db
			.select({ before: s.planChanges.before, after: s.planChanges.after })
			.from(s.planChanges)
			.where(
				and(
					eq(s.planChanges.householdId, householdId),
					eq(s.planChanges.kind, "commitment-account"),
				),
			)
			.orderBy(s.planChanges.id);
		expect(changes).toEqual([
			{ before: { paysDown: null }, after: { paysDown: "amex" } },
			{ before: { paysDown: "amex" }, after: { paysDown: "car-loan" } },
			{ before: { paysDown: "car-loan" }, after: { paysDown: null } },
		]);
		const [row] = await db.select().from(s.commitments).where(eq(s.commitments.id, "amex-payment"));
		expect(row).toMatchObject({ accountId: null, carriedBalance: false });
	});

	it("refuses another Household's Account, one that holds money, and an archived one", async () => {
		await account("their-card", "credit-card", "other-household");
		expect(await link("amex-payment", "their-card")).toEqual({ ok: false, reason: "not-found" });
		expect(await link("amex-payment", "nowhere")).toEqual({ ok: false, reason: "not-found" });
		expect(await link("amex-payment", "checking")).toEqual({ ok: false, reason: "wrong-kind" });
		expect(await link("no-such-commitment", "amex")).toEqual({ ok: false, reason: "not-found" });
		expect(await archiveAccount(db, { householdId, accountId: "car-loan" })).toEqual({ ok: true });
		expect(await link("amex-payment", "car-loan")).toEqual({ ok: false, reason: "archived" });

		const [row] = await db.select().from(s.commitments).where(eq(s.commitments.id, "amex-payment"));
		expect(row?.accountId).toBeNull();
		expect(
			await db.select().from(s.planChanges).where(eq(s.planChanges.kind, "commitment-account")),
		).toEqual([]);
	});

	it("links to a card Noodle follows only as a balance being carried", async () => {
		// A purchase imported into the card last month: Noodle sees what's bought on it.
		await db.insert(s.transactions).values({
			id: "purchase",
			householdId,
			source: "import",
			date: "2026-09-28",
			amountCents: 4_200,
			accountId: "amex",
		});
		expect(await followedCards(db, householdId, today)).toEqual(["amex"]);
		expect(await link("amex-payment", "amex")).toEqual({ ok: false, reason: "followed" });
		expect(await link("amex-payment", "amex", true)).toEqual({ ok: true });
		const [row] = await db.select().from(s.commitments).where(eq(s.commitments.id, "amex-payment"));
		expect(row).toMatchObject({ accountId: "amex", carriedBalance: true });
		// Taking the tick off while it's still followed is refused, and it stays as it was.
		expect(await link("amex-payment", "amex")).toEqual({ ok: false, reason: "followed" });

		// The same purchase more than 60 days back no longer counts; a loan never needs the tick.
		expect(await followedCards(db, householdId, "2026-12-15")).toEqual([]);
		await db.insert(s.transactions).values({
			id: "loan-line",
			householdId,
			source: "import",
			date: "2026-10-01",
			amountCents: 100,
			accountId: "car-loan",
		});
		await commitment("car-payment");
		expect(await link("car-payment", "car-loan")).toEqual({ ok: true });
	});

	it("keeps an Account a Commitment still in the Plan pays down from being archived", async () => {
		await link("amex-payment", "amex");
		const now = new Date("2026-10-20T12:00:00Z");
		expect(await archiveAccount(db, { householdId, accountId: "amex", now })).toEqual({
			ok: false,
			reason: "commitments",
			commitments: ["amex-payment"],
		});
		// Ended from this month on, it no longer holds the Account.
		await db
			.update(s.commitments)
			.set({ endedFromMonth: "2026-10" })
			.where(eq(s.commitments.id, "amex-payment"));
		expect(await archiveAccount(db, { householdId, accountId: "amex", now })).toEqual({ ok: true });
	});
});

describe("what's owed on a card or loan a Commitment pays down", () => {
	beforeEach(async () => {
		await link("amex-payment", "amex");
		await balance("b1", "amex", 200_000, "2026-10-01");
	});

	it("comes down by each payment dated after the balance's day", async () => {
		await expectOwed("amex", 200_000);
		await pay("p1", "amex-payment", 50_000, "2026-10-05");
		await pay("p2", "amex-payment", 26_000, "2026-10-19");
		await expectOwed("amex", 124_000);
		const { payments, accounts } = await loadGoals(db, viewer);
		expect(payments).toEqual([
			{
				id: "p1",
				accountId: "amex",
				commitmentId: "amex-payment",
				amount: 50_000,
				date: "2026-10-05",
			},
			{
				id: "p2",
				accountId: "amex",
				commitmentId: "amex-payment",
				amount: 26_000,
				date: "2026-10-19",
			},
		]);
		expect(accounts.find((a) => a.id === "amex")?.latestBalance).toMatchObject({
			amount: 200_000,
			day: "2026-10-01",
		});
		// Money held has no "owed", and a payment to another Commitment touches nothing.
		expect(accounts.find((a) => a.id === "checking")?.owed).toBeNull();
		await commitment("rent");
		await pay("p3", "rent", 90_000, "2026-10-06");
		await expectOwed("amex", 124_000);
	});

	it("takes a payment on the balance's own day, or earlier, as already in it", async () => {
		await pay("same-day", "amex-payment", 50_000, "2026-10-01");
		await pay("earlier", "amex-payment", 30_000, "2026-09-20");
		await expectOwed("amex", 200_000);
	});

	it("starts again from a later statement or typed balance", async () => {
		await pay("p1", "amex-payment", 50_000, "2026-10-05");
		await balance("b2", "amex", 180_000, "2026-10-15");
		await expectOwed("amex", 180_000);
		await pay("p2", "amex-payment", 40_000, "2026-10-18");
		await expectOwed("amex", 140_000);
	});

	it("goes back up when a payment is un-filed, deleted, or the Commitment unlinked", async () => {
		await pay("p1", "amex-payment", 50_000, "2026-10-05");
		await pay("p2", "amex-payment", 10_000, "2026-10-06");
		await expectOwed("amex", 140_000);
		await db.update(s.transactions).set({ commitmentId: null }).where(eq(s.transactions.id, "p1"));
		await expectOwed("amex", 190_000);
		await db.delete(s.transactions).where(eq(s.transactions.id, "p2"));
		await expectOwed("amex", 200_000);
		await pay("p3", "amex-payment", 5_000, "2026-10-07");
		await link("amex-payment", null);
		await expectOwed("amex", 200_000);
	});

	it("counts a Split filed in the Commitment, and not a payment marked as a Transfer", async () => {
		await db.insert(s.transactions).values({
			id: "mixed",
			householdId,
			source: "quick-add",
			date: "2026-10-08",
			amountCents: 70_000,
		});
		await db.insert(s.splits).values([
			{
				id: "s1",
				householdId,
				transactionId: "mixed",
				position: 0,
				amountCents: 45_000,
				commitmentId: "amex-payment",
			},
			{ id: "s2", householdId, transactionId: "mixed", position: 1, amountCents: 25_000 },
		]);
		await expectOwed("amex", 155_000);
		await pay("p1", "amex-payment", 20_000, "2026-10-09");
		await expectOwed("amex", 135_000);
		await db.insert(s.transfers).values({ id: "t1", householdId, outTransactionId: "p1" });
		await expectOwed("amex", 155_000);
	});

	it("leaves a connected Account at its bank's balance", async () => {
		await pay("p1", "amex-payment", 50_000, "2026-10-05");
		await db.insert(s.bankConnections).values({
			id: "bank",
			householdId,
			provider: "plaid",
			externalId: "item",
			credential: "token",
			status: "ready",
			createdByMemberId: parentId,
		});
		await db
			.update(s.accounts)
			.set({ bankConnectionId: "bank", externalId: "ext" })
			.where(eq(s.accounts.id, "amex"));
		await expectOwed("amex", 200_000);
	});

	it("dates a balance without a day by when it was recorded, in the Household's time zone", async () => {
		// Recorded 10 pm on Oct 1 in Chicago, which is already Oct 2 in UTC.
		await db.insert(s.accountBalances).values({
			id: "b-old",
			householdId,
			accountId: "car-loan",
			amountCents: 900_000,
			createdAt: new Date("2026-10-02T03:00:00Z"),
		});
		await commitment("car-payment");
		await link("car-payment", "car-loan");
		await pay("p1", "car-payment", 30_000, "2026-10-02");
		expect(await owed("car-loan")).toBe(870_000);
		expect(await loadedOwed("car-loan")).toBe(870_000);
		expect(await owedBySql("car-loan", "2026-10-01")).toBe(870_000);
		// The guarded write reads that day first, so its SQL agrees and a payoff Goal starts there.
		const goal = {
			householdId,
			goalId: "pay-off-car",
			accountId: "car-loan",
			name: "Car",
			targetDate: null,
			fromMonth: month,
			createdByMemberId: parentId,
		};
		expect(await addPayoffGoal(db, { ...goal, targetCents: 900_000 })).toEqual({
			ok: false,
			reason: "refused",
		});
		expect(await addPayoffGoal(db, { ...goal, targetCents: 870_000 })).toEqual({ ok: true });
	});
});

describe("a linked Commitment through a snapshot and a Fresh start", () => {
	beforeEach(async () => {
		await link("amex-payment", "amex");
		await balance("b1", "amex", 200_000, "2026-10-01");
		await pay("p1", "amex-payment", 50_000, "2026-10-05");
	});

	it("is restored with its Account, in an order its foreign key allows", async () => {
		const before = await exportHouseholdRows(db, householdId);
		expect(before.tables.commitments).toMatchObject([{ account_id: "amex" }]);
		await clearHouseholdRows(db, householdId, "fresh-start");
		await restoreHouseholdRows(db, householdId, {
			format: SNAPSHOT_FORMAT,
			householdId,
			takenAt: "2026-10-20T18:00:00.000Z",
			migration: "0054_commitment_account",
			tables: before.tables,
		});
		const after = await exportHouseholdRows(db, householdId);
		expect(after.tables).toEqual(before.tables);
		await expectOwed("amex", 150_000);
	});

	it("is cleared by a Fresh start and by deleting the Household", async () => {
		await clearHouseholdRows(db, householdId, "fresh-start");
		const left = await countHouseholdRows(db, householdId);
		expect(left).toMatchObject({
			commitments: 0,
			accounts: 0,
			accountBalances: 0,
			transactions: 0,
		});
		await account("amex", "credit-card");
		await commitment("amex-payment");
		await link("amex-payment", "amex");
		await clearHouseholdRows(db, householdId, "delete");
		expect((await countHouseholdRows(db, householdId)).households).toBe(0);
	});
});
