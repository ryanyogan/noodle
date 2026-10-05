import { describe, expect, it } from "vitest";
import type { DayKey, PayingCommitment, PaymentAccount } from "./index";
import { paymentsTo, suggestPayment } from "./index";

const line = (date: string, dollars: number, text = "AMERICAN EXPRESS ACH PMT M8054 WEB") => ({
	text,
	amountCents: Math.round(dollars * 100),
	date: date as DayKey,
	from: "Checking",
});

describe("suggestPayment", () => {
	it("averages the last three full months, rounded to $10", () => {
		const lines = [
			line("2026-07-03", 1000),
			line("2026-07-20", 500),
			line("2026-08-15", 2000),
			line("2026-09-02", 1200),
			line("2026-09-12", 800),
			line("2026-09-28", 400),
		];
		expect(suggestPayment(lines, "2026-10")).toEqual({
			amountCents: 197_000,
			payments: 6,
			months: 3,
			exact: false,
		});
	});

	it("leaves out this month, earlier months and money back", () => {
		const lines = [
			line("2026-06-30", 9000),
			line("2026-08-15", 300),
			line("2026-09-15", 500),
			line("2026-09-20", -100),
			line("2026-10-01", 9000),
		];
		// Paid for two months: averaged over those two, not three.
		expect(suggestPayment(lines, "2026-10")).toEqual({
			amountCents: 40_000,
			payments: 2,
			months: 2,
			exact: false,
		});
	});

	it("counts a month with no payment after the first one paid", () => {
		const lines = [line("2026-07-10", 600), line("2026-09-10", 300)];
		expect(suggestPayment(lines, "2026-10")?.amountCents).toBe(30_000);
		expect(suggestPayment(lines, "2026-10")?.months).toBe(3);
	});

	it("gives a payment that is the same every month to the cent", () => {
		const lines = [
			line("2026-07-01", 1843.27),
			line("2026-08-01", 1843.27),
			line("2026-09-01", 1843.27),
		];
		expect(suggestPayment(lines, "2026-10")).toEqual({
			amountCents: 184_327,
			payments: 3,
			months: 3,
			exact: true,
		});
	});

	it("rounds a small amount to the dollar", () => {
		const lines = [line("2026-08-01", 40.4), line("2026-09-01", 45.3)];
		expect(suggestPayment(lines, "2026-10")?.amountCents).toBe(43_00);
	});

	it("suggests nothing with too little history", () => {
		expect(suggestPayment([], "2026-10")).toBeNull();
		expect(suggestPayment([line("2026-09-01", 500)], "2026-10")).toBeNull();
		// Several payments, all in one month.
		expect(
			suggestPayment([line("2026-09-01", 500), line("2026-09-15", 700)], "2026-10"),
		).toBeNull();
		// Only this month's.
		expect(
			suggestPayment([line("2026-10-01", 500), line("2026-10-02", 700)], "2026-10"),
		).toBeNull();
	});
});

describe("paymentsTo", () => {
	const amex: PaymentAccount = {
		id: "amex",
		name: "American Express",
		kind: "credit-card",
		followed: false,
	};
	const chase: PaymentAccount = {
		id: "chase",
		name: "Chase Freedom",
		kind: "credit-card",
		followed: true,
	};
	const car: PaymentAccount = { id: "car", name: "Toyota loan", kind: "loan", followed: false };
	const lines = [
		line("2026-09-01", 612.5),
		line("2026-09-02", 400, "CHASE CREDIT CRD AUTOPAY"),
		line("2026-09-03", 389, "TOYOTA FINANCIAL RETAIL PAY"),
		line("2026-09-04", 80, "SAFEWAY #1234"),
		line("2026-09-05", 120, "ZELLE PAYMENT TO AMERICAN EXPRESS FAN"),
	];

	it("finds the lines Review would file in a Commitment paying that card down", () => {
		expect(paymentsTo("amex", lines, [amex, chase, car], []).map((l) => l.amountCents)).toEqual([
			61_250,
		]);
		expect(paymentsTo("car", lines, [amex, chase, car], []).map((l) => l.amountCents)).toEqual([
			38_900,
		]);
		// A card Noodle follows has payments too: a set payment on a balance being carried.
		expect(paymentsTo("chase", lines, [amex, chase, car], []).map((l) => l.amountCents)).toEqual([
			40_000,
		]);
	});

	it("leaves another Commitment's lines with it", () => {
		const paying: PayingCommitment[] = [
			{ id: "c1", name: "Amex payment", accountId: "amex", amountCents: 0, carriedBalance: false },
		];
		const gold: PaymentAccount = {
			id: "gold",
			name: "Gold card",
			kind: "credit-card",
			followed: false,
		};
		// The Amex line fits American Express by name, so it's never the Gold card's.
		expect(paymentsTo("gold", lines, [amex, gold], paying)).toEqual([]);
	});

	it("never takes a line out of the Account itself", () => {
		const own = [{ ...line("2026-09-01", 50), from: "American Express" }];
		expect(paymentsTo("amex", own, [amex], [])).toEqual([]);
	});
});
