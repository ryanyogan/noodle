import { mentions, plainWords } from "./perks";

// The card issuers Noodle knows by name, each with a short list of its common cards. A
// bank often names a card only "CREDIT CARD", so the Perks page asks a Parent which of these it
// is. Names only: nothing here says what a card includes. Each `page` is the issuer's own
// benefits page as best known when this was written: UNVERIFIED, and only where research starts.
// A Perk still rests on what the page fetched at research time says (ADR-0015, ADR-0044); a page
// that's moved shows as one that couldn't be read, and a Parent links the right one.

export type CardProduct = { name: string; page: string | null };

export type CardIssuer = {
	key: string;
	name: string;
	/** Matches the institution's name, or an Account's, lowercased. */
	pattern: RegExp;
	/** The issuer's own sites: research never reads a card's page anywhere else unless a Parent links it. */
	domains: string[];
	products: CardProduct[];
};

const card = (name: string, page: string | null = null): CardProduct => ({ name, page });
const chase = (path: string) => `https://creditcards.chase.com/${path}`;
const amex = (path: string) => `https://www.americanexpress.com/us/credit-cards/card/${path}/`;
const capitalOne = (path: string) => `https://www.capitalone.com/credit-cards/${path}/`;
const citi = (path: string) => `https://www.citi.com/credit-cards/${path}`;
const bofa = (path: string) => `https://www.bankofamerica.com/credit-cards/products/${path}/`;
const wells = (path: string) => `https://creditcards.wellsfargo.com/${path}/`;

export const CARD_ISSUERS: CardIssuer[] = [
	{
		key: "chase",
		name: "Chase",
		pattern: /\bchase\b|\bjpmorgan\b/,
		domains: ["chase.com"],
		products: [
			card("Chase Sapphire Preferred", chase("rewards-credit-cards/sapphire/preferred")),
			card("Chase Sapphire Reserve", chase("rewards-credit-cards/sapphire/reserve")),
			card("Chase Freedom Unlimited", chase("cash-back-credit-cards/freedom/unlimited")),
			card("Chase Freedom Flex", chase("cash-back-credit-cards/freedom/flex")),
			card("Chase Freedom Rise", chase("cash-back-credit-cards/freedom/rise")),
			card("Prime Visa", chase("cash-back-credit-cards/amazon-prime-rewards")),
			card("United Explorer", chase("travel-credit-cards/united/united-explorer")),
			card("Southwest Rapid Rewards Plus", chase("travel-credit-cards/southwest/plus")),
			card("Marriott Bonvoy Boundless", chase("travel-credit-cards/marriott-bonvoy/boundless")),
			card("World of Hyatt", chase("travel-credit-cards/world-of-hyatt-credit-card")),
			card("Ink Business Preferred"),
			card("Ink Business Cash"),
		],
	},
	{
		key: "amex",
		name: "American Express",
		pattern: /\bamerican express\b|\bamex\b/,
		domains: ["americanexpress.com"],
		products: [
			card("Platinum Card", amex("platinum")),
			card("Gold Card", amex("gold-card")),
			card("Green Card", amex("green")),
			card("Blue Cash Preferred", amex("blue-cash-preferred")),
			card("Blue Cash Everyday", amex("blue-cash-everyday")),
			card("Delta SkyMiles Gold", amex("delta-skymiles-gold-american-express-card")),
			card("Delta SkyMiles Platinum", amex("delta-skymiles-platinum-american-express-card")),
			card("Delta SkyMiles Reserve", amex("delta-skymiles-reserve-american-express-card")),
			card("Hilton Honors", amex("hilton-honors")),
			card("Hilton Honors Surpass", amex("hilton-honors-surpass")),
			card("Marriott Bonvoy Brilliant", amex("marriott-bonvoy-brilliant")),
			card("Amex EveryDay", amex("amex-everyday")),
		],
	},
	{
		key: "capital-one",
		name: "Capital One",
		pattern: /\bcapital one\b/,
		domains: ["capitalone.com"],
		products: [
			card("Venture X", capitalOne("venture-x")),
			card("Venture", capitalOne("venture")),
			card("VentureOne", capitalOne("ventureone")),
			card("Savor", capitalOne("savor")),
			card("Quicksilver", capitalOne("quicksilver")),
			card("QuicksilverOne", capitalOne("quicksilverone")),
			card("Platinum Mastercard", capitalOne("platinum")),
		],
	},
	{
		key: "citi",
		name: "Citi",
		pattern: /\bciti\b|\bcitibank\b|\bciticards\b/,
		domains: ["citi.com"],
		products: [
			card("Citi Strata Premier", citi("citi-strata-premier-credit-card")),
			card("Citi Double Cash", citi("citi-double-cash-credit-card")),
			card("Citi Custom Cash", citi("citi-custom-cash-credit-card")),
			card("Costco Anywhere Visa", citi("citi-costco-anywhere-visa-credit-card")),
			card("Citi Simplicity", citi("citi-simplicity-credit-card")),
			card("Citi Diamond Preferred", citi("citi-diamond-preferred-credit-card")),
			card("AAdvantage Platinum Select"),
		],
	},
	{
		key: "discover",
		name: "Discover",
		pattern: /\bdiscover\b/,
		domains: ["discover.com"],
		products: [
			card("Discover it Cash Back", "https://www.discover.com/credit-cards/cash-back/it-card.html"),
			card("Discover it Miles"),
			card("Discover it Chrome"),
			card("Discover it Student"),
		],
	},
	{
		key: "bank-of-america",
		name: "Bank of America",
		pattern: /\bbank of america\b|\bbofa\b/,
		domains: ["bankofamerica.com"],
		products: [
			card("Customized Cash Rewards", bofa("cash-back-credit-card")),
			card("Unlimited Cash Rewards", bofa("unlimited-cash-back-credit-card")),
			card("Travel Rewards", bofa("travel-rewards-credit-card")),
			card("Premium Rewards", bofa("premium-rewards-credit-card")),
			card("Premium Rewards Elite"),
			card("Alaska Airlines Visa"),
		],
	},
	{
		key: "wells-fargo",
		name: "Wells Fargo",
		pattern: /\bwells fargo\b/,
		domains: ["wellsfargo.com"],
		products: [
			card("Active Cash", wells("active-cash-credit-card")),
			card("Autograph", wells("autograph-visa-credit-card")),
			card("Autograph Journey", wells("autograph-journey-visa-credit-card")),
			card("Reflect", wells("reflect-visa-credit-card")),
			card("Bilt Mastercard"),
		],
	},
];

/** The issuer of a card, from the institution's name first, else from the Account's own. */
export function cardIssuerFor(
	institution: string | null,
	accountName = "",
): CardIssuer | undefined {
	const named = (text: string) => CARD_ISSUERS.find((issuer) => issuer.pattern.test(text));
	return named((institution ?? "").toLowerCase()) ?? named(accountName.toLowerCase());
}

/** Words that tell no card from another. */
const PLAIN = new Set(["card", "credit", "visa", "mastercard", "the", "from", "it", "amex"]);

/** A product's telling words: its name without its issuer's and without "card", "visa" and such. */
function tellingWords(issuer: CardIssuer, product: CardProduct): string {
	const issuerWords = new Set(plainWords(issuer.name).trim().split(" "));
	return plainWords(product.name)
		.trim()
		.split(" ")
		.filter((word) => !issuerWords.has(word) && !PLAIN.has(word))
		.join(" ");
}

/**
 * The issuer's card an Account's name tells of, if it does: "Chase Sapphire Preferred ••1234" is
 * one, "CREDIT CARD ••7316" isn't. The most telling name wins ("Freedom Unlimited" over "Freedom").
 */
export function cardProductIn(issuer: CardIssuer, accountName: string): CardProduct | undefined {
	return issuer.products
		.map((product) => ({ product, words: tellingWords(issuer, product) }))
		.filter(({ words }) => words.length > 0 && mentions(accountName, words))
		.sort((a, b) => b.words.length - a.words.length)[0]?.product;
}

/** The issuer's card of exactly this name, as a Parent picked it from the list. */
export const cardProductNamed = (issuer: CardIssuer, name: string): CardProduct | undefined =>
	issuer.products.find((product) => product.name.toLowerCase() === name.trim().toLowerCase());

/** A listed card's key on its Perk Source. */
export const cardCatalogKey = (issuer: CardIssuer, product: CardProduct) =>
	`card:${issuer.key}:${plainWords(product.name).trim().replace(/ /g, "-")}`;

/** Whether a page is on one of the issuers' own sites (https only). */
export function onIssuerSite(url: string, issuers: CardIssuer[] = CARD_ISSUERS): boolean {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}
	if (parsed.protocol !== "https:") return false;
	const host = parsed.hostname.toLowerCase();
	return issuers.some((issuer) =>
		issuer.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
	);
}

/** Whether two pages are on the same site: a redirect off it isn't the page that was asked for. */
export function sameSite(a: string, b: string): boolean {
	const site = (url: string) => {
		try {
			return new URL(url).hostname.toLowerCase().split(".").slice(-2).join(".");
		} catch {
			return null;
		}
	};
	const one = site(a);
	return one !== null && one === site(b);
}
