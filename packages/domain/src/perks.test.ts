import { describe, expect, it } from "vitest";
import {
	catalogEntryFor,
	type DayKey,
	detectPerkSources,
	type FoundPerk,
	mentions,
	type PerkSpend,
	perksForPlan,
	perksOnPage,
} from "./index";

const asOf = "2026-09-28" as DayKey;
const spend = (id: string, note: string, date: string, isPrivate = false): PerkSpend => ({
	id,
	note,
	date: date as DayKey,
	private: isPrivate,
});

const perk = (fields: Partial<FoundPerk>): FoundPerk => ({
	name: "Netflix Standard with ads",
	kind: "service",
	matches: "Netflix",
	tiers: [],
	quote: "Netflix Standard with ads on us",
	...fields,
});

describe("detectPerkSources", () => {
	it("suggests a phone plan charged lately and a card among the Accounts", () => {
		const found = detectPerkSources({
			spends: [spend("t1", "T-MOBILE*AUTOPAY 800-937-8997", "2026-09-03")],
			accounts: [
				{ name: "Chase Sapphire", kind: "credit-card" },
				{ name: "Sapphire savings", kind: "savings" },
			],
			asOf,
		});
		expect(found.map((s) => [s.catalogKey, s.kind, s.seenIn, s.private])).toEqual([
			["t-mobile", "phone-plan", "T-MOBILE*AUTOPAY 800-937-8997", false],
			["chase-sapphire", "credit-card", "Chase Sapphire", false],
		]);
	});

	it("ignores old charges, and keeps one seen only in the Viewer's Personal Allowance theirs", () => {
		const found = detectPerkSources({
			spends: [
				spend("t1", "VERIZON WIRELESS", "2025-10-01"),
				spend("t2", "AMAZON PRIME*2K4", "2026-09-01", true),
			],
			accounts: [],
			asOf,
		});
		expect(found.map((s) => [s.catalogKey, s.private])).toEqual([["amazon-prime", true]]);
	});

	it("suggests one of this month's Commitments, shared, whatever its payments say", () => {
		const found = detectPerkSources({
			spends: [spend("t1", "Payment", "2026-09-03")],
			accounts: [],
			commitments: [{ name: "T-Mobile family plan" }, { name: "Netflix" }],
			asOf,
		});
		expect(found.map((s) => [s.catalogKey, s.seenIn, s.private])).toEqual([
			["t-mobile", "T-Mobile family plan", false],
		]);
	});

	it("doesn't take an Amazon order for Prime", () => {
		const found = detectPerkSources({
			spends: [spend("t1", "AMAZON.COM*2K4 AMZN.COM/BILL", "2026-09-01")],
			accounts: [],
			asOf,
		});
		expect(found).toEqual([]);
	});

	it("knows a typed name from the catalog", () => {
		expect(catalogEntryFor("my T-Mobile plan")?.key).toBe("t-mobile");
		expect(catalogEntryFor("American Express Platinum")?.key).toBe("amex-platinum");
		expect(catalogEntryFor("Library card")).toBeUndefined();
	});
});

describe("mentions", () => {
	it("compares whole words, ignoring case and punctuation", () => {
		expect(mentions("NETFLIX.COM 866-579-7172 CA", "Netflix")).toBe(true);
		expect(mentions("Disney+ Hulu bundle", "Disney+")).toBe(true);
		expect(mentions("NETFLIXY", "Netflix")).toBe(false);
		expect(mentions("anything", "  ")).toBe(false);
	});
});

describe("perksOnPage", () => {
	const page = `Go5G Plus: Netflix Standard with ads on us,
		Apple TV+ on us. All plans: T-Mobile Tuesdays.`;

	it("keeps only Perks whose quote is on the page", () => {
		const found = perksOnPage(
			[
				perk({}),
				perk({ name: "Max", matches: "Max", quote: "Max on us, every month" }),
				perk({ name: "Apple TV+", matches: "Apple TV+", quote: "apple tv+   ON US" }),
			],
			page,
		);
		expect(found.map((p) => p.name)).toEqual(["Netflix Standard with ads", "Apple TV+"]);
	});

	it("drops duplicates, too-short quotes, and empty names", () => {
		const found = perksOnPage(
			[perk({}), perk({ name: "Netflix again" }), perk({ quote: "on us" }), perk({ name: " " })],
			page,
		);
		expect(found).toHaveLength(1);
	});
});

describe("perksForPlan", () => {
	const read = {
		tiers: ["Essentials", "Go5G", "Go5G Plus"],
		perks: [
			perk({ tiers: ["Go5G", "Go5G Plus"] }),
			perk({ name: "Hulu", matches: "Hulu", tiers: ["Go5G Plus"] }),
			perk({ name: "T-Mobile Tuesdays", matches: "T-Mobile Tuesdays", tiers: [] }),
		],
	};

	it("asks which plan when the page's Perks depend on it and the plan isn't known", () => {
		expect(perksForPlan(read, null)).toEqual({ askPlan: ["Essentials", "Go5G", "Go5G Plus"] });
		expect(perksForPlan(read, "Magenta MAX")).toEqual({
			askPlan: ["Essentials", "Go5G", "Go5G Plus"],
		});
	});

	it("keeps the Perks that come with the chosen plan", () => {
		const chosen = perksForPlan(read, "go5g plus");
		expect("perks" in chosen && chosen.perks.map((p) => p.name)).toEqual([
			"Netflix Standard with ads",
			"Hulu",
			"T-Mobile Tuesdays",
		]);
		const basic = perksForPlan(read, "Essentials");
		expect("perks" in basic && basic.perks.map((p) => p.name)).toEqual(["T-Mobile Tuesdays"]);
	});

	it("never asks when every Perk comes with every plan", () => {
		const same = perksForPlan(
			{ tiers: ["Preferred", "Reserve"], perks: [perk({ tiers: ["Preferred", "Reserve"] })] },
			null,
		);
		expect("perks" in same && same.perks).toHaveLength(1);
	});
});
