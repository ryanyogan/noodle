import { type Cents, type DayKey, type MonthKey, monthOfDay } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { monthName } from "./format";
import {
	editCache,
	type GoalsData,
	type Rollback,
	refetchGoalsOnceSettled,
	refetchMonthsOnceSettled,
	rollBack,
	touchesGoals,
	withChange,
} from "./goals";
import { monthChangeKey } from "./plan-changes";
import { goalsQuery, monthQuery } from "./queries";
import type { MonthData } from "./server/month";
import { closeMonth } from "./server/month-close";

export type CloseMonthVariables = {
	/** A client ULID: retrying the same decision closes the month once. */
	closeId: string;
	/** The month that ended. */
	month: MonthKey;
	/** The Parent deciding. */
	parentId: string;
	sweeps: { bucketId: string; goalId: string; amountCents: Cents }[];
	/** Each with a client ULID for its Move. */
	windfall: { moveId: string; goalId: string; amountCents: Cents }[];
};

/** The first week of `month`, while This Month asks the Parents to close the one before. */
export const closingWeek = (month: MonthKey, asOf: DayKey) =>
	monthOfDay(asOf) === month && Number(asOf.slice(8)) <= 7;

/** A Sweep's Move ID, as the server names it (see closeMonth). */
const sweepId = (closeId: string, bucketId: string) => `${closeId}:${bucketId}`;

/** A month's inputs once closed with a decision: its Sweeps and Windfall Moves in them. */
export function withMonthClosed(data: MonthData, v: CloseMonthVariables): MonthData {
	if (data.closed) return data;
	return {
		...data,
		closed: { decidedBy: v.parentId },
		sweeps: [
			...data.sweeps,
			...v.sweeps.map((s) => ({
				id: sweepId(v.closeId, s.bucketId),
				bucketId: s.bucketId,
				goalId: s.goalId,
				amount: s.amountCents,
				month: v.month,
			})),
		],
		goalFunding: [
			...data.goalFunding,
			...v.windfall.map((w) => ({
				id: w.moveId,
				goalId: w.goalId,
				amount: w.amountCents,
				month: v.month,
				windfall: true,
			})),
		],
	};
}

/** The Goals records with a decision's Sweeps and Windfall Moves in their Earmarks. */
function withClosingFunding(data: GoalsData, v: CloseMonthVariables): GoalsData {
	const changes = [
		...v.sweeps.map((s) => ({
			id: sweepId(v.closeId, s.bucketId),
			goalId: s.goalId,
			amount: s.amountCents,
			from: "sweep" as const,
		})),
		...v.windfall.map((w) => ({
			id: w.moveId,
			goalId: w.goalId,
			amount: w.amountCents,
			from: "windfall" as const,
		})),
	];
	return changes.reduce(
		(goals, change) => withChange(goals, { ...change, kind: "funding", month: v.month }),
		data,
	);
}

/** The server refused the decision: the month was closed already, or no longer matches it. */
class CloseRefused extends Error {
	constructor(readonly reason: "already-closed" | "changed") {
		super(reason);
	}
}

/**
 * The Parents' decision as a month closes. It lands in the month's cached inputs and the Goals
 * records at once (ADR-0006), and rolls back if the server fails or refuses it.
 */
export function useCloseMonth() {
	const queryClient = useQueryClient();
	const close = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ parentId: _, ...data }: CloseMonthVariables) => {
			const result = await closeMonth({ data });
			if (!result.ok) throw new CloseRefused(result.reason);
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withMonthClosed(data, v),
			),
			await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
				withClosingFunding(data, v),
			),
		],
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			const name = monthName(v.month);
			if (error instanceof CloseRefused) {
				toast(
					error.reason === "already-closed"
						? `${name} was already closed.`
						: `${name} changed since you looked, so nothing moved. Check it again.`,
					{ tone: "error" },
				);
			} else {
				toast(`Couldn’t close ${name}, so nothing moved.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => close.mutate(v) },
				});
			}
		},
		onSuccess: (_data, v) => toast(`${monthName(v.month)} closed`, { tone: "success" }),
		onSettled: () =>
			Promise.all([refetchGoalsOnceSettled(queryClient), refetchMonthsOnceSettled(queryClient)]),
	});
	return close;
}
