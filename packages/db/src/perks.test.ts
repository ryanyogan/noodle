import type { FoundPerk, PerkSourceSuggestion } from "@noodle/domain";
import { beforeEach, describe, expect, it } from "vitest";
import {
	addPerkSource,
	addPerkUse,
	createHouseholdForParent,
	type Db,
	decidePerkSource,
	ensureCardPerkSources,
	loadInsightPerks,
	loadInsights,
	loadPerkPage,
	loadPerkSources,
	loadPerkSourceToResearch,
	nameCardProduct,
	perkSourceAlreadyThere,
	perkSourcesToRecheck,
	recordInsights,
	recordPerkSourceSuggestions,
	savePerkPage,
	saveResearch,
	setPerkValue,
	updatePerkSource,
	type Viewer,
} from "./index";
import { accounts, bankConnections, members, perkSources, perks, perkUses } from "./schema";
import { testDb } from "./test-db";

const householdId = "household";
const alex: Viewer = { householdId, memberId: "alex" };
const sam: Viewer = { householdId, memberId: "sam" };

let db: Db;
let ids = 0;
const newId = () => `id-${String(++ids).padStart(4, "0")}`;

const tMobile: PerkSourceSuggestion = {
	catalogKey: "t-mobile",
	name: "T-Mobile",
	kind: "phone-plan",
	page: "https://www.t-mobile.com/cell-phone-plans",
	seenIn: "T-MOBILE*AUTOPAY",
	private: false,
};

const perk = (fields: Partial<FoundPerk> = {}): FoundPerk => ({
	name: "Netflix Standard with ads",
	kind: "service",
	matches: "Netflix",
	tiers: [],
	quote: "Netflix Standard with ads on us",
	...fields,
});

const checkedAt = new Date("2026-09-28T09:00:00Z");

beforeEach(async () => {
	db = testDb();
	ids = 0;
	await createHouseholdForParent(db, {
		clerkUserId: "clerk-alex",
		householdId,
		householdName: "The Rinks",
		timeZone: "America/Chicago",
		parentId: "alex",
		parentName: "Alex",
	});
	await db
		.insert(members)
		.values({ id: "sam", householdId, kind: "parent", name: "Sam", clerkUserId: "clerk-sam" });
});

async function confirmedTMobile() {
	await recordPerkSourceSuggestions(db, alex, [tMobile], newId);
	const [source] = await loadPerkSources(db, alex);
	await decidePerkSource(db, alex, { id: source?.id as string, status: "confirmed" });
	return source?.id as string;
}

describe("Perk Source suggestions", () => {
	it("are stored once, whatever became of them", async () => {
		expect(await recordPerkSourceSuggestions(db, alex, [tMobile], newId)).toBe(1);
		expect(await recordPerkSourceSuggestions(db, sam, [tMobile], newId)).toBe(0);
		const [source] = await loadPerkSources(db, sam);
		expect(source).toMatchObject({ name: "T-Mobile", status: "suggested", private: false });

		await decidePerkSource(db, sam, { id: source?.id as string, status: "dismissed" });
		expect(await recordPerkSourceSuggestions(db, alex, [tMobile], newId)).toBe(0);
		expect(await loadPerkSources(db, alex)).toEqual([]);
	});

	it("seen only in a Parent's own Personal Allowance, are theirs alone", async () => {
		await recordPerkSourceSuggestions(db, alex, [{ ...tMobile, private: true }], newId);
		expect(await loadPerkSources(db, sam)).toEqual([]);
		const [own] = await loadPerkSources(db, alex);
		expect(own?.private).toBe(true);
		// The other Parent can neither confirm nor dismiss it.
		expect(await decidePerkSource(db, sam, { id: own?.id as string, status: "confirmed" })).toBe(
			false,
		);
	});

	it("once confirmed, wait for research", async () => {
		const id = await confirmedTMobile();
		const [source] = await loadPerkSources(db, alex);
		expect(source).toMatchObject({ id, status: "confirmed", research: "researching" });
		expect(await loadPerkSourceToResearch(db, householdId, id)).toEqual({
			name: "T-Mobile",
			kind: "phone-plan",
			plan: null,
			pageUrl: tMobile.page,
		});
	});
});

describe("addPerkSource", () => {
	it("takes a catalog product's page, and confirms its suggestion rather than adding another", async () => {
		await recordPerkSourceSuggestions(db, alex, [tMobile], newId);
		const id = await addPerkSource(db, sam, {
			id: "own",
			name: "T-Mobile",
			kind: "phone-plan",
			plan: "Go5G Plus",
			pageUrl: null,
		});
		const sources = await loadPerkSources(db, alex);
		expect(sources).toHaveLength(1);
		expect(sources[0]).toMatchObject({
			id,
			status: "confirmed",
			plan: "Go5G Plus",
			pageUrl: tMobile.page,
		});
	});

	it("keeps a product the catalog doesn't know by itself, with its link", async () => {
		await addPerkSource(db, alex, {
			id: "a",
			name: "Credit union Visa",
			kind: "credit-card",
			plan: null,
			pageUrl: "https://example.org/visa",
		});
		await addPerkSource(db, alex, {
			id: "b",
			name: "Credit union Visa",
			kind: "credit-card",
			plan: null,
			pageUrl: null,
		});
		const pages = (await loadPerkSources(db, sam)).map((s) => [s.id, s.pageUrl]);
		// The same name twice is one card (issue 119): it shows once, the older one, its link kept.
		expect(pages).toEqual([["a", "https://example.org/visa"]]);
		expect(
			await perkSourceAlreadyThere(db, sam, { name: "credit union visa", kind: "credit-card" }),
		).toEqual({
			id: "a",
			name: "Credit union Visa",
		});
	});
});

describe("saveResearch", () => {
	it("stores each Perk with its page and date, keeping a Perk the same across re-checks", async () => {
		const id = await confirmedTMobile();
		const sourceUrl = "https://www.t-mobile.com/cell-phone-plans";
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: {
				research: "done",
				sourceUrl,
				perks: [perk(), perk({ name: "Hulu (With Ads)", matches: "Hulu", quote: "Hulu on us" })],
			},
			newId,
		});
		const [first] = await loadPerkSources(db, alex);
		expect(first).toMatchObject({ research: "done", checkedAt: checkedAt.getTime() });
		expect(first?.perks.map((p) => [p.name, p.sourceUrl, p.checkedAt])).toEqual([
			["Hulu (With Ads)", sourceUrl, checkedAt.getTime()],
			["Netflix Standard with ads", sourceUrl, checkedAt.getTime()],
		]);
		const netflixId = first?.perks[1]?.id;

		const later = new Date("2026-10-28T09:00:00Z");
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt: later,
			outcome: { research: "done", sourceUrl, perks: [perk({ name: "Netflix Standard" })] },
			newId,
		});
		const [again] = await loadPerkSources(db, alex);
		expect(again?.perks.map((p) => [p.id, p.name, p.checkedAt])).toEqual([
			[netflixId, "Netflix Standard", later.getTime()],
		]);
	});

	it("keeps the Perks it had when the page needs a plan tier or can't be read", async () => {
		const id = await confirmedTMobile();
		const sourceUrl = tMobile.page;
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: { research: "done", sourceUrl, perks: [perk()] },
			newId,
		});
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: { research: "needs-plan", planOptions: ["Go5G", "Go5G Plus"] },
			newId,
		});
		const [source] = await loadPerkSources(db, alex);
		expect(source).toMatchObject({ research: "needs-plan", planOptions: ["Go5G", "Go5G Plus"] });
		expect(source?.perks).toHaveLength(1);

		await updatePerkSource(db, sam, { id, plan: "Go5G Plus" });
		const [chosen] = await loadPerkSources(db, alex);
		expect(chosen).toMatchObject({ plan: "Go5G Plus", research: "researching" });
	});

	it("stores nothing for a Perk Source removed meanwhile, and removing one takes its Perks", async () => {
		const id = await confirmedTMobile();
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: { research: "done", sourceUrl: tMobile.page, perks: [perk()] },
			newId,
		});
		expect(await loadInsightPerks(db, sam)).toHaveLength(1);
		await decidePerkSource(db, sam, { id, status: "dismissed" });
		expect(await loadInsightPerks(db, sam)).toEqual([]);
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: { research: "done", sourceUrl: tMobile.page, perks: [perk()] },
			newId,
		});
		expect(await loadInsightPerks(db, alex)).toEqual([]);
	});
});

describe("perkSourcesToRecheck", () => {
	it("picks confirmed ones last read before the date, not those waiting on a Parent", async () => {
		const id = await confirmedTMobile();
		const before = new Date("2026-10-01T00:00:00Z");
		expect(await perkSourcesToRecheck(db, before)).toEqual([{ id, householdId }]);
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt: new Date("2026-10-05T00:00:00Z"),
			outcome: { research: "done", sourceUrl: tMobile.page, perks: [] },
			newId,
		});
		expect(await perkSourcesToRecheck(db, before)).toEqual([]);
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: { research: "needs-plan", planOptions: ["A", "B"] },
			newId,
		});
		expect(await perkSourcesToRecheck(db, before)).toEqual([]);
	});
});

describe("Perks behind Insights", () => {
	it("show with their Perk Source, page and date; a private one's only to its owner", async () => {
		await recordPerkSourceSuggestions(db, alex, [{ ...tMobile, private: true }], newId);
		const [source] = await loadPerkSources(db, alex);
		const id = source?.id as string;
		await decidePerkSource(db, alex, { id, status: "confirmed" });
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: { research: "done", sourceUrl: tMobile.page, perks: [perk()] },
			newId,
		});
		const [own] = await loadInsightPerks(db, alex);
		expect(own).toMatchObject({ sourceName: "T-Mobile", key: "service:netflix", private: true });
		expect(await loadInsightPerks(db, sam)).toEqual([]);

		await recordInsights(db, [
			{
				id: "i1",
				householdId,
				ownerMemberId: "alex",
				kind: "perk-service",
				title: "Netflix may come with T-Mobile",
				body: "…",
				yearlyImpactCents: 18_588,
				transactionIds: [],
				commitmentIds: [],
				perkIds: [own?.id as string],
				fingerprint: "perk-service:x",
			},
		]);
		const [insight] = await loadInsights(db, alex);
		expect(insight?.perks).toEqual([
			{
				id: own?.id,
				name: "Netflix Standard with ads",
				sourceName: "T-Mobile",
				sourceUrl: tMobile.page,
				checkedAt: checkedAt.getTime(),
			},
		]);

		// Removing the Perk Source takes the Perk Overlap with it.
		await decidePerkSource(db, alex, { id, status: "dismissed" });
		expect(await loadInsights(db, alex)).toEqual([]);
	});
});

describe("A credit card's perks", () => {
	it("count only charges on that card's own Account", async () => {
		const amex: PerkSourceSuggestion = {
			catalogKey: "amex-platinum",
			name: "Amex Platinum",
			kind: "credit-card",
			page: "https://www.americanexpress.com/platinum",
			seenIn: "Amex Platinum",
			private: false,
		};
		await recordPerkSourceSuggestions(db, alex, [amex], newId);
		const [source] = await loadPerkSources(db, alex);
		const id = source?.id as string;
		await decidePerkSource(db, alex, { id, status: "confirmed" });
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			outcome: {
				research: "done",
				sourceUrl: amex.page,
				perks: [
					perk({ name: "Uber Cash", kind: "cost", matches: "Uber", quote: "$15 in Uber Cash" }),
				],
			},
			newId,
		});
		await db.insert(accounts).values([
			{ id: "acct-amex", householdId, name: "Amex Platinum", kind: "credit-card" },
			{ id: "acct-other", householdId, name: "Chase Sapphire", kind: "credit-card" },
		]);
		const [loaded] = await loadPerkSources(db, alex, {
			asOf: "2026-10-04",
			spends: [
				{ date: "2026-10-01", note: "Uber trip", accountId: "acct-other" },
				{ date: "2026-10-02", note: "Uber trip", accountId: null },
				{ date: "2026-10-03", note: "Uber trip", accountId: "acct-amex" },
			],
		});
		expect(loaded?.perks[0]?.spentOn).toEqual(["2026-10-03"]);
	});
});

describe("setPerkValue", () => {
	it("keeps a value and renewal a Parent typed when the page is checked again", async () => {
		const id = await confirmedTMobile();
		const research = (fields: Partial<FoundPerk>) =>
			saveResearch(db, {
				householdId,
				perkSourceId: id,
				checkedAt,
				outcome: { research: "done", sourceUrl: tMobile.page, perks: [perk(fields)] },
				newId,
			});
		await research({});
		const [before] = await loadPerkSources(db, alex);
		const perkId = before?.perks[0]?.id as string;
		expect(await setPerkValue(db, alex, { id: perkId, valueCents: 500, renews: "monthly" })).toBe(
			true,
		);

		await research({ valueCents: 999, renews: "yearly" });
		const [after] = await loadPerkSources(db, alex);
		expect(after?.perks[0]).toMatchObject({ id: perkId, valueCents: 500, renews: "monthly" });

		// Cleared by hand, the page's value fills it again.
		await setPerkValue(db, alex, { id: perkId, valueCents: null, renews: null });
		await research({ valueCents: 999, renews: "yearly" });
		const [cleared] = await loadPerkSources(db, alex);
		expect(cleared?.perks[0]).toMatchObject({ valueCents: 999, renews: "yearly" });
	});
});

describe("linked cards (#96)", () => {
	beforeEach(async () => {
		await db.insert(bankConnections).values({
			id: "bank",
			householdId,
			provider: "plaid",
			externalId: "item",
			institution: "Chase",
			credential: "sealed",
			createdByMemberId: "alex",
		});
		await db.insert(accounts).values([
			{
				id: "acct-card",
				householdId,
				name: "CREDIT CARD",
				kind: "credit-card",
				bankConnectionId: "bank",
				externalId: "x1",
				mask: "7316",
			},
			{
				id: "acct-freedom",
				householdId,
				name: "Chase Freedom Unlimited",
				kind: "credit-card",
				bankConnectionId: "bank",
				externalId: "x2",
				mask: "1234",
			},
			{
				id: "acct-checking",
				householdId,
				name: "Chase Checking",
				kind: "checking",
				bankConnectionId: "bank",
				externalId: "x3",
				mask: "0001",
			},
			{ id: "acct-hand", householdId, name: "Store card", kind: "credit-card" },
		]);
	});

	const unnamedId = async () =>
		(await loadPerkSources(db, alex)).find((s) => s.card?.needsProduct)?.id as string;

	it("gives each linked card a Perk Source once, and asks which card when the bank doesn't say", async () => {
		const added = await ensureCardPerkSources(db, { householdId, newId });
		// Only the card whose name says which it is can be researched yet.
		expect(added).toHaveLength(1);
		expect(await ensureCardPerkSources(db, { newId })).toEqual([]);
		const sources = await loadPerkSources(db, alex);
		expect(
			sources
				.map((s) => [s.name, s.status, s.research, s.card?.mask, s.card?.needsProduct])
				.sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
		).toEqual([
			["Chase credit card", "confirmed", "idle", "7316", true],
			["Chase Freedom Unlimited", "confirmed", "researching", "1234", false],
		]);
		const unnamed = sources.find((s) => s.card?.needsProduct);
		expect(unnamed?.card).toMatchObject({
			accountId: "acct-card",
			accountName: "CREDIT CARD",
			issuer: "Chase",
		});
		expect(unnamed?.card?.productOptions).toContain("Chase Sapphire Preferred");
		expect(unnamed?.pageUrl).toBeNull();
		// One waiting on a Parent isn't re-checked each night.
		expect((await perkSourcesToRecheck(db, new Date())).map((s) => s.id)).toEqual([added[0]?.id]);
	});

	it("adding a linked card by name confirms its own Perk Source instead of a second one", async () => {
		await ensureCardPerkSources(db, { householdId, newId });
		const before = (await loadPerkSources(db, alex)).find((s) => s.card?.mask === "1234");
		const id = await addPerkSource(db, alex, {
			id: newId(),
			name: "Chase Freedom Unlimited",
			kind: "credit-card",
			plan: null,
			pageUrl: null,
		});
		expect(id).toBe(before?.id);
		const cards = (await loadPerkSources(db, alex)).filter((s) => s.card?.mask === "1234");
		expect(cards.map((s) => [s.name, s.status])).toEqual([
			["Chase Freedom Unlimited", "confirmed"],
		]);
		// Removed by a Parent, then added by name: the same one comes back, still one.
		await decidePerkSource(db, alex, { id, status: "dismissed" });
		const again = await addPerkSource(db, alex, {
			id: newId(),
			name: "chase freedom unlimited",
			kind: "credit-card",
			plan: null,
			pageUrl: null,
		});
		expect(again).toBe(id);
		expect(
			(await loadPerkSources(db, alex)).filter(
				(s) => s.kind === "credit-card" && s.card?.mask === "1234",
			),
		).toHaveLength(1);
		// A card that isn't a linked Account's is still added on its own.
		const other = await addPerkSource(db, alex, {
			id: newId(),
			name: "Amex Platinum",
			kind: "credit-card",
			plan: null,
			pageUrl: null,
		});
		expect(other).not.toBe(id);
	});

	it("names the card from its issuer's list, with its page, or another by name", async () => {
		await ensureCardPerkSources(db, { householdId, newId });
		const id = await unnamedId();
		expect(await nameCardProduct(db, alex, { id, product: "Chase Sapphire Preferred" })).toBe(true);
		const named = (await loadPerkSources(db, alex)).find((s) => s.id === id);
		expect(named).toMatchObject({
			name: "Chase Sapphire Preferred",
			research: "researching",
			pageUrl: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
		});
		expect(named?.card).toMatchObject({ mask: "7316", needsProduct: false, productOptions: [] });
		expect(await nameCardProduct(db, alex, { id, product: "My odd card" })).toBe(true);
		expect((await loadPerkSources(db, alex)).find((s) => s.id === id)).toMatchObject({
			name: "My odd card",
			pageUrl: null,
		});
		// Only a linked card's own Perk Source is named this way.
		const own = await addPerkSource(db, alex, {
			id: newId(),
			name: "Store card",
			kind: "credit-card",
			plan: null,
			pageUrl: null,
		});
		expect(await nameCardProduct(db, alex, { id: own, product: "Chase Freedom Flex" })).toBe(false);
	});

	it("isn't made again once a Parent removed it, and isn't suggested as well", async () => {
		await ensureCardPerkSources(db, { householdId, newId });
		await decidePerkSource(db, alex, { id: await unnamedId(), status: "dismissed" });
		expect(await ensureCardPerkSources(db, { householdId, newId })).toEqual([]);
		expect((await loadPerkSources(db, alex)).map((s) => s.name)).toEqual([
			"Chase Freedom Unlimited",
		]);
		const again: PerkSourceSuggestion = {
			catalogKey: "chase-sapphire",
			name: "Chase Sapphire",
			kind: "credit-card",
			page: "https://creditcards.chase.com/rewards-credit-cards/sapphire",
			seenIn: "Chase Freedom Unlimited",
			private: false,
		};
		expect(await recordPerkSourceSuggestions(db, alex, [again], newId)).toBe(0);
	});

	it("sets the card's Perks against spending on its own and other Accounts", async () => {
		await ensureCardPerkSources(db, { householdId, newId });
		const id = await unnamedId();
		await nameCardProduct(db, alex, { id, product: "Chase Sapphire Preferred" });
		await saveResearch(db, {
			householdId,
			perkSourceId: id,
			checkedAt,
			newId,
			outcome: {
				research: "done",
				sourceUrl: "https://creditcards.chase.com/rewards-credit-cards/sapphire/preferred",
				perks: [
					perk({
						name: "Kroger credit",
						kind: "cost",
						matches: "Kroger",
						quote: "$10 monthly Kroger credit",
						valueCents: 1000,
						renews: "monthly",
					}),
					perk({
						name: "3x on dining",
						kind: "earn",
						matches: "Dining",
						quote: "Earn 3x points on dining",
					}),
				],
			},
		});
		const loaded = (
			await loadPerkSources(db, alex, {
				asOf: "2026-10-05" as never,
				spends: [
					{
						id: "t1",
						date: "2026-09-20" as never,
						note: "KROGER #1",
						amount: 6412,
						accountId: "acct-checking",
					},
				],
			})
		).find((s) => s.id === id);
		expect(loaded?.worth.map((line) => line.text)).toEqual([
			"Kroger on Chase Checking: this card pays back up to $10 a month.",
		]);
		// A charge on another Account isn't this card's credit used.
		expect(loaded?.perks.find((p) => p.matches === "Kroger")?.spentOn).toEqual([]);
		// What a card earns more on never makes an Overlap.
		expect((await loadInsightPerks(db, alex)).map((p) => p.matches)).toEqual(["Kroger"]);
	});

	describe("the same card or membership twice (issue 119)", () => {
		const kroger = perk({
			name: "Kroger credit",
			kind: "cost",
			matches: "Kroger",
			quote: "$10 monthly Kroger credit",
			valueCents: 1000,
			renews: "monthly",
		});
		const lounge = perk({
			name: "Lounge visits",
			kind: "cost",
			matches: "Lounge",
			quote: "Two lounge visits a year",
			valueCents: 7000,
			renews: "yearly",
		});
		const dining = perk({
			name: "3x on dining",
			kind: "earn",
			matches: "Dining",
			quote: "Earn 3x points on dining",
		});

		/** The linked Freedom card's own Perk Source, and a second one for it from before the fix. */
		async function twoForOneAccount() {
			await ensureCardPerkSources(db, { householdId, newId });
			const kept = (await loadPerkSources(db, alex)).find((s) => s.card?.mask === "1234")
				?.id as string;
			await db.insert(perkSources).values({
				id: "dup",
				householdId,
				name: "Chase Freedom Unlimited",
				kind: "credit-card",
				status: "confirmed",
				research: "researching",
				fingerprint: "household|own:dup",
				annualFeeCents: 9500,
				createdAt: new Date("2026-01-01T00:00:00Z"),
			});
			const sourceUrl = "https://chase.example/freedom";
			await saveResearch(db, {
				householdId,
				perkSourceId: kept,
				checkedAt,
				newId,
				outcome: { research: "done", sourceUrl, perks: [kroger, lounge] },
			});
			await saveResearch(db, {
				householdId,
				perkSourceId: "dup",
				checkedAt,
				newId,
				outcome: { research: "done", sourceUrl, perks: [kroger, dining] },
			});
			const rows = await db.select().from(perks);
			const idOf = (sourceId: string, matches: string) =>
				rows.find((row) => row.perkSourceId === sourceId && row.matches === matches)?.id as string;
			return { kept, idOf };
		}

		it("shows one Perk Source, each Perk once, and a use marked on both once", async () => {
			const { kept, idOf } = await twoForOneAccount();
			const day = (on: string) => on as never;
			// The same day's use on both, and one more on each alone.
			await addPerkUse(db, alex, {
				id: "u1",
				perkId: idOf(kept, "Kroger"),
				on: day("2026-09-03"),
				note: null,
			});
			await db.insert(perkUses).values([
				{
					id: "u2",
					householdId,
					perkId: idOf("dup", "Kroger"),
					memberId: "alex",
					usedOn: "2026-09-03",
				},
				{
					id: "u3",
					householdId,
					perkId: idOf("dup", "Kroger"),
					memberId: "sam",
					usedOn: "2026-08-04",
				},
			]);
			await addPerkUse(db, alex, {
				id: "u4",
				perkId: idOf(kept, "Kroger"),
				on: day("2026-10-02"),
				note: null,
			});

			const cards = (
				await loadPerkSources(db, alex, { asOf: day("2026-10-05"), spends: [] })
			).filter((s) => s.name === "Chase Freedom Unlimited");
			expect(cards.map((s) => [s.id, s.card?.mask])).toEqual([[kept, "1234"]]);
			const [card] = cards;
			expect(card?.perks.map((p) => p.name).sort()).toEqual([
				"3x on dining",
				"Kroger credit",
				"Lounge visits",
			]);
			const credit = card?.perks.find((p) => p.matches === "Kroger");
			// It is the kept one's own Perk, with every day it was used, each once.
			expect(credit?.id).toBe(idOf(kept, "Kroger"));
			expect(credit?.uses.map((use) => use.on)).toEqual(["2026-10-02", "2026-09-03", "2026-08-04"]);
			// What was used adds up once: three uses of a $10 credit, not four.
			expect((credit?.uses.length ?? 0) * (credit?.valueCents ?? 0)).toBe(3000);
			// A fee typed on the one that is hidden still shows.
			expect(card?.annualFeeCents).toBe(9500);
			// The Insight detectors get each Perk once too.
			expect((await loadInsightPerks(db, alex)).map((p) => [p.matches, p.sourceId]).sort()).toEqual(
				[
					["Kroger", kept],
					["Lounge", kept],
				],
			);
		});

		it("writes a use or a value for a hidden one's Perk to the kept one", async () => {
			const { kept, idOf } = await twoForOneAccount();
			expect(
				await addPerkUse(db, alex, {
					id: "u9",
					perkId: idOf("dup", "Kroger"),
					on: "2026-10-01" as never,
					note: null,
				}),
			).toBe(true);
			expect((await db.select().from(perkUses)).map((use) => use.perkId)).toEqual([
				idOf(kept, "Kroger"),
			]);
			await setPerkValue(db, alex, {
				id: idOf("dup", "Kroger"),
				valueCents: 1500,
				renews: "monthly",
			});
			const stored = await db.select().from(perks);
			expect(stored.find((row) => row.id === idOf(kept, "Kroger"))?.valueCents).toBe(1500);
			expect(stored.find((row) => row.id === idOf("dup", "Kroger"))?.valueCents).toBe(1000);
		});

		it("removing the card removes both, so the hidden one doesn't come back", async () => {
			const { kept } = await twoForOneAccount();
			expect(await decidePerkSource(db, alex, { id: kept, status: "dismissed" })).toBe(true);
			expect(
				(await loadPerkSources(db, alex)).filter((s) => s.name === "Chase Freedom Unlimited"),
			).toEqual([]);
		});

		it("says a card or membership is already there, by its Account or by its name", async () => {
			await ensureCardPerkSources(db, { householdId, newId });
			const freedom = (await loadPerkSources(db, alex)).find((s) => s.card?.mask === "1234");
			expect(
				await perkSourceAlreadyThere(db, alex, {
					name: "chase freedom  unlimited",
					kind: "credit-card",
				}),
			).toEqual({ id: freedom?.id, name: "Chase Freedom Unlimited" });
			// One that isn't an Account's: the same name, whatever its case and spaces.
			const gym = await addPerkSource(db, alex, {
				id: newId(),
				name: "Corner Gym",
				kind: "membership",
				plan: null,
				pageUrl: null,
			});
			expect(
				await perkSourceAlreadyThere(db, alex, { name: " corner  GYM", kind: "membership" }),
			).toEqual({ id: gym, name: "Corner Gym" });
			expect(
				await perkSourceAlreadyThere(db, alex, { name: "Corner Gym 2", kind: "membership" }),
			).toBeNull();
			// A suggestion isn't there yet, and neither is one a Parent removed.
			await recordPerkSourceSuggestions(db, alex, [tMobile], newId);
			expect(
				await perkSourceAlreadyThere(db, alex, { name: "T-Mobile", kind: "phone-plan" }),
			).toBeNull();
			await decidePerkSource(db, alex, { id: gym, status: "dismissed" });
			expect(
				await perkSourceAlreadyThere(db, alex, { name: "Corner Gym", kind: "membership" }),
			).toBeNull();
		});
	});

	it("keeps a benefits page's text with its date, the latest in place of the last", async () => {
		const page = {
			url: "https://a.example/x",
			finalUrl: "https://a.example/x/",
			text: "hello",
			via: "browser" as const,
		};
		await savePerkPage(db, { ...page, fetchedAt: new Date("2026-10-01") });
		expect(await loadPerkPage(db, page.url, new Date("2026-09-30"))).toMatchObject({
			url: "https://a.example/x/",
			text: "hello",
			via: "browser",
		});
		expect(await loadPerkPage(db, page.url, new Date("2026-10-02"))).toBeNull();
		await savePerkPage(db, {
			...page,
			text: "new",
			via: "fetch",
			fetchedAt: new Date("2026-10-04"),
		});
		expect((await loadPerkPage(db, page.url, new Date("2026-10-02")))?.text).toBe("new");
	});
});
