import { type MonthKey, monthKeyAt, monthOfDay } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { toast } from "@noodle/ui/components/toast";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check, ChevronRight, Lightbulb, Lock, RefreshCw } from "lucide-react";
import { useState } from "react";
import { withoutCommitment } from "../../../commitments";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { formatMoney, monthName, shortDay } from "../../../format";
import {
	exploreLinkFor,
	type InsightItem,
	insightLabel,
	useDecideInsight,
	useLookForInsights,
} from "../../../insights";
import { usePlanChange } from "../../../plan-changes";
import { insightsQuery } from "../../../queries";
import { endCommitment } from "../../../server/commitments";

export const Route = createFileRoute("/_authed/_household/insights")({
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	loader: ({ context }) => context.queryClient.ensureQueryData(insightsQuery()),
	component: InsightsPage,
});

/**
 * Insights: what the nightly look over the Household's spending and Commitments found, each with
 * the Transactions and Commitments behind it and its yearly impact. A Parent accepts or dismisses
 * each; accepting an Overlap offers to end one of its Commitments, which, like everything here,
 * only happens when they confirm.
 */
function InsightsPage() {
	const { current } = Route.useRouteContext();
	const insights = useSuspenseQuery(insightsQuery()).data;
	const look = useLookForInsights();
	const queryClient = useQueryClient();
	const hydrated = useHydrated();
	// Owned here: ending a Commitment must not lose its error when its card changes.
	const end = usePlanChange(current, {
		save: (data: { commitmentId: string; month: MonthKey }) => endCommitment({ data }),
		apply: withoutCommitment,
	});
	const lookNow = (
		<Button
			variant="outline"
			size="sm"
			disabled={!hydrated || look.isPending}
			onClick={() => look.mutate()}
		>
			<RefreshCw className={look.isPending ? "animate-spin motion-reduce:animate-none" : ""} />
			Look for Insights now
		</Button>
	);
	return (
		<>
			<PageHeader title="Insights" actions={insights.length > 0 ? lookNow : undefined} />
			<div className="grid max-w-2xl gap-4">
				<SaveFailed change={end} />
				{insights.length === 0 ? (
					<EmptyState
						icon={<Lightbulb />}
						title="No Insights right now"
						description="Each night Noodle looks over your spending and Commitments for things like paying twice for the same service or a price that went up. Nothing changes until you act."
						action={lookNow}
					/>
				) : (
					insights.map((insight) => (
						<InsightCard
							key={insight.id}
							insight={insight}
							current={current}
							onEnd={(commitment) =>
								end.mutate(
									{ commitmentId: commitment.id, month: current },
									{
										onSuccess: () => {
											toast(`${commitment.name} leaves the Plan from ${monthName(current)} on.`);
											void queryClient.invalidateQueries({ queryKey: insightsQuery().queryKey });
										},
									},
								)
							}
						/>
					))
				)}
			</div>
		</>
	);
}

type InsightCommitment = InsightItem["commitments"][number];

function InsightCard({
	insight,
	current,
	onEnd,
}: {
	insight: InsightItem;
	current: MonthKey;
	onEnd: (commitment: InsightCommitment) => void;
}) {
	const decide = useDecideInsight();
	const hydrated = useHydrated();
	const [ending, setEnding] = useState<InsightCommitment | null>(null);
	const titleId = `insight-${insight.id}`;
	const live = insight.commitments.filter(
		(c) => c.endedFromMonth === null || c.endedFromMonth > current,
	);
	const offersEnding =
		insight.status === "accepted" && insight.kind !== "duplicate-charge" && live.length > 0;
	const evidence = insight.commitments.length + insight.transactions.length;
	return (
		<Card role="article" aria-labelledby={titleId}>
			<div className="grid gap-3 p-(--card-pad)">
				<div className="flex flex-wrap items-center gap-2">
					<Badge>{insightLabel(insight)}</Badge>
					{insight.status === "accepted" ? (
						<Badge variant="brand">
							<Check />
							Accepted
						</Badge>
					) : null}
					{insight.private ? (
						<Badge>
							<Lock />
							Only you see this
						</Badge>
					) : null}
				</div>
				<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
					<div className="grid min-w-0 flex-1 basis-64 gap-1">
						<h2 id={titleId} className="text-[15px] font-semibold leading-snug">
							{insight.title}
						</h2>
						<p className="text-sm text-muted-foreground">{insight.body}</p>
					</div>
					<p className="flex items-baseline gap-1.5 sm:grid sm:gap-0 sm:text-right">
						<span className="text-xl font-[650] tracking-[-0.02em] tabular-nums">
							{formatMoney(insight.yearlyImpact)}
						</span>
						<span className="text-[13px] text-muted-foreground">
							{insight.kind === "duplicate-charge" ? "once" : "a year"}
						</span>
					</p>
				</div>
			</div>
			{evidence > 0 ? (
				<details className="group border-t">
					<summary className="flex cursor-pointer list-none items-center gap-2 px-(--card-pad) py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
						<ChevronRight className="size-4 transition-transform group-open:rotate-90 motion-reduce:transition-none" />
						What it’s based on
						<Badge variant="count">{evidence}</Badge>
					</summary>
					<ul className="border-t [&>li+li]:border-t">
						{insight.commitments.map((commitment) => (
							<ListRow
								key={commitment.id}
								title={
									<Link
										to="/plan/commitments/$id"
										params={{ id: commitment.id }}
										className="underline-offset-4 hover:underline"
									>
										{commitment.name}
									</Link>
								}
								meta={
									live.includes(commitment) ? "Commitment" : "Commitment, no longer in the Plan"
								}
							/>
						))}
						{insight.transactions.map((transaction) => (
							<ListRow
								key={transaction.id}
								title={
									<Link
										to="/transactions/$month"
										params={{ month: monthOfDay(transaction.date) }}
										className="underline-offset-4 hover:underline"
									>
										{transaction.note || "No note"}
									</Link>
								}
								meta={shortDay(transaction.date)}
								trailing={
									<span className="text-sm tabular-nums">{formatMoney(transaction.amount)}</span>
								}
							/>
						))}
					</ul>
				</details>
			) : null}
			{offersEnding ? (
				<div className="grid gap-2 border-t px-(--card-pad) py-3">
					<p className="text-[13px] text-muted-foreground">
						End {live.length > 1 ? "one of them" : "it"} in the Plan? Nothing changes until you
						confirm.
					</p>
					{live.map((commitment) => {
						const explore = exploreLinkFor(insight, commitment.id);
						return (
							<div key={commitment.id} className="flex flex-wrap items-center gap-2">
								<Button
									variant="outline"
									size="sm"
									disabled={!hydrated}
									onClick={() => setEnding(commitment)}
								>
									End {commitment.name}…
								</Button>
								{explore ? (
									<Button variant="ghost" size="sm" asChild>
										<Link {...explore}>Try ending it in Explore</Link>
									</Button>
								) : null}
							</div>
						);
					})}
					{ending ? (
						<Confirm
							confirmLabel={`End ${ending.name}`}
							onCancel={() => setEnding(null)}
							onConfirm={() => {
								onEnd(ending);
								setEnding(null);
							}}
						>
							{ending.name} leaves the Plan from {monthName(current)} on. Earlier months keep it.
						</Confirm>
					) : null}
				</div>
			) : null}
			<div className="flex flex-wrap items-center gap-2 border-t px-(--card-pad) py-2.5">
				{insight.status === "new" ? (
					<Button
						size="sm"
						disabled={!hydrated}
						onClick={() => decide.mutate({ insight, status: "accepted" })}
					>
						<Check />
						Accept
					</Button>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					className="ms-auto"
					disabled={!hydrated}
					onClick={() => decide.mutate({ insight, status: "dismissed" })}
				>
					Dismiss
				</Button>
			</div>
		</Card>
	);
}
