import {
	CARD_ISSUERS,
	catalogEntryFor,
	PERK_CATEGORIES,
	PERK_SOURCE_CATALOG,
	type PerkCategory,
	type PerkKind,
	type PerkSourceKind,
	perkCategory,
	perkSourceKindLabel,
} from "@noodle/domain";

// What the Perks & Benefits page shows, worked out by plain code (issue 101): the cards and
// memberships a Parent can pick from when adding one, where a Perk Source stands in a word, its
// one-line summary, and its Perks under small headings when there are many.

/** A card or membership Noodle knows by name, to pick when adding a Perk Source. */
export type SourceChoice = {
	key: string;
	name: string;
	kind: PerkSourceKind;
	/** Said under its name: "Chase · Credit card". */
	detail: string;
	/** Its benefits page, when the list knows one the server wouldn't find by name. */
	pageUrl: string | null;
};

/** "Platinum Card" says nothing by itself: the issuer's name goes in front unless it's there. */
const withIssuer = (issuer: { name: string; pattern: RegExp }, product: string) =>
	issuer.pattern.test(product.toLowerCase()) ? product : `${issuer.name} ${product}`;

/**
 * Every card and membership Noodle knows by name: each issuer's common cards, then the phone
 * plans, memberships and cards of the catalog that aren't one of those cards already.
 */
export function knownSources(): SourceChoice[] {
	const cards = CARD_ISSUERS.flatMap((issuer) =>
		issuer.products.map((product): SourceChoice => {
			const name = withIssuer(issuer, product.name);
			return {
				key: `card:${issuer.key}:${product.name}`,
				name,
				kind: "credit-card",
				detail: `${issuer.name} · ${perkSourceKindLabel["credit-card"]}`,
				pageUrl: product.page,
			};
		}),
	);
	const listed = new Set(cards.map((card) => catalogEntryFor(card.name)?.key));
	const names = new Set(cards.map((card) => card.name.toLowerCase()));
	const catalog = PERK_SOURCE_CATALOG.filter(
		(entry) => !listed.has(entry.key) && !names.has(entry.name.toLowerCase()),
	).map(
		(entry): SourceChoice => ({
			key: `catalog:${entry.key}`,
			name: entry.name,
			kind: entry.kind,
			detail: perkSourceKindLabel[entry.kind],
			pageUrl: null,
		}),
	);
	return [...cards, ...catalog];
}

/**
 * The cards to pick from for a card a bank linked: its issuer's (by the issuer's name, or the
 * names the server sent), else every card Noodle knows. The names are the ones the server keeps.
 */
export function cardChoices(issuerName: string | null, options: string[] = []): SourceChoice[] {
	const detail = (issuer: string | null) =>
		[issuer, perkSourceKindLabel["credit-card"]].filter(Boolean).join(" · ");
	if (options.length > 0) {
		return options.map((name) => ({
			key: `option:${name}`,
			name,
			kind: "credit-card",
			detail: detail(issuerName),
			pageUrl: null,
		}));
	}
	const issuers = CARD_ISSUERS.filter((issuer) => !issuerName || issuer.name === issuerName);
	return (issuers.length > 0 ? issuers : CARD_ISSUERS).flatMap((issuer) =>
		issuer.products.map(
			(product): SourceChoice => ({
				key: `card:${issuer.key}:${product.name}`,
				name: issuers.length === 1 ? product.name : withIssuer(issuer, product.name),
				kind: "credit-card",
				detail: detail(issuer.name),
				pageUrl: null,
			}),
		),
	);
}

const words = (text: string) =>
	text
		.toLowerCase()
		.split(/[^a-z0-9&+]+/)
		.filter(Boolean);

/** How many matches the picker shows before a Parent types more. */
export const CHOICES_SHOWN = 6;

/**
 * The choices whose name or detail has every word typed (a word may be only its start: "sapph").
 * Names that start with what was typed come first; nothing typed shows the first few.
 */
export function searchChoices(
	choices: SourceChoice[],
	query: string,
	limit = CHOICES_SHOWN,
): SourceChoice[] {
	const typed = words(query);
	if (typed.length === 0) return choices.slice(0, limit);
	const start = query.trim().toLowerCase();
	return choices
		.filter((choice) => {
			const has = words(`${choice.name} ${choice.detail}`);
			return typed.every((word) => has.some((w) => w.startsWith(word)));
		})
		.map((choice, index) => ({ choice, index }))
		.sort(
			(a, b) =>
				Number(b.choice.name.toLowerCase().startsWith(start)) -
					Number(a.choice.name.toLowerCase().startsWith(start)) || a.index - b.index,
		)
		.slice(0, limit)
		.map(({ choice }) => choice);
}

/** The choice with exactly this name, whatever its capitals. */
export const choiceNamed = (choices: SourceChoice[], name: string): SourceChoice | undefined =>
	choices.find((choice) => choice.name.toLowerCase() === name.trim().toLowerCase());

/** Where a confirmed Perk Source stands, when it isn't simply read. */
export type SourceState = "reading" | "needs-answer" | "unreadable";

export function sourceState(source: {
	research: string;
	card: { needsProduct: boolean } | null;
}): SourceState | null {
	if (source.card?.needsProduct) return "needs-answer";
	if (source.research === "researching") return "reading";
	if (source.research === "needs-plan" || source.research === "needs-link") return "needs-answer";
	if (source.research === "unreadable") return "unreadable";
	return null;
}

/** The word on a Perk Source's row for where it stands; reading says so in its summary instead. */
export const sourceStateLabel: Record<SourceState, string | null> = {
	reading: null,
	"needs-answer": "Needs an answer",
	unreadable: "Couldn’t read",
};

/**
 * A Perk Source's row in one line: what it waits on, else how many of its Perks are worth using
 * now, else its best Perk (they come most valuable first), else that it has none.
 */
export function sourceHeadline(
	source: { research: string; card: { needsProduct: boolean } | null },
	perks: { names: string[]; toUse: number },
): string {
	if (source.card?.needsProduct) return "Which card is this?";
	switch (source.research) {
		case "researching":
			return "Reading its perks…";
		case "needs-plan":
			return "Which plan is it?";
		case "needs-link":
			return "Needs a link to its benefits page";
		case "unreadable":
			return "Link another page, or check again later";
	}
	const count = perks.names.length;
	if (count === 0) return "No perks found on its page";
	const all = `${count} ${count === 1 ? "perk" : "perks"}`;
	if (perks.toUse > 0) return `${perks.toUse} worth using now · ${all}`;
	return count === 1 ? (perks.names[0] ?? all) : `${all} · best: ${perks.names[0]}`;
}

/** More Perks than this, all shown, go under small headings by sort. */
export const PERKS_UNGROUPED = 6;

/**
 * Perks under their sort (statement credits, earning more, travel, protection, memberships), in
 * that order, each group keeping the order given. One group with no heading when there are few.
 */
export function groupPerks<
	T extends { kind: PerkKind; name: string; matches: string; valueCents?: number | null },
>(
	perks: T[],
	of: (perk: T) => PerkCategory = perkCategory,
): { category: PerkCategory | null; perks: T[] }[] {
	if (perks.length <= PERKS_UNGROUPED) return perks.length > 0 ? [{ category: null, perks }] : [];
	return PERK_CATEGORIES.map((category) => ({
		category: category as PerkCategory | null,
		perks: perks.filter((perk) => of(perk) === category),
	})).filter((group) => group.perks.length > 0);
}
