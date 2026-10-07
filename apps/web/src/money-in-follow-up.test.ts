import { describe, expect, it } from "vitest";
import { type MoneyInLine, moneyInFollowUp } from "./money-in";

// After a Parent says what money in is, its row stays open only while something more is asked
// (issue 131): whose pay, what it pays back, which purchase, which Account.

const line = (over: Partial<MoneyInLine>): MoneyInLine =>
	({
		id: "in",
		date: "2026-10-05",
		amount: 2_000,
		note: "GUSTO ACME",
		kind: "income",
		needsReview: false,
		paired: false,
		accountId: "chase",
		otherAccountId: null,
		whosePay: null,
		...over,
	}) as MoneyInLine;

const accounts = [{ id: "chase" }, { id: "gusto" }];

describe("moneyInFollowUp", () => {
	it("asks nothing of a line still waiting in Review", () => {
		expect(moneyInFollowUp(line({ kind: "paid-back", needsReview: true }), accounts)).toBeNull();
	});

	it("asks whose pay Income is, when it has wording to know it by", () => {
		expect(moneyInFollowUp(line({}), accounts)).toBe("whose-pay");
		expect(moneyInFollowUp(line({ note: " " }), accounts)).toBeNull();
	});

	it("asks what Paid back pays back and which purchase a Refund is for", () => {
		expect(moneyInFollowUp(line({ kind: "paid-back" }), accounts)).toBe("paid-back");
		expect(moneyInFollowUp(line({ kind: "refund", note: null }), accounts)).toBe("refund");
	});

	it("asks which Account a one-sided Transfer came from only when there is another to name", () => {
		const transfer = line({ kind: "transfer" });
		expect(moneyInFollowUp(transfer, accounts)).toBe("pair");
		expect(moneyInFollowUp(transfer, [{ id: "chase" }])).toBeNull();
		expect(moneyInFollowUp(transfer, [])).toBeNull();
		expect(moneyInFollowUp(line({ kind: "transfer", paired: true }), accounts)).toBeNull();
		expect(
			moneyInFollowUp(line({ kind: "transfer", otherAccountId: "gusto" }), accounts),
		).toBeNull();
		expect(moneyInFollowUp(line({ kind: "transfer", accountId: null }), accounts)).toBeNull();
	});

	it("asks nothing after Between us", () => {
		expect(moneyInFollowUp(line({ kind: "between-us" }), accounts)).toBeNull();
	});
});
