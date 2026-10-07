import type { DayKey, MonthKey, StatementLine } from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addAccount,
	addBucket,
	addCommitment,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	fileWithoutBucket,
	importStatement,
	loadReview,
	loadTransactionsPage,
	setTakeHomePay,
	splitTransaction,
	summarizeDeletion,
	type TransactionSelection,
	type TransactionSort,
	type Viewer,
} from "./index";
import { categorizations, members, transactions } from "./schema";
import { testDb } from "./test-db";

// The Transactions list's orders (issue 99): each one, both ways, a page at a time, and what a
// selection of "all that match" holds whatever the order.

const householdId = "household";
const month: MonthKey = "2026-09";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };

const SORTS: TransactionSort[] = [
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
/** Each order with the one that runs the other way. */
const PAIRS: [TransactionSort, TransactionSort][] = [
	["newest", "oldest"],
	["largest", "smallest"],
	["name-za", "name-az"],
	["assigned-za", "assigned-az"],
	["account-za", "account-az"],
];

let db: Db;
let nextId = 0;
const newId = () => `row-${String(++nextId).padStart(4, "0")}`;

const quickAdd = (
	by: Viewer,
	transactionId: string,
	bucketId: string,
	amountCents: number,
	note: string | null = null,
	date: DayKey = "2026-09-10",
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date,
		amountCents,
		note,
		forMemberIds: [],
		createdByMemberId: by.memberId,
	});

const line = (date: DayKey, amount: number, description: string): StatementLine => ({
	date,
	amount,
	description,
	bankId: null,
});

const importInto = (accountId: string, importId: string, lines: StatementLine[]) =>
	importStatement(db, {
		householdId,
		importId,
		accountId,
		source: "csv",
		fileName: null,
		fileKey: null,
		lines,
		closingBalance: null,
		csvMapping: null,
		createdByMemberId: "alex",
		newId,
	});

type Query = Omit<Parameters<typeof loadTransactionsPage>[2], "limit" | "after">;

/** Every page of a list, `limit` at a time, with each cursor it was continued from. */
async function paged(viewer: Viewer, query: Query, limit = 50) {
	const rows = [];
	const cursors = [];
	let after: Parameters<typeof loadTransactionsPage>[2]["after"];
	do {
		const page = await loadTransactionsPage(db, viewer, { month, ...query, after, limit });
		expect(page.transactions.length).toBeLessThanOrEqual(limit);
		rows.push(...page.transactions);
		after = page.next ?? undefined;
		if (after) cursors.push(after);
	} while (after);
	return { rows, cursors };
}

const ids = async (viewer: Viewer, query: Query, limit?: number) =>
	(await paged(viewer, query, limit)).rows.map((row) => row.id);

const named = (rows: { note: string | null; merchantName: string | null }[]) =>
	rows.map((row) => row.merchantName ?? row.note);

beforeEach(async () => {
	db = testDb();
	nextId = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db.insert(members).values({
		id: "sam",
		householdId,
		kind: "parent",
		name: "Sam",
		clerkUserId: "clerk-sam",
	});
	await setTakeHomePay(db, { householdId, memberId: "alex", month, amountCents: 900_000 });
	for (const [bucketId, name] of [
		["groceries", "Groceries"],
		["hockey", "hockey"],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: "alex",
			bucketId,
			name,
			color: 1,
			month,
			allowanceCents: 120_000,
		});
	}
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month,
		allowanceCents: 20_000,
	});
	await addCommitment(db, {
		householdId,
		memberId: "alex",
		commitmentId: "daycare",
		name: "Daycare",
		month,
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-09-04",
	});
	for (const [accountId, name, kind] of [
		["checking", "Checking", "checking"],
		["card", "Visa", "credit-card"],
	] as const) {
		await addAccount(db, {
			householdId,
			accountId,
			name,
			kind,
			balanceCents: 0,
			balanceId: `${accountId}-balance`,
			createdByMemberId: "alex",
		});
	}
});

/** A month of every kind of row the orders tell apart. */
async function mixedMonth() {
	await quickAdd(sam, "apple", "groceries", 1_100, "apple orchard", "2026-09-03");
	await quickAdd(sam, "mango", "hockey", 2_200, "Mango stand", "2026-09-05");
	await quickAdd(sam, "zebra", "groceries", 3_300, "ZEBRA ZOO", "2026-09-07");
	await quickAdd(sam, "blank", "groceries", 650, null, "2026-09-08");
	// Alex's, split partly into Alex's Personal Allowance: Sam sees only the Groceries part.
	await quickAdd(alex, "banana", "groceries", 10_000, "Banana gift for Sam", "2026-09-14");
	expect(
		await splitTransaction(db, {
			householdId,
			memberId: "alex",
			transactionId: "banana",
			amountCents: 10_000,
			note: "Banana gift for Sam",
			splits: [
				{
					id: "banana-gift",
					amountCents: 3_000,
					assignment: { bucketId: "alex-pa" },
					forMemberIds: [],
				},
				{
					id: "banana-food",
					amountCents: 7_000,
					assignment: { bucketId: "groceries" },
					forMemberIds: [],
				},
			],
		}),
	).toMatchObject({ ok: true });
	await quickAdd(alex, "daycare-bill", "groceries", 60_000, "Little Sprouts", "2026-09-04");
	await db
		.update(transactions)
		.set({ bucketId: null, commitmentId: "daycare" })
		.where(eq(transactions.id, "daycare-bill"));
	await importInto("checking", "i-1", [
		line("2026-09-09", -4_200, "COSTCO WHSE #123"),
		line("2026-09-11", -900, "kwik trip"),
	]);
	await importInto("card", "i-2", [line("2026-09-12", -5_500, "REI #11")]);
	// A Parent's name for a bank line wins over the bank's wording.
	await db
		.update(transactions)
		.set({ merchant: "Costco" })
		.where(eq(transactions.note, "COSTCO WHSE #123"));
}

describe("The Transactions list's orders", () => {
	beforeEach(mixedMonth);

	it("sorts by name as the Parent reads it, any case, a Parent's name before the bank's wording", async () => {
		const az = (await paged(alex, { sort: "name-az" }, 2)).rows;
		expect(named(az)).toEqual([
			// One with no name sorts with the blanks, whatever the list calls it.
			null,
			"apple orchard",
			"Banana gift for Sam",
			"Costco",
			"kwik trip",
			"Little Sprouts",
			"Mango stand",
			"REI #11",
			"ZEBRA ZOO",
		]);
		const za = (await paged(alex, { sort: "name-za" }, 2)).rows;
		expect(za.map((row) => row.id)).toEqual(az.map((row) => row.id).reverse());
	});

	it("sorts by what it's assigned to: unassigned, then split, then each name from A to Z", async () => {
		const az = (await paged(alex, { sort: "assigned-az" }, 2)).rows;
		expect(
			az.map((row) =>
				row.splits.length ? "split" : (row.bucketId ?? row.commitmentId ?? "unassigned"),
			),
		).toEqual([
			"unassigned",
			"unassigned",
			"unassigned",
			"split",
			"daycare",
			"groceries",
			"groceries",
			"groceries",
			"hockey",
		]);
		// Rows the order can't tell apart go by date, oldest first from A to Z.
		expect(az.slice(0, 3).map((row) => row.date)).toEqual([
			"2026-09-09",
			"2026-09-11",
			"2026-09-12",
		]);
		expect(await ids(alex, { sort: "assigned-za" }, 2)).toEqual(az.map((row) => row.id).reverse());
	});

	it("sorts by Account as the row shows it, a Quick Add with none first", async () => {
		const az = (await paged(alex, { sort: "account-az" }, 2)).rows;
		expect(az.map((row) => row.importedFrom)).toEqual([
			null,
			null,
			null,
			null,
			null,
			null,
			"Checking",
			"Checking",
			"Visa",
		]);
		expect(await ids(alex, { sort: "account-za" }, 2)).toEqual(az.map((row) => row.id).reverse());
	});

	it("never lets a partly private Transaction's place say its name", async () => {
		// Alex, whose it is, finds it between apple and Costco.
		expect(await ids(alex, { sort: "name-az" })).toContain("banana");
		// Sam is shown no name for it, so for Sam it sorts with the ones that have none: by date
		// after the other blank, not between "apple orchard" and "Mango stand".
		for (const limit of [50, 1]) {
			const { rows, cursors } = await paged(sam, { sort: "name-az" }, limit);
			expect(rows.slice(0, 3).map((row) => row.id)).toEqual(["blank", "banana", "apple"]);
			expect(rows.find((row) => row.id === "banana")).toMatchObject({
				note: null,
				merchantName: null,
				partlyPrivate: true,
				amountCents: 7_000,
			});
			expect(JSON.stringify({ rows, cursors }).toLowerCase()).not.toContain("banana gift");
			expect(cursors.find((cursor) => cursor.id === "banana")?.key ?? "").toBe("");
		}
		const za = await ids(sam, { sort: "name-za" }, 1);
		expect(za.slice(-2)).toEqual(["banana", "blank"]);
		// By what it's assigned to it is a split one, as Sam can see, and nothing more.
		const assigned = (await paged(sam, { sort: "assigned-az" }, 1)).rows;
		expect(assigned.findIndex((row) => row.id === "banana")).toBe(3);
	});

	it("lists the same Transactions in every order, each the other way round in its pair", async () => {
		const newest = await ids(alex, {}, 2);
		expect(newest).toHaveLength(9);
		for (const sort of SORTS) {
			const listed = await ids(alex, { sort }, 2);
			expect(new Set(listed).size, sort).toBe(listed.length);
			expect([...listed].sort(), sort).toEqual([...newest].sort());
		}
		for (const [down, up] of PAIRS) {
			expect(await ids(alex, { sort: down }, 2), down).toEqual(
				(await ids(alex, { sort: up }, 2)).reverse(),
			);
		}
	});

	it("starts again from the top when the cursor was made for another order", async () => {
		const first = await loadTransactionsPage(db, alex, { month, sort: "name-az", limit: 2 });
		const byDate = await loadTransactionsPage(db, alex, { month, limit: 2 });
		expect(byDate.next?.key).toBeUndefined();
		const again = await loadTransactionsPage(db, alex, {
			month,
			sort: "name-az",
			after: byDate.next ?? undefined,
			limit: 2,
		});
		expect(again.transactions.map((row) => row.id)).toEqual(
			first.transactions.map((row) => row.id),
		);
	});

	it("selects the same Transactions whatever the order", async () => {
		const selected = async (selection: TransactionSelection, viewer = alex) => {
			const summary = await summarizeDeletion(db, viewer, selection);
			return summary.count + summary.staying;
		};
		await importInto("checking", "i-3", [line("2026-08-20", -700, "August apples")]);
		const filters: [Query, NonNullable<TransactionSelection["all"]>][] = [
			[{}, { month }],
			[{ bucketId: "groceries" }, { month, bucketId: "groceries" }],
			[{ accountId: "checking" }, { month, accountId: "checking" }],
			// The list finds a name a Parent gave as well as the bank's wording; so does the selection.
			[{ search: "costco" }, { month, search: "costco" }],
			[{ search: "an" }, { month, search: "an" }],
		];
		for (const viewer of [alex, sam]) {
			for (const [query, all] of filters) {
				const counts = new Set<number>();
				for (const sort of SORTS) counts.add((await ids(viewer, { ...query, sort }, 2)).length);
				expect([...counts], JSON.stringify(all)).toEqual([await selected({ all }, viewer)]);
			}
		}
		// "All but these", and "this month and every month before".
		const [first, second] = await ids(alex, { sort: "name-za" }, 2);
		expect(await selected({ all: { month }, except: [first as string, second as string] })).toBe(7);
		const earlier = await ids(alex, { month: "2026-08", sort: "assigned-az" });
		expect(earlier).toHaveLength(1);
		expect(await selected({ all: { month, andEarlier: true } })).toBe(9 + earlier.length);
	});
});

describe("A long run of Transactions the order can't tell apart", () => {
	const days: DayKey[] = ["2026-09-02", "2026-09-02", "2026-09-15", "2026-09-28"];

	beforeEach(async () => {
		// 120 with the same name, amount, Bucket and no Account, on three days.
		for (let n = 0; n < 120; n++) {
			await quickAdd(
				alex,
				`same-${String(n).padStart(3, "0")}`,
				"groceries",
				500,
				"Coffee",
				days[n % days.length],
			);
		}
	});

	it("neither repeats nor skips one across pages of 50, in every order", async () => {
		const orders = new Map<TransactionSort, string[]>();
		for (const sort of SORTS) {
			const { rows, cursors } = await paged(alex, { sort });
			const listed = rows.map((row) => row.id);
			orders.set(sort, listed);
			expect(cursors, sort).toHaveLength(2);
			expect(listed, sort).toHaveLength(120);
			expect(new Set(listed).size, sort).toBe(120);
		}
		// With nothing else to go by, every order is by date and then by ID, its own way round.
		const newest = orders.get("newest") as string[];
		const dated = [...newest].sort().reverse();
		expect(newest.slice(0, 30)).toEqual(
			dated.filter((id) => Number(id.slice(5)) % days.length === 3),
		);
		for (const [down, up] of PAIRS) {
			expect(orders.get(down), down).toEqual(newest);
			expect(orders.get(up), up).toEqual([...newest].reverse());
		}
	});
});

/** Categorization leaves the imported lines with these notes for a Parent: they wait in Review. */
async function sendToReview(...notes: string[]) {
	for (const note of notes) {
		const [row] = await db.select().from(transactions).where(eq(transactions.note, note));
		await db.insert(categorizations).values({
			transactionId: row?.id ?? "",
			householdId,
			outcome: "review",
			method: "model",
			merchant: note.toLowerCase(),
		} as never);
	}
}

describe("a page longer than D1's 100 parameters", () => {
	it("loads 150 rows with who each was For", async () => {
		for (let i = 0; i < 150; i++) {
			await addQuickAdd(db, {
				householdId,
				transactionId: `many-${String(i).padStart(3, "0")}`,
				bucketId: "groceries",
				date: "2026-09-10",
				amountCents: 100 + i,
				note: null,
				forMemberIds: i === 0 ? ["alex"] : [],
				createdByMemberId: "alex",
			});
		}
		const page = await loadTransactionsPage(db, alex, { month, limit: 150 });
		expect(page.transactions).toHaveLength(150);
		expect(page.transactions.find((row) => row.id === "many-000")?.for).toEqual(["alex"]);
	});
});

describe("the month's summary and its Needs review filter (issue 134)", () => {
	beforeEach(async () => {
		await quickAdd(alex, "q-1", "groceries", 4_000, "Costco");
		await quickAdd(alex, "q-2", "hockey", 2_500, "Skates");
		await importInto("checking", "i-s", [
			line("2026-09-12", -1_200, "Corner shop"),
			line("2026-09-13", -800, "Parking"),
		]);
		await sendToReview("Corner shop", "Parking");
	});

	it("leaves out what a Parent filed without a Bucket: it has left Review (ADR-0037)", async () => {
		await importInto("checking", "i-w", [line("2026-09-14", -700, "Vending")]);
		await sendToReview("Vending");
		const before = await loadTransactionsPage(db, alex, { month, limit: 50 });
		expect(before.summary?.needsReview).toBe(3);
		const [vending] = await db.select().from(transactions).where(eq(transactions.note, "Vending"));
		await fileWithoutBucket(db, alex, [vending?.id ?? ""]);
		const page = await loadTransactionsPage(db, alex, { month, review: true, limit: 50 });
		expect(page.summary?.needsReview).toBe(2);
		expect(named(page.transactions).sort()).toEqual(["Corner shop", "Parking"]);
		// Still unassigned, still in the month's list and its Money out.
		expect(page.summary?.outCents).toBe(9_200);
	});

	it("counts what Review holds: the same number as the Review queue", async () => {
		await importInto("checking", "i-n", [line("2026-09-15", -300, "Never looked at")]);
		const page = await loadTransactionsPage(db, alex, { month, limit: 50 });
		expect(page.summary?.needsReview).toBe((await loadReview(db, alex, 50)).total);
		expect(page.summary?.needsReview).toBe(2);
	});

	it("says what the month spent and how many wait, on the first page", async () => {
		const page = await loadTransactionsPage(db, alex, { month, limit: 50 });
		expect(page.summary).toEqual({ outCents: 8_500, needsReview: 2 });
		expect(page.total).toBe(8_500);
	});

	it("keeps only the spending that waits, and the summary stays the month's", async () => {
		const page = await loadTransactionsPage(db, alex, { month, review: true, limit: 50 });
		expect(named(page.transactions).sort()).toEqual(["Corner shop", "Parking"]);
		expect(page.total).toBe(2_000);
		expect(page.summary).toEqual({ outCents: 8_500, needsReview: 2 });
	});

	it("follows the other filters", async () => {
		const page = await loadTransactionsPage(db, alex, { month, bucketId: "groceries", limit: 50 });
		expect(page.summary).toEqual({ outCents: 4_000, needsReview: 0 });
	});

	it("a selection of all that match holds only what waits", async () => {
		const summary = await summarizeDeletion(db, alex, { all: { month, review: true } });
		expect(summary.count + summary.staying).toBe(2);
	});
});
