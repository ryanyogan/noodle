import {
	addMonths,
	lumpsIn,
	type MonthKey,
	monthOfDay,
	parseDollars,
	whatChanged,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { SectionGrid, SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { type FormEvent, type ReactNode, useId, useState } from "react";
import { LumpCallout } from "../../../components/coming-up";
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
import { PlanEnded } from "../../../components/plan-page";
import { PlanSplit } from "../../../components/plan-split";
import { SectionPending } from "../../../components/section-layout";
import { formatMoney, monthName } from "../../../format";
import { useGoals } from "../../../goals";
import { usePlanChange, withTakeHomePay } from "../../../plan-changes";
import {
	goalsQuery,
	planDraftQuery,
	planHealthQuery,
	planHistoryQuery,
	useMonthState,
} from "../../../queries";
import { setTakeHomePay } from "../../../server/plan";

export const Route = createFileRoute("/_authed/_household/plan/$month/")({
	// Setting up the Plan ticks off its Goals step once there are Goals; Plan health shows on this
	// month's Plan.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(goalsQuery()),
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
			{/* At lg: the Plan itself on the left, what changed on the right. Coming up is This Month's. */}
			<SplitLayout className="max-w-2xl lg:max-w-none">
				<SplitMain>
					{state.editable ? null : <PlanEnded />}
					{state.editable && month === current ? (
						<PlanDraftSection planned={state.buckets.map((b) => b.name)} />
					) : null}
					{settingUp ? <SetUp state={state} current={month === current} /> : null}
					{/* On a phone, Free to Spend first, then Plan health folded to one line (#65). */}
					{settingUp && state.baseline === null ? null : (
						<Card className="flex items-baseline justify-between gap-3 p-(--card-pad) lg:hidden">
							<span className="text-sm font-medium text-muted-foreground">Free to Spend</span>
							<span
								className={cn(
									"text-2xl font-semibold tracking-tight tabular-nums",
									state.freeToSpend < 0 && "text-over",
								)}
							>
								{formatMoney(state.freeToSpend)}
							</span>
						</Card>
					)}
					{/* From 1920 the main column has room for two: what to check beside where
					    take-home pay goes, rather than two blocks a metre wide (#73). Narrower, one under the other. */}
					<SectionGrid className="empty:hidden xl:grid-cols-[minmax(0,1fr)] min-[120rem]:grid-cols-2">
						{month === current ? <PlanHealth folded /> : null}
						{/* Until take-home pay is set, the rest is all zeros: setting up comes first. */}
						{settingUp && state.baseline === null ? null : (
							<div className="grid gap-3 only:col-span-full">
								<PlanSplit state={state} current={month === current} />
								<LumpCallout lumps={lumpsIn(state)} month={month} />
							</div>
						)}
					</SectionGrid>
				</SplitMain>
				{settingUp && state.baseline === null ? null : (
					<SplitRail>
						<WhatChanged month={month} first={state.firstMonth} />
					</SplitRail>
				)}
			</SplitLayout>
		</>
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

/** How many changes What changed shows before "Show all". */
const CHANGES_FOLDED = 3;
/** How many the rail shows at lg, where the Plan beside it is taller (#73). */
const CHANGES_FOLDED_WIDE = 6;

/**
 * What changed in this month's Plan since the month before, item by item, and who changed it.
 * This Month's first week links here.
 */
function WhatChanged({ month, first }: { month: MonthKey; first: MonthKey | null }) {
	const { data } = useSuspenseQuery(planHistoryQuery(month));
	const groups = whatChanged(data.changes, month);
	// Folded to the first few (#73), so the rail stays about as tall as the Plan beside it.
	const [all, setAll] = useState(false);
	const shown = all ? groups : groups.slice(0, CHANGES_FOLDED_WIDE);
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
					{shown.map((group, index) => (
						<li
							key={group.key}
							className={cn(
								"grid gap-0.5 px-(--card-pad) py-3",
								// A phone folds to the first three; the rail has room for six.
								!all && index >= CHANGES_FOLDED && "max-lg:hidden",
							)}
						>
							<p className="text-sm font-medium">{groupTitle(group)}</p>
							{group.kind === "personal-allowance" ? null : (
								<p className="text-sm">{describeGroup(group)}</p>
							)}
							<p className="text-[13px] text-muted-foreground">{groupMeta(group)}</p>
						</li>
					))}
				</List>
			)}
			{groups.length > CHANGES_FOLDED ? (
				<Button
					variant="ghost"
					size="sm"
					className={cn(
						"self-start justify-self-start",
						groups.length <= CHANGES_FOLDED_WIDE && "lg:hidden",
					)}
					aria-expanded={all}
					onClick={() => setAll(!all)}
				>
					{all ? "Show fewer" : `Show all ${groups.length}`}
				</Button>
			) : null}
			{/* Only where the log's start cuts this month's comparison short. */}
			{data.historyStart === null ||
			fresh ||
			monthOfDay(data.historyStart) < addMonths(month, -1) ? null : (
				<HistoryStart day={data.historyStart} />
			)}
		</Section>
	);
}
