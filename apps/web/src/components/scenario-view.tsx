import {
	changeImpacts,
	describeChange,
	moneyFreed,
	type Projection,
	planAhead,
	planForMonth,
	project,
	type ScenarioChangeImpact,
	type ScenarioChangeSubjects,
} from "@noodle/domain";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Stat, StatGrid } from "@noodle/ui/components/stat";
import { useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo } from "react";
import { shortDayAt, shortMonth } from "../format";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../queries";
import { changeTarget, projectionGoals, type ScenarioRecord } from "../scenarios";
import { ScenarioChanges } from "./scenario-changes";
import type { Outcome } from "./scenario-outcomes";

// A kept Scenario, read rather than edited (#67): its Changes in words with what each does on its
// own, and its outcome against the Plan. Changing it is Explore's job ("Open in Explore").

const OutcomeTabs = lazy(() =>
	import("./scenario-outcomes").then((m) => ({ default: m.OutcomeTabs })),
);

/** How far the kept Scenarios' headlines, pages and Compare look ahead. */
export const HORIZON = 24;
export const HORIZON_LABEL = "2 years";

export type Projected = { scenario: ScenarioRecord; projection: Projection; freed: number };

/**
 * The Household's kept Scenarios, each projected against the Plan over HORIZON. Changes are named
 * as the Parent reading may see them: the other Parent's Personal Allowance reads only as
 * "Personal Allowance" (ADR-0003).
 */
export function useKeptScenarios(parentId: string) {
	const { month, records } = useSuspenseQuery(planAheadQuery()).data;
	const goalsData = useSuspenseQuery(goalsQuery()).data;
	const scenarios = useSuspenseQuery(scenariosQuery()).data;
	const goals = useMemo(() => projectionGoals(goalsData), [goalsData]);
	const ahead = useMemo(() => planAhead(records, goals, month, HORIZON), [records, goals, month]);
	const plan = useMemo(() => project(ahead), [ahead]);
	const projected = useMemo(
		() =>
			scenarios.map((scenario): Projected => {
				const projection = project(ahead, scenario.levers);
				return { scenario, projection, freed: moneyFreed(plan, projection).at(-1) ?? 0 };
			}),
		[scenarios, ahead, plan],
	);
	const subjects = useMemo<ScenarioChangeSubjects>(() => {
		const now = planForMonth(records, month);
		return {
			month,
			baseline: now.baseline,
			buckets: now.buckets,
			commitments: now.commitments,
			goals,
			viewer: parentId,
		};
	}, [records, month, goals, parentId]);
	return { ahead, plan, projected, subjects, goals };
}

type Kept = ReturnType<typeof useKeptScenarios>;

/** One kept Scenario: its headline numbers, its Changes, and its outcome charts against the Plan. */
export function ScenarioView({
	projected: { scenario, projection, freed },
	kept: { ahead, plan, subjects, goals },
}: {
	projected: Projected;
	kept: Kept;
}) {
	const { levers } = scenario;
	const outcome = useMemo<Outcome>(
		() => ({
			plan,
			scenario: projection,
			levers,
			impacts: changeImpacts(ahead, levers),
			describe: (index) => {
				const change = levers[index];
				return change ? describeChange(change, subjects, levers).text : "";
			},
		}),
		[ahead, plan, projection, levers, subjects],
	);
	const impacts = useMemo(
		() =>
			new Map(
				outcome.levers.map((change, i) => [
					changeTarget(change),
					outcome.impacts[i] as ScenarioChangeImpact,
				]),
			),
		[outcome],
	);
	const goalNames = useMemo(
		() =>
			new Map([
				...goals.map((g) => [g.id, g.name] as const),
				...levers.flatMap((l) => (l.kind === "add-goal" ? [[l.goalId, l.name] as const] : [])),
			]),
		[goals, levers],
	);
	return (
		<div className="grid gap-8">
			<StatGrid layout="cards" className="@md:grid-cols-2" aria-label="Against the Plan">
				<Stat
					label={`Free to Spend, ${HORIZON_LABEL}`}
					value={<Money cents={freed} whole signed />}
					tone={freed < 0 ? "over" : undefined}
				/>
				<Stat
					label="Lowest projected balance"
					value={
						projection.lowest ? (
							<>
								<Money cents={projection.lowest.amount} whole />
								<span className="text-sm font-normal text-muted-foreground">
									{" "}
									in {shortMonth(projection.lowest.month)}
								</span>
							</>
						) : (
							"—"
						)
					}
				/>
			</StatGrid>
			<p className="-mt-4 px-1 text-[13px] text-muted-foreground">
				{[
					scenario.createdBy ? `Made by ${scenario.createdBy}` : null,
					`Changed ${shortDayAt(scenario.updatedAt)}`,
					scenario.appliedAt
						? `Applied ${shortDayAt(scenario.appliedAt)}${scenario.appliedBy ? ` by ${scenario.appliedBy}` : ""}`
						: null,
				]
					.filter(Boolean)
					.join(" · ")}
			</p>
			<ScenarioChanges
				impacts={impacts}
				levers={levers}
				subjects={subjects}
				goalNames={goalNames}
				horizonLabel={HORIZON_LABEL}
			/>
			<Section aria-labelledby="scenario-outcome">
				<SectionHeader id="scenario-outcome" title="Outcome" />
				<Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
					<OutcomeTabs outcome={outcome} goalNames={goalNames} />
				</Suspense>
			</Section>
		</div>
	);
}
