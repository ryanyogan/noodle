import type { Cents, DayKey, MonthKey, WindfallDestination } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { formatMoney } from "./format";
import {
	editCache,
	GoalRefused,
	type GoalsData,
	type Rollback,
	refetchGoalsOnceSettled,
	refetchMonthsOnceSettled,
	rollBack,
	touchesGoals,
	withChange,
	withoutChange,
} from "./goals";
import { monthChangeKey } from "./plan-changes";
import { goalsQuery, monthQuery } from "./queries";
import type { MonthData } from "./server/month";
import { decideWindfall, recordIncome, removeIncome, undoWindfall } from "./server/windfalls";

export type IncomeVariables = {
	/** A client ULID: retrying the same income records it once. */
	incomeId: string;
	/** The Household's current month and today, where it lands. */
	month: MonthKey;
	date: DayKey;
	amountCents: Cents;
	note: string | null;
};

export type WindfallVariables = {
	/** A client ULID: retrying the same decision records it once. */
	moveId: string;
	/** The month the Windfall came in. */
	month: MonthKey;
	to: WindfallDestination;
	toName: string;
	amountCents: Cents;
};

export type UndoWindfallVariables = Pick<WindfallVariables, "moveId" | "month" | "toName">;

/** A month's inputs with income in them; adding the same one twice changes nothing. */
export const withIncome = (data: MonthData, v: IncomeVariables): MonthData =>
	data.income.some((i) => i.id === v.incomeId)
		? data
		: {
				...data,
				income: [
					...data.income,
					{ id: v.incomeId, amount: v.amountCents, date: v.date, note: v.note },
				],
			};

export const withoutIncome = (data: MonthData, { incomeId }: { incomeId: string }): MonthData => ({
	...data,
	income: data.income.filter((i) => i.id !== incomeId),
});

/** A month's inputs with a Windfall Move in them: into a Bucket's Moves, or a Goal's funding. */
export function withWindfall(data: MonthData, v: WindfallVariables): MonthData {
	const { moveId: id, month, amountCents: amount, to } = v;
	if (data.moves.some((m) => m.id === id) || data.goalFunding.some((f) => f.id === id)) return data;
	return to.kind === "goal"
		? {
				...data,
				goalFunding: [
					...data.goalFunding,
					{ id, goalId: to.goalId, amount, month, windfall: true },
				],
			}
		: {
				...data,
				moves: [
					...data.moves,
					{ id, fromBucketId: null, toBucketId: to.bucketId, amount, month, windfall: true },
				],
			};
}

export const withoutWindfall = (data: MonthData, { moveId }: { moveId: string }): MonthData => ({
	...data,
	moves: data.moves.filter((m) => m.id !== moveId),
	goalFunding: data.goalFunding.filter((f) => f.id !== moveId),
});

/** The server refused a Windfall Move: the Windfall had less left, or the destination can't take it. */
class WindfallRefused extends GoalRefused {
	constructor(readonly left: Cents) {
		super("Not enough Windfall left");
	}
}

/**
 * Recording income and removing it. Each lands in the month's cached inputs at once (ADR-0006)
 * and rolls back if the server fails or refuses it; recording's toast offers Undo.
 */
export function useIncome() {
	const queryClient = useQueryClient();

	const remove = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async ({ incomeId, month }: IncomeVariables) => {
			const result = await removeIncome({ data: { incomeId, month } });
			if (!result.ok) throw new GoalRefused();
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withoutIncome(data, v),
			),
		],
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof GoalRefused) {
				toast("Some of this month’s Windfall has gone somewhere already, so the income stays.", {
					tone: "error",
				});
			} else {
				toast("Couldn’t remove the income, so it’s still there.", {
					tone: "error",
					action: { label: "Retry", onClick: () => remove.mutate(v) },
				});
			}
		},
		// Undo puts it back as it was: the same ID, day, amount and note.
		onSuccess: (_data, v) =>
			toast(`${formatMoney(v.amountCents)} of income removed`, {
				tone: "success",
				action: { label: "Undo", onClick: () => record.mutate(v) },
			}),
		onSettled: () => refetchMonthsOnceSettled(queryClient),
	});

	const record = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: ({ incomeId, amountCents, note, date }: IncomeVariables) =>
			recordIncome({ data: { incomeId, amountCents, note, date } }),
		onMutate: async (v): Promise<Rollback> => [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withIncome(data, v),
			),
		],
		onError: (_error, v, rollback) => {
			rollBack(queryClient, rollback);
			toast(`Couldn’t record ${formatMoney(v.amountCents)} of income, so it’s been undone.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => record.mutate(v) },
			});
		},
		onSuccess: (_data, v) => {
			toast(`${formatMoney(v.amountCents)} of income recorded`, {
				tone: "success",
				action: { label: "Undo", onClick: () => remove.mutate(v) },
			});
		},
		onSettled: () => refetchMonthsOnceSettled(queryClient),
	});

	return { record, remove };
}

/**
 * Deciding where a Windfall goes, and undoing it. A Move to a Goal lands in the cached Goals
 * records and the month's inputs at once, a Move to a Bucket in the month's; each rolls back if
 * the server fails or refuses it. Deciding's toast offers Undo.
 */
export function useWindfalls() {
	const queryClient = useQueryClient();

	function onSettled() {
		return Promise.all([
			refetchGoalsOnceSettled(queryClient),
			refetchMonthsOnceSettled(queryClient),
		]);
	}

	async function add(v: WindfallVariables): Promise<Rollback> {
		const { to } = v;
		return [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withWindfall(data, v),
			),
			...(to.kind === "goal"
				? [
						await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
							withChange(data, {
								id: v.moveId,
								goalId: to.goalId,
								kind: "funding",
								amount: v.amountCents,
								month: v.month,
								from: "windfall",
							}),
						),
					]
				: []),
		];
	}

	const remove = async (v: UndoWindfallVariables): Promise<Rollback> => [
		await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
			withoutWindfall(data, v),
		),
		await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
			withoutChange(data, v.moveId),
		),
	];

	const undo = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ moveId, month }: UndoWindfallVariables) => {
			const result = await undoWindfall({ data: { moveId, month } });
			if (!result.ok) throw new GoalRefused();
		},
		onMutate: remove,
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			toast(
				error instanceof GoalRefused
					? `${v.toName} has spent some of it already, so it can’t be undone.`
					: `Couldn’t undo that, so it’s still in ${v.toName}.`,
				error instanceof GoalRefused
					? { tone: "error" }
					: { tone: "error", action: { label: "Retry", onClick: () => undo.mutate(v) } },
			);
		},
		onSuccess: () => toast("Undone: the money is back in the Windfall"),
		onSettled,
	});

	const decide = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ moveId, month, to, amountCents }: WindfallVariables) => {
			const outcome = await decideWindfall({ data: { moveId, month, to, amountCents } });
			if (!outcome.ok) throw new WindfallRefused(outcome.left);
		},
		onMutate: add,
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof WindfallRefused) {
				toast(
					error.left < v.amountCents
						? `The Windfall has only ${formatMoney(error.left)} left, so nothing went to ${v.toName}.`
						: `${v.toName} can’t take it now.`,
					{ tone: "error" },
				);
			} else {
				toast(`Couldn’t send the Windfall to ${v.toName}, so it’s been undone.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => decide.mutate(v) },
				});
			}
		},
		onSuccess: (_data, v) => {
			toast(`${formatMoney(v.amountCents)} of the Windfall to ${v.toName}`, {
				tone: "success",
				action: { label: "Undo", onClick: () => undo.mutate(v) },
			});
		},
		onSettled,
	});

	return { decide, undo };
}
