import { describe, expect, it } from "vitest";
import {
	bankAccountName,
	dollarsToCents,
	type PlaidTransaction,
	plaidAccountKind,
	plaidBankAccount,
	plaidLine,
} from "./index";

const transaction = (overrides: Partial<PlaidTransaction> = {}): PlaidTransaction => ({
	transaction_id: "tx-1",
	account_id: "acct-1",
	amount: 28.34,
	iso_currency_code: "USD",
	date: "2026-09-12",
	authorized_date: "2026-09-11",
	name: "DD DOORDASH BURGERKIN",
	merchant_name: "Burger King",
	pending: false,
	...overrides,
});

describe("plaidAccountKind", () => {
	it("reads depository accounts as checking or savings", () => {
		expect(plaidAccountKind("depository", "checking")).toBe("checking");
		expect(plaidAccountKind("depository", "savings")).toBe("savings");
		expect(plaidAccountKind("depository", "money market")).toBe("savings");
		expect(plaidAccountKind("depository", "paypal")).toBe("checking");
		expect(plaidAccountKind("depository", null)).toBe("checking");
	});

	it("reads credit as a credit card and loans as loans", () => {
		expect(plaidAccountKind("credit", "credit card")).toBe("credit-card");
		expect(plaidAccountKind("loan", "student")).toBe("loan");
		expect(plaidAccountKind("loan", "mortgage")).toBe("loan");
	});

	it("leaves investment and other accounts out", () => {
		expect(plaidAccountKind("investment", "401k")).toBeNull();
		expect(plaidAccountKind("other", null)).toBeNull();
	});
});

describe("bankAccountName", () => {
	it("adds the last digits the institution shows", () => {
		expect(bankAccountName("Plaid Checking", "0000")).toBe("Plaid Checking ··0000");
		expect(bankAccountName("  Savings ", null)).toBe("Savings");
		expect(bankAccountName("", null)).toBe("Account");
	});

	it("shortens a long name to fit, keeping the digits", () => {
		const name = bankAccountName("Plaid Diamond 12.5% APR Interest Credit Card", "3333");
		expect(name.length).toBeLessThanOrEqual(40);
		expect(name.endsWith("… ··3333")).toBe(true);
	});
});

describe("dollarsToCents", () => {
	it("rounds decimal dollars to whole cents", () => {
		expect(dollarsToCents(28.34)).toBe(2834);
		expect(dollarsToCents(0.29)).toBe(29);
		expect(dollarsToCents(-500)).toBe(-50_000);
	});

	it("refuses what isn't an amount the app holds", () => {
		expect(dollarsToCents(Number.NaN)).toBeNull();
		expect(dollarsToCents(20_000_000)).toBeNull();
	});
});

describe("plaidBankAccount", () => {
	it("holds the balance in cents, or none for another currency", () => {
		const card = plaidBankAccount({
			account_id: "a",
			name: "Plaid Credit Card",
			mask: "3333",
			type: "credit",
			subtype: "credit card",
			balances: { current: 410, iso_currency_code: "USD" },
		});
		expect(card).toEqual({
			externalId: "a",
			name: "Plaid Credit Card ··3333",
			kind: "credit-card",
			balance: 41_000,
		});
		const euro = plaidBankAccount({
			account_id: "b",
			name: "Konto",
			mask: null,
			type: "depository",
			subtype: "checking",
			balances: { current: 10, iso_currency_code: "EUR" },
		});
		expect(euro.balance).toBeNull();
	});
});

describe("plaidLine", () => {
	it("turns money out into a negative line, dated when it was authorized", () => {
		expect(plaidLine(transaction())).toEqual({
			accountExternalId: "acct-1",
			bankId: "tx-1",
			date: "2026-09-11",
			amount: -2834,
			description: "Burger King",
		});
	});

	it("turns money in (a deposit, a payment, a refund) into a positive line", () => {
		const line = plaidLine(transaction({ amount: -500, merchant_name: null, name: "PAYROLL" }));
		expect(line).toMatchObject({ amount: 50_000, description: "PAYROLL" });
	});

	it("falls back to the posted day", () => {
		expect(plaidLine(transaction({ authorized_date: null }))?.date).toBe("2026-09-12");
	});

	it("skips pending lines, other currencies, and nothing at all", () => {
		expect(plaidLine(transaction({ pending: true }))).toBeNull();
		expect(plaidLine(transaction({ iso_currency_code: "CAD" }))).toBeNull();
		expect(plaidLine(transaction({ amount: 0 }))).toBeNull();
		expect(plaidLine(transaction({ date: "soon", authorized_date: null }))).toBeNull();
	});
});
