import { type DayKey, mergeCells } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addCommitment,
	addCommitmentPayment,
	addIncome,
	addPersonalAllowance,
	addQuickAdd,
	createHouseholdForParent,
	type Db,
	loadAmountBands,
	loadForCells,
	loadIncomeCells,
	loadMerchants,
	loadReportItems,
	loadSpendCells,
	type ReportScope,
	setBaseline,
	splitTransaction,
	type Viewer,
} from "./index";
import { members, transfers } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };
const range = { from: "2026-08-01" as DayKey, until: "2026-10-01" as DayKey };
const scope = (viewer: Viewer, filters: ReportScope["filters"] = {}): ReportScope => ({
	viewer,
	range,
	filters,
});

let db: Db;

const quickAdd = (
	by: Viewer,
	transactionId: string,
	bucketId: string,
	amountCents: number,
	note: string | null,
	date: DayKey = "2026-09-10",
	forMemberIds: string[] = [],
) =>
	addQuickAdd(db, {
		householdId,
		transactionId,
		bucketId,
		date,
		amountCents,
		note,
		forMemberIds,
		createdByMemberId: by.memberId,
	});

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
	await db.insert(members).values([
		{ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" },
		{ id: "kid", householdId, kind: "child", name: "Kid" },
	]);
	await setBaseline(db, { householdId, memberId: "alex", month: "2026-08", amountCents: 900_000 });
	await addBucket(db, {
		householdId,
		memberId: "alex",
		bucketId: "groceries",
		name: "Groceries",
		color: 1,
		month: "2026-08",
		allowanceCents: 120_000,
	});
	await addPersonalAllowance(db, {
		householdId,
		memberId: "alex",
		bucketId: "alex-pa",
		name: "Alex’s Personal Allowance",
		color: 2,
		month: "2026-08",
		allowanceCents: 20_000,
	});
	await quickAdd(alex, "gift", "alex-pa", 4_200, "Secret gift shop");
	await quickAdd(alex, "milk", "groceries", 650, "Costco", "2026-08-03", ["kid"]);
	await quickAdd(sam, "bulk", "groceries", 30_000, " costco ", "2026-09-12");
	// A $100 Target run: $30 a gift in Alex's Personal Allowance, $70 groceries For Kid.
	await quickAdd(alex, "target", "groceries", 10_000, "Target", "2026-09-20");
	await splitTransaction(db, {
		householdId,
		memberId: "alex",
		transactionId: "target",
		amountCents: 10_000,
		note: "Target",
		splits: [
			{ id: "s1", amountCents: 3_000, assignment: { bucketId: "alex-pa" }, forMemberIds: [] },
			{
				id: "s2",
				amountCents: 7_000,
				assignment: { bucketId: "groceries" },
				forMemberIds: ["kid"],
			},
		],
	});
});

describe("loadSpendCells", () => {
	it("sums parts per period and Target, the other Parent's Personal Allowance as private monthly totals", async () => {
		const { cells, privateMonths } = await loadSpendCells(db, scope(sam), "month");
		const sums = cells.reduce<Record<string, number>>((acc, c) => {
			const key = `${c.period} ${c.target}`;
			acc[key] = (acc[key] ?? 0) + c.amount;
			return acc;
		}, {});
		expect(sums).toEqual({ "2026-08 bucket:groceries": 650, "2026-09 bucket:groceries": 37_000 });
		// Whole Transactions' and Splits' totals, merged.
		expect(mergeCells(privateMonths)).toEqual([
			{ period: "2026-09", target: "bucket:alex-pa", amount: 7_200, count: 0, private: true },
		]);
	});

	it("leaves private totals out when narrowed by something a total can't be split by", async () => {
		const { privateMonths } = await loadSpendCells(db, scope(sam, { merchant: "costco" }), "all");
		expect(privateMonths).toEqual([]);
	});

	it("shows the owner their own Personal Allowance item by item", async () => {
		const { cells, privateMonths } = await loadSpendCells(db, scope(alex), "all");
		expect(privateMonths).toEqual([]);
		expect(
			cells.filter((c) => c.target === "bucket:alex-pa").reduce((s, c) => s + c.amount, 0),
		).toBe(7_200);
	});

	it("groups by week Mondays and quarters as the domain keys them", async () => {
		const weeks = (await loadSpendCells(db, scope(alex), "week")).cells.map((c) => c.period);
		expect(new Set(weeks)).toEqual(new Set(["2026-08-03", "2026-09-07", "2026-09-14"]));
		const quarters = (await loadSpendCells(db, scope(alex), "quarter")).cells.map((c) => c.period);
		expect(new Set(quarters)).toEqual(new Set(["2026-Q3"]));
	});
});

describe("items and merchants", () => {
	it("never lists the other Parent's Personal Allowance, nor a partly private note", async () => {
		const { items, total } = await loadReportItems(db, scope(sam), "amount", 10);
		expect(total).toBe(3);
		expect(items.map((i) => [i.id, i.amount, i.note, i.split])).toEqual([
			["bulk", 30_000, " costco ", false],
			["target", 7_000, null, true],
			["milk", 650, "Costco", false],
		]);
		const { byAmount } = await loadMerchants(db, scope(sam));
		expect(byAmount.map((m) => [m.key, m.amount, m.count])).toEqual([
			["costco", 30_650, 2],
			["", 7_000, 1],
		]);
	});

	it("filters by merchant, For and minimum amount", async () => {
		const costco = await loadReportItems(db, scope(alex, { merchant: "costco" }), "date", 10);
		expect(costco.items.map((i) => i.id)).toEqual(["bulk", "milk"]);
		const forKid = await loadReportItems(db, scope(alex, { member: "kid" }), "date", 10);
		expect(forKid.items.map((i) => i.id)).toEqual(["target", "milk"]);
		const big = await loadReportItems(db, scope(alex, { min: 5_000 }), "date", 10);
		expect(big.items.map((i) => i.amount)).toEqual([7_000, 30_000]);
	});

	it("leaves Commitment payments out of one-off spending", async () => {
		await addCommitment(db, {
			householdId,
			memberId: "alex",
			commitmentId: "mortgage",
			name: "Mortgage",
			month: "2026-08",
			amountCents: 250_000,
			cadence: "monthly",
			dueDate: "2026-09-01",
		});
		await addCommitmentPayment(db, {
			householdId,
			transactionId: "mortgage-sep",
			commitmentId: "mortgage",
			date: "2026-09-01",
			amountCents: 250_000,
			createdByMemberId: "alex",
		});
		const all = await loadReportItems(db, scope(alex), "amount", 1);
		expect(all.items.map((i) => i.id)).toEqual(["mortgage-sep"]);
		const oneOff = await loadReportItems(db, scope(alex, { oneOff: true }), "amount", 1);
		expect(oneOff.items.map((i) => i.id)).toEqual(["bulk"]);
		const bands = await loadAmountBands(db, scope(alex, { oneOff: true }));
		expect(bands.find((b) => b.floor === 1_000_00)).toBeUndefined();
	});

	it("bands amounts for the threshold and groups For", async () => {
		const bands = await loadAmountBands(db, scope(sam));
		expect(bands).toEqual([
			{ floor: 0, count: 1, amount: 650 },
			{ floor: 50_00, count: 1, amount: 7_000 },
			{ floor: 250_00, count: 1, amount: 30_000 },
		]);
		const forCells = await loadForCells(db, scope(sam), "month");
		expect(
			forCells.filter((c) => c.for.length > 0).map((c) => [c.period, c.for, c.amount]),
		).toEqual(
			expect.arrayContaining([
				["2026-08", ["kid"], 650],
				["2026-09", ["kid"], 7_000],
			]),
		);
	});
});

describe("loadIncomeCells", () => {
	it("sums income per period and source", async () => {
		for (const [id, amountCents, note] of [
			["pay1", 400_000, "Salary"],
			["pay2", 400_000, "salary"],
			["bonus", 150_000, "Bonus"],
		] as const) {
			await addIncome(db, {
				householdId,
				incomeId: id,
				date: "2026-09-15",
				amountCents,
				note,
				createdByMemberId: "alex",
			});
		}
		const cells = await loadIncomeCells(db, householdId, range, "month");
		expect(cells.map((c) => [c.period, c.source, c.amount, c.count]).sort()).toEqual([
			["2026-09", "bonus", 150_000, 1],
			["2026-09", "salary", 800_000, 2],
		]);
	});
});

describe("Transfers", () => {
	it("count as neither spending nor income", async () => {
		// Money moved to savings: out of checking (assigned, as a Parent might have), into savings.
		await quickAdd(alex, "to-savings", "groceries", 50_000, "Savings transfer", "2026-09-05");
		await addIncome(db, {
			householdId,
			incomeId: "from-checking",
			date: "2026-09-05",
			amountCents: 50_000,
			note: "Salary",
			createdByMemberId: "alex",
		});
		const before = await loadSpendCells(db, scope(alex), "month");
		await db.insert(transfers).values({
			id: "transfer",
			householdId,
			outTransactionId: "to-savings",
			inIncomeId: "from-checking",
			createdByMemberId: "alex",
		});
		const after = await loadSpendCells(db, scope(alex), "month");
		const total = (cells: typeof after.cells) => cells.reduce((sum, c) => sum + c.amount, 0);
		expect(total(before.cells) - total(after.cells)).toBe(50_000);
		const items = await loadReportItems(db, scope(alex), "amount", 10);
		expect(items.items.map((i) => i.id)).not.toContain("to-savings");
		const bands = await loadAmountBands(db, scope(alex));
		expect(bands.find((b) => b.floor === 250_00)?.amount).toBe(30_000);
		expect(await loadIncomeCells(db, householdId, range, "month")).toEqual([]);
	});
});
