import { describe, expect, it } from "vitest";
import { looksPersonToPerson, parentNamedIn } from "./between-us";

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

	it("says which Parent a line names, never from a shop's name or a paycheck", () => {
		const parents = ["Alex Rink", "Sam"];
		expect(parentNamedIn("ZELLE TO SAM 2481", parents)).toBe("Sam");
		expect(parentNamedIn("CHECK 1042 ALEX RINK", parents)).toBe("Alex Rink");
		expect(parentNamedIn("ZELLE TO MARIA", parents)).toBeNull();
		expect(parentNamedIn("SAM'S CLUB #4821", parents)).toBeNull();
		expect(parentNamedIn("SAM’S CLUB #4821", parents)).toBeNull();
		expect(looksPersonToPerson("SAM'S CLUB #4821", parents)).toBe(false);
		expect(parentNamedIn("ACME CORP PAYROLL ALEX RINK", parents)).toBeNull();
		expect(looksPersonToPerson("ACME DIRECT DEP ALEX RINK", parents)).toBe(false);
		expect(parentNamedIn(null, parents)).toBeNull();
	});

	it("isn't a paycheck, a shop, or nothing at all", () => {
		expect(looksPersonToPerson("ACME CORP PAYROLL PPD ID: 1234")).toBe(false);
		expect(looksPersonToPerson("KROGER #512")).toBe(false);
		expect(looksPersonToPerson("TRANSFERWISE INC")).toBe(false);
		expect(looksPersonToPerson(null)).toBe(false);
		expect(looksPersonToPerson("")).toBe(false);
	});
});
