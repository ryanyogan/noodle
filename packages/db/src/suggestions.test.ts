import { merchantKey, spotBuckets, spotCommitments } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addPersonalAllowance,
	createHouseholdForParent,
	type Db,
	decideDraft,
	decideSuggestion,
	loadLearnInputs,
	loadOpenSuggestions,
	loadSuggestionInputs,
	saveRule,
	saveSuggestions,
	type Viewer,
} from "./index";
import { categorizations, members, suggestions, transactions } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };
const today = "2026-10-03" as const;
let db: Db;

const charge = (
	id: string,
	date: string,
	amountCents: number,
	merchant: string,
	bucketId: string | null = null,
) =>
	db.insert(transactions).values({
		id,
		householdId,
		source: "import",
		date,
		amountCents,
		note: merchant.toUpperCase(),
		merchant,
		bucketId,
	});

const run = async () => {
	const inputs = await loadSuggestionInputs(db, householdId, "2025-09-01", "2026-10");
	return saveSuggestions(db, householdId, [
		...spotBuckets(inputs.lines, today, inputs.bucketNames),
		...spotCommitments(inputs.lines, inputs.commitments, today, inputs.bucketNames),
	]);
};

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
	for (const [i, date] of ["2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"].entries()) {
		await charge(`gym${i}`, date, 4_999, "Planet Fitness");
	}
});

describe("suggestions", () => {
	it("are saved once, and a dismissed one sticks unless its evidence changes a lot", async () => {
		expect(await run()).toBe(1);
		expect(await run()).toBe(0);
		const [gym] = await loadOpenSuggestions(db, alex);
		expect(gym).toMatchObject({
			kind: "new-commitment",
			personal: false,
			payload: { name: "Planet Fitness", amountCents: 4_999, cadence: "monthly" },
		});
		expect(await loadOpenSuggestions(db, sam)).toHaveLength(1);
		await decideSuggestion(db, sam, gym?.id ?? "", "dismissed");
		await charge("gym-old", "2026-06-02", 4_999, "Planet Fitness");
		await run();
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);
		// The price moved by more than 30%: it comes back.
		await db.delete(transactions);
		for (const [i, date] of ["2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"].entries()) {
			await charge(`gym-new${i}`, date, 7_999, "Planet Fitness");
		}
		await run();
		expect((await loadOpenSuggestions(db, alex)).map((s) => s.payload.amountCents)).toEqual([
			7_999,
		]);
	});

	it("already open take the new wording when it changes, as a row saved before #76 gains its reason", async () => {
		await run();
		const [gym] = await loadOpenSuggestions(db, alex);
		const { reason, ...older } = gym?.payload ?? {};
		expect(reason).toEqual(expect.any(String));
		await db.update(suggestions).set({ payload: older });
		expect((await loadOpenSuggestions(db, alex))[0]?.payload.reason).toBeUndefined();
		await run();
		const open = await loadOpenSuggestions(db, alex);
		expect(open.map((s) => s.id)).toEqual([gym?.id]);
		expect(open[0]?.payload.reason).toBe(reason);
	});

	it("rest on a Parent's Personal Allowance only for that Parent", async () => {
		await addPersonalAllowance(db, {
			householdId,
			memberId: "sam",
			bucketId: "sam-pa",
			name: "Sam's",
			color: 2,
			month: "2026-07",
			allowanceCents: 20_000,
		});
		for (const [i, date] of ["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].entries()) {
			await charge(`hobby${i}`, date, 2_500, "Hobby Box Subscription", "sam-pa");
		}
		await run();
		const forSam = await loadOpenSuggestions(db, sam);
		expect(forSam.map((s) => s.payload.name).sort()).toEqual([
			"Hobby Box Subscription",
			"Planet Fitness",
		]);
		expect(forSam.find((s) => s.payload.name === "Hobby Box Subscription")?.personal).toBe(true);
		expect((await loadOpenSuggestions(db, alex)).map((s) => s.payload.name)).toEqual([
			"Planet Fitness",
		]);
		const hobby = forSam.find((s) => s.personal);
		await decideSuggestion(db, alex, hobby?.id ?? "", "dismissed");
		expect(await loadOpenSuggestions(db, sam)).toHaveLength(2);
	});

	it("go when what they rest on is gone", async () => {
		await run();
		await db.delete(transactions);
		expect(await run()).toBe(1);
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);
	});
});

describe("suggestions and the first Plan's draft", () => {
	const gymKey = `commitment:${merchantKey("PLANET FITNESS")}`;
	const skip = () =>
		decideDraft(db, { householdId, memberId: "alex", month: "2026-10", skipped: [gymKey] });

	it("aren't made for a Commitment skipped in the draft, unless its evidence changes a lot", async () => {
		await skip();
		expect(await run()).toBe(0);
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);
		await db.delete(transactions);
		for (const [i, date] of ["2026-07-02", "2026-08-02", "2026-09-02", "2026-10-02"].entries()) {
			await charge(`gym-new${i}`, date, 7_999, "Planet Fitness");
		}
		await run();
		expect((await loadOpenSuggestions(db, alex)).map((s) => s.payload.amountCents)).toEqual([
			7_999,
		]);
	});

	it("already open go when the draft skips or adds the same thing", async () => {
		await run();
		expect(await loadOpenSuggestions(db, alex)).toHaveLength(1);
		await skip();
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);
		await run();
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);

		for (const [i, date] of ["2026-06-05", "2026-07-05", "2026-08-05", "2026-09-05"].entries()) {
			await charge(`spotify${i}`, date, 1_199, "Spotify");
		}
		await run();
		expect((await loadOpenSuggestions(db, alex)).map((s) => s.payload.name)).toEqual(["Spotify"]);
		await decideDraft(db, {
			householdId,
			memberId: "alex",
			month: "2026-10",
			commitments: [
				{
					key: `commitment:${merchantKey("SPOTIFY")}`,
					commitmentId: "music",
					name: "Music",
					amountCents: 1_199,
					cadence: "monthly",
					dueDate: "2026-11-01",
				},
			],
		});
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);
		await run();
		expect(await loadOpenSuggestions(db, alex)).toEqual([]);
	});
});

describe("loadLearnInputs", () => {
	it("reads imported lines a Parent filed by hand, and the Household's Rules with their owners", async () => {
		const author = { householdId, memberId: "alex", month: "2026-10", color: 1 } as const;
		await addBucket(db, {
			...author,
			bucketId: "groceries",
			name: "Groceries",
			allowanceCents: 60_000,
		});
		await addPersonalAllowance(db, {
			...author,
			bucketId: "alex-fun",
			name: "Alex's Fun",
			allowanceCents: 5_000,
		});
		await charge("hand1", "2026-09-10", 4_200, "Acme Widgets", "groceries");
		await charge("hand2", "2026-09-20", 1_500, "Comics Shop", "alex-fun");
		// Filed by categorization: its decision stands, so it isn't a hand pick.
		await charge("ai1", "2026-09-12", 3_000, "Trader Joe's", "groceries");
		await db.insert(categorizations).values({
			transactionId: "ai1",
			householdId,
			outcome: "filed",
			bucketId: "groceries",
			merchant: "trader joe's",
		});
		// Too old, and still in Review.
		await charge("old1", "2025-01-10", 4_200, "Acme Widgets", "groceries");
		await charge("loose", "2026-09-15", 900, "Corner Store");
		const ruleBase = { householdId, memberId: "alex" };
		await saveRule(db, { ...ruleBase, id: "r1", pattern: "costco", bucketId: "groceries" });
		await saveRule(db, { ...ruleBase, id: "r2", pattern: "comics shop", bucketId: "alex-fun" });

		const { filings, rules } = await loadLearnInputs(db, householdId, "2026-07-01");
		expect(filings.map((f) => f.id).sort()).toEqual(["hand1", "hand2"]);
		expect(filings.find((f) => f.id === "hand1")).toMatchObject({
			merchant: "Acme Widgets",
			bucketId: "groceries",
			bucketName: "Groceries",
			owner: null,
		});
		expect(filings.find((f) => f.id === "hand2")?.owner).toBe("alex");
		expect(rules).toEqual(
			expect.arrayContaining([
				{ pattern: "costco", bucketId: "groceries", owner: null },
				{ pattern: "comics shop", bucketId: "alex-fun", owner: "alex" },
			]),
		);
	});
});
