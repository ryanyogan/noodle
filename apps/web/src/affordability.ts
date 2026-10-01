import {
	addMonths,
	type CarWay,
	type Cents,
	type DayKey,
	lastDayOf,
	type MonthKey,
	type ScenarioChange,
} from "@noodle/domain";

// Turning an Affordability Check into a Scenario or a Goal, and the defaults its forms start
// from. The Check itself is @noodle/domain's; this is only what the forms and actions add.

// ---------------------------------------------------------------------------------------------
// Defaults: typical US numbers, shown as editable assumptions (never fetched live).

export const HOME_DEFAULTS = {
	price: 40_000_000,
	downPayment: 8_000_000,
	closingCostRate: 3,
	rate: 6.5,
	termYears: 30,
	propertyTaxRate: 1.1,
	insurancePerYear: 240_000,
	pmiRate: 0.5,
	hoaPerMonth: 0,
} as const;

export const CAR_DEFAULTS = {
	price: 3_500_000,
	loan: { downPayment: 500_000, rate: 7, months: 60 },
	lease: { monthly: 45_000, months: 36, dueAtSigning: 300_000 },
	running: 0,
	depreciationRate: 15,
	horizonMonths: 60,
	way: "loan" as CarWay,
} as const;

export const ANYTHING_DEFAULTS = { name: "", price: 500_000 } as const;

/** What a Commitment is to a Check: kept as it is, replaced by the new cost, or a debt. */
export type CommitmentRole = "stays" | "replaced" | "debt";

/**
 * A first guess at each Commitment's role from its name, for the Parent to correct: rent or a
 * mortgage is what a home replaces, and loans, leases and cards are debts lenders count.
 */
export function guessRole(name: string, purchase: "home" | "car"): CommitmentRole {
	if (purchase === "home") {
		if (/\b(rent|mortgage)\b/i.test(name)) return "replaced";
		if (/\b(loan|lease|card|financ\w*|student|auto|car payment)\b/i.test(name)) return "debt";
		return "stays";
	}
	return /\b(car|auto) (loan|lease|payment)\b/i.test(name) ? "replaced" : "stays";
}

// ---------------------------------------------------------------------------------------------
// Into a Scenario

/**
 * The month a Scenario starts the new cost: when the cash is ready (next month at the soonest,
 * as buying takes time), and within the next year, which a Commitment Change can move within.
 */
export function startMonth(month: MonthKey, cashReadyIn: MonthKey | null): MonthKey {
	const soonest = addMonths(month, 1);
	const latest = addMonths(month, 11);
	if (cashReadyIn === null || cashReadyIn < soonest) return soonest;
	return cashReadyIn > latest ? latest : cashReadyIn;
}

export type NewCost = {
	commitmentId: string;
	name: string;
	amount: Cents;
	/** How many months it runs; null for good. */
	months: number | null;
};

/**
 * The Changes that make a Check's new monthly costs a Scenario: each a new Commitment from
 * `from`, with the Commitments they replace cancelled from the same month.
 */
export function purchaseChanges({
	from,
	costs,
	replaced,
}: {
	from: MonthKey;
	costs: NewCost[];
	replaced: string[];
}): ScenarioChange[] {
	return [
		...costs
			.filter((c) => c.amount > 0)
			.map(
				(c): ScenarioChange => ({
					kind: "add-commitment",
					commitmentId: c.commitmentId,
					name: c.name,
					amount: c.amount,
					cadence: "monthly",
					dueDay: 1,
					fromMonth: from,
					months: c.months,
				}),
			),
		...replaced.map(
			(commitmentId): ScenarioChange => ({ kind: "end-commitment", commitmentId, fromMonth: from }),
		),
	];
}

// ---------------------------------------------------------------------------------------------
// Into a Goal

/** A Goal's target date for money ready in `readyIn`: its last day, or none if it's ready now. */
export const goalDate = (month: MonthKey, readyIn: MonthKey | null): DayKey | null =>
	readyIn === null || readyIn <= month ? null : lastDayOf(readyIn);

/**
 * The Account a new Goal is backed by: the one holding the first chosen set-aside money, or else the
 * first that holds money; null when there's none to back it.
 */
export function goalAccount(
	accounts: { id: string; holdsMoney: boolean }[],
	chosen: { accountId: string }[],
): string | null {
	const holding = accounts.filter((a) => a.holdsMoney);
	return (
		chosen.find((g) => holding.some((a) => a.id === g.accountId))?.accountId ??
		holding[0]?.id ??
		null
	);
}
