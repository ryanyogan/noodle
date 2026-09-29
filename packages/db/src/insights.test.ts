import type { DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	decideInsight,
	knownFingerprints,
	loadInsightSpends,
	loadInsights,
	type NewInsight,
	recordInsights,
	updateTransaction,
	type Viewer,
} from "./index";
import { insightFingerprint } from "./insights";
import { members } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const month = "2026-09";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };

let db: Db;

const quickAdd = (by: Viewer, transactionId: string, bucketId: string, note: string) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date: "2026-09-10" as DayKey,
		amountCents: 1_599,
		note,
		forMemberIds: [],
		createdByMemberId: by.memberId,
	});

const insight = (fields: Partial<NewInsight> = {}): NewInsight => ({
	id: "i1",
	householdId,
	ownerMemberId: null,
	kind: "duplicate-service",
	title: "Hulu and Disney+ may overlap",
	body: "…",
	yearlyImpactCents: 16_788,
	transactionIds: ["hulu"],
	commitmentIds: [],
	perkIds: [],
	fingerprint: "duplicate-service:m:disney,m:hulu",
	...fields,
});

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db
		.insert(members)
		.values({ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" });
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "fun",
		name: "Fun",
		color: 1,
		month,
		allowanceCents: 20_000,
	});
	for (const parent of [alex, sam]) {
		await addPersonalAllowance(db, {
			householdId,
			memberId: parent.memberId,
			bucketId: `${parent.memberId}-pa`,
			name: "Personal Allowance",
			color: 2,
			month,
			allowanceCents: 10_000,
		});
	}
	await quickAdd(alex, "hulu", "fun", "Hulu");
	await quickAdd(alex, "peacock", "alex-pa", "Peacock");
});

describe("what Insights rest on", () => {
	it("reads the Viewer's own Personal Allowance, marked private, and never the other Parent's", async () => {
		const forAlex = await loadInsightSpends(db, alex, "2026-01-01" as DayKey);
		expect(forAlex.map((s) => [s.id, s.private]).sort()).toEqual([
			["hulu", false],
			["peacock", true],
		]);
		const forSam = await loadInsightSpends(db, sam, "2026-01-01" as DayKey);
		expect(forSam.map((s) => s.id)).toEqual(["hulu"]);
	});
});

describe("stored Insights", () => {
	it("adds a finding once: found again, dismissed or not, it never returns", async () => {
		expect(await recordInsights(db, [insight()])).toBe(1);
		expect(await recordInsights(db, [insight({ id: "i2", title: "Reworded" })])).toBe(0);
		expect(await decideInsight(db, sam, { id: "i1", status: "dismissed" })).toBe(true);
		expect(await recordInsights(db, [insight({ id: "i3" })])).toBe(0);
		expect(await loadInsights(db, alex)).toEqual([]);
		expect(await loadInsights(db, sam)).toEqual([]);
		const stored = insightFingerprint(null, insight().fingerprint);
		expect(await knownFingerprints(db, householdId, [stored, "other"])).toEqual(new Set([stored]));
	});

	it("keeps an accepted Insight listed until it's dismissed, which is final", async () => {
		await recordInsights(db, [insight()]);
		expect(await decideInsight(db, alex, { id: "i1", status: "accepted" })).toBe(true);
		expect(await decideInsight(db, alex, { id: "i1", status: "accepted" })).toBe(false);
		expect((await loadInsights(db, sam)).map((i) => i.status)).toEqual(["accepted"]);
		expect(await decideInsight(db, sam, { id: "i1", status: "dismissed" })).toBe(true);
		expect(await decideInsight(db, sam, { id: "i1", status: "accepted" })).toBe(false);
		expect(await loadInsights(db, alex)).toEqual([]);
	});

	it("lists an Insight with its Transactions and Commitments", async () => {
		await recordInsights(db, [insight()]);
		const [listed] = await loadInsights(db, sam);
		expect(listed).toMatchObject({
			kind: "duplicate-service",
			yearlyImpact: 16_788,
			status: "new",
			transactions: [{ id: "hulu", amount: 1_599, note: "Hulu", date: "2026-09-10" }],
		});
	});

	it("shows a Parent's private Insight to them alone, and they alone decide it", async () => {
		await recordInsights(db, [
			insight({ ownerMemberId: "alex", transactionIds: ["hulu", "peacock"] }),
			// The same finding for the Household is another Insight.
			insight({ id: "i2" }),
		]);
		expect((await loadInsights(db, alex)).map((i) => i.id).sort()).toEqual(["i1", "i2"]);
		expect((await loadInsights(db, sam)).map((i) => i.id)).toEqual(["i2"]);
		expect(await decideInsight(db, sam, { id: "i1", status: "dismissed" })).toBe(false);
	});

	it("leaves out an Insight once one of its Transactions moves into the other Parent's Personal Allowance", async () => {
		await recordInsights(db, [insight()]);
		await updateTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: "hulu",
			amountCents: 1_599,
			assignment: { bucketId: "alex-pa" },
			note: "Hulu",
			forMemberIds: [],
		});
		expect(await loadInsights(db, sam)).toEqual([]);
		expect((await loadInsights(db, alex)).map((i) => i.id)).toEqual(["i1"]);
	});
});
