import { lumpyMonths, monthlyEquivalent, monthOfDay, yearlyCost } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Card } from "@noodle/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { List } from "@noodle/ui/components/list";
import { Money } from "@noodle/ui/components/money";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { useState } from "react";
import {
	AddCommitment,
	CommitmentEditor,
	useCommitmentChanges,
} from "../../../components/commitment-editor";
import { PlanMasterDetail } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
import { Suggested } from "../../../components/suggested";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, monthName } from "../../../format";
import { usePlanChanges } from "../../../plan-changes";
import { commitmentsQuery, suggestionsQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/commitments")({
	// Lumpy months ahead read every Commitment's schedule; Suggested is in the first paint.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(commitmentsQuery()),
			context.queryClient.ensureQueryData(suggestionsQuery()),
		]),
	pendingComponent: SectionPending,
	component: PlanCommitments,
});

function PlanCommitments() {
	const { month } = Route.useRouteContext();
	const state = useMonthState(month);
	const changes = usePlanChanges(month);
	const all = useSuspenseQuery(commitmentsQuery()).data;
	const lumpy = lumpyMonths(all, month, 12);
	// Owned here: ending a Commitment removes its row, which must not take the error with it.
	const writes = useCommitmentChanges(month);
	// Due this month first; the rest (a yearly bill due in spring, say) folded away below.
	const due = state.commitments.filter((c) => c.dueDates.length > 0);
	const notDue = state.commitments.filter((c) => c.dueDates.length === 0);
	const average = state.commitments.reduce((sum, c) => sum + monthlyEquivalent(c), 0);
	// Folded unless nothing's due this month; one just added or moved there opens it, so it shows.
	const [showNotDue, setShowNotDue] = useState(due.length === 0);
	const [notDueCount, setNotDueCount] = useState(notDue.length);
	if (notDue.length !== notDueCount) {
		setNotDueCount(notDue.length);
		if (notDue.length > notDueCount) setShowNotDue(true);
	}
	const row = (commitment: (typeof state.commitments)[number]) => (
		<CommitmentEditor
			key={commitment.id}
			month={month}
			commitment={commitment}
			editable={state.editable}
			was={changes.commitments[commitment.id]}
			changes={writes}
		/>
	);
	const aside = (
		<>
			{state.editable ? <AddCommitment month={month} /> : null}
			{state.commitments.length > 0 ? (
				<>
					<p className="px-1 text-sm text-muted-foreground">
						Across a year these average{" "}
						<span className="font-medium text-foreground tabular-nums">
							{formatMoney(average)} a month
						</span>{" "}
						({formatMoney(state.commitments.reduce((sum, c) => sum + yearlyCost(c), 0))} a year).{" "}
						{average > state.committed
							? `That’s more than this month’s ${formatMoney(state.committed)}, because some are due only in certain months.`
							: average < state.committed
								? `This month’s ${formatMoney(state.committed)} is more, because some fall due in it.`
								: null}
					</p>
					<p className="px-1 text-[13px] text-muted-foreground">
						Paying off a card or loan faster? Its regular payment stays here; a{" "}
						<Link
							to="/goals"
							search={{ add: "payoff" }}
							className="font-medium text-foreground underline underline-offset-3"
						>
							payoff Goal
						</Link>{" "}
						plans the extra on top.
					</p>
				</>
			) : null}
			{lumpy.length > 0 ? (
				// The year view keeps the one list of lumpy months; this says how many and leads there.
				<RowButton asChild variant="bordered">
					<Link to="/plan/$month/year" params={{ month }}>
						<span>
							<span className="font-medium">
								{lumpy.length === 1 ? "1 lumpy month" : `${lumpy.length} lumpy months`} ahead
							</span>
							<span className="block text-[13px] text-muted-foreground">
								Next: {monthYear(lumpy[0]?.month ?? month)},{" "}
								{formatMoney((lumpy[0]?.lumps ?? []).reduce((sum, l) => sum + l.extra, 0))} extra.
								See them on the year.
							</span>
						</span>
						<ChevronRight aria-hidden="true" className="size-4 shrink-0 text-subtle-foreground" />
					</Link>
				</RowButton>
			) : null}
		</>
	);
	return (
		<PlanMasterDetail
			noun="Commitment"
			listLabel="Commitments"
			editable={state.editable}
			summary={
				state.commitments.length > 0 ? (
					<>
						<Money cents={state.committed} /> expected this month
					</>
				) : undefined
			}
			aside={aside}
		>
			<div className="grid gap-3">
				{writes.failed}
				{state.commitments.length > 0 ? (
					<>
						{due.length > 0 ? (
							<Section aria-labelledby="commitments-due">
								<SectionHeader id="commitments-due" title="Due this month" count={due.length} />
								<List>{due.map(row)}</List>
							</Section>
						) : null}
						{notDue.length > 0 ? (
							<Collapsible className="group" open={showNotDue} onOpenChange={setShowNotDue}>
								<CollapsibleTrigger className="w-full text-start flex min-h-9 max-lg:min-h-11 items-center gap-1.5 px-1 text-[13px] text-muted-foreground hover:text-foreground">
									<ChevronRight
										aria-hidden="true"
										className="size-4 transition-transform group-data-[state=open]:rotate-90"
									/>
									Not this month
									<Badge variant="count">{notDue.length}</Badge>
								</CollapsibleTrigger>
								<CollapsibleContent>
									<List>{notDue.map(row)}</List>
								</CollapsibleContent>
							</Collapsible>
						) : null}
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
				{/* Under the list (#76). Adding one writes this month's Plan, so they show on this month only. */}
				{state.editable && month === monthOfDay(state.asOf) ? (
					<Suggested kinds={["new-commitment", "commitment-amount"]} />
				) : null}
			</div>
		</PlanMasterDetail>
	);
}

/** "January 2027". */
const monthYear = (month: string) => `${monthName(month)} ${month.slice(0, 4)}`;
