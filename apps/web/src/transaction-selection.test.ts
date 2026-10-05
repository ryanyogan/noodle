import type { DeletionSummary } from "@noodle/db";
import { describe, expect, it } from "vitest";
import {
	bulkDeletedMessage,
	deletionFacts,
	isPicked,
	nothingPicked,
	pickAll,
	pickedCount,
	selectionOf,
	stayingFacts,
	togglePicked,
} from "./transaction-selection";

const month = "2026-09" as const;
const summary: DeletionSummary = {
	count: 412,
	firstDate: "2025-10-03" as DeletionSummary["firstDate"],
	lastDate: "2026-09-30" as DeletionSummary["lastDate"],
	totalCents: 1820411,
	accounts: ["Chase Checking", "Sapphire"],
	filed: 120,
	split: 4,
	transfers: 1,
	refunds: 2,
	receipts: 1,
	closedMonths: 37,
	imported: 398,
	staying: 5,
};

describe("selecting Transactions", () => {
	it("picks one by one, by ID", () => {
		let picking = togglePicked(togglePicked(nothingPicked, "a"), "b");
		expect(isPicked(picking, "a")).toBe(true);
		expect(isPicked(picking, "c")).toBe(false);
		expect(pickedCount(picking, undefined)).toBe(2);
		picking = togglePicked(picking, "a");
		expect(isPicked(picking, "a")).toBe(false);
		expect(selectionOf(picking, month, { account: "acc" })).toEqual({ ids: ["b"] });
		expect(nothingPicked.picked.size).toBe(0);
	});

	it("picks everything the filters match, loaded or not, less the ones tapped off", () => {
		const picking = togglePicked(pickAll(false), "x");
		// A row the list hasn't loaded yet is selected all the same.
		expect(isPicked(picking, "never-loaded")).toBe(true);
		expect(isPicked(picking, "x")).toBe(false);
		expect(pickedCount(picking, undefined)).toBeUndefined();
		expect(pickedCount(picking, 38)).toBe(37);
		expect(selectionOf(picking, month, { account: "acc", q: "costco" })).toEqual({
			all: {
				month,
				andEarlier: false,
				bucketId: undefined,
				forMember: undefined,
				accountId: "acc",
				search: "costco",
			},
			except: ["x"],
		});
		expect(isPicked(togglePicked(picking, "x"), "x")).toBe(true);
	});

	it("picks the month and every month before it", () => {
		const selection = selectionOf(pickAll(true), month, { account: "acc" });
		expect(selection.all).toMatchObject({ month, andEarlier: true, accountId: "acc" });
		expect(selection.except).toEqual([]);
	});
});

describe("what the Parent is told", () => {
	it("states the facts before deleting", () => {
		expect(deletionFacts(summary)).toEqual([
			"412 Transactions from Oct 3, 2025 to Sep 30, 2026, adding up to $18,204.11.",
			"From Chase Checking and Sapphire.",
			"398 came from a bank or a statement. They won’t come back when your bank syncs or a statement is uploaded again.",
			"120 are already filed in a Bucket or a Commitment, which will show that much less spent.",
			"4 are split. Their Splits go with them.",
			"1 is one side of a Transfer. The other side stays and becomes an ordinary Transaction again.",
			"2 are part of a Refund. The link goes, and money back that stays is unassigned again.",
			"1 has a Receipt. The Receipts stay, unattached.",
			"37 are in months you’ve already closed. They are deleted too: what those months spent will change, and the Sweeps decided when they closed stay as they are.",
		]);
		expect(stayingFacts(summary)).toEqual([
			"5 are Goal spending or partly the other Parent’s, and will stay. Goal spending changes from its Goal.",
			"Money in (pay and other deposits) isn’t in this list and stays.",
		]);
	});

	it("leaves out what doesn't apply", () => {
		const plain = {
			...summary,
			count: 1,
			firstDate: summary.lastDate,
			accounts: [],
			filed: 0,
			split: 0,
			transfers: 0,
			refunds: 0,
			receipts: 0,
			closedMonths: 0,
			imported: 0,
			staying: 0,
			totalCents: 1250,
		};
		expect(deletionFacts(plain)).toEqual(["1 Transaction on Sep 30, 2026, adding up to $12.50."]);
		expect(stayingFacts(plain)).toEqual([
			"Money in (pay and other deposits) isn’t in this list and stays.",
		]);
		expect(deletionFacts({ ...plain, count: 0 })).toEqual([]);
	});

	it("says how many went, and that a snapshot was taken first", () => {
		expect(bulkDeletedMessage({ deleted: 412, snapshot: true })).toBe(
			"Deleted 412 Transactions. Noodle took a snapshot first, so you can put them back from Snapshots in Household settings.",
		);
		expect(bulkDeletedMessage({ deleted: 1, snapshot: true })).toMatch(/^Deleted 1 Transaction\. /);
		expect(bulkDeletedMessage({ deleted: 0, snapshot: false })).toBe(
			"Nothing was deleted: those Transactions had already gone.",
		);
	});
});
