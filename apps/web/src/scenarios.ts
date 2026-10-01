import {
	earmarkOf,
	type Lever,
	type MonthKey,
	type ProjectionGoal,
	parseLeverPreset,
} from "@noodle/domain";
import { toast } from "@noodle/ui/components/toast";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ulid } from "ulid";
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
// Levers. A Scenario holds at most one Lever per thing it adjusts (see leverTarget).

/** What a Lever adjusts: one per Bucket, Commitment, Goal, new one, one-off, or the Baseline. */
export function changeTarget(scenarioChange: Lever): string {
	switch (scenarioChange.kind) {
		case "baseline":
		case "growth":
			return scenarioChange.kind;
		case "allowance":
			return `bucket:${scenarioChange.bucketId}`;
		case "add-bucket":
			return `new-bucket:${scenarioChange.bucketId}`;
		case "archive-bucket":
			return `archive-bucket:${scenarioChange.bucketId}`;
		case "commitment-terms":
			return `terms:${scenarioChange.commitmentId}`;
		case "end-commitment":
			return `commitment:${scenarioChange.commitmentId}`;
		case "add-commitment":
			return `new-commitment:${scenarioChange.commitmentId}`;
		case "goal":
			return `goal:${scenarioChange.goalId}`;
		case "add-goal":
			return `new-goal:${scenarioChange.goalId}`;
		case "one-off":
			return `one-off:${scenarioChange.oneOffId}`;
	}
}

/**
 * The Levers with `lever` in place of the one on the same thing (where it was, so "Your changes"
 * keeps its order), or added last.
 */
export function withChange(scenarioChanges: readonly Lever[], scenarioChange: Lever): Lever[] {
	const target = changeTarget(scenarioChange);
	const index = scenarioChanges.findIndex((l) => changeTarget(l) === target);
	return index === -1
		? [...scenarioChanges, scenarioChange]
		: scenarioChanges.map((l, i) => (i === index ? scenarioChange : l));
}

/** The Levers without any on `target` (see leverTarget). */
export const withoutChange = (scenarioChanges: readonly Lever[], target: string): Lever[] =>
	scenarioChanges.filter((l) => changeTarget(l) !== target);

/** The Levers with the one on `target` muted (left out of the projection) or counted again. */
export const withMuted = (
	scenarioChanges: readonly Lever[],
	target: string,
	muted: boolean,
): Lever[] =>
	scenarioChanges.map((l) => {
		if (changeTarget(l) !== target) return l;
		const { muted: _, ...counted } = l;
		return muted ? { ...counted, muted: true } : (counted as Lever);
	});

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

/**
 * The Scenarios with this one saved, first as the most recently changed. It keeps who made it
 * and when it was applied, if it was saved before.
 */
export const withScenario = (
	scenarios: ScenarioRecord[],
	{ scenarioId, name, levers }: SaveScenarioVariables,
): ScenarioRecord[] => {
	const was = scenarios.find((s) => s.id === scenarioId);
	return [
		{
			createdBy: null,
			appliedAt: null,
			appliedBy: null,
			...was,
			id: scenarioId,
			name,
			levers,
			updatedAt: Date.now(),
		},
		...scenarios.filter((s) => s.id !== scenarioId),
	];
};

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
		// A list read since (none was cached to change at once) may not have it. Runs while the
		// change is still pending, so Explore never sees it in neither place.
		onSuccess: (_data, variables) => {
			queryClient.setQueryData(scenariosQuery().queryKey, (s) => s && apply(s, variables));
		},
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

/** A change to try in Explore: a Lever preset (see parseLeverPreset) and a name for its Scenario. */
export type ExploreTry = { name: string; preset: string };

/**
 * "Try in Explore" from Insights and Ask: saves a new Scenario with the preset's Lever and opens
 * it, as Affordability's "Explore as a Scenario" does. The Plan doesn't change unless the Scenario
 * is applied. `month` is the Household's current month, where the Lever starts.
 */
export function useTryInExplore(month: MonthKey) {
	const save = useSaveScenario();
	const navigate = useNavigate();
	return ({ name, preset }: ExploreTry) => {
		const scenarioChange = parseLeverPreset(preset, month);
		if (!scenarioChange) return;
		const scenarioId = ulid();
		save.mutate({ scenarioId, name: name.trim().slice(0, 40), levers: [scenarioChange] });
		// Opens this Scenario, even before its save lands.
		void navigate({ to: "/explore", search: { scenario: scenarioId } });
	};
}

/**
 * Makes a Scenario's Levers the real Plan from this month on, saving the Scenario as applied.
 * The server writes them all at once; every month, the Goals and the Scenarios are refetched
 * after, since the change carries forward.
 */
export function useApplyScenario() {
	const queryClient = useQueryClient();
	const apply = useMutation({
		// Shares the key of every change to a month, so their refetches don't undo one another.
		mutationKey: monthChangeKey,
		mutationFn: (data: SaveScenarioVariables) => applyScenario({ data }),
		// It's saved as it's applied.
		onMutate: (variables) => editScenarios(queryClient, (s) => withScenario(s, variables)),
		onError: (_error, variables, context) => {
			if (context?.previous) queryClient.setQueryData(scenariosQuery().queryKey, context.previous);
			toast(`Couldn’t apply “${variables.name}”. The Plan hasn’t changed.`, {
				tone: "error",
				action: { label: "Retry", onClick: () => apply.mutate(variables) },
			});
		},
		onSuccess: (_data, { name }) => toast(`“${name}” is now the Plan`),
		onSettled: () =>
			Promise.all([
				queryClient.invalidateQueries({ queryKey: goalsQuery().queryKey }),
				queryClient.invalidateQueries({ queryKey: scenariosQuery().queryKey }),
				queryClient.isMutating({ mutationKey: monthChangeKey }) === 1
					? queryClient.invalidateQueries({ queryKey: monthsKey })
					: undefined,
			]),
	});
	return apply;
}
