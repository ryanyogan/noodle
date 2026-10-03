import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AddBuckets } from "../../../components/add-buckets";
import { AddPersonalAllowance, BucketEditor } from "../../../components/bucket-editor";
import { BucketList } from "../../../components/bucket-list";
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
	// Amounts being typed in the list, so Left to plan follows before they're saved.
	const [drafts, setDrafts] = useState<Record<string, number>>({});
	const typed = state.buckets.reduce(
		(sum, b) => sum + (drafts[b.id] === undefined ? 0 : (drafts[b.id] ?? 0) - b.allowance),
		0,
	);
	const left = state.freeToSpend - typed;
	const onDraft = (bucketId: string, cents: number | null) =>
		setDrafts(({ [bucketId]: _, ...rest }) =>
			cents === null ? rest : { ...rest, [bucketId]: cents },
		);
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
		>
			<div className="grid gap-3">
				{state.editable ? (
					// Stays in view while Buckets are added and changed (a bar across the top on a phone).
					<div className="sticky top-[env(safe-area-inset-top)] z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-xl border bg-card/90 px-3 py-2 backdrop-blur-xl max-lg:-mx-1">
						<p aria-live="polite" className="text-sm text-muted-foreground">
							Left to plan <TermHelp term="free-to-spend" />{" "}
							<span
								className={`font-medium tabular-nums ${left < 0 ? "text-over-foreground" : "text-foreground"}`}
							>
								{formatMoney(left)}
							</span>
						</p>
						<AddBuckets
							month={month}
							buckets={state.buckets}
							freeToSpend={state.freeToSpend}
							parentId={parentId}
							parentName={nameOf(parentId)}
						/>
					</div>
				) : null}
				{buckets.length > 0 ? (
					<BucketList
						month={month}
						buckets={buckets}
						editable={state.editable}
						was={changes.allowances}
						onDraft={onDraft}
					/>
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
									onDraft={(cents) => onDraft(bucket.id, cents)}
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
