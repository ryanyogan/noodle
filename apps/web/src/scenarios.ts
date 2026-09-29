import { earmarkOf, type Lever, type ProjectionGoal } from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import type { GoalsData } from "./goals";
import { monthChangeKey } from "./plan-changes";
import { goalsQuery, monthsKey, scenariosQuery } from "./queries";
import {
	applyScenario,
	deleteScenario,
	type ScenarioRecord,
	saveScenario,
} from "./server/scenarios";

export type { ScenarioRecord };

// ---------------------------------------------------------------------------------------------
// Levers. A Scenario holds at most one Lever per Bucket, Commitment or Goal.

/** What a Lever adjusts: one per Bucket, Commitment, Goal or new Commitment. */
export const leverTarget = (lever: Lever) =>
	lever.kind === "allowance"
		? `bucket:${lever.bucketId}`
		: lever.kind === "end-commitment"
			? `commitment:${lever.commitmentId}`
			: lever.kind === "goal"
				? `goal:${lever.goalId}`
				: `new-commitment:${lever.commitmentId}`;

/** The Levers with `lever` in place of any other on the same thing. */
export const withLever = (levers: readonly Lever[], lever: Lever): Lever[] => [
	...levers.filter((l) => leverTarget(l) !== leverTarget(lever)),
	lever,
];

/** The Levers without any on `target` (see leverTarget). */
export const withoutLever = (levers: readonly Lever[], target: string): Lever[] =>
	levers.filter((l) => leverTarget(l) !== target);

/**
 * The Household's active Goals as a projection starts from them: their Earmarks now and what
 * Goal funding has already Moved into them this month.
 */
export function projectionGoals(data: GoalsData): (ProjectionGoal & { name: string })[] {
	return data.goals
		.filter((g) => !g.completed && !g.archived)
		.map((g) => ({
			id: g.id,
			name: g.name,
			target: g.target,
			targetDate: g.targetDate,
			saved: earmarkOf(g.id, data.changes),
			fundedThisMonth: earmarkOf(
				g.id,
				data.changes.filter((c) => c.kind === "funding" && c.month === data.month),
			),
		}));
}

// ---------------------------------------------------------------------------------------------
// Changes. Saving and deleting a Scenario edit the cached list at once and roll back on failure.

export type SaveScenarioVariables = { scenarioId: string; name: string; levers: Lever[] };

/** The Scenarios with this one saved, first as the most recently changed. */
export const withScenario = (
	scenarios: ScenarioRecord[],
	{ scenarioId, name, levers }: SaveScenarioVariables,
): ScenarioRecord[] => [
	{ id: scenarioId, name, levers, updatedAt: Date.now() },
	...scenarios.filter((s) => s.id !== scenarioId),
];

async function editScenarios(
	queryClient: QueryClient,
	change: (scenarios: ScenarioRecord[]) => ScenarioRecord[],
) {
	const { queryKey } = scenariosQuery();
	await queryClient.cancelQueries({ queryKey });
	const previous = queryClient.getQueryData(queryKey);
	if (previous) queryClient.setQueryData(queryKey, change(previous));
	return { previous };
}

function useScenarioChange<TVariables>({
	save,
	apply,
	failed,
}: {
	save: (variables: TVariables) => Promise<unknown>;
	apply: (scenarios: ScenarioRecord[], variables: TVariables) => ScenarioRecord[];
	failed: (variables: TVariables) => string;
}) {
	const queryClient = useQueryClient();
	const change = useMutation({
		mutationKey: ["scenario-change"],
		mutationFn: save,
		onMutate: (variables) => editScenarios(queryClient, (s) => apply(s, variables)),
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(scenariosQuery().queryKey, context.previous);
			toast(failed(variables), {
				tone: "error",
				action: { label: "Retry", onClick: () => change.mutate(variables) },
			});
		},
		onSettled: () => {
			if (queryClient.isMutating({ mutationKey: ["scenario-change"] }) === 1) {
				return queryClient.invalidateQueries({ queryKey: scenariosQuery().queryKey });
			}
		},
	});
	return change;
}

export const useSaveScenario = () =>
	useScenarioChange<SaveScenarioVariables>({
		save: (data) => saveScenario({ data }),
		apply: withScenario,
		failed: ({ name }) => `Couldn’t save “${name}”.`,
	});

export const useDeleteScenario = () =>
	useScenarioChange<{ scenarioId: string; name: string }>({
		save: ({ scenarioId }) => deleteScenario({ data: { scenarioId } }),
		apply: (scenarios, { scenarioId }) => scenarios.filter((s) => s.id !== scenarioId),
		failed: ({ name }) => `Couldn’t delete “${name}”, so it’s back.`,
	});

/**
 * Makes a Scenario's Levers the real Plan from this month on. The server writes them all at
 * once; every month and the Goals are refetched after, since the change carries forward.
 */
export function useApplyScenario() {
	const queryClient = useQueryClient();
	const apply = useMutation({
		// Shares the key of every change to a month, so their refetches don't undo one another.
		mutationKey: monthChangeKey,
		mutationFn: ({ levers }: { name: string; levers: Lever[] }) =>
			applyScenario({ data: { levers } }),
		onError: (_error, variables) => {
			toast(`Couldn’t apply “${variables.name}”. The Plan hasn’t changed.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => apply.mutate(variables) },
			});
		},
		onSuccess: (_data, { name }) => toast(`“${name}” is now the Plan`),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey }),
				queryClient.isMutating({ mutationKey: monthChangeKey }) === 1
					? queryClient.invalidateQueries({ queryKey: monthsKey })
					: undefined,
			]),
	});
	return apply;
}
