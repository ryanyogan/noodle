import { describe, expect, it } from "vitest";
import {
	type SimplefinAccount,
	type SimplefinTransaction,
	simplefinAccountKind,
	simplefinBankAccount,
	simplefinCents,
	simplefinErrors,
	simplefinInstitution,
	simplefinLine,
	simplefinMissedLines,
} from "./index";

const account = (overrides: Partial<SimplefinAccount> = {}): SimplefinAccount => ({
	id: "ACT-1",
	name: "Everyday Checking",
	currency: "USD",
	balance: "1250.40",
	"balance-date": 1_790_000_000,
	...overrides,
});

// 2026-09-12 14:30 UTC, and that day's posting at 00:00 UTC the day after.
const TRANSACTED = Date.UTC(2026, 8, 12, 14, 30) / 1000;
const POSTED = Date.UTC(2026, 8, 13) / 1000;

const transaction = (overrides: Partial<SimplefinTransaction> = {}): SimplefinTransaction => ({
	id: "TRN-1",
	posted: POSTED,
	amount: "-28.34",
	description: " BURGER KING #1234 ",
	transacted_at: TRANSACTED,
	pending: false,
	...overrides,
});

describe("simplefinCents", () => {
	it("reads numeric strings as cents", () => {
		expect(simplefinCents("-28.34")).toBe(-2834);
		expect(simplefinCents("2400")).toBe(240_000);
		expect(simplefinCents("+0.5")).toBe(50);
		expect(simplefinCents(".99")).toBe(99);
		expect(simplefinCents("12.345")).toBe(1235);
	});

	it("refuses anything else", () => {
		expect(simplefinCents("")).toBeNull();
		expect(simplefinCents("1,200.00")).toBeNull();
		expect(simplefinCents("$5")).toBeNull();
		expect(simplefinCents("1e3")).toBeNull();
		expect(simplefinCents("99999999999999")).toBeNull();
	});
});

describe("simplefinAccountKind", () => {
	it("reads the kind from the account's name", () => {
		expect(simplefinAccountKind(account({ name: "Rewards Checking" }))).toBe("checking");
		expect(simplefinAccountKind(account({ name: "High Yield Savings" }))).toBe("savings");
		expect(simplefinAccountKind(account({ name: "Money Market" }))).toBe("savings");
		expect(simplefinAccountKind(account({ name: "12 Month CD" }))).toBe("savings");
		expect(simplefinAccountKind(account({ name: "Auto Loan", balance: "-12480" }))).toBe("loan");
		expect(simplefinAccountKind(account({ name: "Mortgage", balance: "-201000" }))).toBe("loan");
		expect(simplefinAccountKind(account({ name: "Sapphire Visa", balance: "-410.25" }))).toBe(
			"credit-card",
		);
		expect(simplefinAccountKind(account({ name: "Credit Card", balance: "0.00" }))).toBe(
			"credit-card",
		);
	});

	it("falls back on the balance: owed is a card's, held is checking's", () => {
		expect(simplefinAccountKind(account({ name: "Freedom Unlimited", balance: "-81.20" }))).toBe(
			"credit-card",
		);
		expect(simplefinAccountKind(account({ name: "Joint Account", balance: "310.00" }))).toBe(
			"checking",
		);
	});

	it("leaves investment accounts and other currencies out", () => {
		expect(simplefinAccountKind(account({ name: "Brokerage" }))).toBeNull();
		expect(simplefinAccountKind(account({ name: "Roth IRA" }))).toBeNull();
		expect(simplefinAccountKind(account({ name: "401(k)" }))).toBeNull();
		expect(simplefinAccountKind(account({ name: "Individual", holdings: [{}] }))).toBeNull();
		expect(simplefinAccountKind(account({ currency: "CAD" }))).toBeNull();
		expect(
			simplefinAccountKind(account({ currency: "https://www.example.com/flight-miles" })),
		).toBeNull();
	});
});

describe("simplefinBankAccount", () => {
	it("holds a depository account's balance as it is", () => {
		expect(simplefinBankAccount(account())).toEqual({
			externalId: "ACT-1",
			name: "Everyday Checking",
			kind: "checking",
			balance: 125_040,
		});
	});

	it("holds what's owed on a card or loan as a positive balance", () => {
		expect(simplefinBankAccount(account({ name: "Visa", balance: "-410.25" })).balance).toBe(
			41_025,
		);
		expect(simplefinBankAccount(account({ name: "Visa", balance: "0.00" })).balance).toBe(0);
		expect(simplefinBankAccount(account({ name: "Auto Loan", balance: "-12480" })).balance).toBe(
			1_248_000,
		);
	});

	it("keeps no balance for an account the app doesn't track", () => {
		expect(simplefinBankAccount(account({ name: "Brokerage" }))).toMatchObject({
			kind: null,
			balance: null,
		});
	});
});

describe("simplefinLine", () => {
	it("dates a line when it happened, keeps the sign, and uses the bank's words", () => {
		expect(simplefinLine("ACT-1", transaction())).toEqual({
			accountExternalId: "ACT-1",
			bankId: "TRN-1",
			date: "2026-09-12",
			amount: -2834,
			description: "BURGER KING #1234",
		});
		expect(simplefinLine("ACT-1", transaction({ amount: "2400.00" }))?.amount).toBe(240_000);
	});

	it("dates it when it posted where the institution doesn't say when it happened", () => {
		expect(simplefinLine("ACT-1", transaction({ transacted_at: undefined }))?.date).toBe(
			"2026-09-13",
		);
	});

	it("skips pending lines, and ones with no amount", () => {
		expect(simplefinLine("ACT-1", transaction({ pending: true }))).toBeNull();
		expect(simplefinLine("ACT-1", transaction({ posted: 0 }))).toBeNull();
		expect(simplefinLine("ACT-1", transaction({ amount: "0.00" }))).toBeNull();
		expect(simplefinLine("ACT-1", transaction({ amount: "n/a" }))).toBeNull();
	});
});

describe("simplefinInstitution", () => {
	it("names the institution from version 2's connections", () => {
		expect(
			simplefinInstitution({
				connections: [{ conn_id: "CON-1", name: "First Platypus Bank" }],
				accounts: [account({ conn_id: "CON-1" }), account({ id: "ACT-2", conn_id: "CON-1" })],
			}),
		).toBe("First Platypus Bank");
	});

	it("names it from version 1's org", () => {
		expect(
			simplefinInstitution({ accounts: [account({ org: { name: "Platypus CU", domain: null } })] }),
		).toBe("Platypus CU");
	});

	it("says how many when one login reaches several", () => {
		const at = (conn_id: string) => account({ id: conn_id, conn_id });
		const connections = [
			{ conn_id: "A", name: "Bank A" },
			{ conn_id: "B", name: "Bank B" },
			{ conn_id: "C", name: "Bank C" },
		];
		expect(simplefinInstitution({ connections, accounts: [at("A"), at("B")] })).toBe(
			"Bank A and Bank B",
		);
		expect(simplefinInstitution({ connections, accounts: [at("A"), at("B"), at("C")] })).toBe(
			"Bank A and 2 others",
		);
		expect(simplefinInstitution({ accounts: [account()] })).toBeNull();
	});
});

describe("simplefinErrors and simplefinMissedLines", () => {
	it("reads both versions' errors", () => {
		expect(
			simplefinErrors({
				accounts: [],
				errlist: [{ code: "con.auth", msg: "Reauthenticate with First Platypus Bank" }],
				errors: ["Connection to Platypus CU may need attention"],
			}),
		).toEqual([
			"Reauthenticate with First Platypus Bank",
			"Connection to Platypus CU may need attention",
		]);
	});

	it("reads them as plain text, each once", () => {
		expect(
			simplefinErrors({
				accounts: [],
				errlist: [
					{
						code: "con.auth",
						msg: '<p>Sign in again at <a href="https://bridge.simplefin.org">the Bridge</a> &amp; retry&#33;</p>',
					},
					{ code: "gen.api", msg: "   " },
					{ code: "act.missingdata", msg: "" },
				],
				errors: ["Sign in again at the Bridge & retry!", "x".repeat(400)],
			}),
		).toEqual(["Sign in again at the Bridge & retry!", "act.missingdata", `${"x".repeat(299)}…`]);
	});

	it("counts connection and account errors as missed lines, not general notices", () => {
		const missed = (code: string) =>
			simplefinMissedLines({ accounts: [], errlist: [{ code, msg: "" }] });
		expect(missed("act.missingdata")).toBe(true);
		expect(missed("con.auth")).toBe(true);
		expect(missed("gen.api")).toBe(false);
		expect(simplefinMissedLines({ accounts: [], errors: ["Something happened"] })).toBe(true);
		expect(simplefinMissedLines({ accounts: [] })).toBe(false);
	});
});
