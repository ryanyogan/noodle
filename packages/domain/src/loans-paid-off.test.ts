import { describe, expect, it } from "vitest";
import {
	endedOrPaidOff,
	type LoanPayment,
	loanInStep,
	loanPaidOffOn,
	NO_LOAN_FACTS,
	paymentSchedule,
} from "./loans";
import type { DayKey } from "./month";

const day = (text: string) => text as DayKey;
const paid = (date: string, amount: number): LoanPayment => ({ date: day(date), amount });
const balance = (amount: number, on: string) => ({ amount, day: day(on) });

describe("loanPaidOffOn", () => {
	it("is the day of the payment that brings what's owed to exactly $0", () => {
		const payments = [paid("2026-09-15", 5_000), paid("2026-10-15", 5_000)];
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), payments)).toBe("2026-10-15");
	});

	it("is null while anything is owed, and with no balance", () => {
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), [paid("2026-09-15", 5_000)])).toBeNull();
		expect(loanPaidOffOn(null, [paid("2026-09-15", 5_000)])).toBeNull();
	});

	it("is the first payment that covers it when the loan was overpaid, not a later one", () => {
		const payments = [
			paid("2026-09-15", 7_000),
			paid("2026-10-15", 7_000),
			paid("2026-11-15", 7_000),
		];
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), payments)).toBe("2026-10-15");
	});

	it("takes a last payment smaller than the others", () => {
		const payments = [paid("2026-09-15", 6_000), paid("2026-10-15", 1_234)];
		expect(loanPaidOffOn(balance(7_234, "2026-08-20"), payments)).toBe("2026-10-15");
	});

	it("is null again once the payment that paid it off is deleted", () => {
		const payments = [paid("2026-09-15", 5_000), paid("2026-10-15", 5_000)];
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), payments.slice(0, 1))).toBeNull();
	});

	it("is null again when the payment that paid it off is handed back", () => {
		const payments = [paid("2026-10-15", 10_000), paid("2026-10-20", -10_000)];
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), payments)).toBeNull();
		expect(
			loanPaidOffOn(balance(10_000, "2026-08-20"), [...payments, paid("2026-11-02", 10_000)]),
		).toBe("2026-11-02");
	});

	it("reads payments in the order they are dated, whatever order they are given in", () => {
		const payments = [paid("2026-10-15", 5_000), paid("2026-09-15", 5_000)];
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), payments)).toBe("2026-10-15");
	});

	it("leaves out a payment on the balance's day or before: it is in the balance already", () => {
		const payments = [paid("2026-08-20", 10_000), paid("2026-08-01", 10_000)];
		expect(loanPaidOffOn(balance(10_000, "2026-08-20"), payments)).toBeNull();
	});

	it("is the balance's own day when the balance says nothing is owed", () => {
		expect(loanPaidOffOn(balance(0, "2026-10-03"), [])).toBe("2026-10-03");
		expect(loanPaidOffOn(balance(-500, "2026-10-03"), [paid("2026-10-09", 100)])).toBe(
			"2026-10-03",
		);
	});

	it("is null again once a balance above $0 is entered", () => {
		expect(loanPaidOffOn(balance(2_500, "2026-10-20"), [paid("2026-10-15", 10_000)])).toBeNull();
	});

	it("asks only the bank's balance about a connected loan", () => {
		expect(
			loanPaidOffOn(balance(10_000, "2026-08-20"), [paid("2026-10-15", 10_000)], true),
		).toBeNull();
		expect(loanPaidOffOn(balance(0, "2026-10-03"), [], true)).toBe("2026-10-03");
	});
});

describe("endedOrPaidOff", () => {
	it("ends the Commitment from the month after the loan was paid off", () => {
		expect(endedOrPaidOff(null, day("2026-10-15"))).toBe("2026-11");
		expect(endedOrPaidOff(null, day("2026-12-31"))).toBe("2027-01");
	});

	it("keeps a Parent's own end when it comes first, and when nothing is paid off", () => {
		expect(endedOrPaidOff("2026-09", day("2026-10-15"))).toBe("2026-09");
		expect(endedOrPaidOff("2026-11", day("2026-10-15"))).toBe("2026-11");
		expect(endedOrPaidOff("2027-03", null)).toBe("2027-03");
		expect(endedOrPaidOff(null, null)).toBeNull();
	});

	it("is the pay-off's month when a Parent's end comes later", () => {
		expect(endedOrPaidOff("2027-03", day("2026-10-15"))).toBe("2026-11");
	});
});

describe("loanInStep", () => {
	const facts = { ...NO_LOAN_FACTS, borrowed: 60_000, payment: 5_000, dueDay: 15 };

	it("takes the payment and due day from the monthly Commitment that pays it down", () => {
		const terms = { amount: 6_500, cadence: "monthly", dueDate: day("2026-10-31") };
		expect(loanInStep(facts, terms)).toEqual({ ...facts, payment: 6_500, dueDay: 31 });
	});

	it("leaves the facts as given with no Commitment, or one that isn't monthly", () => {
		expect(loanInStep(facts, null)).toEqual(facts);
		const yearly = { amount: 60_000, cadence: "yearly", dueDate: day("2026-10-01") };
		expect(loanInStep(facts, yearly)).toEqual(facts);
	});
});

describe("paymentSchedule", () => {
	const loan = { payment: 5_000, dueDay: 15, endsOn: null };
	const states = (schedule: ReturnType<typeof paymentSchedule>) =>
		schedule?.payments.map((p) => `${p.date} ${p.state}`);

	it("is null without a due day, a balance, or a payment or end to work from", () => {
		const input = { ...loan, owed: 10_000, today: day("2026-10-08"), payments: [] };
		expect(paymentSchedule({ ...input, dueDay: null })).toBeNull();
		expect(paymentSchedule({ ...input, owed: null })).toBeNull();
		expect(paymentSchedule({ ...input, payment: null })).toBeNull();
	});

	it("lists only the payments to come before any is made", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 10_000,
			today: day("2026-10-08"),
			payments: [],
		});
		expect(states(schedule)).toEqual(["2026-10-15 to-come", "2026-11-15 to-come"]);
		expect(schedule?.left).toBe(2);
		expect(schedule?.paidOffOn).toBe("2026-11-15");
	});

	it("shows a payment made with the day and amount really paid, then what is left", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 5_000,
			today: day("2026-10-08"),
			payments: [paid("2026-10-06", 5_000)],
		});
		expect(schedule?.payments).toEqual([
			{
				date: "2026-10-15",
				amount: 5_000,
				state: "paid",
				paid: 5_000,
				paidOn: "2026-10-06",
				payments: 1,
			},
			{ date: "2026-11-15", amount: 5_000, state: "to-come", paid: 0, paidOn: null, payments: 0 },
		]);
		expect(schedule?.left).toBe(1);
	});

	it("is all paid, with nothing to come, when the loan is paid off exactly", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 0,
			today: day("2026-10-20"),
			payments: [paid("2026-09-15", 5_000), paid("2026-10-15", 5_000)],
		});
		expect(states(schedule)).toEqual(["2026-09-15 paid", "2026-10-15 paid"]);
		expect(schedule?.left).toBe(0);
		expect(schedule?.paidOffOn).toBeNull();
	});

	it("counts an overpaid loan's payments as paid, with what was really paid", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: -2_000,
			today: day("2026-10-20"),
			payments: [paid("2026-09-15", 5_000), paid("2026-10-15", 7_000)],
		});
		expect(states(schedule)).toEqual(["2026-09-15 paid", "2026-10-15 paid"]);
		expect(schedule?.payments[1]).toMatchObject({ amount: 5_000, paid: 7_000 });
	});

	it("counts a smaller last payment as paid when it pays the loan off", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 0,
			today: day("2026-10-20"),
			payments: [paid("2026-09-15", 5_000), paid("2026-10-15", 1_234)],
		});
		expect(states(schedule)).toEqual(["2026-09-15 paid", "2026-10-15 paid"]);
	});

	it("says a smaller payment is partly paid while the loan still owes", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 8_000,
			today: day("2026-10-20"),
			payments: [paid("2026-10-15", 2_000)],
		});
		expect(states(schedule)).toEqual([
			"2026-10-15 partly",
			"2026-11-15 to-come",
			"2026-12-15 to-come",
		]);
		// What the short month left is in what's owed: the last payment to come is the remainder.
		expect(schedule?.payments[2]?.amount).toBe(3_000);
	});

	it("brings the payments back when the one that paid it off is deleted", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 5_000,
			today: day("2026-10-20"),
			payments: [paid("2026-09-15", 5_000)],
		});
		expect(states(schedule)).toEqual(["2026-09-15 paid", "2026-10-15 due"]);
		expect(schedule?.left).toBe(1);
		expect(schedule?.paidOffOn).toBe("2026-10-15");
	});

	it("judges two payments in one month together", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 5_000,
			today: day("2026-10-28"),
			payments: [paid("2026-10-03", 2_500), paid("2026-10-24", 2_500)],
		});
		expect(schedule?.payments[0]).toEqual({
			date: "2026-10-15",
			amount: 5_000,
			state: "paid",
			paid: 5_000,
			paidOn: "2026-10-24",
			payments: 2,
		});
		expect(states(schedule)).toEqual(["2026-10-15 paid", "2026-11-15 to-come"]);
	});

	it("says a month with nothing paid was missed, between months that were paid", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 10_000,
			today: day("2026-10-08"),
			payments: [paid("2026-07-15", 5_000), paid("2026-09-16", 5_000)],
		});
		expect(states(schedule)).toEqual([
			"2026-07-15 paid",
			"2026-08-15 missed",
			"2026-09-15 paid",
			"2026-10-15 to-come",
			"2026-11-15 to-come",
		]);
	});

	it("says this month's is due once its due day is here with nothing paid", () => {
		const input = { ...loan, owed: 10_000, payments: [paid("2026-09-15", 5_000)] };
		expect(states(paymentSchedule({ ...input, today: day("2026-10-14") }))).toEqual([
			"2026-09-15 paid",
			"2026-10-15 to-come",
			"2026-11-15 to-come",
		]);
		expect(states(paymentSchedule({ ...input, today: day("2026-10-15") }))).toEqual([
			"2026-09-15 paid",
			"2026-10-15 due",
			"2026-11-15 to-come",
		]);
	});

	it("stops at the payment that paid it off early, before the day it was to end", () => {
		const schedule = paymentSchedule({
			...loan,
			endsOn: day("2027-03-15"),
			owed: 0,
			today: day("2026-12-02"),
			payments: [paid("2026-09-15", 5_000), paid("2026-10-09", 25_000)],
		});
		expect(states(schedule)).toEqual(["2026-09-15 paid", "2026-10-15 paid"]);
		expect(schedule?.left).toBe(0);
	});

	it("leaves out a payment dated ahead of today, and a month whose payment was handed back", () => {
		const schedule = paymentSchedule({
			...loan,
			owed: 10_000,
			today: day("2026-10-08"),
			payments: [paid("2026-10-02", 5_000), paid("2026-10-05", -5_000), paid("2026-10-30", 5_000)],
		});
		expect(states(schedule)).toEqual(["2026-10-15 to-come", "2026-11-15 to-come"]);
	});

	it("takes what was paid as what was asked when only the end is said", () => {
		const schedule = paymentSchedule({
			payment: null,
			dueDay: 15,
			endsOn: day("2026-12-15"),
			owed: 9_000,
			today: day("2026-10-08"),
			payments: [paid("2026-08-15", 3_000)],
		});
		expect(states(schedule)).toEqual([
			"2026-08-15 paid",
			"2026-10-15 to-come",
			"2026-11-15 to-come",
			"2026-12-15 to-come",
		]);
	});

	it("uses the last day of a shorter month for a due day it doesn't have", () => {
		const schedule = paymentSchedule({
			payment: 5_000,
			dueDay: 31,
			endsOn: null,
			owed: 5_000,
			today: day("2027-02-10"),
			payments: [paid("2027-01-31", 5_000)],
		});
		expect(states(schedule)).toEqual(["2027-01-31 paid", "2027-02-28 to-come"]);
	});
});
