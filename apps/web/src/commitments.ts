import type { CommitmentCharge } from "@noodle/db";
import {
	byNextDue,
	type Cadence,
	type CommitmentState,
	type CommitmentTerms,
	type DayKey,
	type MonthKey,
	monthlyEquivalent,
	monthOfDay,
	type PlanCommitment,
	type PlanScope,
	yearlyCost,
} from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney, monthName, shortDay } from "./format";
import { monthChangeKey } from "./plan-changes";
import { commitmentsQuery, monthQuery, monthsKey } from "./queries";
import { addCommitmentPayment } from "./server/commitments";
import type { MonthData } from "./server/month";

export const cadenceNames: Record<Cadence, string> = {
	monthly: "Monthly",
	biweekly: "Every two weeks",
	annual: "Yearly",
};

const list = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** "Monthly · due Sep 1", "Every two weeks · due Oct 2, 16, and 30", "Yearly · due Mar 1". */
export function schedule(
	commitment: Pick<CommitmentState, "cadence" | "dueDate" | "dueDates">,
	month: MonthKey,
): string {
	const cadence = cadenceNames[commitment.cadence];
	const [first, ...rest] = commitment.dueDates;
	if (!first) return `${cadence} · due ${shortDay(commitment.dueDate)}, not in ${monthName(month)}`;
	const days = [shortDay(first), ...rest.map((day) => String(Number(day.slice(8, 10))))];
	return `${cadence} · due ${list.format(days)}`;
}

/** "$1,140 a year · $95 a month"; a monthly Commitment's month is its amount, so just "$30,000 a year". */
export function costText(terms: Pick<CommitmentTerms, "amount" | "cadence">): string {
	const year = `${formatMoney(yearlyCost(terms))} a year`;
	return terms.cadence === "monthly"
		? year
		: `${year} · ${formatMoney(monthlyEquivalent(terms))} a month`;
}

const ordinal = (day: number) => {
	const suffix =
		day % 10 === 1 && day !== 11
			? "st"
			: day % 10 === 2 && day !== 12
				? "nd"
				: day % 10 === 3 && day !== 13
					? "rd"
					: "th";
	return `${day}${suffix}`;
};

/** "Monthly, due on the 1st", "Every two weeks from Sep 4", "Yearly, due Mar 15". */
export function termsSchedule(terms: Pick<CommitmentTerms, "cadence" | "dueDate">): string {
	switch (terms.cadence) {
		case "monthly":
			return `Monthly, due on the ${ordinal(Number(terms.dueDate.slice(8, 10)))}`;
		case "biweekly":
			return `Every two weeks from ${shortDay(terms.dueDate)}`;
		case "annual":
			return `Yearly, due ${shortDay(terms.dueDate)}`;
	}
}

/** What a Parent enters for a Commitment; a Commitment's terms are set from `month` onward. */
export type CommitmentVariables = {
	/** A client ULID: retrying the same add creates the Commitment once. */
	commitmentId: string;
	month: MonthKey;
	name: string;
	amountCents: number;
	cadence: Cadence;
	dueDate: DayKey;
	/** How far a change to its terms reaches; from `month` on when left out. */
	scope?: PlanScope;
};

const toPlanCommitment = (v: CommitmentVariables): PlanCommitment => ({
	id: v.commitmentId,
	name: v.name,
	amount: v.amountCents,
	cadence: v.cadence,
	dueDate: v.dueDate,
});

// The optimistic edits, mirroring what each server function records.

const mapCommitments = (data: MonthData, change: (c: PlanCommitment[]) => PlanCommitment[]) => ({
	...data,
	// Kept in the order they're next due, as the server lists them.
	plan: {
		...data.plan,
		commitments: byNextDue(change(data.plan.commitments), `${data.plan.month}-01`),
	},
});

export const withNewCommitment = (data: MonthData, variables: CommitmentVariables) =>
	mapCommitments(data, (commitments) =>
		commitments.some((c) => c.id === variables.commitmentId)
			? commitments
			: [...commitments, toPlanCommitment(variables)],
	);

export const withCommitment = (data: MonthData, variables: CommitmentVariables) =>
	mapCommitments(data, (commitments) =>
		commitments.map((c) => (c.id === variables.commitmentId ? toPlanCommitment(variables) : c)),
	);

export const withoutCommitment = (data: MonthData, { commitmentId }: { commitmentId: string }) =>
	mapCommitments(data, (commitments) => commitments.filter((c) => c.id !== commitmentId));

export type PaymentVariables = {
	/** A client ULID: retrying or double-submitting the same payment records it once. */
	transactionId: string;
	commitmentId: string;
	commitmentName: string;
	amountCents: number;
	/** Today in the Household's time zone, as the server will date it. */
	date: DayKey;
};

/** Charges with a Commitment payment in them; adding the same one twice changes nothing. */
export function withPayment<T extends Pick<MonthData, "charges">>(
	data: T,
	variables: PaymentVariables,
): T {
	if (data.charges.some((charge) => charge.id === variables.transactionId)) return data;
	const charge: CommitmentCharge = {
		id: variables.transactionId,
		commitmentId: variables.commitmentId,
		amount: variables.amountCents,
		date: variables.date,
	};
	return { ...data, charges: [...data.charges, charge] };
}

/**
 * Records paying a Commitment today, as a Quick Add assigned to it. The payment lands in the
 * month's cached inputs at once (ADR-0006); a failure rolls back and offers a retry of the same
 * payment.
 */
export function useCommitmentPayment() {
	const queryClient = useQueryClient();
	const payment = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: ({ transactionId, commitmentId, amountCents }: PaymentVariables) =>
			addCommitmentPayment({ data: { transactionId, commitmentId, amountCents } }),
		onMutate: async (variables) => {
			const { queryKey } = monthQuery(monthOfDay(variables.date));
			const all = commitmentsQuery().queryKey;
			await Promise.all([
				queryClient.cancelQueries({ queryKey }),
				queryClient.cancelQueries({ queryKey: all }),
			]);
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, withPayment(previous, variables));
			// Coming up counts the payment at once too.
			const previousAll = queryClient.getQueryData(all);
			if (previousAll) queryClient.setQueryData(all, withPayment(previousAll, variables));
			return { previous, queryKey, previousAll };
		},
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
			if (context?.previousAll) {
				queryClient.setQueryData(commitmentsQuery().queryKey, context.previousAll);
			}
			toast(
				`Couldn’t record ${formatMoney(variables.amountCents)} paid to ${variables.commitmentName}, so it’s been undone.`,
				{ tone: "error", action: { label: "Retry", onClick: () => payment.mutate(variables) } },
			);
		},
		onSuccess: (_data, variables) => {
			toast(`${formatMoney(variables.amountCents)} paid to ${variables.commitmentName}`);
		},
		onSettled: () => {
			// Refetching while another change is in flight would briefly undo it on screen.
			if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
				return queryClient.invalidateQueries({ queryKey: monthsKey });
			}
		},
	});
	return payment;
}
