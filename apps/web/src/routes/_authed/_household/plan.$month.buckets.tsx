import { monthOfDay } from "@noodle/domain";
import { BudgetBar } from "@noodle/ui/components/budget-bar";
import { Card } from "@noodle/ui/components/card";
import { List } from "@noodle/ui/components/list";
import { Money } from "@noodle/ui/components/money";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AddBuckets } from "../../../components/add-buckets";
import { AddPersonalAllowance, BucketEditor } from "../../../components/bucket-editor";
import { BucketList } from "../../../components/bucket-list";
import { PlanMasterDetail, TotalsCard } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
import { Suggested } from "../../../components/suggested";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, monthName } from "../../../format";
import { usePlanChanges } from "../../../plan-changes";
import {
	membersQuery,
	suggestionsQuery,
	useAllowancesStillToSet,
	useMonthState,
} from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/buckets")({
	// Setting up a Personal Allowance names it after its Parent; Suggested is in the first paint.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(suggestionsQuery()),
		]),
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
	// Another Parent's Personal Allowance isn't in this Plan (ADR-0003); only whether one exists is.
	const stillToSet = useAllowancesStillToSet(parentId);
	// Amounts being typed in the list, so Left to plan follows before they're saved.
	const [drafts, setDrafts] = useState<Record<string, number>>({});
	const typed = state.buckets.reduce(
		(sum, b) => sum + (drafts[b.id] === undefined ? 0 : (drafts[b.id] ?? 0) - b.allowance),
		0,
	);
	const left = state.freeToSpend - typed;
	const personal = allowances.reduce((sum, b) => sum + b.allowance, 0);
	const spent = state.buckets.reduce((sum, b) => sum + b.spent, 0);
	const available = state.buckets.reduce((sum, b) => sum + b.available, 0);
	const over = state.buckets.reduce((sum, b) => sum + Math.max(0, -b.left), 0);
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
				buckets.length > 0 ? (
					<>
						<Money cents={shared} /> in Buckets
						{state.movedToBuckets > 0 ? (
							<>
								{" · "}
								<Money cents={state.movedToBuckets} /> Covered from Free to Spend
							</>
						) : null}
					</>
				) : undefined
			}
			overviewHeader={{
				eyebrow: `Buckets in ${monthName(month)}`,
				title: (
					<>
						<Money cents={spent} /> spent
					</>
				),
			}}
			overview={
				state.buckets.length > 0 ? (
					<TotalsCard
						label={`Buckets in ${monthName(month)}: totals`}
						lines={[
							...(state.baseline == null
								? []
								: [{ label: "Take-home pay", value: formatMoney(state.baseline) }]),
							{ label: "Shared Buckets", value: formatMoney(shared) },
							...(allowances.length > 0
								? [{ label: "Personal Allowances", value: formatMoney(personal) }]
								: []),
							{ label: "Spent so far", value: formatMoney(spent) },
							...(over > 0
								? [
										{
											label: "Over, across Buckets",
											value: formatMoney(over),
											tone: "over" as const,
										},
									]
								: []),
							{
								label: "Left in Buckets",
								value: formatMoney(state.leftInBuckets),
								tone: "strong" as const,
							},
						]}
					>
						<BudgetBar
							value={spent}
							max={available}
							label={`All Buckets in ${monthName(month)}`}
							valueText={`${formatMoney(spent)} spent of ${formatMoney(available)}`}
						/>
					</TotalsCard>
				) : undefined
			}
		>
			{state.editable ? (
				// Stays in view while Buckets and Personal Allowances are added and changed (a bar across the
				// top on a phone). It is the list's own child, not the Buckets block's, so it sticks for as
				// long as any of the list is on screen; -mb-5 leaves the Buckets 12px under it.
				<div className="sticky top-[var(--safe-top)] z-10 -mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-(--radius-control) border bg-card/90 px-3 py-2 backdrop-blur-xl max-lg:-mx-1">
					<p aria-live="polite" className="text-sm text-muted-foreground">
						Left to plan <TermHelp term="free-to-spend" />{" "}
						<span
							className={`font-medium tabular-nums ${left < 0 ? "text-over-foreground" : "text-foreground"}`}
						>
							{formatMoney(left)}
						</span>
						{stillToSet.map((name) => (
							<span key={name}> · still to set: {name}’s Personal Allowance</span>
						))}
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
			<div className="grid gap-3">
				{buckets.length > 0 ? (
					<>
						<BucketList
							month={month}
							buckets={buckets}
							editable={state.editable}
							was={changes.allowances}
							onDraft={onDraft}
							figures
						/>
						{state.editable ? (
							// Under the list (#98): what each part of a row does, and Add without scrolling back
							// up a long list. Its own words, so the bar's Add Buckets stays the one of that name.
							<div className="grid gap-3 px-1">
								<p data-slot="bucket-how" className="text-[13px] text-muted-foreground">
									To change a Bucket, choose its amount (its name is there too). The pencil has its
									colour, what happens at the end of the month, moving it and archiving it. A new
									amount counts from {monthName(month)} on, unless you choose just{" "}
									{monthName(month)}.
								</p>
								<AddBuckets
									month={month}
									buckets={state.buckets}
									freeToSpend={state.freeToSpend}
									parentId={parentId}
									parentName={nameOf(parentId)}
									label="Add another Bucket"
									variant="outline"
								/>
							</div>
						) : null}
					</>
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
				{/* Under the list (#76), on this month only: adding one writes this month's Plan. */}
				{state.editable && month === monthOfDay(state.asOf) ? (
					<Suggested kinds={["new-bucket"]} />
				) : null}
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
									figures
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
