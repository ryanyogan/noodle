import type { Cents } from "./money";
import { addMonths, type MonthKey } from "./month";
import type { Projection } from "./scenario";

// Affordability Checks: can the Household take on a home, a car, or anything else, against the
// Plan, Goals and Earmarks? Each answers Comfortable, Stretch or Not Yet, always with the reasons
// (plain sentences with the numbers that drove them); the verdict is the worst of its reasons.
//
// The model is plain and US-centric, so a Parent can check any number by hand:
// - Loans amortize the standard way: a fixed payment P·r / (1 − (1 + r)^−n) at the monthly
//   rate r = annual rate / 12, over n months. Payments are rounded to the cent.
// - A home's monthly housing cost is principal and interest, property tax (an annual % of the
//   price), homeowner's insurance, PMI (an annual % of the loan, only when the down payment is
//   under 20% of the price, counted for the whole Check though it usually ends once the loan is
//   down to 78% of the price) and HOA dues. Closing costs are a % of the price, paid in cash.
// - Lenders judge a home by gross income, but the Plan knows only the take-home Baseline, so a
//   Parent enters gross income; the default estimate assumes take-home is 75% of gross.
// - A car is compared three ways over the same horizon: cash, a loan and a lease. What it costs
//   all in is what's paid (up front and monthly), plus running costs, less what the car is worth
//   at the end (less anything still owed on the loan). The car loses a fixed % of its value a
//   year; a lease ends worth nothing and is signed again on the same terms when its term ends.
// - Free to Spend is a typical month's (Commitments, allowances and Goal funding taken out), as
//   the Plan projects it over the next year. No interest on savings, no inflation, no raises.
//
// Thresholds (a value exactly at a limit counts as within it):
// - Home, housing cost against gross income ("front-end" ratio): Comfortable up to 28%, the
//   conventional limit; a Stretch up to 31%, what FHA loans allow; Not Yet above.
// - Home, all debt payments against gross income ("back-end" ratio): Comfortable up to 36%; a
//   Stretch up to 43%, the Qualified Mortgage limit; Not Yet above.
// - Cash: the down payment and closing costs (a car's cash price, down payment or amount due at
//   signing) must be set aside already, from chosen Goals' Earmarks and other cash; Not Yet if not.
// - The Plan: Comfortable when Free to Spend after the new cost stays at 5% of the Baseline or
//   more; a Stretch when it stays at zero or more; Not Yet when it goes negative.
// - Car: running it (payment and running costs) up to 10% of the Baseline is Comfortable, more
//   is a Stretch.
// - Anything: Comfortable when it's set aside already, a Stretch when it can be within 12 months,
//   Not Yet beyond that or when nothing can be set aside each month.

export type Verdict = "comfortable" | "stretch" | "not-yet";

/** One reason behind a verdict; a note explains a number without judging it. */
export type Reason = { tone: Verdict | "note"; text: string };

export type Verdicted = { verdict: Verdict; reasons: Reason[] };

/** The limits a Check judges by, as whole percentages (see the thresholds above). */
export const AFFORDABILITY_LIMITS = {
	/** Housing cost, % of gross income. */
	frontEnd: { comfortable: 28, stretch: 31 },
	/** All debt payments, % of gross income. */
	backEnd: { comfortable: 36, stretch: 43 },
	/** Free to Spend left, % of the Baseline, to be Comfortable. */
	cushion: 5,
	/** Running a car, % of the Baseline, to be Comfortable. */
	carShare: 10,
	/** Down payment, % of the price, below which a home loan carries PMI. */
	pmiBelow: 20,
	/** Months of saving that are still a Stretch. */
	saveMonths: 12,
} as const;

/** The share of gross pay assumed to arrive as take-home pay, as a %. */
export const TAKE_HOME_SHARE = 75;

/** The Plan as a Check sees it. */
export type PlanNow = {
	/** The Household's current month. */
	month: MonthKey;
	baseline: Cents;
	/** Free to Spend in a typical month (see typicalFreeToSpend). */
	freeToSpend: Cents;
};

/** Gross monthly income estimated from the take-home Baseline (see TAKE_HOME_SHARE). */
export const estimateGrossIncome = (takeHomePay: Cents): Cents =>
	Math.round((takeHomePay * 100) / TAKE_HOME_SHARE);

/** Free to Spend in a typical month: the average over a projection, rounded down. */
export const typicalFreeToSpend = (projection: Projection): Cents =>
	projection.months.length === 0
		? 0
		: Math.floor(projection.freeToSpend / projection.months.length);

/** The fixed monthly payment that pays off `principal` over `months` at `rate`% a year. */
export function monthlyPayment(principal: Cents, rate: number, months: number): Cents {
	if (principal <= 0 || months <= 0) return 0;
	const r = rate / 100 / 12;
	if (r === 0) return Math.round(principal / months);
	return Math.round((principal * r) / (1 - (1 + r) ** -months));
}

/** What's still owed on a loan after `paid` of its monthly payments. */
export function loanBalance(principal: Cents, rate: number, months: number, paid: number): Cents {
	if (paid >= months) return 0;
	const payment = monthlyPayment(principal, rate, months);
	const r = rate / 100 / 12;
	const owed =
		r === 0
			? principal - payment * paid
			: principal * (1 + r) ** paid - (payment * ((1 + r) ** paid - 1)) / r;
	return Math.max(0, Math.round(owed));
}

/** Months of setting aside `monthly` to cover `shortfall`: 0 if none, null if never. */
export function monthsToSave(shortfall: Cents, monthly: Cents): number | null {
	if (shortfall <= 0) return 0;
	return monthly > 0 ? Math.ceil(shortfall / monthly) : null;
}

// ---------------------------------------------------------------------------------------------
// Home

export type HomeInput = {
	price: Cents;
	downPayment: Cents;
	/** Set aside for the down payment and closing costs: chosen Goals' Earmarks and other cash. */
	cashAvailable: Cents;
	/** Closing costs, % of the price. */
	closingCostRate: number;
	/** Mortgage rate, % a year. */
	rate: number;
	termYears: number;
	/** Property tax, % of the price a year. */
	propertyTaxRate: number;
	insurancePerYear: Cents;
	/** PMI, % of the loan a year, when the down payment is under 20%. */
	pmiRate: number;
	hoaPerMonth: Cents;
	grossMonthlyIncome: Cents;
	/** Other debt payments a month (car loans, student loans, card minimums). */
	otherDebts: Cents;
	/** Commitments the new home would replace (rent, today's mortgage), a month. */
	replaced: Cents;
	plan: PlanNow;
};

export type HomeCheck = Verdicted & {
	loan: Cents;
	/** Each part of the monthly housing cost, and their total. */
	principalAndInterest: Cents;
	propertyTax: Cents;
	insurance: Cents;
	pmi: Cents;
	hoa: Cents;
	housing: Cents;
	closingCosts: Cents;
	/** The down payment and closing costs. */
	cashNeeded: Cents;
	/** When the cash will be set aside, from Free to Spend; null if never. */
	cashReadyIn: MonthKey | null;
	/** Housing cost, and all debt payments, as a fraction of gross income. */
	frontEnd: number;
	backEnd: number;
	freeToSpendAfter: Cents;
};

export function homeCheck(input: HomeInput): HomeCheck {
	const { plan } = input;
	const loan = Math.max(0, input.price - input.downPayment);
	const principalAndInterest = monthlyPayment(loan, input.rate, input.termYears * 12);
	const propertyTax = Math.round((input.price * input.propertyTaxRate) / 100 / 12);
	const insurance = Math.round(input.insurancePerYear / 12);
	const withPmi = input.downPayment * 100 < input.price * AFFORDABILITY_LIMITS.pmiBelow;
	const pmi = withPmi ? Math.round((loan * input.pmiRate) / 100 / 12) : 0;
	const hoa = input.hoaPerMonth;
	const housing = principalAndInterest + propertyTax + insurance + pmi + hoa;
	const closingCosts = Math.round((input.price * input.closingCostRate) / 100);
	const cashNeeded = input.downPayment + closingCosts;
	const gross = input.grossMonthlyIncome;
	const debts = housing + input.otherDebts;
	const freeToSpendAfter = plan.freeToSpend + input.replaced - housing;

	const reasons: Reason[] = [];
	const cash = cashReason({
		available: input.cashAvailable,
		needed: cashNeeded,
		what: `the ${dollars(input.downPayment)} down payment and about ${dollars(closingCosts)} in closing costs`,
		plan,
	});
	reasons.push(cash.reason);
	if (withPmi && pmi > 0) {
		reasons.push({
			tone: "note",
			text: `With less than ${AFFORDABILITY_LIMITS.pmiBelow}% down, PMI adds ${dollars(pmi)} a month until the loan is paid down to 78% of the price.`,
		});
	}

	const { frontEnd: front, backEnd: back } = AFFORDABILITY_LIMITS;
	if (gross <= 0) {
		reasons.push({ tone: "not-yet", text: "Enter gross monthly income to compare against it." });
	} else {
		const housingShare = `Housing would be ${dollars(housing)} a month, ${percent(housing, gross)} of gross income`;
		reasons.push(
			within(housing, gross, front.comfortable)
				? { tone: "comfortable", text: `${housingShare}, within the usual ${front.comfortable}%.` }
				: within(housing, gross, front.stretch)
					? {
							tone: "stretch",
							text: `${housingShare}: above the usual ${front.comfortable}%, within the ${front.stretch}% FHA loans allow.`,
						}
					: {
							tone: "not-yet",
							text: `${housingShare}, above the ${front.stretch}% even FHA loans allow.`,
						},
		);
		const debtShare = `${input.otherDebts > 0 ? `With ${dollars(input.otherDebts)} a month in other debts, all` : "All"} debt payments would be ${dollars(debts)} a month, ${percent(debts, gross)} of gross income`;
		reasons.push(
			within(debts, gross, back.comfortable)
				? { tone: "comfortable", text: `${debtShare}, within the usual ${back.comfortable}%.` }
				: within(debts, gross, back.stretch)
					? {
							tone: "stretch",
							text: `${debtShare}: above the usual ${back.comfortable}%, within the ${back.stretch}% most lenders allow.`,
						}
					: {
							tone: "not-yet",
							text: `${debtShare}, above the ${back.stretch}% most lenders allow.`,
						},
		);
	}

	reasons.push(
		planReason({
			plan,
			after: freeToSpendAfter,
			change:
				input.replaced > 0
					? `Housing of ${dollars(housing)} a month in place of ${dollars(input.replaced)} in Commitments`
					: `Housing of ${dollars(housing)} a month`,
		}),
	);

	return {
		...verdicted(reasons),
		loan,
		principalAndInterest,
		propertyTax,
		insurance,
		pmi,
		hoa,
		housing,
		closingCosts,
		cashNeeded,
		cashReadyIn: cash.readyIn,
		frontEnd: gross > 0 ? housing / gross : Number.POSITIVE_INFINITY,
		backEnd: gross > 0 ? debts / gross : Number.POSITIVE_INFINITY,
		freeToSpendAfter,
	};
}

// ---------------------------------------------------------------------------------------------
// Car

export type CarWay = "cash" | "loan" | "lease";

export type CarInput = {
	price: Cents;
	/** Set aside toward it: chosen Goals' Earmarks and other cash. */
	cashAvailable: Cents;
	loan: { downPayment: Cents; rate: number; months: number };
	lease: { monthly: Cents; months: number; dueAtSigning: Cents };
	/** Running costs beyond what the Plan already has (insurance, fuel, upkeep), a month. */
	running: Cents;
	/** What the car loses of its value, % a year. */
	depreciationRate: number;
	/** How long to compare over, in months. */
	horizonMonths: number;
	/** Commitments it would replace (today's car payment), a month. */
	replaced: Cents;
	plan: PlanNow;
};

export type CarOption = Verdicted & {
	way: CarWay;
	/** Paid at the start: the price, the down payment, or what's due at signing. */
	upfront: Cents;
	/** The loan or lease payment. */
	payment: Cents;
	/** Paid over the horizon: up front (each signing, for a lease) and every payment. */
	paid: Cents;
	/** Running costs over the horizon. */
	running: Cents;
	/** What the car is worth at the end of the horizon, less what's still owed on it. */
	worthAtEnd: Cents;
	/** What it costs all in over the horizon: paid + running − worthAtEnd. */
	totalCost: Cents;
	/** When the upfront cash will be set aside, from Free to Spend; null if never. */
	cashReadyIn: MonthKey | null;
	freeToSpendAfter: Cents;
};

export type CarCheck = Record<CarWay, CarOption>;

export function carCheck(input: CarInput): CarCheck {
	const { plan, horizonMonths: horizon } = input;
	const years = horizon / 12;
	const resale = Math.round(input.price * (1 - input.depreciationRate / 100) ** years);
	const running = input.running * horizon;

	const principal = Math.max(0, input.price - input.loan.downPayment);
	const loanPayment = monthlyPayment(principal, input.loan.rate, input.loan.months);
	const loanPayments = Math.min(horizon, input.loan.months);
	const owed = loanBalance(principal, input.loan.rate, input.loan.months, loanPayments);
	const signings = input.lease.months > 0 ? Math.ceil(horizon / input.lease.months) : 1;

	const option = (
		way: CarWay,
		upfront: Cents,
		payment: Cents,
		paid: Cents,
		worthAtEnd: Cents,
	): CarOption => {
		const monthly = payment + input.running;
		const freeToSpendAfter = plan.freeToSpend + input.replaced - monthly;
		const label =
			way === "cash"
				? `the ${dollars(upfront)} price`
				: way === "loan"
					? `the ${dollars(upfront)} down payment`
					: `the ${dollars(upfront)} due at signing`;
		const cash = cashReason({ available: input.cashAvailable, needed: upfront, what: label, plan });
		const reasons: Reason[] = [cash.reason];
		if (monthly > 0) {
			const parts =
				payment > 0 && input.running > 0
					? `The ${dollars(payment)} payment and ${dollars(input.running)} running costs`
					: payment > 0
						? `The ${dollars(payment)} payment`
						: `Running costs of ${dollars(input.running)}`;
			const share = `${parts} a month ${payment > 0 && input.running > 0 ? "are" : "is"} ${percent(monthly, plan.baseline)} of the Baseline`;
			reasons.push(
				within(monthly, plan.baseline, AFFORDABILITY_LIMITS.carShare)
					? {
							tone: "comfortable",
							text: `${share}, within the ${AFFORDABILITY_LIMITS.carShare}% a car can comfortably take.`,
						}
					: {
							tone: "stretch",
							text: `${share}, more than the ${AFFORDABILITY_LIMITS.carShare}% a car can comfortably take.`,
						},
			);
			reasons.push(
				planReason({
					plan,
					after: freeToSpendAfter,
					change:
						input.replaced > 0
							? `${dollars(monthly)} a month in place of ${dollars(input.replaced)} in Commitments`
							: `${dollars(monthly)} a month`,
				}),
			);
		}
		if (way === "loan" && input.loan.months > 60) {
			reasons.push({
				tone: "note",
				text: `A loan over ${input.loan.months} months pays more interest, and can owe more than the car is worth for a while.`,
			});
		}
		const totalCost = paid + running - worthAtEnd;
		reasons.push({
			tone: "note",
			text: `Over ${horizonName(horizon)} it costs about ${dollars(totalCost)} all in${
				worthAtEnd > 0 ? `, counting the ${dollars(worthAtEnd)} it’s worth at the end` : ""
			}.`,
		});
		return {
			...verdicted(reasons),
			way,
			upfront,
			payment,
			paid,
			running,
			worthAtEnd,
			totalCost,
			cashReadyIn: cash.readyIn,
			freeToSpendAfter,
		};
	};

	return {
		cash: option("cash", input.price, 0, input.price, resale),
		loan: option(
			"loan",
			input.loan.downPayment,
			loanPayment,
			input.loan.downPayment + loanPayment * loanPayments,
			resale - owed,
		),
		lease: option(
			"lease",
			input.lease.dueAtSigning,
			input.lease.monthly,
			input.lease.dueAtSigning * signings + input.lease.monthly * horizon,
			0,
		),
	};
}

// ---------------------------------------------------------------------------------------------
// Anything

export type AnythingInput = {
	price: Cents;
	/** Set aside toward it: a chosen Goal's Earmark and other cash. */
	saved: Cents;
	/** What can be set aside toward it each month. */
	monthly: Cents;
	/** The Household's current month. */
	month: MonthKey;
};

export type AnythingCheck = Verdicted & {
	shortfall: Cents;
	/** Months of saving until it's affordable: 0 now, null never. */
	months: number | null;
	/** The month it's affordable in; null never. */
	affordableIn: MonthKey | null;
};

export function anythingCheck(input: AnythingInput): AnythingCheck {
	const shortfall = Math.max(0, input.price - input.saved);
	const months = monthsToSave(shortfall, input.monthly);
	const affordableIn = months === null ? null : addMonths(input.month, months);
	const have = `You have ${dollars(input.saved)} set aside`;
	let reason: Reason;
	if (months === 0) {
		reason = { tone: "comfortable", text: `${have}, enough for the ${dollars(input.price)} now.` };
	} else if (months === null || affordableIn === null) {
		reason = {
			tone: "not-yet",
			text: `${have}, ${dollars(shortfall)} short of ${dollars(input.price)}, and nothing to set aside each month, so there’s no date yet.`,
		};
	} else {
		const text = `${have}, ${dollars(shortfall)} short of ${dollars(input.price)}. At ${dollars(input.monthly)} a month, that’s ${monthsName(months)}, by ${monthYear(affordableIn)}`;
		reason =
			months <= AFFORDABILITY_LIMITS.saveMonths
				? { tone: "stretch", text: `${text}.` }
				: { tone: "not-yet", text: `${text}: more than a year away.` };
	}
	return { ...verdicted([reason]), shortfall, months, affordableIn };
}

// ---------------------------------------------------------------------------------------------
// Shared reasons and wording

const rank: Record<Verdict, number> = { comfortable: 0, stretch: 1, "not-yet": 2 };

/** The verdict is the worst of the reasons' (notes don't count). */
function verdicted(reasons: Reason[]): Verdicted {
	let verdict: Verdict = "comfortable";
	for (const { tone } of reasons) {
		if (tone !== "note" && rank[tone] > rank[verdict]) verdict = tone;
	}
	return { verdict, reasons };
}

/** `part` is at most `limit`% of `whole` (exact, in whole cents). */
const within = (part: Cents, whole: Cents, limit: number) => part * 100 <= whole * limit;

function cashReason({
	available,
	needed,
	what,
	plan,
}: {
	available: Cents;
	needed: Cents;
	what: string;
	plan: PlanNow;
}): { reason: Reason; readyIn: MonthKey | null } {
	if (available >= needed) {
		return {
			reason: {
				tone: "comfortable",
				text: `You have ${dollars(available)} set aside for ${what}.`,
			},
			readyIn: plan.month,
		};
	}
	const short = needed - available;
	const months = monthsToSave(short, plan.freeToSpend);
	const readyIn = months === null ? null : addMonths(plan.month, months);
	const when =
		readyIn === null || months === null
			? "With nothing left in Free to Spend each month, there’s no date yet."
			: `Setting aside all ${dollars(plan.freeToSpend)} of Free to Spend each month, that’s ${monthsName(months)}, by ${monthYear(readyIn)}.`;
	return {
		reason: {
			tone: "not-yet",
			text: `You have ${dollars(available)} set aside for ${what}, ${dollars(short)} short. ${when}`,
		},
		readyIn,
	};
}

function planReason({
	plan,
	after,
	change,
}: {
	plan: PlanNow;
	after: Cents;
	change: string;
}): Reason {
	const projectedBalance = Math.ceil((plan.baseline * AFFORDABILITY_LIMITS.cushion) / 100);
	const text = `${change} would take Free to Spend from ${dollars(plan.freeToSpend)} to ${dollars(after)} a month`;
	if (after >= projectedBalance) return { tone: "comfortable", text: `${text}.` };
	if (after >= 0) {
		return {
			tone: "stretch",
			text: `${text}, less than ${dollars(projectedBalance)} (${AFFORDABILITY_LIMITS.cushion}% of the Baseline) to spare.`,
		};
	}
	return {
		tone: "not-yet",
		text: `${text}: the Plan would need ${dollars(-after)} a month less in Buckets or Goals.`,
	};
}

const wholeDollars = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});

/** "$2,540" (to the nearest dollar); negatives use a true minus sign. */
export function dollars(cents: Cents): string {
	const text = wholeDollars.format(Math.abs(Math.round(cents / 100)));
	return cents <= -50 ? `−${text}` : text;
}

/** "21.2%" for part / whole. */
const percent = (part: Cents, whole: Cents) =>
	whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "∞%";

const MONTHS = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December",
];

/** "October 2027". */
const monthYear = (month: MonthKey) =>
	`${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;

const monthsName = (months: number) => (months === 1 ? "1 month" : `${months} months`);

const horizonName = (months: number) =>
	months % 12 === 0 ? (months === 12 ? "1 year" : `${months / 12} years`) : monthsName(months);
