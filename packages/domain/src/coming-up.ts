import { type Cadence, dueDatesIn } from "./commitments";
import type { Cents } from "./money";
import { addDays, addMonths, type DayKey, type MonthKey, monthOfDay } from "./month";
import { type Charge, paymentsOf } from "./month-state";
import { commitmentsIn, type Plan, type PlanRecords } from "./plan";

type CommitmentRecords = Pick<PlanRecords, "commitments" | "commitmentTerms">;

/**
 * `paid`: what's been charged in its month covers this due date.
 * `partly-paid`: some of it is covered.
 * `due`: none of it is, yet.
 */
export type DueStatus = "paid" | "partly-paid" | "due";

/** One day a Commitment is due, and how much of it has been paid. */
export type Due = {
	commitmentId: string;
	name: string;
	date: DayKey;
	amount: Cents;
	paid: Cents;
	status: DueStatus;
	/** Its amount is "about": the bill varies, so `amount` is what the Plan sets aside (issue 135). */
	about?: true;
};

const months = (from: DayKey, to: DayKey): MonthKey[] => {
	const list: MonthKey[] = [];
	for (let m = monthOfDay(from); m <= monthOfDay(to); m = addMonths(m, 1)) list.push(m);
	return list;
};

/**
 * Every day from `from` to `to` (inclusive) a Commitment in the Plan is due, on the terms in force
 * in its month, by date. Charges pay a month's due dates in order, as This Month counts them: the
 * month's charges cover its first due date, then its second.
 */
export function duesBetween(
	records: CommitmentRecords,
	charges: readonly Charge[],
	from: DayKey,
	to: DayKey,
): Due[] {
	const dues: Due[] = [];
	for (const month of months(from, to)) {
		const charged = new Map<string, Cents>();
		// Money Paid back isn't a payment of a due date (ADR-0058).
		for (const charge of paymentsOf(charges)) {
			if (monthOfDay(charge.date) !== month) continue;
			charged.set(charge.commitmentId, (charged.get(charge.commitmentId) ?? 0) + charge.amount);
		}
		for (const commitment of commitmentsIn(records, month)) {
			const total = charged.get(commitment.id) ?? 0;
			dueDatesIn(commitment, month).forEach((date, i) => {
				if (date < from || date > to) return;
				const paid = Math.min(commitment.amount, Math.max(0, total - commitment.amount * i));
				dues.push({
					commitmentId: commitment.id,
					name: commitment.name,
					date,
					amount: commitment.amount,
					paid,
					status: paid >= commitment.amount ? "paid" : paid > 0 ? "partly-paid" : "due",
					...(commitment.about ? { about: true as const } : {}),
				});
			});
		}
	}
	return dues.sort(
		(a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || a.name.localeCompare(b.name),
	);
}

/** Coming up: what the Commitments are due from `today` through the next `days` days, by date. */
export function comingUp(
	records: CommitmentRecords,
	charges: readonly Charge[],
	today: DayKey,
	days: number,
): Due[] {
	return duesBetween(records, charges, today, addDays(today, days - 1));
}

/**
 * A charge of a Commitment, set against the due date it paid: a month's charges, by date, pay its
 * due dates in order. `dueDate` is null for a charge in a month the Commitment wasn't due, or
 * beyond its due dates that month; `onTime` is whether it was paid by its due date.
 */
export type MatchedCharge<C extends Charge = Charge> = C & {
	dueDate: DayKey | null;
	onTime: boolean | null;
};

/** One Commitment's charges, each matched to the due date it paid, newest first. */
export function matchCharges<C extends Charge>(
	records: CommitmentRecords,
	commitmentId: string,
	charges: readonly C[],
): MatchedCharge<C>[] {
	const own = paymentsOf(charges)
		.filter((c) => c.commitmentId === commitmentId)
		.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
	const seen = new Map<MonthKey, number>();
	const matched = own.map((charge): MatchedCharge<C> => {
		const month = monthOfDay(charge.date);
		const index = seen.get(month) ?? 0;
		seen.set(month, index + 1);
		const commitment = commitmentsIn(records, month).find((c) => c.id === commitmentId);
		const dueDate = commitment ? (dueDatesIn(commitment, month)[index] ?? null) : null;
		return { ...charge, dueDate, onTime: dueDate === null ? null : charge.date <= dueDate };
	});
	return matched.reverse();
}

/**
 * A Commitment that takes more than usual in a month, so Free to Spend is lower then: an annual
 * one in the month it's due, or a biweekly one in a month it's due three times. `extra` is what
 * it takes beyond a usual month: the whole annual amount, or the third biweekly payment.
 */
export type Lump = {
	commitmentId: string;
	name: string;
	cadence: Extract<Cadence, "annual" | "biweekly">;
	extra: Cents;
	dueDates: DayKey[];
};

/** The Commitments that make a month's Plan lumpy, the largest first. */
export function lumpsIn(plan: Pick<Plan, "month" | "commitments">): Lump[] {
	const lumps: Lump[] = [];
	for (const commitment of plan.commitments) {
		const dueDates = dueDatesIn(commitment, plan.month);
		const { id: commitmentId, name, amount, cadence } = commitment;
		if (cadence === "annual" && dueDates.length > 0) {
			lumps.push({ commitmentId, name, cadence, extra: amount, dueDates });
		} else if (cadence === "biweekly" && dueDates.length > 2) {
			lumps.push({ commitmentId, name, cadence, extra: amount * (dueDates.length - 2), dueDates });
		}
	}
	return lumps.sort((a, b) => b.extra - a.extra || a.name.localeCompare(b.name));
}

/** The lumpy months among the `count` months from `from`, each with the Commitments that cause it. */
export function lumpyMonths(
	records: CommitmentRecords,
	from: MonthKey,
	count: number,
): { month: MonthKey; lumps: Lump[] }[] {
	return Array.from({ length: count }, (_, i) => addMonths(from, i)).flatMap((month) => {
		const lumps = lumpsIn({ month, commitments: commitmentsIn(records, month) });
		return lumps.length > 0 ? [{ month, lumps }] : [];
	});
}
