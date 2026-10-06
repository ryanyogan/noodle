import { describe, expect, it } from "vitest";
import { looksLikePayroll, moneyInKindOf, moneyInOnImport, moneyInRuleFor } from "./money-in";

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
