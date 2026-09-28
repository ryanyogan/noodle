import type { MonthKey, PlanBucket } from "@noodle/domain";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { monthQuery, monthsKey } from "./queries";
import type { MonthData } from "./server/month";

/**
 * Every change that edits a month's cached inputs (Plan changes, Quick Adds) shares this key, so
 * the refetch after one waits until none is in flight rather than briefly undoing another.
 */
export const monthChangeKey = ["month-change"] as const;

/**
 * A change to the Plan, applied to the month's cached inputs at once (ADR-0006) so every screen
 * showing that month recomputes its state with @noodle/domain before the server answers. A
 * failure rolls the cache back; the returned mutation's `isError` and `variables` let the caller
 * offer a retry. Once the last concurrent change settles, every month is refetched, since a
 * Plan change carries into later months.
 */
export function usePlanChange<TVariables>(
	month: MonthKey,
	{
		save,
		apply,
	}: {
		save: (variables: TVariables) => Promise<unknown>;
		apply: (data: MonthData, variables: TVariables) => MonthData;
	},
) {
	const queryClient = useQueryClient();
	const { queryKey } = monthQuery(month);
	return useMutation({
		mutationKey: monthChangeKey,
		mutationFn: save,
		onMutate: async (variables) => {
			await queryClient.cancelQueries({ queryKey });
			const previous = queryClient.getQueryData(queryKey);
			if (previous) queryClient.setQueryData(queryKey, apply(previous, variables));
			return { previous };
		},
		onError: (_error, _variables, context) => {
			if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
		},
		onSettled: () => {
			// Refetching while another change is in flight would briefly undo it on screen.
			if (queryClient.isMutating({ mutationKey: monthChangeKey }) === 1) {
				return queryClient.invalidateQueries({ queryKey: monthsKey });
			}
		},
	});
}

// The optimistic edits, mirroring what each server function records.

const mapPlan = (data: MonthData, change: (plan: MonthData["plan"]) => MonthData["plan"]) => ({
	...data,
	plan: change(data.plan),
});

const mapBucket = (data: MonthData, bucketId: string, change: (b: PlanBucket) => PlanBucket) =>
	mapPlan(data, (plan) => ({
		...plan,
		buckets: plan.buckets.map((b) => (b.id === bucketId ? change(b) : b)),
	}));

export const withBaseline = (data: MonthData, { amountCents }: { amountCents: number }) =>
	mapPlan(data, (plan) => ({ ...plan, baseline: amountCents }));

export const withAllowance = (
	data: MonthData,
	{ bucketId, amountCents }: { bucketId: string; amountCents: number },
) => mapBucket(data, bucketId, (b) => ({ ...b, allowance: amountCents }));

export const withRolling = (
	data: MonthData,
	{ bucketId, rolling }: { bucketId: string; rolling: boolean },
) => mapBucket(data, bucketId, (b) => ({ ...b, rolling }));

export const withBucketDetails = (
	data: MonthData,
	{ bucketId, name, color }: { bucketId: string; name?: string; color?: number },
) => mapBucket(data, bucketId, (b) => ({ ...b, name: name ?? b.name, color: color ?? b.color }));

export const withNewBucket = (
	data: MonthData,
	{
		bucketId,
		name,
		color,
		allowanceCents,
	}: { bucketId: string; name: string; color: number; allowanceCents: number },
) =>
	mapPlan(data, (plan) =>
		plan.buckets.some((b) => b.id === bucketId)
			? plan
			: {
					...plan,
					buckets: [
						...plan.buckets,
						{ id: bucketId, name, color, allowance: allowanceCents, rolling: false },
					],
				},
	);

export const withOrder = (data: MonthData, { bucketIds }: { bucketIds: string[] }) =>
	mapPlan(data, (plan) => ({
		...plan,
		buckets: [...plan.buckets].sort((a, b) => bucketIds.indexOf(a.id) - bucketIds.indexOf(b.id)),
	}));

export const withoutBucket = (data: MonthData, { bucketId }: { bucketId: string }) =>
	mapPlan(data, (plan) => ({ ...plan, buckets: plan.buckets.filter((b) => b.id !== bucketId) }));
