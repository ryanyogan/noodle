import {
	addMonths,
	type BucketState,
	type CoverSource,
	canAssign,
	type DayKey,
	extraIncomeSuggestions,
	type IncomeCheck,
	incomeCheck,
	type LowerTakeHomePay,
	lastDayOf,
	lowerTakeHomePay,
	lumpsIn,
	type MonthCloseProposal,
	type MonthKey,
	type MonthState,
	monthCloseProposal,
	monthEnd,
	monthOfDay,
	nothingToDecide,
	whatChanged,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { BudgetBar, BudgetBarKey } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { PageLayout, SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import {
	CalendarCheck,
	CalendarDays,
	Check,
	ChevronRight,
	HeartPulse,
	History,
	Lightbulb,
	ListChecks,
	Pencil,
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, availableParts, barState, monogram } from "../../../buckets";
import { Bills } from "../../../components/bills";
import { LumpCallout } from "../../../components/coming-up";
import { CoverSheet, sourceName } from "../../../components/cover";
import {
	ExtraIncomeSection,
	ExtraIncomeSheet,
	MonthIncome,
} from "../../../components/extra-income";
import { LowerTakeHomePayNote, useLowerTakeHomePay } from "../../../components/lower-take-home-pay";
import { MonthCloseSection, MonthEndSection } from "../../../components/month-close";
import { MonthGlance, monthSentence } from "../../../components/month-glance";
import { PerkResetLine, usePerkResetSoon } from "../../../components/perk-reset";
import { TermHelp } from "../../../components/term-help";
import { ToDo, type ToDoItem } from "../../../components/to-do";
import { type CoverVariables, useCovers } from "../../../covers";
import { useExtraIncomes } from "../../../extra-income";
import { formatMoney, monthName, shortDay } from "../../../format";
import { type GoalView, useGoals } from "../../../goals";
import { useLearned } from "../../../learned";
import { closingWeek, useCloseMonth } from "../../../month-close";
import { useFreeCarry } from "../../../plan-changes";
import { PLAN_BUCKETS_HASH } from "../../../plan-pages";
import { carriedOverText } from "../../../plan-split";
import {
	checkInStatusQuery,
	commitmentsQuery,
	editedAllowancesQuery,
	insightsQuery,
	membersQuery,
	monthsKey,
	planHealthQuery,
	planHistoryQuery,
	reviewQuery,
	setupQuery,
	useMonthState,
} from "../../../queries";
import { applySuggestedAmounts } from "../../../server/plan";
import { saveSetup } from "../../../server/setup";
import { continueSetupShown, SETUP_STEP_COUNT } from "../../../setup";
import { type SuggestedAmount, unappliedSuggestions } from "../../../suggested-amounts";

export const Route = createFileRoute("/_authed/_household/month/$month/")({
	// Coming up reads every Commitment's schedule and charges; an ended month names who closed it.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(commitmentsQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(setupQuery()),
		]),
	component: ThisMonth,
});

function ThisMonth() {
	const { month, parentId } = Route.useRouteContext();
	const state = useMonthState(month);
	const freeKept = useFreeCarry(month).handedOn ?? 0;
	const { cover } = useCovers();
	// The overspent Bucket being covered, by ID, so the sheet follows its latest state.
	const [covering, setCovering] = useState<string | null>(null);
	const [choosingExtraIncome, setChoosingExtraIncome] = useState(false);
	const extraIncomes = useExtraIncomes();
	const goals = useGoals();
	const members = useSuspenseQuery(membersQuery()).data;
	const planned =
		state.baseline !== null || state.buckets.length > 0 || state.commitments.length > 0;
	// Commitments due this month, or paid anyway; the rest are collapsed under "Not this month".
	const commitments = state.commitments.filter((c) => c.status !== "not-due");
	const notDue = state.commitments.filter((c) => c.status === "not-due");
	// Covers happen within the current month; earlier months are closed.
	const canCover = monthOfDay(state.asOf) === month;
	// The other Parent's Personal Allowance is theirs to Cover, and to Cover from.
	const over = canCover
		? state.buckets.filter((b) => b.status === "over" && canAssign(b, parentId))
		: [];
	// Overspent Buckets first, each with its Cover on the row: one place says it's over.
	const overFirst = (list: BucketState[]) =>
		[...list].sort((a, b) => Number(b.status === "over") - Number(a.status === "over"));
	const buckets = overFirst(state.buckets.filter((b) => b.owner === undefined));
	const allowances = overFirst(state.buckets.filter((b) => b.owner !== undefined));
	// "Cover" is explained once, on the first overspent row, not on every one (#73).
	const firstOver = [...buckets, ...allowances].find((b) => over.includes(b));
	const bucketRow = (bucket: BucketState) => {
		const mine = canAssign(bucket, parentId);
		return (
			<BucketRow
				key={bucket.id}
				bucket={bucket}
				onCover={over.includes(bucket) ? () => setCovering(bucket.id) : undefined}
				explainCover={bucket === firstOver}
				// Only the other Parent's Personal Allowance is private; its totals are all there is.
				private={!mine}
			/>
		);
	};
	const coverVariables = (bucket: BucketState, source: CoverSource, amountCents: number) =>
		({
			moveId: ulid(),
			month,
			fromBucketId: source.bucket?.id ?? null,
			fromName: sourceName(source.bucket),
			toBucketId: bucket.id,
			toName: bucket.name,
			amountCents,
		}) satisfies CoverVariables;
	const current = monthOfDay(state.asOf);
	const isCurrent = month === current;
	const perkLine = usePerkResetSoon();
	// What the To do strip holds is decided here, from the same data each prompt reads.
	const getStarted = useGetStartedSteps(state);
	const setupState = useSuspenseQuery(setupQuery()).data;
	const edited = useQuery(editedAllowancesQuery()).data;
	const suggested =
		edited && setupState.answers.amountsDismissed !== true
			? unappliedSuggestions({
					answers: setupState.answers,
					takeHomeCents: state.baseline,
					plan: state.buckets,
					edited: new Set(edited),
				})
			: [];
	const checkInDue = useCheckInDue();
	const chips = useChipCounts(month, state.asOf, isCurrent);
	const monthIncome = state.income.filter((i) => monthOfDay(i.date) === month);
	const check = incomeCheck({
		baseline: state.baseline,
		income: state.income,
		month,
		asOf: state.asOf,
	});
	// A low month, in its last days: this month's take-home pay can be lowered to what came in.
	const lower = lowerTakeHomePay({
		baseline: state.baseline,
		income: state.income,
		month,
		asOf: state.asOf,
	});
	const activeGoals = goals.goals.filter((g) => g.state === "active");
	// This month's Extra income can go to its Buckets too; an ended month's only to Goals.
	const extraIncomePlaces = {
		goals: activeGoals,
		buckets: month === current ? state.buckets.filter((b) => canAssign(b, parentId)) : [],
	};
	const suggestions = extraIncomeSuggestions({
		pending: state.windfallLeft,
		goals: activeGoals.map((g) => ({
			id: g.id,
			name: g.name,
			targetDate: g.targetDate,
			status: g.progress.status,
			remaining: g.progress.remaining,
		})),
		emergencyGoalId: goals.emergencyGoalId,
		buckets: extraIncomePlaces.buckets,
	});
	return (
		<>
			{planned ? (
				// One column on phones, in reading order; from lg the money at a glance sits in a
				// right rail. The columns are `contents` on phones so `order` interleaves them.
				<SplitLayout stack="children">
					{/* Buckets, then Bills, each the main column's full width (Bills' rows in two columns
					    where they fit). Income sits in the rail under To do from lg (on phones it follows Bills
					    here, as before), so the rail isn't far
					    shorter than this column (#73). */}
					<SplitMain>
						<div className="order-6 grid gap-3 empty:hidden lg:order-none">
							{month < current ? (
								<MonthEndSection
									month={month}
									end={monthEnd(state, state)}
									freeKept={freeKept}
									closed={state.closed}
									parentId={parentId}
									goals={goals.goals}
									members={members}
								/>
							) : null}
						</div>
						{/* A box of its own from lg (not `contents`), so the column starts with Buckets, level
						    with Free to Spend in the rail. */}
						<div
							className={cn(
								"contents lg:min-w-0 lg:content-start lg:gap-(--layout-gap)",
								buckets.length + allowances.length > 0 ? "lg:grid" : "lg:hidden",
							)}
						>
							<div className="order-8 grid gap-3 empty:hidden lg:order-none">
								{buckets.length > 0 ? (
									<Section aria-labelledby="buckets">
										<SectionHeader
											id="buckets"
											title="Buckets"
											count={buckets.length}
											help={<TermHelp term="bucket" extra={<BucketsHelpExtra />} />}
											// The way to the list where Buckets are added, changed, moved and
											// archived (#98): it was three taps away on a phone, under More.
											action={
												state.editable ? (
													// A plain link as tall as the heading from lg (44px on a phone), so
													// the card under it stays level with Free to Spend's in the rail (#73L).
													<Link
														to="/plan/$month"
														params={{ month }}
														hash={PLAN_BUCKETS_HASH}
														className="-me-1 inline-flex min-h-7 shrink-0 items-center gap-1.5 rounded-md px-1 text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring max-lg:min-h-11 [&_svg]:size-3.5"
													>
														<Pencil aria-hidden="true" />
														Edit Buckets
													</Link>
												) : undefined
											}
										/>
										<List>{buckets.map(bucketRow)}</List>
										{/* Under the list, not between the heading and the card, so the card's top is level
										    with Free to Spend's in the rail (#73L). */}
										<BarKey />
									</Section>
								) : null}
							</div>
							<div className="order-9 grid gap-3 empty:hidden lg:order-none">
								{allowances.length > 0 ? (
									<Section aria-labelledby="personal-allowances">
										<SectionHeader
											id="personal-allowances"
											title="Personal Allowances"
											count={allowances.length}
										/>
										<List>{allowances.map(bucketRow)}</List>
									</Section>
								) : null}
							</div>
						</div>
						{state.commitments.length > 0 ? (
							<div className="order-11 grid min-w-0 gap-3 lg:order-none">
								<Bills
									month={month}
									asOf={state.asOf}
									current={month === current}
									commitments={commitments}
									notDue={notDue}
								/>
							</div>
						) : null}
						{/* Income on a phone: after Bills, in reading order. From lg it is the rail's instead. */}
						{state.baseline !== null && (month === current || monthIncome.length > 0) ? (
							<div className="order-12 grid min-w-0 gap-3 lg:hidden">
								<MonthIncome
									month={month}
									asOf={state.asOf}
									baseline={state.baseline}
									income={monthIncome}
								/>
							</div>
						) : null}
					</SplitMain>
					<SplitRail>
						<div className="order-1 grid gap-3 lg:order-none">
							<FreeToSpend state={state} check={check} lower={lower} />
							<LumpCallout lumps={lumpsIn(state)} month={month} />
						</div>
						{/* Under Free to Spend at every size: on a phone a closed strip, from lg open in the
						    rail, so the prompts never push Buckets down. */}
						<WithClosePrevious month={month} asOf={state.asOf} hasGoal={activeGoals.length > 0}>
							{(closeStatus) => (
								<ToDo
									className="order-2 lg:order-none"
									items={present([
										closeStatus !== null && {
											label: `Close ${monthName(addMonths(month, -1))}`,
											status: closeStatus,
											help: <TermHelp term="month-close" />,
											content: (
												<ClosePreviousMonth
													month={addMonths(month, -1)}
													parentId={parentId}
													goals={activeGoals}
													emergencyGoalId={goals.emergencyGoalId}
												/>
											),
										},
										isCurrent &&
											(getStarted.some((step) => !step.done) || continueSetupShown(setupState)) && {
												label: "Get started",
												status: `${getStarted.filter((step) => step.done).length} of ${getStarted.length} done`,
												action: <ContinueSetup />,
												content: <GetStarted steps={getStarted} inToDo />,
											},
										isCurrent &&
											suggested.length > 0 && {
												label: "Apply suggested amounts",
												status: `${suggested.length} Bucket${suggested.length === 1 ? "" : "s"}`,
												action: <ApplySuggestedAmounts month={month} items={suggested} />,
												content: <SuggestedAmounts items={suggested} />,
											},
										isCurrent &&
											checkInDue && {
												label: "Check-in day",
												status: "Today’s the day to check in",
												content: <CheckInToday />,
											},
										state.windfallLeft > 0 &&
											month <= current && {
												label: "Extra income",
												status: `${formatMoney(state.windfallLeft)} in ${monthName(month)} to place`,
												help: <TermHelp term="extra-income" />,
												content: (
													<ExtraIncomeSection
														left={state.windfallLeft}
														monthName={monthName(month)}
														suggestions={suggestions}
														goals={activeGoals}
														onChoose={() => setChoosingExtraIncome(true)}
														onAddToFree={() =>
															extraIncomes.decide.mutate({
																moveId: ulid(),
																month,
																to: { kind: "free-to-spend" },
																toName: "Free to Spend",
																amountCents: state.windfallLeft,
															})
														}
														onSend={(s) =>
															extraIncomes.decide.mutate({
																moveId: ulid(),
																month,
																to: s.to,
																toName: s.name,
																amountCents: s.amount,
															})
														}
													/>
												),
											},
										isCurrent &&
											perkLine !== null && {
												label: "Perk to use",
												open: true,
												content: <PerkResetLine line={perkLine} />,
											},
										isCurrent &&
											chipsShow(chips) && {
												label: "To look at",
												open: true,
												content: <Chips month={month} counts={chips} />,
											},
									])}
								/>
							)}
						</WithClosePrevious>
						{/* From lg Income is last in the rail (#73). Below lg this one is hidden: the one after Bills
						    in the main column is shown, so a phone reads Income before Free to Spend. */}
						{state.baseline !== null && (month === current || monthIncome.length > 0) ? (
							<div className="hidden min-w-0 gap-3 lg:grid">
								<MonthIncome
									month={month}
									asOf={state.asOf}
									baseline={state.baseline}
									income={monthIncome}
								/>
							</div>
						) : null}
					</SplitRail>
				</SplitLayout>
			) : month === current ? (
				// Nothing planned yet: no rail to sit beside, so Get started has the page's width (#73).
				<PageLayout>
					<GetStarted steps={getStarted} />
				</PageLayout>
			) : (
				<EmptyState
					icon={<CalendarDays />}
					title="Nothing planned yet"
					description="Set your take-home pay and add Buckets to start this month’s Plan."
					action={
						<Button asChild>
							<Link to="/plan/$month" params={{ month }}>
								Set up the Plan
							</Link>
						</Button>
					}
				/>
			)}
			<CoverSheet
				state={{ ...state, buckets: state.buckets.filter((b) => canAssign(b, parentId)) }}
				bucket={over.find((b) => b.id === covering) ?? null}
				onOpenChange={(open) => {
					if (!open) setCovering(null);
				}}
				onCover={(source, amountCents) => {
					const bucket = over.find((b) => b.id === covering);
					setCovering(null);
					if (bucket) cover.mutate(coverVariables(bucket, source, amountCents));
				}}
			/>
			<ExtraIncomeSheet
				open={choosingExtraIncome}
				onOpenChange={setChoosingExtraIncome}
				left={state.windfallLeft}
				places={extraIncomePlaces}
				onSend={(to, toName, amountCents) => {
					setChoosingExtraIncome(false);
					extraIncomes.decide.mutate({ moveId: ulid(), month, to, toName, amountCents });
				}}
			/>
		</>
	);
}

/**
 * Chips above Free to Spend: "3 to review", when imported Transactions wait in Review, and in the
 * month's first week "2 Plan changes this month", linking to the Plan's What changed, "2 new
 * Insights" when the nightly look found some, and "4 things to check in the Plan" when Plan
 * health has warnings (shown in full only on the Plan). Nothing when none applies.
 */
/** The prompts that have something to say; the rest are `false`. */
const present = (items: (ToDoItem | false)[]) =>
	items.filter((item): item is ToDoItem => item !== false);

type ChipCounts = { waiting: number; changes: number; insights: number; health: number };

function useChipCounts(month: MonthKey, asOf: DayKey, current: boolean): ChipCounts {
	const waiting = useQuery(reviewQuery()).data?.total ?? 0;
	const firstWeek = current && Number(asOf.slice(8)) <= 7;
	const history = useQuery({ ...planHistoryQuery(month), enabled: firstWeek }).data;
	const changes = firstWeek && history ? whatChanged(history.changes, month).length : 0;
	const insights = useQuery(insightsQuery()).data?.filter((i) => i.status === "new").length ?? 0;
	const health = useQuery(planHealthQuery()).data?.warnings.length ?? 0;
	return { waiting, changes, insights, health };
}

const chipsShow = (c: ChipCounts) =>
	c.waiting > 0 || c.changes > 0 || c.insights > 0 || c.health > 0;

function Chips({ month, counts }: { month: MonthKey; counts: ChipCounts }) {
	const { waiting, changes, insights, health } = counts;
	if (!chipsShow(counts)) return null;
	return (
		// From lg the chips start on the To do card's 20px edge, under "To look at" (issue 73).
		<div className="flex flex-wrap gap-2 lg:px-1">
			{waiting > 0 ? (
				<Chip to="/review" icon={ListChecks}>
					{waiting} to review
				</Chip>
			) : null}
			{changes > 0 ? (
				<Chip to="/plan/$month" params={{ month }} hash="what-changed" icon={History}>
					{changes === 1 ? "1 Plan change" : `${changes} Plan changes`} this month
				</Chip>
			) : null}
			{insights > 0 ? (
				<Chip to="/insights" icon={Lightbulb}>
					{insights === 1 ? "1 new Insight" : `${insights} new Insights`}
				</Chip>
			) : null}
			{health > 0 ? (
				<Chip to="/plan/$month" params={{ month }} hash="plan-health" icon={HeartPulse}>
					{health === 1 ? "1 thing to check in the Plan" : `${health} things to check in the Plan`}
				</Chip>
			) : null}
		</div>
	);
}

function Chip({
	icon: Icon,
	children,
	...link
}: {
	icon: typeof History;
	children: ReactNode;
} & (
	| { to: "/review" | "/insights"; params?: undefined; hash?: undefined }
	| { to: "/plan/$month"; params: { month: MonthKey }; hash: string }
)) {
	return (
		<Link
			{...link}
			className={cn(
				"inline-flex w-fit items-center gap-2 rounded-full bg-card py-1.5 max-lg:min-h-11 ps-3 pe-2 text-sm font-medium shadow-card ring-1 ring-border",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2",
			)}
		>
			<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
			{children}
			<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
		</Link>
	);
}

/**
 * Whether the month before waits to be closed with something to decide. Only read in the
 * closing week, so the month before isn't loaded the rest of the time.
 */
function WithClosePrevious({
	month,
	asOf,
	hasGoal,
	children,
}: {
	month: MonthKey;
	asOf: DayKey;
	/** Whether there is an active Goal that Free to Spend left could be sent to. */
	hasGoal: boolean;
	children: (status: string | null) => ReactNode;
}) {
	return closingWeek(month, asOf) ? (
		<PreviousMonthOpen month={addMonths(month, -1)} hasGoal={hasGoal}>
			{children}
		</PreviousMonthOpen>
	) : (
		children(null)
	);
}

function PreviousMonthOpen({
	month,
	hasGoal,
	children,
}: {
	month: MonthKey;
	hasGoal: boolean;
	children: (status: string | null) => ReactNode;
}) {
	const state = useMonthState(month);
	const proposal = monthCloseProposal(state, useFreeCarry(month).leftToSend);
	return children(
		state.closed || nothingToDecide(proposal, hasGoal) ? null : closeStatus(proposal, hasGoal),
	);
}

/** The Close row's line from lg: "2 Buckets and Extra income to decide". */
function closeStatus(proposal: MonthCloseProposal, hasGoal: boolean) {
	const n = proposal.leftovers.length;
	const parts = [
		n > 0 && `${n} ${n === 1 ? "Bucket" : "Buckets"}`,
		hasGoal && (proposal.freeToSpend ?? 0) > 0 && "Free to Spend",
		proposal.windfall > 0 && "Extra income",
	].filter(Boolean);
	return `${new Intl.ListFormat("en", { type: "conjunction" }).format(parts as string[])} to decide`;
}

/** The month before, while it waits to be closed and has something to decide. */
function ClosePreviousMonth({
	month,
	parentId,
	goals,
	emergencyGoalId,
}: {
	month: MonthKey;
	parentId: string;
	goals: GoalView[];
	emergencyGoalId: string | null;
}) {
	const state = useMonthState(month);
	const close = useCloseMonth();
	const extraIncomes = useExtraIncomes();
	const proposal = monthCloseProposal(state, useFreeCarry(month).leftToSend);
	if (state.closed || nothingToDecide(proposal, goals.length > 0)) return null;
	return (
		<MonthCloseSection
			proposal={proposal}
			goals={goals}
			emergencyGoalId={emergencyGoalId}
			pending={close.isPending}
			onClose={(choice) => {
				// "Leave it in the account": the same Move as "Add to Free to Spend" on that month,
				// so the Extra income stops waiting for a decision. Nothing carries into this month.
				if (choice.leaveExtraIncome) {
					extraIncomes.decide.mutate({
						moveId: ulid(),
						month,
						to: { kind: "free-to-spend" },
						toName: "Free to Spend",
						amountCents: proposal.windfall,
					});
				}
				close.mutate({
					closeId: ulid(),
					month,
					parentId,
					sweeps: proposal.leftovers.flatMap((l) => {
						const goalId = choice.sweeps[l.bucketId];
						return goalId ? [{ bucketId: l.bucketId, goalId, amountCents: l.amount }] : [];
					}),
					windfall: choice.windfallGoalId
						? [{ moveId: ulid(), goalId: choice.windfallGoalId, amountCents: proposal.windfall }]
						: [],
					freeToSpend:
						choice.freeGoalId && proposal.freeToSpend
							? [{ goalId: choice.freeGoalId, amountCents: proposal.freeToSpend }]
							: [],
				});
			}}
		/>
	);
}

/**
 * Free to Spend, said plainly, with where the rest of the month stands beneath it, and a calm
 * word when income is tracking below what's usual by now.
 */
function FreeToSpend({
	state,
	check,
	lower,
}: {
	state: MonthState;
	check: IncomeCheck | null;
	lower: LowerTakeHomePay | null;
}) {
	const lowering = useLowerTakeHomePay(state.month);
	const overPlanned = state.freeToSpend < 0;
	// An ended month has no days left, and what wasn't planned is simply what it ended with.
	const ended = state.month < monthOfDay(state.asOf);
	// Free to Spend is carried over (issue 113): what the months before handed on, of either sign,
	// and what this month adds on its own, so the month still reads fresh.
	const carry = useFreeCarry(state.month);
	const ownFree = state.freeToSpend - state.freeCarriedIn;
	const lastMonth = monthName(addMonths(state.month, -1));
	return (
		<Section aria-labelledby="free-to-spend">
			<SectionHeader
				id="free-to-spend"
				title="Free to Spend"
				help={<TermHelp term="free-to-spend" />}
			/>
			<Card>
				<div className="grid gap-1 p-(--card-pad)">
					<p
						className={cn(
							"text-[2.75rem] font-[650] leading-[1.05] tracking-[-0.04em] tabular-nums",
							overPlanned && "text-over",
						)}
					>
						{formatMoney(state.freeToSpend)}
					</p>
					<p className="text-sm text-muted-foreground">
						{state.baseline === null ? (
							<>
								Set your take-home pay to see what’s free.{" "}
								<PlanLink month={state.month}>Set take-home pay</PlanLink>
							</>
						) : overPlanned && ownFree >= 0 ? (
							<>
								{lastMonth} ended {formatMoney(-state.freeCarriedIn)} short, more than the{" "}
								{formatMoney(ownFree)} {monthName(state.month)} adds.{" "}
								<PlanLink month={state.month}>Adjust the Plan</PlanLink>
							</>
						) : overPlanned ? (
							<>
								Your {state.committed > 0 ? "Commitments and Buckets" : "Buckets"} add up to{" "}
								{formatMoney(-ownFree)} more than your take-home pay.{" "}
								<PlanLink month={state.month}>Adjust the Plan</PlanLink>
							</>
						) : ended && carry.handedOn !== null ? (
							<span data-slot="free-handed-on">
								{carry.handedOn === 0
									? // Nothing to carry: "Ended with $0, carried over into October" read as a mistake (issue 73).
										`Ended with nothing left, so nothing was carried over into `
									: carry.handedOn < 0
										? `Ended ${formatMoney(-carry.handedOn)} short, carried over into `
										: `Ended with ${formatMoney(carry.handedOn)}, carried over into `}
								{monthName(addMonths(state.month, 1))}
							</span>
						) : ended ? (
							<>Left unplanned at the end of {monthName(state.month)}</>
						) : (
							(monthSentence(state) ?? (
								<>Not planned for anything yet · yours until {shortDay(lastDayOf(state.month))}</>
							))
						)}
					</p>
					{state.freeCarriedIn !== 0 ? (
						<p data-slot="free-carried-in" className="text-sm text-muted-foreground tabular-nums">
							{formatMoney(ownFree)} {ended ? `in ${monthName(state.month)}` : "this month"} ·{" "}
							{carriedOverText(state.freeCarriedIn, lastMonth)}
						</p>
					) : null}
					{carry.builtUp.length > 1 && state.freeCarriedIn !== 0 ? (
						<div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[13px] text-muted-foreground tabular-nums">
							{/* The list's name says the same to a screen reader. */}
							<span aria-hidden="true">Each month carried over:</span>
							<ul aria-label="What each month carried over into the next" className="contents">
								{carry.builtUp.map((m) => (
									<li key={m.month}>
										{monthName(m.month).slice(0, 3)}{" "}
										{m.amount < 0 ? `${formatMoney(-m.amount)} short` : formatMoney(m.amount)}
									</li>
								))}
							</ul>
						</div>
					) : null}
					{lower?.prompt ? (
						<LowerTakeHomePayNote
							className="mt-2 rounded-xl bg-surface-2 px-3 py-2.5"
							month={state.month}
							step={lower}
							freeToSpend={state.freeToSpend}
							pending={lowering.pending}
							onLower={() => lowering.lower(lower, state.freeToSpend)}
						/>
					) : check?.below ? (
						<p role="note" className="mt-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
							Income is {formatMoney(check.short)} behind where it usually is by now. Worth a look
							before planning more spending.
						</p>
					) : null}
				</div>
				{state.baseline === null ? null : <Breakdown state={state} baseline={state.baseline} />}
			</Card>
		</Section>
	);
}

/**
 * Where take-home pay goes, as one bar and its legend. The Sidebar's Plan has the waterfall, and
 * "Adjust the Plan" above shows when the Plan is over, so there is no second Plan link here (#73).
 */
function Breakdown({ state, baseline }: { state: MonthState; baseline: number }) {
	const id = useId();
	return (
		<div className="grid gap-2.5 border-t px-(--card-pad) py-3">
			<p id={id} className="text-[13px] text-balance text-muted-foreground tabular-nums">
				{breakdownLabel(baseline, state.extraToFreeToSpend, state.freeCarriedIn)}
			</p>
			<MonthGlance state={state} labelledBy={id} />
		</div>
	);
}

/** "Where $5,000 take-home pay goes", with Extra income and what was carried over, of either sign. */
function breakdownLabel(baseline: number, extra: number, carried: number) {
	const added = [
		...(extra > 0 ? [`${formatMoney(extra)} Extra income`] : []),
		...(carried > 0 ? [carriedOverText(carried)] : []),
	];
	const pay = `Where ${formatMoney(baseline)} take-home pay`;
	const whole =
		added.length === 0
			? `${pay} goes`
			: added.length === 1
				? `${pay} and ${added[0]} go`
				: `${pay}, ${added.join(" and ")} go`;
	// A shortfall carried over is taken off first: the parts then add up to the pay less it.
	return carried < 0 ? `${whole}, less ${carriedOverText(carried)}` : whole;
}

function PlanLink({ month, children }: { month: MonthState["month"]; children: string }) {
	return (
		<Link
			to="/plan/$month"
			params={{ month }}
			className="font-medium text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground"
		>
			{children}
		</Link>
	);
}

/**
 * A Bucket this month: its bar fills with what's spent out of Available, against the Today line
 * (its Pace). Its Covers and their Undo are on its own page (#87); "moved in" beneath the bar
 * says it had some.
 */
function BucketRow({
	bucket,
	onCover,
	explainCover = false,
	private: isPrivate = false,
}: {
	bucket: BucketState;
	/** Says what Cover does beside its button: only the first overspent row does. */
	explainCover?: boolean;
	/** Covers it, when it's overspent and the Parent may. */
	onCover?: () => void;
	/** The other Parent's Personal Allowance: its totals only (its page shows no more). */
	private?: boolean;
}) {
	const color = asBucketColor(bucket.color);
	const left = Math.max(0, bucket.left);
	const parts = availableParts(bucket);
	return (
		<ListRow
			aria-label={`${bucket.name}: ${formatMoney(left)} left of ${formatMoney(bucket.available)}${
				bucket.status === "over"
					? `, over by ${formatMoney(-bucket.left)}`
					: bucket.status === "ahead"
						? ", ahead of pace"
						: ""
			}${isPrivate ? ", private" : ""}`}
			// The whole row opens the Bucket (the link's ::after covers it); its buttons sit above.
			className={cn(
				"relative transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
				"has-focus-visible:outline-2 has-focus-visible:-outline-offset-2 has-focus-visible:outline-ring",
			)}
			leading={<Tile bucket={color}>{monogram(bucket.name)}</Tile>}
			title={
				<Link
					to="/plan/$month/buckets/$id"
					params={{ month: Route.useParams().month, id: bucket.id }}
					className="outline-none after:absolute after:inset-0"
				>
					{bucket.name}
				</Link>
			}
			// On a phone the name and the figure share the first line; the status is one word on the
			// meta line, beside the bar that already shows it in colour (#65).
			meta={
				<>
					{bucket.status === "over" ? (
						<Badge variant="over" dot>
							Over
						</Badge>
					) : bucket.status === "ahead" ? (
						<Badge variant="pace" dot>
							Ahead
						</Badge>
					) : null}
					{bucket.rolling ? <Badge>Carries over</Badge> : null}
					{/* On a phone "spent" always has its own line, so every row with a badge reads alike
					    (issue 110: at 320 px it fitted beside "Ahead" in some rows and wrapped in others). */}
					<span className="max-sm:basis-full">
						{formatMoney(bucket.spent)} spent{isPrivate ? " · Private" : ""}
					</span>
				</>
			}
			trailing={
				<span className="flex items-center gap-2">
					<span className="grid justify-items-end gap-0.5">
						{/* Over, the figure is how far over, in the over ink, not "$0 left". */}
						{bucket.left < 0 ? (
							<span className="text-sm font-semibold text-over-foreground tabular-nums">
								{formatMoney(-bucket.left)} over
							</span>
						) : (
							<span className="text-sm font-semibold tabular-nums">{formatMoney(left)}</span>
						)}
						{/* Below zero, "of −$1,035" says nothing: its parts beneath explain it instead. */}
						{bucket.available >= 0 ? (
							<span className="text-xs text-subtle-foreground tabular-nums">
								of {formatMoney(bucket.available)}
							</span>
						) : null}
						{/* On a phone Cover is a link under how far over it is, level with "spent", not a
						    button under the bar (issue 110). Beside the "Over" badge it wrapped in some rows. */}
						{onCover ? <CoverLink name={bucket.name} onCover={onCover} /> : null}
					</span>
					<ChevronRight
						aria-hidden="true"
						className="hidden size-4 text-subtle-foreground lg:block"
					/>
				</span>
			}
			below={
				<div className="grid gap-1.5">
					<BudgetBar
						bucket={color}
						value={bucket.spent}
						max={bucket.available}
						marker={1 - bucket.pace.leftShare}
						state={barState(bucket.status)}
						label={bucket.name}
						valueText={`${formatMoney(bucket.spent)} spent of ${formatMoney(bucket.available)}, ${
							bucket.left < 0
								? `over by ${formatMoney(-bucket.left)}`
								: `${formatMoney(bucket.left)} left`
						}`}
					/>
					{parts ? <p className="text-xs text-muted-foreground tabular-nums">{parts}</p> : null}
					{onCover ? (
						<div className="relative z-10 max-sm:hidden">
							<CoverButton name={bucket.name} onCover={onCover} explain={explainCover} />
						</div>
					) : null}
				</div>
			}
		/>
	);
}

/**
 * The bars' key beside the Pace "?": shown the first few views, then only inside the "?" popover
 * once it's been learned (#64, ADR-0018). On a phone it's always in the popover: inline it took
 * two lines above the first Bucket (#74).
 */
function BarKey() {
	const learned = useLearned("bar-key");
	// Under the list, without a "?" of its own: the Buckets heading's help says it too (#73L).
	if (learned) return null;
	return (
		<div className="-mt-1 flex items-center gap-1 px-1 max-lg:hidden">
			<BudgetBarKey />
		</div>
	);
}

/** In the Buckets heading's help: the bars' key and what Cover does, so neither needs a "?" of its own (#73L). */
function BucketsHelpExtra() {
	return (
		<div className="mt-1 grid gap-1.5">
			<BudgetBarKey className="grid gap-1.5" />
			<p className="text-muted-foreground">
				The line on a bar is today's Pace. An overspent Bucket has a Cover button: it brings the
				Bucket back to $0 from another Bucket or Free to Spend.
			</p>
		</div>
	);
}

/** Cover on a phone: a link under the row's figures, 44 px tall to the thumb. */
function CoverLink({ name, onCover }: { name: string; onCover: () => void }) {
	const hydrated = useHydrated();
	return (
		<Button
			type="button"
			variant="link"
			size="sm"
			className="relative z-10 -my-3 font-semibold text-foreground underline underline-offset-2 sm:hidden"
			disabled={!hydrated}
			aria-label={`Cover ${name}`}
			onClick={onCover}
		>
			Cover
		</Button>
	);
}

/** Cover on an overspent Bucket's row: brings it back to $0 from somewhere with money left. */
function CoverButton({
	name,
	onCover,
	explain,
}: {
	name: string;
	onCover: () => void;
	explain: boolean;
}) {
	const hydrated = useHydrated();
	return (
		<div className="flex flex-wrap items-center gap-x-2 gap-y-1">
			<Button
				type="button"
				variant="outline"
				size="sm"
				disabled={!hydrated}
				aria-label={`Cover ${name}`}
				onClick={onCover}
			>
				Cover
			</Button>
			{explain ? (
				<span className="flex items-center gap-1 text-xs text-muted-foreground">
					{/* On a phone the "?" says it (#65). */}
					{/* No "?" here: the Buckets heading's help says what Cover does (#73L). */}
					<span className="max-sm:hidden">
						Bring it back to $0 from another Bucket or Free to Spend.
					</span>
				</span>
			) : null}
		</div>
	);
}

/** On the Check-in day, until this Parent has done it: a card that starts this week's Check-in. */
function useCheckInDue() {
	const status = useQuery(checkInStatusQuery()).data;
	return Boolean(status?.today && !status.done);
}

function CheckInToday() {
	if (!useCheckInDue()) return null;
	return (
		<Card className="flex flex-wrap items-center justify-between gap-3 p-(--card-pad)">
			<div className="flex items-center gap-3">
				<Tile aria-hidden="true">
					<CalendarCheck />
				</Tile>
				<div className="grid gap-0.5">
					<h2 className="text-sm font-semibold">It’s Check-in day</h2>
					<p className="text-[13px] text-muted-foreground">
						A few minutes: confirm spending, look at suggestions, decide leftovers.
					</p>
				</div>
			</div>
			<Button asChild size="sm">
				<Link to="/check-in">Start the Check-in</Link>
			</Button>
		</Card>
	);
}

/**
 * Get started (#47): after Welcome, the steps to a working Plan, each ticked when done and linking
 * to where it's done. Gone once every step is.
 */
function useGetStartedSteps(state: MonthState) {
	const { accounts } = useGoals();
	const members = useSuspenseQuery(membersQuery()).data;
	const parents = members.filter((m) => m.kind === "parent" && !m.removed).length;
	const steps: { done: boolean; title: string; shown?: ReactNode; link: ReactNode }[] = [
		{
			done: state.baseline !== null,
			title: "Set your take-home pay",
			link: (
				<Link to="/plan/$month" params={{ month: state.month }}>
					Set up the Plan
				</Link>
			),
		},
		{
			done: state.buckets.length > 0,
			title: "Add Buckets for everyday spending",
			link: (
				<Link to="/plan/$month" params={{ month: state.month }} hash={PLAN_BUCKETS_HASH}>
					Add Buckets
				</Link>
			),
		},
		{
			done: accounts.length > 0,
			// Short, so it isn't cut off beside its button at 320px (#74); a bank is added there too.
			title: "Add your Accounts",
			// Shorter still to the eye at 320px, where it took two lines beside its button (issue 110):
			// "Add Accounts" and "Add", read out in full.
			shown: (
				<>
					Add <span className="max-[359px]:sr-only">your </span>Accounts
				</>
			),
			link: (
				<Link to="/accounts">
					{/* One piece of text: as two, the button's gap opened a hole after "Add" (issue 73). */}
					<span>
						Add<span className="max-[359px]:sr-only"> an Account</span>
					</span>
				</Link>
			),
		},
		{
			done: parents > 1,
			title: "Invite the other Parent",
			link: (
				<Link to="/household" hash="invite">
					Invite
				</Link>
			),
		},
	];
	return steps;
}

/** The way back into the get-started wizard (#53); nothing once it's finished. */
function ContinueSetup({ className }: { className?: string }) {
	const setup = useSuspenseQuery(setupQuery()).data;
	if (!continueSetupShown(setup)) return null;
	return (
		<Button asChild size="sm" className={className}>
			<Link to="/setup">Continue setup</Link>
		</Button>
	);
}

/** "Don’t ask again": This Month stops offering the wizard; Household's "Run setup again" still can (#72). */
function DismissSetup() {
	const queryClient = useQueryClient();
	const setup = useSuspenseQuery(setupQuery()).data;
	const dismiss = useMutation({
		mutationFn: () =>
			saveSetup({
				data: {
					step: setup.step,
					answers: { ...setup.answers, dismissed: true },
					skipped: setup.skipped,
				},
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: setupQuery().queryKey }),
	});
	return (
		<Button variant="ghost" size="sm" disabled={dismiss.isPending} onClick={() => dismiss.mutate()}>
			Don’t ask again
		</Button>
	);
}

function GetStarted({
	steps,
	inToDo = false,
}: {
	steps: ReturnType<typeof useGetStartedSteps>;
	/** In a To do row, which from lg already says "Get started" and how many are done. */
	inToDo?: boolean;
}) {
	const setup = useSuspenseQuery(setupQuery()).data;
	const left = steps.filter((step) => !step.done).length;
	const asked = continueSetupShown(setup);
	if (left === 0 && !asked) return null;
	const finish = !asked ? null : (
		// The get-started wizard (#53) is the main way in; the list below is for what it skipped.
		<Card className="flex flex-wrap items-center justify-between gap-3 p-(--card-pad) text-sm">
			<div className="grid gap-0.5">
				<p className="font-medium">Finish setting up</p>
				<p className="text-muted-foreground">
					You’re on step {setup.step} of {SETUP_STEP_COUNT}. It picks up where you left off.
				</p>
			</div>
			<div className="flex flex-wrap items-center gap-2">
				<DismissSetup />
				{/* In the To do strip, from lg its row has it, closed or open. On its own it is always
				    here: the one thing the card is for is never hidden (#73). */}
				<ContinueSetup className={cn(inToDo && "lg:hidden")} />
			</div>
		</Card>
	);
	const list = (
		<List
			aria-label="Steps to get started"
			// On its own on a wide screen the steps sit two by two inside their card, so a step's
			// button is near its words instead of a screen's width away (#73). Below xl, and in the
			// To do strip, it is the same one-column list as before.
			className={cn(
				!inToDo &&
					"xl:grid xl:grid-cols-2 xl:[&>li:nth-child(2)]:border-t-0 xl:[&>li:nth-child(even)]:border-s",
			)}
		>
			{steps.map((step) => (
				<ListRow
					key={step.title}
					aria-label={`${step.title}${step.done ? ", done" : ""}`}
					leading={
						<span
							aria-hidden="true"
							className={cn(
								"grid size-6 place-items-center rounded-full border text-xs",
								step.done
									? "border-transparent bg-foreground text-card"
									: "border-border-strong text-transparent",
							)}
						>
							<Check className="size-3.5" strokeWidth={2.5} />
						</span>
					}
					title={
						<span className={cn(step.done && "text-muted-foreground line-through")}>
							{step.shown ?? step.title}
						</span>
					}
					trailing={
						step.done ? null : (
							<Button asChild variant="outline" size="sm">
								{step.link}
							</Button>
						)
					}
				/>
			))}
		</List>
	);
	return (
		<Section aria-labelledby="get-started">
			<div className={cn(inToDo && "lg:sr-only")}>
				<SectionHeader
					id="get-started"
					title="Get started"
					action={
						<span className="text-[13px] text-muted-foreground tabular-nums">
							{steps.length - left} of {steps.length} done
						</span>
					}
				/>
			</div>
			{inToDo ? (
				<>
					{finish}
					{list}
				</>
			) : (
				// On its own, the card and then the steps each take the page's width, as the sections of
				// a planned month do (#73).
				<div className="grid min-w-0 gap-3">
					{finish}
					{list}
				</div>
			)}
		</Section>
	);
}

/** "Apply suggested amounts" (#72): every starter Bucket's suggested amount, as one Plan change. */
function ApplySuggestedAmounts({ month, items }: { month: string; items: SuggestedAmount[] }) {
	const queryClient = useQueryClient();
	const apply = useMutation({
		mutationFn: () =>
			applySuggestedAmounts({
				data: {
					month,
					items: items.map((item) => ({ bucketId: item.bucketId, amountCents: item.toCents })),
				},
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: monthsKey }),
	});
	return (
		<Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate()}>
			Apply all
		</Button>
	);
}

/** What applying changes, and "Not now" to stop offering it; a Bucket changed by hand isn't listed. */
function SuggestedAmounts({ items }: { items: SuggestedAmount[] }) {
	const queryClient = useQueryClient();
	const setup = useSuspenseQuery(setupQuery()).data;
	const dismiss = useMutation({
		mutationFn: () =>
			saveSetup({
				data: {
					step: setup.step,
					answers: { ...setup.answers, amountsDismissed: true },
					skipped: setup.skipped,
					...(setup.finished ? { finished: true } : {}),
				},
			}),
		onSuccess: () => queryClient.invalidateQueries({ queryKey: setupQuery().queryKey }),
	});
	return (
		<Card className="grid gap-3 p-(--card-pad) text-sm">
			<p className="text-muted-foreground">
				Setup’s starter Buckets, scaled to your take-home pay. Buckets you’ve changed stay as they
				are.
			</p>
			<List>
				{items.map((item) => (
					<ListRow
						key={item.bucketId}
						title={item.name}
						trailing={
							<span className="tabular-nums">
								{formatMoney(item.fromCents)} → {formatMoney(item.toCents)}
							</span>
						}
					/>
				))}
			</List>
			<div>
				<Button
					variant="ghost"
					size="sm"
					disabled={dismiss.isPending}
					onClick={() => dismiss.mutate()}
				>
					Not now
				</Button>
			</div>
		</Card>
	);
}
