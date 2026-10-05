import { describe, expect, it } from "vitest";
import { merchantKey } from "./categorize";
import {
	bankMerchantKey,
	cleanMerchant,
	displayMerchant,
	merchantGroup,
	merchantNameFor,
	plausibleMerchantName,
	ruleKeys,
} from "./merchant-name";

// Anonymised-looking statement lines, as banks and card files write them, and the names a Parent
// would say. `null` means the rules shouldn't settle it alone (it goes to the model).
const FIXTURES: [string, string | null][] = [
	["COSTCO WHSE #1042 SEATTLE WA", "Costco"],
	["COSTCO WHSE 1042", "Costco"],
	["Costco", "Costco"],
	["SQ *BLUE BOTTLE COFFEE Oakland CA", "Blue Bottle Coffee"],
	["TST* LITTLE GEM DINER 4471 PORTLAND OR", "Little Gem Diner"],
	["PAYPAL *STEAMGAMES 4259522985 WA", "Steamgames"],
	["AMZN Mktp US*2K4L19XQ2", "Amazon"],
	["AMAZON.COM*RT5YH2 AMZN.COM/BILL WA", "Amazon"],
	["Amazon Prime*1A2B3C", "Amazon Prime"],
	["WM SUPERCENTER #2231 AUSTIN TX", "Walmart"],
	["WAL-MART #0412", "Walmart"],
	["WHOLEFDS MKT 10234", "Whole Foods"],
	["TRADER JOE S #552 QPS", "Trader Joe's"],
	["TARGET 00012345 MINNEAPOLIS MN", "Target"],
	["MCDONALD'S F12345", "McDonald's"],
	["STARBUCKS STORE 08812 SEATTLE WA", "Starbucks"],
	["NETFLIX.COM 866-579-7172 CA", "Netflix"],
	["Spotify USA", "Spotify"],
	["UBER *EATS PENDING", "Uber Eats"],
	["UBER *TRIP HELP.UBER.COM", "Uber"],
	["LYFT *RIDE TUE 9PM", "Lyft"],
	["DD *DOORDASH TACOBELL", "DoorDash"],
	["SHELL OIL 57444 HOUSTON TX", "Shell"],
	["CHEVRON 0098812", "Chevron"],
	["POS PURCHASE CVS/PHARMACY #08812", "CVS"],
	["CHECKCARD 0912 WALGREENS #1234 DENVER CO", "Walgreens"],
	["PURCHASE AUTHORIZED ON 09/12 KROGER #512", "Kroger"],
	["THE HOME DEPOT #4710", "The Home Depot"],
	["LOWES #01234*", "Lowe's"],
	["CHICK-FIL-A #01234", "Chick-fil-A"],
	["APPLE.COM/BILL 866-712-7753 CA", "Apple"],
	["DISNEYPLUS 888-905-7888 CA", "Disney+"],
	["ZELLE PAYMENT TO J DOE 1234567", "Zelle"],
	["7-ELEVEN 34567", "7-Eleven"],
	["SAMSCLUB #6612", "Sam's Club"],
	["COMCAST CABLE COMM 800-COMCAST", "Xfinity"],
	["SQ *JOE'S BBQ SHACK", "Joe's BBQ Shack"],
	["BLUE RIDGE HARDWARE LLC 555-123-4567", "Blue Ridge Hardware"],
	["SAFEWAY STORE 1290 SAN FRANCISCO CA", "Safeway"],
	["GREEN LEAF CAFE SAN FRANCISCO CA", "Green Leaf Cafe"],
	["DEBIT CARD PURCHASE MAPLE STREET BAKERY", "Maple Street Bakery"],
	["ACH DEBIT CITY OF SPRINGFIELD UTIL 0923", "City of Springfield Util"],
	["RIVER GAS CO", "River Gas"],
	["REI #11 RETURN", "REI"],
	["HILLTOP GAS", "Hilltop Gas"],
	["CKO*PATREON* MEMBERSHIP", null],
	["MRKTPLC SVCS 88123", null],
];

describe("cleanMerchant", () => {
	it.each(FIXTURES)("%s → %s", (raw, expected) => {
		const cleaned = cleanMerchant(raw);
		if (expected === null) expect(cleaned.sure).toBe(false);
		else expect(cleaned).toEqual({ name: expected, sure: true });
	});

	it("never comes back empty", () => {
		for (const raw of ["#1042", "   ", "1234 5678"]) expect(cleanMerchant(raw).name).toBeDefined();
		expect(cleanMerchant("#1042").name).toBe("1042");
	});
});

// Statement lines as shown when no clean name is kept yet (#51), and a Parent's own words.
const SHOWN: [string, string][] = [
	["COSTCO WHSE #1042 SEATTLE WA", "Costco"],
	["COSTCO WHSE #1042", "Costco"],
	[
		"SQ *EL CHILITO TACOS & BREAKFAST BAR ON MANOR ROAD AUSTIN TX 78722",
		"El Chilito Tacos & Breakfast Bar on Manor Road",
	],
	["TST* LITTLE GEM DINER 4471 PORTLAND OR", "Little Gem Diner"],
	["PAYPAL *EBAY O*12-34567-89012", "eBay"],
	["MCDONALD'S F12345 AUSTIN TX", "McDonald's"],
	["HEB #0123 AUSTIN TX 78704", "H-E-B"],
	["H-E-B GAS #612", "H-E-B"],
	["BOOKPEOPLE 0042 AUSTIN TX", "Bookpeople"],
	["BLUE RIDGE HARDWARE STORE 52", "Blue Ridge Hardware"],
	["MAPLE GROCERY SUPERCENTER #88 TULSA OK 74103", "Maple Grocery"],
	["GREEN LEAF CAFE   SAN FRANCISCO CA", "Green Leaf Cafe"],
	["SQ *JOE'S BBQ SHACK", "Joe's BBQ Shack"],
	["Costco", "Costco"],
	["Soccer cleats for Ava", "Soccer cleats for Ava"],
	["  Birthday   gift ", "Birthday gift"],
];

describe("displayMerchant", () => {
	it.each(SHOWN)("%s → %s", (raw, expected) => {
		expect(displayMerchant(raw)).toBe(expected);
	});

	it("keeps a long name whole, where cleanMerchant cuts it at 40", () => {
		const raw = "SQ *EL CHILITO TACOS & BREAKFAST BAR ON MANOR ROAD AUSTIN TX 78722";
		expect(cleanMerchant(raw).name.length).toBeLessThanOrEqual(40);
		expect(displayMerchant(raw).length).toBeGreaterThan(40);
	});

	it("never comes back empty", () => {
		expect(displayMerchant("#1042")).toBe("1042");
		expect(displayMerchant("***")).toBe("***");
		expect(displayMerchant("   ")).toBe("   ");
	});
});

describe("merchantGroup", () => {
	it("groups a statement line with the name a Parent typed", () => {
		expect(merchantGroup("COSTCO WHSE #1042 SEATTLE WA")).toBe("costco");
		expect(merchantGroup("Costco")).toBe("costco");
		expect(merchantGroup("costco")).toBe("costco");
		expect(merchantGroup("WM SUPERCENTER #2231 AUSTIN TX")).toBe(merchantGroup("Walmart"));
	});

	it("keeps no note as its own group", () => {
		expect(merchantGroup("")).toBe("");
		expect(merchantGroup("  ")).toBe("");
	});
});

// #95: what the Parents' own bank sends, and typical ACH and card lines from US banks.
describe("bank wording a Parent shouldn't have to read", () => {
	const AMEX = "AMERICAN EXPRESS ACH PMT M8054 WEB ID: 2005032111";

	it.each([
		[AMEX, "American Express payment"],
		["CPC CHECKING", "CPC Checking"],
		["Mark Vend Co", "Mark Vend"],
		["Affirm", "Affirm"],
		["DISCOVER E-PAYMENT 4421 WEB ID: 2510020270", "Discover payment"],
		["CAPITAL ONE CRCARDPMT 3KD92JS8 WEB ID: 9279744980", "Capital One payment"],
		["CHASE CREDIT CRD AUTOPAY PPD ID: 4760039224", "Chase Credit Card autopay"],
		["GEICO AUTO PMT 800-841-3000", "Geico Auto payment"],
		["ALLY AUTO PAYMENT", "Ally Auto payment"],
		["Auto Loan Payment", "Auto Loan Payment"],
		["CITY OF PORTLAND WATER ONLINE PMT 5551", "City of Portland Water payment"],
		["NAVIENT PPD ID: 1234567890", "Navient"],
		[
			"PUGET SOUND ENERGY DES:BILLPAY ID:XXXXX12345 INDN:ALEX RINK CO ID:XXXXX41234 WEB",
			"Puget Sound Energy",
		],
		[
			"ORIG CO NAME:VERIZON WIRELESS ORIG ID:9783397101 DESC DATE:250914 CO ENTRY DESCR:PAYMENTS SEC:WEB TRACE#:021000021234567 EED:250914",
			"Verizon",
		],
		["T-MOBILE PCS SVC 1234567 WEB ID: 0000450304", "T-Mobile"],
		["NETFLIX.COM 866-579-7172 CA", "Netflix"],
		["SPOTIFY USA 877-778-1161 NY", "Spotify"],
		["AMZN Mktp US*2K4TY8AB3 Amzn.com/bill WA", "Amazon"],
		["WM SUPERCENTER #2481 AUSTIN TX", "Walmart"],
		["TRADER JOE'S #552 PORTLAND OR", "Trader Joe's"],
		["SHELL OIL 57444212309 HOUSTON TX", "Shell"],
		["STUMPTOWN COFFEE", "Stumptown Coffee"],
	])("%s is %s, with no model", (raw, name) => {
		expect(cleanMerchant(raw)).toEqual({ name, sure: true });
	});

	it("shows the same before background AI has named the line", () => {
		expect(displayMerchant(AMEX)).toBe("American Express payment");
		expect(displayMerchant("CPC CHECKING")).toBe("CPC Checking");
		// A line already in mixed case shows as the bank wrote it.
		expect(displayMerchant("Mark Vend Co")).toBe("Mark Vend Co");
	});

	it("knows a merchant by the bank's wording, whatever reference the line carries", () => {
		const other = "AMERICAN EXPRESS ACH PMT M9120 WEB ID: 2005032111";
		expect(bankMerchantKey(other)).toBe(bankMerchantKey(AMEX));
		expect(bankMerchantKey("COSTCO WHSE #1042 SEATTLE WA")).toBe(
			bankMerchantKey("COSTCO WHSE 0456"),
		);
		expect(bankMerchantKey("COSTCO WHSE #1042")).not.toBe(bankMerchantKey(AMEX));
		// Zelle isn't one merchant: each person paid is their own.
		expect(bankMerchantKey("Zelle payment to John Smith 1234")).not.toBe(
			bankMerchantKey("Zelle payment to Mary Jones 5678"),
		);
	});

	it("takes a Parent's name over AI's, AI's over the cleaner's, and the cleaner's over the raw text", () => {
		const ai = "Amex payment for American Express";
		expect(merchantNameFor(AMEX, { parent: "Amex card", ai })).toEqual({
			name: "Amex card",
			by: "parent",
		});
		expect(merchantNameFor(AMEX, { ai })).toEqual({ name: ai, by: "ai" });
		expect(merchantNameFor(AMEX, { ai: "Chase payment" })).toEqual({
			name: "American Express payment",
			by: "cleaner",
		});
		expect(merchantNameFor(AMEX, {})).toEqual({ name: "American Express payment", by: "cleaner" });
		expect(merchantNameFor("Affirm", {})).toEqual({ name: "Affirm", by: "raw" });
	});

	it("keeps a model's name only when it reads as that line's merchant", () => {
		expect(plausibleMerchantName(AMEX, "American Express payment")).toBe(true);
		expect(plausibleMerchantName("CKO*PATREON* MEMBERSHIP", "Patreon")).toBe(true);
		expect(plausibleMerchantName("MRKTPLC SVCS 88123", "Marketplace Services")).toBe(true);
		expect(plausibleMerchantName("AMZN MKTP US", "Amazon")).toBe(true);
		// A merchant the line never named; "payment" alone is shared with every such line.
		expect(plausibleMerchantName(AMEX, "Chase payment")).toBe(false);
		expect(plausibleMerchantName(AMEX, "2005032111")).toBe(false);
		expect(plausibleMerchantName(AMEX, "M8054")).toBe(false);
		expect(plausibleMerchantName(AMEX, AMEX)).toBe(false);
		expect(plausibleMerchantName(AMEX, "American Express ACH PMT")).toBe(false);
		expect(plausibleMerchantName(AMEX, "")).toBe(false);
	});

	it("still finds a Rule by the bank's merchant once a Parent has renamed the line", () => {
		const keys = ruleKeys({ merchant: "Amex card", note: AMEX });
		expect(keys[0]).toBe(merchantKey("Amex card"));
		expect(keys).toContain(merchantKey("American Express payment"));
		expect(keys).toContain(merchantKey(AMEX));
		expect(ruleKeys({ merchant: null, note: null })).toEqual([]);
	});
});
