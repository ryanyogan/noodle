import type { DayKey, MonthKey } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addCommitment,
	addPaymentCommitment,
	createHouseholdForParent,
	type Db,
	endCommitment,
	loadGoals,
	loadPlanRecords,
	setLoanFacts,
} from "./index";
import * as s from "./schema";
import { exportHouseholdRows, restoreHouseholdRows, SNAPSHOT_FORMAT } from "./snapshots";
import { testDb } from "./test-db";

// A loan's facts on its Account, and the monthly Commitment for an Account's payments added with
// the Account or afterwards (issue 153): one batch, one Plan change, and the guards that refuse it.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const month: MonthKey = "2026-10";
const today: DayKey = "2026-10-08";

let db: Db;

const facts = { borrowed: 20_000, payment: 5_000, dueDay: 15, endsOn: "2027-01-15" as DayKey };
const payment = (commitmentId: string, amountCents = 5_000) => ({
	commitmentId,
	amountCents,
	dueDate: "2026-10-15" as DayKey,
	month,
	today,
});

const add = (
	accountId: string,
	kind: "checking" | "credit-card" | "loan",
	more: Partial<Parameters<typeof addAccount>[1]> = {},
) =>
	addAccount(db, {
		householdId,
		accountId,
		name: accountId,
		kind,
		balanceCents: null,
		balanceId: `${accountId}-balance`,
		createdByMemberId: parentId,
		asOf: today,
		...more,
	});

const commitments = async () => (await loadPlanRecords(db, householdId, month)).commitments;
const account = async (id: string) =>
	(await loadGoals(db, viewer)).accounts.find((a) => a.id === id);
const planChanges = () =>
	db.select().from(s.planChanges).where(eq(s.planChanges.householdId, householdId));

beforeEach(async () => {
	db = await testDb();
	for (const [id, parent] of [
		[householdId, parentId],
		["other-household", "other-parent"],
	] as const) {
		await createHouseholdForParent(db, {
			clerkUserId: `clerk-${id}`,
			householdId: id,
			householdName: id,
			timeZone: "America/Chicago",
			parentId: parent,
			parentName: parent,
		});
	}
});

describe("a loan's facts", () => {
	it("are kept on a loan added with them, and read back with the Account", async () => {
		await add("sofa-plan", "loan", { balanceCents: 15_000, loan: facts });
		expect((await account("sofa-plan"))?.loan).toEqual(facts);
		expect((await account("sofa-plan"))?.owed).toBe(15_000);
	});

	it("are all null on a loan nobody has said anything about, and left out for other kinds", async () => {
		await add("old-loan", "loan");
		await add("card", "credit-card", { loan: facts });
		expect((await account("old-loan"))?.loan).toEqual({
			borrowed: null,
			payment: null,
			dueDay: null,
			endsOn: null,
		});
		expect((await account("card"))?.loan).toBeUndefined();
		const [row] = await db.select().from(s.accounts).where(eq(s.accounts.id, "card"));
		expect(row?.borrowedCents).toBeNull();
		expect(row?.paymentCents).toBeNull();
	});

	it("can be changed, and cleared, on the Household's own loan only", async () => {
		await add("sofa-plan", "loan", { loan: facts });
		await add("card", "credit-card");
		expect(
			await setLoanFacts(db, {
				householdId,
				accountId: "sofa-plan",
				borrowed: 30_000,
				payment: null,
				dueDay: 1,
				endsOn: null,
			}),
		).toEqual({ ok: true });
		expect((await account("sofa-plan"))?.loan).toEqual({
			borrowed: 30_000,
			payment: null,
			dueDay: 1,
			endsOn: null,
		});
		expect(await setLoanFacts(db, { householdId, accountId: "card", ...facts })).toEqual({
			ok: false,
		});
		expect(
			await setLoanFacts(db, { householdId: "other-household", accountId: "sofa-plan", ...facts }),
		).toEqual({ ok: false });
		expect((await account("sofa-plan"))?.loan?.borrowed).toBe(30_000);
	});

	it("go through a snapshot and back", async () => {
		await add("sofa-plan", "loan", { loan: facts });
		const rows = await exportHouseholdRows(db, householdId);
		await setLoanFacts(db, {
			householdId,
			accountId: "sofa-plan",
			borrowed: null,
			payment: null,
			dueDay: null,
			endsOn: null,
		});
		await restoreHouseholdRows(db, householdId, {
			format: SNAPSHOT_FORMAT,
			householdId,
			takenAt: "2026-10-08T18:00:00.000Z",
			migration: "0089_loan_facts",
			tables: rows.tables,
		});
		expect((await account("sofa-plan"))?.loan).toEqual(facts);
	});
});

describe("a Commitment for an Account's payments, added with the Account", () => {
	it("is monthly, named after the loan, pays it down, and is one Plan change", async () => {
		await add("sofa-plan", "loan", {
			balanceCents: 20_000,
			loan: facts,
			commitment: payment("sofa-payment"),
		});
		const records = await loadPlanRecords(db, householdId, month);
		expect(records.commitments).toMatchObject([
			{ id: "sofa-payment", name: "sofa-plan", accountId: "sofa-plan", fromMonth: month },
		]);
		expect(records.commitmentTerms).toMatchObject([
			{ commitmentId: "sofa-payment", amount: 5_000, cadence: "monthly", dueDate: "2026-10-15" },
		]);
		const changes = await planChanges();
		expect(changes).toHaveLength(1);
		expect(changes[0]).toMatchObject({
			kind: "commitment-add",
			targetId: "sofa-payment",
			after: { name: "sofa-plan", amount: 5_000, paysDown: "sofa-plan" },
		});
	});

	it("adds nothing more when the save is retried", async () => {
		const input = { balanceCents: 20_000, loan: facts, commitment: payment("sofa-payment") };
		await add("sofa-plan", "loan", input);
		await add("sofa-plan", "loan", input);
		expect(await commitments()).toHaveLength(1);
		expect(await planChanges()).toHaveLength(1);
	});

	it("is added for a card whose purchases don't get into Noodle", async () => {
		await add("store-card", "credit-card", {
			purchases: "none",
			commitment: payment("store-payment"),
		});
		expect(await commitments()).toMatchObject([{ id: "store-payment", accountId: "store-card" }]);
	});

	it("is not added for a card kept by hand, nor for an Account that holds money", async () => {
		await add("hand-card", "credit-card", {
			purchases: "hand",
			commitment: payment("hand-payment"),
		});
		await add("checking", "checking", { commitment: payment("checking-payment") });
		expect(await commitments()).toEqual([]);
		expect(await planChanges()).toEqual([]);
		// The Accounts themselves are there.
		expect(await account("hand-card")).toBeDefined();
		expect(await account("checking")).toBeDefined();
	});

	it("adds neither when the Account's ID is another Household's", async () => {
		await addAccount(db, {
			householdId: "other-household",
			accountId: "theirs",
			name: "theirs",
			kind: "loan",
			balanceCents: null,
			balanceId: "theirs-balance",
			createdByMemberId: "other-parent",
		});
		await add("theirs", "loan", { commitment: payment("sneaky") });
		expect(await commitments()).toEqual([]);
		expect(await account("theirs")).toBeUndefined();
	});

	it("leaves a loan added without one with no Commitment", async () => {
		await add("sofa-plan", "loan", { loan: facts });
		expect(await commitments()).toEqual([]);
	});
});

describe("a Commitment for an Account's payments, added afterwards", () => {
	const later = (accountId: string, commitmentId: string, home = householdId) =>
		addPaymentCommitment(db, {
			householdId: home,
			memberId: home === householdId ? parentId : "other-parent",
			accountId,
			dueDay: 20,
			...payment(commitmentId, 7_500),
			dueDate: "2026-10-20",
		});

	it("pays the loan down, and its payment and due day become the loan's facts", async () => {
		await add("car-loan", "loan", { loan: { ...facts, payment: null, dueDay: null } });
		expect(await later("car-loan", "car-payment")).toEqual({ ok: true });
		expect(await commitments()).toMatchObject([
			{ id: "car-payment", name: "car-loan", accountId: "car-loan" },
		]);
		expect((await account("car-loan"))?.loan).toEqual({ ...facts, payment: 7_500, dueDay: 20 });
		expect(await planChanges()).toHaveLength(1);
	});

	it("is refused while a Commitment in the Plan pays it down, and allowed once that has ended", async () => {
		await add("car-loan", "loan", { loan: facts, commitment: payment("first") });
		expect(await later("car-loan", "second")).toEqual({ ok: false, reason: "refused" });
		expect(await commitments()).toHaveLength(1);
		// The refusal leaves the loan's facts as they were.
		expect((await account("car-loan"))?.loan).toEqual(facts);
		await endCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "first",
			month,
		});
		expect(await later("car-loan", "second")).toEqual({ ok: true });
	});

	it("is refused for a card kept by hand, an Account that holds money, and another Household's", async () => {
		await add("hand-card", "credit-card", { purchases: "hand" });
		await add("checking", "checking");
		await add("car-loan", "loan");
		expect(await later("hand-card", "a")).toEqual({ ok: false, reason: "refused" });
		expect(await later("checking", "b")).toEqual({ ok: false, reason: "not-found" });
		expect(await later("car-loan", "c", "other-household")).toEqual({
			ok: false,
			reason: "not-found",
		});
		expect(await commitments()).toEqual([]);
	});

	it("leaves a Commitment added the usual way with nothing it pays down", async () => {
		await addCommitment(db, {
			householdId,
			memberId: parentId,
			commitmentId: "internet",
			name: "internet",
			month,
			amountCents: 7_500,
			cadence: "monthly",
			dueDate: "2026-10-01",
		});
		expect(await commitments()).toMatchObject([{ id: "internet", accountId: null }]);
	});
});
