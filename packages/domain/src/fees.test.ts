import { describe, expect, it } from "vitest";
import {
	FEES_AND_INTEREST,
	feesBucketIn,
	feesOffer,
	feesRulePattern,
	interestEarned,
	looksLikeFeeOrInterest,
	looksLikeInterestEarned,
	merchantKey,
	ruleFor,
} from "./index";

describe("looksLikeFeeOrInterest", () => {
	it.each([
		// Checking and savings
		"MONTHLY SERVICE FEE",
		"MONTHLY MAINTENANCE FEE",
		"Monthly Maintenance Fee - Waived Next Period",
		"OVERDRAFT FEE FOR A $54.12 ITEM - DETAILS: SHELL OIL 5744",
		"OVERDRAFT ITEM FEE",
		"OVERDRAFT PROTECTION TRANSFER FEE",
		"INSUFFICIENT FUNDS FEE FOR A $120.00 ITEM",
		"NSF RETURNED ITEM FEE",
		"NSF CHARGE",
		"RETURNED ITEM CHARGE",
		"NON-CHASE ATM FEE-WITH",
		"ATM FEE 08/14 #000482913 WITHDRWL 7-ELEVEN",
		"ATM SURCHARGE",
		"NON-WF ATM WITHDRAWAL SVC CHG",
		"ATM SERVICE CHARGE",
		"WIRE TRANSFER FEE",
		"DOMESTIC WIRE FEE",
		"STOP PAYMENT FEE",
		"PAPER STATEMENT FEE",
		"SERVICE CHARGE",
		"ACCOUNT ANALYSIS SVC CHARGE",
		// Cards
		"INTEREST CHARGE ON PURCHASES",
		"PURCHASE INTEREST CHARGE",
		"INTEREST CHARGED ON CASH ADVANCES",
		"Interest Charge: Purchases",
		"FINANCE CHARGE",
		"*FINANCE CHARGE* PURCHASES",
		"LATE FEE",
		"LATE PAYMENT FEE",
		"LATE CHARGE",
		"LATE PAYMENT PENALTY",
		"FOREIGN TRANSACTION FEE",
		"FOREIGN TRANS FEE 09/02 LISBON",
		"INTL TRANSACTION FEE",
		"INTERNATIONAL TRANSACTION FEE",
		"FGN TRANS FEE",
		"FOREIGN TRANSACTION",
		"CURRENCY CONVERSION FEE",
		"ANNUAL MEMBERSHIP FEE",
		"ANNUAL FEE",
		"CASH ADVANCE FEE",
		"BALANCE TRANSFER FEE",
		"RETURNED PAYMENT FEE",
		"VENMO INSTANT TRANSFER FEE",
	])("takes “%s” as a fee or interest", (text) => {
		expect(looksLikeFeeOrInterest(text)).toBe(true);
	});

	it.each([
		// A word inside another, or a merchant's own name.
		"BLUE BOTTLE COFFEE OAKLAND CA",
		"SQ *COFFEE COLLECTIVE",
		"TOFFEE & CO",
		"LATE NIGHT DINER AUSTIN TX",
		"THE LATE SHOW TICKETS",
		"CHOCOLATE BAR SF",
		"PINTEREST ADS",
		"FEENEY'S HARDWARE",
		"FEDERATED AUTO PARTS",
		// Cash from a machine is cash, not a fee.
		"ATM WITHDRAWAL 000482 123 MAIN ST",
		"ATM CASH DEPOSIT",
		"NON-CHASE ATM WITHDRAW",
		// A purchase from abroad isn't its fee.
		"FOREIGN CINEMA SAN FRANCISCO",
		// What a school, a city or a shop charges is spending of its own kind.
		"LINCOLN ELEMENTARY ACTIVITY FEE",
		"STATE UNIV TUITION AND FEES",
		"CITY OF AUSTIN PARKING FEE",
		"TX DMV REGISTRATION FEE",
		"MAPLE RIDGE HOA FEES",
		"TSA PRECHECK APPLICATION FEE",
		"US PASSPORT FEE",
		"DOORDASH DELIVERY FEE",
		"YMCA ENROLLMENT FEE",
		"AIRBNB CLEANING FEE",
		// A card payment and a bill.
		"CHASE CREDIT CRD AUTOPAY",
		"AMEX EPAYMENT ACH PMT",
		"T-MOBILE AUTOPAY",
		"WELLS FARGO HOME MTG PAYMENT",
		// Money back for a fee isn't one.
		"OVERDRAFT FEE REFUND",
		"LATE FEE REVERSAL",
		"INTEREST CHARGE ADJUSTMENT CREDIT",
		"",
	])("leaves “%s” alone", (text) => {
		expect(looksLikeFeeOrInterest(text)).toBe(false);
	});

	it("leaves no wording alone", () => {
		expect(looksLikeFeeOrInterest(null)).toBe(false);
		expect(looksLikeFeeOrInterest(undefined)).toBe(false);
	});
});

describe("feesOffer", () => {
	it("is offered for money out only", () => {
		expect(feesOffer({ text: "OVERDRAFT FEE", amountCents: 3400 })).toEqual({ what: "fee" });
		expect(feesOffer({ text: "OVERDRAFT FEE", amountCents: -3400 })).toBeNull();
		expect(feesOffer({ text: "TRADER JOE'S", amountCents: 3400 })).toBeNull();
	});

	it("says interest when the line is interest", () => {
		expect(feesOffer({ text: "INTEREST CHARGE ON PURCHASES", amountCents: 2210 })).toEqual({
			what: "interest",
		});
		expect(feesOffer({ text: "FINANCE CHARGE", amountCents: 2210 })).toEqual({ what: "interest" });
	});
});

describe("feesBucketIn", () => {
	const buckets = [
		{ id: "g", name: "Groceries" },
		{ id: "mine", name: "Fees and interest", owner: "alex" },
		{ id: "f", name: " fees and Interest " },
	];

	it("finds the Household's Bucket by its name, whatever the capitals", () => {
		expect(feesBucketIn(buckets)?.id).toBe("f");
		expect(FEES_AND_INTEREST).toBe("Fees and interest");
	});

	it("never takes a Personal Allowance for it", () => {
		expect(feesBucketIn(buckets.slice(0, 2))).toBeUndefined();
	});
});

describe("interest earned", () => {
	it.each([
		"INTEREST PAYMENT",
		"INTEREST PAID",
		"Interest Earned",
		"INTEREST CREDIT",
		"INT PAID THIS PERIOD",
		"MONTHLY INTEREST PAID",
		"APY EARNED 4.25%",
		"INTEREST",
		"SAVINGS INTEREST DEPOSIT",
	])("takes “%s” as interest earned", (text) => {
		expect(looksLikeInterestEarned(text)).toBe(true);
	});

	it.each([
		"ACME PAYROLL DIR DEP",
		"PINTEREST PAYOUT",
		"INTEREST CHARGE REFUND",
		"INTEREST CHARGE REVERSAL",
		"PURCHASE INTEREST CHARGE ADJUSTMENT",
		"ZELLE FROM SAM RINK",
		"",
	])("leaves “%s” alone", (text) => {
		expect(looksLikeInterestEarned(text)).toBe(false);
	});

	it("is Income whose pay is the Household's, and only for money in", () => {
		expect(interestEarned({ text: "INTEREST PAID", amountCents: -412 })).toEqual({
			kind: "income",
			whosePay: "household",
		});
		expect(interestEarned({ text: "INTEREST PAID", amountCents: 412 })).toBeNull();
		expect(interestEarned({ text: "ACME PAYROLL", amountCents: -200000 })).toBeNull();
	});
});

describe("feesRulePattern", () => {
	it.each([
		["OVERDRAFT FEE FOR A $54.12 ITEM - DETAILS: SHELL OIL 5744", "overdraft fee"],
		["MONTHLY SERVICE FEE", "monthly service fee"],
		["INTEREST CHARGE ON PURCHASES", "interest charge"],
		["PURCHASE INTEREST CHARGE", "interest charge"],
		["ATM FEE 08/14 #000482913 WITHDRWL 7-ELEVEN", "atm fee"],
		["FOREIGN TRANS FEE 09/02 LISBON", "foreign trans fee"],
		["OVERDRAFT PROTECTION TRANSFER FEE", "overdraft protection transfer fee"],
		["ATM SURCHARGE", "atm surcharge"],
		["FOREIGN TRANSACTION", "foreign transaction"],
	])("for “%s” is “%s”", (wording, pattern) => {
		expect(feesRulePattern(merchantKey(wording))).toBe(pattern);
	});

	it("keeps the whole merchant when one plain word would be left", () => {
		expect(feesRulePattern("fee waiver club")).toBe("fee waiver club");
		expect(feesRulePattern("overdraft")).toBe("overdraft");
	});

	it("makes a Rule that files the same charge for something else, and nothing else", () => {
		const rules = [
			{
				pattern: feesRulePattern(merchantKey("OVERDRAFT FEE FOR A $54.12 ITEM - SHELL OIL")),
				bucketId: "fees",
			},
		];
		expect(ruleFor(rules, merchantKey("OVERDRAFT FEE FOR A $9.00 ITEM - NETFLIX"))).toBeDefined();
		expect(ruleFor(rules, merchantKey("MONTHLY SERVICE FEE"))).toBeUndefined();
		expect(ruleFor(rules, merchantKey("BLUE BOTTLE COFFEE"))).toBeUndefined();
	});
});
