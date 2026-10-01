import {
	lumpyMonths,
	type MonthKey,
	monthlyEquivalent,
	monthOfDay,
	yearlyCost,
} from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { withoutCommitment } from "../../../commitments";
import { lumpText } from "../../../components/coming-up";
import { AddCommitment, CommitmentEditor } from "../../../components/commitment-editor";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanSubPage } from "../../../components/plan-page";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, monthName } from "../../../format";
import { usePlanChange, usePlanChanges } from "../../../plan-changes";
import { commitmentsQuery, useMonthState } from "../../../queries";
import { endCommitment } from "../../../server/commitments";

export const Route = createFileRoute("/_authed/_household/plan/$month/commitments")({
	// Lumpy months ahead read every Commitment's schedule.
	loader: ({ context }) => context.queryClient.ensureQueryData(commitmentsQuery()),
	component: PlanCommitments,
});

function PlanCommitments() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const changes = usePlanChanges(month);
	const all = useSuspenseQuery(commitmentsQuery()).data;
	const lumpy = lumpyMonths(all, month, 12);
	const yearly = state.commitments.reduce((sum, c) => sum + yearlyCost(c), 0);
	// Owned here: ending a Commitment removes its row, which must not take the error with it.
	const end = usePlanChange(month, {
		save: (data: { commitmentId: string; month: MonthKey }) => endCommitment({ data }),
		apply: withoutCommitment,
	});
	return (
		<PlanSubPage
			month={month}
			current={monthOfDay(state.asOf)}
			editable={state.editable}
			title="Commitments"
			summary={
				state.commitments.length > 0
					? `${formatMoney(state.committed)} expected this month`
					: undefined
			}
		>
			<div className="grid gap-3">
				<SaveFailed change={end} />
				{state.commitments.length > 0 ? (
					<>
						<List>
							{state.commitments.map((commitment) => (
								<CommitmentEditor
									key={commitment.id}
									month={month}
									commitment={commitment}
									editable={state.editable}
									was={changes.commitments[commitment.id]}
									onEnd={(commitmentId) => end.mutate({ commitmentId, month })}
								/>
							))}
						</List>
						<p className="px-1 text-sm text-muted-foreground">
							All Commitments:{" "}
							<span className="font-medium text-foreground tabular-nums">
								{formatMoney(yearly)} a year
							</span>
							, about{" "}
							{formatMoney(state.commitments.reduce((sum, c) => sum + monthlyEquivalent(c), 0))} a
							month.
						</p>
					</>
				) : state.editable ? (
					<p className="px-1 text-sm text-muted-foreground">
						Recurring, predictable costs: the mortgage, insurance, daycare, subscriptions. What
						they’re expected to take each month comes out before the Buckets.{" "}
						<TermHelp term="commitment" />
					</p>
				) : (
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						No Commitments in this month’s Plan.
					</Card>
				)}
				{state.editable ? <AddCommitment month={month} /> : null}
			</div>
			{lumpy.length > 0 ? (
				<Section aria-labelledby="lumpy-months">
					<SectionHeader
						id="lumpy-months"
						title="Lumpy months ahead"
						help={<TermHelp term="lumpy-month" />}
					/>
					<List>
						{lumpy.map(({ month: lumpyMonth, lumps }) => (
							<ListRow
								key={lumpyMonth}
								title={monthName(lumpyMonth)}
								meta={lumpText(lumps, lumpyMonth)}
								trailing={
									<span className="text-sm font-medium tabular-nums">
										+{formatMoney(lumps.reduce((sum, l) => sum + l.extra, 0))}
									</span>
								}
							/>
						))}
					</List>
				</Section>
			) : null}
		</PlanSubPage>
	);
}
