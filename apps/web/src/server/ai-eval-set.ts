// The eval set for background AI's filing (ADR-0027): anonymised US card and bank statement lines
// (no real cards, people or addresses; store numbers and towns made up) and the Bucket a typical
// two-parent, two-child Household would file each in. ai-eval.ts runs it; ai-eval.test.ts (stub)
// and scripts/eval-ai.ts (the real model, opt-in) report accuracy.

/** A standard family's Buckets, in Plan order. */
export const EVAL_BUCKETS = [
	"Groceries",
	"Gas",
	"Eating Out",
	"Streaming",
	"Kids",
	"Utilities",
	"Phone & Internet",
	"Health",
	"Home",
	"Pets",
	"Shopping",
	"Insurance",
	"Travel",
	"Gifts",
] as const;

export type EvalBucket = (typeof EVAL_BUCKETS)[number];

/** Rules a Household would have made by now, by clean merchant key. */
export const EVAL_RULES: { pattern: string; bucket: EvalBucket }[] = [
	{ pattern: "xfinity", bucket: "Phone & Internet" },
	{ pattern: "verizon", bucket: "Phone & Internet" },
	{ pattern: "geico", bucket: "Insurance" },
	{ pattern: "state farm", bucket: "Insurance" },
	{ pattern: "city water", bucket: "Utilities" },
];

/** Merchants the Household filed by hand before, which similar-merchant lookup reuses. */
export const EVAL_FILED: { merchant: string; bucket: EvalBucket }[] = [
	{ merchant: "chewy", bucket: "Pets" },
	{ merchant: "petco", bucket: "Pets" },
	{ merchant: "walgreens", bucket: "Health" },
	{ merchant: "cvs", bucket: "Health" },
	{ merchant: "home depot", bucket: "Home" },
	{ merchant: "lowe's", bucket: "Home" },
	{ merchant: "duke energy", bucket: "Utilities" },
	{ merchant: "delta", bucket: "Travel" },
];

/** About 60 statement lines and where each belongs. */
export const EVAL_SET: { line: string; bucket: EvalBucket }[] = [
	{ line: "COSTCO WHSE #0482 SPRINGFIELD IL", bucket: "Groceries" },
	{ line: "KROGER #723 FAIRVIEW OH", bucket: "Groceries" },
	{ line: "SAFEWAY 1123 RIVERTON CA", bucket: "Groceries" },
	{ line: "TRADER JOE S #552 QPS", bucket: "Groceries" },
	{ line: "WHOLEFDS MKT 10234", bucket: "Groceries" },
	{ line: "ALDI 72031 GREENVILLE", bucket: "Groceries" },
	{ line: "PUBLIX #1402", bucket: "Groceries" },
	{ line: "H-E-B #611 ALLEN TX", bucket: "Groceries" },
	{ line: "SHELL OIL 57444212409", bucket: "Gas" },
	{ line: "CHEVRON 0204512 OAKDALE CA", bucket: "Gas" },
	{ line: "EXXONMOBIL 4471 MADISON", bucket: "Gas" },
	{ line: "BP#9184523 HILLTOP STA", bucket: "Gas" },
	{ line: "SPEEDWAY 03321 DAYTON OH", bucket: "Gas" },
	{ line: "MARATHON PETRO 120934", bucket: "Gas" },
	{ line: "STARBUCKS STORE 08812", bucket: "Eating Out" },
	{ line: "SQ *CHIPOTLE 1932", bucket: "Eating Out" },
	{ line: "MCDONALD'S F12345", bucket: "Eating Out" },
	{ line: "PANERA BREAD #601234", bucket: "Eating Out" },
	{ line: "DD *DOORDASH TACOSPOT", bucket: "Eating Out" },
	{ line: "CHICK-FIL-A #01822", bucket: "Eating Out" },
	{ line: "TST* MARIOS PIZZERIA", bucket: "Eating Out" },
	{ line: "NETFLIX.COM 866-579-7172 CA", bucket: "Streaming" },
	{ line: "SPOTIFY USA 877-778-1161", bucket: "Streaming" },
	{ line: "HULU 877-8244858 CA", bucket: "Streaming" },
	{ line: "DISNEY PLUS 888-905-7888", bucket: "Streaming" },
	{ line: "OLD NAVY ON-LINE 0042", bucket: "Kids" },
	{ line: "TOYS R US #8812", bucket: "Kids" },
	{ line: "YMCA SUMMER CAMP REGISTRATION", bucket: "Kids" },
	{ line: "BRIGHT STARS DAYCARE ACH", bucket: "Kids" },
	{ line: "COMCAST XFINITY 800-266-2278", bucket: "Phone & Internet" },
	{ line: "VERIZON WRLS P1234-01", bucket: "Phone & Internet" },
	{ line: "TMOBILE*AUTO PAY", bucket: "Phone & Internet" },
	{ line: "DUKE ENERGY PAYMENT 7741", bucket: "Utilities" },
	{ line: "DUKE-ENERGY PROGRESS WEB PMT", bucket: "Utilities" },
	{ line: "CITY WATER UTIL BILLPAY", bucket: "Utilities" },
	{ line: "NATL GAS CO AUTOPAY", bucket: "Utilities" },
	{ line: "WALGREENS #10234", bucket: "Health" },
	{ line: "CVS/PHARMACY #08123", bucket: "Health" },
	{ line: "LAKESIDE PEDIATRICS COPAY", bucket: "Health" },
	{ line: "SMILE DENTAL GROUP", bucket: "Health" },
	{ line: "THE HOME DEPOT #4412", bucket: "Home" },
	{ line: "LOWE'S #1882 MAPLEWOOD", bucket: "Home" },
	{ line: "ACE HARDWARE 11234", bucket: "Home" },
	{ line: "CHEWY.COM 800-672-4399", bucket: "Pets" },
	{ line: "PETCO 1234 BROOKSIDE", bucket: "Pets" },
	{ line: "BANFIELD PET HOSP #0901", bucket: "Pets" },
	{ line: "AMZN MKTP US*2K4L91", bucket: "Shopping" },
	{ line: "TJMAXX #0812", bucket: "Shopping" },
	{ line: "KOHLS #0392", bucket: "Shopping" },
	{ line: "BEST BUY 00012345", bucket: "Shopping" },
	{ line: "GEICO *AUTO 800-841-3000", bucket: "Insurance" },
	{ line: "STATE FARM RO 27 SFPP", bucket: "Insurance" },
	{ line: "DELTA AIR 0062312345678", bucket: "Travel" },
	{ line: "MARRIOTT HOTEL LAKEVIEW", bucket: "Travel" },
	{ line: "HERTZ RENT-A-CAR 0421", bucket: "Travel" },
	{ line: "1-800-FLOWERS.COM", bucket: "Gifts" },
	{ line: "HALLMARK #0451", bucket: "Gifts" },
	{ line: "ETSY.COM*SHOP HANDMADE", bucket: "Gifts" },
	{ line: "SAFEWAY FUEL 1123", bucket: "Gas" },
	{ line: "COSTCO GAS #0482", bucket: "Gas" },
];
