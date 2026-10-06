import { canAssign, monthKeyAt, type PlanBucket } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { List } from "@noodle/ui/components/list";
import { MetaParts } from "@noodle/ui/components/meta-parts";
import { SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { Tile } from "@noodle/ui/components/tile";
import { cn } from "@noodle/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, useHydrated, useParams } from "@tanstack/react-router";
import { ChevronRight, Lock, Plus, WandSparkles } from "lucide-react";
import { useState } from "react";
import { asBucketColor, monogram } from "../../../buckets";
import { ListBesideDetail, masterDetailItem } from "../../../components/master-detail";
import { RuleForm } from "../../../components/rule-form";
import { SectionPending } from "../../../components/section-layout";
import { forLabel, type MemberSummary } from "../../../members";
import { membersQuery, monthQuery, rulesQuery } from "../../../queries";
import type { RuleRow } from "../../../review";

export const Route = createFileRoute("/_authed/_household/review/rules")({
	beforeLoad: ({ context }) => ({
		current: monthKeyAt(new Date(), context.household.timeZone),
	}),
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(rulesQuery()),
			context.queryClient.ensureQueryData(membersQuery()),
			context.queryClient.ensureQueryData(monthQuery(context.current)),
		]),
	pendingComponent: SectionPending,
	component: RulesPage,
});

/**
 * The Rules this Parent may see: the Household's, and their own private ones into their
 * Personal Allowance, which the other Parent never sees. Each can be changed, deleted, or used
 * to file what's still unassigned.
 */
function RulesPage() {
	const { current, parentId } = Route.useRouteContext();
	const rules = useSuspenseQuery(rulesQuery()).data;
	const members = useSuspenseQuery(membersQuery()).data;
	// Rules file into this month's Buckets onward, so they're picked from this month's Plan.
	const commitments = useSuspenseQuery(monthQuery(current)).data.plan.commitments;
	const buckets = useSuspenseQuery(monthQuery(current)).data.plan.buckets.filter((b) =>
		canAssign(b, parentId),
	);
	const hydrated = useHydrated();
	const [adding, setAdding] = useState(false);
	// The Rule open in the panel (its route is this one's child).
	const picked = useParams({ strict: false, select: (params) => params.ruleId });

	return (
		<>
			<ListBesideDetail
				picked={picked !== undefined}
				noun="Rule"
				listLabel="Rules"
				// The Rules take the wide column and what a Rule does the rail's width; a picked Rule opens
				// in the panel from the right (issue 107).
				panel={{ close: linkOptions({ to: "/review/rules" }), itemKey: picked }}
				aside={
					<p className="text-sm text-muted-foreground">
						A Rule files each new statement line whose merchant contains its words. What it filed
						stays put when you change or delete it.
					</p>
				}
				list={
					<div className="grid gap-4">
						<SectionHeader
							title="Your Rules"
							count={rules.length}
							action={
								<Button
									size="sm"
									disabled={!hydrated || buckets.length === 0}
									onClick={() => setAdding(true)}
								>
									<Plus />
									Add Rule
								</Button>
							}
						/>
						<Card className="p-0">
							{rules.length === 0 ? (
								<EmptyState
									icon={<WandSparkles />}
									title="No Rules yet"
									description="A Rule files a merchant’s charges in the same Bucket every time, so they skip Review. Add one here, or press “Always file” after you file a card in Review."
								/>
							) : (
								<List>
									{rules.map((rule) => (
										<RuleListRow
											key={rule.id}
											rule={rule}
											bucket={buckets.find((b) => b.id === rule.bucketId)}
											members={members}
										/>
									))}
								</List>
							)}
						</Card>
					</div>
				}
			/>
			<Sheet open={adding} onOpenChange={setAdding}>
				<SheetContent>
					<SheetHeader
						title="Add a Rule"
						description="New statement lines whose merchant contains these words are filed on their own."
					/>
					{adding ? (
						<RuleForm
							key="new"
							rule={null}
							buckets={buckets}
							commitments={commitments}
							members={members}
							onDone={() => setAdding(false)}
						/>
					) : null}
				</SheetContent>
			</Sheet>
		</>
	);
}

function RuleListRow({
	rule,
	bucket,
	members,
}: {
	rule: RuleRow;
	bucket: PlanBucket | undefined;
	members: MemberSummary[];
}) {
	const who = forLabel(members, rule.for);
	const filed = `Filed ${rule.matched} so far`;
	return (
		// On a phone the row knows its width in text sizes: under 17rem (text at about 200%) the tile
		// goes and the count sits under the facts, so each fact keeps its words whole (issue 74).
		<li data-slot="list-row" className="max-sm:@container">
			<Link
				to="/review/rules/$ruleId"
				params={{ ruleId: rule.id }}
				{...masterDetailItem}
				aria-label={`${rule.pattern}, ${rule.bucketName}, For ${who}${rule.private ? ", only you" : ""}, ${filed}`}
				className={cn(
					"grid w-full grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 px-(--card-pad) py-3.5 text-start",
					"@max-[17rem]:grid-cols-[minmax(0,1fr)_auto] @max-[17rem]:gap-y-1 @max-[17rem]:*:first:hidden",
					"transition-colors duration-(--duration-fast) ease-standard hover:bg-surface-2/60",
					"focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
				)}
			>
				<Tile aria-hidden="true" bucket={bucket ? asBucketColor(bucket.color) : undefined}>
					{monogram(rule.bucketName)}
				</Tile>
				<span className="grid min-w-0 gap-0.5">
					<span className="flex min-w-0 items-center gap-1.5">
						<span className="truncate text-sm font-medium">“{rule.pattern}”</span>
						{rule.private ? (
							<Badge aria-hidden="true" className="h-4.5 px-1.5 text-[11px]">
								<Lock />
								Only you
							</Badge>
						) : null}
					</span>
					{/* Wraps between the facts, never inside one. */}
					<MetaParts
						className="text-[13px] text-muted-foreground"
						parts={[
							rule.bucketName,
							`For ${who}`,
							rule.createdBy ? `Made by ${rule.createdBy}` : null,
						]}
					/>
				</span>
				{/* How many it has filed, in a column of its own so the counts line up down the list. */}
				<span className="grid justify-items-end text-end @max-[17rem]:col-start-1 @max-[17rem]:row-start-2 @max-[17rem]:flex @max-[17rem]:items-baseline @max-[17rem]:gap-1.5 @max-[17rem]:text-start">
					<span className="text-sm font-semibold tabular-nums">{rule.matched}</span>
					<span className="text-xs text-muted-foreground">Filed</span>
				</span>
				<ChevronRight aria-hidden="true" className="size-4 text-subtle-foreground" />
			</Link>
		</li>
	);
}
