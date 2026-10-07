import {
	addAccount,
	checkStatementBalance,
	createHouseholdForParent,
	type Db,
	loadNudgePreferences,
	putAwayBalanceCheck,
	saveNudgePreferences,
	savePushSubscription,
	setCardKept,
	updateAccountBalance,
} from "@noodle/db";
import { testDb } from "@noodle/db/test-db";
import { beforeEach, describe, expect, it } from "vitest";
import { balanceCheckNudgesDue } from "./balance-check-nudges";

// The Balance check's Nudge, as the nightly run decides it: one per card kept by hand per
// statement, to each Parent with a device who wants it.

const householdId = "household";
const parentId = "parent";
const household = { id: householdId, timeZone: "America/Chicago" };
// The nightly run, 4 AM in Chicago. The statement closes on the 30th.
const oct1 = new Date("2026-10-01T09:00:00Z");
const oct2 = new Date("2026-10-02T09:00:00Z");
const oct31 = new Date("2026-10-31T09:00:00Z");

let db: Db;

const typeBalance = (balanceId: string, asOf: "2026-09-30" | "2026-10-30") =>
	checkStatementBalance(db, {
		householdId,
		accountId: "apple",
		balanceId,
		statementCents: 50_000,
		asOf,
		createdByMemberId: parentId,
	});

const wants = async (balanceChecks: boolean) =>
	saveNudgePreferences(db, {
		householdId,
		memberId: parentId,
		preferences: {
			...(await loadNudgePreferences(db, household, parentId)),
			balanceChecks,
		},
	});

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: household.timeZone,
		parentId,
		parentName: "Alex",
	});
	await addAccount(db, {
		householdId,
		accountId: "apple",
		name: "Apple Card",
		kind: "credit-card",
		balanceCents: null,
		balanceId: "apple-none",
		createdByMemberId: parentId,
		purchases: "hand",
	});
	await setCardKept(db, { householdId, accountId: "apple", purchases: "hand", statementDay: 30 });
	await updateAccountBalance(db, {
		householdId,
		balanceId: "apple-1",
		accountId: "apple",
		amountCents: 50_000,
		createdByMemberId: parentId,
		asOf: "2026-09-01",
	});
	await savePushSubscription(db, {
		householdId,
		memberId: parentId,
		endpoint: "https://push.example/a",
		p256dh: "key",
		auth: "auth",
	});
});

describe("the Balance check Nudge", () => {
	it("goes to the Parent once the statement has closed, held until 9 AM", async () => {
		const nudges = await balanceCheckNudgesDue(db, household, oct1);
		expect(nudges).toEqual([
			{
				memberId: parentId,
				nudge: {
					kind: "balance-check",
					title: "Apple Card’s statement closed on Sep 30",
					body: "Type its balance to check nothing’s missing.",
					tag: "balance-check:apple:2026-09-30",
					url: "/accounts/apple",
				},
				deliverAt: new Date("2026-10-01T14:00:00Z").getTime(),
			},
		]);
	});

	it("sends nothing before the statement closes", async () => {
		expect(await balanceCheckNudgesDue(db, household, new Date("2026-09-30T04:00:00Z"))).toEqual(
			[],
		);
	});

	it("sends nothing on the second day, or when the same night's run is retried", async () => {
		expect(await balanceCheckNudgesDue(db, household, oct1)).toHaveLength(1);
		expect(await balanceCheckNudgesDue(db, household, oct1)).toEqual([]);
		expect(await balanceCheckNudgesDue(db, household, oct2)).toEqual([]);
	});

	it("sends nothing once the statement's balance is typed", async () => {
		await typeBalance("apple-2", "2026-09-30");
		expect(await balanceCheckNudgesDue(db, household, oct1)).toEqual([]);
	});

	it("sends again for the next statement", async () => {
		expect(await balanceCheckNudgesDue(db, household, oct1)).toHaveLength(1);
		await typeBalance("apple-2", "2026-09-30");
		const next = await balanceCheckNudgesDue(db, household, oct31);
		expect(next.map(({ nudge }) => nudge.tag)).toEqual(["balance-check:apple:2026-10-30"]);
		expect(await balanceCheckNudgesDue(db, household, oct31)).toEqual([]);
	});

	it("sends again for the next statement even when the last one's balance was never typed", async () => {
		expect(await balanceCheckNudgesDue(db, household, oct1)).toHaveLength(1);
		const next = await balanceCheckNudgesDue(db, household, oct31);
		expect(next.map(({ nudge }) => nudge.tag)).toEqual(["balance-check:apple:2026-10-30"]);
	});

	it("sends nothing with the preference off, and once when it's turned on again", async () => {
		await wants(false);
		expect(await balanceCheckNudgesDue(db, household, oct1)).toEqual([]);
		await wants(true);
		expect(await balanceCheckNudgesDue(db, household, oct2)).toHaveLength(1);
		expect(await balanceCheckNudgesDue(db, household, oct2)).toEqual([]);
	});

	it("sends nothing for a statement a Parent said “Not now” to", async () => {
		await putAwayBalanceCheck(db, { householdId, accountId: "apple", day: "2026-09-30" });
		expect(await balanceCheckNudgesDue(db, household, oct1)).toEqual([]);
		expect(await balanceCheckNudgesDue(db, household, oct31)).toHaveLength(1);
	});
});
