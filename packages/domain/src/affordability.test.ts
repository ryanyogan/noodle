import { describe, expect, it } from "vitest";
import {
	anythingCheck,
	carCheck,
	dollars,
	estimateGrossIncome,
	type HomeInput,
	homeCheck,
	loanBalance,
	monthlyEquivalent,
	monthlyPayment,
	monthsToSave,
	type PlanNow,
	project,
	typicalFreeToSpend,
} from "./index";

// Worked US examples, each computed by hand in the comments (r is the monthly rate).

const plan: PlanNow = { month: "2026-09", baseline: 900_000, freeToSpend: 150_000 };

describe("loans amortize the standard way", () => {
	it("works out the fixed monthly payment", () => {
		// $320,000 at 6.5% for 30 years: r = 0.065 / 12 = 0.0054167, (1 + r)^360 = 6.99179,
		// payment = 320,000 × 0.0054167 × 6.99179 / 5.99179 = $2,022.62.
		expect(monthlyPayment(32_000_000, 6.5, 360)).toBe(202_262);
		// $200,000 at 6% for 15 years: r = 0.005, (1.005)^180 = 2.45409,
		// payment = 200,000 × 0.005 × 2.45409 / 1.45409 = $1,687.71.
		expect(monthlyPayment(20_000_000, 6, 180)).toBe(168_771);
		// $30,000 at 7% for 5 years: r = 0.0058333, (1 + r)^60 = 1.41763,
		// payment = 30,000 × 0.0058333 × 1.41763 / 0.41763 = $594.04.
		expect(monthlyPayment(3_000_000, 7, 60)).toBe(59_404);
	});

	it("splits a 0% loan evenly, and owes nothing on nothing", () => {
		expect(monthlyPayment(1_200_000, 0, 12)).toBe(100_000);
		expect(monthlyPayment(0, 7, 60)).toBe(0);
	});

	it("works out what's still owed after some payments", () => {
		// The $30,000 car loan after 36 payments: (1 + r)^36 = 1.23293,
		// 30,000 × 1.23293 − 594.04 × 0.23293 / 0.0058333 = 36,987.9 − 23,720.2 = $13,267.69.
		expect(loanBalance(3_000_000, 7, 60, 36)).toBe(1_326_769);
		expect(loanBalance(1_200_000, 0, 12, 3)).toBe(900_000);
		expect(loanBalance(3_000_000, 7, 60, 60)).toBe(0);
	});
});

describe("the Plan's numbers a Check starts from", () => {
	it("estimates gross income from the take-home Baseline at 75%", () => {
		// $9,000 take-home / 0.75 = $12,000 gross.
		expect(estimateGrossIncome(900_000)).toBe(1_200_000);
	});

	it("averages a Commitment to a month", () => {
		expect(monthlyEquivalent({ amount: 250_000, cadence: "monthly" })).toBe(250_000);
		// $1,000 every two weeks: 26 × 1,000 / 12 = $2,166.67.
		expect(monthlyEquivalent({ amount: 100_000, cadence: "biweekly" })).toBe(216_667);
		// $1,800 a year: $150.
		expect(monthlyEquivalent({ amount: 180_000, cadence: "annual" })).toBe(15_000);
	});

	it("takes a typical month's Free to Spend as the projection's average, rounded down", () => {
		const projection = project({
			months: [
				{ month: "2026-09", baseline: 100_000, buckets: [], commitments: [] },
				{ month: "2026-10", baseline: 100_001, buckets: [], commitments: [] },
			],
			goals: [],
		});
		expect(typicalFreeToSpend(projection)).toBe(100_000);
		expect(typicalFreeToSpend(project({ months: [], goals: [] }))).toBe(0);
	});

	it("counts months of saving: none when covered, never when nothing is set aside", () => {
		expect(monthsToSave(0, 0)).toBe(0);
		expect(monthsToSave(100_000, 30_000)).toBe(4);
		expect(monthsToSave(100_000, 0)).toBeNull();
	});

	it("writes dollars to the nearest dollar, negatives with a true minus", () => {
		expect(dollars(253_929)).toBe("$2,539");
		expect(dollars(-144_211)).toBe("−$1,442");
		expect(dollars(-49)).toBe("$0");
	});
});

describe("homeCheck: a worked example", () => {
	// A $400,000 home with 20% ($80,000) down at 6.5% for 30 years, 1.1% property tax, $1,800 a
	// year insurance, no HOA; $12,000 gross a month, $500 in other debts, replacing $2,500 rent.
	const home: HomeInput = {
		price: 40_000_000,
		downPayment: 8_000_000,
		cashAvailable: 10_000_000,
		closingCostRate: 3,
		rate: 6.5,
		termYears: 30,
		propertyTaxRate: 1.1,
		insurancePerYear: 180_000,
		pmiRate: 0.5,
		hoaPerMonth: 0,
		grossMonthlyIncome: 1_200_000,
		otherDebts: 50_000,
		replaced: 250_000,
		plan,
	};
	const check = homeCheck(home);

	it("works out the monthly housing cost", () => {
		// P&I $2,022.62 (above); tax 400,000 × 1.1% / 12 = $366.67; insurance $150; no PMI at 20%.
		expect(check).toMatchObject({
			loan: 32_000_000,
			principalAndInterest: 202_262,
			propertyTax: 36_667,
			insurance: 15_000,
			pmi: 0,
			hoa: 0,
			housing: 253_929,
		});
	});

	it("works out the cash needed: the down payment and 3% closing costs", () => {
		// $80,000 + 3% of $400,000 ($12,000) = $92,000, and $100,000 is set aside.
		expect(check.closingCosts).toBe(1_200_000);
		expect(check.cashNeeded).toBe(9_200_000);
		expect(check.cashReadyIn).toBe("2026-09");
	});

	it("works out both debt-to-income ratios against gross income", () => {
		// Front-end 2,539.29 / 12,000 = 21.2%; back-end (2,539.29 + 500) / 12,000 = 25.3%.
		expect(check.frontEnd).toBeCloseTo(0.2116, 4);
		expect(check.backEnd).toBeCloseTo(0.2533, 4);
	});

	it("is Comfortable, with every reason in plain words and numbers", () => {
		// Free to Spend: 1,500 + 2,500 rent − 2,539.29 = $1,460.71, above 5% of $9,000 ($450).
		expect(check.freeToSpendAfter).toBe(146_071);
		expect(check.verdict).toBe("comfortable");
		expect(check.reasons.map((r) => r.text)).toEqual([
			"You have $100,000 set aside for the $80,000 down payment and about $12,000 in closing costs.",
			"Housing would be $2,539 a month, 21.2% of gross income, within the usual 28%.",
			"With $500 a month in other debts, all debt payments would be $3,039 a month, 25.3% of gross income, within the usual 36%.",
			"Housing of $2,539 a month in place of $2,500 in Commitments would take Free to Spend from $1,500 to $1,461 a month.",
		]);
	});

	it("is Not Yet with 10% down, $30,000 set aside and no rent replaced", () => {
		// Loan $360,000: P&I 360,000 × 0.0054167 × 6.99179 / 5.99179 = $2,275.44; PMI
		// 360,000 × 0.5% / 12 = $150; housing 2,275.44 + 366.67 + 150 + 150 = $2,942.11.
		// Cash needed $40,000 + $12,000 = $52,000: $22,000 short, 15 months at $1,500 (Dec 2027).
		const tenDown = homeCheck({
			...home,
			downPayment: 4_000_000,
			cashAvailable: 3_000_000,
			replaced: 0,
		});
		expect(tenDown).toMatchObject({
			principalAndInterest: 227_544,
			pmi: 15_000,
			housing: 294_211,
			cashNeeded: 5_200_000,
			cashReadyIn: "2027-12",
			freeToSpendAfter: 150_000 - 294_211,
			verdict: "not-yet",
		});
		expect(tenDown.reasons.map((r) => r.tone)).toEqual([
			"not-yet",
			"note",
			"comfortable",
			"comfortable",
			"not-yet",
		]);
		expect(tenDown.reasons[0]?.text).toBe(
			"You have $30,000 set aside for the $40,000 down payment and about $12,000 in closing costs, $22,000 short. Setting aside all $1,500 of Free to Spend each month, that’s 15 months, by December 2027.",
		);
		expect(tenDown.reasons[1]?.text).toBe(
			"With less than 20% down, PMI adds $150 a month until the loan is paid down to 78% of the price.",
		);
		expect(tenDown.reasons[4]?.text).toBe(
			"Housing of $2,942 a month would take Free to Spend from $1,500 to −$1,442 a month: the Plan would need $1,442 a month less in Buckets or Goals.",
		);
	});
});

describe("homeCheck: thresholds at their edges", () => {
	// No loan, tax or insurance, so housing is exactly the HOA dues; $10,000 gross.
	const bare = (overrides: Partial<HomeInput>) =>
		homeCheck({
			price: 10_000_000,
			downPayment: 10_000_000,
			cashAvailable: 10_000_000,
			closingCostRate: 0,
			rate: 6,
			termYears: 30,
			propertyTaxRate: 0,
			insurancePerYear: 0,
			pmiRate: 0.5,
			hoaPerMonth: 100_000,
			grossMonthlyIncome: 1_000_000,
			otherDebts: 0,
			replaced: 1_000_000,
			plan,
			...overrides,
		});
	const tone = (check: ReturnType<typeof homeCheck>, starts: string) =>
		check.reasons.find((r) => r.text.startsWith(starts))?.tone;

	it("front-end: Comfortable up to 28%, a Stretch up to 31%, Not Yet above", () => {
		expect(tone(bare({ hoaPerMonth: 280_000 }), "Housing would")).toBe("comfortable");
		expect(tone(bare({ hoaPerMonth: 280_001 }), "Housing would")).toBe("stretch");
		expect(tone(bare({ hoaPerMonth: 310_000 }), "Housing would")).toBe("stretch");
		expect(tone(bare({ hoaPerMonth: 310_001 }), "Housing would")).toBe("not-yet");
		expect(bare({ hoaPerMonth: 310_001 }).verdict).toBe("not-yet");
	});

	it("back-end: Comfortable up to 36%, a Stretch up to 43%, Not Yet above", () => {
		expect(tone(bare({ otherDebts: 260_000 }), "With $2,600")).toBe("comfortable");
		expect(tone(bare({ otherDebts: 260_001 }), "With $2,600")).toBe("stretch");
		expect(tone(bare({ otherDebts: 330_000 }), "With $3,300")).toBe("stretch");
		expect(tone(bare({ otherDebts: 330_001 }), "With $3,300")).toBe("not-yet");
	});

	it("the Plan: Comfortable at 5% of the Baseline left, a Stretch down to zero, Not Yet below", () => {
		// Free to Spend 1,500 + replaced − 1,000 HOA; the cushion is 5% of $9,000 = $450.
		const leaving = (left: number) => bare({ replaced: 100_000 - 150_000 + left });
		expect(leaving(45_000).freeToSpendAfter).toBe(45_000);
		expect(tone(leaving(45_000), "Housing of")).toBe("comfortable");
		expect(tone(leaving(44_999), "Housing of")).toBe("stretch");
		expect(tone(leaving(0), "Housing of")).toBe("stretch");
		expect(tone(leaving(-1), "Housing of")).toBe("not-yet");
	});

	it("cash: Comfortable when exactly enough is set aside, Not Yet a cent short", () => {
		expect(tone(bare({ cashAvailable: 10_000_000 }), "You have")).toBe("comfortable");
		expect(tone(bare({ cashAvailable: 9_999_999 }), "You have")).toBe("not-yet");
	});

	it("PMI: none at exactly 20% down, charged a cent under it", () => {
		expect(bare({ downPayment: 2_000_000 }).pmi).toBe(0);
		// $80,000.01 loan × 0.5% / 12 = $33.33.
		expect(bare({ downPayment: 1_999_999 }).pmi).toBe(3_333);
	});

	it("asks for gross income rather than judging against none", () => {
		const check = bare({ grossMonthlyIncome: 0 });
		expect(check.verdict).toBe("not-yet");
		expect(check.reasons.map((r) => r.text)).toContain(
			"Enter gross monthly income to compare against it.",
		);
	});
});

describe("carCheck: cash vs loan vs lease", () => {
	// A $35,000 car over 3 years, losing 20% of its value a year: worth 35,000 × 0.8^3 = $17,920.
	// Loan: $5,000 down, $30,000 at 7% for 5 years ($594.04). Lease: $450 a month for 36 months,
	// $3,000 due at signing. $40,000 set aside.
	const car = carCheck({
		price: 3_500_000,
		cashAvailable: 4_000_000,
		loan: { downPayment: 500_000, rate: 7, months: 60 },
		lease: { monthly: 45_000, months: 36, dueAtSigning: 300_000 },
		running: 0,
		depreciationRate: 20,
		horizonMonths: 36,
		replaced: 0,
		plan,
	});

	it("cash: pays the price, and it's worth $17,920 at the end", () => {
		// 35,000 − 17,920 = $17,080 all in.
		expect(car.cash).toMatchObject({
			upfront: 3_500_000,
			payment: 0,
			worthAtEnd: 1_792_000,
			totalCost: 1_708_000,
			freeToSpendAfter: 150_000,
			verdict: "comfortable",
		});
	});

	it("loan: counts what's still owed against what the car is worth", () => {
		// Paid 5,000 + 36 × 594.04 = $26,385.44; owed $13,267.69 after 36 payments, so it's worth
		// 17,920 − 13,267.69 = $4,652.31; all in 26,385.44 − 4,652.31 = $21,733.13.
		expect(car.loan).toMatchObject({
			upfront: 500_000,
			payment: 59_404,
			paid: 2_638_544,
			worthAtEnd: 465_231,
			totalCost: 2_173_313,
			freeToSpendAfter: 150_000 - 59_404,
			verdict: "comfortable",
		});
		expect(car.loan.reasons.map((r) => r.text)).toEqual([
			"You have $40,000 set aside for the $5,000 down payment.",
			"The $594 payment a month is 6.6% of the Baseline, within the 10% a car can comfortably take.",
			"$594 a month would take Free to Spend from $1,500 to $906 a month.",
			"Over 3 years it costs about $21,733 all in, counting the $4,652 it’s worth at the end.",
		]);
	});

	it("lease: ends worth nothing, and is signed again when a term ends", () => {
		// 3,000 + 36 × 450 = $19,200 over 3 years.
		expect(car.lease).toMatchObject({ paid: 1_920_000, worthAtEnd: 0, totalCost: 1_920_000 });
		// Over 5 years it's signed twice: 2 × 3,000 + 60 × 450 = $33,000.
		const longer = carCheck({
			price: 3_500_000,
			cashAvailable: 4_000_000,
			loan: { downPayment: 500_000, rate: 7, months: 60 },
			lease: { monthly: 45_000, months: 36, dueAtSigning: 300_000 },
			running: 0,
			depreciationRate: 20,
			horizonMonths: 60,
			replaced: 0,
			plan,
		});
		expect(longer.lease.totalCost).toBe(3_300_000);
		// The loan is paid off: 5,000 + 60 × 594.04, less 35,000 × 0.8^5 ($11,468.80).
		expect(longer.loan.worthAtEnd).toBe(1_146_880);
		expect(longer.loan.totalCost).toBe(500_000 + 60 * 59_404 - 1_146_880);
	});

	it("is Not Yet in cash when the price isn't set aside, with when it could be", () => {
		const short = carCheck({
			price: 3_500_000,
			cashAvailable: 2_000_000,
			loan: { downPayment: 500_000, rate: 7, months: 84 },
			lease: { monthly: 45_000, months: 36, dueAtSigning: 300_000 },
			running: 0,
			depreciationRate: 20,
			horizonMonths: 36,
			replaced: 0,
			plan,
		});
		// $15,000 short at $1,500 a month: 10 months, July 2027.
		expect(short.cash.verdict).toBe("not-yet");
		expect(short.cash.cashReadyIn).toBe("2027-07");
		expect(short.loan.reasons.map((r) => r.tone)).toContain("note");
	});

	it("car costs: Comfortable up to 10% of the Baseline, a Stretch above", () => {
		const leaseAt = (monthly: number) =>
			carCheck({
				price: 3_500_000,
				cashAvailable: 4_000_000,
				loan: { downPayment: 500_000, rate: 7, months: 60 },
				lease: { monthly, months: 36, dueAtSigning: 0 },
				running: 10_000,
				depreciationRate: 20,
				horizonMonths: 36,
				replaced: 0,
				plan: { ...plan, freeToSpend: 500_000 },
			}).lease;
		// $800 + $100 running = $900 = 10% of $9,000.
		expect(leaseAt(80_000).verdict).toBe("comfortable");
		expect(leaseAt(80_001).verdict).toBe("stretch");
		expect(leaseAt(80_000).reasons[1]?.text).toBe(
			"The $800 payment and $100 running costs a month are 10.0% of the Baseline, within the 10% a car can comfortably take.",
		);
	});
});

describe("anythingCheck: months until it's affordable", () => {
	const at = (saved: number, monthly = 50_000) =>
		anythingCheck({ price: 600_000, saved, monthly, month: "2026-09" });

	it("works out the months and the month", () => {
		// $6,000 with $1,500 saved and $500 a month: 4,500 / 500 = 9 months, June 2027.
		expect(at(150_000)).toMatchObject({
			shortfall: 450_000,
			months: 9,
			affordableIn: "2027-06",
			verdict: "stretch",
		});
		expect(at(150_000).reasons[0]?.text).toBe(
			"You have $1,500 set aside, $4,500 short of $6,000. At $500 a month, that’s 9 months, by June 2027.",
		);
	});

	it("is Comfortable now, a Stretch within 12 months, Not Yet beyond", () => {
		expect(at(600_000)).toMatchObject({
			months: 0,
			affordableIn: "2026-09",
			verdict: "comfortable",
		});
		// 6,000 / 500 = 12 months exactly.
		expect(at(0)).toMatchObject({ months: 12, verdict: "stretch" });
		expect(at(0, 49_999)).toMatchObject({ months: 13, verdict: "not-yet" });
	});

	it("is Not Yet, with no date, when nothing can be set aside", () => {
		expect(at(0, 0)).toMatchObject({ months: null, affordableIn: null, verdict: "not-yet" });
	});
});
