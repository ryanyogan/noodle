import {
	changeImpacts,
	describeChange,
	MAX_PROJECTION_MONTHS,
	moneyFreed,
	type Projection,
	planAhead,
	planForMonth,
	project,
	type ScenarioChangeImpact,
	type ScenarioChangeSubjects,
} from "@noodle/domain";
import { DetailColumns } from "@noodle/ui/components/layout";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { Stat, StatGrid } from "@noodle/ui/components/stat";
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { useSuspenseQuery } from "@tanstack/react-query";
import { lazy, Suspense, useMemo } from "react";
import { z } from "zod";
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

/**
 * How far Explore and the kept Scenarios look ahead. It's in the link as `years` (2 when unset),
 * so a link reopens the same horizon (#51).
 */
export const HORIZONS = [
	{ years: 1, months: 12, label: "1 year" },
	{ years: 2, months: 24, label: "2 years" },
	{ years: 3, months: 36, label: "3 years" },
	{ years: 5, months: MAX_PROJECTION_MONTHS, label: "5 years" },
] as const;
export type Horizon = (typeof HORIZONS)[number];
export type HorizonYears = Horizon["years"];
export const DEFAULT_YEARS: HorizonYears = 2;

/** `years` in a link: one of HORIZONS', else unset (2 years), so a bad or old link still opens. */
export const yearsSearch = z
	.union([z.literal(1), z.literal(2), z.literal(3), z.literal(5)])
	.optional()
	.catch(undefined);

export const horizonOf = (years: HorizonYears | undefined): Horizon =>
	HORIZONS.find((h) => h.years === (years ?? DEFAULT_YEARS)) ?? HORIZONS[1];

/** `years` for a link: unset for the default, so links stay short. */
export const yearsParam = (years: HorizonYears) => (years === DEFAULT_YEARS ? undefined : years);

/** The 1, 2, 3 or 5 years switch. */
export function HorizonToggle({
	years,
	onYears,
}: {
	years: HorizonYears;
	onYears: (years: HorizonYears) => void;
}) {
	return (
		<ToggleGroup
			type="single"
			aria-label="Look ahead"
			value={String(years)}
			onValueChange={(value) => {
				const picked = HORIZONS.find((h) => String(h.years) === value);
				if (picked) onYears(picked.years);
			}}
			className="flex-wrap"
		>
			{HORIZONS.map((h) => (
				<ToggleGroupItem key={h.years} value={String(h.years)} variant="segmented">
					{h.label}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

export type Projected = { scenario: ScenarioRecord; projection: Projection; freed: number };

/**
 * The Household's kept Scenarios, each projected against the Plan over `years` (2 when unset).
 * Changes are named
 * as the Parent reading may see them: the other Parent's Personal Allowance reads only as
 * "Personal Allowance" (ADR-0003).
 */
export function useKeptScenarios(parentId: string, years?: HorizonYears) {
	const horizon = horizonOf(years);
	const { month, records } = useSuspenseQuery(planAheadQuery()).data;
	const goalsData = useSuspenseQuery(goalsQuery()).data;
	const scenarios = useSuspenseQuery(scenariosQuery()).data;
	const goals = useMemo(() => projectionGoals(goalsData), [goalsData]);
	const ahead = useMemo(
		() => planAhead(records, goals, month, horizon.months),
		[records, goals, month, horizon.months],
	);
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
	return { ahead, plan, projected, subjects, goals, horizon };
}

type Kept = ReturnType<typeof useKeptScenarios>;

/** One kept Scenario: its headline numbers, its outcome charts against the Plan, and its Changes. */
export function ScenarioView({
	projected: { scenario, projection, freed },
	kept: { ahead, plan, subjects, goals, horizon },
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
		<DetailColumns className="gap-8">
			<StatGrid
				layout="cards"
				className="col-span-full @md:grid-cols-2"
				aria-label="Against the Plan"
			>
				<Stat
					label={`Free to Spend, ${horizon.label}`}
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
			<p className="col-span-full -mt-4 px-1 text-[13px] text-muted-foreground">
				{[
					`Against the Plan over ${horizon.label}`,
					scenario.createdBy ? `Made by ${scenario.createdBy}` : null,
					`Changed ${shortDayAt(scenario.updatedAt)}`,
					scenario.appliedAt
						? `Applied ${shortDayAt(scenario.appliedAt)}${scenario.appliedBy ? ` by ${scenario.appliedBy}` : ""}`
						: null,
				]
					.filter(Boolean)
					.join(" · ")}
			</p>
			{/* The outcome first, then the Changes that make it; side by side in a wide pane (#73). */}
			<Section aria-labelledby="scenario-outcome" className="min-w-0">
				<SectionHeader id="scenario-outcome" title="Outcome" />
				<Suspense fallback={<Skeleton className="h-72 w-full rounded-xl" />}>
					<OutcomeTabs outcome={outcome} goalNames={goalNames} />
				</Suspense>
			</Section>
			<div className="min-w-0">
				<ScenarioChanges
					impacts={impacts}
					levers={levers}
					subjects={subjects}
					goalNames={goalNames}
					horizonLabel={horizon.label}
				/>
			</div>
		</DetailColumns>
	);
}
