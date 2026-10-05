import { addBucket, createHouseholdForParent, type Db, loadOpenSuggestions } from "@noodle/db";
import { buckets, commitments, rules, suggestions } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import { isValid } from "ulid";
import { beforeEach, describe, expect, it } from "vitest";
import { addedId, applyDecision } from "./suggestion-decision";

// Deciding a suggestion (#76): Add lands once however often it's sent, the decision is durable
// before anything optional happens, and "Not now" sticks.

const householdId = "household";
const viewer = { householdId, memberId: "alex" };
const who = { viewer, timeZone: "America/Chicago" };
const evidence = { count: 4, amountCents: 4_999, months: 4, transactionIds: [] };
let db: Db;
let deferred: Promise<unknown>[];
const defer = (work: Promise<unknown>) => void deferred.push(work);

const suggest = (id: string, kind: "new-commitment" | "new-bucket" | "rule", payload: object) =>
	db.insert(suggestions).values({
		id,
		householdId,
		kind,
		key: id,
		payload: { kind, ...payload },
		evidence,
		fingerprint: id,
	});

const gym = {
	name: "Planet Fitness",
	amountCents: 4_999,
	cadence: "monthly",
	dueDate: "2026-11-02",
};
const add = (suggestionId: string) => ({ suggestionId, decision: "add" as const });

beforeEach(async () => {
	db = testDb();
	deferred = [];
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await suggest("gym", "new-commitment", gym);
});

describe("adding a suggested Commitment", () => {
	it("makes one Commitment when Add is sent twice, one after the other", async () => {
		await applyDecision(db, who, add("gym"), defer);
		await applyDecision(db, who, add("gym"), defer);
		expect(await db.select().from(commitments)).toHaveLength(1);
		expect(await loadOpenSuggestions(db, viewer)).toEqual([]);
	});

	it("makes one Commitment when two Adds both find it still open", async () => {
		await Promise.all([
			applyDecision(db, who, add("gym"), defer),
			applyDecision(db, who, add("gym"), defer),
		]);
		const added = await db.select().from(commitments);
		expect(added.map((row) => row.name)).toEqual(["Planet Fitness"]);
		expect(isValid(added[0]?.id ?? "")).toBe(true);
	});

	it("is accepted, not offered again, when what comes after the write fails", async () => {
		await applyDecision(db, who, add("gym"), () => {
			throw new Error("the Worker is going away");
		});
		expect(await db.select().from(commitments)).toHaveLength(1);
		expect(await loadOpenSuggestions(db, viewer)).toEqual([]);
		const [row] = await db.select().from(suggestions);
		expect(row?.status).toBe("accepted");
	});

	it("is added with the terms the Parent changed", async () => {
		await applyDecision(
			db,
			who,
			{ ...add("gym"), terms: { name: "Gym", amountCents: 5_500 } },
			defer,
		);
		expect((await db.select().from(commitments)).map((row) => row.name)).toEqual(["Gym"]);
	});

	it("gets a new ID once the suggestion has been opened again", async () => {
		const at = new Date("2026-10-04T12:00:00Z");
		const first = await addedId({ id: "gym", updatedAt: at });
		expect(await addedId({ id: "gym", updatedAt: at })).toBe(first);
		expect(await addedId({ id: "gym", updatedAt: new Date(at.getTime() + 1) })).not.toBe(first);
		expect(await addedId({ id: "music", updatedAt: at })).not.toBe(first);
	});
});

describe("other decisions", () => {
	it("“Not now” sticks, even when telling the other screens fails, and adds nothing", async () => {
		await applyDecision(db, who, { suggestionId: "gym", decision: "not-now" }, () => {
			throw new Error("the Worker is going away");
		});
		await applyDecision(db, who, add("gym"), defer);
		expect(await loadOpenSuggestions(db, viewer)).toEqual([]);
		expect((await db.select().from(suggestions))[0]?.status).toBe("dismissed");
		expect(await db.select().from(commitments)).toHaveLength(0);
	});

	it("a suggested Bucket added twice is one Bucket", async () => {
		await suggest("pets", "new-bucket", { name: "Pets", amountCents: 6_000 });
		const before = (await db.select().from(buckets)).length;
		await Promise.all([
			applyDecision(db, who, add("pets"), defer),
			applyDecision(db, who, add("pets"), defer),
		]);
		expect(await db.select().from(buckets)).toHaveLength(before + 1);
	});

	it("a suggested Rule added twice is one Rule", async () => {
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId: "supplies",
			name: "Supplies",
			color: 1,
			month: "2026-10",
			allowanceCents: 10_000,
		});
		await suggest("widgets", "rule", { name: "Acme Widgets", bucketId: "supplies" });
		await Promise.all([
			applyDecision(db, who, add("widgets"), defer),
			applyDecision(db, who, add("widgets"), defer),
		]);
		expect(await db.select().from(rules)).toHaveLength(1);
		expect((await loadOpenSuggestions(db, viewer)).map((item) => item.id)).toEqual(["gym"]);
	});
});
