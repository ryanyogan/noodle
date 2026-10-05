import type { IncomeRecord } from "@noodle/db";
import type { Cents, DayKey, ExtraIncomeDestination, MonthKey } from "@noodle/domain";
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
import {
	decideExtraIncome,
	recordIncome,
	removeIncome,
	undoExtraIncome,
} from "./server/extra-income";
import type { MonthData } from "./server/month";
import { markIncomeTransfer, unmarkTransfer } from "./server/transfers";

export type IncomeVariables = {
	/** A client ULID: retrying the same income records it once. */
	incomeId: string;
	/** The Household's current month and today, where it lands. */
	month: MonthKey;
	date: DayKey;
	amountCents: Cents;
	note: string | null;
};

export type ExtraIncomeVariables = {
	/** A client ULID: retrying the same decision records it once. */
	moveId: string;
	/** The month the Extra income came in. */
	month: MonthKey;
	to: ExtraIncomeDestination;
	toName: string;
	amountCents: Cents;
};

export type UndoExtraIncomeVariables = Pick<ExtraIncomeVariables, "moveId" | "month" | "toName">;

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

/**
 * A month's inputs with Extra income Move in them: into a Bucket's Moves, a Goal's funding, or
 * what's been added to Free to Spend.
 */
export function withExtraIncome(data: MonthData, v: ExtraIncomeVariables): MonthData {
	const { moveId: id, month, amountCents: amount, to } = v;
	const toFree = data.extraToFree ?? [];
	if (
		data.moves.some((m) => m.id === id) ||
		data.goalFunding.some((f) => f.id === id) ||
		toFree.some((e) => e.id === id)
	) {
		return data;
	}
	if (to.kind === "free-to-spend") {
		return { ...data, extraToFree: [...toFree, { id, amount, month }] };
	}
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

export const withoutExtraIncome = (data: MonthData, { moveId }: { moveId: string }): MonthData => ({
	...data,
	moves: data.moves.filter((m) => m.id !== moveId),
	goalFunding: data.goalFunding.filter((f) => f.id !== moveId),
	extraToFree: (data.extraToFree ?? []).filter((e) => e.id !== moveId),
});

/** The server refused Extra income Move: the Extra income had less left, or the destination can't take it. */
class ExtraIncomeRefused extends GoalRefused {
	constructor(readonly left: Cents) {
		super("Not enough Extra income left");
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
				toast(
					"Some of this month’s Extra income has gone somewhere already, so the income stays.",
					{
						tone: "error",
					},
				);
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
				undo: () => record.mutate(v),
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
				undo: () => remove.mutate(v),
			});
		},
		onSettled: () => refetchMonthsOnceSettled(queryClient),
	});

	return { record, remove };
}

/**
 * Deciding where Extra income goes, and undoing it. A Move to a Goal lands in the cached Goals
 * records and the month's inputs at once, a Move to a Bucket in the month's; each rolls back if
 * the server fails or refuses it. Deciding's toast offers Undo.
 */
export function useExtraIncomes() {
	const queryClient = useQueryClient();

	function onSettled() {
		return Promise.all([
			refetchGoalsOnceSettled(queryClient),
			refetchMonthsOnceSettled(queryClient),
		]);
	}

	async function add(v: ExtraIncomeVariables): Promise<Rollback> {
		const { to } = v;
		return [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				withExtraIncome(data, v),
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

	const remove = async (v: UndoExtraIncomeVariables): Promise<Rollback> => [
		await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
			withoutExtraIncome(data, v),
		),
		await editCache<GoalsData>(queryClient, goalsQuery().queryKey, (data) =>
			withoutChange(data, v.moveId),
		),
	];

	const undo = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ moveId, month }: UndoExtraIncomeVariables) => {
			const result = await undoExtraIncome({ data: { moveId, month } });
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
		onSuccess: () => toast("Undone: the money is back with the Extra income"),
		onSettled,
	});

	const decide = useMutation({
		mutationKey: monthChangeKey,
		meta: touchesGoals,
		mutationFn: async ({ moveId, month, to, amountCents }: ExtraIncomeVariables) => {
			const outcome = await decideExtraIncome({ data: { moveId, month, to, amountCents } });
			if (!outcome.ok) throw new ExtraIncomeRefused(outcome.left);
		},
		onMutate: add,
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof ExtraIncomeRefused) {
				toast(
					error.left < v.amountCents
						? `Only ${formatMoney(error.left)} of the Extra income is left, so nothing went to ${v.toName}.`
						: `${v.toName} can’t take it now.`,
					{ tone: "error" },
				);
			} else {
				toast(`Couldn’t send the Extra income to ${v.toName}, so it’s been undone.`, {
					tone: "error",
					action: { label: "Retry", onClick: () => decide.mutate(v) },
				});
			}
		},
		onSuccess: (_data, v) => {
			// Sent in one click, so it's said with an Undo.
			toast(`${formatMoney(v.amountCents)} of the Extra income to ${v.toName}`, {
				tone: "success",
				undo: () => undo.mutate(v),
			});
		},
		onSettled,
	});

	return { decide, undo };
}

export type BetweenUsVariables = {
	/** A client ULID: retrying the same mark writes it once; unmarking names the same one. */
	transferId: string;
	month: MonthKey;
	entry: IncomeRecord;
};

const plainIncome = ({ id, amount, date, note }: IncomeRecord): IncomeRecord => ({
	id,
	amount,
	date,
	note,
});

/** A month's inputs with income moved out of Income, into what's between the two Parents. */
export const asBetweenUs = (data: MonthData, v: BetweenUsVariables): MonthData => ({
	...data,
	income: data.income.filter((i) => i.id !== v.entry.id),
	betweenUs: [
		...(data.betweenUs ?? []).filter((b) => b.id !== v.entry.id),
		{ ...plainIncome(v.entry), transferId: v.transferId },
	],
});

/** A month's inputs with income that was between the two Parents counted as Income again. */
export const asIncomeAgain = (data: MonthData, v: BetweenUsVariables): MonthData => ({
	...data,
	betweenUs: (data.betweenUs ?? []).filter((b) => b.id !== v.entry.id),
	income: data.income.some((i) => i.id === v.entry.id)
		? data.income
		: [...data.income, plainIncome(v.entry)].sort(
				(a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
			),
});

class BetweenUsRefused extends Error {
	constructor(readonly reason: "refused" | "extra-income") {
		super("Not marked as between us");
	}
}

/**
 * Marking income as "Between us" (money the other Parent sent: not Income, not spending) and
 * counting it as Income again. Each lands in the month's cached inputs at once (ADR-0006) and
 * rolls back if the server fails or refuses it; marking's toast offers Undo.
 */
export function useBetweenUs() {
	const queryClient = useQueryClient();

	const unmark = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async ({ transferId }: BetweenUsVariables) => {
			const result = await unmarkTransfer({ data: { transferId } });
			if (!result.ok) throw new BetweenUsRefused("refused");
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				asIncomeAgain(data, v),
			),
		],
		onError: (_error, _v, rollback) => {
			rollBack(queryClient, rollback);
			toast("Couldn’t count it as Income again, so it’s still between you.", { tone: "error" });
		},
		onSuccess: (_data, v) =>
			toast(`${formatMoney(v.entry.amount)} counts as Income again`, { tone: "success" }),
		onSettled: () => refetchMonthsOnceSettled(queryClient),
	});

	const mark = useMutation({
		mutationKey: monthChangeKey,
		mutationFn: async ({ transferId, entry }: BetweenUsVariables) => {
			const result = await markIncomeTransfer({ data: { transferId, incomeId: entry.id } });
			if (!result.ok) throw new BetweenUsRefused(result.reason);
		},
		onMutate: async (v): Promise<Rollback> => [
			await editCache<MonthData>(queryClient, monthQuery(v.month).queryKey, (data) =>
				asBetweenUs(data, v),
			),
		],
		onError: (error, v, rollback) => {
			rollBack(queryClient, rollback);
			if (error instanceof BetweenUsRefused) {
				toast(
					error.reason === "extra-income"
						? "Some of this month’s Extra income has gone somewhere already, so this stays Income."
						: "Couldn’t mark it as between us: it was just changed.",
					{ tone: "error" },
				);
			} else {
				toast("Couldn’t mark it as between us, so it’s still Income.", {
					tone: "error",
					action: { label: "Retry", onClick: () => mark.mutate(v) },
				});
			}
		},
		onSuccess: (_data, v) =>
			toast(`${formatMoney(v.entry.amount)} is between you, so it isn’t Income`, {
				tone: "success",
				undo: () => unmark.mutate(v),
			}),
		onSettled: () => refetchMonthsOnceSettled(queryClient),
	});

	return { mark, unmark };
}
