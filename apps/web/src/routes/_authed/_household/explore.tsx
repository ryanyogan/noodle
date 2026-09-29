import {
	activeLevers,
	describeLever,
	type Lever,
	type LeverSubjects,
	MAX_PROJECTION_MONTHS,
	moneyFreed,
	type Projection,
	planAhead,
	planForMonth,
	project,
	whyNotApplicable,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calculator, ChevronLeft } from "lucide-react";
import { lazy, memo, Suspense, useDeferredValue, useId, useMemo, useState } from "react";
import { ulid } from "ulid";
import { z } from "zod";
import { NativeSelect } from "../../../components/native-select";
import { Confirm } from "../../../components/plan-editing";
import { ScenarioChanges } from "../../../components/scenario-changes";
import { ScenarioOutcome, ScenarioOutline } from "../../../components/scenario-outline";
import { formatMoney, shortMonth } from "../../../format";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../../../queries";
import {
	projectionGoals,
	type ScenarioRecord,
	useApplyScenario,
	useDeleteScenario,
	useSaveScenario,
} from "../../../scenarios";

// Explore: Scenarios projected against the Plan. The loader fetches the data on the server;
// the page itself renders only in the browser (data-only SSR), and its chart loads lazily.

const ScenarioChart = lazy(() => import("../../../components/scenario-chart"));

export const Route = createFileRoute("/_authed/_household/explore")({
	ssr: "data-only",
	// `end`: open a new Scenario that ends this Commitment (a Commitment page's "Try ending this").
	validateSearch: z.object({ end: z.string().optional().catch(undefined) }),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(planAheadQuery()),
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(scenariosQuery()),
		]),
	component: ExplorePage,
});

const HORIZONS = [
	{ months: 12, label: "1 year" },
	{ months: 24, label: "2 years" },
	{ months: 36, label: "3 years" },
	{ months: MAX_PROJECTION_MONTHS, label: "5 years" },
] as const;

/** The Scenario being explored; it isn't saved until a Parent saves it. */
type Draft = { id: string; name: string; levers: Lever[] };

const freshDraft = (scenarios: ScenarioRecord[]): Draft => ({
	id: ulid(),
	name: `Scenario ${scenarios.length + 1}`,
	levers: [],
});

const sameLevers = (a: Lever[], b: Lever[]) => JSON.stringify(a) === JSON.stringify(b);

function ExplorePage() {
	const { parentId } = Route.useRouteContext();
	const { month, records } = useSuspenseQuery(planAheadQuery()).data;
	const goalsData = useSuspenseQuery(goalsQuery()).data;
	const scenarios = useSuspenseQuery(scenariosQuery()).data;
	const goals = useMemo(() => projectionGoals(goalsData), [goalsData]);
	const plan = useMemo(() => planForMonth(records, month), [records, month]);

	const [horizon, setHorizon] = useState<number>(24);
	const ahead = useMemo(
		() => planAhead(records, goals, month, horizon),
		[records, goals, month, horizon],
	);

	// A new Scenario ending the Commitment asked for, else the most recently changed Scenario, or a
	// new one from the Plan as it stands.
	const { end } = Route.useSearch();
	const [draft, setDraft] = useState<Draft>(() => {
		const ending = plan.commitments.find((c) => c.id === end);
		if (ending) {
			return {
				id: ulid(),
				name: `Without ${ending.name}`.slice(0, 40),
				levers: [{ kind: "end-commitment", commitmentId: ending.id, fromMonth: month }],
			};
		}
		const [latest] = scenarios;
		return latest
			? { id: latest.id, name: latest.name, levers: latest.levers }
			: freshDraft(scenarios);
	});
	const saved = scenarios.find((s) => s.id === draft.id);
	const dirty =
		!saved || saved.name !== draft.name.trim() || !sameLevers(saved.levers, draft.levers);
	// Sliders update the Levers at once; the projection and chart follow in a deferred render.
	const levers = useDeferredValue(draft.levers);
	const onLeversChange = useMemo(
		() => (change: (levers: Lever[]) => Lever[]) =>
			setDraft((d) => ({ ...d, levers: change(d.levers) })),
		[],
	);

	const horizonId = useId();
	const horizonLabel = HORIZONS.find((h) => h.months === horizon)?.label ?? "";
	// Recomputed only when the deferred Levers (or the horizon) change.
	const planProjection = useMemo(() => project(ahead), [ahead]);
	const scenarioProjection = useMemo(() => project(ahead, levers), [ahead, levers]);

	// What Levers change, as the Plan has them now: "Your changes" and Apply describe Levers by it.
	const subjects = useMemo<LeverSubjects>(
		() => ({
			month,
			baseline: plan.baseline,
			buckets: plan.buckets,
			commitments: plan.commitments,
			goals,
		}),
		[month, plan, goals],
	);
	const goalNames = useMemo(
		() =>
			new Map([
				...goals.map((g) => [g.id, g.name] as const),
				...draft.levers.flatMap((l) =>
					l.kind === "add-goal" ? [[l.goalId, l.name] as const] : [],
				),
			]),
		[goals, draft.levers],
	);
	const accounts = goalsData.accounts;

	return (
		<>
			<PageHeader
				title="Explore"
				leading={
					<Button variant="ghost" size="icon" asChild className="lg:hidden">
						<Link to="/goals" aria-label="Back to Goals">
							<ChevronLeft className="size-5" />
						</Link>
					</Button>
				}
				actions={
					<Button variant="outline" size="sm" asChild>
						<Link to="/explore/afford">
							<Calculator />
							Can we afford it?
						</Link>
					</Button>
				}
			/>
			<div className="grid gap-8">
				<ScenarioBar
					draft={draft}
					scenarios={scenarios}
					saved={saved !== undefined}
					dirty={dirty}
					subjects={subjects}
					onDraft={setDraft}
				/>
				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:items-start">
					<div className="grid gap-4 lg:sticky lg:top-6">
						<fieldset className="flex flex-wrap items-center gap-1">
							<legend className="sr-only">Look ahead</legend>
							{HORIZONS.map((h) => (
								<label
									key={h.months}
									className={cn(
										"cursor-pointer rounded-lg px-2.5 py-1 text-[13px] font-medium text-muted-foreground",
										"has-checked:bg-card has-checked:text-foreground has-checked:shadow-card has-checked:ring-1 has-checked:ring-border",
										"has-focus-visible:outline-2 has-focus-visible:outline-ring",
									)}
								>
									<input
										type="radio"
										name={horizonId}
										className="sr-only"
										checked={horizon === h.months}
										onChange={() => setHorizon(h.months)}
									/>
									{h.label}
								</label>
							))}
						</fieldset>
						<Results
							plan={planProjection}
							scenario={scenarioProjection}
							goals={goals}
							horizonLabel={horizonLabel}
						/>
					</div>
					<div className="grid gap-3">
						<Freed
							plan={planProjection}
							scenario={scenarioProjection}
							horizonLabel={horizonLabel}
							className="sticky top-[env(safe-area-inset-top)] z-10 -mx-(--gutter) bg-background/85 px-(--gutter) py-2 text-lg backdrop-blur-xl lg:hidden"
						/>
						<ScenarioChanges
							ahead={ahead}
							levers={draft.levers}
							subjects={subjects}
							goalNames={goalNames}
							horizonLabel={horizonLabel}
							onChange={onLeversChange}
						/>
						<ScenarioOutcome
							value={
								<Freed
									plan={planProjection}
									scenario={scenarioProjection}
									horizonLabel={horizonLabel}
									className="text-base"
								/>
							}
						>
							<ScenarioOutline
								month={month}
								plan={plan}
								goals={goals}
								accounts={accounts}
								levers={draft.levers}
								parentId={parentId}
								onChange={onLeversChange}
							/>
						</ScenarioOutcome>
					</div>
				</div>
			</div>
		</>
	);
}

/** Which Scenario this is, its name, and saving, deleting and applying it. */
function ScenarioBar({
	draft,
	scenarios,
	saved,
	dirty,
	subjects,
	onDraft,
}: {
	draft: Draft;
	scenarios: ScenarioRecord[];
	saved: boolean;
	dirty: boolean;
	subjects: LeverSubjects;
	onDraft: (draft: Draft) => void;
}) {
	const save = useSaveScenario();
	const remove = useDeleteScenario();
	const apply = useApplyScenario();
	const [confirming, setConfirming] = useState<"apply" | "delete" | null>(null);
	const id = useId();
	const name = draft.name.trim();
	const active = activeLevers(draft.levers);
	const muted = draft.levers.length - active.length;
	// What applying writes, in words; and what can't be applied yet, and why.
	const changes = active.flatMap((lever) => {
		const { text, gone } = describeLever(lever, subjects, active);
		return gone ? [] : [text];
	});
	const blocked = [...new Set(active.flatMap((l) => whyNotApplicable(l, subjects.month) ?? []))];

	return (
		<Card>
			<CardContent className="grid gap-3">
				<div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
					<Field label="Scenario" htmlFor={`${id}-scenario`}>
						<NativeSelect
							id={`${id}-scenario`}
							value={saved ? draft.id : "new"}
							onChange={(event) => {
								const value = event.currentTarget.value;
								const scenario = scenarios.find((s) => s.id === value);
								setConfirming(null);
								onDraft(
									scenario
										? { id: scenario.id, name: scenario.name, levers: scenario.levers }
										: freshDraft(scenarios),
								);
							}}
						>
							{saved ? <option value="new">New Scenario from the Plan</option> : null}
							{saved ? null : (
								<option value="new">{draft.name || "New Scenario"} (not saved)</option>
							)}
							{scenarios.map((s) => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</NativeSelect>
					</Field>
					<Field label="Name" htmlFor={`${id}-name`}>
						<Input
							id={`${id}-name`}
							value={draft.name}
							maxLength={40}
							onChange={(event) => onDraft({ ...draft, name: event.currentTarget.value })}
						/>
					</Field>
				</div>
				<p className="text-[13px] text-muted-foreground">
					{draft.levers.length > 0
						? `${draft.levers.length} ${draft.levers.length === 1 ? "change" : "changes"}${muted > 0 ? ` (${muted} muted)` : ""} to the Plan`
						: "The Plan as it stands. Change anything below to see what it does."}
					{dirty && saved ? " · not saved" : null}
				</p>
				{confirming === "apply" ? (
					<div
						role="alertdialog"
						aria-label="Apply to the Plan"
						className="grid gap-3 rounded-xl bg-surface-2 p-3"
					>
						<p className="text-sm">
							Make “{name || "this Scenario"}” the Plan from {shortMonth(subjects.month)} on?{" "}
							{changes.join(" · ")}.
						</p>
						{blocked.length > 0 ? (
							<ul className="grid gap-1 text-[13px] text-over">
								{blocked.map((reason) => (
									<li key={reason}>{reason}</li>
								))}
							</ul>
						) : null}
						<div className="flex justify-end gap-2">
							<Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(null)}>
								Cancel
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={blocked.length > 0}
								onClick={() => {
									setConfirming(null);
									apply.mutate({
										name: name || "Scenario",
										levers: active,
										scenarioId: saved ? draft.id : undefined,
									});
								}}
							>
								Apply to Plan
							</Button>
						</div>
					</div>
				) : confirming === "delete" ? (
					<Confirm
						confirmLabel="Delete Scenario"
						onCancel={() => setConfirming(null)}
						onConfirm={() => {
							setConfirming(null);
							remove.mutate({ scenarioId: draft.id, name: draft.name });
							onDraft(freshDraft(scenarios.filter((s) => s.id !== draft.id)));
						}}
					>
						Delete “{draft.name}”? The Plan doesn’t change.
					</Confirm>
				) : (
					<div className="flex flex-wrap items-center gap-2">
						<Button
							type="button"
							size="sm"
							disabled={!dirty || name === ""}
							onClick={() => {
								save.mutate({ scenarioId: draft.id, name, levers: draft.levers });
								onDraft({ ...draft, name });
							}}
						>
							{saved ? "Save" : "Save Scenario"}
						</Button>
						<Button
							type="button"
							size="sm"
							variant="outline"
							disabled={changes.length === 0 || apply.isPending}
							onClick={() => setConfirming("apply")}
						>
							Apply to Plan
						</Button>
						{draft.levers.length > 0 ? (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								onClick={() => onDraft({ ...draft, levers: [] })}
							>
								Reset<span className="sr-only"> all changes</span>
							</Button>
						) : null}
						{saved ? (
							<Button
								type="button"
								size="sm"
								variant="ghost"
								className="ms-auto"
								onClick={() => setConfirming("delete")}
							>
								Delete
							</Button>
						) : null}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

/**
 * The Scenario against the Plan: what it frees, Free to Spend each month on one chart, the
 * totals, and when each Goal is reached. Memoised, so it re-renders only when the deferred
 * Levers or the horizon change, never in the urgent render of a slider move.
 */
const Results = memo(function Results({
	plan,
	scenario,
	goals,
	horizonLabel,
}: {
	plan: Projection;
	scenario: Projection;
	goals: { id: string; name: string }[];
	horizonLabel: string;
}) {
	const rows = scenario.months.map((m, i) => ({
		month: m.month,
		plan: plan.months[i]?.freeToSpend ?? 0,
		scenario: m.freeToSpend,
	}));

	return (
		<>
			<Card>
				<CardContent className="grid gap-4">
					<div className="grid gap-0.5">
						<h2 className="text-sm font-medium text-muted-foreground">Free to Spend each month</h2>
						<Freed
							plan={plan}
							scenario={scenario}
							horizonLabel={horizonLabel}
							className="text-2xl"
						/>
						<Cushion scenario={scenario} />
					</div>
					<Suspense fallback={<Skeleton className="h-[252px] w-full rounded-xl" />}>
						<ScenarioChart rows={rows} />
					</Suspense>
				</CardContent>
			</Card>
			<Totals plan={plan} scenario={scenario} horizonLabel={horizonLabel} />
			{goals.length > 0 ? <GoalsReached plan={plan} scenario={scenario} goals={goals} /> : null}
			<details className="group text-sm">
				<summary className="cursor-pointer text-[13px] font-medium text-muted-foreground">
					Each month
				</summary>
				<Card className="mt-3">
					<table className="w-full text-[13px] tabular-nums">
						<thead className="text-muted-foreground">
							<tr className="[&>th]:px-(--card-pad) [&>th]:py-2 [&>th]:font-medium">
								<th className="text-start">Month</th>
								<th className="text-end">Plan</th>
								<th className="text-end">Scenario</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((r) => (
								<tr key={r.month} className="border-t [&>td]:px-(--card-pad) [&>td]:py-1.5">
									<td>{shortMonth(r.month)}</td>
									<td className="text-end">{formatMoney(r.plan)}</td>
									<td className="text-end">{formatMoney(r.scenario)}</td>
								</tr>
							))}
						</tbody>
					</table>
				</Card>
			</details>
		</>
	);
});

/** What the Scenario frees (or costs) against the Plan over the months projected. */
const Freed = memo(function Freed({
	plan,
	scenario,
	horizonLabel,
	className,
}: {
	plan: Projection;
	scenario: Projection;
	horizonLabel: string;
	className?: string;
}) {
	const freed = moneyFreed(plan, scenario).at(-1) ?? 0;
	return (
		<p className={cn("font-semibold tracking-[-0.02em]", className)}>
			{freed === 0
				? scenario.oneOffs === plan.oneOffs
					? "Same as the Plan"
					: "Same Free to Spend"
				: freed > 0
					? `Frees ${formatMoney(freed)}`
					: `Costs ${formatMoney(-freed)}`}
			<span className="text-base font-normal text-muted-foreground"> over {horizonLabel}</span>
		</p>
	);
});

/** The Scenario's Cushion at its lowest, and the month it first goes below zero. */
function Cushion({ scenario }: { scenario: Projection }) {
	const { lowest, firstNegative } = scenario;
	if (!lowest) return null;
	return (
		<p className="text-[13px] text-muted-foreground tabular-nums">
			Cushion lowest{" "}
			<span className={cn("font-medium text-foreground", lowest.amount < 0 && "text-over")}>
				{formatMoney(lowest.amount)}
			</span>{" "}
			in {shortMonth(lowest.month)}
			{firstNegative ? (
				<span className="text-over"> · below zero from {shortMonth(firstNegative)}</span>
			) : null}
		</p>
	);
}

function Totals({
	plan,
	scenario,
	horizonLabel,
}: {
	plan: Projection;
	scenario: Projection;
	horizonLabel: string;
}) {
	const count = Math.max(1, plan.months.length);
	const lowest = (p: Projection) => Math.min(...p.months.map((m) => m.freeToSpend));
	const rows = [
		{
			label: `Over ${horizonLabel}`,
			plan: plan.freeToSpend,
			scenario: scenario.freeToSpend,
		},
		{
			label: "Average month",
			// To the dollar: an average's cents are noise.
			plan: Math.round(plan.freeToSpend / count / 100) * 100,
			scenario: Math.round(scenario.freeToSpend / count / 100) * 100,
		},
		{ label: "Lowest month", plan: lowest(plan), scenario: lowest(scenario) },
	];
	return (
		<Card>
			<table className="w-full text-sm tabular-nums">
				<caption className="sr-only">Free to Spend, the Plan against this Scenario</caption>
				<thead className="text-[13px] text-muted-foreground">
					<tr className="[&>th]:px-(--card-pad) [&>th]:pt-3 [&>th]:pb-2 [&>th]:font-medium">
						<th className="text-start">
							<span className="sr-only">Total</span>
						</th>
						<th className="text-end">Plan</th>
						<th className="text-end">Scenario</th>
						<th className="hidden text-end sm:table-cell">Difference</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row) => {
						const difference = row.scenario - row.plan;
						return (
							<tr key={row.label} className="border-t [&>*]:px-(--card-pad) [&>*]:py-2.5">
								<th scope="row" className="text-start font-normal text-muted-foreground">
									{row.label}
								</th>
								<td className={cn("text-end", row.plan < 0 && "text-over")}>
									{formatMoney(row.plan)}
								</td>
								<td className={cn("text-end font-semibold", row.scenario < 0 && "text-over")}>
									{formatMoney(row.scenario)}
								</td>
								<td className="hidden text-end text-muted-foreground sm:table-cell">
									{difference === 0
										? "—"
										: `${difference > 0 ? "+" : ""}${formatMoney(difference)}`}
								</td>
							</tr>
						);
					})}
				</tbody>
			</table>
		</Card>
	);
}

function GoalsReached({
	plan,
	scenario,
	goals,
}: {
	plan: Projection;
	scenario: Projection;
	goals: { id: string; name: string }[];
}) {
	const reached = (p: Projection, goalId: string) => {
		const goal = p.goals.find((g) => g.goalId === goalId);
		if (!goal) return "—";
		if (goal.reachedIn) return shortMonth(goal.reachedIn);
		return goal.targetDate === null ? "Not dated" : "Later";
	};
	const monthly = (p: Projection, goalId: string) =>
		p.goals.find((g) => g.goalId === goalId)?.monthly;
	return (
		<Section aria-labelledby="goals-reached">
			<SectionHeader id="goals-reached" title="Goals reached" />
			<Card>
				<table className="w-full text-sm tabular-nums">
					<thead className="text-[13px] text-muted-foreground">
						<tr className="[&>th]:px-(--card-pad) [&>th]:pt-3 [&>th]:pb-2 [&>th]:font-medium">
							<th className="text-start">Goal</th>
							<th className="text-end">Plan</th>
							<th className="text-end">Scenario</th>
						</tr>
					</thead>
					<tbody>
						{goals.map((goal) => {
							const funding = monthly(scenario, goal.id);
							return (
								<tr key={goal.id} className="border-t [&>td]:px-(--card-pad) [&>td]:py-2.5">
									<th scope="row" className="px-(--card-pad) py-2.5 text-start font-normal">
										<span className="block">{goal.name}</span>
										{funding ? (
											<span className="block text-[13px] text-muted-foreground">
												{formatMoney(funding)} a month
											</span>
										) : null}
									</th>
									<td className="text-end text-muted-foreground">{reached(plan, goal.id)}</td>
									<td className="text-end font-semibold">{reached(scenario, goal.id)}</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			</Card>
		</Section>
	);
}
