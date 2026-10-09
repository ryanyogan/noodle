import { type Cents, type DayKey, type MonthKey, OWED_BACK_UNCOUNTED_FROM } from "@noodle/domain";
import { sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addBucket,
	addChild,
	addCommitment,
	addCommitmentPayment,
	addIncome,
	addQuickAdd,
	changeMoneyInKind,
	confirmPaidBack,
	createHouseholdForParent,
	type Db,
	loadCharges,
	loadOwedBack,
	loadPlanRecords,
	loadSpending,
	loadTransactionsPage,
	loadUnmatchedPaidBack,
	offerPaidBackFor,
	removeOwedBack,
	sayOwedBack,
	setTakeHomePay,
	splitTransaction,
	undoOwedBackWriteOff,
	writeOffOwedBack,
} from "./index";
import { bucketLeftSql } from "./moves";
import { setCarriesOver } from "./plan";
import {
	loadDailySpend,
	loadForCells,
	loadReportItems,
	loadSpendCells,
	type ReportScope,
} from "./reports";
import { loadRolledOver } from "./rollover";
import { testDb } from "./test-db";

// What's owed back never counts as our spending (issue 158; ADR-0058, revised 2026-10-08). Skates
// bought on September 30 count whole and are restored when Casey pays; sticks bought on October 1
// count only the Household's half from the start, and Casey's money changes nothing in the Bucket.

const householdId = "household";
const parentId = "parent";
const viewer = { householdId, memberId: parentId };
const september: MonthKey = "2026-09";
const october: MonthKey = "2026-10";
const today: DayKey = "2026-10-08";

let db: Db;

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId,
		parentName: "Alex",
	});
	await setTakeHomePay(db, {
		householdId,
		memberId: parentId,
		month: september,
		amountCents: 900_000,
	});
	for (const [bucketId, color, allowanceCents] of [
		["hockey", 1, 40_000],
		["health", 2, 20_000],
	] as const) {
		await addBucket(db, {
			householdId,
			memberId: parentId,
			bucketId,
			name: bucketId,
			color,
			month: september,
			allowanceCents,
		});
	}
	await setCarriesOver(db, {
		householdId,
		memberId: parentId,
		bucketId: "hockey",
		month: september,
		rolling: true,
	});
	// Planned at the Household's share: half of $1,200.
	await addCommitment(db, {
		householdId,
		memberId: parentId,
		commitmentId: "tuition",
		name: "Tuition",
		month: september,
		amountCents: 60_000,
		cadence: "monthly",
		dueDate: "2026-09-03",
	});
	await addChild(db, { householdId, memberId: "leo", name: "Leo", color: 3 });
	for (const [transactionId, bucketId, date, amountCents] of [
		// The last day that counts whole, and the first that counts only the Household's share.
		["skates", "hockey", "2026-09-30", 4_500],
		["sticks", "hockey", OWED_BACK_UNCOUNTED_FROM, 60_000],
		["gear", "hockey", "2026-10-04", 20_000],
	] as const) {
		await addQuickAdd(db, {
			householdId,
			transactionId,
			bucketId,
			date,
			amountCents: amountCents as Cents,
			note: transactionId,
			forMemberIds: ["leo"],
			createdByMemberId: parentId,
		});
	}
	await addCommitmentPayment(db, {
		householdId,
		transactionId: "tuition-oct",
		commitmentId: "tuition",
		date: "2026-10-03",
		amountCents: 120_000 as Cents,
		createdByMemberId: parentId,
	});
	// Gear is split: $150 of hockey gear, $50 at the pharmacy. Casey owes $100 of the hockey part.
	await splitTransaction(db, {
		householdId,
		memberId: parentId,
		transactionId: "gear",
		amountCents: 20_000 as Cents,
		note: "gear",
		splits: [
			{
				id: "gear-hockey",
				amountCents: 15_000 as Cents,
				assignment: { bucketId: "hockey" },
				forMemberIds: ["leo"],
			},
			{
				id: "gear-health",
				amountCents: 5_000 as Cents,
				assignment: { bucketId: "health" },
				forMemberIds: [],
			},
		],
	});
	for (const [owedBackId, transactionId, amountCents, splitId] of [
		["ob-skates", "skates", 4_500, undefined],
		// Half, unless said.
		["ob-sticks", "sticks", undefined, undefined],
		["ob-tuition", "tuition-oct", undefined, undefined],
		["ob-gear", "gear", 10_000, "gear-hockey"],
	] as const) {
		const said = await sayOwedBack(db, viewer, {
			owedBackId,
			transactionId,
			who: "Casey",
			...(amountCents ? { amountCents: amountCents as Cents } : {}),
			...(splitId ? { splitId } : {}),
		});
		expect(said.ok).toBe(true);
	}
});

/** Casey sends money, a Parent says it is Paid back, and the offer is confirmed as offered. */
async function caseyPays(incomeId: string, date: DayKey, amountCents: number) {
	await addIncome(db, {
		householdId,
		incomeId,
		date,
		amountCents: amountCents as Cents,
		note: "Zelle",
		createdByMemberId: parentId,
	});
	await changeMoneyInKind(db, viewer, {
		incomeId,
		kind: "paid-back",
		transferId: `${incomeId}-transfer`,
	});
	const offered = await offerPaidBackFor(db, viewer, incomeId);
	if (!offered) throw new Error("no offer");
	return confirmPaidBack(db, viewer, {
		incomeId,
		matches: offered.offer.matches.map((match) => ({ ...match, id: `m-${match.owedBackId}` })),
		today,
	});
}

const spent = async (month: MonthKey) =>
	(await loadSpending(db, viewer, month))
		.map((spend) => [
			spend.bucketId,
			spend.amount,
			spend.owed ? "owed" : spend.paidBack ? "back" : "",
		])
		.sort();

const charged = async (month: MonthKey) =>
	(await loadCharges(db, viewer, month)).map((charge) => [
		charge.commitmentId,
		charge.amount,
		charge.owed ? "owed" : "",
	]);

const left = async (bucketId: string, month: MonthKey) => {
	const [row] = await db.all(sql`select ${bucketLeftSql(householdId, bucketId, month)} as left`);
	return (row as unknown as [number])[0];
};

const net = (rows: (string | number)[][]) =>
	rows.reduce((sum, [, amount]) => sum + (amount as number), 0);

const octoberReport = (filters: ReportScope["filters"] = {}): ReportScope => ({
	viewer,
	range: { from: "2026-10-01" as DayKey, until: "2026-11-01" as DayKey },
	filters,
});

describe("a purchase with part Owed back, from October 1", () => {
	it("counts only the Household's share against its Bucket, from the day it is said", async () => {
		// Each purchase is there whole, with its Owed back part taken off on the same day.
		expect(await spent(october)).toEqual([
			["health", 5_000, ""],
			["hockey", -10_000, "owed"],
			["hockey", -30_000, "owed"],
			["hockey", 15_000, ""],
			["hockey", 60_000, ""],
		]);
		// $400, less sticks at $300 and the hockey part of gear at $50.
		expect(await left("hockey", october)).toBe(5_000);
		// The other Split is untouched by what is owed on the first.
		expect(await left("health", october)).toBe(15_000);
	});

	it("counts only the Household's share of a Commitment's payment, never as a payment", async () => {
		expect(await charged(october)).toEqual([
			["tuition", 120_000, ""],
			["tuition", -60_000, "owed"],
		]);
		const [, owed] = await loadCharges(db, viewer, october);
		expect(owed).toMatchObject({ paidBack: true, owed: true, who: "Casey" });
	});

	it("leaves the purchase before October 1 whole in September", async () => {
		expect(await spent(september)).toEqual([["hockey", 4_500, ""]]);
		expect(await left("hockey", september)).toBe(35_500);
	});

	it("changes nothing in the Bucket when the money comes, but restores the September purchase", async () => {
		const before = { october: await spent(october), september: await spent(september) };
		// Oldest first: the skates ($45), the sticks ($300), and $5 of what the tuition owes.
		expect(await caseyPays("zelle", "2026-10-06", 35_000)).toMatchObject({
			ok: true,
			unmatched: 0,
		});
		expect(
			(await loadOwedBack(db, viewer, { open: true })).map((item) => [
				item.id,
				item.owed - item.paid,
			]),
		).toEqual([
			["ob-tuition", 59_500],
			["ob-gear", 10_000],
		]);
		// Only the skates, which counted whole in September, come back into October.
		expect(await spent(october)).toEqual([...before.october, ["hockey", -4_500, "back"]].sort());
		expect(await charged(october)).toEqual([
			["tuition", 120_000, ""],
			["tuition", -60_000, "owed"],
		]);
		expect(await left("hockey", october)).toBe(9_500);
		// The month that had ended is as it ended.
		expect(await spent(september)).toEqual(before.september);
		// What was owed says how much of it has come.
		const sticks = (await loadSpending(db, viewer, october)).find(
			(spend) => spend.owed && spend.id === "sticks",
		);
		expect(sticks?.settled).toBe(30_000);
	});

	it("keeps money beyond what is owed as Paid back, not matched yet", async () => {
		// Everything owed comes to $1,045.
		expect(await caseyPays("zelle", "2026-10-06", 110_000)).toMatchObject({
			ok: true,
			unmatched: 5_500,
		});
		expect((await loadUnmatchedPaidBack(db, householdId)).map((line) => line.unmatched)).toEqual([
			5_500,
		]);
		expect(await left("hockey", october)).toBe(9_500);
	});

	it("carries a Bucket over by the same figures, before and after the money comes", async () => {
		const records = await loadPlanRecords(db, householdId, "2026-11");
		// September left $355; October's $400 less the Household's $350 carries on with it.
		expect(await loadRolledOver(db, householdId, records, "2026-11")).toEqual({ hockey: 40_500 });
		expect(await loadRolledOver(db, householdId, records, october)).toEqual({ hockey: 35_500 });
		await caseyPays("zelle", "2026-10-06", 35_000);
		// The skates' $45 came back in October; nothing else moved.
		expect(await loadRolledOver(db, householdId, records, "2026-11")).toEqual({ hockey: 45_000 });
		expect(await loadRolledOver(db, householdId, records, october)).toEqual({ hockey: 35_500 });
	});

	it("agrees in the Transactions list: rows whole, what they say is owed, the total without it", async () => {
		await caseyPays("zelle", "2026-10-06", 35_000);
		const page = await loadTransactionsPage(db, viewer, { month: october, limit: 50 });
		expect(page.transactions.map((row) => [row.id, row.amountCents, row.owedBack])).toEqual([
			[
				"gear",
				20_000,
				[{ who: "Casey", owed: 10_000, paid: 0, writtenOff: 0, writtenOffOn: null }],
			],
			[
				"tuition-oct",
				120_000,
				[{ who: "Casey", owed: 60_000, paid: 500, writtenOff: 0, writtenOffOn: null }],
			],
			[
				"sticks",
				60_000,
				[{ who: "Casey", owed: 30_000, paid: 30_000, writtenOff: 0, writtenOffOn: null }],
			],
		]);
		// $2,000 went out; $1,000 of it is the Household's.
		expect(page.total).toBe(100_000);
		expect(page.summary?.outCents).toBe(100_000);
		// September's list is as it was: the skates whole.
		const before = await loadTransactionsPage(db, viewer, { month: september, limit: 50 });
		expect(before.total).toBe(4_500);
	});

	it("agrees in Reports, by Bucket, by day, by who it was For, and narrowed to one Member", async () => {
		const bucketsAndCommitments = net(await spent(october)) + net(await charged(october));
		expect(bucketsAndCommitments).toBe(100_000);
		const { cells } = await loadSpendCells(db, octoberReport(), "all");
		expect(cells.reduce((sum, cell) => sum + cell.amount, 0)).toBe(100_000);
		expect((await loadDailySpend(db, octoberReport())).map((day) => [day.day, day.amount])).toEqual(
			[
				["2026-10-01", 30_000],
				["2026-10-03", 60_000],
				["2026-10-04", 10_000],
			],
		);
		const forCells = await loadForCells(db, octoberReport(), "month");
		const forLeo = forCells.filter((cell) => cell.for.includes("leo"));
		// Sticks at $300 and the hockey part of gear at $50; tuition and the pharmacy are everyone's.
		expect(forLeo.reduce((sum, cell) => sum + cell.amount, 0)).toBe(35_000);
		// Narrowed to what was For Leo, the Owed back part stays out with its purchase.
		const narrowed = await loadSpendCells(db, octoberReport({ member: "leo" }), "all");
		expect(narrowed.cells.reduce((sum, cell) => sum + cell.amount, 0)).toBe(35_000);
		const others = await loadSpendCells(db, octoberReport({ member: "everyone" }), "all");
		expect(others.cells.reduce((sum, cell) => sum + cell.amount, 0)).toBe(65_000);
	});
});

describe("writing off what is Owed back", () => {
	const november: MonthKey = "2026-11";
	const inNovember: DayKey = "2026-11-05";
	const openIds = async () => (await loadOwedBack(db, viewer, { open: true })).map((o) => o.id);

	it("counts in the month it is written off, never in the purchase's month", async () => {
		const before = await left("hockey", november);
		const result = await writeOffOwedBack(db, viewer, {
			owedBackId: "ob-sticks",
			today: inNovember,
		});
		expect(result).toMatchObject({
			ok: true,
			item: { writtenOff: 30_000, writtenOffOn: inNovember },
		});
		// October is as it was: the purchase whole, its Owed back part taken off.
		expect(await spent(october)).toContainEqual(["hockey", -30_000, "owed"]);
		expect(await left("hockey", october)).toBe(5_000);
		// November has it as spending in the purchase's Bucket.
		expect(await spent(november)).toEqual([["hockey", 30_000, "back"]]);
		expect(await left("hockey", november)).toBe(before - 30_000);
		const [row] = await loadSpending(db, viewer, november);
		expect(row).toMatchObject({ id: "sticks", writeOff: true, for: ["leo"] });
		// It has left the open list and is among what was written off.
		expect(await openIds()).not.toContain("ob-sticks");
		expect((await loadOwedBack(db, viewer, { writtenOff: true })).map((o) => o.id)).toEqual([
			"ob-sticks",
		]);
		// Writing it off again changes nothing.
		const again = await writeOffOwedBack(db, viewer, {
			owedBackId: "ob-sticks",
			today: "2026-12-01" as DayKey,
		});
		expect(again).toMatchObject({ ok: true, item: { writtenOffOn: inNovember } });
	});

	it("counts what was owed on a Split in that Split's Bucket", async () => {
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-gear", today });
		expect(await spent(october)).toContainEqual(["hockey", 10_000, "back"]);
		expect(await left("hockey", october)).toBe(-5_000);
		expect(await left("health", october)).toBe(15_000);
		// The Bucket's Owed back row says it is owed no longer.
		const owed = (await loadSpending(db, viewer, october)).find((s) => s.owed && s.id === "gear");
		expect(owed).toMatchObject({ amount: -10_000, writtenOff: 10_000 });
	});

	it("counts in the Commitment the payment was filed in, never as a payment", async () => {
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-tuition", today });
		const charges = await loadCharges(db, viewer, october);
		expect(net(charges.map((c) => [c.commitmentId, c.amount]))).toBe(120_000);
		expect(charges.find((c) => c.writeOff)).toMatchObject({
			commitmentId: "tuition",
			amount: 60_000,
			date: today,
			paidBack: true,
		});
	});

	it("writes off only what is left after a part payment", async () => {
		// $100: skates in full at $45, and $55 of sticks.
		await caseyPays("zelle", "2026-10-06" as DayKey, 10_000);
		const result = await writeOffOwedBack(db, viewer, { owedBackId: "ob-sticks", today });
		expect(result).toMatchObject({ ok: true, item: { paid: 5_500, writtenOff: 24_500 } });
		// The $45 Paid back on skates, bought in September, restores the Bucket as before.
		expect(await left("hockey", october)).toBe(5_000 + 4_500 - 24_500);
		expect(await openIds()).toEqual(["ob-tuition", "ob-gear"]);
		// Nothing is left of it to write off once all of it is Paid back.
		expect(await writeOffOwedBack(db, viewer, { owedBackId: "ob-skates", today })).toEqual({
			ok: false,
			reason: "nothing-owed",
		});
	});

	it("is undone while the month it was written off in is running", async () => {
		const before = await spent(october);
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-sticks", today });
		expect(await left("hockey", october)).toBe(-25_000);
		// Who and how much stay as they are while it is written off.
		expect(
			await sayOwedBack(db, viewer, { owedBackId: "x", transactionId: "sticks", who: "Robin" }),
		).toEqual({ ok: false, reason: "written-off" });
		const undone = await undoOwedBackWriteOff(db, viewer, {
			owedBackId: "ob-sticks",
			today: "2026-10-20" as DayKey,
		});
		expect(undone).toMatchObject({ ok: true, item: { writtenOff: 0, writtenOffOn: null } });
		expect(await spent(october)).toEqual(before);
		expect(await left("hockey", october)).toBe(5_000);
		expect(await openIds()).toContain("ob-sticks");
	});

	it("stays written off once that month has ended", async () => {
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-sticks", today });
		const later = { owedBackId: "ob-sticks", today: "2026-11-01" as DayKey };
		expect(await undoOwedBackWriteOff(db, viewer, later)).toEqual({
			ok: false,
			reason: "month-ended",
		});
		expect(await removeOwedBack(db, viewer, later)).toEqual({ ok: false, reason: "month-ended" });
		expect(await left("hockey", october)).toBe(-25_000);
	});

	it("only closes an item on a purchase from before October 1, which counted whole", async () => {
		const before = await spent(october);
		const result = await writeOffOwedBack(db, viewer, { owedBackId: "ob-skates", today });
		expect(result).toMatchObject({ ok: true, item: { writtenOff: 4_500 } });
		expect(await spent(october)).toEqual(before);
		expect(await spent(september)).toEqual([["hockey", 4_500, ""]]);
		expect(await left("hockey", october)).toBe(5_000);
		expect(await openIds()).not.toContain("ob-skates");
	});

	it("is a line of its own in Reports, Written off, on the day and where the purchase is filed", async () => {
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-sticks", today });
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-tuition", today });
		const { cells } = await loadSpendCells(db, octoberReport(), "all");
		expect(cells.reduce((sum, cell) => sum + cell.amount, 0)).toBe(190_000);
		const days = await loadDailySpend(db, octoberReport());
		expect(days.find((day) => day.day === today)?.amount).toBe(90_000);
		const { items } = await loadReportItems(db, octoberReport(), "date", 50);
		const lines = items.filter((item) => item.writtenOff);
		expect(lines).toHaveLength(2);
		expect(lines).toContainEqual(
			expect.objectContaining({
				id: "sticks",
				date: today,
				amount: 30_000,
				target: "bucket:hockey",
				paidBack: true,
			}),
		);
		expect(lines).toContainEqual(
			expect.objectContaining({
				id: "tuition-oct",
				date: today,
				amount: 60_000,
				target: "commitment:tuition",
				paidBack: true,
			}),
		);
		// Neither is said to be Owed back; the part taken off on the purchase's day still is.
		expect(lines.every((item) => !item.owedBack)).toBe(true);
		expect(items).toContainEqual(
			expect.objectContaining({ id: "sticks", amount: -30_000, owedBack: true }),
		);
	});

	it("stays with its purchase in a narrowed Report, in the month it is written off too", async () => {
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-sticks", today });
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-tuition", today });
		const total = async (report: ReportScope) =>
			(await loadSpendCells(db, report, "all")).cells.reduce((sum, cell) => sum + cell.amount, 0);
		// Sticks were For Leo, tuition is everyone's.
		expect(await total(octoberReport({ member: "leo" }))).toBe(65_000);
		expect(await total(octoberReport({ member: "everyone" }))).toBe(125_000);
		const forLeo = await loadReportItems(db, octoberReport({ member: "leo" }), "date", 50);
		expect(forLeo.items.filter((item) => item.writtenOff).map((item) => item.id)).toEqual([
			"sticks",
		]);
		// Gear's $100 is written off in November: its purchase is not in that month's range.
		await writeOffOwedBack(db, viewer, { owedBackId: "ob-gear", today: inNovember });
		const novemberReport = (filters: ReportScope["filters"] = {}): ReportScope => ({
			viewer,
			range: { from: "2026-11-01" as DayKey, until: "2026-12-01" as DayKey },
			filters,
		});
		expect(await total(novemberReport())).toBe(10_000);
		expect(await total(novemberReport({ member: "leo" }))).toBe(10_000);
		expect(await total(novemberReport({ member: "everyone" }))).toBe(0);
	});

	it("refuses another Household", async () => {
		const other = { householdId: "other-household", memberId: "someone" };
		const input = { owedBackId: "ob-sticks", today };
		expect(await writeOffOwedBack(db, other, input)).toEqual({ ok: false, reason: "refused" });
		expect(await undoOwedBackWriteOff(db, other, input)).toEqual({ ok: false, reason: "refused" });
		expect(await openIds()).toContain("ob-sticks");
	});
});
