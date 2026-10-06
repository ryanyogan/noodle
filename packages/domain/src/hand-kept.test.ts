import { describe, expect, it } from "vitest";
import { owedOn } from "./goals";
import { accountForWalletCard, balanceCheck, cardKept, statementCheckDue } from "./hand-kept";

describe("how a card's purchases get into Noodle", () => {
	it("is its bank's when it syncs, whatever was answered", () => {
		expect(cardKept({ bankConnectionId: "bank", purchases: "hand" })).toBe("bank");
	});
	it("is the Parent's answer", () => {
		expect(cardKept({ bankConnectionId: null, purchases: "hand", followed: true })).toBe("hand");
		expect(cardKept({ bankConnectionId: null, purchases: "none" })).toBe("none");
	});
	it("is statements when unanswered and a statement came in lately, else not known", () => {
		expect(cardKept({ bankConnectionId: null, purchases: null, followed: true })).toBe(
			"statements",
		);
		expect(cardKept({ bankConnectionId: null, purchases: null })).toBeNull();
	});
});

describe("the Account a Wallet card's name says", () => {
	const accounts = [
		{ id: "checking", name: "Apple Cash", kind: "checking", walletName: null },
		{ id: "apple", name: "Apple Card", kind: "credit-card", walletName: null },
		{ id: "freedom", name: "Chase Freedom", kind: "credit-card", walletName: null },
		{ id: "sapphire", name: "Chase Sapphire", kind: "credit-card", walletName: "Cori's Visa" },
	];
	it.each([
		["Apple Card", "apple"],
		["apple card", "apple"],
		["Chase Freedom Unlimited", "freedom"],
		["Freedom", "freedom"],
		["CORI’S VISA", "sapphire"],
		["Apple", "apple"],
	])("%s is %s", (card, id) => {
		expect(accountForWalletCard(card, accounts)).toBe(id);
	});
	it.each(["Chase", "Discover it", "", "Apple Cash"])("%s is unclear", (card) => {
		// "Chase" could be either Chase card; a checking Account is never a Wallet card's by its name.
		expect(accountForWalletCard(card, accounts)).toBeNull();
	});
});

describe("what's owed on a card kept by hand", () => {
	const latest = { amount: 50_000, day: "2026-10-01" } as const;
	it("goes up with what was bought after the balance's day and down with payments", () => {
		expect(
			owedOn(latest, [{ amount: 20_000, date: "2026-10-10" }], false, [
				{ amount: 4_200, date: "2026-10-02" },
				{ amount: 900, date: "2026-10-01" },
				{ amount: -1_000, date: "2026-10-05" },
			]),
		).toBe(50_000 - 20_000 + 4_200 - 1_000);
	});
	it("is the bank's on a connected card, whatever was bought", () => {
		expect(owedOn(latest, [], true, [{ amount: 4_200, date: "2026-10-02" }])).toBe(50_000);
	});
});

describe("the monthly balance check", () => {
	it("matches, or says how far the statement is from what's recorded", () => {
		expect(balanceCheck(61_420, 61_420)).toEqual({ kind: "matches" });
		expect(balanceCheck(61_420, 53_000)).toEqual({ kind: "higher", byCents: 8_420 });
		expect(balanceCheck(50_000, 53_000)).toEqual({ kind: "lower", byCents: 3_000 });
		expect(balanceCheck(8_420, null)).toEqual({ kind: "higher", byCents: 8_420 });
	});
	it("is due from the statement's day until a balance from that day or later is recorded", () => {
		const due = (today: string, lastBalanceDay: string | null, statementDay: number | null = 30) =>
			statementCheckDue({
				statementDay,
				today: today as never,
				lastBalanceDay: lastBalanceDay as never,
			});
		expect(due("2026-10-29", "2026-09-30")).toBeNull();
		expect(due("2026-10-30", "2026-09-30")).toBe("2026-10-30");
		expect(due("2026-11-04", "2026-09-30")).toBe("2026-10-30");
		expect(due("2026-11-04", "2026-10-30")).toBeNull();
		expect(due("2026-11-04", null)).toBe("2026-10-30");
		// February has no 30th: its last day.
		expect(due("2027-03-02", "2027-01-30")).toBe("2027-02-28");
		expect(due("2027-01-03", "2026-11-30")).toBe("2026-12-30");
		expect(due("2026-11-04", null, null)).toBeNull();
	});
});
