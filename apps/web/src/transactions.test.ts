import { forTotals, monthState } from "@noodle/domain";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, test } from "vitest";
import { monthQuery } from "./queries";
import type { MonthData } from "./server/month";
import {
	accountTransactionsQuery,
	applyTransactionChange,
	dateChange,
	dateRefusedText,
	dateUnassignedText,
	dateUndo,
	monthOfTransaction,
	nameGiven,
	type TransactionChange,
	type TransactionRow,
	transactionQuery,
	transactionsQuery,
	withRowChange,
	withTransactionChange,
} from "./transactions";

const month: MonthData = {
	plan: {
		month: "2026-09",
		baseline: 500_000,
		commitments: [
			{
				id: "mortgage",
				name: "Mortgage",
				amount: 200_000,
				cadence: "monthly",
				dueDate: "2026-09-01",
			},
		],
		buckets: [
			{ id: "groceries", name: "Groceries", color: 1, allowance: 120_000, rolling: false },
			{ id: "hockey", name: "Hockey", color: 2, allowance: 40_000, rolling: false },
		],
	},
	planBefore: { month: "2026-08", baseline: 500_000, commitments: [], buckets: [] },
	spending: [
		{ id: "costco", bucketId: "groceries", amount: 18_642, date: "2026-09-13", for: [] },
		{ id: "skates", bucketId: "groceries", amount: 6_499, date: "2026-09-12", for: [] },
	],
	charges: [],
	moves: [],
	rolledOver: {},
	goalFunding: [],
	sweeps: [],
	closed: null,
	income: [],
	asOf: "2026-09-15",
	editable: true,
	firstMonth: "2026-01",
};

const skates: TransactionRow = {
	id: "skates",
	date: "2026-09-12",
	amountCents: 6_499,
	bucketId: "groceries",
	commitmentId: null,
	goal: null,
	note: "Pro Hockey Life",
	merchantName: null,
	for: [],
	splits: [],
	partlyPrivate: false,
	importedFrom: null,
	pending: false,
	matchedIn: null,
	transfer: null,
	refundOf: null,
	autoFiled: null,
	version: 0,
};

const monthQueryKey = (key: Parameters<typeof monthQuery>[0]) => monthQuery(key).queryKey;

const change = (next: TransactionChange["next"]): TransactionChange => ({
	transaction: skates,
	label: "$64.99 (Pro Hockey Life)",
	next,
});

const spentIn = (data: MonthData) =>
	Object.fromEntries(monthState(data).buckets.map((b) => [b.id, b.spent]));

describe("withTransactionChange: editing reassigns spending in the month's state", () => {
	test("moving a Transaction to another Bucket moves its spending there", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 6_499,
				assignment: { bucketId: "hockey" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(month)).toEqual({ groceries: 25_141, hockey: 0 });
		expect(spentIn(edited)).toEqual({ groceries: 18_642, hockey: 6_499 });
		// Moving spending between Buckets doesn't change Free to Spend.
		expect(monthState(edited).freeToSpend).toBe(monthState(month).freeToSpend);
		expect(monthState(edited).leftInBuckets).toBe(monthState(month).leftInBuckets);
	});

	test("changing the amount changes what its Bucket has spent", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 5_000,
				assignment: { bucketId: "groceries" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(edited)).toEqual({ groceries: 23_642, hockey: 0 });
	});

	test("changing only who it was For says so on its spending at once, and moves no money", () => {
		const edited = withTransactionChange(month, change({ for: ["kid"] }));
		const own = (data: MonthData) => data.spending.filter((spend) => spend.id === skates.id);
		expect(own(month).length).toBeGreaterThan(0);
		expect(own(edited).map((spend) => spend.for)).toEqual(own(month).map(() => ["kid"]));
		expect(edited.spending.filter((spend) => spend.id !== skates.id)).toEqual(
			month.spending.filter((spend) => spend.id !== skates.id),
		);
		expect(spentIn(edited)).toEqual(spentIn(month));
		expect(edited.charges).toBe(month.charges);
	});

	test("deleting a Transaction takes its spending out", () => {
		expect(spentIn(withTransactionChange(month, change(null)))).toEqual({
			groceries: 18_642,
			hockey: 0,
		});
	});

	test("assigning it to a Commitment moves it from the Bucket to that Commitment", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 6_499,
				assignment: { commitmentId: "mortgage" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(edited)).toEqual({ groceries: 18_642, hockey: 0 });
		expect(monthState(edited).commitments[0]?.actual).toBe(6_499);
	});

	test("changing who it was For moves it between Members' totals", () => {
		const edited = withTransactionChange(
			month,
			change({
				amountCents: 6_499,
				assignment: { bucketId: "hockey" },
				note: null,
				forMemberIds: ["leo"],
			}),
		);
		expect(forTotals(edited.spending).members.leo).toEqual({
			total: 6_499,
			buckets: { hockey: 6_499 },
		});
		expect(forTotals(edited.spending).household.total).toBe(18_642);
	});

	test("editing twice lands once", () => {
		const next = {
			amountCents: 6_499,
			assignment: { bucketId: "hockey" },
			note: null,
			forMemberIds: [],
		};
		const once = withTransactionChange(month, change(next));
		expect(withTransactionChange(once, change(next)).spending).toHaveLength(2);
	});
});

describe("withTransactionChange: splitting reassigns each Split in the month's state", () => {
	const splitSkates = change({
		amountCents: 6_499,
		note: null,
		splits: [
			{ id: "s1", amountCents: 4_499, assignment: { bucketId: "hockey" }, forMemberIds: ["leo"] },
			{ id: "s2", amountCents: 1_500, assignment: { bucketId: "groceries" }, forMemberIds: [] },
			{ id: "s3", amountCents: 500, assignment: { commitmentId: "mortgage" }, forMemberIds: [] },
		],
	});

	test("each Split lands in its own Bucket or Commitment, not the whole in one", () => {
		const edited = withTransactionChange(month, splitSkates);
		expect(spentIn(edited)).toEqual({ groceries: 20_142, hockey: 4_499 });
		expect(monthState(edited).commitments[0]?.actual).toBe(500);
	});

	test("each Split counts toward its own Members' totals", () => {
		const totals = forTotals(withTransactionChange(month, splitSkates).spending);
		expect(totals.members.leo).toEqual({ total: 4_499, buckets: { hockey: 4_499 } });
		expect(totals.household.total).toBe(18_642 + 1_500);
	});

	test("splitting twice lands once, and removing the Splits goes back to one assignment", () => {
		const once = withTransactionChange(month, splitSkates);
		expect(withTransactionChange(once, splitSkates)).toEqual(once);
		const whole = withTransactionChange(
			once,
			change({
				amountCents: 6_499,
				assignment: { bucketId: "groceries" },
				note: null,
				forMemberIds: [],
			}),
		);
		expect(spentIn(whole)).toEqual(spentIn(month));
		expect(whole.charges).toEqual([]);
	});
});

describe("withRowChange: the list shows the change", () => {
	const list = {
		pageParams: [undefined],
		pages: [{ transactions: [skates], next: null, total: null, summary: null }],
	};

	test("updates the row in place", () => {
		const edited = withRowChange(
			list,
			change({
				amountCents: 7_000,
				assignment: { bucketId: "hockey" },
				note: "Skates",
				forMemberIds: ["leo"],
			}),
		);
		expect(edited.pages[0]?.transactions[0]).toEqual({
			...skates,
			amountCents: 7_000,
			bucketId: "hockey",
			note: "Skates",
			for: ["leo"],
		});
	});

	test("shows a split row's Splits, with no whole assignment or For", () => {
		const edited = withRowChange(
			list,
			change({
				amountCents: 6_499,
				note: null,
				splits: [
					{
						id: "s1",
						amountCents: 4_499,
						assignment: { bucketId: "hockey" },
						forMemberIds: ["leo"],
					},
					{
						id: "s2",
						amountCents: 2_000,
						assignment: { commitmentId: "mortgage" },
						forMemberIds: [],
					},
				],
			}),
		);
		expect(edited.pages[0]?.transactions[0]).toEqual({
			...skates,
			note: null,
			bucketId: null,
			for: [],
			splits: [
				{
					id: "s1",
					amountCents: 4_499,
					bucketId: "hockey",
					commitmentId: null,
					goal: null,
					for: ["leo"],
				},
				{
					id: "s2",
					amountCents: 2_000,
					bucketId: null,
					commitmentId: "mortgage",
					goal: null,
					for: [],
				},
			],
		});
	});

	test("drops a deleted row", () => {
		expect(withRowChange(list, change(null)).pages[0]?.transactions).toEqual([]);
	});
});

describe("monthOfTransaction", () => {
	test("is the month of its date, and for a paycheck the month of the pay day it is for", () => {
		expect(monthOfTransaction(skates)).toBe(skates.date.slice(0, 7));
		const paycheck = {
			...skates,
			date: "2026-09-30",
			moneyIn: { date: "2026-09-30", payDay: "2026-10-01" },
		} as unknown as TransactionRow;
		expect(monthOfTransaction(paycheck)).toBe("2026-10");
		const sentBack = {
			...paycheck,
			moneyIn: { date: "2026-09-30", payDay: null },
		} as unknown as TransactionRow;
		expect(monthOfTransaction(sentBack)).toBe("2026-09");
	});
});

describe("applyTransactionChange: a Transaction cached by its ID is not one of the month's lists", () => {
	test("a delete lands in the list, and is put back, with that Transaction cached beside it", async () => {
		const queryClient = new QueryClient();
		const itsMonth = monthOfTransaction(skates);
		const listKey = transactionsQuery(itsMonth, {}).queryKey;
		const oneKey = transactionQuery(itsMonth, skates.id).queryKey;
		const list = {
			pageParams: [undefined],
			pages: [{ transactions: [skates], next: null, total: null, summary: null }],
		};
		queryClient.setQueryData(listKey, list as never);
		queryClient.setQueryData(oneKey, skates as never);

		const putBack = await applyTransactionChange(queryClient, change(null));
		expect(queryClient.getQueryData<typeof list>(listKey)?.pages[0]?.transactions).toEqual([]);
		expect(queryClient.getQueryData(oneKey)).toEqual(skates);

		putBack();
		expect(queryClient.getQueryData(listKey)).toEqual(list);
	});
});

describe("nameGiven: only a Parent's own typing names an imported Transaction", () => {
	// The form opened on the bank's wording ("Apple Card"); background naming then called the line
	// "Apple" while the form stayed open. Saving it for another reason gives it no name.
	test("a name field the Parent never touched gives no name, whatever the line is called by now", () => {
		expect(nameGiven(null, "Apple", "Apple")).toBeNull();
		expect(nameGiven(null, "Apple Card", "Apple")).toBeNull();
	});

	test("what a Parent typed is the name, trimmed", () => {
		expect(nameGiven("  Apple Card payment ", "Apple", "Apple")).toBe("Apple Card payment");
	});

	test("typing what it is already called gives no name", () => {
		expect(nameGiven("Apple ", "Apple", "Apple")).toBeNull();
	});

	test("an emptied name goes back to the bank's", () => {
		expect(nameGiven(" ", "Big shop", "Costco")).toBe("Costco");
		expect(nameGiven("", "Costco", "Costco")).toBeNull();
		expect(nameGiven("", "", "")).toBeNull();
	});
});

describe("a change of date (issue 148)", () => {
	const costco: TransactionRow = {
		...skates,
		id: "costco",
		date: "2026-09-13",
		amountCents: 18_642,
	};
	const older: TransactionRow = { ...skates, id: "older", date: "2026-09-02", amountCents: 500 };
	const pages = (rows: TransactionRow[]) => ({
		pageParams: [undefined],
		pages: [
			{
				transactions: rows,
				next: null,
				total: null,
				summary: { outCents: 25_641, needsReview: 0 },
			},
		],
	});
	const ids = (data: unknown) =>
		(data as ReturnType<typeof pages>).pages.flatMap((page) => page.transactions.map((r) => r.id));
	const rowIn = (data: unknown, id: string) =>
		(data as ReturnType<typeof pages>).pages
			.flatMap((page) => page.transactions)
			.find((row) => row.id === id);

	test("within the month: the row moves to its new day, and its spending stays in its Bucket", () => {
		const moved = withRowChange(
			pages([costco, skates, older]) as never,
			change({ date: "2026-09-01" }),
		);
		expect(ids(moved)).toEqual(["costco", "older", "skates"]);
		expect(rowIn(moved, "skates")?.date).toBe("2026-09-01");
		// The list's Money out is the same: nothing left it.
		expect(moved.pages[0]?.summary).toEqual({ outCents: 25_641, needsReview: 0 });

		const data = withTransactionChange(month, change({ date: "2026-09-01" }));
		expect(data.spending.find((spend) => spend.id === "skates")?.date).toBe("2026-09-01");
		expect(spentIn(data)).toEqual(spentIn(month));
	});

	test("to a later day it goes above the rows before it", () => {
		const moved = withRowChange(
			pages([costco, skates, older]) as never,
			change({ date: "2026-09-14" }),
		);
		expect(ids(moved)).toEqual(["skates", "costco", "older"]);
	});

	test("a list in another order keeps its order: only the day changes", () => {
		const moved = withRowChange(
			pages([older, costco, skates]) as never,
			change({ date: "2026-09-01" }),
		);
		expect(ids(moved)).toEqual(["older", "costco", "skates"]);
		expect(rowIn(moved, "skates")?.date).toBe("2026-09-01");
	});

	test("one from a bank keeps the bank's day beside it, and loses it when put back", () => {
		const bank = { ...skates, importedFrom: "bank" } as TransactionRow;
		const moved = withRowChange(pages([bank]) as never, {
			...change({ date: "2026-09-10" }),
			transaction: bank,
		});
		expect(rowIn(moved, "skates")).toMatchObject({ date: "2026-09-10", bankDate: "2026-09-12" });
		const back = withRowChange(moved, {
			...change({ date: "2026-09-12" }),
			transaction: rowIn(moved, "skates") as TransactionRow,
		});
		expect(rowIn(back, "skates")).toMatchObject({ date: "2026-09-12", bankDate: null });
		// One typed in simply changes.
		expect(
			rowIn(withRowChange(pages([skates]) as never, change({ date: "2026-09-10" })), "skates")
				?.bankDate ?? null,
		).toBeNull();
	});

	test("out of the month: it leaves that month's lists and spending, and stays in lists of several months at its new day", async () => {
		const queryClient = new QueryClient();
		const itsMonth = monthOfTransaction(skates);
		const monthKey = monthQueryKey(itsMonth);
		const listKey = transactionsQuery(itsMonth, {}).queryKey;
		const rangeKey = transactionsQuery(itsMonth, { range: "3m" } as never).queryKey;
		const accountKey = accountTransactionsQuery("checking").queryKey;
		const list = pages([costco, skates, older]);
		queryClient.setQueryData(monthKey, month as never);
		queryClient.setQueryData(listKey, list as never);
		queryClient.setQueryData(rangeKey, list as never);
		queryClient.setQueryData(accountKey, list as never);

		const putBack = await applyTransactionChange(queryClient, change({ date: "2026-08-30" }));
		expect(ids(queryClient.getQueryData(listKey))).toEqual(["costco", "older"]);
		expect(
			(queryClient.getQueryData(listKey) as ReturnType<typeof pages>).pages[0]?.summary.outCents,
		).toBe(25_641 - 6_499);
		expect(ids(queryClient.getQueryData(rangeKey))).toEqual(["costco", "older", "skates"]);
		expect(ids(queryClient.getQueryData(accountKey))).toEqual(["costco", "older", "skates"]);
		expect(rowIn(queryClient.getQueryData(rangeKey), "skates")?.date).toBe("2026-08-30");
		const data = queryClient.getQueryData(monthKey) as MonthData;
		expect(data.spending.map((spend) => spend.id)).toEqual(["costco"]);

		// Refused, or it failed: everything is as it was.
		putBack();
		expect(queryClient.getQueryData(listKey)).toEqual(list);
		expect(queryClient.getQueryData(rangeKey)).toEqual(list);
		expect(queryClient.getQueryData(accountKey)).toEqual(list);
		expect(queryClient.getQueryData(monthKey)).toEqual(month);
	});

	test("within the month it is put back where it was when the change fails", async () => {
		const queryClient = new QueryClient();
		const listKey = transactionsQuery(monthOfTransaction(skates), {}).queryKey;
		const list = pages([costco, skates, older]);
		queryClient.setQueryData(listKey, list as never);
		const putBack = await applyTransactionChange(queryClient, change({ date: "2026-09-01" }));
		expect(ids(queryClient.getQueryData(listKey))).toEqual(["costco", "older", "skates"]);
		putBack();
		expect(queryClient.getQueryData(listKey)).toEqual(list);
	});

	test("what the Parent is told: the day, and the month when it left the one it was in", () => {
		expect(dateChange(skates, "2026-09-01")).toMatchObject({
			next: { date: "2026-09-01" },
			said: "Moved to Sep 1",
			back: { date: "2026-09-12" },
		});
		expect(dateChange(skates, "2026-08-30").said).toBe("Moved to Aug 30 · August");
	});

	test("left unassigned by the month it landed in: the message says so, and Undo puts back its day and its Bucket", () => {
		const moved = dateChange({ ...skates, assignedName: "Hockey" }, "2026-08-30");
		const unassigned = { kind: "bucket", id: "hockey", name: "Hockey" } as const;
		expect(dateUnassignedText(moved, unassigned)).toBe(
			"Moved to Aug 30 · August. Hockey wasn’t in August’s Plan, so it isn’t filed anywhere now.",
		);
		expect(dateUndo(moved.back, unassigned)).toEqual({
			date: skates.date,
			refile: { bucketId: "hockey" },
		});
		expect(dateUndo(moved.back, { kind: "commitment", id: "rent", name: "Rent" })).toEqual({
			date: skates.date,
			refile: { commitmentId: "rent" },
		});
		// Still filed: Undo is the day alone.
		expect(dateUndo(moved.back, null)).toEqual({ date: skates.date });
	});

	test("each refusal says why in plain words", () => {
		const to = {
			...change({ date: "2026-08-30" }),
			transaction: { ...skates, assignedName: "Hockey" },
		};
		expect(dateRefusedText(to, "month-closed", "2026-08")).toBe(
			"August is closed, so nothing moves into or out of it.",
		);
		expect(dateRefusedText(to, "future")).toBe("A Transaction can’t be dated after today.");
		// Filed whole in what that month's Plan lacked it moves and is unassigned; only a Split or
		// money back holds it.
		expect(dateRefusedText(to, "not-in-plan", undefined, { part: "split", name: "Kids" })).toBe(
			"One of its Splits is filed in Kids, which wasn’t in August’s Plan. Change that Split first.",
		);
		expect(
			dateRefusedText(to, "not-in-plan", undefined, { part: "money-back", name: "Hockey" }),
		).toBe(
			"Money back counts in Hockey, which wasn’t in August’s Plan. File it somewhere else first.",
		);
		expect(dateRefusedText({ ...to, next: { date: "2026-09-20" } }, "refund-order")).toBe(
			"Its Refund would come before it. Move the Refund first.",
		);
	});
});
