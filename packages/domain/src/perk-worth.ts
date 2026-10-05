import { addDays, type DayKey } from "./month";
import type { PerkRenewal } from "./perk-standing";
import { earnRate, mentions, type PerkKind } from "./perks";

// "Worth using": a card's Perks set against the Household's own spending, by plain code.
// Three looks, each with the charges it rests on: credits that went unused in past months,
// charges on other Accounts that a Perk on this card pays back or includes, and the kinds of
// purchases the Household makes most that this card earns more on. Only ever about a card the
// Household already has. Nothing is stored: it is worked out from Perks and Transactions each
// time the Perks page loads.

export type WorthSpend = {
	id: string;
	date: DayKey;
	amount: number;
	note: string;
	accountId: string | null;
};

export type WorthPerk = {
	id: string;
	name: string;
	kind: PerkKind;
	matches: string;
	quote: string;
	valueCents: number | null;
	renews: PerkRenewal | null;
	/** Days a Parent marked it used by hand. */
	usedOn: DayKey[];
};

export type WorthEvidence = {
	date: DayKey;
	note: string;
	amountCents: number;
	account: string | null;
};

export type WorthLine = {
	key: string;
	perkId: string;
	reason: "unused" | "elsewhere" | "earns";
	/** The line a Parent reads. */
	text: string;
	/** What orders the lines, most valuable first. Never shown. */
	weightCents: number;
	/** The charges it rests on, latest first (a few). */
	evidence: WorthEvidence[];
};

/** Kinds of purchases a card may earn more on, and the statement words that tell them. */
export const SPEND_CATEGORIES: { key: string; names: RegExp; words: RegExp }[] = [
	{
		key: "groceries",
		names: /grocer|supermarket/,
		words:
			/\b(grocer\w*|supermarket|kroger|safeway|whole ?foods|wholefds|trader joe\w*|aldi|publix|h-?e-?b|wegmans|albertsons|food lion|giant|stop & shop|meijer|sprouts|hy-?vee|winco|harris teeter|jewel|vons|ralphs|fred meyer|instacart)\b/,
	},
	{
		key: "dining",
		names: /dining|restaurant|takeout|eating out/,
		words:
			/\b(restaurant\w*|doordash|grubhub|uber ?eats|mcdonald\w*|starbucks|chipotle|cafe|coffee|pizza\w*|taco\w*|burger\w*|grill|diner|bistro|sushi|bakery|chick-?fil-?a|wendy\w*|panera|dunkin\w*|subway|domino\w*|kitchen|tavern|bbq)\b/,
	},
	{
		key: "gas",
		names: /\bgas\b|fuel|ev charging/,
		words:
			/\b(shell|chevron|exxon\w*|mobil|bp|texaco|marathon|sunoco|valero|citgo|phillips 66|conoco|speedway|circle k|wawa|quiktrip|qt|fuel|gas)\b/,
	},
	{
		key: "travel",
		names: /travel|airline|flight|hotel/,
		words:
			/\b(airline\w*|airways|delta|united|southwest|american air\w*|jetblue|alaska air\w*|hotel\w*|marriott|hilton|hyatt|airbnb|vrbo|expedia|booking\.com|hertz|avis|enterprise rent\w*|amtrak|uber|lyft)\b/,
	},
	{
		key: "streaming",
		names: /streaming/,
		words:
			/\b(netflix|hulu|spotify|disney ?\+|disney plus|hbo|max|peacock|paramount\w*|apple tv|youtube ?(tv|premium)|sling|audible)\b/,
	},
	{
		key: "drugstores",
		names: /drugstore|pharmac/,
		words: /\b(cvs|walgreens|rite aid|pharmacy|drugstore)\b/,
	},
	{
		key: "online shopping",
		names: /amazon|online shopping/,
		words: /\b(amazon|amzn)\b/,
	},
];

const dollars = (cents: number) =>
	`$${(cents / 100).toLocaleString("en-US", {
		minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
		maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
	})}`;

const monthOf = (day: DayKey) => day.slice(0, 7);

/** The `count` whole months before `asOf`'s, latest first: "2026-09", "2026-08", … */
export function monthsBefore(asOf: DayKey, count: number): string[] {
	let year = Number(asOf.slice(0, 4));
	let month = Number(asOf.slice(5, 7));
	return Array.from({ length: count }, () => {
		month -= 1;
		if (month === 0) {
			month = 12;
			year -= 1;
		}
		return `${year}-${String(month).padStart(2, "0")}`;
	});
}

const per: Record<PerkRenewal, string> = {
	monthly: "a month",
	quarterly: "every 3 months",
	yearly: "a year",
	"every-4-years": "every 4 years",
	"per-trip": "each trip",
};

/** How many lines a card shows. */
export const WORTH_SHOWN = 5;
/** How far back charges on other Accounts, and the kinds of purchases, are looked at. */
export const WORTH_RECENT_DAYS = 90;
/** A kind of purchase is worth a line from this much a month. */
export const WORTH_MIN_MONTHLY_CENTS = 5_000;

export function worthUsing(input: {
	/** The card's own Account, when Noodle knows which it is. */
	cardAccountId: string | null;
	perks: WorthPerk[];
	/** The spending the Viewer may see, on every Account. */
	spends: WorthSpend[];
	accountNames: Record<string, string>;
	asOf: DayKey;
}): WorthLine[] {
	const { cardAccountId, perks, spends, accountNames, asOf } = input;
	const upTo = spends.filter((s) => s.date <= asOf);
	const onCard = cardAccountId ? upTo.filter((s) => s.accountId === cardAccountId) : [];
	const recentFrom = addDays(asOf, -WORTH_RECENT_DAYS);
	const recent = upTo.filter((s) => s.date > recentFrom);
	const latestFirst = (a: WorthSpend, b: WorthSpend) => (a.date < b.date ? 1 : -1);
	const evidenceOf = (found: WorthSpend[]): WorthEvidence[] =>
		found.slice(0, 3).map((s) => ({
			date: s.date,
			note: s.note.trim(),
			amountCents: s.amount,
			account: s.accountId ? (accountNames[s.accountId] ?? null) : null,
		}));
	const lines: WorthLine[] = [];

	// The months the card has charges for: before its first one, nothing can be said.
	const firstMonth = onCard.reduce<string | null>(
		(first, s) => (first === null || monthOf(s.date) < first ? monthOf(s.date) : first),
		null,
	);
	const months = firstMonth ? monthsBefore(asOf, 12).filter((month) => month >= firstMonth) : [];

	for (const perk of perks) {
		const qualifying = onCard.filter((s) => mentions(s.note, perk.matches)).sort(latestFirst);
		// 1. Credits that went unused.
		if (perk.kind === "cost" && perk.valueCents && months.length > 0) {
			const usedIn = new Set([
				...qualifying.map((s) => monthOf(s.date)),
				...perk.usedOn.map(monthOf),
			]);
			const value = perk.valueCents;
			if (perk.renews === "monthly") {
				const missed = months.filter((month) => !usedIn.has(month)).length;
				if (missed > 0) {
					const span =
						months.length === 1 ? "last month" : `in ${missed} of the last ${months.length} months`;
					lines.push({
						key: `unused:${perk.id}`,
						perkId: perk.id,
						reason: "unused",
						text: `You didn’t use the ${dollars(value)} ${perk.name} ${span} (about ${dollars(missed * value)}).`,
						weightCents: missed * value,
						evidence: evidenceOf(qualifying),
					});
				}
			} else if (perk.renews === "yearly" && months.length === 12) {
				if (!months.some((month) => usedIn.has(month)) && !usedIn.has(monthOf(asOf))) {
					lines.push({
						key: `unused:${perk.id}`,
						perkId: perk.id,
						reason: "unused",
						text: `You haven’t used the ${dollars(value)} ${perk.name} in the last 12 months.`,
						weightCents: value,
						evidence: [],
					});
				}
			}
		}
		// 2. Charges on other Accounts this card's Perk pays back or includes.
		if (perk.kind !== "earn" && cardAccountId) {
			const elsewhere = recent
				.filter((s) => s.accountId !== cardAccountId && mentions(s.note, perk.matches))
				.sort(latestFirst);
			const latest = elsewhere[0];
			if (latest) {
				const account = latest.accountId ? accountNames[latest.accountId] : undefined;
				const where = account
					? `${perk.matches} on ${account}`
					: `${perk.matches} on another Account`;
				const paid = elsewhere.reduce((sum, s) => sum + s.amount, 0);
				const what =
					perk.kind === "service"
						? `${perk.name} comes with this card.`
						: perk.valueCents && perk.renews
							? `this card pays back up to ${dollars(perk.valueCents)} ${per[perk.renews]}.`
							: perk.valueCents
								? `this card pays back up to ${dollars(perk.valueCents)}.`
								: `this card’s ${perk.name} pays it back.`;
				lines.push({
					key: `elsewhere:${perk.id}`,
					perkId: perk.id,
					reason: "elsewhere",
					text: `${where}: ${what}`,
					weightCents: perk.valueCents ? Math.min(paid, perk.valueCents * 3) : paid,
					evidence: evidenceOf(elsewhere),
				});
			}
		}
		// 3. The kinds of purchases the Household makes that this card earns more on.
		if (perk.kind === "earn") {
			const rate = earnRate(perk.quote);
			const category = SPEND_CATEGORIES.find((c) => c.names.test(perk.matches.toLowerCase()));
			if (!rate) continue;
			const bought = recent.filter(
				(s) => mentions(s.note, perk.matches) || category?.words.test(s.note.toLowerCase()),
			);
			const monthly = Math.round(bought.reduce((sum, s) => sum + s.amount, 0) / 3);
			if (monthly < WORTH_MIN_MONTHLY_CENTS) continue;
			const rounded = Math.round(monthly / 1000) * 1000;
			const offCard = cardAccountId
				? Math.round(
						bought
							.filter((s) => s.accountId !== cardAccountId)
							.reduce((sum, s) => sum + s.amount, 0) /
							3 /
							1000,
					) * 1000
				: 0;
			const times = Number.parseFloat(rate);
			lines.push({
				key: `earns:${perk.id}`,
				perkId: perk.id,
				reason: "earns",
				text: `You spend about ${dollars(rounded)} a month on ${perk.matches.toLowerCase()}; this card earns ${rate} there.${
					offCard > 0 ? ` About ${dollars(offCard)} of it goes on other Accounts.` : ""
				}`,
				// A point taken as a cent, only to order the lines.
				weightCents: Math.round((monthly * 12 * times) / 100),
				evidence: evidenceOf([...bought].sort((a, b) => b.amount - a.amount)),
			});
		}
	}
	return lines
		.sort((a, b) => b.weightCents - a.weightCents || a.key.localeCompare(b.key))
		.slice(0, WORTH_SHOWN);
}
