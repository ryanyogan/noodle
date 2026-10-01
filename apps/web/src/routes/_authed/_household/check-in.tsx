import { type CheckInCard, type CheckInCardKind, checkInStep } from "@noodle/domain";
import { Button } from "@noodle/ui/components/button";
import { Card, CardContent, CardFooter } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { toast } from "@noodle/ui/components/toast";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Check, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { z } from "zod";
import { checkInCardTitle, checkInLine } from "../../../check-in";
import { formatMoney, fullDay, monthName } from "../../../format";
import { checkInQuery } from "../../../queries";
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
 * Windfalls, skipping any with nothing in it), one card at a time, ending on a done state that
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
			<PageHeader
				eyebrow={`Week of ${fullDay(view.week)}`}
				title="Check-in"
				actions={
					step.kind === "card" ? (
						<span className="text-sm text-muted-foreground tabular-nums">
							{step.position} of {step.of}
						</span>
					) : undefined
				}
			/>
			<div className="grid max-w-2xl gap-4">
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
			</CardContent>
			<CardDetails card={card} />
			<CardFooter className="justify-between">
				<CardLink card={card} />
				<Button onClick={onNext}>{last ? "Finish" : "Next"}</Button>
			</CardFooter>
		</Card>
	);
}

/** What's behind a card's line: the Insights' titles, the leftovers, the Windfalls' months. */
function CardDetails({ card }: { card: CheckInCard }) {
	switch (card.kind) {
		case "review":
			return null;
		case "insights":
			return (
				<ul className="border-t [&>li+li]:border-t">
					{card.titles.map((title, index) => (
						// Titles can repeat; their order is stable for the card's life.
						// biome-ignore lint/suspicious/noArrayIndexKey: see above
						<ListRow key={index} title={title} />
					))}
				</ul>
			);
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
					<Link to="/review">{label("Open Review")}</Link>
				</Button>
			);
		case "insights":
			return (
				<Button asChild variant="outline">
					<Link to="/insights">{label("Open Insights")}</Link>
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
	return (
		<EmptyState
			icon={<Check />}
			title="You’re done for this week"
			description={
				<>
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
