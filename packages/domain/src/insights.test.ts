import { describe, expect, it } from "vitest";
import {
	type DayKey,
	findInsights,
	type InsightInputs,
	type InsightPerk,
	type InsightSpend,
	type PlanCommitment,
	services,
} from "./index";

const asOf = "2026-09-28" as DayKey;

let ids = 0;
const spend = (
	note: string,
	dollars: number,
	date: string,
	extra: Partial<InsightSpend> = {},
): InsightSpend => ({
	id: `t${String(++ids).padStart(3, "0")}`,
	date: date as DayKey,
	amount: Math.round(dollars * 100),
	note,
	commitmentId: null,
	private: false,
	...extra,
});

const commitment = (
	id: string,
	name: string,
	dollars: number,
	cadence: PlanCommitment["cadence"] = "monthly",
): PlanCommitment => ({
	id,
	name,
	amount: Math.round(dollars * 100),
	cadence,
	dueDate: "2026-09-05" as DayKey,
});

const inputs = (fields: Partial<InsightInputs>): InsightInputs => ({
	spends: [],
	commitments: [],
	asOf,
	...fields,
});

const kinds = (found: ReturnType<typeof findInsights>) => found.map((i) => i.kind);

describe("services", () => {
	it("takes a merchant charging once a month, about the same, as a service", () => {
		const found = services(
			inputs({
				spends: [
					spend("NETFLIX.COM 866-579-7172 CA", 15.49, "2026-07-12"),
					spend("NETFLIX.COM 866-579-7172 CA", 15.49, "2026-08-12"),
					spend("NETFLIX.COM 866-579-7172 CA", 15.49, "2026-09-12"),
				],
			}),
		);
		expect(found).toMatchObject([{ key: "m:netflix ca", yearly: 1549 * 12 }]);
	});

	it("leaves out weekly shops, one-offs, and amounts all over the place", () => {
		const found = services(
			inputs({
				spends: [
					spend("COSTCO WHSE #0123", 140, "2026-08-02"),
					spend("COSTCO WHSE #0123", 150, "2026-08-09"),
					spend("COSTCO WHSE #0123", 145, "2026-09-02"),
					spend("Home Depot", 80, "2026-09-03"),
					spend("Amazon", 12, "2026-08-03"),
					spend("Amazon", 90, "2026-09-03"),
				],
			}),
		);
		expect(found).toEqual([]);
	});
});

describe("duplicate services", () => {
	it("finds two Commitments the model groups, worth the cheaper one a year", () => {
		const found = findInsights(
			inputs({
				commitments: [
					commitment("disney", "Disney+", 13.99),
					commitment("hulu", "Hulu bundle", 24.99),
				],
			}),
			[["c:disney", "c:hulu"]],
		);
		expect(found).toMatchObject([
			{
				kind: "duplicate-service",
				yearlyImpact: 1399 * 12,
				commitmentIds: ["disney", "hulu"],
				subjects: ["Disney+", "Hulu bundle"],
				fingerprint: "duplicate-service:c:disney,c:hulu",
				private: false,
			},
		]);
	});

	it("groups the same merchant spelled the same way without a model", () => {
		const found = findInsights(
			inputs({
				commitments: [commitment("a", "Spotify", 11.99), commitment("b", "SPOTIFY", 16.99)],
			}),
		);
		expect(kinds(found)).toEqual(["duplicate-service"]);
	});

	it("takes a merchant charging what a Commitment costs as that Commitment, not a second service", () => {
		const netflix = commitment("netflix", "Netflix", 15.49);
		const charges = ["2026-07-12", "2026-08-12", "2026-09-12"].map((d) =>
			spend("NETFLIX.COM", 15.49, d),
		);
		expect(findInsights(inputs({ commitments: [netflix], spends: charges }))).toEqual([]);
	});

	it("finds a merchant charging about what a Commitment costs in the months it's charged too", () => {
		const disney = commitment("disney", "Disney+ bundle", 19.99);
		const months = ["2026-07", "2026-08", "2026-09"];
		const own = months.map((m) => spend("Disney+", 19.99, `${m}-05`, { commitmentId: "disney" }));
		const hulu = months.map((m) => spend("Hulu", 18.99, `${m}-11`));
		const [found] = findInsights(inputs({ commitments: [disney], spends: [...own, ...hulu] }), [
			["c:disney", "m:hulu"],
		]);
		expect(found).toMatchObject({
			kind: "duplicate-service",
			yearlyImpact: 1899 * 12,
			commitmentIds: ["disney"],
		});
	});

	it("finds a Commitment and a merchant charging a different amount for the same service", () => {
		const netflix = commitment("netflix", "Netflix", 15.49);
		const charges = ["2026-07-12", "2026-08-12", "2026-09-12"].map((d) =>
			spend("NETFLIX.COM", 22.99, d),
		);
		const [found] = findInsights(inputs({ commitments: [netflix], spends: charges }));
		expect(found).toMatchObject({
			kind: "duplicate-service",
			yearlyImpact: 1549 * 12,
			commitmentIds: ["netflix"],
		});
		expect(found?.transactionIds).toEqual(charges.map((c) => c.id));
	});

	it("ignores groups naming services that don't exist", () => {
		const found = findInsights(inputs({ commitments: [commitment("a", "Disney+", 13.99)] }), [
			["c:a", "c:made-up"],
		]);
		expect(found).toEqual([]);
	});

	it("is private when it rests on the Viewer's own Personal Allowance", () => {
		const own = ["2026-08-03", "2026-09-03"].map((d) =>
			spend("Peacock", 7.99, d, { private: true }),
		);
		const [found] = findInsights(
			inputs({ commitments: [commitment("hulu", "Hulu", 17.99)], spends: own }),
			[["c:hulu", "m:peacock"]],
		);
		expect(found).toMatchObject({ kind: "duplicate-service", private: true });
	});
});

describe("duplicate charges", () => {
	it("finds the same amount at the same merchant a day apart", () => {
		const a = spend("BEST BUY #123", 249.99, "2026-09-20");
		const b = spend("BEST BUY #456", 249.99, "2026-09-21");
		const found = findInsights(inputs({ spends: [a, b] }));
		expect(found).toMatchObject([
			{ kind: "duplicate-charge", yearlyImpact: 24999, transactionIds: [a.id, b.id] },
		]);
	});

	it("leaves out small amounts, other amounts, and charges days apart", () => {
		const found = findInsights(
			inputs({
				spends: [
					spend("Starbucks", 5.25, "2026-09-20"),
					spend("Starbucks", 5.25, "2026-09-20"),
					spend("Target", 40, "2026-09-20"),
					spend("Target", 41, "2026-09-20"),
					spend("Shell", 50, "2026-09-10"),
					spend("Shell", 50, "2026-09-20"),
				],
			}),
		);
		expect(found).toEqual([]);
	});
});

describe("price increases", () => {
	it("finds a Commitment's charge above its steady amount, a year's worth", () => {
		const spends = [
			spend("Netflix", 15.49, "2026-06-05", { commitmentId: "n" }),
			spend("Netflix", 15.49, "2026-07-05", { commitmentId: "n" }),
			spend("Netflix", 15.49, "2026-08-05", { commitmentId: "n" }),
			spend("Netflix", 17.99, "2026-09-05", { commitmentId: "n" }),
		];
		const found = findInsights(
			inputs({ commitments: [commitment("n", "Netflix", 15.49)], spends }),
		);
		expect(found).toMatchObject([
			{ kind: "price-increase", yearlyImpact: 250 * 12, fingerprint: "price-increase:c:n:1799" },
		]);
	});

	it("leaves out bills that vary every month", () => {
		const spends = [45, 61, 52, 70].map((dollars, i) =>
			spend("City Power", dollars, `2026-0${6 + i}-05`, { commitmentId: "power" }),
		);
		const found = findInsights(
			inputs({ commitments: [commitment("power", "City Power", 55)], spends }),
		);
		expect(kinds(found)).not.toContain("price-increase");
	});
});

describe("unused Commitments", () => {
	it("finds a monthly Commitment charged before but not for over two months", () => {
		const last = spend("Gym", 40, "2026-06-10", { commitmentId: "gym" });
		const found = findInsights(
			inputs({ commitments: [commitment("gym", "Gym", 40)], spends: [last] }),
		);
		expect(found).toMatchObject([
			{
				kind: "unused",
				yearlyImpact: 4000 * 12,
				transactionIds: [last.id],
				commitmentIds: ["gym"],
			},
		]);
	});

	it("leaves out Commitments never charged, charged lately, or paid once a year", () => {
		const found = findInsights(
			inputs({
				commitments: [
					commitment("never", "Never charged", 10),
					commitment("recent", "Recent", 10),
					commitment("yearly", "Insurance", 900, "annual"),
				],
				spends: [
					spend("Recent", 10, "2026-09-10", { commitmentId: "recent" }),
					spend("Insurance", 900, "2025-11-10", { commitmentId: "yearly" }),
				],
			}),
		);
		expect(found).toEqual([]);
	});
});

it("orders Insights by yearly impact", () => {
	const found = findInsights(
		inputs({
			commitments: [commitment("a", "Hulu", 17.99), commitment("b", "hulu", 7.99)],
			spends: [spend("Best Buy", 300, "2026-09-20"), spend("Best Buy", 300, "2026-09-20")],
		}),
	);
	expect(kinds(found)).toEqual(["duplicate-charge", "duplicate-service"]);
});

describe("Perk Overlaps", () => {
	const netflixPerk: InsightPerk = {
		id: "perk-netflix",
		sourceId: "src-tmobile",
		sourceName: "T-Mobile",
		key: "service:netflix",
		name: "Netflix Standard with ads",
		kind: "service",
		matches: "Netflix",
		private: false,
	};
	const precheckPerk: InsightPerk = {
		id: "perk-precheck",
		sourceId: "src-sapphire",
		sourceName: "Chase Sapphire",
		key: "cost:tsa precheck",
		name: "TSA PreCheck fee credit",
		kind: "cost",
		matches: "TSA PreCheck",
		private: false,
	};

	it("finds a paid service a Perk already includes, worth the service's year", () => {
		const found = findInsights(
			inputs({
				commitments: [
					commitment("c-netflix", "Netflix", 15.49),
					commitment("c-tm", "T-Mobile", 140),
				],
				spends: [
					spend("Netflix", 15.49, "2026-09-05", { commitmentId: "c-netflix" }),
					spend("T-Mobile", 140, "2026-09-05", { commitmentId: "c-tm" }),
				],
				perks: [netflixPerk],
			}),
		).filter((i) => i.kind === "perk-service");
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			fingerprint: "perk-service:src-tmobile:service:netflix:c:c-netflix",
			yearlyImpact: 1549 * 12,
			commitmentIds: ["c-netflix"],
			perkIds: ["perk-netflix"],
			private: false,
			title: "Netflix may come with T-Mobile",
		});
	});

	it("never takes the Perk Source's own bill, or a name that only starts the same, as included", () => {
		const found = findInsights(
			inputs({
				commitments: [commitment("c-tm", "T-Mobile Netflix bundle", 140)],
				spends: [
					spend("NETFLIXY GAMES", 5, "2026-08-10"),
					spend("NETFLIXY GAMES", 5, "2026-09-10"),
				],
				perks: [netflixPerk],
			}),
		);
		expect(kinds(found)).not.toContain("perk-service");
	});

	it("finds a cost a Perk covers paid in the last year, once, with its charges", () => {
		const found = findInsights(
			inputs({
				spends: [
					spend("TSA PRECHECK ENROLLMENT", 78, "2026-03-02"),
					spend("TSA PRECHECK ENROLLMENT", 78, "2025-08-01"),
				],
				perks: [precheckPerk],
			}),
		);
		expect(found).toHaveLength(1);
		expect(found[0]).toMatchObject({
			kind: "perk-cost",
			yearlyImpact: 7800,
			perkIds: ["perk-precheck"],
			title: "Chase Sapphire may cover TSA PreCheck",
		});
		expect(found[0]?.transactionIds).toHaveLength(1);
	});

	it("keeps an Insight resting on the Viewer's own Perk Source theirs alone", () => {
		const found = findInsights(
			inputs({
				spends: [spend("TSA PreCheck", 78, "2026-09-01")],
				perks: [{ ...precheckPerk, private: true }],
			}),
		);
		expect(found[0]?.private).toBe(true);
	});
});
