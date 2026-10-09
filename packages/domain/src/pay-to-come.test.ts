import { describe, expect, it } from "vitest";
import type { Cents } from "./money";
import type { DayKey } from "./month";
import {
	type PayToCome,
	type PayToComeLine,
	payFit,
	payToComeChoices,
	payToComeLateBy,
	payToComeLeft,
	payToComeMatches,
	payToComeMonth,
	payToComeOffers,
} from "./pay-to-come";

const cents = (dollars: number) => Math.round(dollars * 100) as Cents;

const pay = (id: string, dollars: number, over: Partial<PayToCome> = {}): PayToCome => ({
	id,
	memberId: "robin",
	from: "Larkspur Studio",
	amount: cents(dollars),
	expectedOn: null,
	recordedOn: "2026-10-01" as DayKey,
	arrivals: [],
	notThis: [],
	...over,
});

const line = (id: string, dollars: number, date: string, whosePay: string | null = "robin") =>
	({ id, amount: cents(dollars), date: date as DayKey, whosePay }) satisfies PayToComeLine;

const arrival = (incomeId: string, dollars: number, date: string) => ({
	incomeId,
	covers: cents(dollars),
	amount: cents(dollars),
	date: date as DayKey,
});

describe("what is matched without asking", () => {
	it("is the same Parent's pay for exactly what is still to come", () => {
		const all = [pay("a", 1800)];
		expect(payToComeMatches({ all, lines: [line("l1", 1800, "2026-10-09")] })).toEqual([
			{ payToComeId: "a", incomeId: "l1", covers: cents(1800) },
		]);
	});

	it("is never a few dollars off, a part, the other Parent's pay or nobody's", () => {
		const all = [pay("a", 1800)];
		const lines = [
			line("close", 1775, "2026-10-09"),
			line("part", 900, "2026-10-09"),
			line("other", 1800, "2026-10-09", "sam"),
			line("nobody", 1800, "2026-10-09", null),
			line("before", 1800, "2026-09-28"),
		];
		expect(payToComeMatches({ all, lines })).toEqual([]);
	});

	it("is left to a Parent when two clients owe the same, or two lines could be it", () => {
		const same = [pay("a", 1800), pay("b", 1800, { from: "Tern & Co" })];
		expect(payToComeMatches({ all: same, lines: [line("l1", 1800, "2026-10-09")] })).toEqual([]);
		const lines = [line("l1", 1800, "2026-10-09"), line("l2", 1800, "2026-10-12")];
		expect(payToComeMatches({ all: [pay("a", 1800)], lines })).toEqual([]);
		// The line already here still makes the one that has just arrived ambiguous.
		expect(payToComeMatches({ all: [pay("a", 1800)], lines, only: ["l2"] })).toEqual([]);
	});

	it("matches the rest of one that is partly in, and leaves what a Parent said it is not", () => {
		const partly = pay("a", 1800, { arrivals: [arrival("l1", 600, "2026-10-05")] });
		const lines = [line("l1", 600, "2026-10-05"), line("l2", 1200, "2026-10-20")];
		expect(payToComeMatches({ all: [partly], lines })).toEqual([
			{ payToComeId: "a", incomeId: "l2", covers: cents(1200) },
		]);
		const said = pay("a", 1800, { notThis: ["l3"] });
		expect(payToComeMatches({ all: [said], lines: [line("l3", 1800, "2026-10-09")] })).toEqual([]);
	});

	it("touches only the lines that have just arrived", () => {
		const all = [pay("a", 1800), pay("b", 950)];
		const lines = [line("l1", 1800, "2026-10-09"), line("l2", 950, "2026-10-10")];
		expect(payToComeMatches({ all, lines, only: ["l2"] })).toEqual([
			{ payToComeId: "b", incomeId: "l2", covers: cents(950) },
		]);
	});
});

describe("what a Parent is offered", () => {
	it("is all of it, exactly or within $50, the exact first; Income nobody has claimed too", () => {
		const one = pay("a", 1800);
		const lines = [
			line("short", 1765, "2026-10-08"),
			line("exact", 1800, "2026-10-09", null),
			line("far", 1700, "2026-10-09"),
			line("other", 1800, "2026-10-09", "sam"),
		];
		expect(payToComeOffers(one, [one], lines).map((l) => l.id)).toEqual(["exact", "short"]);
		expect(payFit(cents(1800), cents(1750))).toBe("close");
		expect(payFit(cents(1800), cents(1749.99))).toBe("part");
		expect(payFit(cents(1800), cents(1850.01))).toBe("more");
	});

	it("by hand reaches a part, and Income that landed up to 31 days before it was recorded", () => {
		const one = pay("a", 1800);
		const other = pay("b", 400, { arrivals: [arrival("taken", 400, "2026-10-03")] });
		const lines = [
			line("part", 600, "2026-10-05"),
			line("earlier", 1800, "2026-09-10"),
			line("too-early", 1800, "2026-08-20"),
			line("taken", 400, "2026-10-03"),
		];
		expect(payToComeChoices(one, [one, other], lines).map((c) => [c.line.id, c.fit])).toEqual([
			["part", "part"],
			["earlier", "exact"],
		]);
		// Landed before it was recorded: a Parent's to pick, never offered.
		expect(payToComeOffers(one, [one, other], lines)).toEqual([]);
	});
});

describe("a month's reading", () => {
	const today = "2026-10-20" as DayKey;
	const late = pay("late", 1800, { expectedOn: "2026-10-08" as DayKey });
	const due = pay("due", 950, { expectedOn: "2026-11-03" as DayKey, from: "Tern & Co" });
	const partly = pay("partly", 1200, { arrivals: [arrival("l1", 500, "2026-10-12")] });
	const settled = pay("settled", 700, {
		recordedOn: "2026-09-02" as DayKey,
		arrivals: [arrival("l2", 700, "2026-10-02")],
	});
	const pays = [due, partly, settled, late];

	it("lists what is still to come with how late it is, and a part leaves the rest waiting", () => {
		const read = payToComeMonth(pays, "2026-10", today);
		expect(read.waiting.map((w) => [w.pay.id, w.left, w.lateBy])).toEqual([
			["late", cents(1800), 12],
			["due", cents(950), null],
			["partly", cents(700), null],
		]);
		expect(read.total).toBe(cents(3450));
		expect(read.arrived.map((a) => a.pay.id)).toEqual(["settled", "partly"]);
		expect(payToComeLeft(settled)).toBe(0);
	});

	it("is not late on its expected day, and one that is all in is never late", () => {
		expect(payToComeLateBy(late, "2026-10-08" as DayKey)).toBeNull();
		expect(payToComeLateBy(late, "2026-10-09" as DayKey)).toBe(1);
		expect(payToComeLateBy({ ...settled, expectedOn: "2026-09-20" as DayKey }, today)).toBeNull();
	});

	it("shows it from the month it was recorded to the month it is expected, or this one", () => {
		expect(payToComeMonth(pays, "2026-09", today).waiting).toEqual([]);
		expect(payToComeMonth(pays, "2026-11", today).waiting.map((w) => w.pay.id)).toEqual(["due"]);
		expect(payToComeMonth(pays, "2026-12", today).waiting).toEqual([]);
	});
});
