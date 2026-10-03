import {
	addMonths,
	type BucketState,
	type CoverSource,
	canAssign,
	type DayKey,
	extraIncomeSuggestions,
	type IncomeCheck,
	incomeCheck,
	lastDayOf,
	lumpsIn,
	type MonthCloseProposal,
	type MonthKey,
	type MonthState,
	monthCloseProposal,
	monthEnd,
	monthOfDay,
	nothingToClose,
	whatChanged,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { BudgetBar, BudgetBarKey } from "@noodle/ui/components/budget-bar";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
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
} from "lucide-react";
import { type ReactNode, useId, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, availableParts, barState, monogram } from "../../../buckets";
import { Bills } from "../../../components/bills";
import { LumpCallout } from "../../../components/coming-up";
import { CoverSheet, CoversInto, sourceName } from "../../../components/cover";
import {
	ExtraIncomeSection,
	ExtraIncomeSheet,
	MonthIncome,
} from "../../../components/extra-income";
import { MonthCloseSection, MonthEndSection } from "../../../components/month-close";
import { MonthGlance, monthSentence } from "../../../components/month-glance";
import { TermHelp } from "../../../components/term-help";
import { ToDo, type ToDoItem } from "../../../components/to-do";
import { type CoverVariables, useCovers } from "../../../covers";
import { useExtraIncomes } from "../../../extra-income";
import { formatMoney, monthName, shortDay } from "../../../format";
import { type GoalView, useGoals } from "../../../goals";
import { useLearned } from "../../../learned";
import { closingWeek, useCloseMonth } from "../../../month-close";
import {
	checkInStatusQuery,
	commitmentsQuery,
	insightsQuery,
	membersQuery,
	planHealthQuery,
	planHistoryQuery,
	reviewQuery,
	setupQuery,
	useMonthState,
} from "../../../queries";
import { saveSetup } from "../../../server/setup";
import { continueSetupShown, SETUP_STEP_COUNT } from "../../../setup";

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
	const { cover, undo } = useCovers();
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
		const covers = state.moves.filter((m) => m.toBucketId === bucket.id);
		return (
			<BucketRow
				key={bucket.id}
				bucket={bucket}
				onCover={over.includes(bucket) ? () => setCovering(bucket.id) : undefined}
				explainCover={bucket === firstOver}
				// Only the other Parent's Personal Allowance is private; its totals are all there is.
				private={!mine}
				covers={
					covers.length > 0 ? (
						<CoversInto
							moves={covers}
							buckets={state.buckets}
							onUndo={
								canCover && mine
									? (move, fromName) =>
											undo.mutate({
												moveId: move.id,
												month,
												fromName,
												toName: bucket.name,
											})
									: undefined
							}
						/>
					) : null
				}
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
	// What the To do strip holds is decided here, from the same data each prompt reads.
	const getStarted = useGetStartedSteps(state);
	const setupState = useSuspenseQuery(setupQuery()).data;
	const checkInDue = useCheckInDue();
	const chips = useChipCounts(month, state.asOf, isCurrent);
	const monthIncome = state.income.filter((i) => monthOfDay(i.date) === month);
	const check = incomeCheck({
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
					{/* From 1920px wide two columns, each its own stack so a short Bills doesn't leave a gap
					    under it: Buckets and Personal Allowances left, Bills and Income right. Below that the
					    column wrappers are `contents`, so `order` still interleaves on phones. */}
					<SplitMain className="min-[1920px]:grid-cols-2 min-[1920px]:items-start">
						<div className="order-6 grid gap-3 empty:hidden lg:order-none min-[1920px]:col-span-full">
							{month < current ? (
								<MonthEndSection
									month={month}
									end={monthEnd(state, state)}
									closed={state.closed}
									parentId={parentId}
									goals={goals.goals}
									members={members}
								/>
							) : null}
						</div>
						<div className="contents min-[1920px]:grid min-[1920px]:min-w-0 min-[1920px]:content-start min-[1920px]:gap-(--layout-gap)">
							<div className="order-8 grid gap-3 empty:hidden lg:order-none">
								{buckets.length > 0 ? (
									<Section aria-labelledby="buckets">
										<SectionHeader
											id="buckets"
											title="Buckets"
											count={buckets.length}
											help={<TermHelp term="bucket" />}
										/>
										<BarKey />
										<List>{buckets.map(bucketRow)}</List>
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
						<div className="contents min-[1920px]:grid min-[1920px]:min-w-0 min-[1920px]:content-start min-[1920px]:gap-(--layout-gap)">
							<div className="order-11 grid gap-3 empty:hidden lg:order-none">
								{state.commitments.length > 0 ? (
									<Bills
										month={month}
										asOf={state.asOf}
										current={month === current}
										commitments={commitments}
										notDue={notDue}
									/>
								) : null}
							</div>
							<div className="order-12 grid gap-3 empty:hidden lg:order-none">
								{state.baseline !== null && (month === current || monthIncome.length > 0) ? (
									<MonthIncome
										month={month}
										asOf={state.asOf}
										baseline={state.baseline}
										income={monthIncome}
									/>
								) : null}
							</div>
						</div>
					</SplitMain>
					<SplitRail>
						<div className="order-1 grid gap-3 lg:order-none">
							<FreeToSpend state={state} check={check} />
							<LumpCallout lumps={lumpsIn(state)} month={month} />
						</div>
						{/* Under Free to Spend at every size: on a phone a closed strip, from lg open in the
						    rail, so the prompts never push Buckets down. */}
						<WithClosePrevious month={month} asOf={state.asOf}>
							{(closeStatus) => (
								<ToDo
									className="order-2 lg:order-none"
									items={present([
										closeStatus !== null && {
											label: `Close ${monthName(addMonths(month, -1))}`,
											status: closeStatus,
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
												content: <GetStarted steps={getStarted} />,
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
												content: (
													<ExtraIncomeSection
														left={state.windfallLeft}
														monthName={monthName(month)}
														suggestions={suggestions}
														goals={activeGoals}
														onChoose={() => setChoosingExtraIncome(true)}
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
											chipsShow(chips) && {
												label: "To look at",
												open: true,
												content: <Chips month={month} counts={chips} />,
											},
									])}
								/>
							)}
						</WithClosePrevious>
					</SplitRail>
				</SplitLayout>
			) : month === current ? (
				<SplitLayout>
					<SplitMain>
						<GetStarted steps={getStarted} />
					</SplitMain>
				</SplitLayout>
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
		<div className="flex flex-wrap gap-2">
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
	children,
}: {
	month: MonthKey;
	asOf: DayKey;
	children: (status: string | null) => ReactNode;
}) {
	return closingWeek(month, asOf) ? (
		<PreviousMonthOpen month={addMonths(month, -1)}>{children}</PreviousMonthOpen>
	) : (
		children(null)
	);
}

function PreviousMonthOpen({
	month,
	children,
}: {
	month: MonthKey;
	children: (status: string | null) => ReactNode;
}) {
	const state = useMonthState(month);
	const proposal = monthCloseProposal(state);
	return children(state.closed || nothingToClose(proposal) ? null : closeStatus(proposal));
}

/** The Close row's line from lg: "2 Buckets and Extra income to decide". */
function closeStatus(proposal: MonthCloseProposal) {
	const n = proposal.leftovers.length;
	const parts = [
		n > 0 && `${n} ${n === 1 ? "Bucket" : "Buckets"}`,
		proposal.windfall > 0 && "Extra income",
	].filter(Boolean);
	return `${parts.join(" and ")} to decide`;
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
	const proposal = monthCloseProposal(state);
	if (state.closed || nothingToClose(proposal)) return null;
	return (
		<MonthCloseSection
			proposal={proposal}
			goals={goals}
			emergencyGoalId={emergencyGoalId}
			pending={close.isPending}
			onClose={(choice) =>
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
				})
			}
		/>
	);
}

/**
 * Free to Spend, said plainly, with where the rest of the month stands beneath it, and a calm
 * word when income is tracking below what's usual by now.
 */
function FreeToSpend({ state, check }: { state: MonthState; check: IncomeCheck | null }) {
	const overPlanned = state.freeToSpend < 0;
	// An ended month has no days left, and what wasn't planned is simply what it ended with.
	const ended = state.month < monthOfDay(state.asOf);
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
						) : overPlanned ? (
							<>
								Your {state.committed > 0 ? "Commitments and Buckets" : "Buckets"} add up to{" "}
								{formatMoney(-state.freeToSpend)} more than your take-home pay.{" "}
								<PlanLink month={state.month}>Adjust the Plan</PlanLink>
							</>
						) : ended ? (
							<>Left unplanned at the end of {monthName(state.month)}</>
						) : (
							(monthSentence(state) ?? (
								<>Not planned for anything yet · yours until {shortDay(lastDayOf(state.month))}</>
							))
						)}
					</p>
					{check?.below ? (
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
 * Free to Spend worked out as a short list, take-home pay then "− $2,100 Commitments" and each
 * other part that takes something; it opens the Plan's waterfall.
 */
function Breakdown({ state, baseline }: { state: MonthState; baseline: number }) {
	const id = useId();
	return (
		<div className="grid gap-2.5 border-t px-(--card-pad) py-3">
			<p className="flex justify-between gap-3 text-[13px] text-muted-foreground tabular-nums">
				<span id={id}>Where {formatMoney(baseline)} take-home pay goes</span>
				<Link
					to="/plan/$month"
					params={{ month: state.month }}
					hash="plan-waterfall"
					className="inline-flex shrink-0 items-center font-medium text-foreground underline decoration-border-strong underline-offset-3 hover:decoration-foreground"
				>
					Plan
					<ChevronRight aria-hidden="true" className="size-3.5" />
				</Link>
			</p>
			<MonthGlance state={state} labelledBy={id} />
		</div>
	);
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
 * (its Pace). `covers` lists Covers into it.
 */
function BucketRow({
	bucket,
	covers,
	onCover,
	explainCover = false,
	private: isPrivate = false,
}: {
	bucket: BucketState;
	covers?: ReactNode;
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
					<span>
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
					{covers ? <div className="relative z-10">{covers}</div> : null}
					{onCover ? (
						<div className="relative z-10">
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
 * once it's been learned (#64, ADR-0018).
 */
function BarKey() {
	const learned = useLearned("bar-key");
	return (
		<div className="-mt-1 flex items-center gap-1 px-1">
			{learned ? null : <BudgetBarKey />}
			<TermHelp
				term="pace"
				extra={learned ? <BudgetBarKey className="mt-1 grid gap-1.5" /> : undefined}
			/>
		</div>
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
					<span className="max-sm:hidden">
						Bring it back to $0 from another Bucket or Free to Spend.
					</span>
					<TermHelp term="cover" />
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
	const steps: { done: boolean; title: string; link: ReactNode }[] = [
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
				<Link to="/plan/$month/buckets" params={{ month: state.month }}>
					Add Buckets
				</Link>
			),
		},
		{
			done: accounts.length > 0,
			title: "Add an Account or a bank",
			link: <Link to="/accounts">Add an Account</Link>,
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

function GetStarted({ steps }: { steps: ReturnType<typeof useGetStartedSteps> }) {
	const setup = useSuspenseQuery(setupQuery()).data;
	const left = steps.filter((step) => !step.done).length;
	const asked = continueSetupShown(setup);
	if (left === 0 && !asked) return null;
	return (
		<Section aria-labelledby="get-started">
			<SectionHeader
				id="get-started"
				title="Get started"
				action={
					<span className="text-[13px] text-muted-foreground tabular-nums">
						{steps.length - left} of {steps.length} done
					</span>
				}
			/>
			{!asked ? null : (
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
						{/* From lg the To do row has it, closed or open. */}
						<ContinueSetup className="lg:hidden" />
					</div>
				</Card>
			)}
			<List aria-label="Steps to get started">
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
								{step.title}
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
		</Section>
	);
}
