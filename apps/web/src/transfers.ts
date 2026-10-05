import type { MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { monthChangeKey } from "./plan-changes";
import { bucketUsesQuery, monthQuery, monthsKey } from "./queries";
import {
	getTransactionMoney,
	linkRefund,
	type MoneyResult,
	markTransfer,
	unlinkRefund,
	unmarkTransfer,
} from "./server/transfers";

export type { MoneyPeer, RefundView, TransferView } from "./server/transfers";

/**
 * A Transaction's Transfer and Refund link, or what a Parent may do about either. Kept under its
 * month, so anything that refetches the month (an Import, the other Parent's write) refetches it.
 */
export const moneyQuery = (transaction: { id: string; date: string }) =>
	queryOptions({
		queryKey: [
			...monthQuery(transaction.date.slice(0, 7) as MonthKey).queryKey,
			"money",
			transaction.id,
		],
		queryFn: () => getTransactionMoney({ data: { transactionId: transaction.id } }),
	});

export type MoneyChange =
	| {
			kind: "mark";
			transferId: string;
			transactionId: string;
			label: string;
			/** Money to or from the other Parent, when only this side is in Noodle. */
			reason?: "between-us";
	  }
	| { kind: "unmark"; transferId: string; label: string }
	| {
			kind: "link";
			refundId: string;
			refundTransactionId: string;
			originalTransactionId: string;
			label: string;
	  }
	| { kind: "unlink"; refundId: string; label: string };

const send = (change: MoneyChange): Promise<MoneyResult> => {
	switch (change.kind) {
		case "mark":
			return markTransfer({
				data: {
					transferId: change.transferId,
					transactionId: change.transactionId,
					reason: change.reason,
				},
			});
		case "unmark":
			return unmarkTransfer({ data: { transferId: change.transferId } });
		case "link":
			return linkRefund({
				data: {
					refundId: change.refundId,
					refundTransactionId: change.refundTransactionId,
					originalTransactionId: change.originalTransactionId,
				},
			});
		case "unlink":
			return unlinkRefund({ data: { refundId: change.refundId } });
	}
};

const done: Record<MoneyChange["kind"], string> = {
	mark: "marked as a Transfer",
	unmark: "no longer a Transfer",
	link: "linked as a Refund",
	unlink: "unlinked",
};

const failed: Record<MoneyChange["kind"], string> = {
	mark: "mark {label} as a Transfer",
	unmark: "unmark {label}",
	link: "link {label} as a Refund",
	unlink: "unlink {label}",
};

/**
 * Marks or unmarks a Transfer, or links or unlinks a Refund. Not optimistic: which side pairs
 * and what the Refund takes on are the server's to decide, so the month and its lists are
 * refetched once it lands.
 */
export function useMoneyChange() {
	const queryClient = useQueryClient();
	const change = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: send,
		onSuccess: (result, variables) => {
			if (!result.ok) {
				toast(
					`Couldn’t ${failed[variables.kind].replace("{label}", variables.label)}: it was just changed.`,
					{ tone: "error" },
				);
				return;
			}
			if (variables.kind === "mark" && variables.reason === "between-us") {
				toast(`${variables.label} marked as between us`, {
					tone: "success",
					undo: () =>
						change.mutate({
							kind: "unmark",
							transferId: variables.transferId,
							label: variables.label,
						}),
				});
				return;
			}
			toast(`${variables.label} ${done[variables.kind]}`);
		},
		onError: (_error, variables) => {
			toast(`Couldn’t ${failed[variables.kind].replace("{label}", variables.label)}.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => change.mutate(variables) },
			});
		},
		onSettled: () => {
			// Refetching while another change is in flight would briefly undo it on screen.
			if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
				return Promise.all([
					queryClient.invalidateQueries({ queryKey: monthsKey }),
					queryClient.invalidateQueries({ queryKey: bucketUsesQuery().queryKey }),
				]);
			}
		},
	});
	return change;
}

/**
 * Where a Transfer's money went, for its row: "Transfer · Checking → Visa", or one side's Account.
 * One side alone that a Parent said was between the two of them reads "Between us · out of Checking".
 */
export function transferDetail(transfer: {
	from: string | null;
	to: string | null;
	reason?: string | null;
}): string {
	if (transfer.from && transfer.to) return `Transfer · ${transfer.from} → ${transfer.to}`;
	if (transfer.reason === "between-us") {
		if (transfer.from) return `Between us · out of ${transfer.from}`;
		if (transfer.to) return `Between us · into ${transfer.to}`;
		return "Between us";
	}
	if (transfer.from) return `Transfer out of ${transfer.from}`;
	if (transfer.to) return `Transfer into ${transfer.to}`;
	return "Transfer";
}
