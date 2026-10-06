import { describe, expect, it } from "vitest";
import {
	cantSaveSentence,
	isUnassigned,
	noBucketsSentence,
	noSplitSentence,
	nothingToFileIn,
	pastPlanSentence,
} from "./before-plan";

const none = { buckets: [], commitments: [] };

describe("nothingToFileIn", () => {
	it("is a past month whose Plan has no Bucket and no Commitment", () => {
		expect(nothingToFileIn(none, "2026-03", "2026-10")).toBe(true);
	});
	it("is not a month with a Bucket, or with a Commitment", () => {
		expect(nothingToFileIn({ buckets: [{}], commitments: [] }, "2026-03", "2026-10")).toBe(false);
		expect(nothingToFileIn({ buckets: [], commitments: [{}] }, "2026-03", "2026-10")).toBe(false);
	});
	it("is not the month it is now or a later one: a Bucket can still be created there", () => {
		expect(nothingToFileIn(none, "2026-10", "2026-10")).toBe(false);
		expect(nothingToFileIn(none, "2026-11", "2026-10")).toBe(false);
	});
	it("is not a Plan that hasn't loaded", () => {
		expect(nothingToFileIn(null, "2026-03", "2026-10")).toBe(false);
		expect(nothingToFileIn(undefined, "2026-03", "2026-10")).toBe(false);
	});
});

describe("pastPlanSentence", () => {
	it("says a month that is over can't be given a new Bucket, with the year when it isn't this one", () => {
		expect(pastPlanSentence("2026-09", "2026-10")).toBe(
			"Nothing in September matches, and a past month’s Plan can’t be given a new Bucket.",
		);
		expect(pastPlanSentence("2025-12", "2026-10")).toBe(
			"Nothing in December 2025 matches, and a past month’s Plan can’t be given a new Bucket.",
		);
	});
	it("is null for the month it is now and later ones: a Bucket can be created there", () => {
		expect(pastPlanSentence("2026-10", "2026-10")).toBeNull();
		expect(pastPlanSentence("2026-11", "2026-10")).toBeNull();
	});
});

describe("a month with nothing to file in", () => {
	it("says why its Transaction can't be split", () => {
		expect(noSplitSentence("2026-03", "2026-10")).toBe(
			"It can’t be split: each Split belongs to a Bucket, and March had none.",
		);
	});
	it("says why Save can't keep a change to an Unassigned one", () => {
		expect(cantSaveSentence("2025-03", "2026-10")).toBe(
			"March 2025 had no Buckets, so there’s nothing to assign this to and changes to it can’t be saved.",
		);
	});
});

describe("noBucketsSentence", () => {
	it("names the month and offers filing without a Bucket", () => {
		expect(noBucketsSentence("2026-03", "2026-10", true)).toBe(
			"March had no Buckets yet. Transactions from before your Plan can stay Unassigned, or file this one without a Bucket.",
		);
	});
	it("leaves the offer out when there is none, and says the year when it isn't this one", () => {
		expect(noBucketsSentence("2025-12", "2026-10", false)).toBe(
			"December 2025 had no Buckets yet. Transactions from before your Plan can stay Unassigned.",
		);
	});
});

describe("isUnassigned", () => {
	const row = { bucketId: null, commitmentId: null, goal: null, splits: [] };
	it("is a Transaction in no Bucket, Commitment or Goal, and not split", () => {
		expect(isUnassigned(row)).toBe(true);
		expect(isUnassigned({ ...row, bucketId: "b" })).toBe(false);
		expect(isUnassigned({ ...row, commitmentId: "c" })).toBe(false);
		expect(isUnassigned({ ...row, goal: { id: "g" } })).toBe(false);
		expect(isUnassigned({ ...row, splits: [{}] })).toBe(false);
	});
});
