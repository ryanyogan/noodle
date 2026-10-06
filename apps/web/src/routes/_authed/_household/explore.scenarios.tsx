import { changeName, type Projection } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent } from "@noodle/ui/components/card";
import { Checkbox } from "@noodle/ui/components/checkbox";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List, ListRow } from "@noodle/ui/components/list";
import { MetaParts } from "@noodle/ui/components/meta-parts";
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
import { createFileRoute, Link, linkOptions, useNavigate, useParams } from "@tanstack/react-router";
import { Layers } from "lucide-react";
import { lazy, Suspense } from "react";
import { z } from "zod";
import { ListBesideDetail, masterDetailItem } from "../../../components/master-detail";
import {
	HorizonToggle,
	type HorizonYears,
	type Projected,
	useKeptScenarios,
	yearsParam,
	yearsSearch,
} from "../../../components/scenario-view";
import { SectionPending } from "../../../components/section-layout";
import { formatWholeMoney, shortDayAt, shortMonth } from "../../../format";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../../../queries";

// The Household's saved Scenarios, each with its headline outcome, who made it, when it last
// changed and whether it was applied. Beside the list is Compare: up to three side by side against
// the Plan. From lg a picked Scenario (this route's child) opens in a panel from the window's right
// edge, over Compare, and the list and Compare stay as they are (issue 107); on a phone it is a
// page with Back.
// Like Explore, it renders only in the browser (data-only SSR), and its charts load lazily.

/** "Oct 4", never broken between the month and the day when a row's meta wraps. */
const day = (at: number) => shortDayAt(at).replace(" ", "\u00A0");

const CompareChart = lazy(() =>
	import("../../../components/scenario-outcomes").then((m) => ({ default: m.CompareChart })),
);

/** The most Scenarios compared at once. */
const MAX_COMPARED = 3;

export const Route = createFileRoute("/_authed/_household/explore/scenarios")({
	ssr: "data-only",
	pendingComponent: SectionPending,
	// `compare`: the Scenarios compared, as comma-separated IDs. `years`: how far ahead (2 unset).
	validateSearch: z.object({
		compare: z.string().max(200).optional().catch(undefined),
		years: yearsSearch,
	}),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(planAheadQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(scenariosQuery()),
		]),
	component: ScenariosPage,
});

function ScenariosPage() {
	const { parentId } = Route.useRouteContext();
	const search = Route.useSearch();
	const { plan, projected, subjects, goals, horizon } = useKeptScenarios(parentId, search.years);
	const navigate = useNavigate();
	// The Scenario open in the panel.
	const picked = useParams({ strict: false, select: (params) => params.id });

	const compared = (search.compare ?? "")
		.split(",")
		.filter((id) => projected.some((p) => p.scenario.id === id))
		.slice(0, MAX_COMPARED);
	// Ticking keeps whatever is open in the panel; "Compare" below shows the comparison.
	const toggle = (id: string) => {
		const next = compared.includes(id) ? compared.filter((c) => c !== id) : [...compared, id];
		go({ compare: next.length > 0 ? next.join(",") : undefined, years: search.years });
	};
	// Stays on whatever is open in the panel.
	const go = (next: { compare?: string; years?: HorizonYears }) => {
		const stay = { search: next, replace: true, resetScroll: false } as const;
		if (picked) {
			void navigate({ to: "/explore/scenarios/$id", params: { id: picked }, ...stay });
		} else void navigate({ to: "/explore/scenarios", ...stay });
	};

	if (projected.length === 0) {
		return (
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
		);
	}
	return (
		<ListBesideDetail
			picked={picked !== undefined}
			noun="Scenario"
			listLabel="Scenarios"
			// What is compared stays in the address while a Scenario opens and closes.
			panel={{
				size: "wide",
				close: linkOptions({ to: "/explore/scenarios", search: true }),
				itemKey: picked,
			}}
			hint="Tick Scenarios in the list to compare them here."
			asideFills
			aside={
				compared.length > 0 ? (
					// With a Scenario open beside the list, Compare keeps to the room left of the panel
					// (the panel covers a rail's width and the gap), so its figures stay in view (issue 73).
					// Explore is a wide page and the panel is measured from the usual cap: past 1920 the
					// panel reaches further in by half the difference between the two caps.
					<div
						className={cn(
							"grid min-w-0 gap-4",
							picked !== undefined &&
								"xl:me-[calc(var(--rail-width)+var(--layout-gap)+min((var(--shell-max-wide)-var(--shell-max))/2,max(0px,(100vw-var(--sidebar-width)-var(--shell-max))/2)))]",
						)}
					>
						<Compare
							plan={plan}
							compared={compared.flatMap((id) => projected.find((p) => p.scenario.id === id) ?? [])}
							goals={goals}
							horizonLabel={horizon.label}
						/>
					</div>
				) : undefined
			}
			list={
				<Section aria-labelledby="saved">
					<SectionHeader id="saved" title="Saved" count={projected.length} />
					<HorizonToggle
						years={horizon.years}
						onYears={(years) => go({ compare: search.compare, years: yearsParam(years) })}
					/>
					<p className="-mt-1 text-[13px] text-muted-foreground">
						Each against the Plan over {horizon.label}. Tick up to {MAX_COMPARED} to compare them
						side by side with the Plan.
					</p>
					{compared.length > 0 ? (
						<div>
							<Button asChild size="sm" variant="outline">
								<Link to="/explore/scenarios" search hash="compare" resetScroll={false}>
									Compare {compared.length} selected
								</Link>
							</Button>
						</div>
					) : null}
					<Card className="p-0">
						<List>
							{projected.map(({ scenario, projection, freed }) => {
								const ticked = compared.includes(scenario.id);
								const names = scenario.levers
									.filter((l) => !l.muted)
									.map((l) => changeName(l, subjects, scenario.levers));
								return (
									<ListRow
										key={scenario.id}
										leading={
											<Checkbox
												aria-label={`Compare “${scenario.name}”`}
												checked={ticked}
												disabled={!ticked && compared.length >= MAX_COMPARED}
												onCheckedChange={() => toggle(scenario.id)}
											/>
										}
										title={
											<Link
												to="/explore/scenarios/$id"
												params={{ id: scenario.id }}
												search
												{...masterDetailItem}
												className="underline decoration-border-strong underline-offset-4 hover:decoration-current"
											>
												{scenario.name}
											</Link>
										}
										badge={scenario.appliedAt ? <Badge variant="brand">Applied</Badge> : null}
										meta={
											<MetaParts
												parts={[
													scenario.createdBy ? `Made by ${scenario.createdBy}` : null,
													`Changed ${day(scenario.updatedAt)}`,
													scenario.appliedAt
														? `Applied ${day(scenario.appliedAt)}${scenario.appliedBy ? ` by ${scenario.appliedBy}` : ""}`
														: null,
												]}
											/>
										}
										trailing={
											<>
												{/* Not coloured when it's less: the picked row's shade is too close to it. */}
												<span className="text-sm font-semibold tabular-nums">
													{freed > 0 ? "+" : ""}
													{formatWholeMoney(freed)}
												</span>
												<span className="text-xs text-muted-foreground">Free to Spend</span>
											</>
										}
										below={
											<p className="text-[13px] text-muted-foreground">
												{names.length > 0 ? names.join(" · ") : "No changes"}
												{projection.lowest
													? ` · Projected balance at its lowest ${formatWholeMoney(projection.lowest.amount)} in ${shortMonth(projection.lowest.month)}`
													: null}
											</p>
										}
									/>
								);
							})}
						</List>
					</Card>
				</Section>
			}
		/>
	);
}

/** The Scenarios picked, side by side against the Plan: key numbers, then charts. */
function Compare({
	plan,
	compared,
	goals,
	horizonLabel,
}: {
	plan: Projection;
	compared: Projected[];
	goals: readonly { id: string; name: string }[];
	horizonLabel: string;
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
		/** A few quiet words after the value ("in Mar 2027"). */
		note?: (p: Projection) => string | null;
		over?: (p: Projection) => boolean;
	}[] = [
		{
			label: `Free to Spend, ${horizonLabel}`,
			value: (p) => formatWholeMoney(p.freeToSpend),
			over: (p) => p.freeToSpend < 0,
		},
		{
			label: "Lowest projected balance",
			value: (p) => (p.lowest ? formatWholeMoney(p.lowest.amount) : "—"),
			note: (p) => (p.lowest ? `in ${shortMonth(p.lowest.month)}` : null),
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
		// Its own container: the table needs a column per Scenario, so in a narrow place (a phone, or
		// beside an open Scenario) each number is a short list instead, and the charts stack.
		<Section aria-labelledby="compare" className="@container/compare min-w-0">
			<SectionHeader id="compare" title="Compare" />
			<Card className="min-w-0">
				<CardContent>
					{/* A phone has no room for a column per Scenario: each number is a short list instead,
					    the Plan first, a name on the left (wrapping, never cut) and its value on the right. */}
					<div className="@md/compare:hidden">
						{rows.map((row) => (
							<div key={row.label} className="border-t py-3 first:border-0 first:pt-0 last:pb-0">
								<h3 className="text-[13px] text-muted-foreground">{row.label}</h3>
								<dl className="mt-1.5 grid gap-1.5 text-sm">
									{columns.map((c) => {
										const note = row.note?.(c.projection);
										return (
											<div key={c.key} className="flex items-baseline justify-between gap-4">
												<dt
													className={cn(
														"min-w-0 [overflow-wrap:anywhere]",
														c.key === "plan" && "text-muted-foreground",
													)}
												>
													{c.name}
												</dt>
												<dd
													className={cn(
														"shrink-0 text-end tabular-nums",
														c.key === "plan" ? "text-muted-foreground" : "font-medium",
														row.over?.(c.projection) && "text-over",
													)}
												>
													{row.value(c.projection)}
													{note ? (
														<span className="font-normal text-muted-foreground text-xs">
															{" "}
															{note}
														</span>
													) : null}
												</dd>
											</div>
										);
									})}
								</dl>
							</div>
						))}
					</div>
					<div className="@max-md/compare:hidden">
						<Table className="text-sm">
							<TableCaption className="sr-only">
								Key numbers, the Plan against each Scenario
							</TableCaption>
							<TableHeader>
								<TableRow className="border-0">
									<TableHead scope="col" className="min-w-24 sm:min-w-40">
										<span className="sr-only">Number</span>
									</TableHead>
									{columns.map((c) => (
										<TableHead
											key={c.key}
											scope="col"
											numeric
											className="max-w-32 whitespace-normal"
										>
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
											className="min-w-24 py-2 sm:min-w-40 pe-3 text-start align-top font-normal text-muted-foreground"
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
												{row.note?.(c.projection) ? (
													<span className="block font-normal text-muted-foreground text-xs">
														{row.note(c.projection)}
													</span>
												) : null}
											</TableCell>
										))}
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				</CardContent>
			</Card>
			<div className="grid gap-4 @3xl/compare:grid-cols-2 @3xl/compare:items-start">
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
