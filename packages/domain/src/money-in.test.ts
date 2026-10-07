import { describe, expect, it } from "vitest";
import {
	looksLikePayroll,
	looksLikeRefund,
	looksLikeReturnedPayment,
	moneyInKindOf,
	moneyInOnImport,
	moneyInRuleFor,
	suggestedMoneyInKind,
} from "./money-in";

describe("the kind of money in", () => {
	it("is Income unless something says otherwise", () => {
		expect(moneyInKindOf({ stored: null, transfer: null })).toBe("income");
		expect(moneyInKindOf({ stored: "refund", transfer: null })).toBe("refund");
		expect(moneyInKindOf({ stored: "paid-back", transfer: null })).toBe("paid-back");
	});

	it("is a Transfer when it arrived by one, Between us when a Parent said so", () => {
		expect(moneyInKindOf({ stored: null, transfer: { reason: null } })).toBe("transfer");
		expect(moneyInKindOf({ stored: "refund", transfer: { reason: "between-us" } })).toBe(
			"between-us",
		);
	});
});

describe("money in on Import", () => {
	it("reads payroll wording as Income without asking", () => {
		expect(looksLikePayroll("ACME CORP PAYROLL 0042")).toBe(true);
		expect(looksLikePayroll("DIR DEP NORTHWIND")).toBe(true);
		expect(looksLikePayroll("Zelle payment from CASEY LOWE")).toBe(false);
		expect(moneyInOnImport("ACME PAYROLL VENMO")).toEqual({ kind: "income", review: false });
	});

	it("sends person-to-person money in to Review", () => {
		for (const wording of [
			"Zelle payment from CASEY LOWE 1234",
			"VENMO CASHOUT",
			"Cash App*Casey",
			"PAYPAL TRANSFER",
			"APPLE CASH BANK XFER",
		])
			expect(moneyInOnImport(wording)).toEqual({ kind: "income", review: true });
	});

	it("leaves everything else as Income", () => {
		expect(moneyInOnImport("IRS TREAS 310 TAX REF")).toEqual({ kind: "income", review: false });
		expect(moneyInOnImport("MOBILE CHECK DEPOSIT")).toEqual({ kind: "income", review: false });
		expect(moneyInOnImport(null)).toEqual({ kind: "income", review: false });
	});

	it("lets a Rule state the kind, the longest wording first", () => {
		const rules = [
			{ pattern: "zelle", kind: "between-us" as const },
			{ pattern: "zelle from casey lowe", kind: "paid-back" as const },
		];
		expect(moneyInRuleFor(rules, "Zelle payment from CASEY LOWE 1234")?.kind).toBe("paid-back");
		expect(moneyInOnImport("Zelle payment from CASEY LOWE 1234", rules)).toEqual({
			kind: "paid-back",
			review: false,
		});
		expect(moneyInOnImport("ZELLE FROM SAM", rules)).toEqual({ kind: "between-us", review: false });
	});
});

describe("money in that reads as a refund (issue 141)", () => {
	// Real bank wordings, each way. A store or a bank giving money back: Review, Refund suggested.
	const refunds = [
		"AMAZON REFUND",
		"AMZN Mktp US REFUND 112-4455",
		"POS REFUND TARGET 00012",
		"NETFLIX.COM REFUND",
		"APPLE.COM/BILL REFUND",
		"VISA REFUND SOUTHWEST AIR",
		"Refund from IKEA",
		"WAYFAIR REFUND REF #88213",
		"SALES TAX REFUND TARGET",
		"PURCHASE RETURN COSTCO WHSE #1042",
		"DEBIT CARD RETURN HOME DEPOT",
		"CHECKCARD RETURN LOWES #00907",
		"MERCHANDISE RETURN KOHLS",
		"POS RETURN WALMART #2211",
		"AMAZON RETURN",
		"TARGET RETURN 0423",
		"REI #11 RETURN",
		"COSTCO RETURNS",
		"DELTA AIR LINES RFND",
		"UBER TRIP RFD",
		"BEST BUY REFND 00291",
		"REF OF OVERPAYMENT COMCAST",
		"OVERDRAFT FEE REVERSAL",
		"OVERDRAFT FEE REFUND",
		"ATM FEE REFUND",
		"MONTHLY SERVICE FEE REVERSAL",
		"LATE FEE REVERSED",
		"RETURNED ITEM FEE REVERSAL",
		"ACH RETURN FEE REFUND",
		"PAYMENT REVERSED",
		"CREDIT ADJ",
		"CREDIT ADJUSTMENT 0921",
		"MERCHANT CREDIT REI",
		"CHARGEBACK VISA",
		"CHARGE BACK 4471",
		"PROVISIONAL CREDIT",
		"DISPUTE CREDIT 8841",
	];
	// Pay, tax refunds (by the agency's name, with or without the word tax), reference numbers,
	// and wording too thin to tell: Income, as it always was.
	const incomes = [
		"ACME CORP PAYROLL",
		"IRS TREAS 310 TAX REF",
		"IRS TREAS 310 TAX REFUND",
		"US TREASURY 310 TAX REFUND",
		"STATE OF OHIO TAX REFUND",
		"STATE OF COLO REFUND",
		"ST OF MICH TAX RFD",
		"FRANCHISE TAX BD",
		"FRANCHISE TAX BD CASTTAXRFD",
		"CA FTB",
		"CA FTB MCT REFUND",
		"GA DOR REFUND",
		"WI DOR REFUND",
		"NYS DTF PIT",
		"NYS DTF PIT TAX REFUND",
		"COMM OF MASS TAX RFD",
		"COMMONWEALTH OF PA PASTTAXRFD",
		"OREGON DEPT OF REVENUE REFUND",
		"MN DEPT OF REVENUE REFUND",
		"NC DEPT REVENUE REFUND",
		"IL DEPT OF REV REFUND",
		"VA DEPT TAXATION REFUND",
		"MD COMPTROLLER REFUND",
		"TAXREFUND",
		"TAX PRODUCTS PE1 SBTPG LLC",
		"PROPERTY TAX REFUND COOK COUNTY",
		"SSA TREAS 310 XXSOC SEC",
		"INTEREST PAYMENT",
		"MOBILE CHECK DEPOSIT",
		"ATM DEPOSIT",
		"ACH CREDIT ACME CONSULTING",
		"CREDIT",
		"CASH BACK",
		"CASH BACK REWARD",
		"CREDITKARMA TRANSFER",
		"REFUNDIFY INC",
		"RETURNPATH LLC",
		"DEPOSIT REF #1234",
		"ACH CREDIT REF: 9981",
		"WIRE IN REF 20261007",
		"RETURN",
		"RETURN 0423",
		"RETURN OF PREMIUM",
		"RETURN OF PREMIUM STATE FARM",
	];
	// A payment that failed and came back: not a Refund for a purchase, and not Income either.
	const returned = [
		"ACH RETURN",
		"ACH RETURN COMCAST CABLE",
		"ACH RTN 0042",
		"ACH RETURNED ITEM",
		"RETURNED ITEM",
		"RETURN ITEM",
		"RETURN CHECK",
		"RETURNED CHECK #1042",
		"CHECK RETURNED",
		"RETURNED PAYMENT",
		"PAYMENT RETURNED",
		"BILL PAY RETURN",
		"RETURNED ACH DEBIT",
		"NSF RETURN",
	];
	// From a person: Review as before issue 141; Paid back suggested when the memo says so.
	const people: [string, "paid-back" | null][] = [
		["ZELLE FROM JOHN refund for tickets", "paid-back"],
		["Zelle payment from CASEY LOWE refund for shoes", "paid-back"],
		["VENMO PAYMENT JOHN paying you back", "paid-back"],
		["Zelle payment from SAM PIKE paid back dinner", "paid-back"],
		["CASH APP*MIA what I owe you", "paid-back"],
		["PAYPAL TRANSFER reimbursement camp", "paid-back"],
		["Zelle payment from CASEY LOWE 1234", null],
		["VENMO CASHOUT", null],
		["Zelle payment from RETURN PATH LLC", null],
		["ZELLE FROM JOHN tax refund split", "paid-back"],
		["Zelle payment from JOHN ACH RETURN", null],
	];

	it("the table is big enough to mean something", () => {
		expect(refunds.length).toBeGreaterThanOrEqual(30);
		expect(incomes.length + returned.length + people.length).toBeGreaterThanOrEqual(30);
	});

	it("waits in Review with Refund suggested, and isn't a Refund until a Parent says so", () => {
		for (const wording of refunds) {
			expect(looksLikeRefund(wording), wording).toBe(true);
			expect(moneyInOnImport(wording), wording).toEqual({
				kind: "income",
				review: true,
				suggest: "refund",
			});
			expect(suggestedMoneyInKind(wording), wording).toBe("refund");
		}
	});

	it("leaves pay, tax refunds, interest, reference numbers and plain credits as Income", () => {
		for (const wording of incomes) {
			expect(looksLikeRefund(wording), wording).toBe(false);
			expect(looksLikeReturnedPayment(wording), wording).toBe(false);
			expect(moneyInOnImport(wording), wording).toEqual({ kind: "income", review: false });
			expect(suggestedMoneyInKind(wording), wording).toBeNull();
		}
		expect(moneyInOnImport(null)).toEqual({ kind: "income", review: false });
	});

	it("sends a payment that came back to Review with nothing suggested", () => {
		for (const wording of returned) {
			expect(looksLikeReturnedPayment(wording), wording).toBe(true);
			expect(looksLikeRefund(wording), wording).toBe(false);
			expect(moneyInOnImport(wording), wording).toEqual({ kind: "income", review: true });
			expect(suggestedMoneyInKind(wording), wording).toBeNull();
		}
	});

	it("money from a person waits in Review whatever its memo says, never with Refund suggested", () => {
		for (const [wording, suggest] of people) {
			expect(looksLikeRefund(wording), wording).toBe(false);
			expect(moneyInOnImport(wording), wording).toEqual(
				suggest ? { kind: "income", review: true, suggest } : { kind: "income", review: true },
			);
			expect(suggestedMoneyInKind(wording), wording).toBe(suggest);
		}
	});

	it("payroll wording still wins, and so does a Rule", () => {
		expect(moneyInOnImport("ACME PAYROLL REVERSAL")).toEqual({ kind: "income", review: false });
		expect(suggestedMoneyInKind("ACME PAYROLL REVERSAL")).toBeNull();
		expect(moneyInOnImport("ACME PAYROLL ZELLE refund")).toEqual({ kind: "income", review: false });
		expect(suggestedMoneyInKind("ACME PAYROLL ZELLE refund")).toBeNull();
		expect(
			moneyInOnImport("AMAZON REFUND", [{ pattern: "amazon refund", kind: "income" }]),
		).toEqual({
			kind: "income",
			review: false,
		});
		expect(
			moneyInOnImport("ZELLE FROM JOHN refund for tickets", [{ pattern: "zelle", kind: "income" }]),
		).toEqual({ kind: "income", review: false });
	});
});
