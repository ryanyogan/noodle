import { describe, expect, it } from "vitest";
import { isUnassigned, noBucketsSentence, nothingToFileIn } from "./before-plan";

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
