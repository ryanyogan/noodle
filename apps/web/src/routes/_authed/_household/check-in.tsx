import {
	type CheckInCard,
	type CheckInCardKind,
	checkInStep,
	displayMerchant,
} from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent, CardFooter } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { StepList, StepListItem } from "@noodle/ui/components/stepper";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { checkInCardTitle, checkInLine, checkInSummary } from "../../../check-in";
import { PerkResetLine } from "../../../components/perk-reset";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, fullDay, monthName, shortDay } from "../../../format";
import { checkInQuery, insightsQuery, reviewQuery } from "../../../queries";
import { type CheckInView, completeCheckIn } from "../../../server/check-in";

export const Route = createFileRoute("/_authed/_household/check-in")({
	// `past`: the cards already passed, comma-separated, so leaving for Review or Insights and
	// coming Back picks up at the same card.
	validateSearch: z.object({ past: z.string().optional().catch(undefined) }),
	// Read afresh on the way in: a cached empty stack would finish the Check-in before its cards
	// arrived.
	loader: ({ context }) => context.queryClient.fetchQuery(checkInQuery()),
	component: CheckInPage,
});

/**
 * The weekly Check-in: a short stack of what waits for this Parent (Review, Insights, Sweeps,
 * Extra income, skipping any with nothing in it), one card at a time, ending on a done state that
 * also says whether the other Parent has done theirs. Reaching the end finishes the week's
 * Check-in; nothing on the cards changes until the Parent acts on the page each one links to.
 */
function CheckInPage() {
	const view = useSuspenseQuery(checkInQuery()).data;
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const kinds = new Set(view.cards.map((c) => c.kind));
	const past = (search.past?.split(",") ?? []).filter((k): k is CheckInCardKind =>
		kinds.has(k as CheckInCardKind),
	);
	const setPast = (next: CheckInCardKind[]) =>
		navigate({ search: { past: next.length > 0 ? next.join(",") : undefined } });
	const step =
		view.completedAt === null ? checkInStep(view.cards, past) : ({ kind: "done" } as const);
	const complete = useCompleteCheckIn();
	// Finishing is recorded once, when the stack runs out (straight away when it was empty).
	const done = step.kind === "done";
	const unrecorded = done && view.completedAt === null && complete.isIdle;
	const { mutate: finish } = complete;
	useEffect(() => {
		if (unrecorded) finish();
	}, [unrecorded, finish]);

	return (
		<>
			<PageHeader eyebrow={`Week of ${fullDay(view.week)}`} title="Check-in" />
			<div
				className={cn(
					"grid gap-4",
					view.cards.length > 0 && "lg:grid-cols-[240px_minmax(0,42rem)] lg:items-start lg:gap-8",
				)}
			>
				{view.cards.length > 0 ? (
					<StepList aria-label="Check-in steps" className="hidden lg:block">
						{view.cards.map((card) => (
							<StepListItem
								key={card.kind}
								state={
									step.kind === "card" && step.card.kind === card.kind
										? "current"
										: done || past.includes(card.kind)
											? "done"
											: "todo"
								}
							>
								{checkInCardTitle[card.kind]}
							</StepListItem>
						))}
					</StepList>
				) : null}
				<div className="grid max-w-2xl gap-3">
					<PerkResetLine />
					{step.kind === "card" ? (
						<p className="text-sm text-muted-foreground tabular-nums">
							{step.position} of {step.of}
						</p>
					) : null}
					{step.kind === "card" ? (
						<CheckInCardView
							key={step.card.kind}
							card={step.card}
							last={step.last}
							onNext={() => setPast([...past, step.card.kind])}
						/>
					) : (
						<Done view={view} empty={view.cards.length === 0 && past.length === 0} />
					)}
				</div>
			</div>
		</>
	);
}

function useCompleteCheckIn() {
	const queryClient = useQueryClient();
	return useMutation({
		mutationFn: () => completeCheckIn(),
		onError: () => toast("Couldn’t save your Check-in. Try again later.", { tone: "error" }),
		onSettled: () => queryClient.invalidateQueries({ queryKey: checkInQuery().queryKey }),
	});
}

function CheckInCardView({
	card,
	last,
	onNext,
}: {
	card: CheckInCard;
	last: boolean;
	onNext: () => void;
}) {
	return (
		<Card>
			<CardContent className="grid gap-1">
				<p className="text-[13px] font-medium text-muted-foreground">
					{checkInCardTitle[card.kind]}
				</p>
				<h2 className="text-lg font-semibold tracking-[-0.01em]">{checkInLine(card)}</h2>
				{card.kind === "sweeps" ? (
					<p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
						<span>
							Leftovers from last month’s Buckets that reset monthly: choose which Goal they go to.
						</span>
						<TermHelp term="sweep" />
					</p>
				) : card.kind === "windfalls" ? (
					<p className="flex flex-wrap items-center gap-x-1 text-sm text-muted-foreground">
						<span>Pay above your usual take-home pay: decide where it goes.</span>
						<TermHelp term="extra-income" />
					</p>
				) : null}
			</CardContent>
			<CardDetails card={card} />
			<CardFooter className="justify-between">
				<CardLink card={card} />
				{/* A card is only here while something on it waits: moving on leaves it for later. */}
				<Button variant="ghost" onClick={onNext}>
					{last ? "Skip and finish" : "Skip for now"}
				</Button>
			</CardFooter>
		</Card>
	);
}

/** How many waiting Transactions the Review step lists before "N more". */
const REVIEW_SHOWN = 5;

/**
 * The Review step's waiting Transactions, read-only: the oldest few, what and how much, then how
 * many more. Read as the Review page reads them, for this Parent (ADR-0003), so nothing in the
 * other Parent's Personal Allowance shows; no guesses, since deciding happens in Review.
 */
function ReviewDetails() {
	// Read again on opening the step, like the Check-in itself: the sidebar's Review badge keeps
	// this query fresh for a while, and what it held may be from before the card's count.
	const review = useQuery({ ...reviewQuery(), refetchOnMount: "always" }).data;
	if (!review || review.items.length === 0) return null;
	const shown = review.items.slice(0, REVIEW_SHOWN);
	const more = review.total - shown.length;
	return (
		<ul aria-label="Waiting in Review" className="border-t [&>li+li]:border-t">
			{shown.map((item) => (
				<ListRow
					key={item.id}
					title={item.merchantName ?? displayMerchant(item.note ?? item.merchant)}
					meta={shortDay(item.date)}
					trailing={<span className="text-sm tabular-nums">{formatMoney(item.amountCents)}</span>}
				/>
			))}
			{more > 0 ? (
				<li className="px-4 py-2.5 text-sm text-muted-foreground">
					{more} more {more === 1 ? "waits" : "wait"} in Review
				</li>
			) : null}
		</ul>
	);
}

/**
 * The Insights step's new Insights, read-only: each one's title and what it says. The card's
 * titles show until the Insights themselves arrive.
 */
function InsightDetails({ titles }: { titles: string[] }) {
	// Read again on opening the step, as the Review step is: an earlier read may predate them.
	const insights = useQuery({ ...insightsQuery(), refetchOnMount: "always" }).data?.filter(
		(insight) => insight.status === "new",
	);
	return (
		<ul aria-label="New Insights" className="border-t [&>li+li]:border-t">
			{insights && insights.length > 0
				? insights.map((insight) => (
						<li key={insight.id} className="grid gap-0.5 px-4 py-3">
							<p className="text-sm font-medium">{insight.title}</p>
							<p className="text-sm text-muted-foreground">{insight.body}</p>
						</li>
					))
				: titles.map((title, index) => (
						// Titles can repeat; their order is stable for the card's life.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						<ListRow key={index} title={title} />
					))}
		</ul>
	);
}

/** What's behind a card's line: what waits in Review, the Insights, the leftovers, the Extra income. */
function CardDetails({ card }: { card: CheckInCard }) {
	switch (card.kind) {
		case "review":
			return <ReviewDetails />;
		case "insights":
			return <InsightDetails titles={card.titles} />;
		case "sweeps":
			return (
				<ul className="border-t [&>li+li]:border-t">
					{card.leftovers.map((leftover) => (
						<ListRow
							key={leftover.bucketId}
							title={leftover.name}
							trailing={
								<span className="text-sm tabular-nums">{formatMoney(leftover.amount)}</span>
							}
						/>
					))}
				</ul>
			);
		case "windfalls":
			return (
				<ul className="border-t [&>li+li]:border-t">
					{card.windfalls.map((extraIncome) => (
						<ListRow
							key={extraIncome.month}
							title={monthName(extraIncome.month)}
							trailing={
								<span className="text-sm tabular-nums">{formatMoney(extraIncome.amount)}</span>
							}
						/>
					))}
				</ul>
			);
	}
}

/** Where the Parent acts on a card. */
function CardLink({ card }: { card: CheckInCard }) {
	const label = (text: string) => (
		<>
			{text}
			<ChevronRight />
		</>
	);
	switch (card.kind) {
		case "review":
			return (
				<Button asChild variant="outline">
					<Link to="/review">{label("Open full page")}</Link>
				</Button>
			);
		case "insights":
			return (
				<Button asChild variant="outline">
					<Link to="/insights">{label("Open full page")}</Link>
				</Button>
			);
		case "sweeps":
			return (
				<Button asChild variant="outline">
					<Link to="/month/$month" params={{ month: card.month }}>
						{label(`Open ${monthName(card.month)}`)}
					</Link>
				</Button>
			);
		case "windfalls": {
			// The oldest first: last month's closes before this month's.
			const month = card.windfalls[0]?.month;
			if (!month) return <span />;
			return (
				<Button asChild variant="outline">
					<Link to="/month/$month" params={{ month }}>
						{label(`Open ${monthName(month)}`)}
					</Link>
				</Button>
			);
		}
	}
}

function Done({ view, empty }: { view: CheckInView; empty: boolean }) {
	const other = view.otherParent;
	// The week is done, but what was skipped still waits: say so, rather than "all done".
	const waiting = view.cards.length > 0 ? checkInSummary(view.cards) : null;
	return (
		<EmptyState
			icon={<Check />}
			title="You’re done for this week"
			description={
				<>
					{waiting ? `Still waiting for you: ${waiting} ` : null}
					{empty
						? "Nothing needed you this week. Once a week, the Check-in takes a few minutes: confirm spending Noodle wasn’t sure about, look at its suggestions, and decide what to do with last month’s leftovers. "
						: null}
					{other
						? other.completedAt === null
							? `${other.name} hasn’t done this week’s Check-in yet.`
							: `${other.name} finished this week’s Check-in.`
						: null}
				</>
			}
			action={
				<Button asChild variant="outline">
					<Link to="/month">Back to this month</Link>
				</Button>
			}
		/>
	);
}
