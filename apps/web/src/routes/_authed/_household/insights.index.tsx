import { isOnce, type MonthKey, monthKeyAt, monthOfDay } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { SplitLayout, SplitMain, SplitRail } from "@noodle/ui/components/layout";
import { ListRow } from "@noodle/ui/components/list";
import { Spinner } from "@noodle/ui/components/spinner";
import { toast } from "@noodle/ui/components/toast";
import { cn } from "@noodle/ui/lib/utils";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useHydrated } from "@tanstack/react-router";
import { Check, ChevronRight, Lightbulb, Lock, RefreshCw, Telescope } from "lucide-react";
import { useState } from "react";
import { withoutCommitment } from "../../../commitments";
import { Confirm, SaveFailed } from "../../../components/plan-editing";
import { SectionPending } from "../../../components/section-layout";
import { formatMoney, formatWholeMoney, monthName, shortDay, shortDayAt } from "../../../format";
import {
	exploreTriesFor,
	type InsightItem,
	insightLabel,
	useDecideInsight,
	useLookForInsights,
} from "../../../insights";
import { usePlanChange } from "../../../plan-changes";
import { insightsQuery } from "../../../queries";
import { useTryInExplore } from "../../../scenarios";
import { endCommitment } from "../../../server/commitments";

export const Route = createFileRoute("/_authed/_household/insights/")({
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	loader: ({ context }) => context.queryClient.ensureQueryData(insightsQuery()),
	pendingComponent: SectionPending,
	component: InsightsPage,
});

/**
 * Insights: what the nightly look over the Household's spending and Commitments found, each with
 * the Transactions and Commitments behind it and its yearly impact. A Parent accepts or dismisses
 * each; accepting an Overlap offers to end one of its Commitments, which, like everything here,
 * only happens when they confirm. "Try in Explore" saves a Scenario with the change it suggests
 * and opens it there, leaving the Plan as it is. Perk Overlaps rest on the Perk Sources Parents
 * confirm on Perks, the tab beside this one (which says how many wait to be confirmed).
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
			{look.isPending ? <Spinner /> : <RefreshCw />}
			Look for Insights now
		</Button>
	);
	return (
		<SplitLayout>
			<SplitMain>
				{/* Insights two across once their column is wide enough (1920 px windows), so it is used (#73). */}
				<div className="@container min-w-0">
					<div
						className={cn(
							"grid grid-cols-[minmax(0,1fr)] items-start gap-4 [&>:not([data-slot=card])]:col-span-full",
							insights.length > 1 && "@5xl:grid-cols-2",
						)}
					>
						<SaveFailed change={end} />
						{insights.length > 0 ? <div className="flex justify-end">{lookNow}</div> : null}
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
													toast(
														`${commitment.name} leaves the Plan from ${monthName(current)} on.`,
													);
													void queryClient.invalidateQueries({
														queryKey: insightsQuery().queryKey,
													});
												},
											},
										)
									}
								/>
							))
						)}
					</div>
				</div>
			</SplitMain>
			<SplitRail className="max-lg:hidden">
				<InsightsSide insights={insights} />
			</SplitRail>
		</SplitLayout>
	);
}

/** The xl side panel: how Insights work, and how many of each kind. */
function InsightsSide({ insights }: { insights: InsightItem[] }) {
	const counts = new Map<string, number>();
	for (const insight of insights) {
		const label = insightLabel(insight);
		counts.set(label, (counts.get(label) ?? 0) + 1);
	}
	return (
		<aside aria-label="About Insights" className="grid gap-4">
			{counts.size > 0 ? (
				<Card className="grid gap-2 p-(--card-pad)">
					<h2 className="text-sm font-semibold">By type</h2>
					<ul className="grid gap-1.5 text-sm">
						{[...counts].map(([label, count]) => (
							<li key={label} className="flex justify-between gap-3">
								<span className="text-muted-foreground">{label}</span>
								<span className="tabular-nums">{count}</span>
							</li>
						))}
					</ul>
				</Card>
			) : null}
			<Card className="grid gap-2 p-(--card-pad)">
				<h2 className="text-sm font-semibold">How Insights work</h2>
				<p className="text-sm text-muted-foreground">
					Noodle checks your spending and Commitments overnight. Each Insight shows what it's based
					on, and your Plan stays as it is until you act on one.
				</p>
			</Card>
		</aside>
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
	const tryInExplore = useTryInExplore(current);
	const tries = exploreTriesFor(insight, current);
	const [ending, setEnding] = useState<InsightCommitment | null>(null);
	const titleId = `insight-${insight.id}`;
	const live = insight.commitments.filter(
		(c) => c.endedFromMonth === null || c.endedFromMonth > current,
	);
	// A recurring Insight's action is ending a Commitment in the Plan; a one-off's is acknowledging
	// it (for a charge taken twice, by asking for the money back).
	const offersEnding = !isOnce(insight.kind) && live.length > 0;
	const acknowledge = insight.kind === "duplicate-charge" ? "I asked for a refund" : "Got it";
	const evidence = insight.commitments.length + insight.transactions.length + insight.perks.length;
	const endButtons = live.map((commitment) => (
		<Button
			key={commitment.id}
			variant={insight.status === "new" && live.length === 1 ? "default" : "outline"}
			size="wrap"
			disabled={!hydrated}
			onClick={() => setEnding(commitment)}
		>
			End {commitment.name} in the Plan…
		</Button>
	));
	return (
		<Card role="article" aria-labelledby={titleId}>
			<div className="grid gap-3 p-(--card-pad)">
				<div className="flex flex-wrap items-center gap-2">
					<Badge>{insightLabel(insight)}</Badge>
					{insight.status === "accepted" ? (
						<Badge variant="brand">
							<Check />
							{insight.kind === "duplicate-charge" ? "Refund asked for" : "Seen"}
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
						{isOnce(insight.kind) ? (
							<span className="text-xl font-[650] tracking-[-0.02em] tabular-nums">
								{formatMoney(insight.yearlyImpact)}
							</span>
						) : (
							<span className="text-xl font-[650] tracking-[-0.02em] tabular-nums">
								<span className="me-1 text-[13px] font-normal tracking-normal text-muted-foreground">
									about
								</span>
								{formatWholeMoney(insight.yearlyImpact)}
							</span>
						)}
						<span className="text-[13px] text-muted-foreground">
							{isOnce(insight.kind) ? "once" : "a year"}
						</span>
					</p>
				</div>
			</div>
			{evidence > 0 ? (
				<Collapsible className="group border-t">
					<CollapsibleTrigger className="w-full text-start flex max-lg:min-h-11 items-center gap-2 px-(--card-pad) py-2.5 text-[13px] font-medium text-muted-foreground hover:text-foreground">
						<ChevronRight className="size-4 transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none" />
						What it’s based on
						<Badge variant="count">{evidence}</Badge>
					</CollapsibleTrigger>
					<CollapsibleContent>
						<ul className="border-t [&>li+li]:border-t">
							{insight.commitments.map((commitment) => (
								<ListRow
									key={commitment.id}
									title={
										<Link
											to="/plan/$month/commitments/$id"
											params={{ month: current, id: commitment.id }}
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
							{insight.perks.map((perk) => (
								<ListRow
									key={perk.id}
									title={
										<a
											href={perk.sourceUrl}
											target="_blank"
											rel="noreferrer"
											className="underline-offset-4 hover:underline"
										>
											{perk.name}
										</a>
									}
									meta={`Perk of ${perk.sourceName} · Checked ${shortDayAt(perk.checkedAt)}`}
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
											{transaction.merchantName || transaction.note || "No note"}
										</Link>
									}
									meta={shortDay(transaction.date)}
									trailing={
										<span className="text-sm tabular-nums">{formatMoney(transaction.amount)}</span>
									}
								/>
							))}
						</ul>
					</CollapsibleContent>
				</Collapsible>
			) : null}
			{offersEnding && insight.status === "accepted" ? (
				<div className="grid gap-2 border-t px-(--card-pad) py-3">
					<p className="text-[13px] text-muted-foreground">
						End {live.length > 1 ? "one of them" : "it"} in the Plan? Nothing changes until you
						confirm.
					</p>
					<div className="flex flex-wrap items-center gap-2">{endButtons}</div>
				</div>
			) : null}
			{ending ? (
				<Confirm
					confirmLabel={`End ${ending.name}`}
					onCancel={() => setEnding(null)}
					onConfirm={() => {
						if (insight.status === "new") decide.mutate({ insight, status: "accepted" });
						onEnd(ending);
						setEnding(null);
					}}
				>
					{ending.name} leaves the Plan from {monthName(current)} on. Earlier months keep it.
				</Confirm>
			) : null}
			<div className="flex flex-wrap items-center gap-2 border-t px-(--card-pad) py-2.5">
				{insight.status === "new" && offersEnding ? endButtons : null}
				{insight.status === "new" ? (
					<Button
						size="sm"
						variant={offersEnding ? "outline" : "default"}
						disabled={!hydrated}
						onClick={() => decide.mutate({ insight, status: "accepted" })}
					>
						<Check />
						{acknowledge}
					</Button>
				) : null}
				{tries.map((change) => (
					<Button
						key={change.preset}
						variant="outline"
						size="sm"
						disabled={!hydrated}
						onClick={() => tryInExplore(change)}
					>
						<Telescope />
						{tries.length === 1 ? "Try in Explore" : `Try “${change.name}”`}
					</Button>
				))}
				<Button
					variant="ghost"
					size="sm"
					className="ms-auto"
					disabled={!hydrated}
					onClick={() => decide.mutate({ insight, status: "dismissed" })}
				>
					Not useful
				</Button>
			</div>
		</Card>
	);
}
