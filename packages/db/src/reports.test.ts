import { type DayKey, type MonthKey, mergeCells, shareFor } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addCommitment,
	addCommitmentPayment,
	addIncome,
	addPersonalAllowance,
	addQuickAdd,
	changeMoneyInKind,
	confirmPaidBack,
	createHouseholdForParent,
	type Db,
	loadAmountBands,
	loadBucketHistory,
	loadDailySpend,
	loadForCells,
	loadIncomeCells,
	loadMerchants,
	loadPlanRecords,
	loadReportItems,
	loadSpendCells,
	loadSpending,
	type ReportScope,
	sayOwedBack,
	setCarriesOver,
	setTakeHomePay,
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
	await setTakeHomePay(db, {
		householdId,
		memberId: "alex",
		month: "2026-08",
		amountCents: 900_000,
	});
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

describe("Paid back", () => {
	/** `by` says `cents` of a purchase is Owed back; it arrives on `date` and is matched to it. */
	async function paidBackOn(by: Viewer, transactionId: string, cents: number, date: DayKey) {
		const said = await sayOwedBack(db, by, {
			owedBackId: `ob-${transactionId}`,
			transactionId,
			who: "Casey",
			amountCents: cents as never,
		});
		expect(said.ok).toBe(true);
		const incomeId = `in-${transactionId}`;
		await addIncome(db, {
			householdId,
			incomeId,
			date,
			amountCents: cents,
			note: "Casey",
			createdByMemberId: by.memberId,
		});
		await changeMoneyInKind(db, by, { incomeId, kind: "paid-back", transferId: `t-${incomeId}` });
		const confirmed = await confirmPaidBack(db, by, {
			incomeId,
			matches: [
				{ id: `m-${transactionId}`, owedBackId: `ob-${transactionId}`, amount: cents as never },
			],
			today: "2026-09-28" as DayKey,
		});
		expect(confirmed.ok).toBe(true);
	}

	const sums = (cells: { period: string; target: string; amount: number }[]) =>
		cells.reduce<Record<string, number>>((acc, c) => {
			const key = `${c.period} ${c.target}`;
			acc[key] = (acc[key] ?? 0) + c.amount;
			return acc;
		}, {});

	it("restores a Bucket in the month the money arrived, as This Month does", async () => {
		// Half of August's milk comes back in September.
		await paidBackOn(alex, "milk", 300, "2026-09-25" as DayKey);
		const { cells } = await loadSpendCells(db, scope(sam), "month");
		expect(sums(cells)).toEqual({
			"2026-08 bucket:groceries": 650,
			"2026-09 bucket:groceries": 36_700,
		});
		const shown = (await loadSpending(db, sam, "2026-09" as MonthKey))
			.filter((spend) => spend.bucketId === "groceries")
			.reduce((sum, spend) => sum + spend.amount, 0);
		expect(shown).toBe(36_700);
		// It adds no purchase to the count.
		expect(cells.reduce((n, c) => n + c.count, 0)).toBe(3);
		const days = await loadDailySpend(db, scope(sam));
		expect(days.find((d) => d.day === "2026-09-25")?.amount).toBe(-300);
	});

	it("restores a Commitment, but not in a Report of one-off spending", async () => {
		await addCommitment(db, {
			householdId,
			memberId: "alex",
			commitmentId: "tuition",
			name: "Tuition",
			month: "2026-08",
			amountCents: 60_000,
			cadence: "monthly",
			dueDate: "2026-09-05",
		});
		await addCommitmentPayment(db, {
			householdId,
			transactionId: "tuition-sep",
			commitmentId: "tuition",
			date: "2026-09-05",
			amountCents: 120_000,
			createdByMemberId: "alex",
		});
		await paidBackOn(alex, "tuition-sep", 60_000, "2026-09-25" as DayKey);
		const all = await loadSpendCells(db, scope(sam), "all");
		expect(sums(all.cells)["all commitment:tuition"]).toBe(60_000);
		const oneOff = await loadSpendCells(db, scope(sam, { oneOff: true }), "all");
		expect(sums(oneOff.cells)).toEqual({ "all bucket:groceries": 37_650 });
	});

	it("nets the other Parent's Personal Allowance total, and leaves a narrowed Report alone", async () => {
		await paidBackOn(alex, "gift", 2_000, "2026-09-25" as DayKey);
		const { privateMonths } = await loadSpendCells(db, scope(sam), "month");
		expect(mergeCells(privateMonths)).toEqual([
			{ period: "2026-09", target: "bucket:alex-pa", amount: 5_200, count: 0, private: true },
		]);
		const own = await loadSpendCells(db, scope(alex), "all");
		expect(sums(own.cells)["all bucket:alex-pa"]).toBe(5_200);
		await paidBackOn(alex, "milk", 300, "2026-09-25" as DayKey);
		const narrowed = await loadSpendCells(db, scope(sam, { merchant: "costco" }), "all");
		expect(sums(narrowed.cells)).toEqual({ "all bucket:groceries": 30_650 });
	});

	it("comes off who the purchase was For, and is listed under its Bucket", async () => {
		const forSums = async (narrowed = scope(sam)) =>
			(await loadForCells(db, narrowed, "month")).reduce<Record<string, number>>((acc, c) => {
				const key = `${c.period} ${c.for.join(",")}`;
				acc[key] = (acc[key] ?? 0) + c.amount;
				return acc;
			}, {});
		const before = {
			byFor: await forSums(),
			items: await loadReportItems(db, scope(sam), "date", 50),
		};
		await paidBackOn(alex, "milk", 300, "2026-09-25" as DayKey);
		const after = await forSums();
		const moved = Object.keys(after).filter((key) => after[key] !== before.byFor[key]);
		expect(moved).toHaveLength(1);
		expect(moved[0]).toMatch(/^2026-09 /);
		expect((after[moved[0] as string] ?? 0) - (before.byFor[moved[0] as string] ?? 0)).toBe(-300);
		// By who it was For and by Bucket now add up to the same.
		const total = (rows: { amount: number }[]) => rows.reduce((sum, row) => sum + row.amount, 0);
		expect(total(await loadForCells(db, scope(sam), "month"))).toBe(
			total((await loadSpendCells(db, scope(sam), "month")).cells),
		);
		const listed = await loadReportItems(db, scope(sam), "date", 50);
		expect(listed.total).toBe(before.items.total + 1);
		expect(listed.items.find((item) => item.paidBack)).toEqual({
			id: "milk",
			date: "2026-09-25",
			amount: -300,
			note: null,
			merchantName: null,
			target: "bucket:groceries",
			accountId: null,
			split: false,
			paidBack: true,
		});
		expect(total(listed.items)).toBe(total((await loadSpendCells(db, scope(sam), "all")).cells));
		// Largest first, it is last.
		expect((await loadReportItems(db, scope(sam), "amount", 50)).items.at(-1)?.paidBack).toBe(true);
	});

	it("isn't a purchase: merchants and amount bands are as they were", async () => {
		const read = async () => ({
			merchants: await loadMerchants(db, scope(sam)),
			bands: await loadAmountBands(db, scope(sam)),
		});
		const before = await read();
		await paidBackOn(alex, "milk", 300, "2026-09-25" as DayKey);
		expect(await read()).toEqual(before);
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

	it("lists a Member's share of what was For several, with the whole of it", async () => {
		// $45.01 at the rink For Kid and Alex: a cent that can't be halved goes to the first of them.
		await quickAdd(alex, "skates", "groceries", 4_501, "Rink", "2026-09-12", ["kid", "alex"]);
		const forKid = await loadReportItems(db, scope(alex, { member: "kid" }), "date", 10);
		const forAlex = await loadReportItems(db, scope(alex, { member: "alex" }), "date", 10);
		const skates = (found: typeof forKid) => found.items.find((i) => i.id === "skates");
		expect(skates(forKid)).toMatchObject({ amount: 2_250, whole: 4_501 });
		expect(skates(forAlex)).toMatchObject({ amount: 2_251, whole: 4_501 });
		// What was For Kid alone is all Kid's, and says no more.
		expect(forKid.items.find((i) => i.id === "milk")).not.toHaveProperty("whole");
		// The rows add up to the figure they are behind.
		const cells = await loadForCells(db, scope(alex), "month");
		const figure = cells.reduce((sum, cell) => sum + shareFor(cell, "kid"), 0);
		expect(forKid.items.reduce((sum, item) => sum + item.amount, 0)).toBe(figure);
		// Everyone's, and a list not narrowed to a Member, keep the whole amount.
		const all = await loadReportItems(db, scope(alex), "date", 10);
		expect(skates(all)).toMatchObject({ amount: 4_501 });
		expect(skates(all)).not.toHaveProperty("whole");
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

describe("loadBucketHistory", () => {
	const history = async (viewer: Viewer, bucketId: string, from: MonthKey, to: MonthKey) =>
		loadBucketHistory(db, viewer, await loadPlanRecords(db, householdId, to), {
			bucketId,
			from,
			to,
		});

	it("gives a Bucket's spending and balance month by month, whole and split, carried while carries over", async () => {
		await setCarriesOver(db, {
			householdId,
			memberId: "alex",
			bucketId: "groceries",
			month: "2026-08",
			rolling: true,
		});
		const months = await history(sam, "groceries", "2026-08", "2026-09");
		expect(months.map((m) => [m.month, m.allowance, m.rolledOver, m.spent, m.left])).toEqual([
			["2026-08", 120_000, 0, 650, 119_350],
			["2026-09", 120_000, 119_350, 37_000, 202_350],
		]);
		// Starting later still carries what rolled in from before.
		expect((await history(sam, "groceries", "2026-09", "2026-09"))[0]?.rolledOver).toBe(119_350);
	});

	it("gives the other Parent a Personal Allowance's monthly totals, the same as its owner sees", async () => {
		const theirs = await history(sam, "alex-pa", "2026-07", "2026-09");
		expect(theirs.map((m) => [m.month, m.inPlan, m.spent])).toEqual([
			["2026-07", false, 0],
			["2026-08", true, 0],
			["2026-09", true, 7_200],
		]);
		expect(await history(alex, "alex-pa", "2026-07", "2026-09")).toEqual(theirs);
	});
});
