import {
	type Cents,
	type DayKey,
	type MonthKey,
	payToComeLeft,
	payToComeOffers,
} from "@noodle/domain";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addIncome,
	addPayToCome,
	changePayToCome,
	clearHouseholdRows,
	createHouseholdForParent,
	type Db,
	loadIncome,
	loadIncomeCells,
	loadPayLines,
	loadPayToCome,
	matchPayToCome,
	removeIncome,
	removePayToCome,
	sayNotThisPay,
	sayPayArrived,
	setTakeHomePay,
} from "./index";
import { income, members, payToCome, payToComeArrivals } from "./schema";
import { testDb } from "./test-db";

// Pay to come (issue 159, phase a; ADR-0066): pay earned and not in yet counts nowhere, and is in
// once Income is said to be it, by the rule for the exact amount or by a Parent.

const householdId = "household";
const robin = "robin";
const sam = "sam";
const viewer = { householdId, memberId: robin };
const oct: MonthKey = "2026-10";
const cents = (dollars: number) => (dollars * 100) as Cents;

let db: Db;

const receive = async (incomeId: string, date: string, dollars: number, whose: string | null) => {
	await addIncome(db, {
		householdId,
		incomeId,
		date: date as DayKey,
		amountCents: cents(dollars),
		note: null,
		createdByMemberId: robin,
	});
	await db.update(income).set({ payMemberId: whose }).where(eq(income.id, incomeId));
};

const record = (id: string, dollars: number, from = "Larkspur Studio", memberId = robin) =>
	addPayToCome(db, viewer, {
		id,
		memberId,
		from,
		amountCents: cents(dollars),
		expectedOn: "2026-10-20" as DayKey,
		recordedOn: "2026-10-02" as DayKey,
	});

const one = async (id: string) => {
	const pay = (await loadPayToCome(db, householdId)).find((p) => p.id === id);
	if (!pay) throw new Error(`No pay to come ${id}`);
	return pay;
};

/** October's Income by the reads every total comes from. */
async function counted() {
	const lines = await loadIncome(db, householdId, oct, "2026-11");
	const cells = await loadIncomeCells(
		db,
		householdId,
		{ from: "2026-10-01" as DayKey, until: "2026-11-01" as DayKey },
		"month",
	);
	const total = lines.reduce((sum, line) => sum + line.amount, 0);
	expect(cells.reduce((sum, cell) => sum + cell.amount, 0)).toBe(total);
	return total;
}

beforeEach(async () => {
	db = testDb();
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-user",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: robin,
		parentName: "Robin",
	});
	await db.insert(members).values({ id: sam, householdId, name: "Sam", kind: "parent" });
	await setTakeHomePay(db, { householdId, memberId: robin, month: oct, amountCents: 400_000 });
});

describe("pay to come counts nowhere until it arrives", () => {
	it("adds nothing to Income or Extra income while it waits, and only its Income once in", async () => {
		await receive("usual", "2026-10-01", 4000, robin);
		const before = await counted();
		await record("a", 1800);
		expect(await counted()).toBe(before);
		expect(before).toBe(400_000);
		// It arrives: the month's Income goes up by the line of Income, once, and by nothing else.
		await receive("in", "2026-10-09", 1800, robin);
		expect(await matchPayToCome(db, householdId, { only: ["in"] })).toEqual({ matched: 1 });
		expect(await counted()).toBe(580_000);
		expect(payToComeLeft(await one("a"))).toBe(0);
	});
});

describe("matching", () => {
	it("keeps the exact amount of the same Parent's pay, and nothing ambiguous", async () => {
		await record("a", 1800);
		await record("b", 950, "Tern & Co");
		await record("c", 950, "Marlow Print");
		await receive("l1", "2026-10-09", 1800, robin);
		await receive("l2", "2026-10-10", 950, robin);
		await receive("l3", "2026-10-11", 1800, sam);
		expect(await matchPayToCome(db, householdId, { only: ["l1", "l2", "l3"] })).toEqual({
			matched: 1,
		});
		expect((await one("a")).arrivals.map((arrival) => arrival.incomeId)).toEqual(["l1"]);
		// Two clients owe $950: the line is offered for each, and a Parent says which.
		const all = await loadPayToCome(db, householdId);
		const lines = await loadPayLines(db, householdId, all);
		expect(payToComeOffers(await one("b"), all, lines).map((line) => line.id)).toEqual(["l2"]);
		expect(
			await sayPayArrived(db, householdId, { payToComeId: "c", incomeId: "l2", all: true }),
		).toEqual({ ok: true });
		// One line is one payment: it can't also be the other's.
		expect(
			await sayPayArrived(db, householdId, { payToComeId: "b", incomeId: "l2", all: true }),
		).toEqual({ ok: false });
		expect(payToComeLeft(await one("b"))).toBe(cents(950));
	});

	it("leaves the rest waiting after a part, then takes the rest when it lands", async () => {
		await record("a", 1800);
		await receive("part", "2026-10-06", 600, robin);
		expect(await matchPayToCome(db, householdId, { only: ["part"] })).toEqual({ matched: 0 });
		await sayPayArrived(db, householdId, { payToComeId: "a", incomeId: "part", all: false });
		expect(payToComeLeft(await one("a"))).toBe(cents(1200));
		// Less than what has arrived is refused.
		expect(
			await changePayToCome(db, householdId, {
				id: "a",
				from: "Larkspur Studio",
				amountCents: cents(500),
				expectedOn: null,
			}),
		).toEqual({ ok: false, reason: "less-than-in" });
		await receive("rest", "2026-10-21", 1200, robin);
		expect(await matchPayToCome(db, householdId, { only: ["rest"] })).toEqual({ matched: 1 });
		expect(payToComeLeft(await one("a"))).toBe(0);
	});

	it("takes a line a wire fee short as all of it when a Parent says so, claiming whose pay", async () => {
		await record("a", 1800);
		await receive("short", "2026-10-09", 1775, null);
		expect(await matchPayToCome(db, householdId, { only: ["short"] })).toEqual({ matched: 0 });
		await sayPayArrived(db, householdId, { payToComeId: "a", incomeId: "short", all: true });
		const pay = await one("a");
		expect(payToComeLeft(pay)).toBe(0);
		expect(pay.arrivals[0]).toMatchObject({ covers: cents(1800), amount: cents(1775) });
		const [line] = await db.select().from(income).where(eq(income.id, "short"));
		expect(line?.payMemberId).toBe(robin);
		expect(line?.amountCents).toBe(cents(1775));
	});

	it("undone, it waits again and that line is never matched or offered to it again", async () => {
		await record("a", 1800);
		await receive("l1", "2026-10-09", 1800, robin);
		await matchPayToCome(db, householdId, { only: ["l1"] });
		await sayNotThisPay(db, householdId, { payToComeId: "a", incomeId: "l1" });
		expect(payToComeLeft(await one("a"))).toBe(cents(1800));
		expect(await matchPayToCome(db, householdId, { only: ["l1"] })).toEqual({ matched: 0 });
		expect(
			await sayPayArrived(db, householdId, { payToComeId: "a", incomeId: "l1", all: true }),
		).toEqual({ ok: false });
	});

	it("waits again when its Income is removed", async () => {
		await record("a", 1800);
		await receive("l1", "2026-10-09", 1800, robin);
		await matchPayToCome(db, householdId, { only: ["l1"] });
		await removeIncome(db, { householdId, incomeId: "l1", month: oct });
		expect(payToComeLeft(await one("a"))).toBe(cents(1800));
	});
});

describe("whose it is", () => {
	it("is the Household's: recorded for either Parent, and never another Household's", async () => {
		// Income is the Household's, never private (ADR-0057), and so is pay still to come.
		expect(await record("s", 700, "Tern & Co", sam)).toEqual({ ok: true });
		expect((await loadPayToCome(db, householdId)).map((pay) => pay.memberId)).toEqual([sam]);
		await createHouseholdForParent(db, {
			clerkUserId: "clerk-other",
			householdId: "other",
			householdName: "The Pikes",
			timeZone: "America/Chicago",
			parentId: "pat",
			parentName: "Pat",
		});
		expect(await loadPayToCome(db, "other")).toEqual([]);
		// Not for a Parent of another Household, and not theirs to change or remove.
		expect(await record("x", 700, "Tern & Co", "pat")).toEqual({ ok: false });
		expect(await removePayToCome(db, "other", "s")).toEqual({ ok: false });
		expect(await sayNotThisPay(db, "other", { payToComeId: "s", incomeId: "l" })).toEqual({
			ok: false,
		});
		expect(
			await changePayToCome(db, "other", {
				id: "s",
				from: "Tern & Co",
				amountCents: cents(1),
				expectedOn: null,
			}),
		).toEqual({ ok: false, reason: "refused" });
		expect((await one("s")).amount).toBe(cents(700));
	});

	it("is removed with what it arrived as, and cleared by Start fresh", async () => {
		await record("a", 1800);
		await record("b", 950);
		await receive("l1", "2026-10-09", 1800, robin);
		await matchPayToCome(db, householdId, { only: ["l1"] });
		expect(await removePayToCome(db, householdId, "a")).toEqual({ ok: true });
		expect(await db.select().from(payToComeArrivals)).toEqual([]);
		// The Income it arrived as stays.
		expect(await counted()).toBe(180_000);
		await clearHouseholdRows(db, householdId, "fresh-start");
		expect(await db.select().from(payToCome)).toEqual([]);
	});
});
