import {
	addMonths,
	type MonthKey,
	type MonthState,
	monthOfDay,
	parseDollars,
	whatChanged,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { AmountInput } from "../../../components/goals";
import { MonthLinks, MonthTopRow, monthTitle, useMonthSwipe } from "../../../components/month-nav";
import { SaveFailed } from "../../../components/plan-editing";
import {
	describeGroup,
	groupMeta,
	groupTitle,
	HistoryStart,
} from "../../../components/plan-history";
import { PlanEnded } from "../../../components/plan-page";
import { formatMoney, monthName } from "../../../format";
import { useGoals } from "../../../goals";
import { usePlanChange, withBaseline } from "../../../plan-changes";
import { goalsQuery, planHistoryQuery, useMonthState } from "../../../queries";
import { setBaseline } from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/plan/$month/")({
	loader: ({ context }) =>
		Promise.all([
			// Setting up the Plan ticks off its Goals step once there are Goals.
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(planHistoryQuery(context.month)),
		]),
	component: PlanOverview,
});

type PlanState = ReturnType<typeof useMonthState>;

function PlanOverview() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const current = monthOfDay(state.asOf);
	const swipe = useMonthSwipe("/plan/$month", month);
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const settingUp = state.editable && (state.baseline === null || buckets.length === 0);
	return (
		<div {...swipe}>
			<MonthTopRow month={month} current="plan" />
			<PageHeader
				className="max-w-2xl"
				eyebrow="Plan"
				title={monthTitle(month, current)}
				actions={<MonthLinks to="/plan/$month" month={month} />}
			/>
			<div className="grid max-w-2xl gap-8">
				{state.editable ? null : <PlanEnded />}
				{settingUp ? <SetUp state={state} /> : null}
				<Waterfall state={state} current={month === current} />
				<WhatChanged month={month} />
			</div>
		</div>
	);
}

/**
 * Setting up a month's Plan, step by step: the Baseline right here, then Commitments, Buckets and
 * Goals on their own pages. Each step says when it's done.
 */
function SetUp({ state }: { state: PlanState }) {
	const { month } = state;
	const { goals } = useGoals();
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const activeGoals = goals.filter((g) => g.state === "active");
	return (
		<Section aria-labelledby="plan-set-up">
			<SectionHeader id="plan-set-up" title="Set up the Plan" />
			<Card>
				<ol className="[&>li+li]:border-t">
					<Step
						number={1}
						title="Baseline"
						done={state.baseline !== null}
						description={
							state.baseline === null
								? "Your normal monthly take-home pay. The Plan divides it up."
								: `${formatMoney(state.baseline)} a month`
						}
					>
						{state.baseline === null ? <BaselineForm month={month} /> : null}
					</Step>
					<Step
						number={2}
						title="Commitments"
						optional
						done={state.commitments.length > 0}
						description={
							state.commitments.length > 0
								? `${count(state.commitments.length, "Commitment")} · ${formatMoney(state.committed)} this month`
								: "The mortgage, insurance, subscriptions: what’s due every period."
						}
						action={
							<StepLink to="/plan/$month/commitments" month={month} label="Add Commitments" />
						}
					/>
					<Step
						number={3}
						title="Buckets"
						done={buckets.length > 0}
						description={
							buckets.length > 0
								? `${count(buckets.length, "Bucket")} · ${formatMoney(
										buckets.reduce((sum, b) => sum + b.allowance, 0),
									)} a month`
								: "An allowance for each kind of everyday spending, like Groceries or Fun."
						}
						action={<StepLink to="/plan/$month/buckets" month={month} label="Add Buckets" />}
					/>
					<Step
						number={4}
						title="Goals"
						optional
						done={activeGoals.length > 0}
						description={
							activeGoals.length > 0
								? count(activeGoals.length, "Goal")
								: "Money set aside for something ahead, funded from Free to Spend."
						}
						action={<StepLink to="/plan/$month/goals" month={month} label="Add Goals" />}
					/>
				</ol>
			</Card>
		</Section>
	);
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function Step({
	number,
	title,
	description,
	done,
	optional = false,
	action,
	children,
}: {
	number: number;
	title: string;
	description: string;
	done: boolean;
	optional?: boolean;
	action?: ReactNode;
	children?: ReactNode;
}) {
	return (
		<li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 px-(--card-pad) py-3.5">
			<span
				aria-hidden="true"
				className={cn(
					"mt-px grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums",
					done ? "bg-foreground text-background" : "bg-surface-2 text-muted-foreground",
				)}
			>
				{done ? <Check className="size-3.5" strokeWidth={2.5} /> : number}
			</span>
			<div className="grid min-w-0 gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
				<div className="grid min-w-0 gap-0.5">
					<span className="text-sm font-medium">
						<span className="sr-only">Step {number}: </span>
						{title}
						{optional ? (
							<span className="font-normal text-muted-foreground"> (optional)</span>
						) : null}
						{done ? <span className="sr-only"> (done)</span> : null}
					</span>
					<span className="text-[13px] text-muted-foreground">{description}</span>
				</div>
				{action}
			</div>
			{children ? <div className="col-start-2">{children}</div> : null}
		</li>
	);
}

function StepLink({
	to,
	month,
	label,
}: {
	to: "/plan/$month/commitments" | "/plan/$month/buckets" | "/plan/$month/goals";
	month: MonthKey;
	label: string;
}) {
	return (
		<Button variant="outline" size="sm" className="justify-self-start" asChild>
			<Link to={to} params={{ month }}>
				{label}
			</Link>
		</Button>
	);
}

/** The first step of setting up: the Baseline, which applies from this month on. */
function BaselineForm({ month }: { month: MonthKey }) {
	const hydrated = useHydrated();
	const id = useId();
	const [amount, setAmount] = useState("");
	const cents = parseDollars(amount);
	const change = usePlanChange(month, {
		save: (data: { month: MonthKey; amountCents: number }) => setBaseline({ data }),
		apply: withBaseline,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (cents !== null) change.mutate({ month, amountCents: cents });
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-3">
			{/* The step's title shows what it is; the label names the field for assistive tech. */}
			<label htmlFor={`${id}-baseline`} className="sr-only">
				Baseline
			</label>
			<div className="flex gap-2">
				<AmountInput
					id={`${id}-baseline`}
					className="w-40"
					placeholder="0"
					enterKeyHint="done"
					value={amount}
					disabled={!hydrated}
					aria-invalid={(amount !== "" && cents === null) || undefined}
					onChange={(event) => setAmount(event.currentTarget.value)}
				/>
				<Button type="submit" variant="secondary" disabled={!hydrated || cents === null}>
					Set Baseline
				</Button>
			</div>
			<SaveFailed change={change} />
		</form>
	);
}

/**
 * How the Baseline becomes Free to Spend: each part of the Plan takes its share in turn, each a
 * link to its page. The bars run waterfall-style on one scale, from the Baseline down.
 */
function Waterfall({ state, current }: { state: MonthState; current: boolean }) {
	const baseline = state.baseline ?? 0;
	const shared = state.buckets.filter((b) => b.owner === undefined);
	const personal = state.buckets.filter((b) => b.owner !== undefined);
	const sum = (buckets: typeof shared) => buckets.reduce((total, b) => total + b.allowance, 0);
	const steps: { label: string; to: StepPath; hash?: string; amount: number }[] = [
		{ label: "Commitments", to: "/plan/$month/commitments", amount: state.committed },
		{ label: "Buckets", to: "/plan/$month/buckets", amount: sum(shared) },
		...(personal.length > 0
			? [
					{
						label: "Personal Allowances",
						to: "/plan/$month/buckets" as const,
						hash: "personal-allowances",
						amount: sum(personal),
					},
				]
			: []),
		...(state.fundedGoals > 0 || current
			? [{ label: "Goal funding", to: "/plan/$month/goals" as const, amount: state.fundedGoals }]
			: []),
		...(state.movedToBuckets > 0
			? [{ label: "Covers", to: "/plan/$month/buckets" as const, amount: state.movedToBuckets }]
			: []),
	];
	// One scale for every bar: from Free to Spend (when it's below zero) up to the Baseline.
	const low = Math.min(0, state.freeToSpend);
	const high = Math.max(0, baseline);
	const bar = (from: number, to: number) =>
		state.baseline === null || high === low
			? null
			: { left: (from - low) / (high - low), width: (to - from) / (high - low) };
	const overBy = -state.freeToSpend;
	let left = baseline;
	return (
		<Section aria-labelledby="plan-waterfall">
			<SectionHeader id="plan-waterfall" title="Baseline to Free to Spend" />
			<List>
				<WaterfallStep
					label="Baseline"
					to="/plan/$month/income"
					month={state.month}
					amount={state.baseline === null ? "Not set" : formatMoney(baseline)}
					bar={bar(0, baseline)}
					tone="total"
				/>
				{steps.map((step) => {
					const before = left;
					left -= step.amount;
					return (
						<WaterfallStep
							key={step.label}
							label={step.label}
							to={step.to}
							hash={step.hash}
							month={state.month}
							amount={step.amount > 0 ? `−${formatMoney(step.amount)}` : formatMoney(0)}
							bar={bar(Math.max(left, low), before)}
						/>
					);
				})}
				<li className="grid gap-2.5 px-(--card-pad) py-3.5">
					<div className="flex items-center justify-between gap-4 text-sm font-semibold">
						<span>Free to Spend</span>
						<span className={cn("tabular-nums", overBy > 0 && "text-over")}>
							{formatMoney(state.freeToSpend)}
						</span>
					</div>
					<Bar
						bar={bar(Math.min(0, state.freeToSpend), Math.max(0, state.freeToSpend))}
						tone={overBy > 0 ? "over" : "total"}
					/>
				</li>
			</List>
			{overBy > 0 ? (
				<p className="rounded-xl bg-over-soft px-3 py-2.5 text-[13px] text-over">
					{state.committed > 0
						? `Your Commitments and Buckets add up to ${formatMoney(overBy)} more than your Baseline. Lower an amount or raise the Baseline.`
						: `Your Buckets add up to ${formatMoney(overBy)} more than your Baseline. Lower an allowance or raise the Baseline.`}
				</p>
			) : null}
		</Section>
	);
}

type StepPath =
	| "/plan/$month/income"
	| "/plan/$month/commitments"
	| "/plan/$month/buckets"
	| "/plan/$month/goals";

type BarSpan = { left: number; width: number } | null;

function WaterfallStep({
	label,
	to,
	hash,
	month,
	amount,
	bar,
	tone = "step",
}: {
	label: string;
	to: StepPath;
	hash?: string;
	month: MonthKey;
	amount: string;
	bar: BarSpan;
	tone?: "step" | "total";
}) {
	// The whole row opens the step's page, though the link's name is just its label.
	return (
		<li
			className={cn(
				"relative grid gap-2.5 px-(--card-pad) py-3.5",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
				"has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring",
			)}
		>
			<div className="flex items-center justify-between gap-4 text-sm">
				<Link
					to={to}
					params={{ month }}
					hash={hash}
					className="font-medium outline-none after:absolute after:inset-0"
				>
					{label}
				</Link>
				<span className="flex items-center gap-1.5 tabular-nums">
					{amount}
					<ChevronRight aria-hidden="true" className="size-4 text-subtle-foreground" />
				</span>
			</div>
			<Bar bar={bar} tone={tone} />
		</li>
	);
}

/** One step's share of the Baseline, placed where it falls on the way down. */
function Bar({ bar, tone }: { bar: BarSpan; tone: "step" | "total" | "over" }) {
	if (!bar) return null;
	return (
		<span aria-hidden="true" className="relative block h-1.5 rounded-full bg-surface-2">
			<span
				className={cn(
					"absolute inset-y-0 rounded-full transition-[left,width] duration-(--duration-meter) ease-spring",
					tone === "step" && "bg-muted-foreground/70",
					tone === "total" && "bg-foreground",
					tone === "over" && "bg-over",
				)}
				style={{ left: pct(bar.left), width: pct(bar.width) }}
			/>
		</span>
	);
}

const pct = (share: number) => `${(Math.min(1, Math.max(0, share)) * 100).toFixed(2)}%`;

/**
 * What changed in this month's Plan since the month before, item by item, and who changed it.
 * This Month's first week links here.
 */
function WhatChanged({ month }: { month: MonthKey }) {
	const { data } = useSuspenseQuery(planHistoryQuery(month));
	const groups = whatChanged(data.changes, month);
	return (
		<Section aria-labelledby="what-changed">
			<SectionHeader id="what-changed" title="What changed" count={groups.length || undefined} />
			{groups.length === 0 ? (
				<p className="rounded-xl border border-dashed px-(--card-pad) py-4 text-[13px] text-muted-foreground">
					No Plan changes since {monthName(addMonths(month, -1))}.
				</p>
			) : (
				<List>
					{groups.map((group) => (
						<li key={group.key} className="grid gap-0.5 px-(--card-pad) py-3">
							<p className="text-sm font-medium">{groupTitle(group)}</p>
							{group.kind === "personal-allowance" ? null : (
								<p className="text-sm">{describeGroup(group)}</p>
							)}
							<p className="text-[13px] text-muted-foreground">{groupMeta(group)}</p>
						</li>
					))}
				</List>
			)}
			<HistoryStart day={data.historyStart} />
		</Section>
	);
}
