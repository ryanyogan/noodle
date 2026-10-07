import { lumpyMonths, monthlyEquivalent, monthOfDay, yearlyCost } from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import {
	Collapsible,
	CollapsibleContent,
	CollapsibleTrigger,
} from "@noodle/ui/components/collapsible";
import { EmptyState } from "@noodle/ui/components/empty-state";
import { Money } from "@noodle/ui/components/money";
import { RowButton } from "@noodle/ui/components/row-button";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { Sheet, SheetContent, SheetHeader } from "@noodle/ui/components/sheet";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, linkOptions, useHydrated } from "@tanstack/react-router";
import { CalendarClock, ChevronRight, Plus } from "lucide-react";
import { useState } from "react";
import { z } from "zod";
import { AddCommitment, useCommitmentChanges } from "../../../components/commitment-editor";
import { CommitmentTable } from "../../../components/commitment-table";
import { PlanMasterDetail, TotalsCard } from "../../../components/plan-page";
import { SectionPending } from "../../../components/section-layout";
import { Suggested } from "../../../components/suggested";
import { TermHelp } from "../../../components/term-help";
import { formatMoney, monthName } from "../../../format";
import { commitmentsQuery, goalsQuery, suggestionsQuery, useMonthState } from "../../../queries";

export const Route = createFileRoute("/_authed/_household/plan/$month/commitments")({
	// From a payment in Review made into a Commitment: what the add form opens with (ADR-0050).
	validateSearch: z.object({
		name: z.string().max(40).optional().catch(undefined),
		amount: z.number().int().positive().optional().catch(undefined),
		paysDown: z.string().max(40).optional().catch(undefined),
	}),
	// Lumpy months ahead read every Commitment's schedule; Suggested is in the first paint.
	loader: ({ context }) =>
		Promise.all([
			context.queryClient.ensureQueryData(commitmentsQuery()),
			context.queryClient.ensureQueryData(suggestionsQuery()),
			// The names behind "Pays down American Express" on a row.
			context.queryClient.ensureQueryData(goalsQuery()),
		]),
	pendingComponent: SectionPending,
	component: PlanCommitments,
});

function PlanCommitments() {
	const hydrated = useHydrated();
	const { month } = Route.useRouteContext();
	const start = Route.useSearch();
	const [prefill, setPrefill] = useState(start);
	const state = useMonthState(month);
	const [adding, setAdding] = useState(Boolean(start.name || start.amount || start.paysDown));
	const all = useSuspenseQuery(commitmentsQuery()).data;
	const lumpy = lumpyMonths(all, month, 12);
	// Owned here: ending a Commitment removes its row, which must not take the error with it.
	const writes = useCommitmentChanges(month);
	// Due this month first; the rest (a yearly bill due in spring, say) folded away below.
	const due = state.commitments.filter((c) => c.dueDates.length > 0);
	const notDue = state.commitments.filter((c) => c.dueDates.length === 0);
	const paid = state.commitments.reduce((sum, c) => sum + c.actual, 0);
	const toPay = due.reduce((sum, c) => sum + Math.max(0, c.expected - c.actual), 0);
	const average = state.commitments.reduce((sum, c) => sum + monthlyEquivalent(c), 0);
	// Folded unless nothing's due this month; one just added or moved there opens it, so it shows.
	const [showNotDue, setShowNotDue] = useState(due.length === 0);
	const [notDueCount, setNotDueCount] = useState(notDue.length);
	if (notDue.length !== notDueCount) {
		setNotDueCount(notDue.length);
		if (notDue.length > notDueCount) setShowNotDue(true);
	}
	const aside = (
		<>
			{state.commitments.length > 0 ? (
				<>
					<p className="text-sm text-muted-foreground sm:px-1">
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
					<p className="text-[13px] text-muted-foreground sm:px-1">
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
			// A Commitment opens in a panel from the right; the list keeps its width and columns.
			panel={{
				size: "wide",
				besideFrom: "late",
				close: linkOptions({ to: "/plan/$month/commitments", params: { month } }),
			}}
			editable={state.editable}
			summary={
				state.commitments.length > 0 ? (
					<>
						<Money cents={state.committed} /> expected this month
					</>
				) : undefined
			}
			overviewHeader={{
				eyebrow: `Bills in ${monthName(month)}`,
				title: (
					<>
						<Money cents={paid} /> paid
					</>
				),
			}}
			overview={
				state.commitments.length > 0 ? (
					<TotalsCard
						label={`Bills in ${monthName(month)}: totals`}
						lines={[
							{ label: "Expected this month", value: formatMoney(state.committed) },
							{ label: "Paid so far", value: formatMoney(paid) },
							{
								label: "Paid in full",
								value: `${due.filter((c) => c.charges >= c.dueDates.length).length} of ${due.length}`,
							},
							{ label: "Still to pay", value: formatMoney(toPay), tone: "strong" },
						]}
					/>
				) : undefined
			}
			aside={aside}
		>
			<div className="grid min-w-0 gap-5">
				{/* The page's heading, as the Plan's Buckets have theirs (issue 146): the section heading
				    with its count, and the filled Add button at the heading's size beside it. */}
				<div className="grid gap-1">
					<SectionHeader
						id="plan-commitments"
						title="Your commitments"
						count={state.commitments.length}
						action={
							state.editable ? (
								<Button
									type="button"
									size="sm"
									// Beside the heading on a phone there is room for the words only.
									className="max-sm:[&_svg]:hidden"
									disabled={!hydrated}
									onClick={() => setAdding(true)}
								>
									<Plus />
									Add Commitment
								</Button>
							) : undefined
						}
					/>
					<p className="text-[13px] text-muted-foreground">
						Recurring bills, what’s due, and what you’ve paid.
					</p>
				</div>
				<Sheet open={adding} onOpenChange={setAdding}>
					<SheetContent>
						<SheetHeader
							title="Add a Commitment"
							description="Set up a recurring bill or regular payment."
						/>
						<AddCommitment
							month={month}
							start={prefill}
							onAdded={() => {
								setAdding(false);
								setPrefill({});
							}}
						/>
					</SheetContent>
				</Sheet>
				{writes.failed}
				{state.commitments.length > 0 ? (
					<>
						{due.length > 0 ? (
							<Section aria-labelledby="commitments-due">
								{/* A quieter label than the page's heading over it, in the type of "Not this month". */}
								<h3
									id="commitments-due"
									className="flex min-h-7 items-center gap-1.5 px-1 text-[13px] font-medium text-muted-foreground"
								>
									Due this month
									<Badge variant="count">{due.length}</Badge>
								</h3>
								<CommitmentTable
									month={month}
									commitments={due}
									editable={state.editable}
									changes={writes}
								/>
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
								<CollapsibleContent className="pt-1">
									<CommitmentTable
										month={month}
										commitments={notDue}
										editable={state.editable}
										changes={writes}
									/>
								</CollapsibleContent>
							</Collapsible>
						) : null}
					</>
				) : state.editable ? (
					<EmptyState
						icon={<CalendarClock />}
						title="No Commitments yet"
						description={
							<>
								Recurring, predictable costs: the mortgage, insurance, daycare, subscriptions. What
								they’re expected to take each month comes out before the Buckets.{" "}
								<TermHelp term="commitment" />
							</>
						}
					/>
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
