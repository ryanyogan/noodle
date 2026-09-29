import { monthOfDay } from "@noodle/domain";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { createFileRoute } from "@tanstack/react-router";
import { AddBucket, AddPersonalAllowance, BucketEditor } from "../../../components/bucket-editor";
import { PlanSubPage } from "../../../components/plan-page";
import { formatMoney } from "../../../format";
import { usePlanChanges } from "../../../plan-changes";
import { membersQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/buckets")({
	// Setting up a Personal Allowance names it after its Parent.
	loader: ({ context }) => context.queryClient.ensureQueryData(membersQuery()),
	component: PlanBuckets,
});

function PlanBuckets() {
	const { month, parentId } = Route.useRouteContext();
	const state = useMonthState(month);
	const changes = usePlanChanges(month);
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const allowances = state.buckets.filter((b) => b.owner !== undefined);
	const shared = buckets.reduce((sum, b) => sum + b.allowance, 0);
	return (
		<PlanSubPage
			month={month}
			current={monthOfDay(state.asOf)}
			editable={state.editable}
			title="Buckets"
			summary={
				buckets.length > 0
					? `${formatMoney(shared)} in Buckets${
							state.movedToBuckets > 0
								? ` · ${formatMoney(state.movedToBuckets)} Covered from Free to Spend`
								: ""
						}`
					: undefined
			}
		>
			<div className="grid gap-3">
				{buckets.length > 0 ? (
					<List>
						{buckets.map((bucket) => (
							<BucketEditor
								key={bucket.id}
								month={month}
								bucket={bucket}
								editable={state.editable}
								was={changes.allowances[bucket.id]}
							/>
						))}
					</List>
				) : state.editable ? (
					<p className="px-1 text-sm text-muted-foreground">
						An allowance for each kind of everyday spending, like Groceries, Fun, or Hockey, tracked
						as what’s left.
					</p>
				) : (
					<Card className="p-(--card-pad) text-sm text-muted-foreground">
						No Buckets in this month’s Plan.
					</Card>
				)}
				{state.editable ? <AddBucket month={month} buckets={state.buckets} /> : null}
			</div>
			{allowances.length > 0 || state.editable ? (
				<Section id="personal-allowances" aria-labelledby="plan-personal-allowances">
					<SectionHeader
						id="plan-personal-allowances"
						title="Personal Allowances"
						count={allowances.length}
					/>
					{allowances.length > 0 ? (
						<List>
							{allowances.map((bucket) => (
								<BucketEditor
									key={bucket.id}
									month={month}
									bucket={bucket}
									// Each Parent sets their own; the other's shows its amount.
									editable={state.editable && bucket.owner === parentId}
									was={changes.allowances[bucket.id]}
								/>
							))}
						</List>
					) : null}
					{state.editable && !allowances.some((b) => b.owner === parentId) ? (
						<AddPersonalAllowance month={month} parentId={parentId} buckets={state.buckets} />
					) : null}
				</Section>
			) : null}
		</PlanSubPage>
	);
}
