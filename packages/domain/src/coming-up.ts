import { type Cadence, dueDatesIn } from "./commitments";
import type { Cents } from "./money";
import { addDays, addMonths, type DayKey, type MonthKey, monthOfDay } from "./month";
import { type Charge, paymentsOf } from "./month-state";
import { commitmentsIn, type Plan, type PlanRecords } from "./plan";

type CommitmentRecords = Pick<PlanRecords, "commitments" | "commitmentTerms">;

/**
 * `paid`: what's been charged in its month covers this due date. A bill that varies ("about") is
 * paid by its charge, whatever that came to.
 * `partly-paid`: some of it is covered. Never a bill that varies.
 * `due`: none of it is, yet.
 */
export type DueStatus = "paid" | "partly-paid" | "due";

/** One day a Commitment is due, and how much of it has been paid. */
export type Due = {
	commitmentId: string;
	name: string;
	date: DayKey;
	amount: Cents;
	/** What was charged towards it; for a bill that varies, what its charge came to (over or under). */
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
 * month's charges cover its first due date, then its second. A bill that varies has no amount to
 * cover: each of its charges pays one due date, in order, and the last due date takes the rest.
 */
export function duesBetween(
	records: CommitmentRecords,
	charges: readonly Charge[],
	from: DayKey,
	to: DayKey,
): Due[] {
	const dues: Due[] = [];
	for (const month of months(from, to)) {
		// Money Paid back isn't a payment of a due date (ADR-0058).
		const payments = paymentsOf(charges)
			.filter((charge) => monthOfDay(charge.date) === month)
			.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
		for (const commitment of commitmentsIn(records, month)) {
			const own = payments.filter((charge) => charge.commitmentId === commitment.id);
			const total = own.reduce((sum, charge) => sum + charge.amount, 0);
			const dates = dueDatesIn(commitment, month);
			dates.forEach((date, i) => {
				if (date < from || date > to) return;
				const mine = i < dates.length - 1 ? own.slice(i, i + 1) : own.slice(i);
				const paid = commitment.about
					? Math.max(
							0,
							mine.reduce((sum, charge) => sum + charge.amount, 0),
						)
					: Math.min(commitment.amount, Math.max(0, total - commitment.amount * i));
				const covered = commitment.about ? paid > 0 : paid >= commitment.amount;
				dues.push({
					commitmentId: commitment.id,
					name: commitment.name,
					date,
					amount: commitment.amount,
					paid: paid as Cents,
					status: covered ? "paid" : paid > 0 ? "partly-paid" : "due",
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
