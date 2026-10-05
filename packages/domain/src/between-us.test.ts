import { describe, expect, it } from "vitest";
import { looksPersonToPerson } from "./between-us";

describe("a bank line that looks like money between two people", () => {
	it("is Zelle, Venmo, PayPal, Cash App, Apple Cash or a transfer from or to", () => {
		for (const text of [
			"Zelle payment from SAM RINK 24816357",
			"ZELLE TO ALEX",
			"VENMO CASHOUT PPD ID: 5264681992",
			"PAYPAL TRANSFER",
			"Cash App*Sam",
			"CASHAPP",
			"APPLE CASH SENT MONEY",
			"Online Transfer from CHK ...1234",
			"ONLINE XFER TO SAV 9912",
		]) {
			expect(looksPersonToPerson(text), text).toBe(true);
		}
	});

	it("is a line naming one of the Parents as a whole word", () => {
		expect(looksPersonToPerson("DEPOSIT SAM RINK", ["Alex Rink", "Sam Rink"])).toBe(true);
		expect(looksPersonToPerson("SAMS CLUB #4821", ["Sam"])).toBe(false);
		expect(looksPersonToPerson("DEPOSIT ED", ["Ed"])).toBe(false);
	});

	it("isn't a paycheck, a shop, or nothing at all", () => {
		expect(looksPersonToPerson("ACME CORP PAYROLL PPD ID: 1234")).toBe(false);
		expect(looksPersonToPerson("KROGER #512")).toBe(false);
		expect(looksPersonToPerson("TRANSFERWISE INC")).toBe(false);
		expect(looksPersonToPerson(null)).toBe(false);
		expect(looksPersonToPerson("")).toBe(false);
	});
});
