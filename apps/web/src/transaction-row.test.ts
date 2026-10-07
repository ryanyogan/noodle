import { describe, expect, it } from "vitest";
import { formatMoney } from "./format";
import { rowView } from "./transaction-row";
import { dayTotals, sortsByDate, tableSortOf, transactionSortOf } from "./transaction-table";
import type { TransactionRow, TransactionSort } from "./transactions";

const plan = {
	buckets: [{ id: "b1", name: "Groceries", color: "green" }],
	commitments: [{ id: "c1", name: "Rent" }],
} as unknown as Parameters<typeof rowView>[1];

const row = (over: Record<string, unknown> = {}) =>
	({
		id: "t1",
		date: "2026-10-03",
		amountCents: 8412,
		merchantName: "Costco",
		note: null,
		goal: null,
		bucketId: "b1",
		commitmentId: null,
		importedFrom: null,
		matchedIn: null,
		pending: false,
		for: [],
		splits: [],
		transfer: null,
		refundOf: null,
		autoFiled: null,
		...over,
	}) as unknown as TransactionRow;

const view = (over: Record<string, unknown> = {}, waiting = false) =>
	rowView(row(over), plan, [], waiting);
const money = formatMoney(8412);

describe("rowView", () => {
	it("a plain Transaction says its Bucket, who it was For and its Account", () => {
		const v = view({ importedFrom: "Visa ••1234" });
		expect(v).toMatchObject({
			kind: "plain",
			title: "Costco",
			amount: money,
			assigned: "Groceries",
			who: "Everyone",
			accountName: "Visa",
			accountDigits: " ••1234",
			detail: "Groceries · Everyone · Visa ••1234",
			label: `Costco, ${money}, Groceries, For Everyone, from Visa ••1234`,
			pending: false,
			autoFiled: false,
			matched: false,
			waiting: false,
		});
	});

	it("a payment to a card is called Card payment, unless a Parent named it", () => {
		const transfer = { from: "Checking", to: "Visa", reason: null };
		const bank = { merchantName: null, note: "PAYMENT THANK YOU - WEB", importedFrom: "Visa" };
		expect(view({ ...bank, transfer, paysCard: true })).toMatchObject({
			title: "Card payment",
			kindWord: "Transfer",
			label: `Card payment, ${money}, Transfer, Checking to Visa`,
		});
		expect(view({ ...bank, transfer, paysCard: true, merchantName: "Visa autopay" }).title).toBe(
			"Visa autopay",
		);
		// Any other Transfer keeps the bank's wording, cleaned up.
		expect(view({ ...bank, transfer }).title).toBe("Thank You");
	});

	it("says its second line either side of For, only where the line says For", () => {
		expect(view({ importedFrom: "Visa ••1234" }).aroundFor).toEqual({
			before: "Groceries",
			after: "Visa ••1234",
		});
		expect(view().aroundFor).toEqual({ before: "Groceries", after: "" });
		expect(view({ transfer: { from: "Checking", to: "Visa", reason: null } }).aroundFor).toBeNull();
		expect(view({ amountCents: -500 }).aroundFor).toBeNull();
	});

	it("with no name it says what kind of thing it is", () => {
		expect(view({ merchantName: null }).title).toBe("Quick Add");
		expect(view({ merchantName: null, importedFrom: "Visa" }).title).toBe("Imported");
		expect(view({ merchantName: null, bucketId: null, commitmentId: "c1" })).toMatchObject({
			title: "Payment",
			assigned: "Rent",
		});
		expect(view({ bucketId: null }).assigned).toBe("Unassigned");
		expect(view({ bucketId: "gone" }).assigned).toBe("An archived Bucket");
		expect(view().accountName).toBe("Quick Add");
	});

	it("a split one counts its Splits and names what they're assigned to", () => {
		const v = view({
			bucketId: null,
			autoFiled: "rule",
			splits: [
				{ bucketId: "b1", commitmentId: null },
				{ bucketId: null, commitmentId: "c1" },
			],
		});
		expect(v).toMatchObject({
			kind: "split",
			assigned: "Split · Groceries, Rent",
			detail: "Split across 2 · Groceries, Rent",
			label: `Costco, ${money}, Split across 2: Groceries, Rent`,
			autoFiled: false,
		});
	});

	it("a side of a Transfer names its Accounts and is For no one", () => {
		const v = view({ bucketId: null, transfer: { from: "Checking", to: "Visa" } });
		expect(v).toMatchObject({
			kind: "transfer",
			assigned: "Transfer · Checking → Visa",
			who: "",
			detail: "Transfer · Checking → Visa",
			label: `Costco, ${money}, Transfer, Checking to Visa`,
		});
	});

	it("a Refund and money back say so", () => {
		expect(view({ amountCents: -500, refundOf: "t0" })).toMatchObject({
			assigned: "Refund · Groceries",
			detail: "Refund · Groceries",
			amount: "+$5",
			moneyIn: true,
			kindWord: "Refund",
			label: "Costco, +$5, Refund, Groceries",
		});
		expect(view({ amountCents: -500, bucketId: null, importedFrom: "Visa" })).toMatchObject({
			assigned: "Money back",
			who: "",
			detail: "Money back · Visa",
			amount: "+$5",
			moneyIn: true,
			kindWord: null,
			label: "Costco, +$5, Money back, from Visa",
		});
	});

	it("says a one-word kind where a line isn't plain spending, and who it was For as names", () => {
		expect(view()).toMatchObject({ kindWord: null, moneyIn: false, forNames: ["Everyone"] });
		expect(view({ transfer: { from: "Checking", to: "Visa", reason: null } }).kindWord).toBe(
			"Transfer",
		);
		expect(view({ transfer: { from: "Checking", to: null, reason: "between-us" } }).kindWord).toBe(
			"Between us",
		);
	});

	it("Goal spending names its Goal", () => {
		const v = view({ merchantName: null, bucketId: null, goal: { id: "g1", name: "Vacation" } });
		expect(v).toMatchObject({
			kind: "goal",
			title: "Goal spending",
			assigned: "Vacation Goal",
			who: "",
			detail: "From the Vacation Goal",
			label: `Goal spending, ${money}, from the Vacation Goal`,
		});
	});

	it("says pending, filed automatically, waiting for the bank and Matched", () => {
		expect(view({ pending: true })).toMatchObject({
			pending: true,
			label: `Costco (pending), ${money}, Groceries, For Everyone`,
		});
		expect(view({ autoFiled: "rule" })).toMatchObject({
			autoFiled: true,
			label: `Costco, ${money}, Groceries (filed automatically), For Everyone`,
		});
		expect(view({}, true)).toMatchObject({
			waiting: true,
			label: `Costco, ${money}, Groceries, For Everyone, waiting for the bank’s copy`,
		});
		expect(view({ matchedIn: "Visa ••1234" }, true)).toMatchObject({
			matched: true,
			waiting: false,
			accountName: "Visa",
			label: `Costco, ${money}, Groceries, For Everyone, Matched in Visa ••1234`,
		});
	});
});

describe("the table's order", () => {
	const sorts: TransactionSort[] = [
		"newest",
		"oldest",
		"largest",
		"smallest",
		"name-az",
		"name-za",
		"assigned-az",
		"assigned-za",
		"account-az",
		"account-za",
	];
	it("every order is a column and a direction, and back", () => {
		for (const sort of sorts) expect(transactionSortOf(tableSortOf(sort))).toBe(sort);
		expect(tableSortOf("newest")).toEqual({ id: "date", desc: true });
		expect(tableSortOf("name-az")).toEqual({ id: "name", desc: false });
		expect(transactionSortOf({ id: "for", desc: false })).toBe("newest");
		expect(sorts.filter(sortsByDate)).toEqual(["newest", "oldest"]);
	});

	it("a day's total leaves Transfers out, and waits while the day may go on", () => {
		const rows = [
			{ date: "2026-10-03", amountCents: 1000, transfer: null },
			{ date: "2026-10-03", amountCents: 5000, transfer: { from: "A", to: "B" } },
			{ date: "2026-10-03", amountCents: -200, transfer: null },
			{ date: "2026-10-02", amountCents: 300, transfer: null },
		] as unknown as TransactionRow[];
		expect([...dayTotals(rows, false)]).toEqual([
			["2026-10-03", 800],
			["2026-10-02", 300],
		]);
		expect(dayTotals(rows, true).get("2026-10-02" as never)).toBeNull();
	});
});
