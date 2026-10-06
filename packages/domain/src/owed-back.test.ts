import { describe, expect, it } from "vitest";
import type { Cents } from "./money";
import type { DayKey } from "./month";
import {
	checkPaidBack,
	cleanOwedBackName,
	defaultOwedBack,
	type OwedBack,
	offerPaidBack,
	owedBackByPerson,
	owedBackLeft,
	owedBackPersonIn,
	owedBackRuleText,
	owedBackSummary,
	settleOwedBack,
} from "./owed-back";

// Paid back and Owed back (issue 132, ADR-0058). The ticket's scenario: tuition of $1,200 in
// September with half owed by Casey, skates $45 and the dentist $80, then $700 arrives in October.

const item = (id: string, date: string, owed: number, who = "Casey", paid = 0): OwedBack => ({
	id,
	date: date as DayKey,
	who,
	owed: owed as Cents,
	paid: paid as Cents,
});

const tuition = item("tuition", "2026-09-03", defaultOwedBack(120_000 as Cents));
const skates = item("skates", "2026-09-14", 4_500);
const dentist = item("dentist", "2026-09-20", 8_000);
// Given newest first, as a list would be: the offer sorts them itself.
const open = [dentist, skates, tuition];

describe("how much is Owed back", () => {
	it("is half the purchase unless said, to the cent", () => {
		expect(defaultOwedBack(120_000 as Cents)).toBe(60_000);
		expect(defaultOwedBack(4_501 as Cents)).toBe(2_251);
	});

	it("is what hasn't been Paid back yet, never less than nothing", () => {
		expect(owedBackLeft(item("a", "2026-09-01", 60_000, "Casey", 45_000))).toBe(15_000);
		expect(owedBackLeft(item("a", "2026-09-01", 60_000, "Casey", 70_000))).toBe(0);
	});
});

describe("offering a payment against what's Owed back", () => {
	it("settles tuition and skates with $700 and leaves the dentist partly owed", () => {
		const offer = offerPaidBack(70_000 as Cents, open);
		expect(offer).toEqual({
			matches: [
				{ owedBackId: "tuition", amount: 60_000 },
				{ owedBackId: "skates", amount: 4_500 },
				{ owedBackId: "dentist", amount: 5_500 },
			],
			unmatched: 0,
		});
		const after = settleOwedBack(open, offer.matches);
		expect(after.map((left) => [left.id, owedBackLeft(left)])).toEqual([
			["dentist", 2_500],
			["skates", 0],
			["tuition", 0],
		]);
	});

	it("keeps what's beyond everything owed as not matched yet", () => {
		const offer = offerPaidBack(80_000 as Cents, open);
		expect(offer.matches.map((match) => match.amount)).toEqual([60_000, 4_500, 8_000]);
		expect(offer.unmatched).toBe(7_500);
	});

	it("takes the oldest items that fit first, then puts the rest on the oldest still open", () => {
		expect(offerPaidBack(10_000 as Cents, open)).toEqual({
			matches: [
				{ owedBackId: "tuition", amount: 5_500 },
				{ owedBackId: "skates", amount: 4_500 },
			],
			unmatched: 0,
		});
	});

	it("offers only what is still owed on an item partly Paid back", () => {
		const partly = item("tuition", "2026-09-03", 60_000, "Casey", 50_000);
		expect(offerPaidBack(70_000 as Cents, [partly])).toEqual({
			matches: [{ owedBackId: "tuition", amount: 10_000 }],
			unmatched: 60_000,
		});
	});

	it("offers nothing when nothing is owed", () => {
		expect(offerPaidBack(70_000 as Cents, [])).toEqual({ matches: [], unmatched: 70_000 });
		expect(offerPaidBack(0 as Cents, open)).toEqual({ matches: [], unmatched: 0 });
	});
});

describe("a Parent adjusts the offer", () => {
	const match = (owedBackId: string, amount: number) => ({ owedBackId, amount: amount as Cents });

	it("takes any split that fits the items and the payment", () => {
		expect(
			checkPaidBack(70_000 as Cents, open, [match("tuition", 60_000), match("dentist", 8_000)]),
		).toEqual({ ok: true, unmatched: 2_000 });
		expect(checkPaidBack(70_000 as Cents, open, [])).toEqual({ ok: true, unmatched: 70_000 });
	});

	it("refuses more than an item still owes, more than the payment, or an item it doesn't know", () => {
		expect(checkPaidBack(70_000 as Cents, open, [match("skates", 4_501)])).toEqual({
			ok: false,
			reason: "more-than-owed",
		});
		expect(
			checkPaidBack(60_000 as Cents, open, [match("tuition", 60_000), match("skates", 1)]),
		).toEqual({ ok: false, reason: "more-than-paid" });
		expect(checkPaidBack(70_000 as Cents, open, [match("gone", 100)])).toEqual({
			ok: false,
			reason: "not-owed",
		});
		expect(checkPaidBack(70_000 as Cents, open, [match("skates", 0)])).toEqual({
			ok: false,
			reason: "not-owed",
		});
		expect(
			checkPaidBack(70_000 as Cents, open, [match("skates", 100), match("skates", 100)]),
		).toEqual({ ok: false, reason: "not-owed" });
	});
});

describe("the Owed back list", () => {
	it("is per person, with what's outstanding, oldest first", () => {
		const list = owedBackByPerson([
			dentist,
			item("camp", "2026-08-02", 30_000, "Sam"),
			item("skates", "2026-09-14", 4_500, "casey", 4_500),
			tuition,
		]);
		expect(list.map((person) => [person.who, person.left, person.items.map((i) => i.id)])).toEqual([
			["Casey", 68_000, ["tuition", "dentist"]],
			["Sam", 30_000, ["camp"]],
		]);
	});

	it("sums what's owed back and by whom, for a Commitment's line", () => {
		expect(owedBackSummary([tuition])).toEqual({ left: 60_000, who: ["Casey"] });
		expect(owedBackSummary([tuition, item("camp", "2026-08-02", 30_000, "Sam")])).toEqual({
			left: 90_000,
			who: ["Casey", "Sam"],
		});
		expect(owedBackSummary([item("a", "2026-09-01", 100, "Casey", 100)])).toBeNull();
	});
});

describe("who", () => {
	it("is a name, tidied", () => {
		expect(cleanOwedBackName("  Casey   Lowe ")).toBe("Casey Lowe");
		expect(cleanOwedBackName("   ")).toBe("");
		expect(cleanOwedBackName("x".repeat(80))).toHaveLength(40);
	});

	it("is read from a payment's wording when it names someone who owes", () => {
		const names = ["Sam", "Casey"];
		expect(owedBackPersonIn("Zelle payment from CASEY LOWE 24816357", names)).toBe("Casey");
		expect(owedBackPersonIn("Zelle payment from SAMANTHA", names)).toBeNull();
		expect(owedBackPersonIn(null, names)).toBeNull();
	});
});

describe("what a Rule remembers about Owed back", () => {
	it("reads as the Rule's wording, who, and the part", () => {
		expect(owedBackRuleText("tuition", "Casey", 50)).toBe("Tuition: Casey pays back half");
		expect(owedBackRuleText("skate shop", "Leo", 100)).toBe("Skate shop: Leo pays back all of it");
		expect(owedBackRuleText("dentist", "Casey", 30)).toBe("Dentist: Casey pays back 30%");
	});
});
