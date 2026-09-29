import {
	addDays,
	addMonths,
	type DayKey,
	duesBetween,
	type MonthKey,
	matchCharges,
	monthlyEquivalent,
	monthOfDay,
	yearlyCost,
} from "@noodle/domain";
import { Badge } from "@noodle/ui/components/badge";
import { Button } from "@noodle/ui/components/button";
import { Card } from "@noodle/ui/components/card";
import { List, ListRow } from "@noodle/ui/components/list";
import { PageHeader } from "@noodle/ui/components/page-header";
import { Section, SectionHeader } from "@noodle/ui/components/section";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { termsSchedule } from "../../../commitments";
import { DateTile, dueDay, dueStatus } from "../../../components/coming-up";
import { PlanHistoryList } from "../../../components/plan-history";
import { formatMoney, fullDay, monthName } from "../../../format";
import { commitmentsQuery, planHistoryQuery } from "../../../queries";
import { COMMITMENT_MONTHS, type CommitmentsData } from "../../../server/commitments";

// A Commitment's page: what it costs, when it's next due, the charges that paid it, when it ends
// and how its terms changed. Everything comes from the one Commitments query Coming up reads.
export const Route = createFileRoute("/_authed/_household/plan/commitments/$id")({
	loader: async ({ context, params }) => {
		const data = await context.queryClient.ensureQueryData(commitmentsQuery());
		if (!data.commitments.some((c) => c.id === params.id)) throw notFound();
		await context.queryClient.ensureQueryData(planHistoryQuery(monthOfDay(data.asOf), params.id));
	},
	component: CommitmentPage,
});

/** How many of its next due dates a Commitment's page lists. */
const NEXT_DUES = 4;

function CommitmentPage() {
	const { id } = Route.useParams();
	const data = useSuspenseQuery(commitmentsQuery()).data;
	const month = monthOfDay(data.asOf);
	const commitment = data.commitments.find((c) => c.id === id);
	const back = <BackToCommitments month={month} />;
	// A Commitment only goes away if another Parent's change removes it; the loader 404s on reload.
	if (!commitment) return <PageHeader eyebrow="Commitment" title="Commitment" leading={back} />;
	const terms = currentTerms(data, id, month);
	const ended = commitment.endedFromMonth !== null && commitment.endedFromMonth <= month;
	return (
		<>
			<PageHeader
				eyebrow={ended ? "Ended Commitment" : "Commitment"}
				title={commitment.name}
				leading={back}
			/>
			<div className="grid max-w-2xl gap-8">
				{terms ? (
					<Card role="region" aria-labelledby="commitment-cost">
						<div className="grid gap-1 p-(--card-pad)">
							<h2 id="commitment-cost" className="text-[13px] font-medium text-muted-foreground">
								{ended ? "Cost a year, when it ended" : "Cost a year"}
							</h2>
							<p className="flex flex-wrap items-baseline gap-x-2">
								<span className="text-[2.25rem] font-[650] leading-[1.05] tracking-[-0.035em] tabular-nums">
									{formatMoney(yearlyCost(terms))}
								</span>
								<span className="text-sm text-muted-foreground tabular-nums">
									{terms.cadence === "monthly" ? "" : "about "}
									{formatMoney(monthlyEquivalent(terms))} a month
								</span>
							</p>
						</div>
						<dl className="grid grid-cols-2 border-t sm:grid-cols-[auto_minmax(0,1fr)_auto]">
							<Stat label="Each payment" value={formatMoney(terms.amount)} />
							<Stat label="Schedule" value={termsSchedule(terms)} />
							<Stat
								label={ended ? "Ended" : "Ends"}
								value={
									commitment.endedFromMonth === null
										? "No end date"
										: `After ${monthName(addMonths(commitment.endedFromMonth, -1))}`
								}
							/>
						</dl>
						{ended ? null : (
							<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t px-(--card-pad) py-2.5 text-[13px] text-muted-foreground">
								<p className="py-1">See what ending it would free up.</p>
								<Button variant="outline" size="sm" asChild>
									<Link to="/explore" search={{ lever: `end-commitment:${id}` }}>
										Try ending this
									</Link>
								</Button>
							</div>
						)}
					</Card>
				) : null}
				<NextDues data={data} id={id} ended={ended} />
				<Charges data={data} id={id} />
				<Section aria-labelledby="terms-history">
					<SectionHeader id="terms-history" title="Terms history" />
					<PlanHistoryList month={month} targetId={id} />
				</Section>
			</div>
		</>
	);
}

function BackToCommitments({ month }: { month: MonthKey }) {
	return (
		<Button variant="ghost" size="icon" asChild>
			<Link to="/plan/$month/commitments" params={{ month }} aria-label="Back to Commitments">
				<ChevronLeft className="size-5" />
			</Link>
		</Button>
	);
}

/** The terms in force this month, or, for one not started yet, the ones it starts with. */
function currentTerms(data: CommitmentsData, id: string, month: MonthKey) {
	const own = data.commitmentTerms
		.filter((t) => t.commitmentId === id)
		.sort((a, b) => (a.month < b.month ? 1 : -1));
	return own.find((t) => t.month <= month) ?? own.at(-1);
}

/** "Fri, Oct 2" this year, "Mar 15, 2027" in another. */
const dayText = (date: DayKey, today: DayKey) =>
	date.slice(0, 4) === today.slice(0, 4) ? dueDay(date, today) : fullDay(date);

function NextDues({ data, id, ended }: { data: CommitmentsData; id: string; ended: boolean }) {
	const dues = duesBetween(data, data.charges, data.asOf, addDays(data.asOf, 365))
		.filter((d) => d.commitmentId === id)
		.slice(0, NEXT_DUES);
	return (
		<Section aria-labelledby="next-due">
			<SectionHeader id="next-due" title="Next due" />
			{dues.length > 0 ? (
				<List>
					{dues.map((due) => {
						const status = dueStatus(due);
						const day = dayText(due.date, data.asOf);
						return (
							<ListRow
								key={due.date}
								aria-label={`Due ${day}, ${formatMoney(due.amount)}${status ? `, ${status}` : ""}`}
								leading={<DateTile date={due.date} />}
								title={day}
								meta={
									status ? (
										<Badge variant={due.status === "paid" ? "default" : "pace"} dot>
											{status}
										</Badge>
									) : undefined
								}
								trailing={
									<span className="text-sm font-medium tabular-nums">
										{formatMoney(due.amount)}
									</span>
								}
							/>
						);
					})}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					{ended ? "It’s no longer due." : "It isn’t due in the next year."}
				</Card>
			)}
		</Section>
	);
}

function Charges({ data, id }: { data: CommitmentsData; id: string }) {
	const charges = matchCharges(data, id, data.charges);
	return (
		<Section aria-labelledby="charges">
			<SectionHeader
				id="charges"
				title="Charges"
				count={charges.length}
				action={
					<span className="text-[13px] text-muted-foreground">Last {COMMITMENT_MONTHS} months</span>
				}
			/>
			{charges.length > 0 ? (
				<List>
					{charges.map((charge) => {
						const day = dayText(charge.date, data.asOf);
						const status =
							charge.onTime === null ? "Not scheduled" : charge.onTime ? "On time" : "Late";
						return (
							<ListRow
								key={charge.id}
								aria-label={`Paid ${day}, ${formatMoney(charge.amount)}, ${status}`}
								leading={<DateTile date={charge.date} />}
								title={`Paid ${day}`}
								meta={
									<>
										{charge.dueDate ? <span>Due {dayText(charge.dueDate, data.asOf)}</span> : null}
										<Badge variant={charge.onTime === false ? "pace" : "default"} dot>
											{status}
										</Badge>
									</>
								}
								trailing={
									<span className="text-sm font-medium tabular-nums">
										{formatMoney(charge.amount)}
									</span>
								}
							/>
						);
					})}
				</List>
			) : (
				<Card className="p-(--card-pad) text-sm text-muted-foreground">
					Nothing has been paid toward it in the last {COMMITMENT_MONTHS} months.
				</Card>
			)}
		</Section>
	);
}

function Stat({ label, value }: { label: string; value: string }) {
	return (
		<div className="grid gap-0.5 border-l px-(--card-pad) py-3 first:border-l-0 max-sm:last:col-span-2 max-sm:last:border-t max-sm:last:border-l-0">
			<dt className="text-xs text-muted-foreground">{label}</dt>
			<dd className="text-sm font-semibold tabular-nums">{value}</dd>
		</div>
	);
}
