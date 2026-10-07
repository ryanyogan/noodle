import type { InfiniteData } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { TransactionsPage } from "./server/transactions";
import {
	cellEdits,
	cellName,
	forEdits,
	forOf,
	refileOf,
	renameOf,
	splitsFor,
	undoOf,
} from "./transaction-cells";
import { escapeStep } from "./transaction-table";
import { type TransactionRow, withRowChange, withTransactionChange } from "./transactions";

const row = (over: Partial<TransactionRow> = {}): TransactionRow => ({
	id: "01HZZZZZZZZZZZZZZZZZZZZZZA",
	date: "2026-10-03" as TransactionRow["date"],
	amountCents: 8412,
	bucketId: "b1",
	commitmentId: null,
	goal: null,
	note: "Costco",
	merchantName: null,
	importedFrom: null,
	pending: false,
	matchedIn: null,
	transfer: null,
	refundOf: null,
	for: ["m1"],
	splits: [],
	partlyPrivate: false,
	autoFiled: null,
	version: 3,
	...over,
});

const split = {
	id: "s1",
	amountCents: 4000,
	bucketId: "b1",
	commitmentId: null,
	goal: null,
	for: [],
};

describe("which rows can be edited in a cell", () => {
	it("a payment to a card is renamed in its cell like any side of a Transfer (issue 141)", () => {
		const transfer = { from: "Checking", to: "Visa", reason: null };
		expect(cellEdits(row({ transfer, paysCard: true }))).toEqual({ name: "rename", refile: false });
		expect(cellEdits(row({ transfer })).name).toBe("rename");
		const bank = { importedFrom: "Visa", note: "PAYMENT THANK YOU - WEB", merchantName: null };
		expect(renameOf(row({ ...bank, transfer, paysCard: true }), "Visa autopay")).toEqual({
			rename: "Visa autopay",
		});
	});

	it("a Transaction assigned as a whole is renamed and refiled in its cells", () => {
		expect(cellEdits(row())).toEqual({ name: "edit", refile: true });
		expect(cellEdits(row({ bucketId: null, commitmentId: "c1" }))).toEqual({
			name: "edit",
			refile: true,
		});
	});

	it("an unassigned one is renamed by the name-only write and can be filed", () => {
		expect(cellEdits(row({ bucketId: null }))).toEqual({ name: "rename", refile: true });
	});

	it("a split, a side of a Transfer, money back and a Refund are renamed but not refiled", () => {
		const only = { name: "rename", refile: false };
		expect(cellEdits(row({ bucketId: null, splits: [split, { ...split, id: "s2" }] }))).toEqual(
			only,
		);
		expect(
			cellEdits(row({ bucketId: null, transfer: { from: "Checking", to: "Visa", reason: null } })),
		).toEqual(only);
		expect(cellEdits(row({ bucketId: null, amountCents: -2499 }))).toEqual(only);
		expect(cellEdits(row({ amountCents: -2499, refundOf: "Gear" }))).toEqual(only);
	});

	it("Goal spending and a partly private row have no cell to edit", () => {
		const none = { name: null, refile: false };
		expect(cellEdits(row({ bucketId: null, goal: { id: "g1", name: "Trip" } }))).toEqual(none);
		expect(cellEdits(row({ partlyPrivate: true, note: null }))).toEqual(none);
	});
});

describe("the rename a Name cell writes", () => {
	it("a by-hand row's name is its note, saved with everything else as it is", () => {
		expect(renameOf(row(), "  Costco run ")).toEqual({
			amountCents: 8412,
			assignment: { bucketId: "b1" },
			forMemberIds: ["m1"],
			note: "Costco run",
		});
	});

	it("a bank row keeps the bank's wording as its note and takes the name", () => {
		const bank = row({ importedFrom: "Checking ••3210", note: "COSTCO WHSE #1234" });
		expect(renameOf(bank, "Costco")).toBeNull();
		expect(renameOf(bank, "Big shop")).toEqual({
			amountCents: 8412,
			assignment: { bucketId: "b1" },
			forMemberIds: ["m1"],
			note: "COSTCO WHSE #1234",
			name: "Big shop",
		});
	});

	it("rows the whole-assignment write can't take get the name-only write", () => {
		expect(renameOf(row({ bucketId: null }), "Lunch")).toEqual({ rename: "Lunch" });
		expect(renameOf(row({ bucketId: null, amountCents: -500 }), "Lunch")).toEqual({
			rename: "Lunch",
		});
	});

	it("nothing typed, the same name, or a row that can't be renamed saves nothing", () => {
		expect(renameOf(row(), "   ")).toBeNull();
		expect(renameOf(row(), "Costco")).toBeNull();
		expect(renameOf(row({ goal: { id: "g1", name: "Trip" } }), "New")).toBeNull();
	});

	it("lands on the row at once: a bank row's name, a by-hand row's note", () => {
		const list = (transaction: TransactionRow): InfiniteData<TransactionsPage> => ({
			pages: [{ transactions: [transaction] } as TransactionsPage],
			pageParams: [null],
		});
		const bank = row({ importedFrom: "Checking", note: "COSTCO WHSE", bucketId: null });
		const named = withRowChange(list(bank), {
			transaction: bank,
			label: "x",
			next: { rename: "Big shop" },
		});
		expect(named.pages[0]?.transactions[0]).toMatchObject({
			merchantName: "Big shop",
			note: "COSTCO WHSE",
			version: 3,
		});
		const hand = row({ bucketId: null });
		const noted = withRowChange(list(hand), {
			transaction: hand,
			label: "x",
			next: { rename: "Lunch" },
		});
		expect(noted.pages[0]?.transactions[0]).toMatchObject({ note: "Lunch", bucketId: null });
	});

	it("moves no money in the month", () => {
		const month = { spending: [{ id: row().id }], charges: [] } as never;
		expect(
			withTransactionChange(month, { transaction: row(), label: "x", next: { rename: "Lunch" } }),
		).toBe(month);
	});
});

describe("the refile an Assigned to cell writes", () => {
	it("keeps the amount, note and For, with the new Bucket or Commitment", () => {
		expect(refileOf(row(), "bucket:b2")).toEqual({
			amountCents: 8412,
			note: "Costco",
			assignment: { bucketId: "b2" },
			forMemberIds: ["m1"],
		});
		expect(refileOf(row({ bucketId: null }), "commitment:c1")).toMatchObject({
			assignment: { commitmentId: "c1" },
		});
	});

	it("is nothing when it is already there, or the row can't be refiled", () => {
		expect(refileOf(row(), "bucket:b1")).toBeNull();
		expect(refileOf(row({ bucketId: null, amountCents: -500 }), "bucket:b2")).toBeNull();
		expect(refileOf(row(), "nonsense")).toBeNull();
	});
});

describe("Undo for a cell's change", () => {
	it("refiles back where it was, and can't unassign", () => {
		const next = refileOf(row(), "bucket:b2");
		expect(next && undoOf(row(), next)).toMatchObject({ assignment: { bucketId: "b1" } });
		const unassigned = row({ bucketId: null });
		const filed = refileOf(unassigned, "bucket:b2");
		expect(filed && undoOf(unassigned, filed)).toBeNull();
	});

	it("names it back", () => {
		expect(undoOf(row({ bucketId: null }), { rename: "Lunch" })).toEqual({ rename: "Costco" });
		expect(undoOf(row({ bucketId: null, note: null }), { rename: "Lunch" })).toBeNull();
		const next = renameOf(row(), "Costco run");
		expect(next && undoOf(row(), next)).toMatchObject({ note: "Costco" });
		const bank = row({ importedFrom: "Checking", note: "COSTCO WHSE" });
		const named = renameOf(bank, "Big shop");
		expect(named && undoOf(bank, named)).toMatchObject({
			note: "COSTCO WHSE",
			name: cellName(bank),
		});
	});
});

describe("Esc with a cell being edited", () => {
	const at = { overlay: false, cell: false, typing: false, open: false, selecting: false };

	it("an open picker takes it first, then the cell's field, then the open Transaction", () => {
		expect(escapeStep({ ...at, overlay: true, cell: true, open: true })).toBe("nothing");
		expect(escapeStep({ ...at, cell: true, typing: true, open: true, selecting: true })).toBe(
			"cell",
		);
		expect(escapeStep({ ...at, open: true, selecting: true })).toBe("close");
		expect(escapeStep({ ...at, selecting: true })).toBe("unselect");
	});
});

describe("changing who a row is For from its chips (issue 134)", () => {
	it("writes the row as it is, with the new For", () => {
		expect(forOf(row(), ["m2", "m1", "m2"])).toEqual({
			amountCents: 8412,
			note: "Costco",
			assignment: { bucketId: "b1" },
			forMemberIds: ["m1", "m2"],
		});
		expect(forOf(row(), [])).toMatchObject({ forMemberIds: [] });
	});

	it("is nothing when For is as it was", () => {
		expect(forOf(row(), ["m1"])).toBeNull();
	});

	it("an unassigned row changes only its For, and stays unassigned (issue 141)", () => {
		const unassigned = row({ bucketId: null });
		expect(forEdits(unassigned)).toBe(true);
		expect(forOf(unassigned, ["m2", "m1", "m2"])).toEqual({ for: ["m1", "m2"] });
		expect(forOf(unassigned, ["m1"])).toBeNull();
		expect(undoOf(unassigned, { for: [] })).toEqual({ for: ["m1"] });
	});

	it("a split row sets every Split's For where they have none or the same", () => {
		const even = row({
			bucketId: null,
			for: [],
			splits: [split, { ...split, id: "s2", for: ["m2"] }],
		});
		expect(splitsFor(even)).toEqual(["m2"]);
		expect(forEdits(even)).toBe(true);
		expect(forOf(even, ["m1"])).toEqual({ for: ["m1"] });
		// Said again as it is: the Split that had none takes it too.
		expect(forOf(even, ["m2"])).toEqual({ for: ["m2"] });
		// Its Splits didn't all say the same, so there is nothing one write could put back.
		expect(undoOf(even, { for: ["m1"] })).toBeNull();
		const all = row({ bucketId: null, for: [], splits: [split, { ...split, id: "s2" }] });
		expect(forOf(all, [])).toBeNull();
		expect(undoOf(all, { for: ["m1"] })).toEqual({ for: [] });
	});

	it("a split row whose Splits are For different people has no chip", () => {
		const differs = row({
			bucketId: null,
			for: [],
			splits: [
				{ ...split, for: ["m1"] },
				{ ...split, id: "s2", for: ["m2"] },
			],
		});
		expect(splitsFor(differs)).toBeNull();
		expect(forEdits(differs)).toBe(false);
		expect(forOf(differs, ["m1"])).toBeNull();
	});

	it("is not offered where For doesn't apply, or the row isn't theirs to change", () => {
		expect(forOf(row({ goal: { id: "g1", name: "Trip" }, bucketId: null }), [])).toBeNull();
		expect(forOf(row({ amountCents: -2499 }), [])).toBeNull();
		expect(forOf(row({ transfer: { from: "Checking", to: "Visa", reason: null } }), [])).toBeNull();
		expect(forOf(row({ partlyPrivate: true }), [])).toBeNull();
	});

	it("can be undone", () => {
		const next = forOf(row(), []);
		expect(next && undoOf(row(), next)).toMatchObject({ forMemberIds: ["m1"] });
	});
});
