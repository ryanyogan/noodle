import {
	type AccountKind,
	applyPreview,
	describeLever,
	holdsMoney,
	type Lever,
	type LeverImpact,
	type LeverSubjects,
	leverImpacts,
	leverName,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	moneyFreed,
	type OutcomeWarning,
	oneOffAsGoal,
	outcomeWarnings,
	type Plan,
	type PlanRecords,
	type Projection,
	parseLeverPreset,
	planAhead,
	planForMonth,
	project,
	projectionAssumptions,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent } from "@noodle/ui/components/card";
import { Field } from "@noodle/ui/components/field";
import { Input } from "@noodle/ui/components/input";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Skeleton } from "@noodle/ui/components/skeleton";
import { cn } from "@noodle/ui/lib/utils";
import { useMutationState, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Calculator, ChevronLeft, Layers, TriangleAlert } from "lucide-react";
import {
	lazy,
	memo,
	Suspense,
	useCallback,
	useDeferredValue,
	useId,
	useMemo,
	useState,
} from "react";
import { ulid } from "ulid";
import { z } from "zod";
import { NativeSelect } from "../../../components/native-select";
import { Confirm } from "../../../components/plan-editing";
import { changeId, ScenarioChanges, useDebounced } from "../../../components/scenario-changes";
import type { Outcome } from "../../../components/scenario-outcomes";
import { ScenarioOutcome, ScenarioOutline } from "../../../components/scenario-outline";
import { formatMoney, shortDayAt, shortMonth } from "../../../format";
import { useReducedMotion } from "../../../motion";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../../../queries";
import {
	leverTarget,
	projectionGoals,
	type SaveScenarioVariables,
	type ScenarioRecord,
	useApplyScenario,
	useDeleteScenario,
	useSaveScenario,
	withLever,
} from "../../../scenarios";

// Explore: Scenarios projected against the Plan. The loader fetches the data on the server;
// the page itself renders only in the browser (data-only SSR), and its charts load lazily.

const ScenarioOutcomes = lazy(() => import("../../../components/scenario-outcomes"));
const FreeToSpendOutcome = lazy(() =>
	import("../../../components/scenario-outcomes").then((m) => ({ default: m.FreeToSpendOutcome })),
);

export const Route = createFileRoute("/_authed/_household/explore")({
	ssr: "data-only",
	// `scenario`: open this saved Scenario. `lever`: open a new Scenario with these changes made
	// (see parseLeverPreset), e.g. from Insights, Ask or Affordability. `end`: the same, ending a
	// Commitment (as `lever=end-commitment:<id>` does), for links made before presets.
	validateSearch: z.object({
		scenario: z.string().optional().catch(undefined),
		lever: z
			.union([z.string(), z.array(z.string())])
			.optional()
			.catch(undefined),
		end: z.string().optional().catch(undefined),
	}),
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

type ExploreSearch = { scenario?: string; lever?: string | string[]; end?: string };

/**
 * The Levers a link's presets make, keeping only those on what's in the Plan: a Bucket,
 * Commitment or Goal that's gone, or the other Parent's Personal Allowance, is dropped.
 */
function presetLevers(
	search: ExploreSearch,
	input: { month: MonthKey; plan: Plan; goals: readonly { id: string }[]; parentId: string },
): Lever[] {
	const { month, plan, goals, parentId } = input;
	const presets = [
		...(search.end ? [`end-commitment:${search.end}`] : []),
		...(search.lever === undefined ? [] : [search.lever].flat()),
	];
	const bucket = (id: string) => plan.buckets.find((b) => b.id === id);
	const inPlan = (lever: Lever) => {
		switch (lever.kind) {
			case "allowance": {
				const owner = bucket(lever.bucketId)?.owner;
				return bucket(lever.bucketId) !== undefined && (owner === undefined || owner === parentId);
			}
			case "archive-bucket":
				return bucket(lever.bucketId) !== undefined;
			case "commitment-terms":
			case "end-commitment":
				return plan.commitments.some((c) => c.id === lever.commitmentId);
			case "goal":
				return goals.some((g) => g.id === lever.goalId);
			default:
				return true;
		}
	};
	return presets
		.flatMap((preset) => parseLeverPreset(preset, month) ?? [])
		.filter(inPlan)
		.reduce<Lever[]>(withLever, []);
}

function ExplorePage() {
	const { scenario, lever, end } = Route.useSearch();
	// A new link opens its own Scenario, so the page starts over with it.
	return <Explore key={JSON.stringify([scenario, lever, end])} search={{ scenario, lever, end }} />;
}

function Explore({ search }: { search: ExploreSearch }) {
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

	// A Scenario saved just before opening here (Affordability's "Explore as a Scenario") may not
	// be in the list yet: its save is still on its way.
	const saving = useMutationState({
		filters: { mutationKey: ["scenario-change"], status: "pending" },
		select: (mutation) => mutation.state.variables as Partial<SaveScenarioVariables> | undefined,
	});
	// The Scenario asked for, else a new one with the changes asked for, else the most recently
	// changed Scenario, or a new one from the Plan as it stands.
	const [draft, setDraft] = useState<Draft>(() => {
		const kept = scenarios.find((s) => s.id === search.scenario);
		if (kept) return { id: kept.id, name: kept.name, levers: kept.levers };
		const pending = saving.find((v) => v?.scenarioId === search.scenario);
		if (search.scenario && pending?.name && pending.levers) {
			return { id: search.scenario, name: pending.name, levers: pending.levers };
		}
		const levers = presetLevers(search, { month, plan, goals, parentId });
		if (levers.length > 0) {
			const [only] = levers;
			const ending =
				levers.length === 1 && only?.kind === "end-commitment"
					? plan.commitments.find((c) => c.id === only.commitmentId)
					: undefined;
			return {
				...freshDraft(scenarios),
				...(ending ? { name: `Without ${ending.name}`.slice(0, 40) } : {}),
				levers,
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
			viewer: parentId,
		}),
		[month, plan, goals, parentId],
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

	// The outcome charts, warnings and each change's impact follow the Levers once they settle:
	// one projection per Lever is too much for every slider step, and the charts animate calmer.
	const settled = useDebounced(draft.levers, 250);
	const outcome = useMemo<Outcome>(() => {
		const impacts = leverImpacts(ahead, settled);
		return {
			plan: planProjection,
			scenario: project(ahead, settled),
			levers: settled,
			impacts,
			describe: (index) => {
				const lever = settled[index];
				return lever ? describeLever(lever, subjects, settled).text : "";
			},
		};
	}, [ahead, settled, planProjection, subjects]);
	const impacts = useMemo(
		() =>
			new Map(
				outcome.levers.map((lever, i) => [leverTarget(lever), outcome.impacts[i] as LeverImpact]),
			),
		[outcome],
	);
	const warnings = useMemo(
		() =>
			outcomeWarnings({
				...outcome,
				goalName: (id) => goalNames.get(id) ?? "Goal",
			}).map((warning) => {
				const lever = warning.lever === null ? undefined : outcome.levers[warning.lever];
				return {
					...warning,
					change: lever
						? { target: leverTarget(lever), name: leverName(lever, subjects, outcome.levers) }
						: null,
				};
			}),
		[outcome, goalNames, subjects],
	);
	const assumptions = useMemo(
		() => projectionAssumptions(outcome.levers, outcome.scenario.startingCushion),
		[outcome],
	);

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
					<>
						<Button variant="ghost" size="sm" asChild>
							<Link to="/explore/scenarios">
								<Layers />
								<span className="max-sm:sr-only">Scenarios</span>
							</Link>
						</Button>
						<Button variant="outline" size="sm" asChild>
							<Link to="/explore/afford">
								<Calculator />
								Can we afford it?
							</Link>
						</Button>
					</>
				}
			/>
			<div className="grid gap-8">
				<ScenarioBar
					draft={draft}
					scenarios={scenarios}
					saved={saved}
					dirty={dirty}
					subjects={subjects}
					records={records}
					accounts={accounts}
					onDraft={setDraft}
				/>
				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] lg:items-start">
					{/* It stays beside the Levers only where it fits on screen: stuck, anything below
					    the fold couldn't be reached until the Levers ran out. */}
					<div className="grid gap-4 lg:[@media(min-height:48rem)]:sticky lg:top-6">
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
						<Summary
							plan={planProjection}
							scenario={scenarioProjection}
							horizonLabel={horizonLabel}
							warnings={warnings}
						/>
						<Suspense fallback={<Skeleton className="h-[340px] w-full rounded-xl" />}>
							<FreeToSpendOutcome outcome={outcome} title="Free to Spend each month" />
						</Suspense>
					</div>
					<div className="grid gap-3">
						<Freed
							plan={planProjection}
							scenario={scenarioProjection}
							horizonLabel={horizonLabel}
							className="sticky top-[env(safe-area-inset-top)] z-10 -mx-(--gutter) bg-background/85 px-(--gutter) py-2 text-lg backdrop-blur-xl lg:hidden"
						/>
						<ScenarioChanges
							impacts={impacts}
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
				<Section aria-labelledby="outcomes">
					<SectionHeader id="outcomes" title="How it plays out" />
					<div className="grid gap-4 lg:grid-cols-2 lg:items-start">
						<Suspense
							fallback={
								<>
									<Skeleton className="h-[340px] w-full rounded-xl" />
									<Skeleton className="h-[340px] w-full rounded-xl" />
								</>
							}
						>
							<ScenarioOutcomes outcome={outcome} goalNames={goalNames} />
						</Suspense>
						<Totals
							plan={planProjection}
							scenario={scenarioProjection}
							horizonLabel={horizonLabel}
						/>
						{goals.length > 0 ? (
							<GoalsReached plan={planProjection} scenario={scenarioProjection} goals={goals} />
						) : null}
					</div>
					<p className="max-w-prose text-xs text-muted-foreground">
						<span className="font-medium">Assumptions.</span> {assumptions.join(" ")}
					</p>
				</Section>
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
	records,
	accounts,
	onDraft,
}: {
	draft: Draft;
	scenarios: ScenarioRecord[];
	saved: ScenarioRecord | undefined;
	dirty: boolean;
	subjects: LeverSubjects;
	records: PlanRecords;
	accounts: readonly { id: string; name: string; kind: AccountKind }[];
	onDraft: (draft: Draft) => void;
}) {
	const save = useSaveScenario();
	const remove = useDeleteScenario();
	const apply = useApplyScenario();
	const [confirming, setConfirming] = useState<"apply" | "delete" | null>(null);
	const id = useId();
	const name = draft.name.trim();
	const muted = draft.levers.filter((l) => l.muted).length;
	// Exactly what applying writes to the Plan, what it leaves out, and what must change first.
	const preview = useMemo(
		() =>
			confirming === "apply"
				? applyPreview({
						records,
						month: subjects.month,
						levers: draft.levers,
						viewer: subjects.viewer ?? "",
						goals: subjects.goals,
						accounts,
					})
				: null,
		[confirming, records, subjects, draft.levers, accounts],
	);
	// A one-off expense made a Goal is saved for in the first Account that can hold it.
	const goalAccount = accounts.find((a) => holdsMoney(a.kind));
	const asGoal = (index: number) =>
		onDraft({
			...draft,
			levers: draft.levers.map((lever, i) =>
				i === index && lever.kind === "one-off"
					? oneOffAsGoal(lever, {
							goalId: ulid(),
							month: subjects.month,
							accountId: goalAccount?.id,
						})
					: lever,
			),
		});

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
					{saved?.appliedAt
						? ` · Applied ${shortDayAt(saved.appliedAt)}${saved.appliedBy ? ` by ${saved.appliedBy}` : ""}`
						: null}
				</p>
				{preview ? (
					<div
						role="alertdialog"
						aria-label="Apply to the Plan"
						className="grid gap-3 rounded-xl bg-surface-2 p-3"
					>
						<p className="text-sm">
							{preview.changes.length > 0
								? `Make “${name || "this Scenario"}” the Plan from ${shortMonth(subjects.month)} on? This changes:`
								: "Nothing here changes the Plan yet."}
						</p>
						{preview.changes.length > 0 ? (
							<ul
								aria-label="What changes in the Plan"
								className="grid list-disc gap-1 ps-5 text-sm"
							>
								{preview.changes.flatMap((change) =>
									change.lines.map((line) => <li key={`${change.lever}-${line}`}>{line}</li>),
								)}
							</ul>
						) : null}
						{preview.leftOut.length > 0 ? (
							<div className="grid gap-1.5">
								<p className="text-[13px] font-medium">Not applied</p>
								<ul aria-label="Not applied" className="grid gap-1.5 text-[13px]">
									{preview.leftOut.map((item) => (
										<li key={item.lever} className="flex flex-wrap items-center gap-x-2 gap-y-1">
											<span>
												{item.text}{" "}
												<span className="text-muted-foreground">
													{item.reason}
													{item.asGoal && !goalAccount
														? " A Goal needs a checking or savings Account: add one on Goals first."
														: null}
												</span>
											</span>
											{item.asGoal && goalAccount ? (
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => asGoal(item.lever)}
												>
													Make it a Goal
												</Button>
											) : null}
										</li>
									))}
								</ul>
							</div>
						) : null}
						{preview.blocked.length > 0 ? (
							<ul className="grid gap-1 text-[13px] text-over">
								{[...new Set(preview.blocked.map((b) => b.reason))].map((reason) => (
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
								disabled={preview.blocked.length > 0 || preview.changes.length === 0}
								onClick={() => {
									setConfirming(null);
									const kept = name || "Scenario";
									apply.mutate({ scenarioId: draft.id, name: kept, levers: draft.levers });
									onDraft({ ...draft, name: kept });
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
							disabled={draft.levers.length === 0 || apply.isPending}
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

type Warning = OutcomeWarning & { change: { target: string; name: string } | null };

/**
 * The Scenario against the Plan at a glance: what it frees, the Cushion at its lowest, and where
 * it stops holding up. Memoised, so it re-renders only when the deferred Levers, the horizon or
 * the warnings change, never in the urgent render of a slider move.
 */
const Summary = memo(function Summary({
	plan,
	scenario,
	horizonLabel,
	warnings,
}: {
	plan: Projection;
	scenario: Projection;
	horizonLabel: string;
	warnings: Warning[];
}) {
	return (
		<Card>
			<CardContent className="grid gap-3">
				<div className="grid gap-0.5">
					<h2 className="text-sm font-medium text-muted-foreground">Against the Plan</h2>
					<Freed plan={plan} scenario={scenario} horizonLabel={horizonLabel} className="text-2xl" />
					<Cushion scenario={scenario} />
				</div>
				{warnings.length > 0 ? <Warnings warnings={warnings} /> : null}
			</CardContent>
		</Card>
	);
});

/** Where the Scenario stops holding up, each linking to the change most responsible. */
/** Warnings shown before the rest fold behind "more": the summary stays short beside the Levers. */
const WARNINGS_SHOWN = 2;

function Warnings({ warnings }: { warnings: Warning[] }) {
	const reduced = useReducedMotion();
	const [all, setAll] = useState(false);
	const hidden = all ? 0 : Math.max(0, warnings.length - WARNINGS_SHOWN);
	const land = useCallback(
		(target: string) => {
			const change = document.getElementById(changeId(target));
			if (!change) return;
			change.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
			change.focus({ preventScroll: true });
		},
		[reduced],
	);
	return (
		<div className="grid gap-1.5">
			<ul aria-label="Warnings" className="grid gap-1.5">
				{warnings.slice(0, warnings.length - hidden).map((warning) => {
					const body = (
						<>
							<TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-over" />
							<span className="grid gap-0.5">
								<span className="font-medium text-foreground">{warning.text}</span>
								{warning.change ? (
									<span className="text-[13px] text-muted-foreground">
										Mostly from your change to {warning.change.name}
									</span>
								) : null}
							</span>
						</>
					);
					const className = "flex items-start gap-2 rounded-lg bg-over-soft px-2.5 py-2 text-sm";
					const { change } = warning;
					return (
						<li key={`${warning.kind}:${warning.goalId ?? ""}`}>
							{change ? (
								<a
									href={`#${changeId(change.target)}`}
									className={cn(
										className,
										"hover:bg-over-soft/70 focus-visible:outline-2 focus-visible:outline-ring",
									)}
									onClick={(event) => {
										event.preventDefault();
										land(change.target);
									}}
								>
									{body}
								</a>
							) : (
								<div className={className}>{body}</div>
							)}
						</li>
					);
				})}
			</ul>
			{warnings.length > WARNINGS_SHOWN ? (
				<Button
					type="button"
					variant="ghost"
					size="sm"
					className="justify-self-start text-muted-foreground"
					aria-expanded={all}
					onClick={() => setAll((a) => !a)}
				>
					{all ? "Fewer warnings" : `${hidden} more ${hidden === 1 ? "warning" : "warnings"}`}
				</Button>
			) : null}
		</div>
	);
}

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
