import { CARD_ISSUERS, PERK_SOURCE_CATALOG } from "@noodle/domain";
import { describe, expect, test } from "vitest";
import {
	CHOICES_SHOWN,
	cardChoices,
	choiceNamed,
	groupPerks,
	knownSources,
	searchChoices,
	sourceHeadline,
	sourceState,
	sourceStateLabel,
} from "./perks-view";

describe("knownSources", () => {
	const known = knownSources();

	test("lists every issuer's cards with the issuer in the name, and its page", () => {
		const products = CARD_ISSUERS.flatMap((issuer) => issuer.products);
		expect(known.filter((c) => c.key.startsWith("card:"))).toHaveLength(products.length);
		expect(choiceNamed(known, "American Express Platinum Card")?.detail).toBe(
			"American Express · Credit card",
		);
		const sapphire = choiceNamed(known, "chase sapphire preferred");
		expect(sapphire?.kind).toBe("credit-card");
		expect(sapphire?.pageUrl).toMatch(/^https:\/\/creditcards\.chase\.com\//);
		expect(known.some((c) => c.name === "Chase Chase Sapphire Preferred")).toBe(false);
	});

	test("adds the catalog's phone plans and memberships, each name once", () => {
		const phone = PERK_SOURCE_CATALOG.find((entry) => entry.kind === "phone-plan");
		expect(phone && choiceNamed(known, phone.name)?.kind).toBe("phone-plan");
		const names = known.map((c) => c.name.toLowerCase());
		expect(new Set(names).size).toBe(names.length);
		expect(new Set(known.map((c) => c.key)).size).toBe(known.length);
	});
});

describe("searchChoices", () => {
	const known = knownSources();

	test("nothing typed shows the first few", () => {
		expect(searchChoices(known, "  ")).toEqual(known.slice(0, CHOICES_SHOWN));
	});

	test("every word typed must start a word of the name or its detail", () => {
		const found = searchChoices(known, "sapph res");
		expect(found.map((c) => c.name)).toEqual(["Chase Sapphire Reserve"]);
		expect(searchChoices(known, "zzzz")).toEqual([]);
		expect(searchChoices(known, "phone").every((c) => c.kind === "phone-plan")).toBe(true);
	});

	test("names starting with what was typed come first, and no more than the limit", () => {
		const found = searchChoices(known, "capital one", 3);
		expect(found).toHaveLength(3);
		expect(found[0]?.name.toLowerCase().startsWith("capital one")).toBe(true);
	});
});

describe("cardChoices", () => {
	test("the server's names, when it sent some", () => {
		expect(cardChoices("Chase", ["Chase Freedom Flex"]).map((c) => c.name)).toEqual([
			"Chase Freedom Flex",
		]);
	});

	test("the issuer's own cards by the names the server keeps, else every card", () => {
		const amex = CARD_ISSUERS.find((issuer) => issuer.key === "amex");
		expect(cardChoices("American Express").map((c) => c.name)).toEqual(
			amex?.products.map((p) => p.name),
		);
		const all = cardChoices(null);
		expect(all).toHaveLength(CARD_ISSUERS.flatMap((issuer) => issuer.products).length);
		expect(cardChoices("A bank nobody knows")).toEqual(all);
	});
});

describe("where a Perk Source stands", () => {
	const source = (research: string, needsProduct = false) => ({
		research,
		card: needsProduct ? { needsProduct } : null,
	});

	test("its state", () => {
		expect(sourceState(source("done"))).toBeNull();
		expect(sourceState(source("researching"))).toBe("reading");
		expect(sourceState(source("needs-plan"))).toBe("needs-answer");
		expect(sourceState(source("needs-link"))).toBe("needs-answer");
		expect(sourceState(source("unreadable"))).toBe("unreadable");
		// The question comes before anything research says.
		expect(sourceState(source("needs-link", true))).toBe("needs-answer");
		expect(sourceStateLabel.reading).toBeNull();
	});

	test("its one line", () => {
		const none = { names: [], toUse: 0 };
		expect(sourceHeadline(source("needs-link", true), none)).toBe("Which card is this?");
		expect(sourceHeadline(source("researching"), none)).toBe("Reading its perks…");
		expect(sourceHeadline(source("needs-plan"), none)).toBe("Which plan is it?");
		expect(sourceHeadline(source("done"), none)).toBe("No perks found on its page");
		expect(sourceHeadline(source("done"), { names: ["Uber Cash", "DashPass"], toUse: 2 })).toBe(
			"2 worth using now · 2 perks",
		);
		expect(sourceHeadline(source("done"), { names: ["Uber Cash", "DashPass"], toUse: 0 })).toBe(
			"2 perks · best: Uber Cash",
		);
		expect(sourceHeadline(source("done"), { names: ["DashPass"], toUse: 0 })).toBe("DashPass");
	});
});

describe("groupPerks", () => {
	const perk = (name: string, kind: "service" | "cost" | "earn", valueCents: number | null) => ({
		name,
		kind,
		matches: name,
		valueCents,
	});

	test("a few Perks are one group with no heading", () => {
		const few = [perk("Uber Cash", "cost", 1500), perk("DashPass", "service", null)];
		expect(groupPerks(few)).toEqual([{ category: null, perks: few }]);
		expect(groupPerks([])).toEqual([]);
	});

	test("many go under their sort, credits first, in the order given", () => {
		const many = [
			perk("3x on dining", "earn", null),
			perk("Uber Cash", "cost", 1500),
			perk("Lounge access", "service", null),
			perk("Airline fee credit", "cost", 20000),
			perk("Trip delay insurance", "service", null),
			perk("DashPass", "service", null),
			perk("2x on travel", "earn", null),
		];
		const groups = groupPerks(many);
		expect(groups.map((g) => g.category)).toEqual([
			"credit",
			"earn",
			"travel",
			"protection",
			"membership",
		]);
		expect(groups[0]?.perks.map((p) => p.name)).toEqual(["Uber Cash", "Airline fee credit"]);
		expect(groups.flatMap((g) => g.perks)).toHaveLength(many.length);
	});
});
