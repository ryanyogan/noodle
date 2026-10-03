import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AddBuckets } from "../../../components/add-buckets";
import { AddBucket, AddPersonalAllowance, BucketEditor } from "../../../components/bucket-editor";
import { PlanMasterDetail } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
import { TermHelp } from "../../../components/term-help";
import { formatMoney } from "../../../format";
import { usePlanChanges } from "../../../plan-changes";
import { membersQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/buckets")({
	// Setting up a Personal Allowance names it after its Parent.
	loader: ({ context }) => context.queryClient.ensureQueryData(membersQuery()),
	pendingComponent: SectionPending,
	component: PlanBuckets,
});

function PlanBuckets() {
	const { month, parentId } = Route.useRouteContext();
	const state = useMonthState(month);
	const changes = usePlanChanges(month);
	const buckets = state.buckets.filter((b) => b.owner === undefined);
	const allowances = state.buckets.filter((b) => b.owner !== undefined);
	const shared = buckets.reduce((sum, b) => sum + b.allowance, 0);
	const members = useSuspenseQuery(membersQuery()).data;
	const nameOf = (id: string) => members.find((m) => m.id === id)?.name;
	return (
		<PlanMasterDetail
			noun="Bucket"
			listLabel="Buckets"
			editable={state.editable}
			summary={
				buckets.length > 0
					? `${formatMoney(shared)} in Buckets${
							state.movedToBuckets > 0
								? ` · ${formatMoney(state.movedToBuckets)} Covered from Free to Spend`
								: ""
						}`
					: undefined
			}
			aside={
				state.editable ? (
					<div className="grid gap-3">
						<AddBuckets
							month={month}
							buckets={state.buckets}
							freeToSpend={state.freeToSpend}
							parentId={parentId}
							parentName={nameOf(parentId)}
						/>
						<AddBucket month={month} buckets={state.buckets} />
					</div>
				) : undefined
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
								order={buckets.map((b) => b.id)}
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
			</div>
			{allowances.length > 0 || state.editable ? (
				<Section id="personal-allowances" aria-labelledby="plan-personal-allowances">
					<SectionHeader
						id="plan-personal-allowances"
						title="Personal Allowances"
						count={allowances.length}
						help={<TermHelp term="personal-allowance" />}
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
									order={[]}
									setBy={
										state.editable && bucket.owner !== parentId && bucket.owner
											? nameOf(bucket.owner)
											: undefined
									}
								/>
							))}
						</List>
					) : null}
					{state.editable && !allowances.some((b) => b.owner === parentId) ? (
						<AddPersonalAllowance month={month} parentId={parentId} buckets={state.buckets} />
					) : null}
				</Section>
			) : null}
		</PlanMasterDetail>
	);
}
