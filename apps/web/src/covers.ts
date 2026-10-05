import type { PlanMove } from "@noodle/db";
import type { Cents, MonthKey } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "./format";
import { monthChangeKey } from "./plan-changes";
import { monthQuery, monthsKey } from "./queries";
import { coverBucket, undoCover } from "./server/covers";
import type { MonthData } from "./server/month";

export type CoverVariables = {
	/** A client ULID: retrying the same Cover records it once. */
	moveId: string;
	month: MonthKey;
	/** Null for Free to Spend. */
	fromBucketId: string | null;
	fromName: string;
	toBucketId: string;
	toName: string;
	amountCents: Cents;
};

export type UndoCoverVariables = Pick<CoverVariables, "moveId" | "month" | "fromName" | "toName">;

/** The server refused a Cover because its source no longer has the amount left. */
class CoverRefused extends Error {
	constructor(readonly left: Cents) {
		super("Not enough left to cover");
	}
}

/** A month's inputs with a Cover's Move in them; adding the same one twice changes nothing. */
export function withCover(data: MonthData, variables: CoverVariables): MonthData {
	if (data.moves.some((move) => move.id === variables.moveId)) return data;
	const move: PlanMove = {
		id: variables.moveId,
		fromBucketId: variables.fromBucketId,
		toBucketId: variables.toBucketId,
		amount: variables.amountCents,
		month: variables.month,
	};
	return { ...data, moves: [...data.moves, move] };
}

/** A month's inputs without a Move. */
export const withoutMove = (data: MonthData, { moveId }: { moveId: string }): MonthData => ({
	...data,
	moves: data.moves.filter((move) => move.id !== moveId),
});

/**
 * Covering an overspent Bucket, and undoing a Cover. Each lands in the month's cached inputs at
 * once (ADR-0006) and rolls back if the server refuses or fails. A Cover's toast offers Undo.
 */
export function useCovers() {
	const queryClient = useQueryClient();

	/** Applies an edit to a month's cached inputs, returning what to roll back to. */
	async function edit(month: MonthKey, change: (data: MonthData) => MonthData) {
		const { queryKey } = monthQuery(month);
		await queryClient.cancelQueries({ queryKey });
		const previous = queryClient.getQueryData(queryKey);
		if (previous) queryClient.setQueryData(queryKey, change(previous));
		return { previous, queryKey };
	}

	function refetchOnceSettled() {
		// Refetching while another change is in flight would briefly undo it on screen.
		if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
			return queryClient.invalidateQueries({ queryKey: monthsKey });
		}
	}

	const undo = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: ({ moveId, month }: UndoCoverVariables) => undoCover({ data: { moveId, month } }),
		onMutate: (variables) => edit(variables.month, (data) => withoutMove(data, variables)),
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
			toast(`Couldn’t undo covering ${variables.toName}, so it’s still covered.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => undo.mutate(variables) },
			});
		},
		onSuccess: (_data, variables) => {
			toast(`Undone: the money is back in ${variables.fromName}`);
		},
		onSettled: refetchOnceSettled,
	});

	const cover = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async ({
			moveId,
			month,
			fromBucketId,
			toBucketId,
			amountCents,
		}: CoverVariables) => {
			const outcome = await coverBucket({
				data: { moveId, month, fromBucketId, toBucketId, amountCents },
			});
			if (!outcome.ok) throw new CoverRefused(outcome.left);
		},
		onMutate: (variables) => edit(variables.month, (data) => withCover(data, variables)),
		onError: (error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(context.queryKey, context.previous);
			if (error instanceof CoverRefused) {
				toast(
					`${variables.fromName} has only ${formatMoney(error.left)} left now, so ${variables.toName} wasn’t covered.`,
					{ tone: "error" },
				);
			} else {
				toast(`Couldn’t cover ${variables.toName}, so it’s been undone.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => cover.mutate(variables) },
				});
			}
		},
		onSuccess: (_data, variables) => {
			toast(
				`${formatMoney(variables.amountCents)} from ${variables.fromName} covers ${variables.toName}`,
				{
					tone: "success",
					undo: () => undo.mutate(variables),
				},
			);
		},
		onSettled: refetchOnceSettled,
	});

	return { cover, undo };
}
