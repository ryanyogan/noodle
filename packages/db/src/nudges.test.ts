import { defaultNudgePreferences } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addGoal,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadNudgePreferences,
	loadNudgeRecipients,
	loadPushSubscriptions,
	loadQuickAddForNudge,
	removePushSubscription,
	saveNudgePreferences,
	savePushSubscription,
	spendGoal,
	type Viewer,
} from "./index";
import { members } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };
const household = { id: householdId, timeZone: "America/Chicago" };

let db: Db;

const quickAdd = (by: Viewer, transactionId: string, bucketId: string, note: string) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date: "2026-09-10",
		amountCents: 4_200,
		note,
		forMemberIds: [],
		createdByMemberId: by.memberId,
	});

const device = (endpoint: string) => ({ endpoint, p256dh: "key", auth: "secret" });

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: household.timeZone,
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
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month,
		allowanceCents: 120_000,
	});
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month,
		allowanceCents: 20_000,
	});
	await quickAdd(alex, "milk", "groceries", "Milk");
	await quickAdd(alex, "gift", "alex-pa", "Birthday gift for Sam");
});

describe("a Quick Add for a Nudge", () => {
	it("is read with its Bucket and who entered it", async () => {
		expect(await loadQuickAddForNudge(db, sam, "milk")).toEqual({
			id: "milk",
			date: "2026-09-10",
			amount: 4_200,
			note: "Milk",
			bucketId: "groceries",
			bucketName: "Groceries",
			createdBy: { memberId: "alex", name: "Alex" },
		});
	});

	it("is never read for the other Parent when it's in a Personal Allowance", async () => {
		expect(await loadQuickAddForNudge(db, sam, "gift")).toBeNull();
		expect(await loadQuickAddForNudge(db, alex, "gift")).toMatchObject({ id: "gift" });
	});

	it("is never read for spending from a Goal, which has no Bucket", async () => {
		await addAccount(db, {
			householdId,
			accountId: "savings",
			name: "Savings",
			kind: "savings",
			balanceCents: 500_000,
			balanceId: "balance-savings",
			createdByMemberId: "alex",
		});
		await addGoal(db, {
			householdId,
			goalId: "braces",
			accountId: "savings",
			name: "Braces",
			targetCents: 600_000,
			targetDate: "2027-06-15",
			fromMonth: month,
			claimId: "claim-braces",
			claimCents: 100_000,
			createdByMemberId: "alex",
		});
		expect(
			await spendGoal(db, {
				householdId,
				transactionId: "deposit",
				goalId: "braces",
				date: "2026-09-10",
				amountCents: 50_000,
				note: "Deposit",
				createdByMemberId: "alex",
			}),
		).toMatchObject({ ok: true });
		expect(await loadQuickAddForNudge(db, sam, "deposit")).toBeNull();
		expect(await loadQuickAddForNudge(db, alex, "deposit")).toBeNull();
	});

	it("is never read from another Household", async () => {
		expect(
			await loadQuickAddForNudge(db, { householdId: "other", memberId: "sam" }, "milk"),
		).toBeNull();
	});
});

describe("Nudge preferences and devices", () => {
	it("gives a Parent the defaults until they save their own", async () => {
		expect(await loadNudgePreferences(db, household, "sam")).toEqual(
			defaultNudgePreferences(household.timeZone),
		);
		const preferences = {
			bucketPace: false,
			otherParentQuickAdds: true,
			windfalls: true,
			balanceChecks: false,
			quietHours: { start: 22 * 60, end: 6 * 60 },
			timeZone: "Europe/London",
		};
		await saveNudgePreferences(db, { householdId, memberId: "sam", preferences });
		await saveNudgePreferences(db, { householdId, memberId: "sam", preferences });
		expect(await loadNudgePreferences(db, household, "sam")).toEqual(preferences);
		expect(await loadNudgePreferences(db, household, "alex")).toEqual(
			defaultNudgePreferences(household.timeZone),
		);
	});

	it("a device goes to whoever turned it on last", async () => {
		await savePushSubscription(db, { householdId, memberId: "alex", ...device("https://a") });
		await savePushSubscription(db, { householdId, memberId: "sam", ...device("https://a") });
		expect(await loadPushSubscriptions(db, householdId, "alex")).toEqual([]);
		expect(await loadPushSubscriptions(db, householdId, "sam")).toEqual([device("https://a")]);
		// Both Parents could still get a Nudge: the bell lists it with a device or without.
		expect((await loadNudgeRecipients(db, householdId))?.recipients.map((r) => r.memberId)).toEqual(
			["alex", "sam"],
		);

		// Only its own Parent can turn a device off.
		await removePushSubscription(db, { householdId, memberId: "alex", endpoint: "https://a" });
		expect(await loadPushSubscriptions(db, householdId, "sam")).toHaveLength(1);
		await removePushSubscription(db, { householdId, memberId: "sam", endpoint: "https://a" });
		expect(await loadPushSubscriptions(db, householdId, "sam")).toEqual([]);
	});
});
