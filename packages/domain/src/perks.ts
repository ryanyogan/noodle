import { addDays, type DayKey } from "./month";
import type { PerkRenewal } from "./perk-standing";

// Perk Sources and their Perks. Spotting a likely Perk Source is plain code over the Household's
// spending and Accounts, matched against a short catalog of well-known products; a Parent
// confirms it. What a Perk Source includes is read from a fetched page (its benefits page, or one
// a Parent links): a model may only report what that page says, and each Perk it reports must
// quote the page (`perksOnPage`). A page whose Perks differ by plan tier, for a Perk Source whose
// tier isn't known, asks the Parent (`perksForPlan`) rather than guessing.

export const PERK_SOURCE_KINDS = ["phone-plan", "credit-card", "membership", "insurance"] as const;
export type PerkSourceKind = (typeof PERK_SOURCE_KINDS)[number];

/** A Perk is a service included (Netflix with a phone plan), or a cost covered (a TSA PreCheck credit). */
export const PERK_KINDS = ["service", "cost"] as const;
export type PerkKind = (typeof PERK_KINDS)[number];

export const perkSourceKindLabel: Record<PerkSourceKind, string> = {
	"phone-plan": "Phone plan",
	"credit-card": "Credit card",
	membership: "Membership",
	insurance: "Insurance",
};

/** A well-known product that bundles benefits, and where its benefits are described. */
export type CatalogEntry = {
	key: string;
	name: string;
	kind: PerkSourceKind;
	/** Matches a statement line (spending) or an Account's name (a card), lowercased. */
	pattern: RegExp;
	seenIn: "spending" | "account";
	/**
	 * The product's own benefits page: where research starts. Only a starting point: a Perk rests
	 * on what the fetched page says, and a Parent can link another page when this one can't be read.
	 */
	page: string;
};

export const PERK_SOURCE_CATALOG: CatalogEntry[] = [
	{
		key: "t-mobile",
		name: "T-Mobile",
		kind: "phone-plan",
		pattern: /\bt[-\s]?mobile\b/,
		seenIn: "spending",
		page: "https://www.t-mobile.com/cell-phone-plans",
	},
	{
		key: "verizon",
		name: "Verizon",
		kind: "phone-plan",
		pattern: /\bverizon\b|\bvzwrlss\b|\bvzw\b/,
		seenIn: "spending",
		page: "https://www.verizon.com/plans/unlimited/",
	},
	{
		key: "att",
		name: "AT&T",
		kind: "phone-plan",
		pattern: /\bat&t\b|\batt\*|\batt wireless\b/,
		seenIn: "spending",
		page: "https://www.att.com/plans/unlimited-data-plans/",
	},
	{
		key: "amazon-prime",
		name: "Amazon Prime",
		kind: "membership",
		pattern: /\b(amazon|amzn) ?prime\b|\bprime membership\b/,
		seenIn: "spending",
		page: "https://www.amazon.com/amazonprime",
	},
	{
		key: "walmart-plus",
		name: "Walmart+",
		kind: "membership",
		pattern: /\bwalmart ?(\+|plus)/,
		seenIn: "spending",
		page: "https://www.walmart.com/plus",
	},
	{
		key: "costco",
		name: "Costco",
		kind: "membership",
		pattern: /\bcostco\b/,
		seenIn: "spending",
		page: "https://www.costco.com/join-costco.html",
	},
	{
		key: "chase-sapphire",
		name: "Chase Sapphire",
		kind: "credit-card",
		pattern: /\bsapphire\b/,
		seenIn: "account",
		page: "https://creditcards.chase.com/rewards-credit-cards/sapphire",
	},
	{
		key: "amex-platinum",
		name: "Amex Platinum",
		kind: "credit-card",
		pattern: /\b(amex|american express)\b.*\bplatinum\b|\bplatinum\b.*\b(amex|american express)\b/,
		seenIn: "account",
		page: "https://www.americanexpress.com/us/credit-cards/card/platinum/",
	},
	{
		key: "amex-gold",
		name: "Amex Gold",
		kind: "credit-card",
		pattern: /\b(amex|american express)\b.*\bgold\b|\bgold\b.*\b(amex|american express)\b/,
		seenIn: "account",
		page: "https://www.americanexpress.com/us/credit-cards/card/gold-card/",
	},
	{
		key: "venture-x",
		name: "Capital One Venture X",
		kind: "credit-card",
		pattern: /\bventure ?x\b/,
		seenIn: "account",
		page: "https://www.capitalone.com/credit-cards/venture-x/",
	},
];

/** The catalog entry a name (typed by a Parent, or a statement line) is, if any. */
export const catalogEntryFor = (text: string): CatalogEntry | undefined =>
	PERK_SOURCE_CATALOG.find((entry) => entry.pattern.test(text.toLowerCase()));

/** A Transaction detection may look at, as the Viewer sees it. */
export type PerkSpend = { id: string; date: DayKey; note: string; private: boolean };

/** A likely Perk Source, for a Parent to confirm. */
export type PerkSourceSuggestion = {
	catalogKey: string;
	name: string;
	kind: PerkSourceKind;
	page: string;
	/** What it was seen in: a statement line, or an Account's name. */
	seenIn: string;
	/** Seen only in the Viewer's own Personal Allowance: theirs alone. */
	private: boolean;
};

/** How far back spending suggests a Perk Source. */
export const PERK_DETECT_DAYS = 180;

/**
 * The catalog's products the Household seems to hold: a phone plan or membership charged in the
 * last months or among this month's Commitments, a card among its Accounts. One seen only in the
 * Viewer's own Personal Allowance is theirs alone. Each product is suggested once, in catalog
 * order.
 */
export function detectPerkSources(input: {
	spends: PerkSpend[];
	accounts: { name: string; kind: string }[];
	/** This month's Commitments, by name: a payment's statement line may not say what it pays. */
	commitments?: { name: string }[];
	asOf: DayKey;
}): PerkSourceSuggestion[] {
	const since = addDays(input.asOf, -PERK_DETECT_DAYS);
	const recent = input.spends.filter((s) => s.date > since && s.date <= input.asOf);
	return PERK_SOURCE_CATALOG.flatMap((entry): PerkSourceSuggestion[] => {
		if (entry.seenIn === "account") {
			const account = input.accounts.find(
				(a) => a.kind === "credit-card" && entry.pattern.test(a.name.toLowerCase()),
			);
			return account
				? [{ ...suggestionOf(entry), seenIn: account.name.trim(), private: false }]
				: [];
		}
		const commitment = input.commitments?.find((c) => entry.pattern.test(c.name.toLowerCase()));
		if (commitment) {
			return [{ ...suggestionOf(entry), seenIn: commitment.name.trim(), private: false }];
		}
		const seen = recent.filter((s) => entry.pattern.test(s.note.toLowerCase()));
		const shared = seen.find((s) => !s.private);
		const latest = shared ?? seen.at(-1);
		return latest
			? [{ ...suggestionOf(entry), seenIn: latest.note.trim(), private: shared === undefined }]
			: [];
	});
}

const suggestionOf = (entry: CatalogEntry) => ({
	catalogKey: entry.key,
	name: entry.name,
	kind: entry.kind,
	page: entry.page,
});

// ---------------------------------------------------------------------------------------------
// Reading a page

/** A Perk as read from a page. `tiers` names the plans it comes with; empty, every plan. */
export type FoundPerk = {
	name: string;
	kind: PerkKind;
	/** The service or cost as it would read on a statement: "Netflix", "TSA PreCheck". */
	matches: string;
	tiers: string[];
	/** The page's own words saying so. */
	quote: string;
	/** What it's worth, in cents, as the quote states it. */
	valueCents?: number;
	/** How often it renews, as the page says. */
	renews?: PerkRenewal;
};

/** Plain words to compare: lowercased, punctuation as spaces, runs of space as one. */
export const plainWords = (text: string) =>
	` ${text
		.toLowerCase()
		.replace(/[’']/g, "")
		.replace(/[^a-z0-9+&]+/g, " ")
		.trim()} `;

/** `text` names `name` as whole words: "NETFLIX.COM 866" names "Netflix", "Netflixy" doesn't. */
export const mentions = (text: string, name: string) => {
	const wanted = plainWords(name);
	return wanted.trim().length > 0 && plainWords(text).includes(wanted);
};

/** The shortest quote that can show a page says something. */
const MIN_QUOTE = 8;

/**
 * The Perks a model read that the page really says: each quote must be on the page (compared as
 * plain words), and each name and statement name short and present. Duplicates (same kind and
 * statement name) keep the first. Anything else was the model's own idea, and is dropped.
 */
export function perksOnPage(found: FoundPerk[], pageText: string): FoundPerk[] {
	const page = plainWords(pageText);
	const seen = new Set<string>();
	return found.flatMap((perk) => {
		const name = perk.name.trim();
		const matches = perk.matches.trim();
		const quote = perk.quote.trim();
		const key = perkKey(perk);
		const ok =
			name.length > 0 &&
			name.length <= 80 &&
			plainWords(matches).trim().length > 1 &&
			matches.length <= 40 &&
			quote.length >= MIN_QUOTE &&
			page.includes(plainWords(quote)) &&
			!seen.has(key);
		if (!ok) return [];
		seen.add(key);
		return [
			{
				name,
				kind: perk.kind,
				matches,
				tiers: [...new Set(perk.tiers.map((t) => t.trim()).filter(Boolean))],
				quote: quote.slice(0, 280),
				...(valueOnPage(perk.valueCents, quote) ? { valueCents: perk.valueCents } : {}),
				...(perk.renews ? { renews: perk.renews } : {}),
			},
		];
	});
}

/** A value counts only when the quote states that very dollar figure: "$15 in Uber Cash". */
const valueOnPage = (cents: number | undefined, quote: string) => {
	if (cents === undefined || !Number.isInteger(cents) || cents <= 0) return false;
	const figures = [...quote.matchAll(/\$\s?([\d,]+(?:\.\d{1,2})?)/g)].map((m) =>
		Math.round(Number((m[1] ?? "").replace(/,/g, "")) * 100),
	);
	return figures.includes(cents);
};

/** A Perk's identity within its Perk Source, stable across re-checks: its kind and statement name. */
export const perkKey = (perk: Pick<FoundPerk, "kind" | "matches">) =>
	`${perk.kind}:${plainWords(perk.matches).trim()}`;

const sameTier = (a: string, b: string) => plainWords(a) === plainWords(b);

/**
 * The Perks that come with the Perk Source's plan: every Perk when the page doesn't tell plans
 * apart, else those for `plan` (and those for every plan). When the page's Perks depend on the
 * plan and `plan` isn't one of the page's, the Parent is asked which they have: `askPlan`.
 */
export function perksForPlan(
	read: { tiers: string[]; perks: FoundPerk[] },
	plan: string | null,
): { perks: FoundPerk[] } | { askPlan: string[] } {
	const tiers = [
		...new Set([...read.tiers, ...read.perks.flatMap((p) => p.tiers)].map((t) => t.trim())),
	].filter(Boolean);
	const dependsOnPlan = read.perks.some(
		(perk) =>
			perk.tiers.length > 0 && !tiers.every((tier) => perk.tiers.some((t) => sameTier(t, tier))),
	);
	if (tiers.length < 2 || !dependsOnPlan) return { perks: read.perks };
	const chosen = plan ? tiers.find((tier) => sameTier(tier, plan)) : undefined;
	if (!chosen) return { askPlan: tiers };
	return {
		perks: read.perks.filter(
			(perk) => perk.tiers.length === 0 || perk.tiers.some((t) => sameTier(t, chosen)),
		),
	};
}

/** How long a Perk Source's Perks stand before the nightly re-check reads its page again. */
export const PERK_RECHECK_DAYS = 30;
