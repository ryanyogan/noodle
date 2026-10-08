import { describe, expect, it } from "vitest";
import {
	type LoanPaidDown,
	lenderPayment,
	loanByAmount,
	loansNamed,
	loansRuledByAmount,
	ruledLoanPayment,
} from "./index";

const loan = (name: string, paymentCents: number, id = name): LoanPaidDown => ({
	accountId: `account-${id}`,
	name,
	commitmentId: `commitment-${id}`,
	commitment: name,
	paymentCents,
});

const sofa = loan("Zipline sofa", 4_500);
const bike = loan("Zipline bike", 12_000);
const car = loan("Car loan", 31_000);
const line = (text: string, amountCents: number, merchant: string | null = null) => ({
	text,
	merchant,
	amountCents,
});

describe("loansNamed", () => {
	it("names a loan when the bank's wording says the lender and nothing else", () => {
		expect(loansNamed({ text: "ZIPLINE.COM PAYMENTS" }, [sofa, car])).toEqual([sofa]);
		expect(loansNamed({ text: "ACH DEBIT ZIPLINE INC PYMT 88213" }, [sofa])).toEqual([sofa]);
	});

	it("reads the merchant's name when the wording carries more", () => {
		const said = { text: "ZIPLINE * PAY 0042 HARBORVIEW", merchant: "Zipline" };
		expect(loansNamed({ text: said.text }, [sofa])).toEqual([]);
		expect(loansNamed(said, [sofa])).toEqual([sofa]);
	});

	it("names every loan at the lender", () => {
		expect(loansNamed({ text: "ZIPLINE PAYMENTS" }, [sofa, bike, car])).toEqual([sofa, bike]);
	});

	it("goes by the Commitment's name too", () => {
		const renamed = { ...loan("Sofa", 4_500), commitment: "Zipline instalments" };
		expect(loansNamed({ text: "ZIPLINE PAYMENTS" }, [renamed])).toEqual([renamed]);
	});

	it("doesn't take a line that only shares a word with the loan's name", () => {
		expect(loansNamed({ text: "SOFA WAREHOUSE" }, [sofa])).toEqual([]);
		expect(loansNamed({ text: "ZIPLINE ADVENTURE PARK" }, [sofa])).toEqual([]);
		expect(loansNamed({ text: "ZIPLINES R US", merchant: "Ziplines" }, [sofa])).toEqual([]);
	});

	it("never goes by the words any loan has", () => {
		expect(loansNamed({ text: "CAR WASH" }, [car])).toEqual([]);
		expect(loansNamed({ text: "AUTO LOAN PAYMENT" }, [car])).toEqual([]);
		expect(loansNamed({ text: "ONLINE PAYMENT THANK YOU" }, [sofa, car])).toEqual([]);
		expect(loansNamed({ text: "" }, [sofa])).toEqual([]);
	});

	it("takes a shared word once a Rule has said what the line is", () => {
		const said = { text: "ZIPLINE * PAY 0042 HARBORVIEW" };
		expect(loansNamed(said, [sofa, bike, car], "mentions")).toEqual([sofa, bike]);
	});
});

describe("loanByAmount", () => {
	it("is the only loan, whatever the amount", () => {
		expect(loanByAmount(9_999, [sofa])).toEqual({ loan: sofa, by: "only" });
	});

	it("is the loan whose payment it is, to the cent", () => {
		expect(loanByAmount(12_000, [sofa, bike])).toEqual({ loan: bike, by: "exact" });
	});

	it("is the nearest when none is exact", () => {
		expect(loanByAmount(4_750, [sofa, bike])).toEqual({ loan: sofa, by: "closest" });
	});

	it("doesn't say when two have the same payment, or are as near", () => {
		const twin = loan("Zipline desk", 4_500);
		expect(loanByAmount(4_500, [sofa, twin])).toEqual({ loan: null });
		expect(loanByAmount(8_250, [sofa, bike])).toEqual({ loan: null });
		expect(loanByAmount(4_500, [])).toEqual({ loan: null });
	});

	it("takes the exact one over a nearer pair", () => {
		const desk = loan("Zipline desk", 4_600);
		expect(loanByAmount(4_600, [sofa, desk, bike])).toEqual({ loan: desk, by: "exact" });
	});
});

describe("lenderPayment", () => {
	it("suggests the one loan at the lender", () => {
		expect(lenderPayment(line("ZIPLINE.COM PAYMENTS", 4_500), [sofa, car])).toEqual({
			kind: "loan",
			loan: sofa,
			by: "only",
			among: [sofa],
		});
	});

	it("picks between two loans at one lender by the amount", () => {
		expect(lenderPayment(line("ZIPLINE.COM PAYMENTS", 12_000), [sofa, bike])).toEqual({
			kind: "loan",
			loan: bike,
			by: "exact",
			among: [sofa, bike],
		});
		expect(lenderPayment(line("ZIPLINE.COM PAYMENTS", 4_400), [sofa, bike])).toMatchObject({
			kind: "loan",
			loan: sofa,
			by: "closest",
		});
	});

	it("asks which when two loans at one lender have the same payment", () => {
		const twin = loan("Zipline desk", 4_500);
		expect(lenderPayment(line("ZIPLINE.COM PAYMENTS", 4_500), [sofa, twin, car])).toEqual({
			kind: "which",
			among: [sofa, twin],
		});
	});

	it("is nothing for a line that names no loan, or loosely resembles one", () => {
		expect(lenderPayment(line("HARBORVIEW GROCERY", 4_500), [sofa, bike])).toBeNull();
		expect(lenderPayment(line("SOFA WAREHOUSE", 4_500), [sofa, bike])).toBeNull();
		expect(lenderPayment(line("ZIPLINE.COM PAYMENTS", 4_500), [])).toBeNull();
	});

	it("is nothing for money back", () => {
		expect(lenderPayment(line("ZIPLINE.COM PAYMENTS", -4_500), [sofa])).toBeNull();
	});
});

describe("ruledLoanPayment", () => {
	const said = line("ZIPLINE.COM PAYMENTS", 12_000);

	it("leaves a Rule as stated when its Commitment pays down no loan", () => {
		expect(ruledLoanPayment("commitment-rent", said, [sofa, bike])).toBeNull();
	});

	it("leaves a Rule as stated for the only loan at the lender, whatever the amount", () => {
		expect(ruledLoanPayment(sofa.commitmentId, said, [sofa, car])).toBeNull();
	});

	it("sends each payment to the loan whose payment it is", () => {
		expect(ruledLoanPayment(sofa.commitmentId, said, [sofa, bike])).toEqual({
			commitmentId: bike.commitmentId,
		});
		expect(
			ruledLoanPayment(sofa.commitmentId, line("ZIPLINE.COM PAYMENTS", 4_500), [sofa, bike]),
		).toEqual({ commitmentId: sofa.commitmentId });
	});

	it("asks when no loan's payment is the amount, or two are", () => {
		const twin = loan("Zipline desk", 12_000);
		expect(
			ruledLoanPayment(sofa.commitmentId, line("ZIPLINE.COM PAYMENTS", 4_750), [sofa, bike]),
		).toBe("ask");
		expect(ruledLoanPayment(sofa.commitmentId, said, [sofa, bike, twin])).toBe("ask");
	});

	it("leaves a Rule a Parent stated for another wording alone", () => {
		expect(
			ruledLoanPayment(sofa.commitmentId, line("SOFA WAREHOUSE", 12_000), [sofa, bike]),
		).toBeNull();
	});
});

describe("loansRuledByAmount", () => {
	it("says the loans a lender's Rule chooses between, its own among them", () => {
		expect(
			loansRuledByAmount(sofa.commitmentId, "zipline.com payments", [sofa, bike, car]),
		).toEqual([sofa, bike]);
	});

	it("says none for the only loan at the lender, or a Rule into no loan's Commitment", () => {
		expect(loansRuledByAmount(sofa.commitmentId, "zipline", [sofa, car])).toEqual([]);
		expect(loansRuledByAmount("commitment-rent", "zipline", [sofa, bike])).toEqual([]);
	});

	it("says none for a Rule stated for another wording, as its payments are filed", () => {
		expect(loansRuledByAmount(sofa.commitmentId, "sofa warehouse", [sofa, bike])).toEqual([]);
	});
});
