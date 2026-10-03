import { describe, expect, it } from "vitest";
import {
	type BucketUse,
	type DayKey,
	hourAt,
	matchBuckets,
	quickAddChoices,
	type Rule,
} from "./index";

const buckets = [
	{ id: "groceries", name: "Groceries" },
	{ id: "eating", name: "Eating out" },
	{ id: "gas", name: "Gas" },
	{ id: "pets", name: "Pet supplies" },
	{ id: "coffee", name: "Coffee" },
];
const today: DayKey = "2026-09-15";
const use = (bucketId: string, date: DayKey = today, more: Partial<BucketUse> = {}): BucketUse => ({
	bucketId,
	date,
	...more,
});
const choose = (input: Partial<Parameters<typeof quickAddChoices>[0]>) =>
	quickAddChoices({ buckets, uses: [], rules: [], note: "", today, hour: 12, ...input });
const ids = (choices: { bucket: { id: string } }[]) => choices.map((c) => c.bucket.id);

describe("quickAddChoices: the Buckets Quick Add offers, most likely first", () => {
	it("keeps the Plan's order for a new Household", () => {
		expect(ids(choose({}))).toEqual(["groceries", "eating", "gas", "pets", "coffee"]);
		expect(choose({}).every((c) => c.reason === "likely")).toBe(true);
	});

	it("puts the most used first, recent uses counting more", () => {
		const uses = [use("gas", "2026-06-01"), use("gas", "2026-06-02"), use("pets", "2026-09-14")];
		expect(ids(choose({ uses })).slice(0, 2)).toEqual(["pets", "gas"]);
	});

	it("counts a use near this time of day 1.5 times, wrapping round midnight", () => {
		const uses = [use("coffee", today, { hour: 23 }), use("eating", today, { hour: 12 })];
		expect(ids(choose({ uses, hour: 1 }))[0]).toBe("coffee");
		expect(ids(choose({ uses, hour: 12 }))[0]).toBe("eating");
		// Three hours away is no boost: a tie, so the Plan's order.
		expect(ids(choose({ uses, hour: 15 }))[0]).toBe("eating");
	});

	it("lets a daily habit beat a weekly one at its time of day", () => {
		const daily = ["09-15", "09-14", "09-13", "09-12"].map((d) =>
			use("groceries", `2026-${d}` as DayKey, { hour: 18 }),
		);
		const weekly = [use("coffee", today, { hour: 8 }), use("coffee", "2026-09-08", { hour: 8 })];
		expect(ids(choose({ uses: [...daily, ...weekly], hour: 8 }))[0]).toBe("groceries");
	});

	it("puts a suggested Bucket first", () => {
		const choices = choose({ suggested: "gas", uses: [use("pets")] });
		expect(ids(choices).slice(0, 2)).toEqual(["gas", "pets"]);
		expect(choices[0]?.reason).toBe("suggested");
	});

	it("ignores a suggestion that isn't one of these Buckets", () => {
		expect(ids(choose({ suggested: "someone-elses" }))[0]).toBe("groceries");
	});

	it("puts the Bucket a Rule files the note's merchant into first, after a suggestion", () => {
		const rules: Rule[] = [{ pattern: "costco", bucketId: "pets" }];
		const choices = choose({ rules, note: "COSTCO WHSE #0123", uses: [use("gas")] });
		expect(ids(choices).slice(0, 2)).toEqual(["pets", "gas"]);
		expect(choices[0]?.reason).toBe("rule");
		expect(ids(choose({ rules, note: "Costco", suggested: "eating" })).slice(0, 2)).toEqual([
			"eating",
			"pets",
		]);
	});

	it("lets a Parent's private Rule win over the Household's for the same merchant", () => {
		const rules: Rule[] = [
			{ pattern: "target", bucketId: "groceries" },
			{ pattern: "target", bucketId: "coffee", private: true },
		];
		expect(ids(choose({ rules, note: "Target" }))[0]).toBe("coffee");
	});

	it("passes over a Rule into a Commitment or a Bucket not offered", () => {
		const rules: Rule[] = [
			{ pattern: "netflix", bucketId: null, commitmentId: "streaming" },
			{ pattern: "costco", bucketId: "someone-elses" },
		];
		expect(choose({ rules, note: "Netflix" })[0]?.reason).toBe("likely");
		expect(choose({ rules, note: "Costco" })[0]?.reason).toBe("likely");
	});

	it("puts the Bucket the merchant was filed to most before next", () => {
		const uses = [
			use("gas", today, { merchant: "costco whse" }),
			use("groceries", "2026-09-10", { merchant: "costco whse" }),
			use("groceries", "2026-09-11", { merchant: "costco whse" }),
			use("eating", today),
			use("eating", today),
			use("eating", today),
		];
		const choices = choose({ uses, note: "Costco" });
		expect(ids(choices).slice(0, 2)).toEqual(["groceries", "eating"]);
		expect(choices[0]?.reason).toBe("merchant");
	});

	it("puts a Rule's Bucket before the merchant's past Bucket", () => {
		const uses = [use("groceries", today, { merchant: "costco" })];
		const rules: Rule[] = [{ pattern: "costco", bucketId: "pets" }];
		expect(ids(choose({ uses, rules, note: "costco" })).slice(0, 2)).toEqual(["pets", "groceries"]);
	});

	it("doesn't use the merchant with an empty note", () => {
		const uses = [use("gas", "2026-09-01", { merchant: "" }), use("pets")];
		expect(ids(choose({ uses, note: "  " }))[0]).toBe("pets");
	});

	it("offers each Bucket once", () => {
		const rules: Rule[] = [{ pattern: "costco", bucketId: "gas" }];
		const uses = [use("gas", today, { merchant: "costco" })];
		const choices = choose({ rules, uses, note: "costco", suggested: "gas" });
		expect(ids(choices)).toEqual(["gas", "groceries", "eating", "pets", "coffee"]);
	});
});

describe("matchBuckets: finding a Bucket by a few letters", () => {
	const names = (matches: { bucket: { name: string } }[]) => matches.map((m) => m.bucket.name);

	it("finds every Bucket for an empty search, in the order given", () => {
		expect(names(matchBuckets(" ", buckets))).toEqual(buckets.map((b) => b.name));
	});

	it("finds a name by the start of a word, any case", () => {
		expect(names(matchBuckets("gro", buckets))).toEqual(["Groceries"]);
		expect(names(matchBuckets("OUT", buckets))).toEqual(["Eating out"]);
	});

	it("finds words out of order", () => {
		expect(names(matchBuckets("sup pet", buckets))).toEqual(["Pet supplies"]);
	});

	it("puts word starts before matches inside a word", () => {
		const list = [{ id: "a", name: "Hogas" }, ...buckets];
		expect(names(matchBuckets("gas", list))).toEqual(["Gas", "Hogas"]);
	});

	it("finds a Bucket by a Rule's merchant, after name matches", () => {
		const rules: Rule[] = [
			{ pattern: "costco whse", bucketId: "groceries" },
			{ pattern: "chewy", bucketId: "pets" },
		];
		const matches = matchBuckets("cos", buckets, rules);
		expect(matches).toEqual([{ bucket: buckets[0], via: "rule", pattern: "costco whse" }]);
		const list = [...buckets, { id: "cosmetics", name: "Cosmetics" }];
		expect(names(matchBuckets("cos", list, rules))).toEqual(["Cosmetics", "Groceries"]);
	});

	it("finds nothing for letters nothing has", () => {
		expect(matchBuckets("zzz", buckets)).toEqual([]);
	});
});

describe("hourAt", () => {
	it("is the hour in the Household's time zone", () => {
		const instant = new Date("2026-09-15T02:30:00Z");
		expect(hourAt(instant, "UTC")).toBe(2);
		expect(hourAt(instant, "America/Los_Angeles")).toBe(19);
	});
});
