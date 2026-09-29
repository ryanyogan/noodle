import type { MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { queryOptions, useMutation, useQueryClient } from "@tanstack/react-query";
import { monthChangeKey } from "./plan-changes";
import { bucketUsesQuery, monthQuery, monthsKey } from "./queries";
import {
	getTransactionMatch,
	type MatchResult,
	matchTransaction,
	unmatchTransaction,
} from "./server/matches";

export type { MatchView } from "./server/matches";

/**
 * A Transaction's Match, or what it might be Matched with. Kept under its month, so anything
 * that refetches the month (an Import, the other Parent's write) refetches it too.
 */
export const matchQuery = (transaction: { id: string; date: string }) =>
	queryOptions({
		queryKey: [
			...monthQuery(transaction.date.slice(0, 7) as MonthKey).queryKey,
			"match",
			transaction.id,
		],
		queryFn: () => getTransactionMatch({ data: { transactionId: transaction.id } }),
	});

export type MatchChange =
	| { kind: "match"; matchId: string; quickAddId: string; importedId: string; label: string }
	| { kind: "unmatch"; matchId: string; label: string };

/**
 * Matches or unmatches by hand. Not optimistic: which row stays listed depends on the server,
 * so the month and its lists are refetched once it lands.
 */
export function useMatchChange() {
	const queryClient = useQueryClient();
	const change = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: (variables: MatchChange): Promise<MatchResult> =>
			variables.kind === "match"
				? matchTransaction({
						data: {
							matchId: variables.matchId,
							quickAddId: variables.quickAddId,
							importedId: variables.importedId,
						},
					})
				: unmatchTransaction({ data: { matchId: variables.matchId } }),
		onSuccess: (result, variables) => {
			if (!result.ok) {
				toast(
					variables.kind === "match"
						? `Couldn’t Match ${variables.label}: one of them was just Matched or changed.`
						: `Couldn’t unmatch ${variables.label}.`,
					{ tone: "error" },
				);
				return;
			}
			toast(
				variables.kind === "match" ? `${variables.label} Matched` : `${variables.label} unmatched`,
			);
		},
		onError: (_error, variables) => {
			toast(
				variables.kind === "match"
					? `Couldn’t Match ${variables.label}.`
					: `Couldn’t unmatch ${variables.label}.`,
				{ tone: "error", action: { label: "Retry", onClick: () => change.mutate(variables) } },
			);
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
