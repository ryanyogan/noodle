import { dueDatesIn } from "./commitments";
import { extraIncomeOf, type Income, receivedIn } from "./extra-income";
import type { Cents } from "./money";
import { type DayKey, daysElapsed, daysInMonth, type MonthKey, monthOfDay } from "./month";
import {
	freeToSpend,
	type Plan,
	type PlanBucket,
	type PlanCommitment,
	totalAllowances,
	totalCommitments,
} from "./plan";

/** Spending recorded against a Bucket on a day (a Transaction or one of its Splits). */
/**
 * Spending in a Bucket on a day. One with `paidBack` is not a purchase: it is money Paid back into
 * the Bucket that day (ADR-0058), a negative amount.
 */
export type Spend = {
	bucketId: string;
	amount: Cents;
	date: DayKey;
	paidBack?: true;
	/** On one that is `paidBack`: it is a Refund linked to its purchase (ADR-0057), not Paid back. */
	refund?: true;
	/**
	 * On one that is `paidBack`: no money came in. It is the Owed back part of a purchase made
	 * that day, which never counts as spending (ADR-0058, revised 2026-10-08).
	 */
	owed?: true;
	/** On one that is `owed`: what of it has been Paid back so far. */
	settled?: Cents;
	/** On one that is `owed`: what of it a Parent has written off, so it is owed no longer. */
	writtenOff?: Cents;
	/**
	 * On one that is `paidBack`: nothing came back. It is what a Parent wrote off of a purchase's
	 * Owed back part, a positive amount that counts as spending on the day it was written off.
	 */
	writeOff?: true;
};

/**
 * A payment recorded against a Commitment on a day (a Transaction or one of its Splits). One with
 * `paidBack` is not a payment: it is money Paid back into the Commitment that day (ADR-0058), a
 * negative amount. It counts in what the Commitment took, never as one of its payments.
 */
export type Charge = {
	commitmentId: string;
	amount: Cents;
	date: DayKey;
	paidBack?: true;
	/** On one that is `paidBack`: it is a Refund linked to its purchase (ADR-0057), not Paid back. */
	refund?: true;
	/**
	 * On one that is `paidBack`: no money came in. It is the Owed back part of a payment made that
	 * day, which never counts as spending (ADR-0058, revised 2026-10-08).
	 */
	owed?: true;
	/** On one that is `owed`: what of it a Parent has written off, so it is owed no longer. */
	writtenOff?: Cents;
	/**
	 * On one that is `paidBack`: nothing came back. It is what a Parent wrote off of a payment's
	 * Owed back part, a positive amount the Commitment took on the day it was written off.
	 */
	writeOff?: true;
	/** Who paid it back, or owes it, on one that is `paidBack`. */
	who?: string;
};

/** The payments among these charges: everything but money Paid back into the Commitment. */
export const paymentsOf = <C extends { paidBack?: true | undefined }>(charges: readonly C[]): C[] =>
	charges.filter((charge) => !charge.paidBack);

/**
 * A Move of planned money within one month's Plan, from a Bucket (or from Free to Spend, when
 * `fromBucketId` is null) to a Bucket. No real money moves. A Cover is one. With `windfall`, it
 * comes from the month's Extra income instead, so Free to Spend is untouched.
 */
export type Move = {
	fromBucketId: string | null;
	toBucketId: string;
	amount: Cents;
	month: MonthKey;
	windfall?: boolean;
};

/**
 * Goal funding: a Move of planned money from Free to Spend in one month's Plan into a Goal's
 * set-aside money. Like any Move, no real money moves; the Goal's Account already holds it. With
 * `windfall`, it comes from the month's Extra income instead, so Free to Spend is untouched.
 */
export type GoalFunding = { goalId: string; amount: Cents; month: MonthKey; windfall?: boolean };

/** Extra income a Parent added to its month's Free to Spend: no Bucket or Goal takes it. */
export type ExtraToFree = { amount: Cents; month: MonthKey };

/** A Sweep: a Move of a Bucket that resets monthly's leftover at the end of `month` into a Goal. */
export type Sweep = { bucketId: string; goalId: string; amount: Cents; month: MonthKey };

/**
 * `ahead`: spent faster than Pace allows (by more than a small tolerance).
 * `over`: spent more than the allowance.
 */
export type BucketStatus = "on-pace" | "ahead" | "over";

export type BucketState = PlanBucket & {
	/** Carried in from last month, when the Bucket carrying over then; negative if it was overspent. */
	rolledOver: Cents;
	/** Moved into the Bucket this month, less what was moved out of it (Swept included). */
	moved: Cents;
	/** What the Bucket has to spend this month: its allowance, what rolled over, and what was moved into it. */
	available: Cents;
	spent: Cents;
	/** What of `spent` is money Paid back into it this month (ADR-0058); absent when none was. */
	paidBack?: Cents;
	/** What of `paidBack` came from Refunds linked to their purchases (ADR-0057); absent when none. */
	refunded?: Cents;
	/**
	 * The Owed back part of this month's purchases in it, which `spent` leaves out (ADR-0058,
	 * revised 2026-10-08); absent when there is none.
	 */
	owedBack?: Cents;
	/** What of `owedBack` has been Paid back so far; absent when none has. */
	owedBackSettled?: Cents;
	/** Negative once the Bucket is overspent. */
	left: Cents;
	pace: {
		/** What should have been spent by the end of the as-of day if spent evenly. */
		spent: Cents;
		/** The share of the allowance that should still be left by then, 0–1. */
		leftShare: number;
	};
	status: BucketStatus;
};

/**
 * `not-due`: not due this month, and not charged.
 * `upcoming`: due more times than it has been charged so far, each charge as expected.
 * `paid`: charged each time it's due, each for the expected amount.
 * `differs`: what was charged isn't what was expected for those charges.
 */
export type CommitmentStatus = "not-due" | "upcoming" | "paid" | "differs";

export type CommitmentState = PlanCommitment & {
	/** The days this month it's due. */
	dueDates: DayKey[];
	/** What the Plan sets aside for it this month: its amount each time it's due. */
	expected: Cents;
	/** What has been charged to it this month so far. */
	actual: Cents;
	/** How many charges that took. */
	charges: number;
	/**
	 * How much more (negative: less) was charged than expected for the charges so far. Each
	 * charge, up to the number of times it's due, is expected to be `amount`; any beyond that
	 * wasn't expected at all.
	 */
	difference: Cents;
	status: CommitmentStatus;
	/**
	 * Money Paid back into it this month (ADR-0058), which `actual` and `difference` have taken
	 * off, and who paid it; absent when none was. See `paymentsView`.
	 */
	paidBack?: { amount: Cents; who: string[]; refunded?: Cents };
	/**
	 * The Owed back part of this month's payments of it, which `actual` and `difference` leave out
	 * (ADR-0058, revised 2026-10-08), and who owes it; absent when there is none.
	 */
	owedBack?: { amount: Cents; who: string[] };
};

const commitmentStatus = (difference: number, charges: number, due: number): CommitmentStatus =>
	difference !== 0 ? "differs" : charges < due ? "upcoming" : due > 0 ? "paid" : "not-due";

/**
 * A Commitment's month as a row should say it. Where money Paid back has taken it below what its
 * payments were expected to be (tuition's half arriving the month after the purchase), the month
 * is read by its payments alone, so it says "Due Oct 5" or "Paid" and not a negative payment; the
 * money back is said beside it from `paidBack`. Any other month is returned as it is.
 */
export function paymentsView(commitment: CommitmentState): CommitmentState {
	const back = commitment.paidBack;
	if (!back || commitment.difference >= 0) return commitment;
	const difference = (commitment.difference + back.amount) as Cents;
	return {
		...commitment,
		actual: (commitment.actual + back.amount) as Cents,
		difference,
		status: commitmentStatus(difference, commitment.charges, commitment.dueDates.length),
	};
}

/**
 * For an "about" Commitment whose charges for the month are all in: how much more (negative: less)
 * they came to than the Plan set aside, which comes out of, or adds to, what carries to the next
 * month (ADR-0054). Null for any other Commitment, while one is still due, or when they match.
 */
export function aboutCameIn(
	commitment: Pick<CommitmentState, "about" | "charges" | "dueDates" | "difference">,
): Cents | null {
	if (!commitment.about || commitment.charges === 0) return null;
	if (commitment.charges < commitment.dueDates.length || commitment.difference === 0) return null;
	return commitment.difference;
}

export type MonthState = Omit<Plan, "buckets" | "commitments"> & {
	asOf: DayKey;
	daysInMonth: number;
	/** Days after the as-of day until the month ends. */
	daysLeft: number;
	/** Everything assigned to Buckets, Personal Allowances included (see allowancesByKind). */
	planned: Cents;
	/** Everything the Commitments are expected to take this month. */
	committed: Cents;
	/** Moved from Free to Spend into Buckets this month. */
	movedToBuckets: Cents;
	/** Moved from Free to Spend into Goals this month (Goal funding). */
	fundedGoals: Cents;
	/**
	 * Take-home pay, plus any Extra income a Parent added (`extraToFreeToSpend`) and what earlier
	 * months carried in (`freeCarriedIn`), not assigned to anything. Negative when the Plan assigns
	 * more than that.
	 */
	freeToSpend: Cents;
	/** Carried in from last month's Free to Spend, when it builds up (see free-carry.ts); else 0. */
	freeCarriedIn: Cents;
	/** Extra income a Parent added to this month's Free to Spend. */
	extraToFreeToSpend: Cents;
	/** Income received this month. */
	received: Cents;
	/** Income received this month beyond take-home pay. */
	windfall: Cents;
	/** The Extra income not yet Moved to a Goal, a Bucket or Free to Spend, awaiting a decision. */
	windfallLeft: Cents;
	/** What's left across Buckets, not counting any Bucket's overspending. */
	leftInBuckets: Cents;
	/**
	 * The Owed back part of the month's purchases, in Buckets and Commitments together, which no
	 * spending figure counts (ADR-0058, revised 2026-10-08).
	 */
	owedBack: Cents;
	commitments: CommitmentState[];
	buckets: BucketState[];
};

/** Spending ahead of Pace by no more than this share of the allowance still counts as on Pace. */
const PACE_TOLERANCE = 0.03;

/**
 * The state of a month: each Bucket's allowance, spent, left, Pace, and status, each
 * Commitment's expected and actual amounts, and Free to Spend, as of the end of a given day.
 * Moves shift money between Buckets and Free to Spend; Goal funding takes it out of Free to
 * Spend; a Sweep takes a Bucket's leftover into a Goal; income beyond take-home pay is the
 * Extra income, and Moves from it add to Buckets and Goals without touching Free to Spend; what rolled over from last month (see `rolledOver`) adds to a Bucket without touching
 * Free to Spend; what last month's Free to Spend carried in (`freeCarriedIn`) adds to it. Spending, charges, and Moves outside the
 * month, or involving a Bucket or Commitment not in the Plan, are ignored. The server and the client's optimistic updates both call this, so the numbers a
 * Parent sees before and after a save are the same.
 */
export function monthState({
	plan,
	spending,
	charges = [],
	moves = [],
	rolledOver = {},
	goalFunding = [],
	sweeps = [],
	income = [],
	extraToFree = [],
	freeCarriedIn = 0,
	asOf,
}: {
	plan: Plan;
	spending: Spend[];
	charges?: Charge[];
	moves?: Move[];
	/** Per Bucket ID, what carried in from last month. */
	rolledOver?: Record<string, Cents>;
	goalFunding?: GoalFunding[];
	sweeps?: Sweep[];
	/** Income received; only this month's counts. */
	income?: Income[];
	/** Extra income added to Free to Spend; only this month's counts. */
	extraToFree?: ExtraToFree[];
	/** What last month's Free to Spend carried in (see freeCarriedIn in free-carry.ts). */
	freeCarriedIn?: Cents;
	asOf: DayKey;
}): MonthState {
	const days = daysInMonth(plan.month);
	const elapsed = daysElapsed(plan.month, asOf);
	const spentByBucket = new Map<string, Cents>();
	const paidBackByBucket = new Map<string, Cents>();
	// What of it came from Refunds linked to their purchases: said as "refunded", not "Paid back".
	const refundedByBucket = new Map<string, Cents>();
	// The Owed back part of the month's purchases: it never counted, so it is no money back.
	const owedByBucket = new Map<string, Cents>();
	const settledByBucket = new Map<string, Cents>();
	for (const spend of spending) {
		if (monthOfDay(spend.date) !== plan.month) continue;
		if (spend.paidBack && spend.owed) {
			owedByBucket.set(
				spend.bucketId,
				(owedByBucket.get(spend.bucketId) ?? 0) - spend.amount - (spend.writtenOff ?? 0),
			);
			settledByBucket.set(
				spend.bucketId,
				(settledByBucket.get(spend.bucketId) ?? 0) + (spend.settled ?? 0),
			);
		} else if (spend.paidBack && !spend.writeOff)
			paidBackByBucket.set(
				spend.bucketId,
				(paidBackByBucket.get(spend.bucketId) ?? 0) - spend.amount,
			);
		if (spend.paidBack && spend.refund)
			refundedByBucket.set(
				spend.bucketId,
				(refundedByBucket.get(spend.bucketId) ?? 0) - spend.amount,
			);
		spentByBucket.set(spend.bucketId, (spentByBucket.get(spend.bucketId) ?? 0) + spend.amount);
	}
	const inPlan = new Set(plan.buckets.map((b) => b.id));
	const movedByBucket = new Map<string, Cents>();
	let movedToBuckets = 0;
	let extraIncomeDecided = 0;
	for (const { fromBucketId: from, toBucketId: to, amount, month, windfall } of moves) {
		if (month !== plan.month || !inPlan.has(to) || (from !== null && !inPlan.has(from))) continue;
		movedByBucket.set(to, (movedByBucket.get(to) ?? 0) + amount);
		if (windfall) extraIncomeDecided += amount;
		else if (from === null) movedToBuckets += amount;
		else movedByBucket.set(from, (movedByBucket.get(from) ?? 0) - amount);
	}
	for (const sweep of sweeps) {
		if (sweep.month !== plan.month || !inPlan.has(sweep.bucketId)) continue;
		movedByBucket.set(sweep.bucketId, (movedByBucket.get(sweep.bucketId) ?? 0) - sweep.amount);
	}
	let fundedGoals = 0;
	for (const funding of goalFunding) {
		if (funding.month !== plan.month) continue;
		if (funding.windfall) extraIncomeDecided += funding.amount;
		else fundedGoals += funding.amount;
	}
	let extraToFreeToSpend = 0;
	for (const extra of extraToFree) {
		if (extra.month !== plan.month) continue;
		extraToFreeToSpend += extra.amount;
		extraIncomeDecided += extra.amount;
	}
	const received = receivedIn(income, plan.month);
	const { windfall, pending } = extraIncomeOf({
		baseline: plan.baseline,
		received,
		decided: extraIncomeDecided,
	});
	const buckets = plan.buckets.map((bucket): BucketState => {
		const moved = movedByBucket.get(bucket.id) ?? 0;
		const carried = rolledOver[bucket.id] ?? 0;
		const available = bucket.allowance + carried + moved;
		const spent = spentByBucket.get(bucket.id) ?? 0;
		const left = available - spent;
		// Pace spreads what the Bucket has to spend evenly across the month.
		const paced = Math.max(0, available);
		const paceSpent = Math.round((paced * elapsed) / days);
		const status: BucketStatus =
			left < 0 ? "over" : spent - paceSpent > paced * PACE_TOLERANCE ? "ahead" : "on-pace";
		return {
			...bucket,
			rolledOver: carried,
			moved,
			available,
			spent,
			...(paidBackByBucket.get(bucket.id) ? { paidBack: paidBackByBucket.get(bucket.id) } : {}),
			...(refundedByBucket.get(bucket.id) ? { refunded: refundedByBucket.get(bucket.id) } : {}),
			...(owedByBucket.get(bucket.id) ? { owedBack: owedByBucket.get(bucket.id) } : {}),
			...(settledByBucket.get(bucket.id)
				? { owedBackSettled: settledByBucket.get(bucket.id) }
				: {}),
			left,
			pace: { spent: paceSpent, leftShare: 1 - elapsed / days },
			status,
		};
	});
	const chargedByCommitment = new Map<string, Cents[]>();
	// Money Paid back into a Commitment this month (ADR-0058): in what it took, not a payment.
	const paidBackByCommitment = new Map<string, Cents>();
	// Who paid it back, by Commitment: "casey" and "Casey" are one person, as first written.
	const paidBackBy = new Map<string, Map<string, string>>();
	const refundedByCommitment = new Map<string, Cents>();
	// The Owed back part of the month's payments, and who owes it: left out of what it took.
	const owedByCommitment = new Map<string, Cents>();
	const owedBy = new Map<string, Map<string, string>>();
	// What of that a Parent has written off, so it is owed no longer; and what was written off
	// this month, which the Commitment took.
	const noLongerOwed = new Map<string, Cents>();
	const writtenOffByCommitment = new Map<string, Cents>();
	for (const charge of charges) {
		if (monthOfDay(charge.date) !== plan.month) continue;
		if (charge.paidBack && charge.owed) {
			owedByCommitment.set(
				charge.commitmentId,
				(owedByCommitment.get(charge.commitmentId) ?? 0) - charge.amount,
			);
			const who = charge.who?.trim();
			if (who) {
				const people = owedBy.get(charge.commitmentId) ?? new Map<string, string>();
				if (!people.has(who.toLowerCase())) people.set(who.toLowerCase(), who);
				owedBy.set(charge.commitmentId, people);
			}
			if (charge.writtenOff)
				noLongerOwed.set(
					charge.commitmentId,
					(noLongerOwed.get(charge.commitmentId) ?? 0) + charge.writtenOff,
				);
			continue;
		}
		if (charge.paidBack && charge.writeOff) {
			writtenOffByCommitment.set(
				charge.commitmentId,
				(writtenOffByCommitment.get(charge.commitmentId) ?? 0) + charge.amount,
			);
			continue;
		}
		if (charge.paidBack) {
			paidBackByCommitment.set(
				charge.commitmentId,
				(paidBackByCommitment.get(charge.commitmentId) ?? 0) + charge.amount,
			);
			if (charge.refund)
				refundedByCommitment.set(
					charge.commitmentId,
					(refundedByCommitment.get(charge.commitmentId) ?? 0) - charge.amount,
				);
			const who = charge.who?.trim();
			if (who) {
				const people = paidBackBy.get(charge.commitmentId) ?? new Map<string, string>();
				if (!people.has(who.toLowerCase())) people.set(who.toLowerCase(), who);
				paidBackBy.set(charge.commitmentId, people);
			}
			continue;
		}
		const amounts = chargedByCommitment.get(charge.commitmentId) ?? [];
		chargedByCommitment.set(charge.commitmentId, [...amounts, charge.amount]);
	}
	const commitments = plan.commitments.map((commitment): CommitmentState => {
		const dueDates = dueDatesIn(commitment, plan.month);
		const charged = chargedByCommitment.get(commitment.id) ?? [];
		const actual =
			charged.reduce((sum, amount) => sum + amount, 0) +
			(paidBackByCommitment.get(commitment.id) ?? 0) -
			(owedByCommitment.get(commitment.id) ?? 0) +
			(writtenOffByCommitment.get(commitment.id) ?? 0);
		const stillOwed =
			(owedByCommitment.get(commitment.id) ?? 0) - (noLongerOwed.get(commitment.id) ?? 0);
		const difference = actual - commitment.amount * Math.min(charged.length, dueDates.length);
		const status = commitmentStatus(difference, charged.length, dueDates.length);
		const back = -(paidBackByCommitment.get(commitment.id) ?? 0);
		return {
			...commitment,
			dueDates,
			expected: commitment.amount * dueDates.length,
			actual,
			charges: charged.length,
			difference,
			status,
			...(back > 0
				? {
						paidBack: {
							amount: back,
							who: [...(paidBackBy.get(commitment.id)?.values() ?? [])].sort((a, b) =>
								a.localeCompare(b),
							),
							...(refundedByCommitment.get(commitment.id)
								? { refunded: refundedByCommitment.get(commitment.id) }
								: {}),
						},
					}
				: {}),
			...(stillOwed > 0
				? {
						owedBack: {
							amount: stillOwed,
							who: [...(owedBy.get(commitment.id)?.values() ?? [])].sort((a, b) =>
								a.localeCompare(b),
							),
						},
					}
				: {}),
		};
	});
	// Everything owed on the month's purchases, whether or not what it is filed in is in the Plan.
	const owedBackTotal =
		[...owedByBucket.values()].reduce((sum, owed) => sum + owed, 0) +
		[...owedByCommitment.values()].reduce((sum, owed) => sum + owed, 0);
	return {
		month: plan.month,
		baseline: plan.baseline,
		asOf,
		daysInMonth: days,
		daysLeft: days - elapsed,
		planned: totalAllowances(plan),
		committed: totalCommitments(plan),
		movedToBuckets,
		fundedGoals,
		freeToSpend:
			freeToSpend(plan) - movedToBuckets - fundedGoals + extraToFreeToSpend + freeCarriedIn,
		freeCarriedIn,
		extraToFreeToSpend,
		received,
		windfall,
		windfallLeft: pending,
		leftInBuckets: buckets.reduce((sum, b) => sum + Math.max(0, b.left), 0),
		owedBack: owedBackTotal,
		commitments,
		buckets,
	};
}
