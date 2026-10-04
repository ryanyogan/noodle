import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, vi } from "vitest";
import { snapshotsKey } from "./household-changes";
import {
	refetchSnapshotsAfterApply,
	ruleAppliedMessage,
	ruleSavedMessage,
	ruleToastOptions,
	SNAPSHOT_FIRST,
} from "./review";

// What a Parent is told after a Rule is applied (#78, ADR-0035): when it filed more than one
// Transaction a snapshot was taken first, and the message says so and where to put things back.

const rule = { pattern: "costco", bucketName: "Groceries" };

describe("what's said after a Rule is applied", () => {
	test("says a snapshot was taken first, and where to put things back", () => {
		expect(SNAPSHOT_FIRST).toBe(
			"Noodle took a snapshot first, so you can put things back from Snapshots in Household settings.",
		);
		expect(ruleAppliedMessage({ filed: 12, snapshot: true }, rule)).toBe(
			`Filed 12 in Groceries. ${SNAPSHOT_FIRST}`,
		);
		expect(ruleSavedMessage({ filed: 12, snapshot: true }, rule)).toBe(
			`Rule saved. Filed 12 more in Groceries. ${SNAPSHOT_FIRST}`,
		);
	});

	test("stays as it was when no snapshot was taken", () => {
		expect(ruleAppliedMessage({ filed: 1, snapshot: false }, rule)).toBe("Filed 1 in Groceries");
		expect(ruleAppliedMessage({ filed: 0, snapshot: false }, rule)).toBe(
			"Nothing unassigned matches costco",
		);
		expect(ruleSavedMessage({ filed: 1, snapshot: false }, rule)).toBe(
			"Rule saved. Filed 1 more in Groceries.",
		);
		expect(ruleSavedMessage({ filed: 0, snapshot: false }, rule)).toBe(
			"Rule saved: costco goes in Groceries",
		);
	});
});

describe("how long what's said after a Rule is applied stays up", () => {
	test("ten seconds when it says a snapshot was taken, one at a time, and not until dismissed", () => {
		const options = ruleToastOptions({ filed: 12, snapshot: true });
		expect(options).toEqual({ tone: "success", duration: 10_000, id: "rule-snapshot" });
		expect(options).not.toHaveProperty("sticky");
	});

	test("as any short toast when no snapshot was taken", () => {
		expect(ruleToastOptions({ filed: 1, snapshot: false })).toBeUndefined();
		expect(ruleToastOptions({ filed: 0, snapshot: false })).toBeUndefined();
	});
});

describe("the snapshot history after a Rule is applied", () => {
	test("refetches when a snapshot was taken", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		refetchSnapshotsAfterApply(queryClient, { filed: 3, snapshot: true });
		expect(invalidate).toHaveBeenCalledExactlyOnceWith({ queryKey: snapshotsKey });
		expect(snapshotsKey).toEqual(["snapshots"]);
	});

	test("is left alone when none was", () => {
		const queryClient = new QueryClient();
		const invalidate = vi.spyOn(queryClient, "invalidateQueries");
		refetchSnapshotsAfterApply(queryClient, { filed: 1, snapshot: false });
		refetchSnapshotsAfterApply(queryClient, { filed: 0, snapshot: false });
		expect(invalidate).not.toHaveBeenCalled();
	});
});
