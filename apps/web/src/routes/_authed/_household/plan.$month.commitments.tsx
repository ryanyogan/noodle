import { type MonthKey, monthOfDay } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { createFileRoute } from "@tanstack/react-router";
import { withoutCommitment } from "../../../commitments";
import { AddCommitment, CommitmentEditor } from "../../../components/commitment-editor";
import { SaveFailed } from "../../../components/plan-editing";
import { PlanSubPage } from "../../../components/plan-page";
import { formatMoney } from "../../../format";
import { usePlanChange, usePlanChanges } from "../../../plan-changes";
import { useMonthState } from "../../../queries";
import { endCommitment } from "../../../server/commitments";

export const Route = createFileRoute("/_authed/_household/plan/$month/commitments")({
	component: PlanCommitments,
});

function PlanCommitments() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const changes = usePlanChanges(month);
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
				) : state.editable ? (
					<p className="px-1 text-sm text-muted-foreground">
						Recurring, predictable costs: the mortgage, insurance, daycare, subscriptions. What
						they’re expected to take each month comes out before the Buckets.
					</p>
				) : (
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						No Commitments in this month’s Plan.
					</Card>
				)}
				{state.editable ? <AddCommitment month={month} /> : null}
			</div>
		</PlanSubPage>
	);
}
