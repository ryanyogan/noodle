import type { CommitmentCharge } from "@noodle/db";
import {
	type Cadence,
	type CommitmentState,
	type DayKey,
	type MonthKey,
	monthOfDay,
	type PlanCommitment,
	type PlanScope,
} from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney, monthName, shortDay } from "./format";
import { monthChangeKey } from "./plan-changes";
import { monthQuery, monthsKey } from "./queries";
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
	plan: { ...data.plan, commitments: change(data.plan.commitments) },
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

/** A month's inputs with a Commitment payment in them; adding the same one twice changes nothing. */
export function withPayment(data: MonthData, variables: PaymentVariables): MonthData {
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
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, withPayment(previous, variables));
			return { previous, queryKey };
		},
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
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
