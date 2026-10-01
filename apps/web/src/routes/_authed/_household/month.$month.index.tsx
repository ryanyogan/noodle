import {
	addMonths,
	allowancesByKind,
	type BucketState,
	type CoverSource,
	canAssign,
	type DayKey,
	freeToSpendParts,
	type IncomeCheck,
	incomeCheck,
	lastDayOf,
	lumpsIn,
	type MonthKey,
	type MonthState,
	monthCloseProposal,
	monthEnd,
	monthOfDay,
	nothingToClose,
	whatChanged,
	windfallSuggestions,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List, ListRow } from "@noodle/ui/components/list";
import { Meter } from "@noodle/ui/components/meter";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarDays, ChevronRight, History, Lightbulb, ListChecks } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, availableParts, monogram } from "../../../buckets";
import { ComingUp, LumpCallout } from "../../../components/coming-up";
import { Commitments } from "../../../components/commitment-list";
import { ALittleOver, CoverSheet, CoversInto, sourceName } from "../../../components/cover";
import {
	ExtraIncomeSection,
	ExtraIncomeSheet,
	IncomeSection,
} from "../../../components/extra-income";
import { AmountSheet } from "../../../components/goals";
import { MonthCloseSection, MonthEndSection } from "../../../components/month-close";
import { MonthLinks, MonthTopRow, monthTitle, useMonthSwipe } from "../../../components/month-nav";
import { GoalsThisMonth } from "../../../components/plan-goals";
import { planParts } from "../../../components/plan-page";
import { type CoverVariables, useCovers } from "../../../covers";
import { useExtraIncomes, useIncome } from "../../../extra-income";
import { formatMoney, shortDay } from "../../../format";
import { type GoalView, useGoals } from "../../../goals";
import { closingWeek, useCloseMonth } from "../../../month-close";
import {
	commitmentsQuery,
	insightsQuery,
	membersQuery,
	planHistoryQuery,
	reviewQuery,
	useMonthState,
} from "../../../queries";

export const Route = createFileRoute("/_authed/_household/month/$month/")({
	// Coming up reads every Commitment's schedule and charges; an ended month names who closed it.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(commitmentsQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
		]),
	component: ThisMonth,
});

function ThisMonth() {
	const { month, parentId } = Route.useRouteContext();
	const state = useMonthState(month);
	const { cover, undo } = useCovers();
	// The overspent Bucket being covered, by ID, so the sheet follows its latest state.
	const [covering, setCovering] = useState<string | null>(null);
	const [addingIncome, setAddingIncome] = useState(false);
	const [choosingExtraIncome, setChoosingExtraIncome] = useState(false);
	const income = useIncome();
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
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const allowances = state.buckets.filter((b) => b.owner !== undefined);
	const bucketRow = (bucket: BucketState) => {
		const mine = canAssign(bucket, parentId);
		const covers = state.moves.filter((m) => m.toBucketId === bucket.id);
		return (
			<BucketRow
				key={bucket.id}
				bucket={bucket}
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
	const swipe = useMonthSwipe("/month/$month", month, state.firstMonth);
	const monthIncome = state.income.filter((i) => monthOfDay(i.date) === month);
	const check = incomeCheck({
		baseline: state.baseline,
		income: state.income,
		month,
		asOf: state.asOf,
	});
	const activeGoals = goals.goals.filter((g) => g.state === "active");
	// This month's Windfall can go to its Buckets too; an ended month's only to Goals.
	const extraIncomePlaces = {
		goals: activeGoals,
		buckets: month === current ? state.buckets.filter((b) => canAssign(b, parentId)) : [],
	};
	const suggestions = windfallSuggestions({
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
		<div {...swipe}>
			<MonthTopRow month={month} current="month" />
			<PageHeader
				className="max-w-2xl"
				eyebrow={month === current ? "This Month" : "Month"}
				title={monthTitle(month, current)}
				actions={<MonthLinks to="/month/$month" month={month} first={state.firstMonth} />}
			/>
			{planned ? (
				<div className="grid max-w-2xl gap-8">
					{closingWeek(month, state.asOf) ? (
						<ClosePreviousMonth
							month={addMonths(month, -1)}
							parentId={parentId}
							goals={activeGoals}
							emergencyGoalId={goals.emergencyGoalId}
						/>
					) : null}
					{month === current ? <Chips month={month} asOf={state.asOf} /> : null}
					<div className="grid gap-3">
						<FreeToSpend state={state} check={check} />
						<LumpCallout lumps={lumpsIn(state)} month={month} />
					</div>
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
					{state.windfallLeft > 0 && month <= current ? (
						<ExtraIncomeSection
							left={state.windfallLeft}
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
					) : null}
					{over.length > 0 ? (
						<ALittleOver buckets={over} onCover={(bucket) => setCovering(bucket.id)} />
					) : null}
					{buckets.length > 0 ? (
						<Section aria-labelledby="buckets">
							<SectionHeader id="buckets" title="Buckets" count={buckets.length} />
							<List>{buckets.map(bucketRow)}</List>
						</Section>
					) : null}
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
					{month === current && activeGoals.length > 0 ? (
						<GoalsThisMonth month={month} goals={activeGoals} funded={state.fundedGoals} />
					) : null}
					{month === current ? <ComingUp /> : null}
					{state.commitments.length > 0 ? (
						<Commitments
							month={month}
							asOf={state.asOf}
							commitments={commitments}
							notDue={notDue}
						/>
					) : null}
					{state.baseline !== null && (month === current || monthIncome.length > 0) ? (
						<IncomeSection
							baseline={state.baseline}
							income={monthIncome}
							canRecord={month === current}
							onAdd={() => setAddingIncome(true)}
							onRemove={(entry) =>
								income.remove.mutate({
									incomeId: entry.id,
									month,
									date: entry.date,
									amountCents: entry.amount,
									note: entry.note,
								})
							}
						/>
					) : null}
				</div>
			) : (
				<EmptyState
					icon={<CalendarDays />}
					title="Nothing planned yet"
					description="Set your Baseline and add Buckets to start this month’s Plan."
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
			<AmountSheet
				open={addingIncome}
				onOpenChange={setAddingIncome}
				title="Add income"
				description="Money in today: a paycheck, a bonus, a tax refund. A Refund of a purchase goes back to its Bucket instead."
				withNote
				notePlaceholder="e.g. Paycheck"
				submitLabel="Add income"
				check={() => ({
					hint: "Whatever comes in beyond the Baseline is a Windfall to decide on.",
				})}
				onSave={(amountCents, note) => {
					setAddingIncome(false);
					income.record.mutate({
						incomeId: ulid(),
						month,
						date: state.asOf,
						amountCents,
						note,
					});
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
		</div>
	);
}

/**
 * Chips above Free to Spend: "3 to review", when imported Transactions wait in Review, and in the
 * month's first week "2 Plan changes this month", linking to the Plan's What changed, and
 * "2 new Insights" when the nightly look found some. Nothing when none applies.
 */
function Chips({ month, asOf }: { month: MonthKey; asOf: DayKey }) {
	const waiting = useQuery(reviewQuery()).data?.total ?? 0;
	const firstWeek = Number(asOf.slice(8)) <= 7;
	const history = useQuery({ ...planHistoryQuery(month), enabled: firstWeek }).data;
	const changes = firstWeek && history ? whatChanged(history.changes, month).length : 0;
	const insights = useQuery(insightsQuery()).data?.filter((i) => i.status === "new").length ?? 0;
	if (waiting === 0 && changes === 0 && insights === 0) return null;
	return (
		<div className="-mb-3 flex flex-wrap gap-2">
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
				"inline-flex w-fit items-center gap-2 rounded-full bg-card py-1.5 ps-3 pe-2 text-sm font-medium shadow-card ring-1 ring-border",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2",
			)}
		>
			<Icon className="size-4 text-muted-foreground" aria-hidden="true" />
			{children}
			<ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
		</Link>
	);
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
	// "In Buckets" counts Personal Allowances, which the breakdown above lists on their own.
	const { personalAllowances } = allowancesByKind(state);
	return (
		<Card role="region" aria-labelledby="free-to-spend">
			<div className="grid gap-1 p-(--card-pad)">
				<h2 id="free-to-spend" className="text-[13px] font-medium text-muted-foreground">
					Free to Spend
				</h2>
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
							Set your Baseline to see what’s free.{" "}
							<PlanLink month={state.month}>Set Baseline</PlanLink>
						</>
					) : overPlanned ? (
						<>
							Your {state.committed > 0 ? "Commitments and Buckets" : "Buckets"} add up to{" "}
							{formatMoney(-state.freeToSpend)} more than your Baseline.{" "}
							<PlanLink month={state.month}>Adjust the Plan</PlanLink>
						</>
					) : (
						<>Not planned for anything yet · yours until {shortDay(lastDayOf(state.month))}</>
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
			<dl className="grid grid-cols-3 border-t">
				<Stat
					label="In Buckets"
					value={formatMoney(state.planned)}
					note={
						personalAllowances === null
							? undefined
							: `incl. ${formatMoney(personalAllowances)} Personal Allowances`
					}
				/>
				<Stat label="Left in Buckets" value={formatMoney(state.leftInBuckets)} />
				<Stat label="Days left" value={String(state.daysLeft)} />
			</dl>
		</Card>
	);
}

/**
 * Free to Spend worked out in one line, "$6,000 Baseline − $2,100 Commitments − …", each part
 * that takes something; it opens the Plan's waterfall.
 */
function Breakdown({ state, baseline }: { state: MonthState; baseline: number }) {
	const parts = freeToSpendParts(state).filter((p) => p.amount > 0);
	const term = (amount: string, label: string) => (
		<>
			<span className="font-medium text-foreground">{amount}</span> {label}
		</>
	);
	return (
		<Link
			to="/plan/$month"
			params={{ month: state.month }}
			hash="plan-waterfall"
			className={cn(
				"flex items-center justify-between gap-3 border-t px-(--card-pad) py-3 text-[13px] text-muted-foreground",
				"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
			)}
		>
			<span className="flex flex-wrap gap-x-1.5 gap-y-0.5 tabular-nums">
				<span className="whitespace-nowrap">{term(formatMoney(baseline), "Baseline")}</span>
				{parts.map(({ part, amount }) => (
					<span key={part} className="whitespace-nowrap">
						<span aria-hidden="true">− </span>
						<span className="sr-only">minus </span>
						{term(formatMoney(amount), planParts[part].label)}
					</span>
				))}
			</span>
			<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
		</Link>
	);
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
	return (
		<div className="grid content-start gap-0.5 px-(--card-pad) py-3.5 [&+&]:border-s">
			<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
			<dd className="text-base font-semibold tracking-[-0.01em] tabular-nums">{value}</dd>
			{note ? <dd className="text-xs text-muted-foreground tabular-nums">{note}</dd> : null}
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
 * A Bucket's vessel: what's left of what it has this month, draining as money is spent, against
 * its Pace tick. `covers` lists Covers into it.
 */
function BucketRow({
	bucket,
	covers,
	private: isPrivate = false,
}: {
	bucket: BucketState;
	covers?: ReactNode;
	/** The other Parent's Personal Allowance: its totals only (its page shows no more). */
	private?: boolean;
}) {
	const color = asBucketColor(bucket.color);
	const share = (cents: number) => (bucket.available > 0 ? cents / bucket.available : 0);
	const left = Math.max(0, bucket.left);
	const parts = availableParts(bucket);
	return (
		<ListRow
			aria-label={`${bucket.name}: ${formatMoney(left)} left of ${formatMoney(bucket.available)}${
				bucket.status === "over"
					? `, over by ${formatMoney(-bucket.left)}`
					: bucket.status === "ahead"
						? ", ahead of Pace"
						: ""
			}${isPrivate ? ", private" : ""}`}
			leading={<Tile bucket={color}>{monogram(bucket.name)}</Tile>}
			title={
				<Link to="/plan/buckets/$id" params={{ id: bucket.id }} className="hover:underline">
					{bucket.name}
				</Link>
			}
			badge={
				bucket.status === "over" ? (
					<Badge variant="over" dot>
						Over by {formatMoney(-bucket.left)}
					</Badge>
				) : bucket.status === "ahead" ? (
					<Badge variant="pace" dot>
						Ahead of Pace
					</Badge>
				) : null
			}
			meta={
				<>
					<Badge>{bucket.rolling ? "Rolling" : "Fresh-start"}</Badge>
					<span>
						{formatMoney(bucket.spent)} spent{isPrivate ? " · Private" : ""}
					</span>
				</>
			}
			trailing={
				<>
					<span className="text-sm font-semibold tabular-nums">{formatMoney(left)}</span>
					<span className="text-xs text-subtle-foreground tabular-nums">
						of {formatMoney(bucket.available)}
					</span>
				</>
			}
			below={
				<div className="grid gap-1.5">
					<Meter
						bucket={color}
						left={share(bucket.left)}
						paceLeft={bucket.pace.leftShare}
						over={bucket.status === "over"}
					/>
					{parts ? <p className="text-xs text-muted-foreground tabular-nums">{parts}</p> : null}
					{covers}
				</div>
			}
		/>
	);
}
