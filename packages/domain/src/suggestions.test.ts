import { describe, expect, it } from "vitest";
import {
	addDays,
	billKindOf,
	type CommitmentNow,
	cadenceOf,
	changedALot,
	type DayKey,
	type HandFiling,
	isMoneyMovement,
	looksLikeCardPayment,
	type SpendLine,
	spotBuckets,
	spotCommitments,
	spotRules,
} from "./index";

const today = "2026-10-03" as DayKey;
let n = 0;
const line = (
	daysAgo: number,
	amountCents: number,
	merchant: string,
	more: Partial<SpendLine> = {},
): SpendLine => ({
	id: `t${n++}`,
	date: addDays(today, -daysAgo),
	amountCents,
	merchant,
	owner: null,
	commitmentId: null,
	homeless: true,
	...more,
});

describe("spotBuckets", () => {
	const petco = [80, 72, 60, 45, 33, 20, 12, 5, 2].map((ago) => line(ago, 4_000, "Petco"));

	it("suggests a Bucket for steady, sizeable spending without a home, by kind", () => {
		const [idea] = spotBuckets([...petco, line(40, 2_000, "Chewy")], today, ["Groceries"]);
		expect(idea).toMatchObject({ kind: "new-bucket", name: "Pets", amountCents: 13_000 });
		expect(idea?.evidence.count).toBe(10);
		expect(idea?.evidence.months).toBeGreaterThanOrEqual(3);
	});

	it("names a merchant of no known kind for itself", () => {
		const lines = [85, 60, 30, 3].map((ago) => line(ago, 5_000, "Secret Hobby Shop"));
		expect(spotBuckets(lines, today, [])[0]?.name).toBe("Secret Hobby Shop");
	});

	it("skips spending that's too small, too few, bunched in one month, filed, or already has a Bucket", () => {
		expect(
			spotBuckets(
				petco.map((l) => ({ ...l, amountCents: 1_000 })),
				today,
				[],
			),
		).toEqual([]);
		expect(spotBuckets(petco.slice(0, 3), today, [])).toEqual([]);
		const bunched = [
			line(85, 1_000, "Petco"),
			line(60, 1_000, "Petco"),
			...[10, 11, 12, 13].map((a) => line(a, 9_000, "Petco")),
		];
		expect(spotBuckets(bunched, today, [])).toEqual([]);
		expect(
			spotBuckets(
				petco.map((l) => ({ ...l, homeless: false })),
				today,
				[],
			),
		).toEqual([]);
		expect(spotBuckets(petco, today, ["pets"])).toEqual([]);
	});

	it("never mixes a Parent's Personal Allowance with the Household's spending", () => {
		const mine = petco.map((l) => ({ ...l, owner: "alex" }));
		const ideas = spotBuckets(mine, today, []);
		expect(ideas.map((i) => i.owner)).toEqual(["alex"]);
		const half = petco.map((l, i) => ({ ...l, owner: i % 2 ? "alex" : null }));
		expect(spotBuckets(half, today, []).every((i) => i.evidence.transactionIds.length < 9)).toBe(
			true,
		);
	});
});

describe("cadenceOf", () => {
	const dates = (...ago: number[]) => ago.map((a) => addDays(today, -a));
	it("reads monthly, biweekly and annual runs, and nothing from a noisy one", () => {
		expect(cadenceOf(dates(92, 61, 31, 1))).toBe("monthly");
		expect(cadenceOf(dates(42, 28, 14, 0))).toBe("biweekly");
		expect(cadenceOf(dates(730, 365, 0))).toBe("annual");
		expect(cadenceOf(dates(60, 50, 10, 3))).toBeNull();
		expect(cadenceOf(dates(21, 14, 7, 0))).toBeNull();
	});
});

describe("spotCommitments", () => {
	const gym = [92, 61, 31, 1].map((ago, i) => line(ago, 4_999 + (i % 2) * 100, "Planet Fitness"));

	it("suggests a Commitment for steady recurring charges, with its terms", () => {
		const [idea] = spotCommitments(gym, [], today);
		expect(idea).toMatchObject({
			kind: "new-commitment",
			name: "Planet Fitness",
			cadence: "monthly",
		});
		expect(idea?.kind === "new-commitment" && idea.dueDate).toBe("2026-11-02");
		expect(idea?.evidence.count).toBe(4);
	});

	it("takes 2 charges for annual, 3 otherwise", () => {
		expect(
			spotCommitments(
				[line(366, 120_000, "State Farm"), line(1, 120_000, "State Farm")],
				[],
				today,
			)[0],
		).toMatchObject({ cadence: "annual" });
		expect(spotCommitments(gym.slice(2), [], today)).toEqual([]);
	});

	it("skips amounts that wander, stopped charges, and what's a Commitment already", () => {
		const wander = [92, 61, 31, 1].map((ago, i) => line(ago, 3_000 + i * 1_500, "Geico"));
		expect(spotCommitments(wander, [], today)).toEqual([]);
		const stopped = [152, 121, 91, 60].map((ago) => line(ago, 5_000, "Hulu"));
		expect(spotCommitments(stopped, [], today)).toEqual([]);
		const paid = gym.map((l) => ({ ...l, commitmentId: "gym" }));
		expect(spotCommitments(paid, [], today)).toEqual([]);
		const named: CommitmentNow = {
			id: "c",
			name: "planet fitness",
			amountCents: 5_000,
			cadence: "monthly",
			dueDate: today,
		};
		expect(spotCommitments(gym, [named], today).filter((i) => i.kind === "new-commitment")).toEqual(
			[],
		);
	});

	it("flags a Commitment whose charges now differ from its amount", () => {
		const netflix: CommitmentNow = {
			id: "nf",
			name: "Netflix",
			amountCents: 1_549,
			cadence: "monthly",
			dueDate: "2026-09-05" as DayKey,
		};
		const charges = [58, 28].map((ago) =>
			line(ago, 1_799, "Netflix", { commitmentId: "nf", homeless: false }),
		);
		expect(spotCommitments(charges, [netflix], today)).toEqual([
			expect.objectContaining({
				kind: "commitment-amount",
				commitmentId: "nf",
				fromCents: 1_549,
				amountCents: 1_799,
			}),
		]);
		const same = charges.map((l) => ({ ...l, amountCents: 1_549 }));
		expect(spotCommitments(same, [netflix], today)).toEqual([]);
		const mine = charges.map((l) => ({ ...l, owner: "alex" }));
		expect(spotCommitments(mine, [netflix], today)).toEqual([]);
	});
});

describe("spotCommitments: real bills only (#76)", () => {
	const on = (dates: string[], cents: number | number[], merchant: string) =>
		dates.map((date, i) =>
			line(0, Array.isArray(cents) ? (cents[i] as number) : cents, merchant, {
				date: date as DayKey,
			}),
		);
	const monthly = (day: string) => ["07", "08", "09"].map((m) => `2026-${m}-${day}`);
	const names = (lines: SpendLine[], commitments: CommitmentNow[] = [], buckets: string[] = []) =>
		spotCommitments(lines, commitments, today, buckets).map((i) => i.name);

	it("never suggests fast food, coffee, groceries, fuel or small shop spending", () => {
		const mcdonalds = [70, 56, 42, 28, 14, 0].map((ago) => line(ago, 1_100, "McDonald's"));
		const starbucks = [35, 28, 21, 14, 7, 0].map((ago) => line(ago, 650, "Starbucks"));
		const groceries = on(monthly("10"), 15_000, "Trader Joe's");
		const fuel = on(monthly("11"), 6_000, "Shell");
		const shop = on(monthly("12"), 4_000, "Target");
		expect(names([...mcdonalds, ...starbucks, ...groceries, ...fuel, ...shop])).toEqual([]);
	});

	it("suggests rent, a car loan, a varying electric bill, a phone bill and Netflix, each with why", () => {
		const ideas = spotCommitments(
			[
				...on(
					["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"],
					240_000,
					"Oakwood Apartments",
				),
				...on(
					["2026-06-15", "2026-07-15", "2026-08-15", "2026-09-15"],
					41_250,
					"Toyota Financial Services",
				),
				...on(
					["2026-06-20", "2026-07-21", "2026-08-19", "2026-09-20"],
					[9_210, 16_430, 18_175, 12_840],
					"PG&E",
				),
				...on(monthly("12"), 8_500, "Verizon Wireless"),
				...on(monthly("05"), 1_549, "Netflix"),
			],
			[],
			today,
		);
		const why = Object.fromEntries(
			ideas.map((i) => [i.name, i.kind === "new-commitment" ? [i.amountCents, i.reason] : []]),
		);
		expect(why).toEqual({
			"Oakwood Apartments": [240_000, "Oakwood Apartments, $2,400 on the 1st, 4 months running"],
			"Toyota Financial Services": [
				41_250,
				"Toyota Financial Services, $412.50 on the 15th, 4 months running",
			],
			"PG&E": [18_175, "PG&E, up to $181.75 on the 20th, 4 months running"],
			"Verizon Wireless": [8_500, "Verizon Wireless, $85 on the 12th, 3 months running"],
			Netflix: [1_549, "Netflix, $15.49 on the 5th, 3 months running"],
		});
	});

	it("suggests an annual insurance premium and a biweekly loan, not a biweekly subscription", () => {
		const insurance = on(["2025-09-15", "2026-09-15"], 120_000, "State Farm");
		const loan = [56, 42, 28, 14, 0].map((ago) => line(ago, 21_000, "Honda Financial"));
		const hulu = [56, 42, 28, 14, 0].map((ago) => line(ago, 2_000, "Hulu"));
		const ideas = spotCommitments([...insurance, ...loan, ...hulu], [], today);
		expect(ideas.map((i) => [i.name, i.cadence, i.kind === "new-commitment" && i.reason])).toEqual([
			["State Farm", "annual", "State Farm, $1,200 a year in September, 2 years running"],
			["Honda Financial", "biweekly", "Honda Financial, $210 every two weeks, 5 times running"],
		]);
	});

	it("wants a stable due day", () => {
		const drifting = on(
			["2026-06-10", "2026-07-06", "2026-08-09", "2026-09-04", "2026-10-02"],
			240_000,
			"Oakwood Apartments",
		);
		expect(names(drifting)).toEqual([]);
	});

	it("holds a payee of unknown kind to a bigger amount and more charges", () => {
		const four = ["06", "07", "08", "09"].map((m) => `2026-${m}-08`);
		expect(names(on(four, 2_500, "Secret Hobby Shop"))).toEqual([]);
		expect(names(on(four.slice(1), 30_000, "Acme Holdings"))).toEqual([]);
		expect(names(on(four, 30_000, "Acme Holdings"))).toEqual(["Acme Holdings"]);
	});

	it("skips a payee the Plan has as a Commitment or a Bucket, by a near name", () => {
		const verizon: CommitmentNow = {
			id: "v",
			name: "Verizon",
			amountCents: 8_500,
			cadence: "monthly",
			dueDate: today,
		};
		const phone = on(monthly("12"), 8_500, "Verizon Wireless");
		expect(names(phone, [verizon]).length).toBe(0);
		expect(names(on(monthly("05"), 1_549, "NETFLIX.COM"), [], ["Netflix"])).toEqual([]);
		expect(names(phone, [], ["Groceries", "Phone"])).toEqual(["Verizon Wireless"]);
	});

	it("tells kinds of bill from day-to-day spending", () => {
		expect(billKindOf("McDonald's")).toBeNull();
		expect(billKindOf("Costco")).toBeNull();
		expect(billKindOf("Online Payment")).toBeNull();
		expect(billKindOf("Xfinity")).toBe("telecom");
		expect(billKindOf("Bright Horizons")).toBe("childcare");
		expect(billKindOf("Amazon Prime")).toBe("subscription");
		expect(billKindOf("Acme Holdings")).toBe("unknown");
	});
});

describe("changedALot", () => {
	const before = { count: 4, amountCents: 10_000, months: 3, transactionIds: [] };
	it("is a 30% move in the amount or twice the charges", () => {
		expect(changedALot(before, { ...before, amountCents: 12_000, count: 6 })).toBe(false);
		expect(changedALot(before, { ...before, amountCents: 13_000 })).toBe(true);
		expect(changedALot(before, { ...before, amountCents: 7_000 })).toBe(true);
		expect(changedALot(before, { ...before, count: 8 })).toBe(true);
	});
});

const filed = (
	id: string,
	date: string,
	bucketId = "groceries",
	owner: string | null = null,
	merchant = "Costco",
): HandFiling => ({
	id,
	date: date as DayKey,
	merchant,
	bucketId,
	bucketName: bucketId === "groceries" ? "Groceries" : bucketId,
	owner,
});

describe("spotRules", () => {
	const four = [
		filed("a", "2026-07-02"),
		filed("b", "2026-08-03"),
		filed("c", "2026-09-01"),
		filed("d", "2026-09-20"),
	];

	it("offers a Rule after the same merchant went into the same Bucket 3 or more times", () => {
		const [idea, ...rest] = spotRules(four, []);
		expect(rest).toEqual([]);
		expect(idea).toMatchObject({
			kind: "rule",
			owner: null,
			name: "Costco",
			merchant: "costco",
			bucketId: "groceries",
			bucketName: "Groceries",
			evidence: { count: 4, months: 3 },
		});
	});

	it("waits for the third time, and for a clear favourite Bucket", () => {
		expect(spotRules(four.slice(0, 2), [])).toEqual([]);
		const split = [
			...four.slice(0, 3),
			...["e", "f", "g"].map((id) => filed(id, "2026-09-25", "household")),
		];
		expect(spotRules(split, [])).toEqual([]);
	});

	it("offers nothing when a Rule already covers the merchant", () => {
		expect(spotRules(four, [{ pattern: "costco", bucketId: "household", owner: null }])).toEqual(
			[],
		);
	});

	it("keeps a Personal Allowance's filings to its Parent (ADR-0003)", () => {
		const mine = four.map((f) => ({ ...f, bucketId: "alex-fun", owner: "alex" }));
		const ideas = spotRules([...mine, ...four.slice(0, 2)], []);
		expect(ideas).toHaveLength(1);
		expect(ideas[0]).toMatchObject({ owner: "alex", bucketId: "alex-fun" });
		// The other Parent's private Rule covers nothing for this one, nor for the Household.
		expect(
			spotRules(four, [{ pattern: "costco", bucketId: "sam-fun", owner: "sam" }]),
		).toHaveLength(1);
		expect(spotRules(mine, [{ pattern: "costco", bucketId: "alex-fun", owner: "alex" }])).toEqual(
			[],
		);
	});
});

describe("isMoneyMovement", () => {
	it("tells card payments and transfers from a merchant", () => {
		for (const name of [
			"Online Payment",
			"Autopay Payment",
			"Payment Thank You",
			"Transfer to Savings",
		])
			expect(isMoneyMovement(name)).toBe(true);
		for (const name of ["Planet Fitness", "Spotify", "Paypal Netflix"])
			expect(isMoneyMovement(name)).toBe(false);
	});

	it("never takes a payment to a credit card for a bill, whatever the bank calls it (#91)", () => {
		for (const name of [
			"Chase Credit Crd Autopay",
			"Amex Epayment",
			"Citi Card Online Payment",
			"Capital One Crcardpmt",
			"Discover E-Payment",
			"Barclaycard Us Creditcard",
		]) {
			expect(isMoneyMovement(name)).toBe(true);
			expect(billKindOf(name)).toBeNull();
		}
		// A loan's regular payment is a real bill: it can still be suggested as a Commitment.
		for (const name of ["Honda Financial Loan Payment", "Chase Mortgage Payment"])
			expect(looksLikeCardPayment(name)).toBe(false);
	});
});
