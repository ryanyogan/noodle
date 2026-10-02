import {
	addMonths,
	freeToSpendParts,
	lumpsIn,
	type MonthKey,
	type MonthState,
	monthOfDay,
	parseDollars,
	whatChanged,
} from "@noodle/domain";
import { Alert, AlertDescription } from "@noodle/ui/components/alert";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { ComingUpSummary, LumpCallout } from "../../../components/coming-up";
import { AmountInput } from "../../../components/goals";
import { PlanDraftSection } from "../../../components/plan-draft";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanHealth } from "../../../components/plan-health";
import {
	describeGroup,
	groupMeta,
	groupTitle,
	HistoryStart,
} from "../../../components/plan-history";
import { PlanEnded, planParts } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, monthName } from "../../../format";
import { useGoals } from "../../../goals";
import { usePlanChange, withTakeHomePay } from "../../../plan-changes";
import {
	commitmentsQuery,
	goalsQuery,
	planDraftQuery,
	planHealthQuery,
	planHistoryQuery,
	useMonthState,
} from "../../../queries";
import { setTakeHomePay } from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/plan/$month/")({
	// Setting up the Plan ticks off its Goals step once there are Goals; Coming up reads every
	// Commitment's schedule and charges; Plan health shows on this month's Plan.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
			context.queryClient.ensureQueryData(commitmentsQuery()),
			context.queryClient.ensureQueryData(planHistoryQuery(context.month)),
			context.queryClient.ensureQueryData(planHealthQuery()),
		]),
	pendingComponent: SectionPending,
	component: PlanOverview,
});

type PlanState = ReturnType<typeof useMonthState>;

function PlanOverview() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const current = monthOfDay(state.asOf);
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const settingUp = state.editable && (state.baseline === null || buckets.length === 0);
	return (
		<>
			{/* At lg: the Plan itself on the left, what's coming and what changed on the right. */}
			<SplitLayout className="max-w-2xl lg:max-w-none">
				<SplitMain>
					{state.editable ? null : <PlanEnded />}
					{state.editable && month === current ? <PlanDraftSection /> : null}
					{settingUp ? <SetUp state={state} current={month === current} /> : null}
					{month === current ? <PlanHealth /> : null}
					{/* Until take-home pay is set, the rest is all zeros: setting up comes first. */}
					{settingUp && state.baseline === null ? null : (
						<div className="grid gap-3">
							<Waterfall state={state} current={month === current} />
							<LumpCallout lumps={lumpsIn(state)} month={month} />
							<YearLink month={month} />
						</div>
					)}
				</SplitMain>
				{settingUp && state.baseline === null ? null : (
					<SplitRail>
						{month === current ? <ComingUpSummary /> : null}
						<WhatChanged month={month} first={state.firstMonth} />
					</SplitRail>
				)}
			</SplitLayout>
		</>
	);
}

/** Opens the year the month is in, month by month. */
function YearLink({ month }: { month: MonthKey }) {
	const year = month.slice(0, 4);
	return (
		<Button
			variant="secondary"
			size="lg"
			className="justify-between px-(--card-pad) text-sm"
			asChild
		>
			<Link to="/plan/$month/year" params={{ month }}>
				See the whole of {year}
				<ChevronRight aria-hidden="true" className="size-4 text-subtle-foreground" />
			</Link>
		</Button>
	);
}

/**
 * Setting up a month's Plan, step by step: take-home pay right here, then Commitments, Buckets and
 * Goals on their own pages. Each step says when it's done.
 */
function SetUp({ state, current }: { state: PlanState; current: boolean }) {
	const { month } = state;
	// With no draft yet, statements are the quickest start: the Plan is drafted from them.
	const { data: draft } = useQuery({ ...planDraftQuery(), enabled: current });
	const { goals, accounts } = useGoals();
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const activeGoals = goals.filter((g) => g.state === "active");
	return (
		<Section aria-labelledby="plan-set-up">
			<SectionHeader id="plan-set-up" title="Set up the Plan" />
			<Card>
				<ol className="[&>li+li]:border-t">
					<Step
						number={1}
						title="Take-home pay"
						done={state.baseline !== null}
						description={
							state.baseline === null
								? "Your usual monthly pay after taxes and deductions. The Plan divides it up."
								: `${formatMoney(state.baseline)} a month`
						}
					>
						{state.baseline === null ? (
							<TakeHomePayForm month={month} />
						) : (
							<p className="text-[13px] text-muted-foreground">
								Change it any time on{" "}
								<Link
									to="/plan/$month/income"
									params={{ month }}
									className="font-medium text-foreground underline underline-offset-2"
								>
									Income
								</Link>
								.
							</p>
						)}
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
								: "Save for something ahead, or pay down a card or loan, funded from Free to Spend."
						}
						action={
							// Goals are set aside in an Account, so one comes first.
							accounts.length === 0 ? (
								<Button variant="outline" size="sm" className="justify-self-start" asChild>
									<Link to="/accounts">Add an Account first</Link>
								</Button>
							) : (
								<Button variant="outline" size="sm" className="justify-self-start" asChild>
									<Link to="/goals" search={{ add: "save" }}>
										Add a Goal
									</Link>
								</Button>
							)
						}
					/>
				</ol>
			</Card>
			{current && draft === null ? (
				<p className="text-[13px] text-muted-foreground">
					Have bank or card statements? Upload about three months of them to{" "}
					<Link to="/accounts" className="font-medium text-foreground underline underline-offset-2">
						an Account
					</Link>{" "}
					and the Plan is drafted from them.
				</p>
			) : null}
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

/** The first step of setting up: take-home pay, which applies from this month on. */
function TakeHomePayForm({ month }: { month: MonthKey }) {
	const hydrated = useHydrated();
	const id = useId();
	const [amount, setAmount] = useState("");
	const cents = parseDollars(amount);
	const change = usePlanChange(month, {
		save: (data: { month: MonthKey; amountCents: number }) => setTakeHomePay({ data }),
		apply: withTakeHomePay,
	});

	function onSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault();
		if (cents !== null) change.mutate({ month, amountCents: cents });
	}

	return (
		<form onSubmit={onSubmit} className="grid gap-3">
			{/* The step's title shows what it is; the label names the field for assistive tech. */}
			<label htmlFor={`${id}-baseline`} className="sr-only">
				Take-home pay
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
					Set take-home pay
				</Button>
			</div>
			<SaveFailed change={change} />
		</form>
	);
}

/**
 * How take-home pay becomes Free to Spend: each part of the Plan takes its share in turn, each a
 * link to its page. The bars run waterfall-style on one scale, from take-home pay down.
 */
function Waterfall({ state, current }: { state: MonthState; current: boolean }) {
	const takeHomePay = state.baseline ?? 0;
	// Goal funding shows in the current month, where it can still happen, or once it did.
	const steps = freeToSpendParts(state)
		.filter(({ part, amount }) => part !== "goal-funding" || amount > 0 || current)
		.map(({ part, amount }) => ({ ...planParts[part], part, amount }));
	// One scale for every bar: from Free to Spend (when it's below zero) up to take-home pay.
	const low = Math.min(0, state.freeToSpend);
	const high = Math.max(0, takeHomePay);
	const bar = (from: number, to: number) =>
		state.baseline === null || high === low
			? null
			: { left: (from - low) / (high - low), width: (to - from) / (high - low) };
	const overBy = -state.freeToSpend;
	let left = takeHomePay;
	return (
		<Section aria-labelledby="plan-waterfall">
			<SectionHeader id="plan-waterfall" title="From take-home pay to Free to Spend" />
			<List>
				<WaterfallStep
					label="Take-home pay"
					help={<TermHelp term="take-home-pay" />}
					to="/plan/$month/income"
					month={state.month}
					amount={state.baseline === null ? "Not set" : formatMoney(takeHomePay)}
					bar={bar(0, takeHomePay)}
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
							help={step.part === "covers" ? <TermHelp term="cover" /> : undefined}
							month={state.month}
							amount={step.amount > 0 ? `−${formatMoney(step.amount)}` : formatMoney(0)}
							bar={bar(Math.max(left, low), before)}
						/>
					);
				})}
				<li className="grid gap-2.5 px-(--card-pad) py-3.5">
					<div className="flex items-center justify-between gap-4 text-sm font-semibold">
						<span className="inline-flex items-center gap-1">
							Free to Spend
							<TermHelp term="free-to-spend" />
						</span>
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
				<Alert variant="destructive">
					<AlertDescription>
						{state.committed > 0
							? `Your Commitments and Buckets add up to ${formatMoney(overBy)} more than your take-home pay. Lower an amount, or raise your take-home pay if it has gone up.`
							: `Your Buckets add up to ${formatMoney(overBy)} more than your take-home pay. Lower an allowance, or raise your take-home pay if it has gone up.`}
					</AlertDescription>
				</Alert>
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
	help,
	month,
	amount,
	bar,
	tone = "step",
}: {
	label: string;
	to: StepPath;
	hash?: string;
	/** A term's help, raised above the row's link so it opens on its own. */
	help?: ReactNode;
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
				{help ? <span className="relative z-10 me-auto -ms-2">{help}</span> : null}
				<span className="flex items-center gap-1.5 tabular-nums">
					{amount}
					<ChevronRight aria-hidden="true" className="size-4 text-subtle-foreground" />
				</span>
			</div>
			<Bar bar={bar} tone={tone} />
		</li>
	);
}

/** One step's share of take-home pay, placed where it falls on the way down. */
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
function WhatChanged({ month, first }: { month: MonthKey; first: MonthKey | null }) {
	const { data } = useSuspenseQuery(planHistoryQuery(month));
	const groups = whatChanged(data.changes, month);
	// Nothing to compare with yet: the Household's first month, or no Plan changes at all.
	const fresh = data.historyStart === null || first === null || month <= first;
	return (
		<Section aria-labelledby="what-changed">
			<SectionHeader id="what-changed" title="What changed" count={groups.length || undefined} />
			{groups.length === 0 ? (
				<p className="rounded-xl border border-dashed px-(--card-pad) py-4 text-[13px] text-muted-foreground">
					{fresh
						? "Changes to the Plan will show here."
						: `No Plan changes since ${monthName(addMonths(month, -1))}.`}
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
			{data.historyStart === null ? null : <HistoryStart day={data.historyStart} />}
		</Section>
	);
}
