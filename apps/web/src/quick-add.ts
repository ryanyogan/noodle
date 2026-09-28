import type { BucketSpend } from "@noodle/db";
import { type DayKey, monthOfDay } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { bucketUsesQuery, monthQuery, monthsKey } from "./queries";
import type { MonthData } from "./server/month";
import { addQuickAdd } from "./server/transactions";

export type QuickAddVariables = {
	/** A client ULID: retrying or double-submitting the same Quick Add records it once. */
	transactionId: string;
	bucketId: string;
	bucketName: string;
	amountCents: number;
	note: string;
	/** Today in the Household's time zone, as the server will date it. */
	date: DayKey;
};

/** A month's inputs with a Quick Add's spending in them; adding the same one twice changes nothing. */
export function withQuickAdd(data: MonthData, variables: QuickAddVariables): MonthData {
	if (data.spending.some((spend) => spend.id === variables.transactionId)) return data;
	const spend: BucketSpend = {
		id: variables.transactionId,
		bucketId: variables.bucketId,
		amount: variables.amountCents,
		date: variables.date,
	};
	return { ...data, spending: [...data.spending, spend] };
}

/**
 * Records a Quick Add. Its spending lands in the month's cached inputs at once (ADR-0006), so
 * every screen showing that Bucket recomputes with @noodle/domain before the server answers.
 * A failure rolls back and offers a retry of the same Quick Add. Lives in the app frame, not
 * the sheet, so it finishes after the sheet closes.
 */
export function useQuickAdd() {
	const queryClient = useQueryClient();
	const quickAdd = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: ({ transactionId, bucketId, amountCents, note }: QuickAddVariables) =>
			addQuickAdd({ data: { transactionId, bucketId, amountCents, note: note || undefined } }),
		onMutate: async (variables) => {
			const { queryKey } = monthQuery(monthOfDay(variables.date));
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, withQuickAdd(previous, variables));
			return { previous, queryKey };
		},
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
			toast(
				`Couldn’t save ${formatMoney(variables.amountCents)} to ${variables.bucketName}, so it’s been undone.`,
				{ tone: "error", action: { label: "Retry", onClick: () => quickAdd.mutate(variables) } },
			);
		},
		onSuccess: (_data, variables) => {
			toast(`${formatMoney(variables.amountCents)} added to ${variables.bucketName}`);
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
	return quickAdd;
}
