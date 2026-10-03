import { describe, expect, it } from "vitest";
import { cleanMerchant } from "./merchant-name";

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
