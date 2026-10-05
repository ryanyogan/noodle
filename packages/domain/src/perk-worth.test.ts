import { describe, expect, it } from "vitest";
import {
	CARD_ISSUERS,
	cardCatalogKey,
	cardIssuerFor,
	cardProductIn,
	cardProductNamed,
	onIssuerSite,
	sameSite,
} from "./card-issuers";
import type { DayKey } from "./month";
import { monthsBefore, type WorthPerk, type WorthSpend, worthUsing } from "./perk-worth";
import { byPerkValue, earnRate, perkCategory, perksOnPage } from "./perks";

const day = (text: string) => text as DayKey;
let n = 0;
const spend = (date: string, note: string, amount: number, accountId = "card"): WorthSpend => ({
	id: `t${++n}`,
	date: day(date),
	amount,
	note,
	accountId,
});
const perk = (over: Partial<WorthPerk>): WorthPerk => ({
	id: "p1",
	name: "Uber Cash",
	kind: "cost",
	matches: "Uber",
	quote: "$15 in Uber Cash every month",
	valueCents: 1500,
	renews: "monthly",
	usedOn: [],
	...over,
});
const accountNames = { card: "CREDIT CARD", checking: "Chase Checking" };
const asOf = day("2026-10-05");

describe("card issuers", () => {
	it("knows an issuer from the institution, else from the Account's name", () => {
		expect(cardIssuerFor("Chase", "CREDIT CARD")?.key).toBe("chase");
		expect(cardIssuerFor(null, "Amex Gold")?.key).toBe("amex");
		expect(cardIssuerFor("First Local Credit Union", "Visa")).toBeUndefined();
	});

	it("tells a card from an Account's name only when the name says so", () => {
		const chase = CARD_ISSUERS.find((i) => i.key === "chase");
		if (!chase) throw new Error("no Chase");
		expect(cardProductIn(chase, "CREDIT CARD")).toBeUndefined();
		expect(cardProductIn(chase, "Chase Freedom Unlimited")?.name).toBe("Chase Freedom Unlimited");
		expect(cardProductIn(chase, "SAPPHIRE PREFERRED")?.name).toBe("Chase Sapphire Preferred");
		expect(cardProductNamed(chase, "chase sapphire reserve")?.name).toBe("Chase Sapphire Reserve");
		const product = cardProductNamed(chase, "Chase Sapphire Reserve");
		expect(product && cardCatalogKey(chase, product)).toBe("card:chase:chase-sapphire-reserve");
	});

	it("keeps each issuer to a dozen cards, each page on its own site", () => {
		for (const issuer of CARD_ISSUERS) {
			expect(issuer.products.length).toBeLessThanOrEqual(12);
			for (const product of issuer.products) {
				if (product.page) expect(onIssuerSite(product.page, [issuer]), product.page).toBe(true);
			}
		}
		expect(onIssuerSite("https://creditcards.chase.com/x")).toBe(true);
		expect(onIssuerSite("https://chase.com.evil.example/x")).toBe(false);
		expect(onIssuerSite("http://www.chase.com/x")).toBe(false);
		expect(sameSite("https://creditcards.chase.com/a", "https://www.chase.com/b")).toBe(true);
		expect(sameSite("https://creditcards.chase.com/a", "https://example.com/b")).toBe(false);
	});
});

describe("reading what a card earns", () => {
	it("reads the rate from the page's words", () => {
		expect(earnRate("Earn 4X points at restaurants")).toBe("4x");
		expect(earnRate("3% cash back at U.S. supermarkets")).toBe("3%");
		expect(earnRate("5 points per dollar on flights")).toBe("5x");
		expect(earnRate("Earn rewards on dining")).toBeNull();
	});

	it("drops an earning Perk whose quote states no rate", () => {
		const page = "Earn 4X points at restaurants worldwide. Earn rewards on groceries too.";
		const found = perksOnPage(
			[
				{
					name: "Dining",
					kind: "earn",
					matches: "Dining",
					tiers: [],
					quote: "Earn 4X points at restaurants",
				},
				{
					name: "Groceries",
					kind: "earn",
					matches: "Groceries",
					tiers: [],
					quote: "Earn rewards on groceries",
				},
			],
			page,
		);
		expect(found.map((p) => p.matches)).toEqual(["Dining"]);
	});

	it("orders Perks by yearly value, then by sort", () => {
		const perks = [
			{ kind: "service" as const, name: "DashPass", matches: "DashPass", valueCents: null },
			{ kind: "earn" as const, name: "Dining", matches: "Dining", valueCents: null },
			{ kind: "cost" as const, name: "Uber Cash", matches: "Uber", valueCents: 1500 },
			{ kind: "cost" as const, name: "Travel credit", matches: "Travel", valueCents: 30000 },
			{
				kind: "cost" as const,
				name: "Trip delay insurance",
				matches: "Trip delay",
				valueCents: null,
			},
		];
		expect(perks.map(perkCategory)).toEqual([
			"membership",
			"earn",
			"credit",
			"credit",
			"protection",
		]);
		const yearly = (p: (typeof perks)[number]) => (p.name === "Uber Cash" ? 18000 : p.valueCents);
		expect(byPerkValue(perks, yearly).map((p) => p.name)).toEqual([
			"Travel credit",
			"Uber Cash",
			"Dining",
			"Trip delay insurance",
			"DashPass",
		]);
	});
});

describe("worth using", () => {
	it("lists the whole months before today, latest first", () => {
		expect(monthsBefore(day("2026-02-10"), 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
	});

	it("counts the months a monthly credit went unused, only since the card's first charge", () => {
		const spends = [
			spend("2026-06-03", "HARDWARE STORE", 4000),
			spend("2026-07-10", "UBER TRIP", 2200),
			spend("2026-09-12", "UBER EATS", 1800),
		];
		const [line] = worthUsing({
			cardAccountId: "card",
			perks: [perk({})],
			spends,
			accountNames,
			asOf,
		});
		// June to September: used in July and September.
		expect(line?.text).toBe(
			"You didn’t use the $15 Uber Cash in 2 of the last 4 months (about $30).",
		);
		expect(line?.evidence.map((e) => e.note)).toEqual(["UBER EATS", "UBER TRIP"]);
	});

	it("counts a month marked used by hand, and says nothing without the card's Account", () => {
		const spends = [spend("2026-08-03", "HARDWARE STORE", 4000)];
		const used = perk({ usedOn: [day("2026-08-20"), day("2026-09-20")] });
		expect(
			worthUsing({ cardAccountId: "card", perks: [used], spends, accountNames, asOf }),
		).toEqual([]);
		expect(
			worthUsing({ cardAccountId: null, perks: [perk({})], spends, accountNames, asOf }),
		).toEqual([]);
	});

	it("says a yearly credit went unused only with a full year of the card's charges", () => {
		const airline = perk({
			id: "p2",
			name: "Airline fee credit",
			matches: "Airline fee",
			valueCents: 20000,
			renews: "yearly",
		});
		const short = [spend("2026-05-03", "HARDWARE STORE", 4000)];
		expect(
			worthUsing({ cardAccountId: "card", perks: [airline], spends: short, accountNames, asOf }),
		).toEqual([]);
		const year = [spend("2025-09-03", "HARDWARE STORE", 4000)];
		expect(
			worthUsing({ cardAccountId: "card", perks: [airline], spends: year, accountNames, asOf })[0]
				?.text,
		).toBe("You haven’t used the $200 Airline fee credit in the last 12 months.");
	});

	it("points at a charge on another Account the card pays back, with the charge", () => {
		const doordash = perk({
			id: "p3",
			name: "DoorDash credit",
			matches: "DoorDash",
			valueCents: 1000,
		});
		const spends = [
			spend("2026-09-20", "DOORDASH*THAI", 3100, "checking"),
			spend("2026-01-20", "DOORDASH*OLD", 3100, "checking"),
		];
		const lines = worthUsing({
			cardAccountId: "card",
			perks: [doordash],
			spends,
			accountNames,
			asOf,
		});
		expect(lines.map((l) => l.text)).toEqual([
			"DoorDash on Chase Checking: this card pays back up to $10 a month.",
		]);
		expect(lines[0]?.evidence).toEqual([
			{ date: "2026-09-20", note: "DOORDASH*THAI", amountCents: 3100, account: "Chase Checking" },
		]);
		const dashpass = perk({
			id: "p4",
			name: "DashPass",
			kind: "service",
			matches: "DashPass",
			valueCents: null,
			renews: null,
		});
		expect(
			worthUsing({
				cardAccountId: "card",
				perks: [dashpass],
				spends: [spend("2026-09-01", "DASHPASS MONTHLY", 999, "checking")],
				accountNames,
				asOf,
			})[0]?.text,
		).toBe("DashPass on Chase Checking: DashPass comes with this card.");
	});

	it("matches the kinds of purchases to what the card earns, most valuable first", () => {
		const groceries = perk({
			id: "g",
			name: "Groceries",
			kind: "earn",
			matches: "Groceries",
			quote: "4X points at U.S. supermarkets",
			valueCents: null,
			renews: null,
		});
		const gas = perk({
			id: "s",
			name: "Gas",
			kind: "earn",
			matches: "Gas",
			quote: "3% back at gas stations",
			valueCents: null,
			renews: null,
		});
		const spends = [
			spend("2026-08-02", "KROGER #123", 90000, "checking"),
			spend("2026-09-02", "WHOLEFDS MKT", 90000, "checking"),
			spend("2026-09-22", "TRADER JOE'S", 90000),
			spend("2026-09-10", "SHELL OIL 5544", 3000),
			spend("2026-03-10", "KROGER #123", 90000),
		];
		const lines = worthUsing({
			cardAccountId: "card",
			perks: [gas, groceries],
			spends,
			accountNames,
			asOf,
		});
		expect(lines.map((l) => l.text)).toEqual([
			"You spend about $900 a month on groceries; this card earns 4x there. About $600 of it goes on other Accounts.",
		]);
	});
});
