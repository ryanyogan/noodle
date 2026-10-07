import { describe, expect, it } from "vitest";
import { owedOn } from "./goals";
import {
	accountForWalletCard,
	balanceCheck,
	cardKept,
	cardKeptUnasked,
	cardPaymentIsSpending,
	statementCheckDue,
	statementsFollowed,
	suggestedPurchases,
} from "./hand-kept";
import type { DayKey } from "./month";

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

describe("a payment to a card", () => {
	it("is the spending on a card kept by hand that a Commitment pays down", () => {
		expect(cardPaymentIsSpending("hand", true)).toBe(true);
	});
	it("is the spending on a card not asked yet that a Commitment pays down", () => {
		const kept = cardKept({ bankConnectionId: null, purchases: null, followed: false });
		expect(cardPaymentIsSpending(kept, true)).toBe(true);
	});
	it("is the spending on a card whose purchases never come in, paid down by a Commitment", () => {
		expect(cardPaymentIsSpending("none", true)).toBe(true);
	});
	it("is a Transfer naming the card when no Commitment pays it down", () => {
		expect(cardPaymentIsSpending("hand", false)).toBe(false);
		expect(cardPaymentIsSpending("none", false)).toBe(false);
		expect(cardPaymentIsSpending(null, false)).toBe(false);
	});
	it("is a Transfer on a card kept by its statements or its bank, Commitment or not", () => {
		expect(cardPaymentIsSpending("statements", true)).toBe(false);
		expect(cardPaymentIsSpending("bank", true)).toBe(false);
		// Not asked, but a statement's purchases came in lately: by statements.
		const followed = cardKept({ bankConnectionId: null, purchases: null, followed: true });
		expect(cardPaymentIsSpending(followed, true)).toBe(false);
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

describe("asking how a card's purchases get in", () => {
	const card = {
		kind: "credit-card",
		bankConnectionId: null,
		purchases: null,
		lastStatementDate: null,
	} as const;
	const today = "2026-10-06" as DayKey;

	it("asks about a card nobody has answered for", () => {
		expect(cardKeptUnasked(card, today)).toBe(true);
	});

	it("doesn't ask about a card whose statements were imported in the last 60 days", () => {
		expect(cardKeptUnasked({ ...card, lastStatementDate: "2026-08-07" as DayKey }, today)).toBe(
			false,
		);
		expect(statementsFollowed("2026-08-07" as DayKey, today)).toBe(true);
	});

	it("asks again once its last statement is more than 60 days old", () => {
		expect(cardKeptUnasked({ ...card, lastStatementDate: "2026-08-06" as DayKey }, today)).toBe(
			true,
		);
	});

	it("never asks about a connected card, an answered one, or another kind of Account", () => {
		expect(cardKeptUnasked({ ...card, bankConnectionId: "bank" }, today)).toBe(false);
		expect(cardKeptUnasked({ ...card, purchases: "none" }, today)).toBe(false);
		expect(cardKeptUnasked({ ...card, kind: "loan" }, today)).toBe(false);
	});
});

describe("What a new card's name suggests for how its purchases get in", () => {
	it("suggests by hand for an Apple Card, however it's written", () => {
		for (const name of [
			"Apple Card",
			"AppleCard",
			"apple card",
			"Apple Titanium",
			"Cori’s Apple Card",
		]) {
			expect(suggestedPurchases(name)).toBe("hand");
		}
	});

	it("suggests nothing for any other card, so the Parent has to choose", () => {
		for (const name of [
			"",
			"Visa",
			"Chase Freedom",
			"Apple",
			"Pineapple Cardigan Co",
			"Snapple card",
		]) {
			expect(suggestedPurchases(name)).toBeNull();
		}
	});
});
