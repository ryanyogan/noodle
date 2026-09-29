import {
	addMonths,
	type BucketState,
	type CoverSource,
	canAssign,
	type IncomeCheck,
	incomeCheck,
	lastDayOf,
	type MonthKey,
	type MonthState,
	monthCloseProposal,
	monthOfDay,
	nothingToClose,
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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	MessageCircleQuestionMark,
	SlidersHorizontal,
} from "lucide-react";
import { type ReactNode, type TouchEvent, useRef, useState } from "react";
import { ulid } from "ulid";
import { asBucketColor, monogram } from "../../../buckets";
import { Commitments } from "../../../components/commitment-list";
import { ALittleOver, CoverSheet, CoversInto, sourceName } from "../../../components/cover";
import { AmountSheet } from "../../../components/goals";
import { MonthCloseSection } from "../../../components/month-close";
import { IncomeSection, WindfallSection, WindfallSheet } from "../../../components/windfalls";
import { type CoverVariables, useCovers } from "../../../covers";
import { formatMoney, monthName, shortDay } from "../../../format";
import { type GoalView, useGoals } from "../../../goals";
import { closingWeek, useCloseMonth } from "../../../month-close";
import { useMonthState } from "../../../queries";
import { useIncome, useWindfalls } from "../../../windfalls";

export const Route = createFileRoute("/_authed/_household/month/$month/")({
	component: ThisMonth,
});

function ThisMonth() {
	const { month, parentId } = Route.useRouteContext();
	const state = useMonthState(month);
	const { cover, undo } = useCovers();
	// The overspent Bucket being covered, by ID, so the sheet follows its latest state.
	const [covering, setCovering] = useState<string | null>(null);
	const [addingIncome, setAddingIncome] = useState(false);
	const [choosingWindfall, setChoosingWindfall] = useState(false);
	const income = useIncome();
	const windfalls = useWindfalls();
	const goals = useGoals();
	const planned =
		state.baseline !== null || state.buckets.length > 0 || state.commitments.length > 0;
	// Commitments due this month, or paid anyway.
	const commitments = state.commitments.filter((c) => c.status !== "not-due");
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
				month={month}
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
	const swipe = useMonthSwipe(month);
	const monthIncome = state.income.filter((i) => monthOfDay(i.date) === month);
	const check = incomeCheck({
		baseline: state.baseline,
		income: state.income,
		month,
		asOf: state.asOf,
	});
	const activeGoals = goals.goals.filter((g) => g.state === "active");
	// This month's Windfall can go to its Buckets too; an ended month's only to Goals.
	const windfallPlaces = {
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
		buckets: windfallPlaces.buckets,
	});
	return (
		<div {...swipe}>
			<PageHeader
				className="max-w-2xl"
				eyebrow={month === current ? "This Month" : "Month"}
				title={
					month.slice(0, 4) === current.slice(0, 4)
						? monthName(month)
						: `${monthName(month)} ${month.slice(0, 4)}`
				}
				actions={
					<div className="flex items-center gap-1">
						{planned ? (
							<Button variant="outline" size="sm" className="me-2" asChild>
								<Link to="/month/$month/plan" params={{ month }}>
									<SlidersHorizontal />
									Edit Plan
								</Link>
							</Button>
						) : null}
						{/* Phones reach Ask from here; the sidebar has it on larger screens. */}
						<Button variant="ghost" size="icon" className="lg:hidden" asChild>
							<Link to="/ask" aria-label="Ask">
								<MessageCircleQuestionMark className="size-5" />
							</Link>
						</Button>
						<MonthLink month={addMonths(month, -1)} label="Previous month" />
						<MonthLink month={addMonths(month, 1)} label="Next month" />
					</div>
				}
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
					<FreeToSpend state={state} check={check} />
					{state.windfallLeft > 0 && month <= current ? (
						<WindfallSection
							left={state.windfallLeft}
							suggestions={suggestions}
							goals={activeGoals}
							onChoose={() => setChoosingWindfall(true)}
							onSend={(s) =>
								windfalls.decide.mutate({
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
					{commitments.length > 0 ? (
						<Commitments month={month} asOf={state.asOf} commitments={commitments} />
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
							<Link to="/month/$month/plan" params={{ month }}>
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
			<WindfallSheet
				open={choosingWindfall}
				onOpenChange={setChoosingWindfall}
				left={state.windfallLeft}
				places={windfallPlaces}
				onSend={(to, toName, amountCents) => {
					setChoosingWindfall(false);
					windfalls.decide.mutate({ moveId: ulid(), month, to, toName, amountCents });
				}}
			/>
		</div>
	);
}

/**
 * A chevron to an adjacent month, as on Transactions; its data preloads on hover or touch (the
 * router's default). Later months are open for planning ahead.
 */
function MonthLink({ month, label }: { month: MonthKey; label: string }) {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/month/$month" params={{ month }} aria-label={label}>
				{label === "Next month" ? (
					<ChevronRight className="size-5" />
				) : (
					<ChevronLeft className="size-5" />
				)}
			</Link>
		</Button>
	);
}

/** A mostly sideways swipe this far moves to the adjacent month. */
const SWIPE_DISTANCE = 64;

/** Touch handlers for swiping between months on phones: left for the next, right for the previous. */
function useMonthSwipe(month: MonthKey) {
	const navigate = useNavigate();
	const start = useRef<{ x: number; y: number } | null>(null);
	return {
		onTouchStart: (event: TouchEvent) => {
			const touch = event.touches[0];
			// Leave form fields and sheets' own gestures alone.
			const inField = (event.target as Element).closest("input, textarea, [role=dialog]");
			start.current =
				touch && event.touches.length === 1 && !inField
					? { x: touch.clientX, y: touch.clientY }
					: null;
		},
		onTouchEnd: (event: TouchEvent) => {
			const touch = event.changedTouches[0];
			const from = start.current;
			start.current = null;
			if (!touch || !from) return;
			const dx = touch.clientX - from.x;
			const dy = touch.clientY - from.y;
			if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 2) return;
			const to = addMonths(month, dx < 0 ? 1 : -1);
			navigate({ to: "/month/$month", params: { month: to } });
		},
	};
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
			<dl className="grid grid-cols-3 border-t">
				<Stat label="In Buckets" value={formatMoney(state.planned)} />
				<Stat label="Left in Buckets" value={formatMoney(state.leftInBuckets)} />
				<Stat label="Days left" value={String(state.daysLeft)} />
			</dl>
		</Card>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-0.5 px-(--card-pad) py-3.5 [&+&]:border-s">
			<dt className="text-xs font-medium text-muted-foreground">{label}</dt>
			<dd className="text-base font-semibold tracking-[-0.01em] tabular-nums">{value}</dd>
		</div>
	);
}

function PlanLink({ month, children }: { month: MonthState["month"]; children: string }) {
	return (
		<Link
			to="/month/$month/plan"
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
	month,
	bucket,
	covers,
	private: isPrivate = false,
}: {
	month: MonthKey;
	bucket: BucketState;
	covers?: ReactNode;
	/** The other Parent's Personal Allowance: its totals only, with nothing to drill into. */
	private?: boolean;
}) {
	const color = asBucketColor(bucket.color);
	const share = (cents: number) => (bucket.available > 0 ? cents / bucket.available : 0);
	const left = Math.max(0, bucket.left);
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
				bucket.owner && !isPrivate ? (
					// Your own Personal Allowance's Transactions are yours to see.
					<Link
						to="/transactions/$month"
						params={{ month }}
						search={{ bucket: bucket.id }}
						className="hover:underline"
					>
						{bucket.name}
					</Link>
				) : (
					bucket.name
				)
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
			meta={[
				`${formatMoney(bucket.spent)} spent`,
				isPrivate ? "Private" : null,
				bucket.rolledOver > 0 ? `${formatMoney(bucket.rolledOver)} rolled over` : null,
				bucket.rolledOver < 0 ? `${formatMoney(-bucket.rolledOver)} overspent last month` : null,
				bucket.moved < 0 ? `${formatMoney(-bucket.moved)} moved out` : null,
			]
				.filter(Boolean)
				.join(" · ")}
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
					{covers}
				</div>
			}
		/>
	);
}
