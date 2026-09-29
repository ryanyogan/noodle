import {
	addBucket,
	addCommitment,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	decideInsight,
	decidePerkSource,
	loadInsights,
	loadPerkSources,
	saveResearch,
	type Viewer,
} from "@noodle/db";
import { members } from "@noodle/db/schema";
import { testDb } from "@noodle/db/test-db";
import type { DayKey } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	type InsightModel,
	type InsightToWord,
	type NameToGroup,
	readGroups,
	readWording,
	stubInsightModel,
} from "./insights-model";
import { type InsightDeps, lookForHouseholdInsights, lookForInsights } from "./insights-run";

const householdId = "household";
const month = "2026-09";
const asOf = "2026-09-28" as DayKey;
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };

let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;

/** The fake model, recording every name and Insight it was shown. */
function recordingModel() {
	const grouped: NameToGroup[][] = [];
	const worded: InsightToWord[][] = [];
	const model: InsightModel = {
		group: (names) => {
			grouped.push(names);
			return stubInsightModel.group(names);
		},
		word: (insights) => {
			worded.push(insights);
			return stubInsightModel.word(insights);
		},
	};
	const shown = () => JSON.stringify([grouped, worded]).toLowerCase();
	return { model, grouped, worded, shown };
}

const deps = (model: InsightModel): InsightDeps => ({ db, model, newId });

beforeEach(async () => {
	db = testDb();
	ids = 0;
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
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month: "2026-06",
		allowanceCents: 10_000,
	});
	for (const [commitmentId, name, amountCents] of [
		["disney", "Disney+", 1_399],
		["hulu", "Hulu bundle", 2_499],
	] as const) {
		await addCommitment(db, {
			householdId,
			memberId: "alex",
			commitmentId,
			name,
			month: "2026-06",
			amountCents,
			cadence: "monthly",
			dueDate: "2026-06-05" as DayKey,
		});
	}
	// Alex pays for ESPN+ from their own Personal Allowance: Sam must never learn of it.
	for (const date of ["2026-08-15", "2026-09-15"]) {
		await addQuickAdd(db, {
			householdId,
			transactionId: newId(),
			bucketId: "alex-pa",
			date: date as DayKey,
			amountCents: 1_199,
			note: "ESPN+ monthly",
			forMemberIds: [],
			createdByMemberId: "alex",
		});
	}
});

describe("looking for Insights", () => {
	it("groups services with the model, words what domain code found, and keeps the figures", async () => {
		const { model, grouped } = recordingModel();
		expect(await lookForInsights(deps(model), sam, asOf)).toBe(1);
		expect(grouped[0]?.map((n) => n.name)).toEqual(["Hulu bundle", "Disney+"]);
		expect(await loadInsights(db, sam)).toMatchObject([
			{
				kind: "duplicate-service",
				title: "Disney+ and Hulu bundle may overlap (stub)",
				yearlyImpact: 1_399 * 12,
				commitments: [
					{ id: "disney", name: "Disney+" },
					{ id: "hulu", name: "Hulu bundle" },
				],
				transactions: [],
			},
		]);
	});

	it("never shows the model the other Parent's Personal Allowance, and keeps a Parent's own Insight theirs", async () => {
		const forSam = recordingModel();
		await lookForInsights(deps(forSam.model), sam, asOf);
		expect(forSam.shown()).not.toContain("espn");

		const forAlex = recordingModel();
		await lookForInsights(deps(forAlex.model), alex, asOf);
		expect(forAlex.grouped[0]?.map((n) => n.name)).toContain("ESPN+ monthly");
		// Alex's own Insight is worded in a call of its own, apart from anything the Household sees.
		expect(forAlex.worded.every((batch) => batch.length === 1)).toBe(true);

		const alexSees = await loadInsights(db, alex);
		const samSees = await loadInsights(db, sam);
		expect(alexSees.map((i) => i.title).sort()).toEqual([
			"Disney+ and Hulu bundle may overlap (stub)",
			"Disney+, Hulu bundle, and ESPN+ monthly may overlap (stub)",
		]);
		expect(samSees.map((i) => i.title)).toEqual(["Disney+ and Hulu bundle may overlap (stub)"]);
		expect(JSON.stringify(samSees).toLowerCase()).not.toContain("espn");
	});

	it("never brings back a dismissed Insight, and doesn't ask the model about it again", async () => {
		const first = recordingModel();
		expect(await lookForHouseholdInsights(deps(first.model), householdId, asOf)).toBe(2);
		for (const insight of await loadInsights(db, alex)) {
			await decideInsight(db, alex, { id: insight.id, status: "dismissed" });
		}
		const again = recordingModel();
		expect(await lookForHouseholdInsights(deps(again.model), householdId, asOf)).toBe(0);
		expect(again.worded).toEqual([]);
		expect(await loadInsights(db, alex)).toEqual([]);
	});

	it("keeps domain code's wording when the model fails", async () => {
		const failing: InsightModel = {
			group: stubInsightModel.group,
			word: () => Promise.reject(new Error("down")),
		};
		await lookForInsights(deps(failing), sam, asOf);
		expect((await loadInsights(db, sam)).map((i) => i.title)).toEqual([
			"Disney+ and Hulu bundle may overlap",
		]);
	});
});

describe("Perk Sources and Perk Overlaps", () => {
	it("spots a Perk Source among the Commitments, then finds a service it includes", async () => {
		for (const [commitmentId, name, amountCents] of [
			["t-mobile", "T-Mobile", 14_000],
			["netflix", "Netflix", 1_799],
		] as const) {
			await addCommitment(db, {
				householdId,
				memberId: "alex",
				commitmentId,
				name,
				month,
				amountCents,
				cadence: "monthly",
				dueDate: "2026-09-05" as DayKey,
			});
		}
		const { model } = recordingModel();
		await lookForInsights(deps(model), sam, asOf);
		const [suggestion] = await loadPerkSources(db, sam);
		expect(suggestion).toMatchObject({ name: "T-Mobile", status: "suggested", seenIn: "T-Mobile" });
		if (!suggestion) return;

		// Not until it's confirmed and researched.
		expect((await loadInsights(db, sam)).map((i) => i.kind)).not.toContain("perk-service");
		await decidePerkSource(db, sam, { id: suggestion.id, status: "confirmed" });
		await saveResearch(db, {
			householdId,
			perkSourceId: suggestion.id,
			checkedAt: new Date("2026-09-28T12:00:00Z"),
			newId,
			outcome: {
				research: "done",
				sourceUrl: "https://www.t-mobile.com/cell-phone-plans",
				perks: [
					{
						name: "Netflix Standard with ads",
						kind: "service",
						matches: "Netflix",
						tiers: [],
						quote: "Netflix Standard with ads is on us",
					},
				],
			},
		});
		await lookForInsights(deps(model), sam, asOf);
		expect((await loadInsights(db, alex)).find((i) => i.kind === "perk-service")).toMatchObject({
			title: "Netflix may come with T-Mobile (stub)",
			yearlyImpact: 1_799 * 12,
			commitments: [{ id: "netflix" }],
			perks: [
				{
					name: "Netflix Standard with ads",
					sourceName: "T-Mobile",
					sourceUrl: "https://www.t-mobile.com/cell-phone-plans",
				},
			],
		});
	});
});

describe("reading the model's answers", () => {
	const names = [
		{ code: "s1", name: "Netflix" },
		{ code: "s2", name: "NETFLIX.COM" },
		{ code: "s3", name: "Hulu" },
	];

	it("keeps only codes it was given, each in one group of two or more", () => {
		const text = '```json\n{"groups": [["s1","s2","s9"], ["s3"], ["s2","s3"]]}\n```';
		expect(readGroups(text, names)).toEqual([["s1", "s2"]]);
		expect(readGroups("not json", names)).toEqual([]);
	});

	it("drops wording for unknown Insights, with figures, or too long", () => {
		const insights: InsightToWord[] = [
			{ code: "i1", kind: "unused", subjects: ["Gym"], title: "t", body: "b" },
			{ code: "i2", kind: "unused", subjects: ["Pool"], title: "t", body: "b" },
		];
		const text = JSON.stringify({
			insights: [
				{ code: "i1", title: "Still using the gym?", body: "It hasn’t charged lately." },
				{ code: "i2", title: "Pool", body: "Save $120 a year." },
				{ code: "i7", title: "Made up", body: "Nothing." },
			],
		});
		expect(readWording(text, insights)).toEqual([
			{ code: "i1", title: "Still using the gym?", body: "It hasn’t charged lately." },
		]);
	});
});
