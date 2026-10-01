import {
	changeName,
	moneyFreed,
	type Projection,
	planAhead,
	planForMonth,
	project,
	type ScenarioChangeSubjects,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@noodle/ui/components/table";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ChevronLeft, Layers } from "lucide-react";
import { lazy, Suspense, useMemo } from "react";
import { z } from "zod";
import { formatMoney, shortDayAt, shortMonth } from "../../../format";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../../../queries";
import { projectionGoals, type ScenarioRecord } from "../../../scenarios";

// The Household's saved Scenarios, each with its headline outcome, who made it, when it last
// changed and whether it was applied; and up to three compared side by side against the Plan.
// Like Explore, it renders only in the browser (data-only SSR), and its charts load lazily.

const CompareChart = lazy(() =>
	import("../../../components/scenario-outcomes").then((m) => ({ default: m.CompareChart })),
);

/** The most Scenarios compared at once. */
const MAX_COMPARED = 3;

/** How far the headlines and Compare look ahead. */
const HORIZON = 24;
const HORIZON_LABEL = "2 years";

export const Route = createFileRoute("/_authed/_household/explore_/scenarios")({
	ssr: "data-only",
	// `compare`: the Scenarios compared, as comma-separated IDs.
	validateSearch: z.object({ compare: z.string().max(200).optional().catch(undefined) }),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(planAheadQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(scenariosQuery()),
		]),
	component: ScenariosPage,
});

type Projected = { scenario: ScenarioRecord; projection: Projection; freed: number };

function ScenariosPage() {
	const { parentId } = Route.useRouteContext();
	const { month, records } = useSuspenseQuery(planAheadQuery()).data;
	const goalsData = useSuspenseQuery(goalsQuery()).data;
	const scenarios = useSuspenseQuery(scenariosQuery()).data;
	const goals = useMemo(() => projectionGoals(goalsData), [goalsData]);
	const navigate = useNavigate({ from: Route.fullPath });
	const search = Route.useSearch();

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
	// Changes are named as the Parent reading may see them: the other Parent's Personal Allowance
	// reads only as "Personal Allowance" (ADR-0003).
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

	const compared = (search.compare ?? "")
		.split(",")
		.filter((id) => projected.some((p) => p.scenario.id === id))
		.slice(0, MAX_COMPARED);
	const toggle = (id: string) => {
		const next = compared.includes(id) ? compared.filter((c) => c !== id) : [...compared, id];
		navigate({
			search: { compare: next.length > 0 ? next.join(",") : undefined },
			replace: true,
			resetScroll: false,
		});
	};

	return (
		<>
			<PageHeader
				title="Scenarios"
				leading={
					<Button variant="ghost" size="icon" asChild>
						<Link to="/explore" aria-label="Back to Explore">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
			/>
			{projected.length === 0 ? (
				<EmptyState
					icon={<Layers />}
					title="No saved Scenarios yet"
					description="Save a Scenario in Explore to keep it here and compare it with others."
					action={
						<Button asChild size="sm">
							<Link to="/explore">Explore</Link>
						</Button>
					}
				/>
			) : (
				<div className="grid gap-8">
					<Section aria-labelledby="saved">
						<SectionHeader id="saved" title="Saved" count={projected.length} />
						<p className="-mt-1 text-[13px] text-muted-foreground">
							Each against the Plan over {HORIZON_LABEL}. Pick up to {MAX_COMPARED} to compare.
						</p>
						<List>
							{projected.map(({ scenario, projection, freed }) => {
								const picked = compared.includes(scenario.id);
								const names = scenario.levers
									.filter((l) => !l.muted)
									.map((l) => changeName(l, subjects, scenario.levers));
								return (
									<ListRow
										key={scenario.id}
										leading={
											<input
												type="checkbox"
												className="size-4 accent-(--brand)"
												aria-label={`Compare “${scenario.name}”`}
												checked={picked}
												disabled={!picked && compared.length >= MAX_COMPARED}
												onChange={() => toggle(scenario.id)}
											/>
										}
										title={
											<Link
												to="/explore"
												search={{ scenario: scenario.id }}
												className="hover:underline"
											>
												{scenario.name}
											</Link>
										}
										badge={scenario.appliedAt ? <Badge variant="brand">Applied</Badge> : null}
										meta={
											<>
												{scenario.createdBy ? <span>Made by {scenario.createdBy}</span> : null}
												<span>Changed {shortDayAt(scenario.updatedAt)}</span>
												{scenario.appliedAt ? (
													<span>
														Applied {shortDayAt(scenario.appliedAt)}
														{scenario.appliedBy ? ` by ${scenario.appliedBy}` : ""}
													</span>
												) : null}
											</>
										}
										trailing={
											<>
												<span
													className={cn(
														"text-sm font-semibold tabular-nums",
														freed < 0 && "text-over",
													)}
												>
													{freed > 0 ? "+" : ""}
													{formatMoney(freed)}
												</span>
												<span className="text-xs text-muted-foreground">Free to Spend</span>
											</>
										}
										below={
											<p className="text-[13px] text-muted-foreground">
												{names.length > 0 ? names.join(" · ") : "No changes"}
												{projection.lowest
													? ` · Projected balance at its lowest ${formatMoney(projection.lowest.amount)} in ${shortMonth(projection.lowest.month)}`
													: null}
											</p>
										}
									/>
								);
							})}
						</List>
					</Section>
					{compared.length > 0 ? (
						<Compare
							plan={plan}
							compared={compared.flatMap((id) => projected.find((p) => p.scenario.id === id) ?? [])}
							goals={goals}
						/>
					) : null}
				</div>
			)}
		</>
	);
}

/** The Scenarios picked, side by side against the Plan: key numbers, then charts. */
function Compare({
	plan,
	compared,
	goals,
}: {
	plan: Projection;
	compared: Projected[];
	goals: readonly { id: string; name: string }[];
}) {
	const columns = [
		{ key: "plan", name: "Plan", projection: plan },
		...compared.map((p) => ({
			key: p.scenario.id,
			name: p.scenario.name,
			projection: p.projection,
		})),
	];
	const reached = (p: Projection, goalId: string) => {
		const goal = p.goals.find((g) => g.goalId === goalId);
		if (!goal) return "—";
		if (goal.reachedIn) return shortMonth(goal.reachedIn);
		return goal.targetDate === null ? "Not dated" : "Later";
	};
	const rows: {
		label: string;
		value: (p: Projection) => string;
		over?: (p: Projection) => boolean;
	}[] = [
		{
			label: `Free to Spend, ${HORIZON_LABEL}`,
			value: (p) => formatMoney(p.freeToSpend),
			over: (p) => p.freeToSpend < 0,
		},
		{
			label: "Lowest projected balance",
			value: (p) =>
				p.lowest ? `${formatMoney(p.lowest.amount)} in ${shortMonth(p.lowest.month)}` : "—",
			over: (p) => (p.lowest?.amount ?? 0) < 0,
		},
		...goals.map((g) => ({
			label: `${g.name} reached`,
			value: (p: Projection) => reached(p, g.id),
		})),
	];
	const months = plan.months.map((m) => m.month);
	const series = (value: (p: Projection) => number[]) =>
		compared.map((p) => ({
			id: p.scenario.id,
			name: p.scenario.name,
			values: value(p.projection),
		}));

	return (
		<Section aria-labelledby="compare">
			<SectionHeader id="compare" title="Compare" />
			<Card>
				<CardContent>
					<Table className="text-sm">
						<TableCaption className="sr-only">
							Key numbers, the Plan against each Scenario
						</TableCaption>
						<TableHeader>
							<TableRow className="border-0">
								<TableHead scope="col">
									<span className="sr-only">Number</span>
								</TableHead>
								{columns.map((c) => (
									<TableHead key={c.key} scope="col" numeric className="max-w-32 whitespace-normal">
										{c.name}
									</TableHead>
								))}
							</TableRow>
						</TableHeader>
						<TableBody>
							{rows.map((row) => (
								<TableRow key={row.label} className="border-0 border-t">
									<th
										scope="row"
										className="py-2 pe-3 text-start font-normal text-muted-foreground"
									>
										{row.label}
									</th>
									{columns.map((c) => (
										<TableCell
											key={c.key}
											numeric
											className={cn(
												c.key === "plan" ? "text-muted-foreground" : "font-medium",
												row.over?.(c.projection) && "text-over",
											)}
										>
											{row.value(c.projection)}
										</TableCell>
									))}
								</TableRow>
							))}
						</TableBody>
					</Table>
				</CardContent>
			</Card>
			<div className="grid gap-4 lg:grid-cols-2 lg:items-start">
				<Suspense
					fallback={
						<>
							<Skeleton className="h-[340px] w-full rounded-xl" />
							<Skeleton className="h-[340px] w-full rounded-xl" />
						</>
					}
				>
					<CompareChart
						title="Free to Spend each month"
						description="Each Scenario against the Plan"
						months={months}
						plan={plan.months.map((m) => m.freeToSpend)}
						scenarios={series((p) => p.months.map((m) => m.freeToSpend))}
					/>
					<CompareChart
						title="Projected balance"
						description="What’s left month by month if you spend what’s planned, starting from $0 today"
						months={months}
						plan={plan.months.map((m) => m.cushion)}
						scenarios={series((p) => p.months.map((m) => m.cushion))}
					/>
				</Suspense>
			</div>
		</Section>
	);
}
