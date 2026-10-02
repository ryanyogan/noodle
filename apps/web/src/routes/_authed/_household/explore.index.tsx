import {
	type AccountKind,
	applyPreview,
	changeImpacts,
	changeName,
	describeChange,
	holdsMoney,
	MAX_PROJECTION_MONTHS,
	type MonthKey,
	moneyFreed,
	type OutcomeWarning,
	oneOffAsGoal,
	outcomeWarnings,
	type Plan,
	type PlanRecords,
	type Projection,
	parseChangePreset,
	planAhead,
	planForMonth,
	project,
	projectionAssumptions,
	type ScenarioChange,
	type ScenarioChangeImpact,
	type ScenarioChangeSubjects,
} from "@noodle/domain";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@noodle/ui/components/alert-dialog";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Input } from "@noodle/ui/components/input";
import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@noodle/ui/components/select";
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
import { ToggleGroup, ToggleGroupItem } from "@noodle/ui/components/toggle-group";
import { cn } from "@noodle/ui/lib/utils";
import { useMutationState, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, Info, Layers, Plus, Telescope, TriangleAlert } from "lucide-react";
import {
	lazy,
	memo,
	Suspense,
	useCallback,
	useDeferredValue,
	useEffect,
	useId,
	useMemo,
	useState,
} from "react";
import { ulid } from "ulid";
import { z } from "zod";
import { Confirm } from "../../../components/plan-editing";
import { changeId, ScenarioChanges, useDebounced } from "../../../components/scenario-changes";
import type { Outcome } from "../../../components/scenario-outcomes";
import { ScenarioOutcome, ScenarioOutline } from "../../../components/scenario-outline";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, formatWholeMoney, shortDayAt, shortMonth } from "../../../format";
import { useReducedMotion } from "../../../motion";
import { goalsQuery, planAheadQuery, scenariosQuery } from "../../../queries";
import {
	changeTarget,
	projectionGoals,
	type SaveScenarioVariables,
	type ScenarioRecord,
	useApplyScenario,
	useDeleteScenario,
	useSaveScenario,
	withChange,
} from "../../../scenarios";

// Explore: Scenarios projected against the Plan. The loader fetches the data on the server;
// the page itself renders only in the browser (data-only SSR), and its charts load lazily.

const OutcomeTabs = lazy(() =>
	import("../../../components/scenario-outcomes").then((m) => ({ default: m.OutcomeTabs })),
);

/** The size of the loaded Tabs and chart card (tabs, header, plot, legend), so nothing shifts. */
function OutcomeTabsSkeleton() {
	return (
		<div className="grid gap-3">
			<Skeleton className="h-9 w-72 rounded-lg" />
			<Skeleton className="h-[400px] w-full rounded-xl" />
		</div>
	);
}

export const Route = createFileRoute("/_authed/_household/explore/")({
	ssr: "data-only",
	pendingComponent: SectionPending,
	// `scenario`: open this saved Scenario. `lever`: open a new Scenario with these changes made
	// (see parseChangePreset), e.g. from Insights, Ask or Affordability. `end`: the same, ending a
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
type Draft = { id: string; name: string; levers: ScenarioChange[] };

const freshDraft = (scenarios: ScenarioRecord[]): Draft => ({
	id: ulid(),
	name: `Scenario ${scenarios.length + 1}`,
	levers: [],
});

const sameChanges = (a: ScenarioChange[], b: ScenarioChange[]) =>
	JSON.stringify(a) === JSON.stringify(b);

type ExploreSearch = { scenario?: string; lever?: string | string[]; end?: string };

/**
 * The Changes a link's presets make, keeping only those on what's in the Plan: a Bucket,
 * Commitment or Goal that's gone, or the other Parent's Personal Allowance, is dropped.
 */
function presetChanges(
	search: ExploreSearch,
	input: { month: MonthKey; plan: Plan; goals: readonly { id: string }[]; parentId: string },
): ScenarioChange[] {
	const { month, plan, goals, parentId } = input;
	const presets = [
		...(search.end ? [`end-commitment:${search.end}`] : []),
		...(search.lever === undefined ? [] : [search.lever].flat()),
	];
	const bucket = (id: string) => plan.buckets.find((b) => b.id === id);
	const inPlan = (scenarioChange: ScenarioChange) => {
		switch (scenarioChange.kind) {
			case "allowance": {
				const owner = bucket(scenarioChange.bucketId)?.owner;
				return (
					bucket(scenarioChange.bucketId) !== undefined &&
					(owner === undefined || owner === parentId)
				);
			}
			case "archive-bucket":
				return bucket(scenarioChange.bucketId) !== undefined;
			case "commitment-terms":
			case "end-commitment":
				return plan.commitments.some((c) => c.id === scenarioChange.commitmentId);
			case "goal":
				return goals.some((g) => g.id === scenarioChange.goalId);
			default:
				return true;
		}
	};
	return presets
		.flatMap((preset) => parseChangePreset(preset, month) ?? [])
		.filter(inPlan)
		.reduce<ScenarioChange[]>(withChange, []);
}

function ExplorePage() {
	const { scenario, lever, end } = Route.useSearch();
	const queryClient = useQueryClient();
	const scenarios = useSuspenseQuery(scenariosQuery()).data;
	const saving = useMutationState({
		filters: { mutationKey: ["scenario-change"], status: "pending" },
		select: (mutation) => (mutation.state.variables as Partial<SaveScenarioVariables>)?.scenarioId,
	});
	// Whether the Scenario asked for has been here to open. One whose save landed while Explore
	// was reading the list is in neither the list nor the saves on their way, so read the list
	// again, once; if it has it, start over with it. Once here it stays known, so deleting it, or
	// its save failing, leaves the page as it is, and an id that never existed is read for once.
	const [seen, setSeen] = useState<string>();
	const here =
		scenario !== undefined &&
		(scenarios.some((s) => s.id === scenario) || saving.includes(scenario));
	if (here && seen !== scenario) setSeen(scenario);
	const known = here || (scenario !== undefined && seen === scenario);
	useEffect(() => {
		if (scenario !== undefined && !known) {
			void queryClient.invalidateQueries({ queryKey: scenariosQuery().queryKey });
		}
	}, [queryClient, scenario, known]);
	const { month, records } = useSuspenseQuery(planAheadQuery()).data;
	const plan = planForMonth(records, month);
	// Explore tries changes on the Plan: with nothing in it, there's nothing to try them on.
	if (
		plan.baseline === null &&
		plan.buckets.length === 0 &&
		plan.commitments.length === 0 &&
		scenarios.length === 0
	) {
		return <NoPlanYet month={month} />;
	}
	// A new link opens its own Scenario, so the page starts over with it.
	return (
		<Explore
			key={JSON.stringify([scenario, lever, end, known])}
			search={{ scenario, lever, end }}
		/>
	);
}

/** Explore before there's a Plan: what it's for, and where to start. */
function NoPlanYet({ month }: { month: MonthKey }) {
	return (
		<EmptyState
			className="max-w-2xl"
			icon={<Telescope />}
			title="Explore tries changes on your Plan"
			description="What if you ended a subscription, or spent less eating out? Explore shows how changes like these play out over the coming months, without changing anything. Set up the Plan first, so there’s something to try them on."
			action={
				<div className="flex flex-wrap justify-center gap-2">
					<Button size="sm" asChild>
						<Link to="/plan/$month" params={{ month }}>
							Set up the Plan
						</Link>
					</Button>
				</div>
			}
		/>
	);
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
		const scenarioChanges = presetChanges(search, { month, plan, goals, parentId });
		if (scenarioChanges.length > 0) {
			const [only] = scenarioChanges;
			const ending =
				scenarioChanges.length === 1 && only?.kind === "end-commitment"
					? plan.commitments.find((c) => c.id === only.commitmentId)
					: undefined;
			return {
				...freshDraft(scenarios),
				...(ending ? { name: `Without ${ending.name}`.slice(0, 40) } : {}),
				levers: scenarioChanges,
			};
		}
		const [latest] = scenarios;
		return latest
			? { id: latest.id, name: latest.name, levers: latest.levers }
			: freshDraft(scenarios);
	});
	const saved = scenarios.find((s) => s.id === draft.id);
	const dirty =
		!saved || saved.name !== draft.name.trim() || !sameChanges(saved.levers, draft.levers);
	// Sliders update the Changes at once; the projection and chart follow in a deferred render.
	const scenarioChanges = useDeferredValue(draft.levers);
	const onChangesEdit = useMemo(
		() => (change: (scenarioChanges: ScenarioChange[]) => ScenarioChange[]) =>
			setDraft((d) => ({ ...d, levers: change(d.levers) })),
		[],
	);

	const horizonLabel = HORIZONS.find((h) => h.months === horizon)?.label ?? "";
	// Recomputed only when the deferred Changes (or the horizon) change.
	const planProjection = useMemo(() => project(ahead), [ahead]);
	const scenarioProjection = useMemo(
		() => project(ahead, scenarioChanges),
		[ahead, scenarioChanges],
	);

	// What Changes change, as the Plan has them now: "Your changes" and Apply describe Changes by it.
	const subjects = useMemo<ScenarioChangeSubjects>(
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

	// The outcome charts, warnings and each change's impact follow the Changes once they settle:
	// one projection per Change is too much for every slider step, and the charts animate calmer.
	const settled = useDebounced(draft.levers, 250);
	const outcome = useMemo<Outcome>(() => {
		const impacts = changeImpacts(ahead, settled);
		return {
			plan: planProjection,
			scenario: project(ahead, settled),
			levers: settled,
			impacts,
			describe: (index) => {
				const scenarioChange = settled[index];
				return scenarioChange ? describeChange(scenarioChange, subjects, settled).text : "";
			},
		};
	}, [ahead, settled, planProjection, subjects]);
	const impacts = useMemo(
		() =>
			new Map(
				outcome.levers.map((scenarioChange, i) => [
					changeTarget(scenarioChange),
					outcome.impacts[i] as ScenarioChangeImpact,
				]),
			),
		[outcome],
	);
	const warnings = useMemo(
		() =>
			outcomeWarnings({
				...outcome,
				goalName: (id) => goalNames.get(id) ?? "Goal",
			}).map((warning) => {
				const scenarioChange = warning.lever === null ? undefined : outcome.levers[warning.lever];
				return {
					...warning,
					change: scenarioChange
						? {
								target: changeTarget(scenarioChange),
								name: changeName(scenarioChange, subjects, outcome.levers),
							}
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
			<SplitLayout stack="children">
				{/* Beside the Changes, the outcome takes the wide column and stays in view while it fits
				    the window (what SplitRail does, whichever column it is in); taller, it scrolls with the
				    page. On phones its parts sit in the page, the totals last. */}
				<SplitRail className="lg:gap-4">
					<ToggleGroup
						type="single"
						aria-label="Look ahead"
						value={String(horizon)}
						onValueChange={(value) => setHorizon(Number(value))}
						className="flex-wrap"
					>
						{HORIZONS.map((h) => (
							<ToggleGroupItem key={h.months} value={String(h.months)} variant="segmented">
								{h.label}
							</ToggleGroupItem>
						))}
					</ToggleGroup>
					<Summary
						plan={planProjection}
						scenario={scenarioProjection}
						horizonLabel={horizonLabel}
						warnings={warnings}
					/>
					<Suspense fallback={<OutcomeTabsSkeleton />}>
						<OutcomeTabs outcome={outcome} goalNames={goalNames} />
					</Suspense>
					<Section aria-labelledby="outcomes" className="max-lg:order-last">
						<SectionHeader id="outcomes" title="How it plays out" />
						<Totals
							plan={planProjection}
							scenario={scenarioProjection}
							horizonLabel={horizonLabel}
						/>
						{goals.length > 0 ? (
							<GoalsReached plan={planProjection} scenario={scenarioProjection} goals={goals} />
						) : null}
						<p className="max-w-prose text-xs text-muted-foreground">
							<span className="font-medium">Assumptions.</span> {assumptions.join(" ")}
						</p>
					</Section>
				</SplitRail>
				<SplitMain>
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
							onChange={onChangesEdit}
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
								onChange={onChangesEdit}
							/>
						</ScenarioOutcome>
					</div>
				</SplitMain>
			</SplitLayout>
		</div>
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
	subjects: ScenarioChangeSubjects;
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
			levers: draft.levers.map((scenarioChange, i) =>
				i === index && scenarioChange.kind === "one-off"
					? oneOffAsGoal(scenarioChange, {
							goalId: ulid(),
							month: subjects.month,
							accountId: goalAccount?.id,
						})
					: scenarioChange,
			),
		});

	return (
		<Card>
			<CardContent className="grid gap-3">
				{/* The Scenario's name is its title, renamed in place; the Select only switches. */}
				<div className="flex flex-wrap items-center gap-2">
					<Input
						id={`${id}-name`}
						aria-label="Name"
						placeholder="Name this Scenario"
						value={draft.name}
						maxLength={40}
						onChange={(event) => onDraft({ ...draft, name: event.currentTarget.value })}
						className="-ms-2 min-w-48 flex-1 max-sm:basis-full border-transparent bg-transparent px-2 text-lg font-semibold md:text-lg shadow-none hover:border-input focus-visible:border-ring dark:bg-transparent"
					/>
					<Select
						value={saved ? draft.id : "new"}
						onValueChange={(value) => {
							const scenario = scenarios.find((s) => s.id === value);
							if (!scenario) return;
							setConfirming(null);
							onDraft({ id: scenario.id, name: scenario.name, levers: scenario.levers });
						}}
					>
						<SelectTrigger aria-label="Scenario" className="w-auto">
							<Layers />
							<SelectValue>Switch</SelectValue>
						</SelectTrigger>
						<SelectContent align="end">
							{saved ? null : (
								<SelectItem value="new">{draft.name || "New Scenario"} (not saved)</SelectItem>
							)}
							{scenarios.map((s) => (
								<SelectItem key={s.id} value={s.id}>
									{s.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					{saved ? (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setConfirming(null);
								onDraft(freshDraft(scenarios));
							}}
						>
							<Plus />
							New
							<span className="sr-only"> Scenario from the Plan</span>
						</Button>
					) : null}
				</div>
				<p className="text-[13px] text-muted-foreground">
					{draft.levers.length > 0
						? `${draft.levers.length} ${draft.levers.length === 1 ? "change" : "changes"}${muted > 0 ? ` (${muted} left out)` : ""} to the Plan`
						: "The Plan as it stands. Change anything below to see what it does."}
					{dirty && saved ? " · not saved" : null}
					{saved?.appliedAt
						? ` · Applied ${shortDayAt(saved.appliedAt)}${saved.appliedBy ? ` by ${saved.appliedBy}` : ""}`
						: null}
				</p>
				{preview ? (
					<AlertDialog
						open
						onOpenChange={(open) => {
							if (!open) setConfirming(null);
						}}
					>
						<AlertDialogContent className="max-h-[calc(100dvh-48px)] max-w-lg overflow-y-auto">
							<AlertDialogHeader>
								<AlertDialogTitle>Apply to the Plan</AlertDialogTitle>
								<AlertDialogDescription>
									{preview.changes.length > 0
										? `Make “${name || "this Scenario"}” the Plan from ${shortMonth(subjects.month)} on? This changes:`
										: "Nothing here changes the Plan yet."}
								</AlertDialogDescription>
							</AlertDialogHeader>
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
							<AlertDialogFooter>
								<AlertDialogCancel>Cancel</AlertDialogCancel>
								<AlertDialogAction
									variant="default"
									disabled={preview.blocked.length > 0 || preview.changes.length === 0}
									onClick={() => {
										const kept = name || "Scenario";
										apply.mutate({ scenarioId: draft.id, name: kept, levers: draft.levers });
										onDraft({ ...draft, name: kept });
									}}
								>
									Apply to Plan
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
				{confirming === "delete" ? (
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
				) : null}
				<div className="flex flex-wrap items-center gap-2">
					{/* Save shows only once there's something to save; a kept Scenario says it's saved. */}
					{dirty ? (
						<Button
							type="button"
							size="sm"
							disabled={name === ""}
							onClick={() => {
								save.mutate({ scenarioId: draft.id, name, levers: draft.levers });
								onDraft({ ...draft, name });
							}}
						>
							{saved ? "Save" : "Save Scenario"}
						</Button>
					) : saved ? (
						<span className="inline-flex h-8 items-center gap-1 px-1 text-[13px] text-muted-foreground">
							<Check className="size-4" aria-hidden="true" />
							Saved
						</span>
					) : null}
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
			</CardContent>
		</Card>
	);
}

type Warning = OutcomeWarning & { change: { target: string; name: string } | null };

/**
 * The Scenario against the Plan at a glance: what it frees, the Projected balance at its lowest, and where
 * it stops holding up. Memoised, so it re-renders only when the deferred Changes, the horizon or
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
					<ProjectedBalance scenario={scenario} />
				</div>
				{warnings.length > 0 ? <Warnings warnings={warnings} /> : null}
			</CardContent>
		</Card>
	);
});

/** Warnings shown before the rest fold behind "more": the summary stays short beside the Changes. */
const WARNINGS_SHOWN = 2;

/**
 * Where the Scenario stops holding up, in two kinds: what this Scenario causes (red, each linking
 * to the change most responsible), and what's already so in the Plan (neutral, linking to it),
 * so a problem the Plan has isn't blamed on the Scenario.
 */
function Warnings({ warnings }: { warnings: Warning[] }) {
	const reduced = useReducedMotion();
	const [all, setAll] = useState(false);
	const caused = warnings.filter((w) => !w.inPlan);
	const already = warnings.filter((w) => w.inPlan);
	const hidden = all ? 0 : Math.max(0, caused.length - WARNINGS_SHOWN);
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
		<div className="grid gap-3">
			{caused.length > 0 ? (
				<div className="grid gap-1.5">
					<h3 className="text-[13px] font-medium text-muted-foreground">Caused by this Scenario</h3>
					<ul aria-label="Caused by this Scenario" className="grid gap-1.5">
						{caused.slice(0, caused.length - hidden).map((warning) => {
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
							const className =
								"flex items-start gap-2 rounded-lg bg-over-soft px-2.5 py-2 text-sm";
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
					{caused.length > WARNINGS_SHOWN ? (
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
			) : null}
			{already.length > 0 ? (
				<div className="grid gap-1.5">
					<h3 className="text-[13px] font-medium text-muted-foreground">Already in the Plan</h3>
					<ul aria-label="Already in the Plan" className="grid gap-1 text-sm">
						{already.map((warning) => (
							<li
								key={`${warning.kind}:${warning.goalId ?? ""}`}
								className="flex items-start gap-2 rounded-lg bg-surface-2 px-2.5 py-2"
							>
								<Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span>
									{warning.text}.{" "}
									<Link to="/plan" className="font-medium underline-offset-4 hover:underline">
										See the Plan
									</Link>
								</span>
							</li>
						))}
					</ul>
				</div>
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
					? `Frees ${formatWholeMoney(freed)}`
					: `Costs ${formatWholeMoney(-freed)}`}
			<span className="text-base font-normal text-muted-foreground"> over {horizonLabel}</span>
		</p>
	);
});

/** The Scenario's Projected balance at its lowest, and the month it first goes below zero. */
function ProjectedBalance({ scenario }: { scenario: Projection }) {
	const { lowest } = scenario;
	if (!lowest) return null;
	return (
		<div className="flex items-center gap-1">
			<p className="text-[13px] text-muted-foreground tabular-nums">
				Projected balance at its lowest{" "}
				<span className={cn("font-medium text-foreground", lowest.amount < 0 && "text-over")}>
					{formatWholeMoney(lowest.amount)}
				</span>{" "}
				in {shortMonth(lowest.month)}
			</p>
			<TermHelp term="projected-balance" />
		</div>
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
			<h3 className="px-(--card-pad) pt-(--card-pad) text-sm font-semibold">
				Free to Spend, the Plan against this Scenario
			</h3>
			<Table aria-label="Free to Spend, the Plan against this Scenario" className="text-sm">
				<TableHeader>
					<TableRow className="border-0">
						<TableHead
							scope="col"
							className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-3 pb-2 text-[13px]"
						>
							<span className="sr-only">Total</span>
						</TableHead>
						<TableHead
							scope="col"
							numeric
							className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-3 pb-2 text-[13px]"
						>
							Plan
						</TableHead>
						<TableHead
							scope="col"
							numeric
							className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-3 pb-2 text-[13px]"
						>
							Scenario
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{rows.map((row) => (
						<TableRow key={row.label} className="border-0 border-t">
							<th
								scope="row"
								className="px-(--card-pad) py-2.5 text-start font-normal text-muted-foreground"
							>
								{row.label}
							</th>
							<TableCell
								numeric
								className={cn(
									"px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5",
									row.plan < 0 && "text-over",
								)}
							>
								{formatWholeMoney(row.plan)}
							</TableCell>
							<TableCell
								numeric
								className={cn(
									"px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5 font-semibold",
									row.scenario < 0 && "text-over",
								)}
							>
								{formatWholeMoney(row.scenario)}
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
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
				<Table className="text-sm">
					<TableCaption className="sr-only">
						When each Goal is reached, the Plan against this Scenario
					</TableCaption>
					<TableHeader>
						<TableRow className="border-0">
							<TableHead
								scope="col"
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-3 pb-2 text-[13px]"
							>
								Goal
							</TableHead>
							<TableHead
								scope="col"
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-3 pb-2 text-[13px]"
							>
								Plan
							</TableHead>
							<TableHead
								scope="col"
								numeric
								className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) h-auto pt-3 pb-2 text-[13px]"
							>
								Scenario
							</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{goals.map((goal) => {
							const funding = monthly(scenario, goal.id);
							return (
								<TableRow key={goal.id} className="border-0 border-t">
									<th scope="row" className="px-(--card-pad) py-2.5 text-start font-normal">
										<span className="block">{goal.name}</span>
										{funding ? (
											<span className="block text-[13px] text-muted-foreground">
												{formatMoney(funding)} a month
											</span>
										) : null}
									</th>
									<TableCell
										numeric
										className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5 text-muted-foreground"
									>
										{reached(plan, goal.id)}
									</TableCell>
									<TableCell
										numeric
										className="px-(--card-pad) first:ps-(--card-pad) last:pe-(--card-pad) py-2.5 font-semibold"
									>
										{reached(scenario, goal.id)}
									</TableCell>
								</TableRow>
							);
						})}
					</TableBody>
				</Table>
			</Card>
		</Section>
	);
}
